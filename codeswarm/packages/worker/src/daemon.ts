import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  /** Track task IDs currently being executed to prevent duplicate processing. */
  private readonly activeTasks = new Map<string, TaskPayload>();

  constructor(config: WorkerDaemonConfig) {
    this.config = config;
    this.server = Fastify({ logger: true });
    this.envFactory = new EnvironmentFactory();
    this.processMgr = new ProcessManager();
    this.semaphore = new Semaphore(config.maxConcurrent);
    this.codedmapMgr = new CodedmapManager();
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

      // 1. Terminate the process (with force kill timeout)
      try {
        await this.processMgr.terminate(taskId);
        this.server.log.info({ taskId }, 'Process terminated successfully');
      } catch (err) {
        this.server.log.warn({ taskId, error: err }, 'Terminate failed, but will continue cleanup');
      }

      // 2. Notify platform that task was cancelled
      try {
        await this.postResult(payload, {
          taskId,
          nodeId: this.config.nodeId,
          status: 'failed',
          error: 'Task cancelled by user',
        });
      } catch (err) {
        this.server.log.warn({ taskId, error: err }, 'Failed to notify platform of cancellation');
      }

      // 3. Remove from active tasks and release semaphore
      this.activeTasks.delete(taskId);
      this.semaphore.release();

      this.server.log.info({ taskId }, 'Task cancelled and resources released');
      return reply.status(200).send({ taskId, message: 'Task cancelled successfully' });
    });

    await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
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
    // Send first heartbeat immediately
    this.sendHeartbeat();
    // Then every 30 seconds
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 30_000);
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
    // Always include localhost as fallback
    addresses.push(`localhost:${this.config.port}`);
    return [...new Set(addresses)];
  }

  private async sendHeartbeat(): Promise<void> {
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
      });
      if (!resp.ok) {
        this.server.log.warn({ status: resp.status }, 'Heartbeat failed');
      }
    } catch (err) {
      this.server.log.warn({ error: err }, 'Heartbeat request failed');
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

    // Mark task as active (for deduplication)
    this.activeTasks.set(taskId, payload);

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
            type: 'log_chunk',
            content: `[Codedmap] 知识图谱预处理失败（Agent 可继续执行）: ${errMsg}`,
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

      const status: TaskResultStatus = result.exitCode === 0 ? 'completed' : 'failed';

      // ========== PHASE COMPLETE: 执行任务 ==========
      onEvent({
        type: 'phase_complete',
        phase: 'executing',
        success: status === 'completed',
        message: status === 'completed' ? '任务执行完成' : `任务执行失败: exitCode=${result.exitCode}`,
        timestamp: new Date().toISOString(),
      });

      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status,
        result: result.stdout || undefined,
        error: result.exitCode !== 0 ? result.stderr || `Process exited with code ${result.exitCode}` : undefined,
        reportContent,
      });
    } catch (error) {
      this.server.log.error({ taskId, error }, 'Task failed');
      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
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
