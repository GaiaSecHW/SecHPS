import { spawn, type ChildProcess } from 'child_process';
import { Writable, Readable } from 'node:stream';
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
  /** Tool call started */
  toolCall: (tool: string, input: unknown) => void;
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
    
    cmd = config.command || 'opencode';
    args = ['acp', '--cwd', config.cwd];

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
      ...(process.platform === 'win32' ? { shell: true } : {}),
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
        throw new Error('opencode not found. Install: npm i -g opencode-ai@latest');
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
    const result = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    });
    return result.stopReason;
  }

  /** Execute a command via spawn (fallback when ACP command is not available) */
  async executeCommand(command: string, arguments_?: object): Promise<void> {
    throw new Error('ACP command execution not supported - use runOpencodeCommand instead');
  }

  /** Get exit code promise */
  get exitCode(): Promise<number | null> {
    return this.exitCodePromise;
  }

  /** Destroy the client and kill the process */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.process && this.process.exitCode === null) {
      this.process.kill();
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
        if (text) this.eventHandlers.text?.(text);
        break;
      }
      case 'tool_call': {
        const kind = update.kind || update.title || '';
        this.eventHandlers.toolCall?.(kind, update.rawInput || {});
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
        // Ignore non-text updates
        break;
      default:
        // Log unknown update types for debugging
        if (updateType) {
          console.log('[ACP] unknown update type:', updateType);
        }
    }
  }
}
