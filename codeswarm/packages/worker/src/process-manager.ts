import { ACPClient, type StopReason } from "@codeswarm/acp";

interface ProcessEntry {
  client: ACPClient;
  workspace: string;
  sessionId: string;
  createdAt: number;
}

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
}
