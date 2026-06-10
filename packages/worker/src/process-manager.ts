import { spawn, type ChildProcess } from 'node:child_process';
import { ACPClient, type StopReason, type ACPClientConfig } from "@codeswarm/acp";
import { ClaudeCodeClient } from "@codeswarm/sdk-adapter";
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger, LOG_MODULES } from './logger.js';

interface ProcessEntry {
  client?: ACPClient;
  process?: ChildProcess;
  workspace: string;
  sessionId?: string;
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
      logger.info(LOG_MODULES.PROCESS, `Loaded Claude settings.json, found keys: ${Object.keys(result).join(', ')}`);
    }
  } catch (err) {
    logger.info(LOG_MODULES.PROCESS, `Failed to load settings.json: ${err}`);
  }
  return result;
}

export type AgentEventType =
  | 'agent_message_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'error'
  | 'phase_error'
  | 'phase_start'
  | 'phase_complete'
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
  title?: string;
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

/** 运行状态 - 可在事件处理器闭包中修改的对象引用 */
interface RunState {
  stdout: string;
  stderr: string;
  currentSkill: string | null;
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
    if (!entry?.client) throw new Error(`No ACP client found for task ${taskId}`);
    return entry.client.sendPrompt(instruction);
  }

  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    if (entry.client) await entry.client.destroy();
    if (entry.process && entry.process.exitCode === null) entry.process.kill('SIGTERM');
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
    onEvent?: AgentEventCallback,
    apiBaseUrl?: string,
    timeoutMs?: number,
  ): Promise<RunAgentResult> {
    const TASK_TIMEOUT_SEC = parseInt(process.env.TASK_TIMEOUT_SEC || '604800');
    const effectiveTimeoutMs = timeoutMs || TASK_TIMEOUT_SEC * 1000;

    const state: RunState = {
      stdout: '',
      stderr: '',
      currentSkill: null,
    };

    let client: ACPClient | null = null;

    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `========== RUN AGENT START ==========`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `taskId: ${taskId}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `workspace: ${workspace}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `engine: ${engine}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `agentName: ${agentName}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `model: ${model}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `apiKey present: ${!!apiKey}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `effectiveTimeoutMs: ${effectiveTimeoutMs}`);

    try {
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Step A: Merging environment...');
      const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;

      if (engine === 'claudecode') {
        const settingsEnv = loadClaudeSettingsJson();
        Object.assign(mergedEnv, settingsEnv);
      }

      if (env) Object.assign(mergedEnv, env);
      if (apiKey) {
        if (model) {
          const providerId = model.split('/')[0];
          const envKey = `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
          mergedEnv[envKey] = apiKey;
        }
        mergedEnv.ANTHROPIC_API_KEY = apiKey;
      }
      if (model) mergedEnv.ANTHROPIC_MODEL = model;
      if (apiBaseUrl && engine === 'claudecode') mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl;
      if (engine === 'claudecode' && mergedEnv.ANTHROPIC_API_KEY && !mergedEnv.CLAUDE_API_KEY) {
        mergedEnv.CLAUDE_API_KEY = mergedEnv.ANTHROPIC_API_KEY;
      }

      // ========== OPENCODE RUN MODE (direct spawn, no ACP) ==========
      if (engine === 'opencode') {
        const result = await this.runOpencodeRun(taskId, workspace, agentName, instruction || '执行任务', onEvent, mergedEnv, effectiveTimeoutMs);
        return result;
      }
      // ========== CLAUDECODE ACP MODE ==========

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Step B: Creating and starting ACP client...');
      const clientConfig: ACPClientConfig = {
        cwd: workspace,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
        ...(model ? { model } : {}),
        agent: agentName,
        ...(engine === 'claudecode' ? { command: 'claude-agent-acp', args: [] } : {}),
      };
      const sessionAgent: string | undefined = engine === 'claudecode' ? undefined : agentName;

      client = new ACPClient();
      await client.start(clientConfig);
      const sid = await client.createSession(sessionAgent);
      registerEventHandlers(client, state, onEvent, taskId);
      this.processes.set(taskId, { client, workspace, sessionId: sid, createdAt: Date.now() });
      if (onEvent) {
        onEvent({ type: 'session_created', message: sid, timestamp: new Date().toISOString() });
      }

      const currentInstruction = instruction || agentName || '执行任务';
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Sending prompt (single-shot)`);

      const taskTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Task overall timeout after ${effectiveTimeoutMs / 1000}s`)), effectiveTimeoutMs);
      });

      const stopReason = await Promise.race([
        client.sendPrompt(currentInstruction),
        taskTimeoutPromise,
      ]);

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Prompt completed with stopReason=${stopReason}`);

      if (state.currentSkill && onEvent) {
        onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
        state.currentSkill = null;
      }

      if (stopReason === 'end_turn') {
        logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'end_turn - destroying client');
        await client.destroy();
        logger.taskInfo(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT COMPLETE ==========');
        return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
      }

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Waiting for exitCode (stopReason=${stopReason})...`);
      const exitCode = await Promise.race([
        client.exitCode,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for exit')), 30000)),
      ]);
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `exitCode = ${exitCode}`);
      await client.destroy();
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT COMPLETE ==========');
      return { exitCode: exitCode ?? 1, stdout: state.stdout, stderr: state.stderr };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const classified = classifyAcpError(errorMsg);
      logger.taskError(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT ERROR ==========');
      logger.taskError(taskId, LOG_MODULES.PROCESS, `Error: ${errorMsg}`);
      logger.taskError(taskId, LOG_MODULES.PROCESS, `Error category: ${classified.category}, isCritical: ${classified.isCritical}`);

      state.stderr += errorMsg;

      if (onEvent) {
        onEvent({ type: classified.isCritical ? 'error' : 'phase_error', message: errorMsg, phase: classified.category, timestamp: new Date().toISOString() });
      }

      if (state.currentSkill && onEvent) {
        onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
      }

      if (hasSubstantialOutput(state.stdout) && !classified.isCritical) {
        return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
      }

      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

    } finally {
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Finally: destroying client and cleaning up');
      if (client) await client.destroy();
      this.processes.delete(taskId);
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Cleanup done');
    }
  }

  /**
   * Execute agent via `opencode run` (non-interactive mode).
   * Uses --print-logs + pipefail tee: file write by tee, stdout capture by Node.js.
   * No ACP protocol — simpler, faster, more stable than `opencode acp`.
   */
  private async runOpencodeRun(
    taskId: string,
    workspace: string,
    agentName: string,
    instruction: string,
    onEvent?: AgentEventCallback,
    mergedEnv?: Record<string, string>,
    timeoutMs: number = 7 * 24 * 3600 * 1000,
  ): Promise<RunAgentResult> {
    const state: RunState = { stdout: '', stderr: '', currentSkill: null };
    let childProcess: ChildProcess | null = null;
    const logFilePath = path.join(workspace, 'opencode_stdout.logs');

    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `========== OPENCODE RUN START ==========`);

    try {
      // Build opencode args
      const args = ['run', '--print-logs'];
      if (agentName) args.push('--agent', agentName);
      args.push('--dir', workspace);

      const prompt = instruction?.trim() || agentName || '执行任务';

      // Shell command with pipefail + tee: file write by tee, stdout capture by Node.js
      // pipefail ensures exit code reflects opencode (not tee)
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const shellCmd = `set -o pipefail; opencode ${args.join(' ')} '${escapedPrompt}' 2>&1 | tee "${logFilePath}"`;

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `shell: ${shellCmd.substring(0, 400)}`);

      const env: Record<string, string> = mergedEnv || process.env as Record<string, string>;

      childProcess = spawn('bash', ['-c', shellCmd], {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Store in processes map for terminate() support
      this.processes.set(taskId, { process: childProcess, workspace, createdAt: Date.now() });

      // Resolve function for exit — hoisted so spawn error handler can use it
      let resolveExit!: (code: number | null) => void;
      const exitPromise = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      });

      // stdout: tee writes to file, we capture for real-time events
      childProcess.stdout?.on('data', (data: Buffer) => {
        const content = data.toString();
        state.stdout += content;
        if (onEvent) {
          onEvent({
            type: 'agent_message_chunk',
            content,
            timestamp: new Date().toISOString(),
          });
        }
      });

      // stderr of shell process (usually empty since 2>&1 merged into tee pipe)
      childProcess.stderr?.on('data', (data: Buffer) => {
        const content = data.toString();
        state.stderr += content;
      });

      // Handle spawn error (ENOENT/EACCES etc — process never started, close may not fire)
      childProcess.on('error', (err) => {
        logger.taskError(taskId, LOG_MODULES.PROCESS, `opencode run spawn error: ${err.message}`);
        state.stderr += err.message;
        resolveExit(1);
      });

      // Normal exit
      childProcess.on('close', (code) => {
        resolveExit(code);
      });

      const result = await Promise.race([
        exitPromise.then(code => ({
          exitCode: code ?? 1,
          stdout: state.stdout,
          stderr: state.stderr,
        })),
        new Promise<RunAgentResult>((resolve) => {
          setTimeout(() => {
            resolve({
              exitCode: 124,
              stdout: state.stdout,
              stderr: state.stderr + '\nTimeout exceeded',
            });
          }, timeoutMs);
        }),
      ]);

      if (result.exitCode === 124 && childProcess && childProcess.exitCode === null) {
        logger.taskWarn(taskId, LOG_MODULES.PROCESS, 'Timeout, killing opencode process');
        childProcess.kill('SIGTERM');
      }

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `========== OPENCODE RUN END (exitCode=${result.exitCode}) ==========`);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.taskError(taskId, LOG_MODULES.PROCESS, `opencode run error: ${errorMsg}`);
      state.stderr += errorMsg;
      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };
    } finally {
      this.processes.delete(taskId);
    }
  }

  async runOpencodeCommand(
    taskId: string,
    workspace: string,
    command: string,
    env?: Record<string, string>,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    const startTime = Date.now();

    logger.info(LOG_MODULES.PROCESS, 'Starting opencode command execution', { workspace, command });

    return new Promise((resolve) => {
      const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;
      if (env) {
        Object.assign(mergedEnv, env);
      }

      const args = ['run', '--command', command];

      logger.info(LOG_MODULES.PROCESS, 'Spawning opencode process', { cmd: 'opencode', args });

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
        logger.info(LOG_MODULES.PROCESS, 'opencode process exited', {
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
          logger.info(LOG_MODULES.PROCESS, `[stdout] ${line}`);
        });
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        text.split('\n').filter(Boolean).forEach(line => {
          const { isCritical } = classifyAcpError(line);
          isCritical ? logger.warn(LOG_MODULES.PROCESS, `[stderr] ${line}`) : logger.info(LOG_MODULES.PROCESS, `[stderr] ${line}`);
        });
      });

      proc.on('error', (err) => {
        logger.error(LOG_MODULES.PROCESS, 'opencode process error', { error: err.message });
        stderr += `\nProcess error: ${err.message}`;
      });

      proc.on('exit', (code) => {
        logger.info(LOG_MODULES.PROCESS, 'opencode process exit event', { code });
        setTimeout(checkEnd, 100);
      });

      setTimeout(() => {
        if (!hasEnded) {
          logger.warn(LOG_MODULES.PROCESS, 'opencode command timeout, killing process', { timeoutMs });
          proc.kill();
        }
      }, timeoutMs || 7 * 24 * 3600 * 1000);
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

// ============================================================================
// Error Classification for Exception Isolation
// ============================================================================

export interface ClassifiedError {
  isCritical: boolean;
  category: 'title_generation' | 'rate_limit' | 'task_logic' | 'agent_info_log' | 'unknown';
  rawMessage: string;
}

/**
 * Classify ACP/LLM errors. Non-critical errors must not cascade to task status.
 * Check order matters: INFO exemption before rate_limit, since git hashes embed "429".
 */
export function classifyAcpError(message: string): ClassifiedError {
  if (/^\s*INFO\b|^\s*DEBUG\b|service=acp-agent\b|service=session\b|service=bus\b|service=compaction\b|service=snapshot\b/i.test(message)) {
    return { isCritical: false, category: 'agent_info_log', rawMessage: message };
  }

  if (/title.*generat|generat.*title|session.*title|title.*generator/i.test(message)) {
    return { isCritical: false, category: 'title_generation', rawMessage: message };
  }

  // Bare `429` removed: 40-char git hashes frequently contain "429" as hex substring.
  if (/AI_RetryError|RetryError|rate[_ ]?limit|HTTP.*429|status.*429|FreeUsageLimitError/i.test(message)) {
    return { isCritical: false, category: 'rate_limit', rawMessage: message };
  }

  return { isCritical: true, category: 'unknown', rawMessage: message };
}

/**
 * Check if stdout contains substantial output (indicating main task completed).
 * Used to determine if a post-task error should be tolerated.
 */
export function hasSubstantialOutput(stdout: string, minLength = 100): boolean {
  const stripped = stdout.replace(/\s+/g, '').trim();
  return stripped.length >= minLength;
}

/**
 * Register event handlers on ACPClient, using RunState for state management.
 */
function registerEventHandlers(
  client: ACPClient,
  state: RunState,
  onEvent?: AgentEventCallback,
  taskId?: string,
): void {
  client.on({
    text: (content: string) => {
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT text: "${content.substring(0, 50)}..."`) : logger.info(LOG_MODULES.PROCESS, `EVENT text: "${content.substring(0, 50)}..."`);
      state.stdout += content;

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

      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCall: kind=${tool}, title=${title}, actualName=${actualToolName}`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCall: kind=${tool}, title=${title}, actualName=${actualToolName}`);
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 200)}`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 200)}`);

      const isSkillCall = actualToolName === 'skill'
        || (typeof input === 'object' && input !== null && ('skill' in input || 'skill_name' in input));

      if (isSkillCall && onEvent) {
        let skillName = extractSkillName(input) || 'unknown';

        if (skillName === 'unknown') {
          const textBuffer = client.getTextBuffer();
          taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Text buffer for skill inference: ${JSON.stringify(textBuffer.slice(-3))}`) : logger.info(LOG_MODULES.PROCESS, `Text buffer for skill inference: ${JSON.stringify(textBuffer.slice(-3))}`);
          skillName = inferSkillNameFromContext(textBuffer) || 'unknown';
        }

        if (state.currentSkill && state.currentSkill !== skillName) {
          onEvent({
            type: 'skill_complete',
            skill: state.currentSkill,
            timestamp: new Date().toISOString(),
          });
        }

        state.currentSkill = skillName;
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
          taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `检测到 Agent 执行 Skill: ${skillName}`) : logger.info(LOG_MODULES.PROCESS, `检测到 Agent 执行 Skill: ${skillName}`);

          if (state.currentSkill && state.currentSkill !== skillName) {
            onEvent({
              type: 'skill_complete',
              skill: state.currentSkill,
              timestamp: new Date().toISOString(),
            });
          }

          state.currentSkill = skillName;
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

    toolCallUpdate: (output: string, title?: string, rawInput?: unknown) => {
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCallUpdate: "${output?.substring(0, 50)}...", title="${title}"`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCallUpdate: "${output?.substring(0, 50)}...", title="${title}"`);

      // Try to resolve skill name from three sources (priority order):
      // 1. rawInput.name (from ACP tool_call_update rawInput field)
      // 2. title "Loaded skill: xxx" pattern (from OpenCode skill.ts)
      // 3. <skill_content name="xxx"> tag in output (from skill execution result)
      const inputSkillName = extractSkillName(rawInput);
      const titleSkillMatch = title?.match(/^Loaded skill:\s*(.+)/);
      const titleSkillName = titleSkillMatch?.[1]?.trim();
      const contentSkillMatch = output?.match(/<skill_content name="([^"]+)"/);
      const contentSkillName = contentSkillMatch?.[1];
      const resolvedSkillName = inputSkillName || titleSkillName || contentSkillName;

      if (resolvedSkillName && state.currentSkill !== resolvedSkillName) {
        taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Skill name resolved from tool_call_update: ${resolvedSkillName} (prev: ${state.currentSkill || 'none'}, source: ${inputSkillName ? 'rawInput' : titleSkillName ? 'title' : 'skill_content'})`) : logger.info(LOG_MODULES.PROCESS, `Skill name resolved from tool_call_update: ${resolvedSkillName} (prev: ${state.currentSkill || 'none'})`);
        state.currentSkill = resolvedSkillName;
        if (onEvent) {
          onEvent({
            type: 'skill_start',
            skill: state.currentSkill,
            content: `Skill 名称已修正: ${state.currentSkill}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (onEvent) {
        onEvent({
          type: 'tool_call_update',
          output,
          title: title || undefined,
          timestamp: new Date().toISOString(),
        });
      }
    },

    error: (message: string) => {
      const classified = classifyAcpError(message);
      taskId ? logger.taskWarn(taskId, LOG_MODULES.PROCESS, `EVENT error: ${message} (category=${classified.category}, isCritical=${classified.isCritical})`) : logger.warn(LOG_MODULES.PROCESS, `EVENT error: ${message} (category=${classified.category}, isCritical=${classified.isCritical})`);
      state.stderr += message;
      if (onEvent) {
        onEvent({
          type: classified.isCritical ? 'error' : 'phase_error',
          message,
          phase: classified.category,
          timestamp: new Date().toISOString(),
        });
      }
    },

    stderr: (content: string) => {
      const line = content.trim();
      if (!line) return;
      state.stderr += line + '\n';
      const { isCritical } = classifyAcpError(line);
      if (isCritical) {
        taskId ? logger.taskWarn(taskId, LOG_MODULES.PROCESS, `[stderr] ${line}`) : logger.warn(LOG_MODULES.PROCESS, `[stderr] ${line}`);
      } else {
        taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `[stderr] ${line}`) : logger.info(LOG_MODULES.PROCESS, `[stderr] ${line}`);
      }
      if (!onEvent) return;
      onEvent({ type: 'log_chunk', content: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
    },

    raw: (_data: string) => {
      // 续推机制已移除,raw 事件不再用于 inactivity 心跳检测
    },
  });
}
