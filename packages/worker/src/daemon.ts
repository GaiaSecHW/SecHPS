import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger, LOG_MODULES, startLogArchive, setTaskLogFile, clearTaskLogFile } from './logger.js';
import {
  TaskPayloadSchema,
  type TaskPayload,
  type TaskResultStatus,
} from '@codeswarm/types';
import { EnvironmentFactory } from './environment.js';
import { ProcessManager, type AgentEvent } from './process-manager.js';
import { Semaphore } from './semaphore.js';


interface WorkerDaemonConfig {
  nodeId: string;
  port: number;
  maxConcurrent: number;
  schedulerUrl: string;
  /** Worker 外部可达地址（跨服务器部署时必须设置，否则心跳上报自动检测的容器内网 IP + localhost） */
  address?: string;
  workerToken?: string;
  /** 单任务超时时间（毫秒），默认 7*24*3600*1000 = 7天，可通过 TASK_TIMEOUT_SEC 环境变量配置 */
  taskTimeoutMs: number;
  /** 优雅关闭超时（毫秒），默认 300000 = 5分钟 */
  gracefulShutdownTimeoutMs: number;
}

/**
 * 向 AIGW 网关请求 work-key，返回 secret 作为虚拟 API Key。
 * 环境变量 AIGW_WORK_KEYS_URL 控制开关（未设置则跳过，返回原始 apiKey）。
 * 失败直接抛错，任务标记为 failed。
 */
interface WorkKeyResult {
  apiKey: string;
  skipped: boolean;
  reason?: string;
}

async function resolveWorkKey(
  apiKey: string,
  taskId: string,
  agentName: string,
): Promise<WorkKeyResult> {
  const gatewayUrl = process.env.AIGW_WORK_KEYS_URL;
  if (!gatewayUrl) {
    logger.warn(LOG_MODULES.DAEMON, '[resolveWorkKey] AIGW_WORK_KEYS_URL 未配置，请提供虚拟 key 网关 URL');
    return { apiKey, skipped: true, reason: '请提供虚拟 key 网关 URL' };
  }

  const endpoint = `${gatewayUrl}/api/aigw/work-keys`;
  const body = JSON.stringify({
    key_name: taskId,
    sub_task_id: agentName,
    max_concurrency: 0,
    enabled: true,
    description: `work key for ${taskId}/${agentName}`,
  });

  logger.info(LOG_MODULES.DAEMON, `[WorkKey] Requesting work-key from ${endpoint}, key_name=${taskId}, sub_task_id=${agentName}`);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AIGW work-key 请求失败: ${msg} (endpoint: ${endpoint})`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AIGW work-key 请求失败: HTTP ${response.status} - ${text.substring(0, 300)} (endpoint: ${endpoint})`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`AIGW work-key 响应解析失败: 非 JSON 格式`);
  }

  const secret: string | undefined = data?.secret;
  if (!secret) {
    throw new Error(`AIGW work-key 响应中缺少 secret: ${JSON.stringify(data).substring(0, 300)}`);
  }

  logger.info(LOG_MODULES.DAEMON, `[WorkKey] Got work-key successfully for ${taskId}/${agentName}`);
  return { apiKey: secret, skipped: false };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return error;
}

function buildAgentFailureReason(exitCode: number, stderr: string): string {
  if (exitCode === 124) {
    const permissionPromptPattern = /permission(?:=|\s).*?(?:external_directory|asked)|permission\.asked|external_directory.*?asking/i;
    if (permissionPromptPattern.test(stderr)) {
      return '任务超时：Agent 请求交互式权限确认，Worker 非交互环境无法确认';
    }
    return '任务超时：Agent 执行超过任务 timeoutSec 限制';
  }

  return `任务执行失败，进程退出码: ${exitCode}`;
}

export class WorkerDaemon {
  private readonly config: WorkerDaemonConfig;
  private readonly server: FastifyInstance;
  private readonly envFactory: EnvironmentFactory;
  private readonly processMgr: ProcessManager;
  private readonly semaphore: Semaphore;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatFailCount = 0;
  private heartbeatInProgress = false;
  private lastHeartbeatLogState: {
    activeTaskIds: string[];
    failed: boolean;
  } | null = null;
  private static readonly HEARTBEAT_RETRY_DELAYS = [1000, 2000, 4000, 8000];
  private static readonly HEARTBEAT_MAX_FAIL_WARN = 5;
  /** Track task IDs currently being executed to prevent duplicate processing. */
  private readonly activeTasks = new Map<string, TaskPayload>();
  /** Track task IDs cancelled via /task/cancel to avoid duplicate result posts. */
  private readonly cancelledTasks = new Set<string>();
  private workerToken?: string;
  /** Draining mode — stop accepting new tasks, wait for active ones to complete */
  private draining = false;

  constructor(config: WorkerDaemonConfig) {
    this.config = config;
    this.workerToken = config.workerToken;
    this.server = Fastify({ logger: true });
    this.envFactory = new EnvironmentFactory();
    this.processMgr = new ProcessManager();
    this.semaphore = new Semaphore(config.maxConcurrent);

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
        // `which` 仅 Unix 可用，Windows cmd.exe 没有 `which`（对应 `where`），
        // 且 `2>/dev/null` 在 cmd 下也是非法重定向。否则即便二进制已安装且
        // cross-spawn 能正常拉起，checkBinaries 在 Windows 上也永远误报 NOT found。
        const checker = process.platform === 'win32' ? 'where' : 'which';
        const resolved = execSync(`${checker} ${binary}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim().split('\n')[0].trim();
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

      // Reject new tasks when draining (HPA scale-down)
      if (this.draining) {
        this.semaphore.release();
        return reply.status(503).send({ error: 'Worker draining, not accepting new tasks' });
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
          // Fallback: only release if executeTask didn't release early after postResult
          // (e.g. executeTask threw before reaching postResult)
          if (this.activeTasks.has(payload.taskId)) {
            this.activeTasks.delete(payload.taskId);
            this.semaphore.release();
          }
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

    this.server.post('/config', async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (this.workerToken && authHeader !== `Bearer ${this.workerToken}`) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as { maxConcurrentOverride?: number };
      if (typeof body.maxConcurrentOverride !== 'number' || !Number.isFinite(body.maxConcurrentOverride)) {
        return reply.status(400).send({ error: 'Invalid maxConcurrentOverride' });
      }

      const nextMax = Math.max(1, Math.min(50, Math.floor(body.maxConcurrentOverride)));
      const currentMax = this.semaphore.max;
      if (nextMax !== currentMax) {
        this.semaphore.resize(nextMax);
        this.server.log.info(
          { previousMax: currentMax, newMax: nextMax },
          'maxConcurrent adjusted via push config'
        );
      }
      return reply.send({ success: true, maxConcurrent: this.semaphore.max });
    });

    // Cancel task endpoint
    this.server.post('/task/cancel', async (request, reply) => {
      const body = request.body as { taskId?: string };
      const taskId = body?.taskId;

      if (!taskId) {
        return reply.status(400).send({ error: 'Missing taskId' });
      }

      this.server.log.info({ taskId }, 'Received cancel request');

      // 始终标记为已取消，即使任务还未进入 activeTasks（排队中等 Worker 接受）
      // executeTask 入口会检查此标记并提前退出
      this.cancelledTasks.add(taskId);

      // 如果任务正在执行，终止其进程
      const payload = this.activeTasks.get(taskId);
      if (payload) {
        try {
          await this.processMgr.terminate(taskId);
          this.server.log.info({ taskId }, 'Process terminated successfully');
        } catch (err) {
          this.server.log.warn({ taskId, error: err }, 'Terminate failed, but will continue cleanup');
        }
      } else {
        this.server.log.info({ taskId }, 'Task not yet active — marked as cancelled, will be skipped on pickup');
      }

      this.server.log.info({ taskId }, 'Task marked as cancelled, executeTask will handle cleanup');
      return reply.status(200).send({ taskId, message: 'Task cancelled successfully' });
    });

    await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
    this.checkBinaries();
    this.startHeartbeat();
    startLogArchive();
    this.server.log.info({ config: this.config }, 'Worker daemon started');
    logger.info(LOG_MODULES.DAEMON, `\n${'='.repeat(50)}`);
    logger.info(LOG_MODULES.DAEMON, `  Worker Node: ${this.config.nodeId}`);
    logger.info(LOG_MODULES.DAEMON, `  Port: ${this.config.port}`);
    logger.info(LOG_MODULES.DAEMON, `  Max Concurrent: ${this.config.maxConcurrent}`);
    logger.info(LOG_MODULES.DAEMON, `  Scheduler: ${this.config.schedulerUrl}`);
    logger.info(LOG_MODULES.DAEMON, `${'='.repeat(50)}\n`);
  }

  async stop(): Promise<void> {
    logger.info(LOG_MODULES.DAEMON, `Graceful shutdown initiated, active tasks: ${this.activeTasks.size}`);

    // 1. Enter draining mode — heartbeat will report status='draining'
    this.draining = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatRetryTimer) {
      clearTimeout(this.heartbeatRetryTimer);
      this.heartbeatRetryTimer = null;
    }

    // 2. Wait for active tasks to complete or timeout
    const activeCount = this.activeTasks.size;
    if (activeCount > 0) {
      logger.info(LOG_MODULES.DAEMON, `Waiting for ${activeCount} active tasks to complete (timeout: ${this.config.gracefulShutdownTimeoutMs}ms)...`);
      const deadline = Date.now() + this.config.gracefulShutdownTimeoutMs;

      while (this.activeTasks.size > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        logger.info(LOG_MODULES.DAEMON, `Draining: ${this.activeTasks.size} tasks remaining`);
      }

      // 3. Force-fail remaining tasks after timeout
      if (this.activeTasks.size > 0) {
        logger.warn(LOG_MODULES.DAEMON, `Timeout reached, force-failing ${this.activeTasks.size} remaining tasks`);
        for (const [taskId, payload] of this.activeTasks) {
          try {
            await this.postResult(payload, {
              taskId,
              nodeId: this.config.nodeId,
              status: 'failed',
              error: 'Worker shutting down, task interrupted after graceful timeout',
            });
          } catch (e) {
            logger.error(LOG_MODULES.DAEMON, `Failed to notify scheduler for task ${taskId}:`, e);
          }
          try {
            await this.processMgr.terminate(taskId);
          } catch {
            // Process may already be dead
          }
          this.activeTasks.delete(taskId);
          this.semaphore.release();
        }
      }
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
          const hadFailures = this.heartbeatFailCount > 0;
          this.heartbeatFailCount = 0;
          if (this.heartbeatRetryTimer) {
            clearTimeout(this.heartbeatRetryTimer);
            this.heartbeatRetryTimer = null;
          }
          if (hadFailures) {
            const activeTaskIds = [...this.activeTasks.keys()];
            this.server.log.info(
              { activeTaskIds, count: activeTaskIds.length },
              `Heartbeat recovered | nodeId=${this.config.nodeId} | active: [${activeTaskIds.join(', ')}]`
            );
            this.lastHeartbeatLogState = { activeTaskIds, failed: false };
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
    
    this.lastHeartbeatLogState = { activeTaskIds: [...this.activeTasks.keys()], failed: true };

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.workerToken) headers.Authorization = `Bearer ${this.workerToken}`;

      const resp = await fetch(`${this.config.schedulerUrl}/api/codeswarm/worker/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          maxConcurrent: currentMax,
          currentTasks: currentMax - this.semaphore.available,
          address,
          systemType,
          arch,
          status: this.draining ? 'draining' : 'online',
        }),
        signal: AbortSignal.timeout(5000),
      });
      
      if (resp.ok) {
        try {
          const data = await resp.json() as { maxConcurrentOverride?: number; token?: string };
          if (typeof data.token === 'string' && data.token) {
            this.workerToken = data.token;
          }
          if (typeof data.maxConcurrentOverride === 'number' && data.maxConcurrentOverride !== currentMax) {
            this.semaphore.resize(data.maxConcurrentOverride);
            this.server.log.info(
              { previousMax: currentMax, newMax: data.maxConcurrentOverride },
              `maxConcurrent dynamically adjusted via server override`
            );
          }
        } catch { /* non-critical: heartbeat succeeded, response body parsing optional */ }

        const activeTaskIds = [...this.activeTasks.keys()];
        const activeTasksChanged = !this.lastHeartbeatLogState
          || this.lastHeartbeatLogState.failed
          || activeTaskIds.length !== this.lastHeartbeatLogState.activeTaskIds.length
          || activeTaskIds.some((taskId, index) => taskId !== this.lastHeartbeatLogState?.activeTaskIds[index]);

        if (activeTasksChanged) {
          this.server.log.info(
            { activeTaskIds, count: activeTaskIds.length },
            `Heartbeat OK | nodeId=${this.config.nodeId} | active: [${activeTaskIds.join(', ')}]`
          );
          this.lastHeartbeatLogState = { activeTaskIds, failed: false };
        }
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
    return payload.callbackUrl || this.config.schedulerUrl;
  }

  private async executeTask(payload: TaskPayload): Promise<void> {
    const { taskId, engine: payloadEngine, agent, apiKey, model, apiBaseUrl, env, timeoutSec } = payload;
    const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
    const taskTimeoutMs = timeoutSec ? timeoutSec * 1000 : this.config.taskTimeoutMs;
    let buildResult = null;

    await setTaskLogFile(taskId);
    try {
      // 早期取消检查：任务在排队/分发阶段已被 /task/cancel 标记
      if (this.cancelledTasks.has(taskId)) {
        logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Task cancelled before execution started — reporting failure`);
        await this.postResult(payload, {
          taskId,
          nodeId: this.config.nodeId,
          status: 'failed',
          error: 'Task cancelled by user',
        }).catch(err => {
          this.server.log.warn({ taskId, error: err }, 'postResult (early cancel) failed');
        });
        // 主动释放槽位（与 success/error 路径一致），避免依赖外层 finally 兜底
        if (this.activeTasks.has(taskId)) {
          this.activeTasks.delete(taskId);
          this.semaphore.release();
          logger.taskInfo(taskId, LOG_MODULES.DAEMON, `[Semaphore] Released after postResult (early cancel)`);
        }
        return; // finally 块会清理 cancelledTasks
      }

      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `========== TASK START [${this.config.nodeId}:${taskId}] ==========`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `[${this.config.nodeId}] taskId: ${taskId}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.engine: ${payloadEngine}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `payload.agent: ${agent}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.model: ${model}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.apiKey present: ${!!apiKey}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.apiBaseUrl: ${apiBaseUrl || 'none'}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.workspacePath: ${payload.workspacePath}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `payload.INPUT_DIR: ${env?.INPUT_DIR || 'none'}`);

      const onEvent = (event: AgentEvent) => {
        logger.taskInfo(taskId, LOG_MODULES.AGENT, `Event received: ${event.type} - ${event.content?.substring(0, 50) || event.tool || event.message?.substring(0, 50)}`);
        this.postEvent(payload, [event]).catch(err => {
          this.server.log.warn({ taskId, event: event.type, error: err }, 'Failed to post event');
        });
      };

      onEvent({
        type: 'task_started',
        message: 'Worker started task execution',
        timestamp: new Date().toISOString(),
      });

      // ========== PHASE 0.5: 动态获取虚拟 API Key（在构建环境之前，确保 secret 写入 opencode.json） ==========
      if (apiKey) {
        onEvent({
          type: 'phase_start',
          phase: 'workkey',
          message: '正在获取虚拟 API Key...',
          timestamp: new Date().toISOString(),
        });
        const workKeyResult = await resolveWorkKey(apiKey, taskId, payload.toolId || agent || 'default');
        // 覆盖 payload.apiKey，后续 envFactory.build 和 runAgent 都使用 secret
        (payload as any).apiKey = workKeyResult.apiKey;
        logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Work key resolved, skipped=${workKeyResult.skipped}, apiKey=${workKeyResult.skipped ? '(original)' : '(wsk_*)'}`);
        onEvent({
          type: 'phase_complete',
          phase: 'workkey',
          success: !workKeyResult.skipped,
          message: workKeyResult.skipped
            ? `虚拟 API Key 获取跳过: ${workKeyResult.reason || '未配置'}`
            : '虚拟 API Key 获取成功',
          timestamp: new Date().toISOString(),
        });
      }

      // ========== PHASE 1: 构建环境 ==========
      onEvent({
        type: 'phase_start',
        phase: 'building',
        message: '开始构建环境...',
        timestamp: new Date().toISOString(),
      });

      logger.taskInfo(taskId, LOG_MODULES.DAEMON, 'Step 1: Building environment...');
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

      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Step 1 DONE: workspacePath=${workspacePath}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Step 1 DONE: resolvedAgent=${resolvedAgent}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Step 1 DONE: resolvedInstruction="${resolvedInstruction?.substring(0, 100)}..." (len=${resolvedInstruction?.length})`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Step 1 DONE: commandTemplate="${commandTemplate?.substring(0, 100)}..."`);
      this.server.log.info({ taskId, workspace: workspacePath, agent }, 'Workspace built');

      // agentName: resolved from opencode.json > payload.agent > fallback 'build'
      const agentName = resolvedAgent || agent || 'build';

      // Use instruction directly - environment.ts already handled the short instruction case
      const instruction = resolvedInstruction || payload.instruction || '执行任务';

      logger.taskInfo(taskId, LOG_MODULES.DAEMON, 'Step 2: Preparing agent config...');
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `engine: ${engine}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `agentName: ${agentName}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `final instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
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
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `Step 3: Starting agent via ${engine}...`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `Calling processMgr.runAgent with:`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `  - workspacePath: ${workspacePath}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `  - engine: ${engine}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `  - agentName: ${agentName}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `  - model: ${model}`);
      logger.taskInfo(taskId, LOG_MODULES.AGENT, `  - instruction: "${instruction}"`);
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
      logger.taskInfo(taskId, LOG_MODULES.AGENT, 'Step 3 DONE: runAgent returned');

      logger.taskInfo(taskId, LOG_MODULES.DAEMON, 'Step 4: Execution completed');
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `exitCode: ${result.exitCode}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `stdout length: ${result.stdout.length}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `stderr length: ${result.stderr.length}`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `stdout preview: "${result.stdout.substring(0, 200)}..."`);
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `stderr preview: "${result.stderr.substring(0, 200)}..."`);
      this.server.log.info({ taskId, exitCode: result.exitCode, stdoutLen: result.stdout.length }, 'Agent execution completed');

      const isCancelled = this.cancelledTasks.has(taskId);
      let status: TaskResultStatus;
      let error: string | undefined;

      if (isCancelled) {
        status = 'failed';
        error = 'Task cancelled by user';
      } else if (result.exitCode !== 0) {
        status = 'failed';
        error = buildAgentFailureReason(result.exitCode, result.stderr);
      } else {
        status = 'completed';
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

      // Await postResult before releasing the slot: if we fire-and-forget, a
      // transient network blip leaves Scheduler believing the task is still
      // running while the Worker has already freed the slot — state drift.
      // postResult already retries internally; awaiting guarantees ordering.
      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status,
        result: isCancelled ? undefined : (result.stdout || undefined),
        error: isCancelled ? 'Task cancelled by user' : error,
      }).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'postResult (success path) failed');
      });

      // Release only after result is reported (or retries exhausted).
      // Ensures Worker semaphore count stays in sync with DB currentTasks,
      // preventing heartbeat GREATEST from clobbering a decremented DB value.
      if (this.activeTasks.has(taskId)) {
        this.activeTasks.delete(taskId);
        this.semaphore.release();
        logger.taskInfo(taskId, LOG_MODULES.DAEMON, `[Semaphore] Released after postResult (success path)`);
      }
    } catch (error) {
      const isCancelled = this.cancelledTasks.has(taskId);
      const errorMsg = isCancelled ? 'Task cancelled by user' : (error instanceof Error ? error.message : String(error));
      this.server.log.error({ taskId, error: serializeError(error), isCancelled }, 'Task failed');

      // 推送 error 事件到 Orchestrator（catch 块中 onEvent 不可访问，直接用 postEvent）
      this.postEvent(payload, [{
        type: 'error',
        message: errorMsg,
        timestamp: new Date().toISOString(),
        level: 'worker',
      }]).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'Failed to post error event from catch block');
      });

      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status: 'failed',
        error: errorMsg,
      }).catch(err => {
        this.server.log.warn({ taskId, error: err }, 'postResult (error path) failed');
      });

      // Release only after failure result is reported (or retries exhausted).
      if (this.activeTasks.has(taskId)) {
        this.activeTasks.delete(taskId);
        this.semaphore.release();
        logger.taskInfo(taskId, LOG_MODULES.DAEMON, `[Semaphore] Released after postResult (error path)`);
      }
    } finally {
      clearTaskLogFile(taskId);
      this.cancelledTasks.delete(taskId);
      // 不在此清理工作区：Tool 任务的 run 产物需保留供调用方取回；
      // NFS/外部 workspacePath 本就由宿主管理。磁盘回收交由上层统一处理。
      await this.processMgr.terminate(taskId);
    }
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
