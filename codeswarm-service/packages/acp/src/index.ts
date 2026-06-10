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
  /** Tool call result. `title` and `rawInput` passed for skill name extraction from completed skill tool_calls. */
  toolCallUpdate: (output: string, title?: string, rawInput?: unknown) => void;
  /** Error from agent */
  error: (message: string) => void;
  /** Agent stderr output chunk */
  stderr: (content: string) => void;
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
      const appData = process.env.APPDATA || '';
      const exePath = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      cmd = exePath;
    } else {
      cmd = 'opencode';
    }
    if (config.args) {
      args = config.args;
    } else {
      const logLevel = process.env.ACP_LOG_LEVEL || 'INFO';
      args = ['acp', '--pure', '--print-logs', '--log-level', logLevel, '--cwd', config.cwd];
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
      const raw = data.toString();
      const cleaned = raw.replace(/\x1b\[[0-9;]*m/g, '');
      console.error(`[ACP stderr] ${cleaned.trim()}`);
      this.eventHandlers.stderr?.(cleaned);
    });

    this.process.on('exit', (code) => {
      console.log(`[ACP] Process exited with code ${code}`);
      this.resolveExitCode(code);
    });

    this.process.on('error', (error) => {
      console.error(`[ACP] Process error: ${error.message}`);
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

    const result = await this.connection.newSession({
      cwd: this.config.cwd,
      mcpServers: [],
    });
    this.sessionId = result.sessionId;

    if (result.modes?.availableModes) {
      console.log(`[ACP] Available modes: ${result.modes.availableModes.map((m: SessionMode) => m.id).join(', ')}`);
      console.log(`[ACP] Current mode: ${result.modes.currentModeId}`);
    }

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

    this._abortController = new AbortController();

    try {
      this._currentPromptPromise = this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
      const result = await Promise.race([
        this._currentPromptPromise,
        new Promise<never>((_, reject) => {
          const checkDestroyed = setInterval(() => {
            if (this.destroyed) {
              clearInterval(checkDestroyed);
              reject(new Error('Prompt cancelled by destroy'));
            }
          }, 100);
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

  /** Wait for current prompt to complete */
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

    if (this._abortController) {
      this._abortController.abort();
    }

    if (this.process && this.process.exitCode === null) {
      this.process.kill('SIGTERM');

      const forceKillTimeout = setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          console.log('[ACP] Process did not exit, force killing with SIGKILL');
          this.process.kill('SIGKILL');
        }
      }, 5000);

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
        const toolName = update._meta?.claudeCode?.toolName || update.title || '';
        const rawInput = update.rawInput || {};
        console.log(`[ACP] tool_call: kind=${kind}, toolName=${toolName}, title=${update.title}`);
        this.eventHandlers.toolCall?.(kind, rawInput, toolName);
        break;
      }
      case 'tool_call_update': {
        const status = update.status;
        if (status === 'completed' || status === 'failed') {
          const output = update.rawOutput
            ? JSON.stringify(update.rawOutput)
            : '';
          const title = update.title || '';
          const rawInput = update.rawInput || {};
          this.eventHandlers.toolCallUpdate?.(output, title, rawInput);
        }
        break;
      }
      case 'usage_update':
      case 'available_commands_update':
        console.log(`[ACP] Received ${updateType}, triggering alive signal`);
        this.eventHandlers.raw?.('__alive__');
        break;
      default:
        if (updateType) {
          console.log('[ACP] unknown update type:', updateType);
          this.eventHandlers.raw?.(JSON.stringify(update));
        }
    }
  }
}
