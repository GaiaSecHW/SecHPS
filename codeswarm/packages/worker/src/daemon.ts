import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
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

interface WorkerDaemonConfig {
  nodeId: string;
  port: number;
  maxConcurrent: number;
  orchestratorUrl: string;
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
      maxConcurrent: this.config.maxConcurrent,
    }));

    // Root info
    this.server.get('/', async () => ({
      service: 'codeswarm-worker',
      nodeId: this.config.nodeId,
      status: 'running',
      available: this.semaphore.available,
      maxConcurrent: this.config.maxConcurrent,
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
    // Ensure MinIO bucket exists at startup
    ensureBucket().catch(err => {
      this.server.log.warn({ error: err }, 'MinIO bucket check failed (non-fatal)');
    });
    this.server.log.info({ config: this.config }, 'Worker daemon started');
  }

  async stop(): Promise<void> {
    console.log(`[Daemon] Graceful shutdown initiated, active tasks: ${this.activeTasks.size}`);
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
      console.log(`[Daemon] Notifying platform of interrupted task: ${taskId}`);
      try {
        await this.postResult(payload, {
          taskId,
          nodeId: this.config.nodeId,
          status: 'failed',
          error: 'Worker daemon shutting down, task interrupted',
        });
      } catch (e) {
        console.error(`[Daemon] Failed to notify platform for task ${taskId}:`, e);
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
    console.log(`[Daemon] Graceful shutdown complete`);
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

  /** Get all local IPv4 addresses, excluding loopback. */
  private getLocalAddresses(): string[] {
    const addresses: string[] = [];
    const interfaces = os.networkInterfaces();
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          addresses.push(`${addr.address}:${this.config.port}`);
        }
      }
    }
    addresses.push(`localhost:${this.config.port}`);
    return [...new Set(addresses)];
  }

  private async sendHeartbeat(): Promise<boolean> {
    try {
      const addresses = this.getLocalAddresses();
      const systemType = os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'darwin' : 'linux';
      const arch = os.arch() === 'x64' ? 'x64' : os.arch() === 'arm64' ? 'arm64' : os.arch();
      const resp = await fetch(`${this.config.orchestratorUrl}/api/codeswarm/worker/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          maxConcurrent: this.config.maxConcurrent,
          currentTasks: this.config.maxConcurrent - this.semaphore.available,
          address: addresses.join(','),
          systemType,
          arch,
        }),
        signal: AbortSignal.timeout(5000),
      });
      
      if (resp.ok) {
        this.server.log.debug('Heartbeat 成功');
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
    const { taskId, engine: payloadEngine, agent, apiKey, model, apiBaseUrl, env } = payload;
    const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
    let buildResult = null;
    let codedmapPromise: Promise<void> | null = null;

    try {
      console.log(`[Daemon] ========== TASK START ==========`);
      console.log(`[Daemon] taskId: ${taskId}`);
      console.log(`[Daemon] payload.engine: ${payloadEngine}`);
      console.log(`[Daemon] payload.agent: ${agent}`);
      console.log(`[Daemon] payload.model: ${model}`);
      console.log(`[Daemon] payload.apiKey present: ${!!apiKey}`);
      console.log(`[Daemon] payload.env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
      console.log(`[Daemon] payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
      console.log(`[Daemon] payload.workspacePath: ${payload.workspacePath}`);
      console.log(`[Daemon] payload.projectPath: ${payload.projectPath}`);

      const onEvent = (event: AgentEvent) => {
        console.log(`[Daemon] Event received: ${event.type} - ${event.content?.substring(0, 50) || event.tool || event.message?.substring(0, 50)}`);
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

      console.log(`[Daemon] Step 1: Building environment...`);
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

      console.log(`[Daemon] Step 1 DONE: workspacePath=${workspacePath}`);
      console.log(`[Daemon] Step 1 DONE: resolvedAgent=${resolvedAgent}`);
      console.log(`[Daemon] Step 1 DONE: resolvedInstruction="${resolvedInstruction?.substring(0, 100)}..." (len=${resolvedInstruction?.length})`);
      console.log(`[Daemon] Step 1 DONE: commandTemplate="${commandTemplate?.substring(0, 100)}..."`);
      this.server.log.info({ taskId, workspace: workspacePath, agent }, 'Workspace built');

      // ========== PHASE 1.5: Codedmap 知识图谱预处理（与 Agent 并行） ==========
      if (payload.targetProduct) {
        console.log(`[Daemon] Step 1.5: Codedmap preprocessing (parallel) for targetProduct=${payload.targetProduct}`);
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
          console.log(`[Daemon] Codedmap preprocessing completed for ${payload.targetProduct}`);
        }).catch((codedmapErr: unknown) => {
          const errMsg = codedmapErr instanceof Error ? codedmapErr.message : String(codedmapErr);
          console.error(`[Daemon] Codedmap preprocessing failed: ${errMsg}`);
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

      console.log(`[Daemon] Step 2: Preparing agent config...`);
      console.log(`[Daemon] engine: ${engine}`);
      console.log(`[Daemon] agentName: ${agentName}`);
      console.log(`[Daemon] final instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
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
      console.log(`[Daemon] Step 3: Starting agent via ${engine}...`);
      console.log(`[Daemon] Calling processMgr.runAgent with:`);
      console.log(`[Daemon]   - workspacePath: ${workspacePath}`);
      console.log(`[Daemon]   - engine: ${engine}`);
      console.log(`[Daemon]   - agentName: ${agentName}`);
      console.log(`[Daemon]   - model: ${model}`);
      console.log(`[Daemon]   - instruction: "${instruction}"`);
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
        apiBaseUrl
      );
      console.log(`[Daemon] Step 3 DONE: runAgent returned`);

      console.log(`[Daemon] Step 4: Execution completed`);
      console.log(`[Daemon] exitCode: ${result.exitCode}`);
      console.log(`[Daemon] stdout length: ${result.stdout.length}`);
      console.log(`[Daemon] stderr length: ${result.stderr.length}`);
      console.log(`[Daemon] stdout preview: "${result.stdout.substring(0, 200)}..."`);
      console.log(`[Daemon] stderr preview: "${result.stderr.substring(0, 200)}..."`);
      this.server.log.info({ taskId, exitCode: result.exitCode, stdoutLen: result.stdout.length }, 'Agent execution completed');

      const reportContent = this.collectReport(workspacePath);

      const isCancelled = this.cancelledTasks.has(taskId);
      const status: TaskResultStatus = isCancelled ? 'failed' : (result.exitCode === 0 ? 'completed' : 'failed');

      // ========== PHASE COMPLETE: 执行任务 ==========
      onEvent({
        type: 'phase_complete',
        phase: 'executing',
        success: status === 'completed',
        message: isCancelled ? '任务已取消' : (status === 'completed' ? '任务执行完成' : `任务执行失败: exitCode=${result.exitCode}`),
        timestamp: new Date().toISOString(),
      });

      // ========== 推送 stderr 中的 LLM/API 错误事件 ==========
      // ACP 协议的 error handler 可能不会捕获 LLM rate limit 等错误，
      // 这些错误只在 opencode 进程的 stderr 中出现。解析并推送，确保前端可见。
      if (status === 'failed' && !isCancelled && result.stderr) {
        const LLM_ERROR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
          { pattern: /Rate limit exceeded/i, label: 'LLM 速率限制' },
          { pattern: /FreeUsageLimitError/i, label: 'LLM 用量限制' },
          { pattern: /429/i, label: 'HTTP 429 速率限制' },
          { pattern: /AuthenticationError/i, label: '认证错误' },
          { pattern: /API key.*invalid/i, label: 'API Key 无效' },
          { pattern: /quota exceeded/i, label: '配额超限' },
          { pattern: /ECONNREFUSED/i, label: '连接拒绝' },
          { pattern: /ENOTFOUND/i, label: '域名解析失败' },
          { pattern: /timeout.*exceeded/i, label: '超时' },
        ];

        const stderrLines = result.stderr.split('\n').filter(line => line.trim());
        const matchedLabels: string[] = [];

        for (const line of stderrLines) {
          for (const { pattern, label } of LLM_ERROR_PATTERNS) {
            if (pattern.test(line)) {
              onEvent({
                type: 'error',
                message: `[${label}] ${line.trim()}`,
                timestamp: new Date().toISOString(),
                level: 'worker',
              });
              matchedLabels.push(label);
              break;
            }
          }
        }

        // fallback: stderr 有内容但无已知模式
        if (matchedLabels.length === 0 && result.stderr.trim().length > 10) {
          onEvent({
            type: 'error',
            message: `任务执行失败 (exitCode=${result.exitCode}): ${result.stderr.substring(0, 500)}`,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        }
      } else if (status === 'failed' && !isCancelled && !result.stderr) {
        // fallback: stderr 为空但进程失败
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
        error: isCancelled ? 'Task cancelled by user' : (result.exitCode !== 0 ? result.stderr || `Process exited with code ${result.exitCode}` : undefined),
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

  /** Read security report files from the workspace. */
  private collectReport(workspace: string): string | undefined {
    const candidates = [
      path.join(workspace, 'reports.jsonl'),
      path.join(workspace, 'code', 'reports.jsonl'),
      path.join(workspace, '.security', 'reports.jsonl'),
      path.join(workspace, 'code', '.security', 'reports.jsonl'),
      path.join(workspace, '.security', 'report.md'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          return fs.readFileSync(candidate, 'utf-8');
        } catch {
          continue;
        }
      }
    }
    return undefined;
  }

  private async postEvent(payload: TaskPayload, events: unknown[]): Promise<void> {
    const callbackUrl = this.getCallbackUrl(payload);
    try {
      const response = await fetch(`${callbackUrl}/api/codeswarm/worker/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: payload.taskId, nodeId: this.config.nodeId, events }),
        signal: AbortSignal.timeout(10000),
      });
      
      if (!response.ok) {
        this.server.log.warn({ taskId: payload.taskId, status: response.status }, 'Event post failed');
      } else {
        this.server.log.debug({ taskId: payload.taskId, eventCount: events.length }, 'Events posted');
      }
    } catch (err) {
      this.server.log.warn({ taskId: payload.taskId, error: err, callbackUrl }, 'Failed to post events to platform');
    }
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
