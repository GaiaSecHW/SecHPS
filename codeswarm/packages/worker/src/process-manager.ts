import { spawn, type ChildProcess } from 'node:child_process';
import {
  createAcpRuntime,
  createFileSessionStore,
  createAgentRegistry,
  isAcpRuntimeError,
  type AcpxRuntime,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeTurnResult,
} from 'acpx/runtime';

// ============================================================================
// acpx local type aliases
// ============================================================================

type AcpxSessionStore = ReturnType<typeof createFileSessionStore>;
type AcpxAgentRegistry = ReturnType<typeof createAgentRegistry>;

// MCP Server types — 使用 any[] 避免与 @agentclientprotocol/sdk 歧义联合类型冲突
// acpx 内部使用 McpServerHttp | McpServerSse | McpServerStdio 三种类型

// ============================================================================
// Agent Engine Whitelist & Resolution
// ============================================================================

const ENGINE_ALLOWLIST: ReadonlySet<string> = new Set([
  'opencode', 'claudecode', 'codex', 'gemini', 'cursor', 'copilot', 'kiro',
]);

function resolveAgentName(engine: string): string {
  if (!ENGINE_ALLOWLIST.has(engine)) {
    throw new Error(`Unsupported engine: ${engine}. Allowed: ${[...ENGINE_ALLOWLIST].join(', ')}`);
  }
  const map: Record<string, string> = {
    opencode: 'opencode',
    claudecode: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    cursor: 'cursor',
    copilot: 'copilot',
    kiro: 'kiro',
  };
  return map[engine] ?? engine;
}

// ============================================================================
// Auth env helper
// ============================================================================

function applyAuthEnv(
  engine: string,
  apiKey?: string,
  model?: string,
  apiBaseUrl?: string,
): void {
  if (!apiKey) return;

  const agent = resolveAgentName(engine);

  if (agent === 'claude') {
    process.env.ANTHROPIC_API_KEY = apiKey;
    process.env.CLAUDE_API_KEY = apiKey;
  } else if (agent === 'codex' || agent === 'copilot') {
    process.env.OPENAI_API_KEY = apiKey;
  } else if (agent === 'gemini') {
    process.env.GOOGLE_API_KEY = apiKey;
  } else if (model) {
    const providerId = model.split('/')[0]?.toUpperCase();
    if (providerId) process.env[`${providerId}_API_KEY`] = apiKey;
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  if (apiBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = apiBaseUrl;
  }
}

// ============================================================================
// MCP Conversion
// ============================================================================

interface PlatformMcpConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertMcpServers(mcpsJson?: string): any[] | undefined {
  if (!mcpsJson) return undefined;

  try {
    const configs: PlatformMcpConfig[] = JSON.parse(mcpsJson);
    return configs.map((cfg) => {
      if (cfg.transport === 'http') {
        return {
          name: cfg.name, type: 'http', url: cfg.url!,
          headers: cfg.headers ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value })) : undefined,
        };
      }
      if (cfg.transport === 'sse') {
        return {
          name: cfg.name, type: 'sse', url: cfg.url!,
          headers: cfg.headers ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value })) : undefined,
        };
      }
      return {
        name: cfg.name, type: 'stdio', command: cfg.command!, args: cfg.args ?? [],
        env: cfg.env ? Object.entries(cfg.env).map(([name, value]) => ({ name, value })) : undefined,
      };
    });
  } catch {
    return undefined;
  }
}

// ============================================================================
// Public Types (unchanged interface)
// ============================================================================

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

// ============================================================================
// Internal Types
// ============================================================================

interface ProcessEntry {
  runtime: AcpxRuntime;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any — acpx 未导出 AcpRuntimeHandle 类型
  handle: any;
  workspace: string;
  createdAt: number;
}

interface ContinuationContext {
  originalInstruction: string;
  continueAttempt: number;
  eventHistory: AgentEvent[];
  completedSkills: string[];
  lastStrategy: 'cancel_same_session' | 'destroy_new_session' | null;
  lastContinuationTime: number | null;
  eventsSinceContinuation: number;
}

interface RunState {
  stdout: string;
  stderr: string;
  currentSkill: string | null;
  textChunks: string[];
  inactivityTimer: NodeJS.Timeout | null;
  inactivityTimeoutReject: ((reason: Error) => void) | null;
  inactivityTimeoutTriggered: boolean;
}

const MAX_EVENT_HISTORY = 200;

// ============================================================================
// ProcessManager
// ============================================================================

export interface ProcessManagerOptions {
  sessionStore?: AcpxSessionStore;
  agentRegistry?: AcpxAgentRegistry;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();
  private readonly sessionStore: AcpxSessionStore;
  private readonly agentRegistry: AcpxAgentRegistry;

  constructor(options?: ProcessManagerOptions) {
    this.sessionStore = options?.sessionStore ?? createFileSessionStore({
      stateDir: process.env.SESSION_DIR ?? '.acpx-state',
    });
    this.agentRegistry = options?.agentRegistry ?? createAgentRegistry();
  }

  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    try {
      await entry.runtime.close({ handle: entry.handle, reason: 'terminate', discardPersistentState: true });
    } catch (err) {
      console.log(`[ProcessMgr] terminate: close error (non-fatal): ${err}`);
    }
    this.processes.delete(taskId);
  }

  async runAgent(
    taskId: string,
    workspace: string,
    engine: string,
    agentName: string,
    apiKey?: string,
    model?: string,
    _env?: Record<string, string>,
    instruction?: string,
    onEvent?: AgentEventCallback,
    apiBaseUrl?: string,
    timeoutMs?: number,
    mcps?: string,
  ): Promise<RunAgentResult> {
    const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '900000');
    const CONTINUE_MAX_ATTEMPTS = parseInt(process.env.CONTINUE_MAX_ATTEMPTS || '5');
    const CANCEL_WAIT_MS = parseInt(process.env.CANCEL_WAIT_MS || '10000');
    const TASK_TIMEOUT_SEC = parseInt(process.env.TASK_TIMEOUT_SEC || '604800');
    const continuationEnabled = INACTIVITY_TIMEOUT_MS > 0 && CONTINUE_MAX_ATTEMPTS > 0;
    const effectiveTimeoutMs = timeoutMs || TASK_TIMEOUT_SEC * 1000;

    const state: RunState = {
      stdout: '',
      stderr: '',
      currentSkill: null,
      textChunks: [],
      inactivityTimer: null,
      inactivityTimeoutReject: null,
      inactivityTimeoutTriggered: false,
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

    const handleInactivityTimeout = () => {
      if (!continuationEnabled || state.inactivityTimeoutReject === null) return;
      const timeoutSecs = INACTIVITY_TIMEOUT_MS / 1000;
      console.log(`[ProcessMgr] Inactivity timeout detected (no events for ${timeoutSecs}s)`);
      state.inactivityTimeoutTriggered = true;
      state.inactivityTimeoutReject(new Error(`Inactivity timeout: no events for ${timeoutSecs}s`));
    };

    const createRuntimeAndSession = async () => {
      applyAuthEnv(engine, apiKey, model, apiBaseUrl);
      const runtime = createAcpRuntime({
        cwd: workspace,
        sessionStore: this.sessionStore,
        agentRegistry: this.agentRegistry,
        permissionMode: 'approve-all',
        nonInteractivePermissions: 'deny',
        timeoutMs: effectiveTimeoutMs,
        mcpServers: convertMcpServers(mcps),
      });

      const agent = resolveAgentName(engine);
      let handle: unknown;
      try {
        handle = await runtime.ensureSession({
          sessionKey: taskId,
          agent,
          mode: 'oneshot',
          cwd: workspace,
          sessionOptions: model ? { model } : undefined,
        });
      } catch (err: any) {
        if (err?.constructor?.name === 'RequestedModelUnsupportedError' || /model.*not.*advertised/i.test(err?.message)) {
          console.log(`[ProcessMgr] Model "${model}" not advertised, retrying without model`);
          handle = await runtime.ensureSession({
            sessionKey: taskId,
            agent,
            mode: 'oneshot',
            cwd: workspace,
          });
        } else {
          throw err;
        }
      }

      this.processes.set(taskId, { runtime, handle, workspace, createdAt: Date.now() });
      if (onEvent) {
        onEvent({ type: 'session_created', message: String(handle), timestamp: new Date().toISOString() });
      }
      return { runtime, handle };
    };

    console.log(`[ProcessMgr] ========== RUN AGENT START ==========`);
    console.log(`[ProcessMgr] taskId: ${taskId}`);
    console.log(`[ProcessMgr] workspace: ${workspace}`);
    console.log(`[ProcessMgr] engine: ${engine} (→ ${resolveAgentName(engine)})`);
    console.log(`[ProcessMgr] agentName: ${agentName}`);
    console.log(`[ProcessMgr] model: ${model}`);
    console.log(`[ProcessMgr] apiKey present: ${!!apiKey}`);
    console.log(`[ProcessMgr] instruction: "${instruction?.substring(0, 100)}..." (len=${instruction?.length})`);
    console.log(`[ProcessMgr] mcps present: ${!!mcps}`);
    console.log(`[ProcessMgr] INACTIVITY_TIMEOUT_MS: ${INACTIVITY_TIMEOUT_MS}`);
    console.log(`[ProcessMgr] CONTINUE_MAX_ATTEMPTS: ${CONTINUE_MAX_ATTEMPTS}`);
    console.log(`[ProcessMgr] continuationEnabled: ${continuationEnabled}`);

    let runtime!: AcpxRuntime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any — acpx 未导出 AcpRuntimeHandle 类型
    let handle: any = null;

    try {
      console.log(`[ProcessMgr] Creating runtime and session...`);
      ({ runtime, handle } = await createRuntimeAndSession());

      while (ctx.continueAttempt <= CONTINUE_MAX_ATTEMPTS) {
        const elapsed = Date.now() - taskStartTime;
        if (elapsed >= effectiveTimeoutMs) {
          console.log(`[ProcessMgr] Task overall timeout (${effectiveTimeoutMs / 1000}s), terminating`);
          break;
        }
        const remainingTimeoutMs = effectiveTimeoutMs - elapsed;

        if (ctx.lastStrategy === 'destroy_new_session' && ctx.continueAttempt > 0) {
          console.log(`[ProcessMgr] Rebuilding session (destroy_new_session strategy)`);
          ({ runtime, handle } = await createRuntimeAndSession());
        }

        const currentInstruction = ctx.continueAttempt === 0
          ? ctx.originalInstruction
          : buildContinuationPrompt(ctx);

        console.log(`[ProcessMgr] Sending prompt (attempt ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS})`);

        state.inactivityTimeoutTriggered = false;

        const turn = runtime.startTurn({
          handle,
          text: currentInstruction,
          mode: 'prompt',
          requestId: `${taskId}-turn-${ctx.continueAttempt}`,
          timeoutMs: Math.min(remainingTimeoutMs, INACTIVITY_TIMEOUT_MS > 0 ? INACTIVITY_TIMEOUT_MS * 2 : remainingTimeoutMs),
        });

        // Consume events in background — resets inactivity timer on each event
        const eventsPromise = (async () => {
          for await (const event of (turn.events as AsyncIterable<AcpRuntimeEvent>)) {
            mapAndForwardEvent(event, onEvent, state, ctx);
            if (continuationEnabled && INACTIVITY_TIMEOUT_MS > 0) {
              if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
              state.inactivityTimer = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT_MS);
            }
          }
        })();

        const inactivityPromise = continuationEnabled
          ? new Promise<never>((_, reject) => { state.inactivityTimeoutReject = reject; })
          : new Promise<never>(() => { });

        const taskTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Task overall timeout after ${remainingTimeoutMs / 1000}s`)), remainingTimeoutMs);
        });

        try {
          const result = await Promise.race([
            turn.result as Promise<AcpRuntimeTurnResult>,
            inactivityPromise,
            taskTimeoutPromise,
          ]);

          if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
          state.inactivityTimeoutReject = null;

          console.log(`[ProcessMgr] Turn completed with status=${result.status}`);

          if (state.currentSkill && onEvent) {
            ctx.completedSkills.push(state.currentSkill);
            onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
            state.currentSkill = null;
          }

          if (result.status === 'completed') {
            console.log(`[ProcessMgr] ========== RUN AGENT COMPLETE ==========`);
            await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
            return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
          }

          if (result.status === 'cancelled') {
            console.log(`[ProcessMgr] Turn cancelled, same session continuation`);
            ctx.lastStrategy = 'cancel_same_session';
            ctx.continueAttempt = 0;
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

          // result.status === 'failed'
          const error = result.error;
          console.log(`[ProcessMgr] Turn failed: ${error?.message}`);

          if (error?.retryable && hasSubstantialOutput(state.stdout)) {
            console.log(`[ProcessMgr] Retryable error after substantial output — tolerating`);
            if (state.currentSkill && onEvent) {
              ctx.completedSkills.push(state.currentSkill);
              onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
              state.currentSkill = null;
            }
            await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
            return { exitCode: 0, stdout: state.stdout, stderr: error.message };
          }

          if (error?.code === 'ACP_BACKEND_UNAVAILABLE' || error?.code === 'ACP_BACKEND_MISSING') {
            console.log(`[ProcessMgr] Agent backend unavailable: ${error.code}`);
            await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
            return { exitCode: 2, stdout: state.stdout, stderr: `Agent unavailable: ${error.message}` };
          }

          const classified = classifyAcpError(error?.message ?? 'Unknown error');
          if (!classified.isCritical && hasSubstantialOutput(state.stdout)) {
            console.log(`[ProcessMgr] Non-critical turn error after substantial output`);
            if (state.currentSkill && onEvent) {
              ctx.completedSkills.push(state.currentSkill);
              onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
            }
            await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
            return { exitCode: 0, stdout: state.stdout, stderr: error?.message ?? '' };
          }

          if (!state.inactivityTimeoutTriggered) state.stderr += error?.message ?? '';
          if (onEvent) {
            onEvent({ type: 'error', message: error?.message ?? 'Turn failed', timestamp: new Date().toISOString() });
          }
          await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
          return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const isInactivityTimeout = errorMsg.includes('Inactivity timeout');

          if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
          state.inactivityTimeoutReject = null;

          if (!isInactivityTimeout) {
            // Runtime error (not inactivity)
            if (isAcpRuntimeError(error as object)) {
              const acpErr = error as { code?: string; message?: string };
              const exitCode = acpErr.code === 'ACP_BACKEND_MISSING' || acpErr.code === 'ACP_BACKEND_UNAVAILABLE' ? 2 : 1;
              console.log(`[ProcessMgr] ACP runtime error: ${acpErr.code} - ${acpErr.message}`);
              if (!state.inactivityTimeoutTriggered) state.stderr += acpErr.message ?? '';
              if (onEvent) {
                onEvent({ type: 'error', message: acpErr.message ?? 'ACP error', timestamp: new Date().toISOString() });
              }
              return { exitCode, stdout: state.stdout, stderr: state.stderr };
            }

            const classified = classifyAcpError(errorMsg);
            console.log(`[ProcessMgr] Error: ${errorMsg} (category=${classified.category}, isCritical=${classified.isCritical})`);

            if (!state.inactivityTimeoutTriggered) state.stderr += errorMsg;

            if (onEvent) {
              onEvent({ type: classified.isCritical ? 'error' : 'phase_error', message: errorMsg, phase: classified.category, timestamp: new Date().toISOString() });
            }

            if (hasSubstantialOutput(state.stdout) && !classified.isCritical) {
              console.log(`[ProcessMgr] Non-critical error after substantial output`);
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

          // === Inactivity timeout → Continuation ===
          ctx.continueAttempt++;
          console.log(`[ProcessMgr] Inactivity timeout, attempt ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS}`);

          if (ctx.continueAttempt > CONTINUE_MAX_ATTEMPTS) {
            console.log(`[ProcessMgr] Exceeded max continuation attempts (${CONTINUE_MAX_ATTEMPTS})`);
            if (onEvent) {
              onEvent({
                type: 'error',
                message: `Agent 连续 ${CONTINUE_MAX_ATTEMPTS} 次无响应，任务终止`,
                timestamp: new Date().toISOString(),
              });
            }
            state.stderr += `\nExceeded max continuation attempts (${CONTINUE_MAX_ATTEMPTS})`;
            await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
            return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };
          }

          if (onEvent) {
            onEvent({
              type: 'continuation_attempt',
              message: `Agent 无响应 ${INACTIVITY_TIMEOUT_MS / 1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`,
              timestamp: new Date().toISOString(),
            });
          }

          // Strategy A: cancel current turn
          try {
            console.log(`[ProcessMgr] Trying Strategy A: turn.cancel()`);
            await turn.cancel({ reason: 'inactivity' });

            const cancelResult = await Promise.race([
              turn.result as Promise<AcpRuntimeTurnResult>,
              new Promise<null>(resolve => setTimeout(() => resolve(null), CANCEL_WAIT_MS)),
            ]);

            if (cancelResult?.status === 'cancelled') {
              console.log(`[ProcessMgr] Cancel succeeded, same session continuation`);
              ctx.lastStrategy = 'cancel_same_session';
              ctx.continueAttempt = 0;
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

            if (cancelResult?.status === 'completed') {
              console.log(`[ProcessMgr] Cancel returned completed - task actually completed`);
              if (state.currentSkill && onEvent) {
                ctx.completedSkills.push(state.currentSkill);
                onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp: new Date().toISOString() });
              }
              await runtime.close({ handle, reason: 'turn-error', discardPersistentState: true });
              return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
            }

            console.log(`[ProcessMgr] Cancel timeout or unexpected result, fallback to Strategy B`);
          } catch (cancelErr) {
            console.log(`[ProcessMgr] Strategy A failed: ${cancelErr}, fallback to Strategy B`);
          }

          // Strategy B: close + new session
          console.log(`[ProcessMgr] Executing Strategy B: close + new session`);
          ctx.lastStrategy = 'destroy_new_session';

          if (onEvent) {
            onEvent({
              type: 'continuation_fallback',
              message: 'Cancel 无响应，重建会话续推',
              timestamp: new Date().toISOString(),
            });
          }

          {
            try {
              await runtime.close({ handle, reason: 'strategy-b-preserve', discardPersistentState: false });
            } catch { /* ignore */ }
            // runtime will be reassigned by createRuntimeAndSession() on next loop iteration
            handle = null;
          }

          continue;
        }
      }

      console.log(`[ProcessMgr] ========== RUN AGENT FAILED ==========`);
      await runtime.close({ handle, reason: 'task-failed', discardPersistentState: true });
      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[ProcessMgr] ========== RUN AGENT ERROR ==========`);
      console.log(`[ProcessMgr] Error: ${errorMsg}`);

      if (isAcpRuntimeError(error as object)) {
        const acpErr = error as { code?: string; message?: string };
        const exitCode = acpErr.code === 'ACP_BACKEND_MISSING' || acpErr.code === 'ACP_BACKEND_UNAVAILABLE' ? 2 : 1;
        if (!state.inactivityTimeoutTriggered) state.stderr += acpErr.message ?? '';
        if (onEvent) {
          onEvent({ type: 'error', message: acpErr.message ?? 'ACP error', timestamp: new Date().toISOString() });
        }
        return { exitCode, stdout: state.stdout, stderr: state.stderr };
      }

      const classified = classifyAcpError(errorMsg);
      if (!state.inactivityTimeoutTriggered) state.stderr += errorMsg;

      if (onEvent) {
        onEvent({ type: classified.isCritical ? 'error' : 'phase_error', message: errorMsg, phase: classified.category, timestamp: new Date().toISOString() });
      }

      if (hasSubstantialOutput(state.stdout) && !classified.isCritical) {
        return { exitCode: 0, stdout: state.stdout, stderr: state.stderr };
      }

      return { exitCode: 1, stdout: state.stdout, stderr: state.stderr };

    } finally {
      console.log(`[ProcessMgr] Finally: cleaning up`);
      if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); }
      this.processes.delete(taskId);
      console.log(`[ProcessMgr] Cleanup done`);
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
          log('warn', 'opencode command timeout, killing process', { timeoutMs });
          proc.kill();
        }
      }, timeoutMs || 7 * 24 * 3600 * 1000);
    });
  }
}

// ============================================================================
// acpx Event Mapping
// ============================================================================

function mapAndForwardEvent(
  event: AcpRuntimeEvent,
  onEvent: AgentEventCallback | undefined,
  state: RunState,
  ctx: ContinuationContext,
): void {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case 'text_delta': {
      const content = event.text;
      state.textChunks.push(content);
      if (state.textChunks.length > 5) state.textChunks.shift();
      state.stdout += content;

      ctx.eventHistory.push({ type: 'agent_message_chunk', content, timestamp });
      if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();

      if (onEvent) {
        onEvent({ type: 'agent_message_chunk', content, timestamp });
      }
      break;
    }

    case 'tool_call': {
      const isUpdate = event.tag === 'tool_call_update';
      const toolName = event.title ?? event.kind ?? 'unknown';

      if (!isUpdate) {
        ctx.eventHistory.push({ type: 'tool_call', tool: toolName.toLowerCase(), input: event.rawInput, timestamp });
        if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();

        // Skill tracking
        const actualToolName = toolName.toLowerCase();
        const isSkillCall = actualToolName === 'skill'
          || (typeof event.rawInput === 'object' && event.rawInput !== null && ('skill' in (event.rawInput as object) || 'skill_name' in (event.rawInput as object)));

        if (isSkillCall && onEvent) {
          let skillName = extractSkillName(event.rawInput) || 'unknown';

          if (skillName === 'unknown') {
            skillName = inferSkillNameFromContext(state.textChunks) || 'unknown';
          }

          if (state.currentSkill && state.currentSkill !== skillName) {
            ctx.completedSkills.push(state.currentSkill);
            onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp });
          }

          state.currentSkill = skillName;
          onEvent({ type: 'skill_start', skill: skillName, content: `开始执行 Skill: ${skillName}`, timestamp });
        }

        // Agent/task tool skill detection
        if ((actualToolName === 'agent' || actualToolName === 'task') && onEvent) {
          const description = (event.rawInput as any)?.description || '';
          const skillMatch = description.match(/执行\s*([a-zA-Z0-9_-]+)\s*安全检测/);
          if (skillMatch?.[1]) {
            const skillName = skillMatch[1];
            if (state.currentSkill && state.currentSkill !== skillName) {
              ctx.completedSkills.push(state.currentSkill);
              onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp });
            }
            state.currentSkill = skillName;
            onEvent({ type: 'skill_start', skill: skillName, content: `Agent 执行 Skill: ${skillName}`, timestamp });
          }
        }

        if (onEvent) {
          onEvent({ type: 'tool_call', tool: actualToolName, input: event.rawInput, timestamp });
        }
      } else {
        // tool_call_update
        const output = String(event.rawOutput ?? event.text ?? '');

        ctx.eventHistory.push({ type: 'tool_call_update', output, timestamp });
        if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();

        if (state.currentSkill === 'unknown' && output) {
          const launchMatch = output.match(/(?:Launching|Invoking|Running|Executing)\s+skill[:\s]+([a-zA-Z][a-zA-Z0-9_-]+)/i);
          if (launchMatch?.[1]) {
            state.currentSkill = launchMatch[1];
            if (onEvent) {
              onEvent({ type: 'skill_start', skill: state.currentSkill, content: `Skill 名称已修正: ${state.currentSkill}`, timestamp });
            }
          }
        }

        if (onEvent) {
          onEvent({ type: 'tool_call_update', output, timestamp });
        }
      }
      break;
    }

    case 'status': {
      if (event.tag === 'usage_update' || event.tag === 'available_commands_update') {
        // alive signal only — timer is reset by the caller
        return;
      }
      if (onEvent) {
        onEvent({ type: 'log_chunk', content: event.text, level: 'agent', timestamp });
      }
      break;
    }

    case 'error': {
      const classified = classifyAcpError(event.message);
      console.log(`[ProcessMgr] EVENT error: ${event.message} (category=${classified.category}, isCritical=${classified.isCritical})`);
      state.stderr += event.message;
      if (onEvent) {
        onEvent({
          type: classified.isCritical ? 'error' : 'phase_error',
          message: event.message,
          phase: classified.category,
          timestamp,
        });
      }
      break;
    }

    case 'done': {
      // startTurn() does NOT emit 'done' — only runTurn() does.
      // If we receive one, it's unexpected. Log it.
      console.log(`[ProcessMgr] Unexpected 'done' event in startTurn stream: stopReason=${event.stopReason}`);
      break;
    }
  }
}

// ============================================================================
// Skill Name Extraction (unchanged)
// ============================================================================

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

  const slashMatch = fullText.match(/\/([a-zA-Z][a-zA-Z0-9_-]+)/);
  if (slashMatch) return slashMatch[1];

  const quotedMatch = fullText.match(/[`"']([a-zA-Z][a-zA-Z0-9_-]+)[`"']/);
  if (quotedMatch) return quotedMatch[1];

  const invokeMatch = fullText.match(/(?:invoking|launching|calling|using|invoke|launch|call|use)\s+(?:the\s+)?(?:skill\s+)?`?([a-zA-Z][a-zA-Z0-9_-]+)`?/i);
  if (invokeMatch) return invokeMatch[1];

  const skillLabelMatch = fullText.match(/skill[:\s]+([a-zA-Z][a-zA-Z0-9_-]+)/i);
  if (skillLabelMatch) return skillLabelMatch[1];

  const lastWord = fullText.match(/\b([a-zA-Z][a-zA-Z0-9_-]{2,})\b/g);
  if (lastWord && lastWord.length > 0) return lastWord[lastWord.length - 1];

  return null;
}

// ============================================================================
// Error Classification (unchanged logic)
// ============================================================================

export interface ClassifiedError {
  isCritical: boolean;
  category: 'title_generation' | 'rate_limit' | 'task_logic' | 'unknown';
  rawMessage: string;
}

export function classifyAcpError(message: string): ClassifiedError {
  if (/title.*generat|generat.*title|session.*title|title.*generator/i.test(message)) {
    return { isCritical: false, category: 'title_generation', rawMessage: message };
  }

  if (/AI_RetryError|RetryError|rate.*limit|429|FreeUsageLimitError/i.test(message)) {
    return { isCritical: false, category: 'rate_limit', rawMessage: message };
  }

  return { isCritical: true, category: 'unknown', rawMessage: message };
}

export function hasSubstantialOutput(stdout: string, minLength = 100): boolean {
  const stripped = stdout.replace(/\s+/g, '').trim();
  return stripped.length >= minLength;
}

// ============================================================================
// Continuation Prompt Builders (unchanged)
// ============================================================================

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
