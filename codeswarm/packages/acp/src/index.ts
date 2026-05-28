import { spawn, type ChildProcess } from 'child_process';
import { Writable, Readable } from 'node:stream';
import path from 'node:path';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  CancelNotification,
  Client,
  Agent,
  StopReason,
  SessionMode,
} from '@agentclientprotocol/sdk';

// ============================================================================
// Types
// ============================================================================

export interface ACPClientEvents {
  /** Agent text output chunk */
  text: (content: string) => void;
  /** Tool call started. `tool` = kind (category: read/edit/execute/other), `input` = rawInput, `title` = actual tool name */
  toolCall: (tool: string, input: unknown, title?: string) => void;
  /** Tool call result */
  toolCallUpdate: (output: string) => void;
  /** Error from agent */
  error: (message: string) => void;
  /** Raw unparsed output */
  raw: (data: string) => void;
}

export interface ACPClientConfig {
  /** Working directory for opencode */
  cwd: string;
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Command to spawn (default: "opencode") */
  command?: string;
  /** Model to use (e.g. "custom-gpt5/gpt-5-codex") */
  model?: string;
  /** Agent to use (e.g. "nazhua-audit") */
  agent?: string;
  /** Custom args (overrides default opencode args) */
  args?: string[];
}

export { type StopReason };

// ============================================================================
// ACP Client — based on @agentclientprotocol/sdk ClientSideConnection
// ============================================================================

export class ACPClient {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private initialized = false;
  private destroyed = false;
  private eventHandlers: Partial<ACPClientEvents> = {};
  private exitCodePromise: Promise<number | null>;
  private resolveExitCode!: (code: number | null) => void;
  private config!: ACPClientConfig;
  private _spawnError: Error | null = null;
  // Text buffer for skill name inference
  private _textBuffer: string[] = [];
  private _maxTextBuffer = 5;
  // Abort controller for sendPrompt
  private _abortController: AbortController | null = null;
  // Current prompt promise (saved for cancel + waitForCurrentPrompt)
  private _currentPromptPromise: Promise<any> | null = null;

  constructor() {
    this.exitCodePromise = new Promise(resolve => {
      this.resolveExitCode = resolve;
    });
  }

  /** Register event handlers */
  on(events: Partial<ACPClientEvents>): void {
    Object.assign(this.eventHandlers, events);
  }

/** Start opencode acp process and initialize connection */
  async start(config: ACPClientConfig): Promise<void> {
    if (this.process) throw new Error('ACPClient already started');
    if (this.destroyed) throw new Error('ACPClient was destroyed');
    this.config = config;

    // Determine command and args
    let cmd: string;
    let args: string[];
    const isWin32 = process.platform === 'win32';

    if (config.command) {
      cmd = config.command;
    } else if (isWin32) {
      // On Windows, resolve opencode.exe directly to avoid cmd.exe pipe issues.
      // shell:true spawns via cmd.exe which buffers stdin/stdout and breaks nd-JSON ACP protocol.
      const appData = process.env.APPDATA || '';
      const exePath = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      cmd = exePath;
    } else {
      cmd = 'opencode';
    }
    // Use custom args if provided, otherwise default to opencode acp args
    if (config.args) {
      args = config.args;
    } else {
      args = ['acp', '--pure', '--print-logs', '--log-level', 'DEBUG', '--cwd', config.cwd];
    }

    // Build environment
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (config.env) {
      Object.assign(env, config.env);
    }

    console.log(`[ACP] Starting: ${cmd} ${args.join(' ')}`);
    console.log(`[ACP] cwd: ${config.cwd}`);

    this.process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: config.cwd,
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      this.destroy();
      throw new Error('Failed to create opencode process streams');
    }

    this.process.stderr.on('data', (data: Buffer) => {
      console.error(`[ACP stderr] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[ACP] Process exited with code ${code}`);
      this.resolveExitCode(code);
    });

    this.process.on('error', (error) => {
      console.error(`[ACP] Process error: ${error.message}`);
      // Don't throw immediately - let initialization fail naturally
      // Store the error for later
      this._spawnError = error;
    });

    // Convert Node streams to Web streams for the SDK
    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(output, input);

    const client = this;
    this.connection = new ClientSideConnection(
      (_conn: Agent): Client => ({
        async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
          const optionId = params.options[0]?.optionId ?? 'always';
          return { outcome: { outcome: 'selected', optionId } };
        },

        async sessionUpdate(params: SessionNotification): Promise<void> {
          client.handleSessionUpdate(params.update);
        },
      }),
      stream,
    );

    // Initialize ACP connection
    // Wait a bit for process to start, then check for spawn errors
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this._spawnError) {
      this.destroy();
      if (this._spawnError.message.includes('ENOENT')) {
        const cmdName = config.command || 'opencode';
        const installHint = cmdName === 'opencode'
          ? 'Install: npm i -g opencode-ai@latest'
          : `Install: npm i -g ${cmdName}`;
        throw new Error(`${cmdName} not found. ${installHint}`);
      }
      throw this._spawnError;
    }

    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'codeswarm-worker', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this.initialized = true;
  }

  /** Create a new session, optionally switching to specified agent mode */
  async createSession(agent?: string): Promise<string> {
    if (!this.initialized || !this.connection) throw new Error('ACPClient not initialized');
    
    // Pass cwd to newSession so opencode loads opencode.json from workspace
    const result = await this.connection.newSession({
      cwd: this.config.cwd,
      mcpServers: [],
    });
    this.sessionId = result.sessionId;
    
    // Log available modes for debugging
    if (result.modes?.availableModes) {
      console.log(`[ACP] Available modes: ${result.modes.availableModes.map((m: SessionMode) => m.id).join(', ')}`);
      console.log(`[ACP] Current mode: ${result.modes.currentModeId}`);
    }
    
    // If agent specified and modes available, switch to that mode
    if (agent && result.modes?.availableModes) {
      const targetMode = result.modes.availableModes.find((m: SessionMode) => m.id === agent);
      if (targetMode && result.modes.currentModeId !== agent) {
        console.log(`[ACP] Switching to agent mode: ${agent}`);
        await this.connection.setSessionMode({
          sessionId: this.sessionId,
          modeId: agent,
        });
      } else if (!targetMode) {
        console.warn(`[ACP] Agent mode '${agent}' not found in available modes`);
      }
    } else if (result.modes?.currentModeId) {
      console.log(`[ACP] Using default agent from opencode.json: ${result.modes.currentModeId}`);
    }
    
    return this.sessionId!;
  }

  /** Send a prompt and wait for completion */
  async sendPrompt(prompt: string): Promise<StopReason> {
    if (!this.sessionId || !this.connection) throw new Error('No active session');
    if (this.destroyed) throw new Error('Client was destroyed');
    
    // Create abort controller for this request
    this._abortController = new AbortController();
    
    try {
      this._currentPromptPromise = this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
      const result = await Promise.race([
        this._currentPromptPromise,
        new Promise<never>((_, reject) => {
          // Reject when destroyed
          const checkDestroyed = setInterval(() => {
            if (this.destroyed) {
              clearInterval(checkDestroyed);
              reject(new Error('Prompt cancelled by destroy'));
            }
          }, 100);
          // Also reject when abort controller is aborted
          this._abortController?.signal.addEventListener('abort', () => {
            clearInterval(checkDestroyed);
            reject(new Error('Prompt aborted'));
          });
        }),
      ]);
      return result.stopReason;
    } finally {
      this._abortController = null;
      this._currentPromptPromise = null;
    }
  }

  /** Send session/cancel notification to abort current prompt */
  async cancel(): Promise<void> {
    if (!this.sessionId || !this.connection) {
      console.log('[ACP] Cannot cancel: no active session');
      return;
    }
    console.log(`[ACP] Sending session/cancel for session ${this.sessionId}`);
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  /** Wait for current prompt to complete (used after cancel to wait for SDK resolve) */
  async waitForCurrentPrompt(timeoutMs: number): Promise<StopReason | null> {
    if (!this._currentPromptPromise) return null;
    try {
      const result = await Promise.race([
        this._currentPromptPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return result?.stopReason ?? null;
    } catch {
      return null;
    }
  }

  /** Execute a command via spawn (fallback when ACP command is not available) */
  async executeCommand(command: string, arguments_?: object): Promise<void> {
    throw new Error('ACP command execution not supported - use runOpencodeCommand instead');
  }

  /** Get exit code promise */
  get exitCode(): Promise<number | null> {
    return this.exitCodePromise;
  }

  /** Check if the underlying process is still running */
  get isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null && !this.destroyed;
  }

  /** Get recent text buffer for skill name inference */
  getTextBuffer(): string[] {
    return [...this._textBuffer];
  }

  /** Destroy the client and kill the process */
  async destroy(): Promise<void> {
    this.destroyed = true;
    
    // Abort any pending prompt
    if (this._abortController) {
      this._abortController.abort();
    }
    
    if (this.process && this.process.exitCode === null) {
      // First try SIGTERM, then SIGKILL after 5 seconds
      this.process.kill('SIGTERM');
      
      // Force kill after timeout
      const forceKillTimeout = setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          console.log('[ACP] Process did not exit, force killing with SIGKILL');
          this.process.kill('SIGKILL');
        }
      }, 5000);
      
      // Wait for process to exit (up to 6 seconds)
      await Promise.race([
        this.exitCodePromise,
        new Promise<void>(resolve => setTimeout(resolve, 6000))
      ]).catch(() => {});
      
      clearTimeout(forceKillTimeout);
    }
    this.process = null;
    this.connection = null;
    this.sessionId = null;
    this.initialized = false;
  }

  /** Handle session updates from the agent */
  private handleSessionUpdate(update: any): void {
    if (!update) return;

    const updateType = update.sessionUpdate;

    switch (updateType) {
      case 'agent_thought_chunk':
      case 'agent_message_chunk': {
        const text = update.content?.text;
        if (text) {
          this._textBuffer.push(text);
          if (this._textBuffer.length > this._maxTextBuffer) this._textBuffer.shift();
          this.eventHandlers.text?.(text);
        }
        break;
      }
      case 'tool_call': {
        const kind = update.kind || update.title || '';
        // _meta.claudeCode.toolName has the actual tool name (e.g., "Skill", "Bash", "Write")
        const toolName = update._meta?.claudeCode?.toolName || update.title || '';
        const rawInput = update.rawInput || {};
        console.log(`[ACP] tool_call: kind=${kind}, toolName=${toolName}, title=${update.title}`);
        console.log(`[ACP] tool_call rawInput: ${JSON.stringify(rawInput)?.slice(0, 300)}`);
        console.log(`[ACP] tool_call _meta: ${JSON.stringify(update._meta)}`);
        this.eventHandlers.toolCall?.(kind, rawInput, toolName);
        break;
      }
      case 'tool_call_update': {
        const status = update.status;
        if (status === 'completed' || status === 'failed') {
          const output = update.rawOutput
            ? JSON.stringify(update.rawOutput)
            : '';
          this.eventHandlers.toolCallUpdate?.(output);
        }
        break;
      }
      case 'usage_update':
      case 'available_commands_update':
        // 不发射业务事件，但触发存活信号（用于续推机制的不活跃检测）
        console.log(`[ACP] Received ${updateType}, triggering alive signal`);
        this.eventHandlers.raw?.('__alive__');
        break;
      default:
        // Log unknown update types for debugging
        if (updateType) {
          console.log('[ACP] unknown update type:', updateType);
          this.eventHandlers.raw?.(JSON.stringify(update));
        }
    }
  }
}
