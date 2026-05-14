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
  /** Engine type: opencode or claudecode */
  engine?: 'opencode' | 'claudecode';
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
    console.log(`[ACP] ========== START BEGIN ==========`);
    console.log(`[ACP] config.cwd: ${config.cwd}`);
    console.log(`[ACP] config.engine: ${config.engine || 'opencode'}`);
    console.log(`[ACP] config.model: ${config.model}`);
    console.log(`[ACP] config.agent: ${config.agent}`);
    console.log(`[ACP] config.env keys: ${config.env ? Object.keys(config.env).join(', ') : 'none'}`);
    
    if (this.process) throw new Error('ACPClient already started');
    if (this.destroyed) throw new Error('ACPClient was destroyed');
    this.config = config;

    const engine = config.engine || 'opencode';
    
    let cmd: string;
    let args: string[];
    
    console.log(`[ACP] Step 1: Determining command for engine=${engine}, platform=${process.platform}`);
    
    if (engine === 'claudecode') {
      // ClaudeCode ACP mode
      if (process.platform === 'win32') {
        const claudePath = process.env.APPDATA 
          ? `${process.env.APPDATA}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude`
          : null;
        
        console.log(`[ACP] ClaudeCode path candidate: ${claudePath}`);
        
        if (claudePath) {
          cmd = process.execPath;
          args = [claudePath, 'acp', '--cwd', config.cwd];
          console.log(`[ACP] Using node for claudecode: ${cmd}`);
          console.log(`[ACP] ClaudeCode path: ${claudePath}`);
        } else {
          cmd = 'claude';
          args = ['acp', '--cwd', config.cwd];
        }
      } else {
        cmd = 'claude';
        args = ['acp', '--cwd', config.cwd];
      }
    } else {
      // OpenCode ACP mode
      if (process.platform === 'win32') {
        const opencodePath = process.env.APPDATA 
          ? `${process.env.APPDATA}\\npm\\node_modules\\opencode-ai\\bin\\opencode`
          : null;
        
        console.log(`[ACP] OpenCode path candidate: ${opencodePath}`);
        
        if (opencodePath) {
          cmd = process.execPath;
          args = [opencodePath, 'acp', '--cwd', config.cwd];
          console.log(`[ACP] Using node: ${cmd}`);
          console.log(`[ACP] Opencode path: ${opencodePath}`);
        } else {
          cmd = 'opencode';
          args = ['acp', '--cwd', config.cwd];
        }
      } else {
        cmd = config.command || 'opencode';
        args = ['acp', '--cwd', config.cwd];
      }
    }

    console.log(`[ACP] Step 1 DONE: cmd=${cmd}, args=${args.join(' ')}`);

    // Build environment
    console.log(`[ACP] Step 2: Building environment...`);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (config.env) {
      Object.assign(env, config.env);
      console.log(`[ACP] Merged config.env into process.env`);
    }
    console.log(`[ACP] Step 2 DONE: env has ${Object.keys(env).length} keys`);
    console.log(`[ACP] ANTHROPIC_API_KEY present: ${!!env.ANTHROPIC_API_KEY}`);

    console.log(`[ACP] Step 3: Spawning process...`);
    console.log(`[ACP] Full command: ${cmd} ${args.join(' ')}`);
    console.log(`[ACP] Spawn cwd: ${config.cwd}`);

    this.process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: config.cwd,
    });
    console.log(`[ACP] Step 3 DONE: process spawned, pid=${this.process.pid}`);

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      console.log(`[ACP] ERROR: Failed to create process streams`);
      this.destroy();
      throw new Error('Failed to create opencode process streams');
    }
    console.log(`[ACP] Process streams created successfully`);

    this.process.stderr.on('data', (data: Buffer) => {
      const stderrContent = data.toString().trim();
      console.log(`[ACP stderr] ${stderrContent}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[ACP] Process exited with code ${code}`);
      this.resolveExitCode(code);
    });

    this.process.on('error', (error) => {
      console.log(`[ACP] Process spawn error: ${error.message}`);
      this._spawnError = error;
    });

    console.log(`[ACP] Step 4: Creating ndJson stream...`);
    // Convert Node streams to Web streams for the SDK
    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(output, input);
    console.log(`[ACP] Step 4 DONE: ndJson stream created`);

    console.log(`[ACP] Step 5: Creating ClientSideConnection...`);
    const client = this;
    this.connection = new ClientSideConnection(
      (_conn: Agent): Client => ({
        async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
          console.log(`[ACP] requestPermission called: ${JSON.stringify(params)}`);
          const optionId = params.options[0]?.optionId ?? 'always';
          return { outcome: { outcome: 'selected', optionId } };
        },

        async sessionUpdate(params: SessionNotification): Promise<void> {
          console.log(`[ACP] sessionUpdate received, update type: ${params.update?.sessionUpdate}`);
          client.handleSessionUpdate(params.update);
        },
      }),
      stream,
    );
    console.log(`[ACP] Step 5 DONE: ClientSideConnection created`);

    console.log(`[ACP] Step 6: Waiting 100ms for process startup...`);
    // Initialize ACP connection
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`[ACP] Step 6 DONE: Wait complete`);
    
    if (this._spawnError) {
      console.log(`[ACP] ERROR: Spawn error detected: ${this._spawnError.message}`);
      this.destroy();
      const engineName = engine === 'claudecode' ? 'claude' : 'opencode';
      if (this._spawnError.message.includes('ENOENT')) {
        throw new Error(`${engineName} not found. Install: npm i -g ${engine === 'claudecode' ? '@anthropic-ai/claude-code' : 'opencode-ai'}@latest`);
      }
      throw this._spawnError;
    }

    console.log(`[ACP] Step 7: Initializing connection with protocolVersion=${PROTOCOL_VERSION}...`);
    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'codeswarm-worker', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    console.log(`[ACP] Step 7 DONE: Connection initialized`);
    this.initialized = true;
    console.log(`[ACP] ========== START COMPLETE ==========`);
  }

  /** Create a new session, optionally switching to specified agent mode */
  async createSession(agent?: string): Promise<string> {
    console.log(`[ACP] ========== CREATE SESSION BEGIN ==========`);
    console.log(`[ACP] requested agent: ${agent}`);
    console.log(`[ACP] initialized: ${this.initialized}`);
    
    if (!this.initialized || !this.connection) {
      console.log(`[ACP] ERROR: ACPClient not initialized`);
      throw new Error('ACPClient not initialized');
    }
    
    console.log(`[ACP] Step A: Calling newSession()...`);
    console.log(`[ACP]   cwd: ${this.config.cwd}`);
    // Pass cwd to newSession so opencode loads opencode.json from workspace
    const result = await this.connection.newSession({
      cwd: this.config.cwd,
      mcpServers: [],
    });
    console.log(`[ACP] Step A DONE: newSession returned`);
    
    this.sessionId = result.sessionId;
    console.log(`[ACP] sessionId: ${this.sessionId}`);
    
    // Log available modes for debugging
    if (result.modes?.availableModes) {
      const modeIds = result.modes.availableModes.map((m: SessionMode) => m.id);
      console.log(`[ACP] Available modes: ${modeIds.join(', ')}`);
      console.log(`[ACP] Current mode: ${result.modes.currentModeId}`);
    } else {
      console.log(`[ACP] No modes info in result`);
    }
    
    // If agent specified and modes available, switch to that mode
    if (result.modes?.availableModes) {
      const availableIds = result.modes.availableModes.map((m: SessionMode) => m.id);
      const fallbackMode = availableIds.includes('build') ? 'build' : availableIds[0];
      
      const targetMode = agent && result.modes.availableModes.find((m: SessionMode) => m.id === agent);
      
      console.log(`[ACP] Step B: Checking mode switch...`);
      console.log(`[ACP]   targetMode: ${targetMode?.id || 'not found'}`);
      console.log(`[ACP]   currentModeId: ${result.modes.currentModeId}`);
      console.log(`[ACP]   fallbackMode: ${fallbackMode}`);
      
      if (targetMode && result.modes.currentModeId !== agent) {
        console.log(`[ACP] Step B1: Switching to agent mode: ${agent}`);
        await this.connection.setSessionMode({
          sessionId: this.sessionId,
          modeId: agent,
        });
        console.log(`[ACP] Step B1 DONE: Mode switched to ${agent}`);
      } else if (agent && !targetMode) {
        console.log(`[ACP] Step B2: Agent mode '${agent}' not found, using fallback: ${fallbackMode}`);
        if (result.modes.currentModeId !== fallbackMode) {
          await this.connection.setSessionMode({
            sessionId: this.sessionId,
            modeId: fallbackMode,
          });
          console.log(`[ACP] Step B2 DONE: Mode switched to ${fallbackMode}`);
        }
      } else {
        console.log(`[ACP] Step B: No mode switch needed (already in target mode or no target)`);
      }
    } else if (result.modes?.currentModeId) {
      console.log(`[ACP] Using default agent from opencode.json: ${result.modes.currentModeId}`);
    }
    
    console.log(`[ACP] ========== CREATE SESSION COMPLETE ==========`);
    return this.sessionId!;
  }

  /** Send a prompt and wait for completion */
  async sendPrompt(prompt: string): Promise<StopReason> {
    console.log(`[ACP] ========== SEND PROMPT BEGIN ==========`);
    console.log(`[ACP] prompt: "${prompt.substring(0, 100)}..." (len=${prompt.length})`);
    console.log(`[ACP] sessionId: ${this.sessionId}`);
    
    if (!this.sessionId || !this.connection) {
      console.log(`[ACP] ERROR: No active session`);
      throw new Error('No active session');
    }
    
    console.log(`[ACP] Step C: Calling connection.prompt()...`);
    const result = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    });
    console.log(`[ACP] Step C DONE: prompt returned`);
    console.log(`[ACP] stopReason: ${result.stopReason}`);
    console.log(`[ACP] ========== SEND PROMPT COMPLETE ==========`);
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
