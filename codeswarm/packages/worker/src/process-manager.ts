import { spawn, type ChildProcess } from 'child_process';
import { ACPClient, type StopReason } from "@codeswarm/acp";

interface ProcessEntry {
  process: ChildProcess | null;
  client: ACPClient | null;
  workspace: string;
  sessionId: string | null;
  createdAt: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AgentType = 'opencode' | 'claudecode' | string;

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();

  /** Start opencode acp, initialize connection, create session */
  async start(taskId: string, workspace: string, apiKey: string, model?: string, env?: Record<string, string>): Promise<ACPClient> {
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
    });
    const sessionId = await client.createSession();

    this.processes.set(taskId, { process: null, client, workspace, sessionId, createdAt: Date.now() });
    return client;
  }

  /** Run a command directly in the workspace (non-ACP mode) */
  async runCommand(taskId: string, workspace: string, command: string, args: string[] = [], env?: Record<string, string>): Promise<RunResult> {
    if (this.processes.has(taskId)) {
      throw new Error(`Process for task ${taskId} already exists`);
    }

    const mergedEnv = { ...process.env, ...env };

    const childProcess = spawn(command, args, {
      cwd: workspace,
      env: mergedEnv,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(taskId, { process: childProcess, client: null, workspace, sessionId: null, createdAt: Date.now() });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      });

      childProcess.on('error', (err) => {
        reject(err);
      });
    });
  }

  /** 
   * Run agent command based on agent type
   * - opencode: `opencode run --command "${defaultAgentName}"`
   * - claudecode: `claude --prompt "${defaultAgentName}"` (or similar)
   */
  async runAgent(taskId: string, workspace: string, agentType: AgentType, defaultAgentName?: string, apiKey?: string, model?: string, env?: Record<string, string>): Promise<RunResult> {
    const mergedEnv: Record<string, string> = { ...env };
    if (apiKey) {
      mergedEnv.ANTHROPIC_API_KEY = apiKey;
    }

    let command: string;
    let args: string[] = [];

    if (agentType === 'opencode') {
      command = 'opencode';
      args = ['run'];
      if (defaultAgentName) {
        args.push('--command', defaultAgentName);
      }
      if (model) {
        mergedEnv.OPENCODE_MODEL = model;
      }
    } else if (agentType === 'claudecode' || agentType === 'claude') {
      command = 'claude';
      args = [];
      if (defaultAgentName) {
        args.push('--prompt', defaultAgentName);
      }
    } else {
      command = agentType;
      if (defaultAgentName) {
        args.push(defaultAgentName);
      }
    }

    return this.runCommand(taskId, workspace, command, args, mergedEnv);
  }

  /** Run opencode in the workspace (legacy method) */
  async runOpenCode(taskId: string, workspace: string, apiKey?: string, model?: string, env?: Record<string, string>): Promise<RunResult> {
    return this.runAgent(taskId, workspace, 'opencode', undefined, apiKey, model, env);
  }

  /** Send prompt to the agent session, returns when agent finishes */
  async sendPrompt(taskId: string, instruction: string): Promise<StopReason> {
    const entry = this.processes.get(taskId);
    if (!entry || !entry.client) throw new Error(`No ACP client found for task ${taskId}`);
    return entry.client.sendPrompt(instruction);
  }

  /** Terminate the agent process */
  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    
    if (entry.client) {
      await entry.client.destroy();
    }
    if (entry.process && entry.process.exitCode === null) {
      entry.process.kill();
    }
    this.processes.delete(taskId);
  }

  /** Get client for a task */
  getClient(taskId: string): ACPClient | undefined {
    return this.processes.get(taskId)?.client;
  }

  /** Get process for a task */
  getProcess(taskId: string): ChildProcess | undefined {
    return this.processes.get(taskId)?.process;
  }
}
