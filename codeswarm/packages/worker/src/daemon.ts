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
    return payload.nazhuaCallbackUrl || this.config.orchestratorUrl;
  }

  private async executeTask(payload: TaskPayload): Promise<void> {
    const { taskId } = payload;
    let workspace: string | null = null;

    try {
      // 1. Build isolated workspace
      workspace = await this.envFactory.build(payload);
      this.server.log.info({ taskId, workspace }, 'Workspace built');

      // 2. Start OpenCode ACP process + create session
      const client = await this.processMgr.start(
        taskId, workspace,
        payload.apiKey || '',
        payload.model,
        payload.env,
      );

      // 3. Register event handlers to forward to NAZHUA
      let textOutput = '';
      client.on({
        text: (content) => {
          textOutput += content;
          this.postEvent(payload, [{ type: 'agent_message_chunk', content, timestamp: new Date().toISOString() }]);
          process.stdout.write(content);
        },
        toolCall: (tool, input) => {
          this.postEvent(payload, [{ type: 'tool_call', tool, input, timestamp: new Date().toISOString() }]);
        },
        toolCallUpdate: (output) => {
          this.postEvent(payload, [{ type: 'tool_call_update', output, timestamp: new Date().toISOString() }]);
        },
        error: (message) => {
          this.postEvent(payload, [{ type: 'error', message, timestamp: new Date().toISOString() }]);
        },
      });

      // 4. Send prompt (blocks until agent finishes)
      this.server.log.info({ taskId }, 'Sending prompt');
      const stopReason = await this.processMgr.sendPrompt(taskId, payload.instruction);
      this.server.log.info({ taskId, stopReason }, 'Prompt completed');

      // 5. Collect security report if present
      const reportContent = this.collectReport(workspace);

      // 6. Report result
      this.server.log.info({ taskId, outputLen: textOutput.length }, 'Agent output');
      await this.postResult(payload, {
        taskId,
        nodeId: this.config.nodeId,
        status: 'completed',
        result: textOutput,
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
