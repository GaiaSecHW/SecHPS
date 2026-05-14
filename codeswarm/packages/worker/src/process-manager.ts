import { spawn, type ChildProcess } from 'node:child_process';
import { ACPClient, type StopReason } from "@codeswarm/acp";

interface ProcessEntry {
  client: ACPClient;
  workspace: string;
  sessionId: string;
  createdAt: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();

  /** Start opencode acp, initialize connection, create session */
  async start(taskId: string, workspace: string, apiKey: string, model?: string, env?: Record<string, string>, agent?: string): Promise<ACPClient> {
    if (this.processes.has(taskId)) {
      throw new Error(`Process for task ${taskId} already exists`);
    }

    const mergedEnv: Record<string, string> = { ...env };
    if (apiKey) {
      mergedEnv.ANTHROPIC_API_KEY = apiKey;
    }

    const client = new ACPClient();
    await client.start({
      cwd: workspace,
      env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
      model,
      agent,
    });
    const sessionId = await client.createSession(agent);

    this.processes.set(taskId, { client, workspace, sessionId, createdAt: Date.now() });
    return client;
  }

  /** Send prompt to the agent session, returns when agent finishes */
  async sendPrompt(taskId: string, instruction: string): Promise<StopReason> {
    const entry = this.processes.get(taskId);
    if (!entry) throw new Error(`No process found for task ${taskId}`);
    return entry.client.sendPrompt(instruction);
  }

  /** Terminate the agent process */
  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    await entry.client.destroy();
    this.processes.delete(taskId);
  }

  /** Get client for a task */
  getClient(taskId: string): ACPClient | undefined {
    return this.processes.get(taskId)?.client;
  }

  /**
   * Run opencode command with full observability logging.
   * Supports: opencode run --command <command>
   */
  async runOpencodeCommand(
    taskId: string,
    workspace: string,
    command: string,
    env?: Record<string, string>
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const log = (level: 'info' | 'warn' | 'error', msg: string, meta?: object) => {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [ProcessManager] [task=${taskId}]`;
      if (level === 'error') {
        console.error(`${prefix} ${msg}`, meta || {});
      } else if (level === 'warn') {
        console.warn(`${prefix} ${msg}`, meta || {});
      } else {
        console.log(`${prefix} ${msg}`, meta || {});
      }
    };

    log('info', 'Starting opencode command execution', { workspace, command });

    return new Promise((resolve) => {
      const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;
      if (env) {
        Object.assign(mergedEnv, env);
      }

      // Build command: opencode run --command <command>
      const args = ['run', '--command', command];

      log('info', 'Spawning opencode process', { cmd: 'opencode', args });

      const proc: ChildProcess = spawn('opencode', args, {
        cwd: workspace,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let hasEnded = false;

      const checkEnd = () => {
        if (hasEnded) return;
        hasEnded = true;

        const durationMs = Date.now() - startTime;
        log('info', 'opencode process exited', {
          exitCode: proc.exitCode,
          durationMs,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
        });

        resolve({
          exitCode: proc.exitCode ?? -1,
          stdout,
          stderr,
          durationMs,
        });
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        // Stream stdout for real-time observability
        text.split('\n').filter(Boolean).forEach(line => {
          log('info', `[stdout] ${line}`);
        });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        // Stream stderr for real-time observability
        text.split('\n').filter(Boolean).forEach(line => {
          log('warn', `[stderr] ${line}`);
        });
      });

      proc.on('error', (err) => {
        log('error', 'opencode process error', { error: err.message });
        stderr += `\nProcess error: ${err.message}`;
      });

      proc.on('exit', (code) => {
        log('info', 'opencode process exit event', { code });
        // Use setTimeout to ensure stdout/stderr streams have flushed
        setTimeout(checkEnd, 100);
      });

      // Safety timeout: 30 minutes
      setTimeout(() => {
        if (!hasEnded) {
          log('warn', 'opencode command timeout, killing process', { timeout: '30m' });
          proc.kill();
        }
      }, 30 * 60 * 1000);
    });
  }
}
