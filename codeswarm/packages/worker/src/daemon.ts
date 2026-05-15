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
      const resp = await fetch(`${this.config.orchestratorUrl}/api/codeswarm/worker/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          maxConcurrent: this.config.maxConcurrent,
          currentTasks: this.config.maxConcurrent - this.semaphore.available,
          address: addresses.join(','),
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
    const { taskId, agent, defaultAgentName, startCommand, apiKey, model, env } = payload;
    let buildResult = null;

    try {
      console.log(`[Daemon] ========== TASK START ==========`);
      console.log(`[Daemon] taskId: ${taskId}`);
      console.log(`[Daemon] payload.agent: ${agent}`);
      console.log(`[Daemon] payload.defaultAgentName: ${defaultAgentName}`);
      console.log(`[Daemon] payload.startCommand: ${startCommand}`);
      console.log(`[Daemon] payload.model: ${model}`);
      console.log(`[Daemon] payload.apiKey present: ${!!apiKey}`);
      console.log(`[Daemon] payload.env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
      console.log(`[Daemon] payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
      console.log(`[Daemon] payload.workspacePath: ${payload.workspacePath}`);
      console.log(`[Daemon] payload.projectPath: ${payload.projectPath}`);

      const onEvent = (event: AgentEvent) => {
        console.log(`[Daemon] Event received: ${event.type} - ${event.content?.substring(0, 50) || event.tool || event.message?.substring(0, 50)}`);
        this.postEvent(payload, [event]).catch(() => {});
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
      });
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

      const engine = (agent || 'opencode') as 'opencode' | 'claudecode';
      const agentName = resolvedAgent || 'build';
      
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
        message: '开始执行任务...',
        timestamp: new Date().toISOString(),
      });

      let result;
      if (startCommand) {
        console.log(`[Daemon] Step 3: Running custom command: ${startCommand}`);
        this.server.log.info({ taskId, startCommand }, 'Starting custom command execution');
        result = await this.runCustomCommand(taskId, workspacePath, startCommand, env || {}, onEvent);
      } else {
        console.log(`[Daemon] Step 3: Starting agent via ACP...`);
        console.log(`[Daemon] Calling processMgr.runAgent with:`);
        console.log(`[Daemon]   - workspacePath: ${workspacePath}`);
        console.log(`[Daemon]   - engine: ${engine}`);
        console.log(`[Daemon]   - agentName: ${agentName}`);
        console.log(`[Daemon]   - model: ${model}`);
        console.log(`[Daemon]   - instruction: "${instruction}"`);
        this.server.log.info({ taskId, engine, agentName }, 'Starting agent via ACP');
        result = await this.processMgr.runAgent(
          taskId,
          workspacePath,
          engine,
          agentName,
          apiKey,
          model,
          env,
          instruction,
          onEvent
        );
        console.log(`[Daemon] Step 3 DONE: runAgent returned`);
      }

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

  private async runCustomCommand(
    taskId: string,
    workspace: string,
    startCommand: string,
    env: Record<string, string>,
    onEvent: (event: AgentEvent) => void
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { spawn } = await import('node:child_process');
    
    let stdout = '';
    let stderr = '';

    const mergedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) mergedEnv[key] = value;
    }
    Object.assign(mergedEnv, env);

    // Parse command string into command and args
    const parts = startCommand.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // On Windows, use shell to resolve commands like 'opencode' via PATHEXT
    const isWindows = process.platform === 'win32';
    const childProcess = spawn(cmd, args, {
      cwd: workspace,
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
    });

    childProcess.stdout?.on('data', (data: Buffer) => {
      const content = data.toString();
      stdout += content;
      onEvent({
        type: 'agent_message_chunk',
        content,
        timestamp: new Date().toISOString(),
      });
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const content = data.toString();
      stderr += content;
      this.server.log.warn({ taskId, stderr: content }, 'Process stderr');
    });

    const exitCode = await new Promise<number>((resolve) => {
      childProcess.on('exit', (code) => resolve(code ?? 1));
      childProcess.on('error', (err) => {
        this.server.log.error({ taskId, error: err.message }, 'Process error');
        stderr += err.message;
        onEvent({
          type: 'error',
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        resolve(1);
      });
    });

    return { exitCode, stdout, stderr };
  }
}
