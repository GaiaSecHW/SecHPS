import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKClientConfig, SDKClientEventHandlers, SkillInvocation } from './types.js';

export { type SkillInvocation } from './types.js';

export class ClaudeCodeClient {
  private handlers: SDKClientEventHandlers = {};
  private sessionId: string | null = null;
  private abortController: any = null;
  private currentSkill: string | null = null;
  private skillInvocations: SkillInvocation[] = [];
  private textBuffer: string[] = [];
  private _maxTextBuffer = 5;
  private initialized = false;
  private destroyed = false;
  private config!: SDKClientConfig;

  on(handlers: SDKClientEventHandlers): void {
    Object.assign(this.handlers, handlers);
  }

  async start(config: SDKClientConfig): Promise<void> {
    if (this.initialized) throw new Error('ClaudeCodeClient already started');
    if (this.destroyed) throw new Error('ClaudeCodeClient was destroyed');
    this.config = config;
    this.initialized = true;
    console.log(`[SDK] ClaudeCodeClient starting in ${config.cwd}`);
  }

  async createSession(_agent?: string): Promise<string> {
    if (!this.initialized) throw new Error('ClaudeCodeClient not initialized');
    this.sessionId = `sdk-session-${Date.now()}`;
    console.log(`[SDK] Session created: ${this.sessionId}`);
    this.handlers.sessionCreated?.(this.sessionId);
    return this.sessionId;
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active session');

    const spawnEnv: Record<string, string | undefined> = { ...process.env };
    if (this.config.env) {
      Object.assign(spawnEnv, this.config.env);
    }
    if (this.config.apiKey) {
      spawnEnv.ANTHROPIC_API_KEY = this.config.apiKey;
    }
    if (this.config.apiBaseUrl) {
      spawnEnv.ANTHROPIC_BASE_URL = this.config.apiBaseUrl;
    }
    // Ensure CLAUDE_API_KEY is set for Claude Code subprocess
    if (spawnEnv.ANTHROPIC_API_KEY && !spawnEnv.CLAUDE_API_KEY) {
      spawnEnv.CLAUDE_API_KEY = spawnEnv.ANTHROPIC_API_KEY;
    }
    // Ensure ANTHROPIC_BASE_URL is set from config
    if (this.config.apiBaseUrl && !spawnEnv.ANTHROPIC_BASE_URL) {
      spawnEnv.ANTHROPIC_BASE_URL = this.config.apiBaseUrl;
    }

    this.abortController = new AbortController();

    const sdkOptions: Record<string, unknown> = {
      env: spawnEnv,
      cwd: this.config.cwd,
      model: this.config.model || undefined,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController: this.abortController,
      maxTurns: 200,
      canUseTool: async (toolName: string, input: unknown) => {
        // === SKILL CAPTURE (key feature) ===
        if (toolName === 'Skill') {
          const skillName = typeof input === 'object' && input !== null
            ? ((input as Record<string, unknown>).skill as string
              || (input as Record<string, unknown>).skill_name as string
              || 'unknown')
            : 'unknown';

          console.log(`[SDK] canUseTool Skill: ${skillName}, input: ${JSON.stringify(input)?.slice(0, 200)}`);

          // Complete previous skill if still open
          if (this.currentSkill) {
            this.handlers.skillComplete?.(this.currentSkill);
            const idx = this.skillInvocations.findIndex(s => s.skillName === this.currentSkill && !s.endTime);
            if (idx >= 0) this.skillInvocations[idx].endTime = new Date().toISOString();
          }

          // Start new skill
          this.currentSkill = skillName;
          this.skillInvocations.push({
            skillName,
            startTime: new Date().toISOString(),
            input,
          });

          this.handlers.skillStart?.(skillName);
        }

        // Emit tool call event for ALL tools
        this.handlers.toolCall?.(toolName, input);

        return { behavior: 'allow' as const, updatedInput: input };
      },
    };

    try {
      console.log(`[SDK] Starting query with model: ${this.config.model || 'default'}`);
      const iter = query({ prompt, options: sdkOptions as any });

      for await (const msg of iter) {
        if (this.destroyed) break;

        // Handle assistant messages (text output)
        if (msg.type === 'assistant') {
          const asst = msg as { message?: { content?: unknown } };
          const content = asst.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === 'object') {
                const b = block as Record<string, unknown>;
                if (b.type === 'text') {
                  const text = String(b.text || '');
                  if (text) {
                    this.textBuffer.push(text);
                    if (this.textBuffer.length > this._maxTextBuffer) this.textBuffer.shift();
                    this.handlers.text?.(text);
                  }
                }
              }
            }
          }
        }

        // Handle tool results (user message with tool_use_result)
        if (msg.type === 'user') {
          const userMsg = msg as { tool_use_result?: unknown; parent_tool_use_id?: string };
          if (userMsg.tool_use_result !== undefined) {
            this.handlers.toolResult?.('unknown', userMsg.tool_use_result);

            // Complete current skill
            if (this.currentSkill) {
              const idx = this.skillInvocations.findIndex(s => s.skillName === this.currentSkill && !s.endTime);
              if (idx >= 0) {
                this.skillInvocations[idx].output = userMsg.tool_use_result;
                this.skillInvocations[idx].success = true;
                this.skillInvocations[idx].endTime = new Date().toISOString();
              }
              this.handlers.skillComplete?.(this.currentSkill);
              this.currentSkill = null;
            }
          }
        }

        // Handle stream events
        if (msg.type === 'stream_event') {
          const ev = (msg as { event?: unknown }).event;
          if (ev && typeof ev === 'object') {
            const streamEvent = ev as Record<string, unknown>;

            // Extract text delta
            const delta = streamEvent.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              this.handlers.text?.(delta.text);
            }
          }
          continue;
        }

        // Handle result (completion or error)
        if ((msg as any).type === 'result') {
          if ((msg as any).subtype === 'success') {
            console.log(`[SDK] Query completed successfully`);
            // Complete any open skill
            if (this.currentSkill) {
              const idx = this.skillInvocations.findIndex(s => s.skillName === this.currentSkill && !s.endTime);
              if (idx >= 0) {
                this.skillInvocations[idx].endTime = new Date().toISOString();
              }
              this.handlers.skillComplete?.(this.currentSkill);
              this.currentSkill = null;
            }
          } else if ((msg as any).subtype === 'error') {
            const err = (msg as any).errors?.join('; ') || 'Unknown error';
            console.error(`[SDK] Query failed: ${err}`);
            this.handlers.error?.(String(err));
          }
          break;
        }

        // Handle errors (try-catch above handles exceptions, but SDK may emit error events)
        if ((msg as any).type === 'error' || (msg as any).type === 'result' && (msg as any).subtype === 'error') {
          const errMsg = (msg as any).error || (msg as any).errors?.join('; ') || 'Unknown error';
          console.error(`[SDK] Error: ${errMsg}`);
          this.handlers.error?.(String(errMsg));
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[SDK] Query error: ${errMsg}`);
      this.handlers.error?.(errMsg);
      throw e;
    }
  }

  getSkillInvocations(): SkillInvocation[] {
    return [...this.skillInvocations];
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
    }
    this.initialized = false;
    console.log(`[SDK] ClaudeCodeClient destroyed, captured ${this.skillInvocations.length} skill invocations`);
  }
}