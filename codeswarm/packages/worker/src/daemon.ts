import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger, LOG_MODULES, startLogArchive } from './logger.js';
import {
  TaskPayloadSchema,
  type TaskPayload,
  type TaskResultStatus,
} from '@codeswarm/types';
import { EnvironmentFactory } from './environment.js';
import { ProcessManager, type AgentEvent } from './process-manager.js';
import { Semaphore } from './semaphore.js';
import { CodedmapManager } from './codedmap-manager.js';
import { ensureBucket } from './minio-client.js';

interface AuditReportCandidate {
  filePath: string;
  size: number;
  mtimeMs: number;
}

const AUDIT_REPORT_BASENAME = 'AUDIT_REPORT';
const AUDIT_REPORT_ACCEPTED_EXTS = new Set(['.json', '.md']);
const DEFAULT_REPORT_POLL_INTERVAL_SEC = 600;
const REPORT_NOT_GENERATED_ERROR = '任务执行失败，报告未生成。';

export function findAuditReportCandidate(workspace: string): AuditReportCandidate | null {
  const reportDir = path.join(workspace, 'Report');

  try {
    if (!fs.existsSync(reportDir) || !fs.statSync(reportDir).isDirectory()) {
      return null;
    }

    const entries = fs.readdirSync(reportDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const parsed = path.parse(entry.name);
      if (!parsed.name.startsWith(AUDIT_REPORT_BASENAME)) continue;
      if (!AUDIT_REPORT_ACCEPTED_EXTS.has(parsed.ext.toLowerCase())) continue;

      const filePath = path.join(reportDir, entry.name);
      const stat = fs.statSync(filePath);
      if (stat.size <= 0) continue;

      return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    }
  } catch {
    return null;
  }

  return null;
}

function isSameAuditReportCandidate(previous: AuditReportCandidate | null, current: AuditReportCandidate | null): boolean {
  return !!previous && !!current
    && previous.filePath === current.filePath
    && previous.size === current.size
    && previous.mtimeMs === current.mtimeMs;
}

function getReportPollIntervalMs(): number {
  const configured = parseInt(process.env.REPORT_POLL_INTERVAL_SEC || String(DEFAULT_REPORT_POLL_INTERVAL_SEC), 10);
  return (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REPORT_POLL_INTERVAL_SEC) * 1000;
}

interface WorkerDaemonConfig {
  nodeId: string;
  port: number;
  maxConcurrent: number;
  orchestratorUrl: string;
  /** Worker 外部可达地址（跨服务器部署时必须设置，否则心跳上报自动检测的容器内网 IP + localhost） */
  address?: string;
  /** 单任务超时时间（毫秒），默认 7*24*3600*1000 = 7天，可通过 TASK_TIMEOUT_SEC 环境变量配置 */
  taskTimeoutMs: number;
}

export class WorkerDaemon {
  private readonly config: WorkerDaemonConfig;
  private readonly server: FastifyInstance;
  private readonly envFactory: EnvironmentFactory;
  private readonly processMgr: ProcessManager;
  private readonly semaphore: Semaphore;
  private readonly codedmapMgr: CodedmapManager;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatFailCount = 0;
  private heartbeatInProgress = false;
  private static readonly HEARTBEAT_RETRY_DELAYS = [1000, 2000, 4000, 8000];
  private static readonly HEARTBEAT_MAX_FAIL_WARN = 5;
  /** Track task IDs currently being executed to prevent duplicate processing. */
  private readonly activeTasks = new Map<string, TaskPayload>();
  /** Track task IDs cancelled via /task/cancel to avoid duplicate result posts. */
  private readonly cancelledTasks = new Set<string>();

  constructor(config: WorkerDaemonConfig) {
    this.config = config;
    this.server = Fastify({ logger: true });
    this.envFactory = new EnvironmentFactory();
    this.processMgr = new ProcessManager();
    this.semaphore = new Semaphore(config.maxConcurrent);
    this.codedmapMgr = new CodedmapManager();
  }

  /**
   * Check if required engine binaries are available in PATH.
   * Logs availability status for each engine so admins can diagnose
   * spawn failures before tasks are dispatched.
   */
  private checkBinaries(): { opencode: boolean; claudecode: boolean } {
    const binaries = {
      opencode: 'opencode',
      claudecode: 'claude-agent-acp',
    };
    const result: Record<string, boolean> = {};

    for (const [engine, binary] of Object.entries(binaries)) {
      try {
        const resolved = execSync(`which ${binary} 2>/dev/null`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        result[engine] = true;
        this.server.log.info({ engine, binary, path: resolved }, `Engine binary available`);
      } catch {
        result[engine] = false;
        this.server.log.warn(
          { engine, binary },
          `Engine binary NOT found — tasks with engine=${engine} will fail at spawn (ENOENT). Install: ${engine === 'opencode' ? 'npm i -g opencode-ai' : 'npm i -g @agentclientprotocol/claude-agent-acp'}`,
        );
      }
    }

    const availableEngines = Object.entries(result)
      .filter(([, ok]) => ok)
      .map(([engine]) => engine);
    const missingEngines = Object.entries(result)
      .filter(([, ok]) => !ok)
      .map(([engine]) => engine);

    if (availableEngines.length > 0) {
      this.server.log.info({ availableEngines }, `Available engine binaries`);
    }
    if (missingEngines.length > 0) {
      this.server.log.warn(
        { missingEngines },
        `Missing engine binaries — tasks using these engines will fail until the binaries are installed`,
      );
    }

    return result as { opencode: boolean; claudecode: boolean };
  }

  async start(): Promise<void> {
    this.server.post('/task', async (request, reply) => {
      const parseResult = TaskPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid task payload', details: parseResult.error });
      }

      if (!this.semaphore.tryAcquire()) {
        return reply.status(503).send({ error: 'Worker at capacity' });
      }

      const payload = parseResult.data;

      // Deduplicate: reject if this taskId is already being executed
      if (this.activeTasks.has(payload.taskId)) {
        this.semaphore.release();
        this.server.log.warn({ taskId: payload.taskId }, 'Duplicate task rejected');
        return reply.status(409).send({ error: 'Task already being executed', taskId: payload.taskId });
      }

      // Mark task as active BEFORE async execution to close the dedup race window
      this.activeTasks.set(payload.taskId, payload);

      this.executeTask(payload)
        .catch(err => {
          this.server.log.error({ taskId: payload.taskId, error: err }, 'Task execution failed');
        })
        .finally(() => {
          this.activeTasks.delete(payload.taskId);
          this.semaphore.release();
        });

      return reply.status(202).send({ taskId: payload.taskId, message: 'Task accepted' });
    });

    // Health check
this.server.get('/health', async () => ({
      nodeId: this.config.nodeId,
      available: this.semaphore.available,
      maxConcurrent: this.semaphore.max,
    }));

    // Root info
    this.server.get('/', async () => ({
      service: 'codeswarm-worker',
      nodeId: this.config.nodeId,
      status: 'running',
      available: this.semaphore.available,
      maxConcurrent: this.semaphore.max,
    }));

    // Cancel task endpoint
    this.server.post('/task/cancel', async (request, reply) => {
      const body = request.body as { taskId?: string };
      const taskId = body?.taskId;
      
      if (!taskId) {
        return reply.status(400).send({ error: 'Missing taskId' });
      }

      // Check if task is active
      const payload = this.activeTasks.get(taskId);
      if (!payload) {
        this.server.log.warn({ taskId }, 'Task not active, cannot cancel');
        return reply.status(404).send({ error: 'Task not active', taskId });
      }

      this.server.log.info({ taskId }, 'Received cancel request');

      this.cancelledTasks.add(taskId);

      try {
        await this.processMgr.terminate(taskId);
        this.server.log.info({ taskId }, 'Process terminated successfully');
      } catch (err) {
        this.server.log.warn({ taskId, error: err }, 'Terminate failed, but will continue cleanup');
      }

      this.server.log.info({ taskId }, 'Task marked as cancelled, executeTask will handle cleanup');
      return reply.status(200).send({ taskId, message: 'Task cancelled successfully' });
    });

    await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
    this.checkBinaries();
    this.startHeartbeat();
    startLogArchive();
    // Ensure MinIO bucket exists at startup
    ensureBucket().catch(err => {
      this.server.log.warn({ error: err }, 'MinIO bucket check failed (non-fatal)');
    });
    this.server.log.info({ config: this.config }, 'Worker daemon started');
    logger.info(LOG_MODULES.DAEMON, `\n${'='.repeat(50)}`);
    logger.info(LOG_MODULES.DAEMON, `  Worker Node: ${this.config.nodeId}`);
    logger.info(LOG_MODULES.DAEMON, `  Port: ${this.config.port}`);
    logger.info(LOG_MODULES.DAEMON, `  Max Concurrent: ${this.config.maxConcurrent}`);
    logger.info(LOG_MODULES.DAEMON, `  Orchestrator: ${this.config.orchestratorUrl}`);
    logger.info(LOG_MODULES.DAEMON, `${'='.repeat(50)}\n`);
  }

  async stop(): Promise<void> {
    logger.info(LOG_MODULES.DAEMON, `Graceful shutdown initiated, active tasks: ${this.activeTasks.size}`);
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatRetryTimer) {
      clearTimeout(this.heartbeatRetryTimer);
      this.heartbeatRetryTimer = null;
    }

    // Notify platform for all active tasks before terminating
    for (const [taskId, payload] of this.activeTasks) {
      logger.info(LOG_MODULES.DAEMON, `Notifying platform of interrupted task: ${taskId}`);
      try {
        await this.postResult(payload, {
          taskId,
          nodeId: this.config.nodeId,
          status: 'failed',
          error: 'Worker daemon shutting down, task interrupted',
        });
      } catch (e) {
        logger.error(LOG_MODULES.DAEMON, `Failed to notify platform for task ${taskId}:`, e);
      }
      try {
        await this.processMgr.terminate(taskId);
      } catch {
        // Process may already be dead
      }
      this.activeTasks.delete(taskId);
      this.semaphore.release();
    }

    await this.server.close();
    logger.info(LOG_MODULES.DAEMON, 'Graceful shutdown complete');
  }

  private startHeartbeat(): void {
    this.sendHeartbeatWithRetry();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeatWithRetry();
    }, 30_000);
  }

  private sendHeartbeatWithRetry(): void {
    if (this.heartbeatInProgress) return;
    this.heartbeatInProgress = true;
    
    this.sendHeartbeat()
      .then((success) => {
        this.heartbeatInProgress = false;
        if (success) {
          this.heartbeatFailCount = 0;
          if (this.heartbeatRetryTimer) {
            clearTimeout(this.heartbeatRetryTimer);
            this.heartbeatRetryTimer = null;
          }
        } else {
          this.scheduleHeartbeatRetry();
        }
      })
      .catch(() => {
        this.heartbeatInProgress = false;
        this.scheduleHeartbeatRetry();
      });
  }

  private scheduleHeartbeatRetry(): void {
    this.heartbeatFailCount++;
    
    if (this.heartbeatFailCount >= WorkerDaemon.HEARTBEAT_MAX_FAIL_WARN) {
      this.server.log.warn(
        { failCount: this.heartbeatFailCount },
        `Heartbeat 连续失败 ${this.heartbeatFailCount} 次，Worker 可能被判定离线`
      );
    }
    
    const delayIndex = Math.min(
      this.heartbeatFailCount - 1,
      WorkerDaemon.HEARTBEAT_RETRY_DELAYS.length - 1
    );
    const delay = WorkerDaemon.HEARTBEAT_RETRY_DELAYS[delayIndex];
    
    this.server.log.info(
      { failCount: this.heartbeatFailCount, retryDelay: delay },
      `Heartbeat 失败，${delay}ms 后重试`
    );
    
    this.heartbeatRetryTimer = setTimeout(() => {
      this.sendHeartbeatWithRetry();
    }, delay);
  }

  /** Build the address string for heartbeat reporting.
   *  If WORKER_ADDRESS is set (recommended for cross-server / Docker deployment),
   *  use it as primary address and append auto-detected IPs as fallback.
   *  If not set, auto-detect local IPs (but exclude localhost to prevent
   *  the orchestrator from misclassifying remote workers as local). */
  private getHeartbeatAddress(): string {
    const autoDetected: string[] = [];
    const interfaces = os.networkInterfaces();
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          autoDetected.push(`${addr.address}:${this.config.port}`);
        }
      }
    }

    if (this.config.address) {
      // WORKER_ADDRESS configured: use it as primary, auto-detected as fallback
      const parts = this.config.address.split(',').map(a => a.trim()).filter(Boolean);
      const all = [...parts, ...autoDetected];
      return [...new Set(all)].join(',');
    }

    // No WORKER_ADDRESS: auto-detect only, skip localhost
    // (localhost in address triggers isLocalWorker on the orchestrator,
    //  causing wrong callbackUrl for cross-server deployments)
    return [...new Set(autoDetected)].join(',');
  }

  private async sendHeartbeat(): Promise<boolean> {
    try {
      const address = this.getHeartbeatAddress();
      const systemType = os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'darwin' : 'linux';
      const arch = os.arch() === 'x64' ? 'x64' : os.arch() === 'arm64' ? 'arm64' : os.arch();
      const currentMax = this.semaphore.max;
      const resp = await fetch(`${this.config.orchestratorUrl}/api/codeswarm/worker/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          maxConcurrent: currentMax,
          currentTasks: currentMax - this.semaphore.available,
          address,
          systemType,
          arch,
        }),
        signal: AbortSignal.timeout(5000),
      });
      
      if (resp.ok) {
        try {
          const data = await resp.json() as { maxConcurrentOverride?: number };
          if (typeof data.maxConcurrentOverride === 'number' && data.maxConcurrentOverride !== currentMax) {
            this.semaphore.resize(data.maxConcurrentOverride);
            this.server.log.info(
              { previousMax: currentMax, newMax: data.maxConcurrentOverride },
              `maxConcurrent dynamically adjusted via server override`
            );
          }
        } catch { /* non-critical: heartbeat succeeded, response body parsing optional */ }

        const activeTaskIds = [...this.activeTasks.keys()];
        this.server.log.info(
          { activeTaskIds, count: activeTaskIds.length },
          `Heartbeat OK | nodeId=${this.config.nodeId} | active: [${activeTaskIds.join(', ')}]`
        );
        return true;
      }
      
      this.server.log.warn({ status: resp.status }, 'Heartbeat failed');
      return false;
    } catch (err) {
      this.server.log.warn({ error: err }, 'Heartbeat request failed');
      return false;
    }
  }

  /** Resolve the callback base URL from payload override or default config. */
  private getCallbackUrl(payload: TaskPayload): string {
    return payload.callbackUrl || this.config.orchestratorUrl;
  }

  private async executeTask(payload: TaskPayload): Promise<void> {
    const { taskId, engine: payloadEngine, agent, apiKey, model, apiBaseUrl, env, timeoutSec } = payload;
    const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
    const taskTimeoutMs = timeoutSec ? timeoutSec * 1000 : this.config.taskTimeoutMs;
    let buildResult = null;
    let codedmapPromise: Promise<void> | null = null;

    try {
      const taskStartTime = Date.now();
      logger.info(LOG_MODULES.DAEMON, `========== TASK START [${this.config.nodeId}:${taskId}] ==========`);
      logger.info(LOG_MODULES.DAEMON, `[${this.config.nodeId}] taskId: ${taskId}`);
      logger.info(LOG_MODULES.DAEMON, `payload.engine: ${payloadEngine}`);
      logger.info(LOG_MODULES.AGENT, `payload.agent: ${agent}`);
      logger.info(LOG_MODULES.DAEMON, `payload.model: ${model}`);
      logger.info(LOG_MODULES.DAEMON, `payload.apiKey present: ${!!apiKey}`);
      logger.info(LOG_MODULES.DAEMON, `payload.apiBaseUrl: ${apiBaseUrl || 'none'}`);
      logger.info(LOG_MODULES.DAEMON, `payload.env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
      logger.info(LOG_MODULES.DAEMON, `payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
      logger.info(LOG_MODULES.DAEMON, `payload.workspacePath: ${payload.workspacePath}`);
      logger.info(LOG_MODULES.DAEMON, `payload.projectPath: ${payload.projectPath}`);

      const onEvent = (event: AgentEvent) => {
        logger.info(LOG_MODULES.AGENT, `Event received: ${event.type} - ${event.content?.substring(0, 50) || event.tool || event.message?.substring(0, 50)}`);
        this.postEvent(payload, [event]).catch(err => {
          this.server.log.warn({ taskId, event: event.type, error: err }, 'Failed to post event');
        });
      };

      // ========== PHASE 1: 构建环境 ==========
      onEvent({
        type: 'phase_start',
        phase: 'building',
        message: '开始构建环境...',
        timestamp: new Date().toISOString(),
      });

      logger.info(LOG_MODULES.DAEMON, 'Step 1: Building environment...');
      buildResult = await this.envFactory.build(payload, (msg) => {
        onEvent({
          type: 'log_chunk',
          content: msg,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      }, engine);
      const { workspacePath, agent: resolvedAgent, instruction: resolvedInstruction, commandTemplate } = buildResult;

      onEvent({
        type: 'phase_complete',
        phase: 'building',
        success: true,
        message: `环境构建完成: ${workspacePath}`,
        timestamp: new Date().toISOString(),
      });

      logger.info(LOG_MODULES.DAEMON, `Step 1 DONE: workspacePath=${workspacePath}`);
      logger.info(LOG_MODULES.DAEMON, `Step 1 DONE: resolvedAgent=${resolvedAgent}`);
      logger.info(LOG_MODULES.DAEMON, `Step 1 DONE: resolvedInstruction="${resolvedInstruction?.substring(0, 100)}..." (len=${resolvedInstruction?.length})`);
      logger.info(LOG_MODULES.DAEMON, `Step 1 DONE: commandTemplate="${commandTemplate?.substring(0, 100)}..."`);
      this.server.log.info({ taskId, workspace: workspacePath, agent }, 'Workspace built');

      // ========== PHASE 1.5: Codedmap 知识图谱预处理（与 Agent 并行） ==========
      if (payload.targetProduct) {
        logger.info(LOG_MODULES.DAEMON, `Step 1.5: Codedmap preprocessing (parallel) for targetProduct=${payload.targetProduct}`);
        onEvent({
          type: 'phase_start',
          phase: 'codedmap',
          message: `知识图谱预处理启动（后台并行）: ${payload.targetProduct}`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
        codedmapPromise = this.codedmapMgr.ensureDbFile(workspacePath, payload.targetProduct, (event) => {
          onEvent({
            ...event,
          });
        }).then(() => {
          logger.info(LOG_MODULES.DAEMON, `Codedmap preprocessing completed for ${payload.targetProduct}`);
        }).catch((codedmapErr: unknown) => {
          const errMsg = codedmapErr instanceof Error ? codedmapErr.message : String(codedmapErr);
          logger.error(LOG_MODULES.DAEMON, `Codedmap preprocessing failed: ${errMsg}`);
          onEvent({
            type: 'phase_complete',
            phase: 'codedmap',
            success: false,
            message: `知识图谱预处理失败（Agent 可继续执行）: ${errMsg}`,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        });
      }

      // agentName: resolved from opencode.json > payload.agent > fallback 'build'
      const agentName = resolvedAgent || agent || 'build';

      // Use instruction directly - environment.ts already handled the short instruction case
      const instruction = resolvedInstruction || payload.instruction || '执行任务';

      logger.info(LOG_MODULES.DAEMON, 'Step 2: Preparing agent config...');
      logger.info(LOG_MODULES.DAEMON, `engine: ${engine}`);
      logger.info(LOG_MODULES.AGENT, `agentName: ${agentName}`);
      logger.info(LOG_MODULES.DAEMON, `final instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
      this.server.log.info({ taskId, agentName, engine, instructionLength: instruction?.length }, 'Using agent');

      // ========== PHASE 2: 执行任务 ==========
      onEvent({
        type: 'phase_start',
        phase: 'executing',
        message: `通过 ${engine} 执行 Agent: ${agentName}`,
        timestamp: new Date().toISOString(),
      });
      onEvent({
        type: 'log_chunk',
        content: `[Worker] 执行模式: engine=${engine}, agent=${agentName}, instruction="${instruction?.substring(0, 60)}..."`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      logger.info(LOG_MODULES.AGENT, `Step 3: Starting agent via ${engine}...`);
      logger.info(LOG_MODULES.AGENT, `Calling processMgr.runAgent with:`);
      logger.info(LOG_MODULES.AGENT, `  - workspacePath: ${workspacePath}`);
      logger.info(LOG_MODULES.AGENT, `  - engine: ${engine}`);
      logger.info(LOG_MODULES.AGENT, `  - agentName: ${agentName}`);
      logger.info(LOG_MODULES.AGENT, `  - model: ${model}`);
      logger.info(LOG_MODULES.AGENT, `  - instruction: "${instruction}"`);
      this.server.log.info({ taskId, engine, agentName }, 'Starting agent');

      const result = await this.processMgr.runAgent(
        taskId,
        workspacePath,
        engine,
        agentName,
        apiKey,
        model,
        env,
        instruction,
        onEvent,
        apiBaseUrl,
        taskTimeoutMs
      );
      logger.info(LOG_MODULES.AGENT, 'Step 3 DONE: runAgent returned');

      logger.info(LOG_MODULES.DAEMON, 'Step 4: Execution completed');
      logger.info(LOG_MODULES.DAEMON, `exitCode: ${result.exitCode}`);
      logger.info(LOG_MODULES.DAEMON, `stdout length: ${result.stdout.length}`);
      logger.info(LOG_MODULES.DAEMON, `stderr length: ${result.stderr.length}`);
      logger.info(LOG_MODULES.DAEMON, `stdout preview: "${result.stdout.substring(0, 200)}..."`);
      logger.info(LOG_MODULES.DAEMON, `stderr preview: "${result.stderr.substring(0, 200)}..."`);
      this.server.log.info({ taskId, exitCode: result.exitCode, stdoutLen: result.stdout.length }, 'Agent execution completed');

      let isCancelled = this.cancelledTasks.has(taskId);
      let status: TaskResultStatus;
      let reportContent: string | undefined;
      let error: string | undefined;

      if (isCancelled) {
        status = 'failed';
        error = 'Task cancelled by user';
      } else if (result.exitCode !== 0) {
        const auditReport = findAuditReportCandidate(workspacePath);
        if (auditReport) {
          await this.processMgr.terminate(taskId);
          status = 'completed';
          reportContent = this.collectReport(workspacePath);
        } else {
          status = 'failed';
          error = REPORT_NOT_GENERATED_ERROR;
        }
      } else {
        onEvent({
          type: 'phase_start',
          phase: 'report_waiting',
          message: '等待 Report/AUDIT_REPORT.* 生成',
          timestamp: new Date().toISOString(),
          level: 'worker',
        });

        const auditReport = await this.waitForAuditReport(taskId, workspacePath, taskStartTime, taskTimeoutMs, onEvent);
        if (this.cancelledTasks.has(taskId)) {
          isCancelled = true;
          status = 'failed';
          error = 'Task cancelled by user';
        } else if (auditReport) {
          await this.processMgr.terminate(taskId);
          status = 'completed';
          reportContent = this.collectReport(workspacePath);
          onEvent({
            type: 'phase_complete',
            phase: 'report_waiting',
            success: true,
            message: '已检测到稳定的 Report/AUDIT_REPORT.*',
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        } else {
          status = 'failed';
          error = REPORT_NOT_GENERATED_ERROR;
          onEvent({
            type: 'phase_complete',
            phase: 'report_waiting',
            success: false,
            message: REPORT_NOT_GENERATED_ERROR,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        }
      }

      // ========== PHASE COMPLETE: 执行任务 ==========
      onEvent({
        type: 'phase_complete',
        phase: 'executing',
        success: status === 'completed',
        message: isCancelled ? '任务已取消' : (status === 'completed' ? '任务执行完成' : `任务执行失败: exitCode=${result.exitCode}`),
        timestamp: new Date().toISOString(),
      });

      // ========== stderr 兜底：推送未被实时分类捕获的剩余内容 ==========
      // 实时 stderr 分类已在 ProcessManager.registerEventHandlers.stderr 中处理（进程崩溃、速率限制、认证、配额、网络）
      // 这里只推送 status=failed 时未被实时覆盖的兜底 stderr
      if (!isCancelled && result.stderr && status === 'failed') {
        const alreadyHandledPatterns = /Rate limit exceeded|FreeUsageLimitError|HTTP.*429|status.*429|429[ :]|AuthenticationError|API key.*invalid|HTTP.*401|status.*401|401[ :]|unauthorized|quota exceeded|ECONNREFUSED|ENOTFOUND|timeout.*exceeded|process exited with|terminated by signal|Failed to write to process stdin/i;
        const remainingLines = result.stderr.split('\n')
          .filter(line => line.trim())
          .filter(line => !alreadyHandledPatterns.test(line));

        if (remainingLines.length > 0) {
          onEvent({
            type: 'error',
            message: `未分类的 stderr 输出 (exitCode=${result.exitCode}): ${remainingLines.join('\n').substring(0, 500)}`,
            level: 'worker',
            stream: 'stderr',
            timestamp: new Date().toISOString(),
          });
        }
      } else if (status === 'failed' && !isCancelled && !result.stderr) {
        onEvent({
          type: 'error',
          message: `任务执行失败，进程退出码: ${result.exitCode}`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      }

      this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status,
        result: isCancelled ? undefined : (result.stdout || undefined),
        error: isCancelled ? 'Task cancelled by user' : error,
        reportContent: isCancelled ? undefined : reportContent,
      }).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'postResult (success path) failed (non-blocking)');
      });
    } catch (error) {
      const isCancelled = this.cancelledTasks.has(taskId);
      const errorMsg = isCancelled ? 'Task cancelled by user' : (error instanceof Error ? error.message : String(error));
      this.server.log.error({ taskId, error, isCancelled }, 'Task failed');

      // 推送 error 事件到 Orchestrator（catch 块中 onEvent 不可访问，直接用 postEvent）
      this.postEvent(payload, [{
        type: 'error',
        message: errorMsg,
        timestamp: new Date().toISOString(),
        level: 'worker',
      }]).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'Failed to post error event from catch block');
      });

      this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status: 'failed',
        error: errorMsg,
      }).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'postResult (error path) failed (non-blocking)');
      });
    } finally {
      this.cancelledTasks.delete(taskId);
      // Codedmap is fully async — do NOT await it here.
      // Errors are handled inside the promise chain (lines 232-243).
      // NFS passthrough mode skips cleanup anyway, so no risk of
      // deleting files while codedmap is still writing.
      if (buildResult) {
        await this.envFactory.cleanup(buildResult.workspacePath);
      }
      await this.processMgr.terminate(taskId);
    }
  }

  private async waitForAuditReport(
    taskId: string,
    workspacePath: string,
    taskStartTime: number,
    taskTimeoutMs: number,
    onEvent: (event: AgentEvent) => void,
  ): Promise<AuditReportCandidate | null> {
    const pollIntervalMs = getReportPollIntervalMs();
    const deadline = taskStartTime + taskTimeoutMs;
    let previous = findAuditReportCandidate(workspacePath);

    if (previous) {
      onEvent({
        type: 'log_chunk',
        content: `[Worker] 检测到 AUDIT_REPORT，等待文件写入稳定: ${path.basename(previous.filePath)}`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    }

    while (Date.now() < deadline && !this.cancelledTasks.has(taskId)) {
      const delayMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            clearInterval(interval);
            resolve();
          }, delayMs);
          const interval = setInterval(() => {
            if (this.cancelledTasks.has(taskId)) {
              clearTimeout(timeout);
              clearInterval(interval);
              resolve();
            }
          }, 1000);
        });
      }

      if (this.cancelledTasks.has(taskId)) {
        return null;
      }

      const current = findAuditReportCandidate(workspacePath);
      if (isSameAuditReportCandidate(previous, current)) {
        return current;
      }

      previous = current;
      onEvent({
        type: 'log_chunk',
        content: current
          ? `[Worker] AUDIT_REPORT 仍在变化，${Math.round(pollIntervalMs / 1000)}秒后继续检查`
          : `[Worker] 未发现 AUDIT_REPORT，${Math.round(pollIntervalMs / 1000)}秒后继续检查`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    }

    return null;
  }

  /** Read security report files from the workspace. */
  private collectReport(workspace: string): string | undefined {
    const reportDir = path.join(workspace, 'Report');
    const reportFileExts = [ '.json','.md'];
    
    if (!fs.existsSync(reportDir) || !fs.statSync(reportDir).isDirectory()) {
      return undefined;
    }
    
    try {
      const entries = fs.readdirSync(reportDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!reportFileExts.includes(ext)) continue;
        const filePath = path.join(reportDir, entry.name);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim().length > 0) return content;
        } catch { continue; }
      }
    } catch { /* ignore */ }
    
    return undefined;
  }

  private async postEvent(payload: TaskPayload, events: unknown[]): Promise<void> {
    const callbackUrl = this.getCallbackUrl(payload);
    const maxRetries = 3;
    const retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${callbackUrl}/api/codeswarm/worker/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: payload.taskId, nodeId: this.config.nodeId, events }),
          signal: AbortSignal.timeout(10000),
        });
        
        if (response.ok) {
          this.server.log.debug({ taskId: payload.taskId, eventCount: events.length }, 'Events posted');
          return;
        }
        
        this.server.log.warn({ taskId: payload.taskId, status: response.status, attempt }, 'Event post failed');
      } catch (err) {
        this.server.log.warn({ taskId: payload.taskId, error: err, attempt, callbackUrl }, 'Event post error');
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }

    this.server.log.error({ taskId: payload.taskId }, 'Event post failed after all retries');
  }

  private async postResult(payload: TaskPayload, result: {
    taskId: string;
    nodeId: string;
    status: TaskResultStatus;
    result?: string;
    error?: string;
    reportContent?: string;
  }): Promise<void> {
    const callbackUrl = this.getCallbackUrl(payload);
    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(`${callbackUrl}/api/codeswarm/worker/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(30000),
        });

        if (resp.ok) {
          this.server.log.info({ taskId: result.taskId, attempt }, 'Result posted successfully');
          return;
        }

        this.server.log.warn({ taskId: result.taskId, status: resp.status, attempt }, 'Result post failed');
      } catch (err) {
        this.server.log.error({ taskId: result.taskId, error: err, attempt }, 'Result post error');
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }

    this.server.log.error({ taskId: result.taskId }, 'Result post failed after all retries');
  }

}
