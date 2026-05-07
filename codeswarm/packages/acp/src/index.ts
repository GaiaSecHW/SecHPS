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

    const cmd = config.command || 'opencode';
    const env = { ...process.env, ...config.env };

    this.process = spawn(cmd, ['acp', '--cwd', config.cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: true,
      cwd: config.cwd,
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      this.destroy();
      throw new Error('Failed to create opencode process streams');
    }

    this.process.stderr.on('data', (data: Buffer) => {
      console.error(`[ACP stderr] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      this.resolveExitCode(code);
    });

    this.process.on('error', (error) => {
      if (error.message.includes('ENOENT')) {
        throw new Error('opencode not found. Install: npm i -g opencode-ai@latest');
      }
      throw error;
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

  /** Create a new session */
  async createSession(): Promise<string> {
    if (!this.initialized || !this.connection) throw new Error('ACPClient not initialized');
    const result = await this.connection.newSession({
      cwd: '',
      mcpServers: [],
    });
    this.sessionId = result.sessionId;
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
