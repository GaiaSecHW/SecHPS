import { spawn, type ChildProcess } from 'node:child_process';
import { Writable } from 'node:stream';

// ============================================================================
// Types
// ============================================================================

export interface AgentRunnerEvents {
  /** Agent stdout output chunk */
  stdout: (content: string) => void;
  /** Agent stderr output chunk */
  stderr: (content: string) => void;
  /** Agent process exited */
  exit: (code: number | null) => void;
  /** Error from spawn or process */
  error: (message: string) => void;
}

export interface AgentRunnerConfig {
  /** Working directory for opencode */
  cwd: string;
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Model to use (e.g. "custom-gpt5/gpt-5-codex") */
  model?: string;
  /** Agent to use (e.g. "nazhua-audit") */
  agent?: string;
  /** Instruction prompt to send via stdin */
  instruction?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface AgentRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ============================================================================
// AgentRunner - Direct spawn without ACP protocol
// ============================================================================

export class AgentRunner {
  private process: ChildProcess | null = null;
  private destroyed = false;
  private eventHandlers: Partial<AgentRunnerEvents> = {};
  private exitCodePromise: Promise<number | null>;
  private resolveExitCode!: (code: number | null) => void;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private startTime: number = 0;
  private config!: AgentRunnerConfig;

  constructor() {
    this.exitCodePromise = new Promise(resolve => {
      this.resolveExitCode = resolve;
    });
  }

  /** Register event handlers */
  on(events: Partial<AgentRunnerEvents>): void {
    Object.assign(this.eventHandlers, events);
  }

  /** Start opencode process and run instruction */
  async run(config: AgentRunnerConfig): Promise<AgentRunResult> {
    if (this.process) throw new Error('AgentRunner already running');
    if (this.destroyed) throw new Error('AgentRunner was destroyed');

    this.config = config;
    this.startTime = Date.now();
    this.stdoutBuffer = [];
    this.stderrBuffer = [];

    const args: string[] = [];
    
    // Add model flag if specified
    if (config.model) {
      args.push('--model', config.model);
    }
    
    // Add prompt via stdin mode
    if (config.instruction) {
      args.push('--prompt'); // stdin mode
    }

    const mergedEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([_, v]) => v !== undefined) as [string, string][]
      ),
      ...config.env,
    };

    // Spawn opencode process
    this.process = spawn('opencode', args, {
      cwd: config.cwd,
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr all piped
    });

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const content = data.toString();
      this.stdoutBuffer.push(content);
      this.eventHandlers.stdout?.(content);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const content = data.toString();
      this.stderrBuffer.push(content);
      this.eventHandlers.stderr?.(content);
    });

    // Handle exit
    this.process.on('close', (code) => {
      this.resolveExitCode(code);
      this.eventHandlers.exit?.(code);
    });

    // Handle error
    this.process.on('error', (err) => {
      const errorMsg = err.message;
      this.stderrBuffer.push(errorMsg);
      this.eventHandlers.error?.(errorMsg);
      this.resolveExitCode(1);
    });

    // Send instruction via stdin if provided
    if (config.instruction && this.process.stdin) {
      const stdin = this.process.stdin as Writable;
      stdin.write(config.instruction);
      stdin.end();
    }

    // Wait for completion with optional timeout
    const timeoutMs = config.timeoutMs || 7 * 24 * 3600 * 1000;
    
    const result = await Promise.race([
      this.exitCodePromise.then((code) => ({
        exitCode: code,
        stdout: this.stdoutBuffer.join(''),
        stderr: this.stderrBuffer.join(''),
        durationMs: Date.now() - this.startTime,
      })),
      new Promise<AgentRunResult>((resolve) => {
        setTimeout(() => {
          resolve({
            exitCode: 124, // Timeout exit code
            stdout: this.stdoutBuffer.join(''),
            stderr: this.stderrBuffer.join('') + '\nTimeout exceeded',
            durationMs: timeoutMs,
          });
        }, timeoutMs);
      }),
    ]);

    // Kill process if timeout
    if (result.exitCode === 124 && this.process) {
      this.process.kill('SIGTERM');
    }

    return result;
  }

  /** Terminate the agent process */
  async terminate(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      await this.exitCodePromise.catch(() => {}); // Ignore exit code
      this.process = null;
    }
    this.destroyed = true;
  }

  /** Get exit code promise (for external waiting) */
  getExitCode(): Promise<number | null> {
    return this.exitCodePromise;
  }

  /** Check if process is still running */
  isRunning(): boolean {
    return this.process !== null && !this.destroyed;
  }
}