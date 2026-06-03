import { spawn, type ChildProcess } from 'node:child_process';
import { ACPClient, type StopReason, type ACPClientConfig } from "@codeswarm/acp";
import { ClaudeCodeClient } from "@codeswarm/sdk-adapter";
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger, LOG_MODULES } from './logger.js';

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
  | 'skill_complete'
  | 'continuation_attempt'
  | 'continuation_success'
  | 'continuation_fallback';

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

/** 续推上下文 - 跟踪续推状态和进度 */
interface ContinuationContext {
  /** 原始指令 */
  originalInstruction: string;
  /** 当前续推次数（0=首次执行, 1-N=续推） */
  continueAttempt: number;
  /** 已收集的关键事件（用于提取进度摘要，限制最近 MAX_EVENT_HISTORY 条） */
  eventHistory: AgentEvent[];
  /** 已完成的 Skill 列表 */
  completedSkills: string[];
  /** 上次使用的续推策略 */
  lastStrategy: 'cancel_same_session' | 'destroy_new_session' | null;
  /** 上次续推恢复的时间戳（用于判断是否重置计数器） */
  lastContinuationTime: number | null;
  /** 续推恢复后累计的正常事件数（用于判断 Agent 是否真正恢复了） */
  eventsSinceContinuation: number;
}

/** 运行状态 - 可在事件处理器闭包中修改的对象引用 */
interface RunState {
  stdout: string;
  stderr: string;
  currentSkill: string | null;
  inactivityTimer: NodeJS.Timeout | null;
  inactivityTimeoutReject: ((reason: Error) => void) | null;
  inactivityTimeoutTriggered: boolean;
  /** 父 session 正在等待 Agent/Task 工具调用返回（子 session 执行中） */
  waitingForChildSession: boolean;
  /** 子 session 专用超时计时器（兜底机制：防止子 session 猉死导致父 session 永久挂起） */
  childSessionTimeoutTimer: NodeJS.Timeout | null;
}

const MAX_EVENT_HISTORY = 200;

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
    timeoutMs?: number,
  ): Promise<RunAgentResult> {
    const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '3600000');
    const CONTINUE_MAX_ATTEMPTS = parseInt(process.env.CONTINUE_MAX_ATTEMPTS || '5');
    const CANCEL_WAIT_MS = parseInt(process.env.CANCEL_WAIT_MS || '10000');
    const TASK_TIMEOUT_SEC = parseInt(process.env.TASK_TIMEOUT_SEC || '604800');
    const continuationEnabled = INACTIVITY_TIMEOUT_MS > 0 && CONTINUE_MAX_ATTEMPTS > 0;
    const effectiveTimeoutMs = timeoutMs || TASK_TIMEOUT_SEC * 1000;
    const CHILD_SESSION_TIMEOUT_MS = parseInt(process.env.CHILD_SESSION_TIMEOUT_MS || '3600000');

    const state: RunState = {
      stdout: '',
      stderr: '',
      currentSkill: null,
      inactivityTimer: null,
      inactivityTimeoutReject: null,
      inactivityTimeoutTriggered: false,
      waitingForChildSession: false,
      childSessionTimeoutTimer: null,
    };

    const ctx: ContinuationContext = {
      originalInstruction: instruction || agentName || '执行任务',
      continueAttempt: 0,
      eventHistory: [],
      completedSkills: [],
      lastStrategy: null,
      lastContinuationTime: null,
      eventsSinceContinuation: 0,
    };

    const taskStartTime = Date.now();
    let client: ACPClient | null = null;
    let clientConfig: ACPClientConfig;
    let sessionAgent: string | undefined;

    const handleInactivityTimeout = () => {
      if (!continuationEnabled || state.inactivityTimeoutReject === null) return;
      const timeoutSecs = INACTIVITY_TIMEOUT_MS / 1000;
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Inactivity timeout detected (no events for ${timeoutSecs}s)`);
      state.inactivityTimeoutTriggered = true;
      state.inactivityTimeoutReject(new Error(`Inactivity timeout: no events for ${timeoutSecs}s`));
    };

    const handleChildSessionTimeout = () => {
      if (!continuationEnabled || state.inactivityTimeoutReject === null) return;
      const timeoutSecs = CHILD_SESSION_TIMEOUT_MS / 1000;
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Child session timeout: Agent/Task tool call not returning for ${timeoutSecs}s`);
      state.waitingForChildSession = false;
      state.inactivityTimeoutTriggered = true;
      state.inactivityTimeoutReject(new Error(`Inactivity timeout: child session not returning for ${timeoutSecs}s`));
    };

    const createAndStartClient = async (): Promise<ACPClient> => {
      const c = new ACPClient();
      await c.start(clientConfig);
      const sid = await c.createSession(sessionAgent);
      registerEventHandlers(c, state, ctx, {
        INACTIVITY_TIMEOUT_MS,
        CHILD_SESSION_TIMEOUT_MS,
        handleInactivityTimeout,
        handleChildSessionTimeout,
      }, onEvent, taskId);
      this.processes.set(taskId, { client: c, workspace, sessionId: sid, createdAt: Date.now() });
      if (onEvent) {
        onEvent({ type: 'session_created', message: sid, timestamp: new Date().toISOString() });
      }
      return c;
    };

    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `========== RUN AGENT START ==========`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `taskId: ${taskId}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `workspace: ${workspace}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `engine: ${engine}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `agentName: ${agentName}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `model: ${model}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `apiKey present: ${!!apiKey}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `env keys: ${env ? Object.keys(env).join(', ') : 'none'}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `INACTIVITY_TIMEOUT_MS: ${INACTIVITY_TIMEOUT_MS}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `CONTINUE_MAX_ATTEMPTS: ${CONTINUE_MAX_ATTEMPTS}`);
    logger.taskInfo(taskId, LOG_MODULES.PROCESS, `continuationEnabled: ${continuationEnabled}`);

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

      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Step B: Creating and starting client...');
      clientConfig = {
        cwd: workspace,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
        ...(model ? { model } : {}),
        agent: agentName,
        ...(engine === 'claudecode' ? { command: 'claude-agent-acp', args: [] } : {}),
      };
      sessionAgent = engine === 'claudecode' ? undefined : agentName;

      client = await createAndStartClient();

      while (ctx.continueAttempt <= CONTINUE_MAX_ATTEMPTS) {
        const elapsed = Date.now() - taskStartTime;
        if (elapsed >= effectiveTimeoutMs) {
          logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Task overall timeout (${effectiveTimeoutMs/1000}s), terminating`);
          break;
        }
        const remainingTimeoutMs = effectiveTimeoutMs - elapsed;

        if (ctx.lastStrategy === 'destroy_new_session' && ctx.continueAttempt > 0) {
          logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Rebuilding client (destroy_new_session strategy)');
          client = await createAndStartClient();
        }

        const currentInstruction = ctx.continueAttempt === 0
          ? ctx.originalInstruction
          : buildContinuationPrompt(ctx);

        logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Sending prompt (attempt ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS})`);

        if (continuationEnabled && INACTIVITY_TIMEOUT_MS > 0) {
          if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
          state.inactivityTimer = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT_MS);
        }

        const inactivityPromise = continuationEnabled
          ? new Promise<never>((_, reject) => { state.inactivityTimeoutReject = reject; })
          : new Promise<never>(() => {});

        const taskTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Task overall timeout after ${remainingTimeoutMs/1000}s`)), remainingTimeoutMs);
        });

        state.inactivityTimeoutTriggered = false;

        try {
          const stopReason = await Promise.race([
            client!.sendPrompt(currentInstruction),
            inactivityPromise,
            taskTimeoutPromise,
          ]);

          if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
          state.inactivityTimeoutReject = null;

          logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Prompt completed with stopReason=${stopReason}`);

          if (state.currentSkill && onEvent) {
            ctx.completedSkills.push(state.currentSkill);
            onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
            state.currentSkill = null;
          }

          if (stopReason === 'end_turn') {
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'end_turn - destroying client');
            await client!.destroy();
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT COMPLETE ==========');
            return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
          }

          if (stopReason === 'cancelled') {
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Cancel returned, same session continuation');
            ctx.lastStrategy = 'cancel_same_session';
            ctx.continueAttempt = Math.max(0, ctx.continueAttempt - 1);
            ctx.eventsSinceContinuation = 0;
            ctx.lastContinuationTime = Date.now();
            if (onEvent) {
              onEvent({
                type: 'continuation_success',
                message: 'Agent 已恢复（同会话续推）',
                timestamp: new Date().toISOString(),
              });
            }
            continue;
          }

          logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Waiting for exitCode (stopReason=${stopReason})...`);
          const exitCode = await Promise.race([
            client!.exitCode,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for exit')), 30000)),
          ]);
          logger.taskInfo(taskId, LOG_MODULES.PROCESS, `exitCode = ${exitCode}`);
          await client!.destroy();
          logger.taskInfo(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT COMPLETE ==========');
          return { exitCode: exitCode ?? 1, stdout: state.stdout, stderr: state.stderr };

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const isInactivityTimeout = errorMsg.includes('Inactivity timeout');

          if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
          if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); state.childSessionTimeoutTimer = null; }
          state.waitingForChildSession = false;
          state.inactivityTimeoutReject = null;

          if (!isInactivityTimeout) {
            const classified = classifyAcpError(errorMsg);
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Error: ${errorMsg} (category=${classified.category}, isCritical=${classified.isCritical})`);

            if (!state.inactivityTimeoutTriggered) state.stderr += errorMsg;

            if (onEvent) {
              onEvent({ type: classified.isCritical ? 'error' : 'phase_error', message: errorMsg, phase: classified.category, timestamp: new Date().toISOString() });
            }

            if (hasSubstantialOutput(state.stdout) && !classified.isCritical) {
              logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Non-critical error after substantial output');
              if (state.currentSkill && onEvent) {
                ctx.completedSkills.push(state.currentSkill);
                onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
              }
              return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
            }

            if (state.currentSkill && onEvent) {
              onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
            }
            return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };
          }

          ctx.continueAttempt++;
          logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Inactivity timeout, attempt ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS}`);

          if (ctx.continueAttempt > CONTINUE_MAX_ATTEMPTS) {
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Exceeded max continuation attempts (${CONTINUE_MAX_ATTEMPTS})`);
            if (onEvent) {
              onEvent({
                type: 'error',
                message: `Agent 连续 ${CONTINUE_MAX_ATTEMPTS} 次无响应，任务终止`,
                timestamp: new Date().toISOString(),
              });
            }
            state.stderr += `\nExceeded max continuation attempts (${CONTINUE_MAX_ATTEMPTS})`;
            if (client) await client.destroy();
            return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };
          }

          if (onEvent) {
            onEvent({
              type: 'continuation_attempt',
              message: `Agent 无响应 ${INACTIVITY_TIMEOUT_MS/1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`,
              timestamp: new Date().toISOString(),
            });
          }

          if (client && client.isAlive) {
            logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Trying session/cancel (方案 A)');
            await client.cancel();

            const cancelStopReason = await client.waitForCurrentPrompt(CANCEL_WAIT_MS);

            if (cancelStopReason === 'cancelled') {
              logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Cancel succeeded, same session continuation');
              ctx.lastStrategy = 'cancel_same_session';
ctx.continueAttempt = Math.max(0, ctx.continueAttempt - 1);
            ctx.eventsSinceContinuation = 0;
            ctx.lastContinuationTime = Date.now();
              if (onEvent) {
                onEvent({
                  type: 'continuation_success',
                  message: 'Agent 已恢复（同会话续推）',
                  timestamp: new Date().toISOString(),
                });
              }
              continue;
            }

            if (cancelStopReason === 'end_turn') {
              logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Cancel returned end_turn - task actually completed');
              if (state.currentSkill && onEvent) {
                ctx.completedSkills.push(state.currentSkill);
                onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
              }
              await client.destroy();
              return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
            }

            logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Cancel timeout or other response (${CANCEL_WAIT_MS}ms), fallback to 方案 B`);
          }

          logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Executing 方案 B: destroy + new session');
          ctx.lastStrategy = 'destroy_new_session';

          if (onEvent) {
            onEvent({
              type: 'continuation_fallback',
              message: 'Cancel 无响应，重建会话续推',
              timestamp: new Date().toISOString(),
            });
          }

          if (client) {
            await client.destroy();
            client = null;
          }

          continue;
        }
      }

      logger.taskWarn(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT FAILED ==========');
      if (client) await client.destroy();
      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const classified = classifyAcpError(errorMsg);
      logger.taskError(taskId, LOG_MODULES.PROCESS, '========== RUN AGENT ERROR ==========');
      logger.taskError(taskId, LOG_MODULES.PROCESS, `Error: ${errorMsg}`);
      logger.taskError(taskId, LOG_MODULES.PROCESS, `Error category: ${classified.category}, isCritical: ${classified.isCritical}`);

      if (!state.inactivityTimeoutTriggered) state.stderr += errorMsg;

      if (onEvent) {
        onEvent({ type: classified.isCritical ? 'error' : 'phase_error', message: errorMsg, phase: classified.category, timestamp: new Date().toISOString() });
      }

      if (hasSubstantialOutput(state.stdout) && !classified.isCritical) {
        return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
      }

      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

    } finally {
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Finally: destroying client and cleaning up');
      if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); }
      if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); }
      if (client) await client.destroy();
      this.processes.delete(taskId);
      logger.taskInfo(taskId, LOG_MODULES.PROCESS, 'Cleanup done');
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
          logger.warn(LOG_MODULES.PROCESS, `[stderr] ${line}`);
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
  if (/^\s*INFO\b|^\s*DEBUG\b|service=session\b|service=bus\b|service=compaction\b|service=snapshot\b/i.test(message)) {
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
 * Extract progress summary from continuation context for building continuation prompt.
 * Limited to 500 characters to avoid overly long prompts.
 */
function extractProgressSummary(ctx: ContinuationContext): string {
  const lines: string[] = [];
  
  if (ctx.completedSkills.length > 0) {
    lines.push(`已完成的检测: ${ctx.completedSkills.join(', ')}`);
  }
  
  const toolCalls = ctx.eventHistory.filter(e => e.type === 'tool_call');
  const toolNames = toolCalls.map(e => e.tool).filter(Boolean);
  if (toolNames.length > 0) {
    const uniqueTools = [...new Set(toolNames)];
    lines.push(`已使用的工具: ${uniqueTools.join(', ')} (共${toolNames.length}次调用)`);
  }
  
  const textChunks = ctx.eventHistory.filter(e => e.type === 'agent_message_chunk');
  if (textChunks.length > 0) {
    const lastText = textChunks.slice(-5).map(e => e.content).join('');
    if (lastText.length > 0) {
      lines.push(`最后输出: "${lastText.substring(0, 200)}${lastText.length > 200 ? '...' : ''}"`);
    }
  }
  
  const result = lines.join('\n');
  return result.length > 500 ? result.substring(0, 500) + '...' : result;
}

/**
 * Build continuation prompt based on attempt number, strategy, and progress.
 * Escalating urgency: 1st=gentle, 2nd=warning, 3rd+=final warning.
 */
function buildContinuationPrompt(ctx: ContinuationContext): string {
  const attempt = ctx.continueAttempt;
  const original = ctx.originalInstruction;
  const summary = extractProgressSummary(ctx);
  
  const strategyHint = ctx.lastStrategy === 'cancel_same_session'
    ? '（你之前的工作上下文仍然保留，请直接继续）'
    : '（这是一个新的会话，请根据以下进度摘要继续工作。请先检查工作目录中已有的文件。）';
  
  if (attempt === 1) {
    return [
      `你之前的任务执行中断了，请继续完成原始任务。${strategyHint}`,
      summary ? `\n当前进度:\n${summary}` : '',
      `\n原始指令:\n${original}`,
      `\n请从上次中断的地方继续，不要重复已完成的工作。`,
    ].join('');
  }
  
  if (attempt === 2) {
    return [
      `⚠️ 这是第二次续推提醒。${strategyHint}`,
      summary ? `\n当前进度:\n${summary}` : '',
      `\n原始指令:\n${original}`,
      ctx.completedSkills.length > 0
        ? `\n已完成的 Skill: ${ctx.completedSkills.join(', ')}，请不要重复执行。`
        : '',
      `\n请立即继续执行剩余工作。`,
    ].join('');
  }
  
  return [
    `🔴 最后一次续推提醒。如果仍然无法继续，任务将被终止。`,
    summary ? `\n进度: ${summary}` : '',
    `\n原始指令（精简）:\n${original.substring(0, 300)}${original.length > 300 ? '...' : ''}`,
    `\n请立即执行剩余任务。`,
  ].join('');
}

/**
 * Register event handlers on ACPClient, using RunState and ContinuationContext
 * for state management. This function can be called multiple times (for client rebuilds).
 */
function registerEventHandlers(
  client: ACPClient,
  state: RunState,
  ctx: ContinuationContext,
  config: {
    INACTIVITY_TIMEOUT_MS: number;
    CHILD_SESSION_TIMEOUT_MS: number;
    handleInactivityTimeout: () => void;
    handleChildSessionTimeout: () => void;
  },
  onEvent?: AgentEventCallback,
  taskId?: string,
): void {
  client.on({
    text: (content: string) => {
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT text: "${content.substring(0, 50)}..."`) : logger.info(LOG_MODULES.PROCESS, `EVENT text: "${content.substring(0, 50)}..."`);
      if (state.waitingForChildSession && state.childSessionTimeoutTimer) {
        clearTimeout(state.childSessionTimeoutTimer);
        state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
      } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
      }
      state.stdout += content;
      
      ctx.eventHistory.push({
        type: 'agent_message_chunk',
        content,
        timestamp: new Date().toISOString(),
      });
      if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();
      
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
      const isChildSessionTool = actualToolName === 'agent' || actualToolName === 'task';

      if (isChildSessionTool) {
        if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
        state.waitingForChildSession = true;
        if (state.childSessionTimeoutTimer) clearTimeout(state.childSessionTimeoutTimer);
        state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
        taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Child session tool call: ${actualToolName}, inactivity timer paused, child timeout started (${config.CHILD_SESSION_TIMEOUT_MS/1000}s)`) : logger.info(LOG_MODULES.PROCESS, `Child session tool call: ${actualToolName}, inactivity timer paused`);
      } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
      }
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCall: kind=${tool}, title=${title}, actualName=${actualToolName}`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCall: kind=${tool}, title=${title}, actualName=${actualToolName}`);
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 200)}`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCall input: ${JSON.stringify(input)?.substring(0, 200)}`);
      
      ctx.eventHistory.push({
        type: 'tool_call',
        tool: actualToolName,
        input,
        timestamp: new Date().toISOString(),
      });
      if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();
      
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
          ctx.completedSkills.push(state.currentSkill);
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
            ctx.completedSkills.push(state.currentSkill);
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
    
    toolCallUpdate: (output: string) => {
      if (state.waitingForChildSession) {
        state.waitingForChildSession = false;
        if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); state.childSessionTimeoutTimer = null; }
        if (config.INACTIVITY_TIMEOUT_MS > 0) {
          state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
        }
        taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Child session toolCallUpdate received, inactivity timer restored`) : logger.info(LOG_MODULES.PROCESS, `Child session toolCallUpdate received, inactivity timer restored`);
      } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
      }
      taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `EVENT toolCallUpdate: "${output?.substring(0, 50)}..."`) : logger.info(LOG_MODULES.PROCESS, `EVENT toolCallUpdate: "${output?.substring(0, 50)}..."`);
      
      ctx.eventHistory.push({
        type: 'tool_call_update',
        output,
        timestamp: new Date().toISOString(),
      });
      if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();
      
      if (state.currentSkill === 'unknown' && output) {
        const launchMatch = output.match(/(?:Launching|Invoking|Running|Executing)\s+skill[:\s]+([a-zA-Z][a-zA-Z0-9_-]+)/i);
        if (launchMatch && launchMatch[1]) {
          taskId ? logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Skill name resolved from output: ${launchMatch[1]}`) : logger.info(LOG_MODULES.PROCESS, `Skill name resolved from output: ${launchMatch[1]}`);
          state.currentSkill = launchMatch[1];
          if (onEvent) {
            onEvent({
              type: 'skill_start',
              skill: state.currentSkill,
              content: `Skill 名称已修正: ${state.currentSkill}`,
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
      if (state.waitingForChildSession && state.childSessionTimeoutTimer) {
        clearTimeout(state.childSessionTimeoutTimer);
        state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
      } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
      }
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
      if (state.waitingForChildSession && state.childSessionTimeoutTimer) {
        clearTimeout(state.childSessionTimeoutTimer);
        state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
      } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
      }
      state.stderr += line + '\n';
      taskId ? logger.taskWarn(taskId, LOG_MODULES.PROCESS, `[stderr] ${line}`) : logger.warn(LOG_MODULES.PROCESS, `[stderr] ${line}`);
      if (!onEvent) return;

      if (/process exited with|terminated by signal|Failed to write to process stdin/i.test(line)) {
        onEvent({ type: 'error', message: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
        return;
      }
      if (/Rate limit exceeded|FreeUsageLimitError|HTTP.*429|status.*429|429[ :]/i.test(line)) {
        onEvent({ type: 'error', message: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
        return;
      }
      if (/AuthenticationError|API key.*invalid|HTTP.*401|status.*401|401[ :]|unauthorized/i.test(line)) {
        onEvent({ type: 'error', message: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
        return;
      }
      if (/quota exceeded/i.test(line)) {
        onEvent({ type: 'error', message: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
        return;
      }
      if (/ECONNREFUSED|ENOTFOUND/i.test(line)) {
        onEvent({ type: 'error', message: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
        return;
      }
      onEvent({ type: 'log_chunk', content: line, level: 'worker', stream: 'stderr', timestamp: new Date().toISOString() });
    },
    
    raw: (data: string) => {
      if (data === '__alive__' && config.INACTIVITY_TIMEOUT_MS > 0) {
        if (state.waitingForChildSession) {
          if (state.childSessionTimeoutTimer) clearTimeout(state.childSessionTimeoutTimer);
          state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
        } else if (state.inactivityTimer) {
          clearTimeout(state.inactivityTimer);
          state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
        }
      }
    },
  });
}