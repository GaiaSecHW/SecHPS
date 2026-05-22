import { spawn, type ChildProcess } from 'node:child_process';
import { ACPClient, type StopReason } from "@codeswarm/acp";
import { ClaudeCodeClient } from "@codeswarm/sdk-adapter";
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface ProcessEntry {
  client: ACPClient;
  workspace: string;
  sessionId: string;
  createdAt: number;
}

function loadClaudeSettingsJson(): Record<string, string> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      const keys = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_MODEL',
        'ANTHROPIC_REASONING_MODEL', 'CLAUDE_API_KEY'];
      for (const key of keys) {
        if (settings.env?.[key]) {
          result[key] = settings.env[key];
        }
      }
      // claude-agent-acp uses ANTHROPIC_AUTH_TOKEN, sync from it if needed
      if (result.ANTHROPIC_AUTH_TOKEN && !result.CLAUDE_API_KEY) {
        result.CLAUDE_API_KEY = result.ANTHROPIC_AUTH_TOKEN;
      }
      console.log(`[ProcessMgr] Loaded Claude settings.json, found keys: ${Object.keys(result).join(', ')}`);
    }
  } catch (err) {
    console.log(`[ProcessMgr] Failed to load settings.json: ${err}`);
  }
  return result;
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
  | 'session_created'
  | 'skill_start'
  | 'skill_complete';

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  message?: string;
  timestamp: string;
  phase?: string;
  success?: boolean;
  level?: 'worker' | 'agent';
  stream?: 'stdout' | 'stderr';
  skill?: string;
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
    return this.processes.get(taskId)?.client as ACPClient | undefined;
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
    onEvent?: AgentEventCallback,
    apiBaseUrl?: string,
  ): Promise<RunAgentResult> {
    let stdout = '';
    let stderr = '';
    let client: ACPClient | null = null;
    let currentSkill: string | null = null;

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
      const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;

      // For claudecode engine: load settings.json env vars first, then overlay task payload
      if (engine === 'claudecode') {
        const settingsEnv = loadClaudeSettingsJson();
        Object.assign(mergedEnv, settingsEnv);
        console.log(`[ProcessMgr] Loaded Claude settings.json for claudecode engine`);
      }

      if (env) {
        Object.assign(mergedEnv, env);
      }
      if (apiKey) {
        if (model) {
          const providerId = model.split('/')[0];
          const envKey = `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
          mergedEnv[envKey] = apiKey;
          console.log(`[ProcessMgr] Added ${envKey} to env`);
        }
        mergedEnv.ANTHROPIC_API_KEY = apiKey;
        console.log(`[ProcessMgr] Added ANTHROPIC_API_KEY to env`);
      }
      // Set model and apiBaseUrl via env vars (primarily for claudecode engine;
      // for opencode engine, model routing is driven by opencode.json provider config
      // which environment.ts injects with apiKey + baseURL in options)
      if (model) {
        mergedEnv.ANTHROPIC_MODEL = model;
        console.log(`[ProcessMgr] Added ANTHROPIC_MODEL=${model} to env`);
      }
      if (apiBaseUrl) {
        // ANTHROPIC_BASE_URL is Anthropic-specific; for opencode engine with
        // custom endpoints, apiBaseUrl is injected into opencode.json by environment.ts
        if (engine === 'claudecode') {
          mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl;
          console.log(`[ProcessMgr] Added ANTHROPIC_BASE_URL=${apiBaseUrl} to env (claudecode engine)`);
        } else {
          console.log(`[ProcessMgr] apiBaseUrl=${apiBaseUrl} handled via opencode.json provider config (opencode engine)`);
        }
      }
      if (engine === 'claudecode') {
        // claudecode engine: sync CLAUDE_API_KEY for claude-agent-acp
        if (mergedEnv.ANTHROPIC_API_KEY && !mergedEnv.CLAUDE_API_KEY) {
          mergedEnv.CLAUDE_API_KEY = mergedEnv.ANTHROPIC_API_KEY;
          console.log(`[ProcessMgr] Synced CLAUDE_API_KEY from ANTHROPIC_API_KEY`);
        }
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
        toolCall: (tool: string, input: unknown, title?: string) => {
          const actualToolName = (title || tool).toLowerCase();
          console.log(`[ProcessMgr] EVENT toolCall: kind=${tool}, title=${title}, actualName=${actualToolName}`);
          console.log(`[ProcessMgr] EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 200)}`);

          const isSkillCall = actualToolName === 'skill'
            || (typeof input === 'object' && input !== null && ('skill' in input || 'skill_name' in input));

          if (isSkillCall && onEvent) {
            // Try to extract skill name from input first
            let skillName = extractSkillName(input) || 'unknown';

            // If skill name is unknown, try to infer from recent text buffer (ACP only)
            if (skillName === 'unknown' && client) {
              const textBuffer = client.getTextBuffer();
              console.log(`[ProcessMgr] Text buffer for skill inference: ${JSON.stringify(textBuffer.slice(-3))}`);
              skillName = inferSkillNameFromContext(textBuffer) || 'unknown';
            }

            if (currentSkill && currentSkill !== skillName) {
              onEvent({
                type: 'skill_complete',
                skill: currentSkill,
                timestamp: new Date().toISOString(),
              });
            }

            currentSkill = skillName;
            onEvent({
              type: 'skill_start',
              skill: skillName,
              content: `开始执行 Skill: ${skillName}`,
              timestamp: new Date().toISOString(),
            });
          }

          if ((actualToolName === 'agent' || actualToolName === 'task') && onEvent) {
            const description = (input as any)?.description || '';
            const skillMatch = description.match(/执行\s*([a-zA-Z0-9_-]+)\s*安全检测/);
            if (skillMatch && skillMatch[1]) {
              const skillName = skillMatch[1];
              console.log(`[ProcessMgr] 检测到 Agent 执行 Skill: ${skillName}`);

              if (currentSkill && currentSkill !== skillName) {
                onEvent({
                  type: 'skill_complete',
                  skill: currentSkill,
                  timestamp: new Date().toISOString(),
                });
              }

              currentSkill = skillName;
              onEvent({
                type: 'skill_start',
                skill: skillName,
                content: `Agent 执行 Skill: ${skillName}`,
                timestamp: new Date().toISOString(),
              });
            }
          }

          if (onEvent) {
            onEvent({
              type: 'tool_call',
              tool: actualToolName,
              input,
              timestamp: new Date().toISOString(),
            });
          }
        },
        toolCallUpdate: (output: string) => {
          console.log(`[ProcessMgr] EVENT toolCallUpdate: "${output?.substring(0, 50)}..."`);

          // Secondary skill name extraction from tool output (e.g., "Launching skill: review")
          if (currentSkill === 'unknown' && output) {
            const launchMatch = output.match(/(?:Launching|Invoking|Running|Executing)\s+skill[:\s]+([a-zA-Z][a-zA-Z0-9_-]+)/i);
            if (launchMatch && launchMatch[1]) {
              console.log(`[ProcessMgr] Skill name resolved from output: ${launchMatch[1]}`);
              currentSkill = launchMatch[1];
              if (onEvent) {
                onEvent({
                  type: 'skill_start',
                  skill: currentSkill,
                  content: `Skill 名称已修正: ${currentSkill}`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }

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
      const clientConfig: {
        cwd: string;
        env?: Record<string, string>;
        model?: string;
        agent?: string;
        command?: string;
        args?: string[];
      } = {
        cwd: workspace,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
        ...(model ? { model } : {}),
        agent: agentName,
      };

      if (engine === 'claudecode') {
        // Use claude-agent-acp via ACP protocol (SDK query() fails on Windows without git-bash)
        clientConfig.command = 'claude-agent-acp';
        clientConfig.args = [];
        console.log(`[ProcessMgr]   Using claude-agent-acp engine`);
      } else {
        console.log(`[ProcessMgr]   Using opencode engine (default)`);
      }

      console.log(`[ProcessMgr]   command: ${clientConfig.command || 'opencode (default)'}`);

      await client.start(clientConfig);
      console.log(`[ProcessMgr] Step D DONE: client.start() completed`);

      // Create session — for claudecode engine, don't pass agent name as ACP mode
      // (ACP modes like bypassPermissions are opencode-specific, not agent names)
      const sessionAgent = engine === 'claudecode' ? undefined : agentName;
      console.log(`[ProcessMgr] Step E: Calling client.createSession()...`);
      console.log(`[ProcessMgr]   sessionAgent: ${sessionAgent} (engine=${engine})`);
      const sessionId = await client.createSession(sessionAgent);
      console.log(`[ProcessMgr] Step E DONE: sessionId = ${sessionId}`);

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
      if (currentSkill && onEvent) {
        onEvent({
          type: 'skill_complete',
          skill: currentSkill,
          timestamp: new Date().toISOString(),
        });
        currentSkill = null;
      }

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
        text.split('\n').filter(Boolean).forEach(line => {
          log('info', `[stdout] ${line}`);
        });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
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
        setTimeout(checkEnd, 100);
      });

      setTimeout(() => {
        if (!hasEnded) {
          log('warn', 'opencode command timeout, killing process', { timeout: '60m' });
          proc.kill();
        }
      }, 60 * 60 * 1000);
    });
  }
}

function extractSkillName(input: unknown): string | null {
  if (typeof input === 'object' && input !== null) {
    if ('skill' in input && typeof input.skill === 'string') return input.skill;
    if ('skill_name' in input && typeof (input as any).skill_name === 'string') return (input as any).skill_name;
    if ('name' in input && typeof input.name === 'string') return input.name;
  }
  if (typeof input === 'string') return input;
  return null;
}

function inferSkillNameFromContext(textBuffer: string[]): string | null {
  const fullText = textBuffer.join('');
  if (!fullText) return null;

  // 1. Match `/skill-name` pattern (e.g., "invoked the `/api-scan`" → "api-scan")
  const slashMatch = fullText.match(/\/([a-zA-Z][a-zA-Z0-9_-]+)/);
  if (slashMatch) return slashMatch[1];

  // 2. Match identifier between backticks or quotes (e.g., "`review`" → "review")
  const quotedMatch = fullText.match(/[`"']([a-zA-Z][a-zA-Z0-9_-]+)[`"']/);
  if (quotedMatch) return quotedMatch[1];

  // 3. Match "invoking/launching/calling/using <name> skill" pattern
  const invokeMatch = fullText.match(/(?:invoking|launching|calling|using|invoke|launch|call|use)\s+(?:the\s+)?(?:skill\s+)?`?([a-zA-Z][a-zA-Z0-9_-]+)`?/i);
  if (invokeMatch) return invokeMatch[1];

  // 4. Match "skill: <name>" or "skill <name>" pattern
  const skillLabelMatch = fullText.match(/skill[:\s]+([a-zA-Z][a-zA-Z0-9_-]+)/i);
  if (skillLabelMatch) return skillLabelMatch[1];

  // 5. Fallback: last standalone identifier-like word in buffer
  const lastWord = fullText.match(/\b([a-zA-Z][a-zA-Z0-9_-]{2,})\b/g);
  if (lastWord && lastWord.length > 0) return lastWord[lastWord.length - 1];

  return null;
}