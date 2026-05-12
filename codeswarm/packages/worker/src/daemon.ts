import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  TaskPayloadSchema,
  type TaskPayload,
  type TaskResultStatus,
} from '@codeswarm/types';
import { EnvironmentFactory } from './environment.js';
import { ProcessManager } from './process-manager.js';
import { Semaphore } from './semaphore.js';

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
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: WorkerDaemonConfig) {
    this.config = config;
    this.server = Fastify({ logger: true });
    this.envFactory = new EnvironmentFactory();
    this.processMgr = new ProcessManager();
    this.semaphore = new Semaphore(config.maxConcurrent);
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
      this.executeTask(payload)
        .catch(err => {
          this.server.log.error({ taskId: payload.taskId, error: err }, 'Task execution failed');
        })
        .finally(() => {
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

    await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
    this.startHeartbeat();
    this.server.log.info({ config: this.config }, 'Worker daemon started');
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.server.close();
  }

  private startHeartbeat(): void {
    // Send first heartbeat immediately
    this.sendHeartbeat();
    // Then every 30 seconds
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 30_000);
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const resp = await fetch(`${this.config.orchestratorUrl}/api/codeswarm/worker/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          maxConcurrent: this.config.maxConcurrent,
          currentTasks: this.config.maxConcurrent - this.semaphore.available,
          address: `localhost:${this.config.port}`,
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
    const { taskId, agent, startCommand } = payload;
    let workspace: string | null = null;

    try {
      // 1. Get workspace path (NFS passthrough or build)
      workspace = await this.envFactory.build(payload);
      this.server.log.info({ taskId, workspace }, 'Workspace ready');

      // 2. Run agent command in workspace based on agent type
      const agentType = agent || 'opencode';
      this.server.log.info({ taskId, agent: agentType, startCommand }, 'Starting agent execution');

      const result = await this.processMgr.runAgent(
        taskId,
        workspace,
        agentType,
        startCommand,
        payload.apiKey,
        payload.model,
        payload.env
      );

      this.server.log.info({ taskId, exitCode: result.exitCode, stdoutLen: result.stdout.length }, 'Agent execution completed');

      // 3. Collect security report if present
      const reportContent = this.collectReport(workspace);

      // 4. Report result
      const status: TaskResultStatus = result.exitCode === 0 ? 'completed' : 'failed';
      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status,
        result: result.stdout || result.stderr,
        error: result.exitCode !== 0 ? result.stderr : undefined,
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
      if (workspace) await this.envFactory.cleanup(workspace);
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
      await fetch(`${callbackUrl}/api/codeswarm/worker/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: payload.taskId, nodeId: this.config.nodeId, events }),
      });
    } catch {
      // Callback target not available, log and continue
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
    try {
      await fetch(`${callbackUrl}/api/codeswarm/worker/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
    } catch {
      // Callback target not available
    }
  }
}
