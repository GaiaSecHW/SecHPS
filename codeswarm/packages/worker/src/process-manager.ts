import { spawn, type ChildProcess } from 'node:child_process';
import { ACPClient, type StopReason } from "@codeswarm/acp";

interface ProcessEntry {
  client: ACPClient;
  workspace: string;
  sessionId: string;
  createdAt: number;
}

export type AgentEventType =
  | 'agent_message_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'error'
  | 'phase_start'
  | 'phase_complete'
  | 'phase_error'
  | 'log_chunk'
  | 'session_created';

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  message?: string;
  timestamp: string;
  // 阶段事件字段
  phase?: string;
  success?: boolean;
  // 日志字段
  level?: 'worker' | 'agent';
  // 输出流字段（用于区分 stdout/stderr）
  stream?: 'stdout' | 'stderr';
}

export interface AgentEventCallback {
  (event: AgentEvent): void;
}

export interface RunAgentResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();

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

  async sendPrompt(taskId: string, instruction: string): Promise<StopReason> {
    const entry = this.processes.get(taskId);
    if (!entry) throw new Error(`No process found for task ${taskId}`);
    return entry.client.sendPrompt(instruction);
  }

  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    await entry.client.destroy();
    this.processes.delete(taskId);
  }

  getClient(taskId: string): ACPClient | undefined {
    return this.processes.get(taskId)?.client;
  }

  async runAgent(
    taskId: string,
    workspace: string,
    engine: 'opencode' | 'claudecode',
    agentName: string,
    apiKey?: string,
    model?: string,
    env?: Record<string, string>,
    instruction?: string,
    onEvent?: AgentEventCallback
  ): Promise<RunAgentResult> {
    let stdout = '';
    let stderr = '';
    let client: ACPClient | null = null;

    console.log(`[ProcessMgr] ========== RUN AGENT START ==========`);
    console.log(`[ProcessMgr] taskId: ${taskId}`);
    console.log(`[ProcessMgr] workspace: ${workspace}`);
    console.log(`[ProcessMgr] engine: ${engine}`);
    console.log(`[ProcessMgr] agentName: ${agentName}`);
    console.log(`[ProcessMgr] model: ${model}`);
    console.log(`[ProcessMgr] apiKey present: ${!!apiKey}`);
    console.log(`[ProcessMgr] instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
    console.log(`[ProcessMgr] env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);

    try {
      console.log(`[ProcessMgr] Step A: Merging environment...`);
      const mergedEnv: Record<string, string> = { ...env };
      if (apiKey) {
        mergedEnv.ANTHROPIC_API_KEY = apiKey;
        console.log(`[ProcessMgr] Added ANTHROPIC_API_KEY to env`);
      }
      console.log(`[ProcessMgr] mergedEnv keys: ${Object.keys(mergedEnv).join(', ')}`);

      console.log(`[ProcessMgr] Step B: Creating ACPClient...`);
      client = new ACPClient();
      console.log(`[ProcessMgr] ACPClient created`);
      
      console.log(`[ProcessMgr] Step C: Registering event handlers...`);
      client.on({
        text: (content: string) => {
          console.log(`[ProcessMgr] EVENT text: "${content.substring(0, 50)}..."`);
          stdout += content;
          if (onEvent) {
            onEvent({
              type: 'agent_message_chunk',
              content,
              timestamp: new Date().toISOString(),
            });
          }
        },
        toolCall: (tool: string, input: unknown) => {
          console.log(`[ProcessMgr] EVENT toolCall: ${tool}`);
          console.log(`[ProcessMgr] EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 100)}`);
          if (onEvent) {
            onEvent({
              type: 'tool_call',
              tool,
              input,
              timestamp: new Date().toISOString(),
            });
          }
        },
        toolCallUpdate: (output: string) => {
          console.log(`[ProcessMgr] EVENT toolCallUpdate: "${output?.substring(0, 50)}..."`);
          if (onEvent) {
            onEvent({
              type: 'tool_call_update',
              output,
              timestamp: new Date().toISOString(),
            });
          }
        },
        error: (message: string) => {
          console.log(`[ProcessMgr] EVENT error: ${message}`);
          stderr += message;
          if (onEvent) {
            onEvent({
              type: 'error',
              message,
              timestamp: new Date().toISOString(),
            });
          }
        },
      });
      console.log(`[ProcessMgr] Event handlers registered`);

      console.log(`[ProcessMgr] Step D: Calling client.start()...`);
      console.log(`[ProcessMgr]   cwd: ${workspace}`);
      console.log(`[ProcessMgr]   model: ${model}`);
      console.log(`[ProcessMgr]   agent: ${agentName}`);
      console.log(`[ProcessMgr]   engine: ${engine}`);
      await client.start({
        cwd: workspace,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
        model,
        agent: agentName,
        // @ts-expect-error - engine may not be in ACPClientConfig but is used by worker
        engine,
      });
      console.log(`[ProcessMgr] Step D DONE: client.start() completed`);

      console.log(`[ProcessMgr] Step E: Calling client.createSession()...`);
      console.log(`[ProcessMgr]   agentName: ${agentName}`);
      const sessionId = await client.createSession(agentName);
      console.log(`[ProcessMgr] Step E DONE: sessionId = ${sessionId}`);

      // 回传 sessionId 给平台
      if (onEvent) {
        onEvent({
          type: 'session_created',
          message: sessionId,
          timestamp: new Date().toISOString(),
        });
      }

      this.processes.set(taskId, {
        client,
        workspace,
        sessionId,
        createdAt: Date.now(),
      });
      console.log(`[ProcessMgr] Process entry stored`);

      console.log(`[ProcessMgr] Step F: Calling client.sendPrompt()...`);
      console.log(`[ProcessMgr]   prompt: "${instruction || agentName}"`);
      const promptContent = instruction || agentName;
      console.log(`[ProcessMgr]   prompt length: ${promptContent?.length}`);
      const stopReason = await client.sendPrompt(promptContent);
      console.log(`[ProcessMgr] Step F DONE: stopReason = ${stopReason}`);
      
      let exitCode: number | null = null;
      if (stopReason === 'end_turn') {
        console.log(`[ProcessMgr] Step G: end_turn - destroying client`);
        await client.destroy();
        exitCode = 0;
        console.log(`[ProcessMgr] Step G DONE: exitCode = ${exitCode}`);
      } else {
        console.log(`[ProcessMgr] Step G: Waiting for exitCode (stopReason=${stopReason})...`);
        exitCode = await client.exitCode;
        console.log(`[ProcessMgr] Step G DONE: exitCode = ${exitCode}`);
      }
      
      console.log(`[ProcessMgr] ========== RUN AGENT COMPLETE ==========`);
      console.log(`[ProcessMgr] Final exitCode: ${exitCode ?? 1}`);
      console.log(`[ProcessMgr] Final stdout length: ${stdout.length}`);
      console.log(`[ProcessMgr] Final stderr length: ${stderr.length}`);
      
      return {
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[ProcessMgr] ========== RUN AGENT ERROR ==========`);
      console.log(`[ProcessMgr] Error: ${errorMsg}`);
      console.log(`[ProcessMgr] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);
      stderr += errorMsg;
      
      if (onEvent) {
        onEvent({
          type: 'error',
          message: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
      
      return {
        exitCode: 1,
        stdout,
        stderr,
      };
    } finally {
      console.log(`[ProcessMgr] Finally: destroying client and cleaning up`);
      if (client) {
        await client.destroy();
      }
      this.processes.delete(taskId);
      console.log(`[ProcessMgr] Cleanup done`);
    }
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

      // Safety timeout: 60 minutes
      setTimeout(() => {
        if (!hasEnded) {
          log('warn', 'opencode command timeout, killing process', { timeout: '60m' });
          proc.kill();
        }
      }, 60 * 60 * 1000);
    });
  }
}
