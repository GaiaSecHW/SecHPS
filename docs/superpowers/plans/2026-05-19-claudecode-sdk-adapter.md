# Claude Code SDK Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ACP protocol-based Claude Code integration with direct `@anthropic-ai/claude-agent-sdk` integration, enabling skill name capture via `canUseTool` hook for self-evolution analytics.

**Architecture:** Create a new `ClaudeCodeClient` class in `codeswarm/packages/sdk-adapter/src/` that wraps `@anthropic-ai/claude-agent-sdk`'s `query()` function. The existing `ACPClient` is preserved for opencode engine. The `ProcessManager` will select the appropriate client based on engine type.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, TypeScript, Node.js streams

---

## File Structure

| File | Purpose |
|------|---------|
| `codeswarm/packages/sdk-adapter/src/index.ts` | **NEW** - ClaudeCodeClient class |
| `codeswarm/packages/sdk-adapter/src/types.ts` | **NEW** - SDK adapter types |
| `codeswarm/packages/sdk-adapter/package.json` | **NEW** - package config |
| `codeswarm/packages/sdk-adapter/tsconfig.json` | **NEW** - TypeScript config |
| `codeswarm/packages/worker/src/process-manager.ts` | **MODIFY** - Add SDK adapter support |
| `codeswarm/packages/acp/src/index.ts` | **NO CHANGE** - ACP client for opencode |

---

## Chunk 1: SDK Adapter Package Setup

- [ ] **Step 1: Create `codeswarm/packages/sdk-adapter/package.json`**

```json
{
  "name": "@codeswarm/sdk-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `codeswarm/packages/sdk-adapter/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `codeswarm/packages/sdk-adapter/src/types.ts`**

```typescript
import type { AbortController as AbortControllerType } from '@anthropic-ai/claude-agent-sdk';

export interface SDKClientEvents {
  text: (content: string) => void;
  toolCall: (toolName: string, input: unknown) => void;
  toolResult: (toolName: string, result: unknown) => void;
  skillStart: (skillName: string) => void;
  skillComplete: (skillName: string) => void;
  error: (message: string) => void;
  sessionCreated: (sessionId: string) => void;
}

export interface SDKClientConfig {
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  agent?: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

export type SDKClientEventHandlers = Partial<SDKClientEvents>;

export interface SkillInvocation {
  skillName: string;
  startTime: string;
  endTime?: string;
  input?: unknown;
  output?: unknown;
  success?: boolean;
}

export interface SDKClient {
  on(handlers: SDKClientEventHandlers): void;
  start(config: SDKClientConfig): Promise<void>;
  createSession(agent?: string): Promise<string>;
  sendPrompt(prompt: string): Promise<void>;
  destroy(): Promise<void>;
  getSkillInvocations(): SkillInvocation[];
}
```

- [ ] **Step 4: Create `codeswarm/packages/sdk-adapter/src/index.ts`**

```typescript
import { query, type AbortController as ACMAbortController } from '@anthropic-ai/claude-agent-sdk';
import type { SDKClientConfig, SDKClientEventHandlers, SkillInvocation } from './types.js';

export { type SkillInvocation } from './types.js';

export class ClaudeCodeClient {
  private handlers: SDKClientEventHandlers = {};
  private sessionId: string | null = null;
  private abortController: ACMAbortController | null = null;
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
    // Generate a mock session ID for compatibility
    this.sessionId = `sdk-session-${Date.now()}`;
    console.log(`[SDK] Session created: ${this.sessionId}`);
    this.handlers.sessionCreated?.(this.sessionId);
    return this.sessionId;
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active session');

    const spawnEnv = { ...process.env } as Record<string, string | undefined>;
    if (this.config.env) {
      Object.assign(spawnEnv, this.config.env);
    }
    if (this.config.apiKey) {
      spawnEnv.ANTHROPIC_API_KEY = this.config.apiKey;
    }
    if (this.config.apiBaseUrl) {
      spawnEnv.ANTHROPIC_BASE_URL = this.config.apiBaseUrl;
    }

    this.abortController = new AbortController();
    const sdkOptions = {
      env: spawnEnv,
      cwd: this.config.cwd,
      model: this.config.model || undefined,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController: this.abortController,
      maxTurns: 200,
      canUseTool: async (toolName: string, input: unknown) => {
        // === SKILL CAPTURE (key feature) ===
        if (toolName === 'Skill') {
          const skillName = typeof input === 'object' && input !== null
            ? ((input as Record<string, unknown>).skill as string || (input as Record<string, unknown>).skill_name as string || 'unknown')
            : 'unknown';
          
          console.log(`[SDK] canUseTool Skill: ${skillName}, input: ${JSON.stringify(input)?.slice(0, 100)}`);

          if (this.currentSkill) {
            this.handlers.skillComplete?.(this.currentSkill);
            const idx = this.skillInvocations.findIndex(s => s.skillName === this.currentSkill && !s.endTime);
            if (idx >= 0) this.skillInvocations[idx].endTime = new Date().toISOString();
          }

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
      const iter = query({ prompt, options: sdkOptions as any });

      for await (const msg of iter) {
        if (this.destroyed) break;

        // Handle text chunks
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

        // Handle tool results
        if (msg.type === 'user') {
          const userMsg = msg as { tool_use_result?: unknown; parent_tool_use_id?: string };
          if (userMsg.tool_use_result !== undefined) {
            this.handlers.toolResult?.('unknown', userMsg.tool_use_result);
            
            // Complete current skill if this is a skill result
            if (this.currentSkill) {
              const idx = this.skillInvocations.findIndex(s => s.skillName === this.currentSkill && !s.endTime);
              if (idx >= 0) {
                this.skillInvocations[idx].output = userMsg.tool_use_result;
                this.skillInvocations[idx].success = true;
              }
              this.handlers.skillComplete?.(this.currentSkill);
              this.currentSkill = null;
            }
          }
        }

        // Handle errors
        if (msg.type === 'error' || (msg as any).type === 'result' && (msg as any).subtype === 'error') {
          const err = (msg as any).error || (msg as any).errors?.join('; ') || 'Unknown error';
          this.handlers.error?.(String(err));
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
```

- [ ] **Step 5: Build SDK adapter**

Run: `cd codeswarm/packages/sdk-adapter && pnpm install && pnpm build`

Expected: Compiles without errors

---

## Chunk 2: Integrate SDK Adapter into ProcessManager

- [ ] **Step 1: Modify `codeswarm/packages/worker/src/process-manager.ts` - add import and SDK client initialization**

Find the imports section (lines 1-6) and add:

```typescript
import { ClaudeCodeClient, type SkillInvocation } from '@codeswarm/sdk-adapter';
```

- [ ] **Step 2: Modify `runAgent` method to support SDK client (lines 129-427)**

In the `runAgent` method, after line 156 (try block), add SDK detection:

```typescript
// Check if we should use SDK adapter for claudecode
const useSdkAdapter = engine === 'claudecode';
console.log(`[ProcessMgr] Using SDK adapter: ${useSdkAdapter}`);
```

- [ ] **Step 3: Add new `runAgentWithSDK` method**

Add this new method after `runAgent` (before `runOpencodeCommand`):

```typescript
async runAgentWithSDK(
  taskId: string,
  workspace: string,
  agentName: string,
  apiKey?: string,
  model?: string,
  env?: Record<string, string>,
  instruction?: string,
  onEvent?: AgentEventCallback,
  apiBaseUrl?: string,
): Promise<RunAgentResult> {
  let stdout = '';
  let client: ClaudeCodeClient | null = null;
  const skillInvocations: SkillInvocation[] = [];

  console.log(`[ProcessMgr] ========== SDK RUN AGENT START ==========`);
  console.log(`[ProcessMgr] taskId: ${taskId}`);
  console.log(`[ProcessMgr] workspace: ${workspace}`);
  console.log(`[ProcessMgr] agentName: ${agentName}`);
  console.log(`[ProcessMgr] model: ${model}`);

  try {
    client = new ClaudeCodeClient();

    client.on({
      text: (content: string) => {
        stdout += content;
        if (onEvent) {
          onEvent({
            type: 'agent_message_chunk',
            content,
            timestamp: new Date().toISOString(),
          });
        }
      },
      toolCall: (toolName: string, input: unknown) => {
        console.log(`[ProcessMgr] SDK toolCall: ${toolName}, input: ${JSON.stringify(input)?.slice(0, 100)}`);
        if (onEvent) {
          onEvent({
            type: 'tool_call',
            tool: toolName,
            input,
            timestamp: new Date().toISOString(),
          });
        }
      },
      skillStart: (skillName: string) => {
        console.log(`[ProcessMgr] SDK skillStart: ${skillName}`);
        if (onEvent) {
          onEvent({
            type: 'skill_start',
            skill: skillName,
            content: `开始执行 Skill: ${skillName}`,
            timestamp: new Date().toISOString(),
          });
        }
      },
      skillComplete: (skillName: string) => {
        console.log(`[ProcessMgr] SDK skillComplete: ${skillName}`);
        if (onEvent) {
          onEvent({
            type: 'skill_complete',
            skill: skillName,
            timestamp: new Date().toISOString(),
          });
        }
      },
      error: (message: string) => {
        console.log(`[ProcessMgr] SDK error: ${message}`);
        if (onEvent) {
          onEvent({
            type: 'error',
            message,
            timestamp: new Date().toISOString(),
          });
        }
      },
      sessionCreated: (sessionId: string) => {
        console.log(`[ProcessMgr] SDK sessionCreated: ${sessionId}`);
        if (onEvent) {
          onEvent({
            type: 'session_created',
            message: sessionId,
            timestamp: new Date().toISOString(),
          });
        }
      },
    });

    const mergedEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    if (env) Object.assign(mergedEnv, env);
    if (apiKey) mergedEnv.ANTHROPIC_API_KEY = apiKey;
    if (model) mergedEnv.ANTHROPIC_MODEL = model;
    if (apiBaseUrl) mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl;

    await client.start({ cwd: workspace, env: mergedEnv, model, agent: agentName, apiKey, apiBaseUrl });
    await client.createSession(agentName);

    this.processes.set(taskId, {
      client,
      workspace,
      sessionId: `sdk-${taskId}`,
      createdAt: Date.now(),
    } as any);

    await client.sendPrompt(instruction || agentName);

    // Collect skill invocations for debugging
    const invocations = client.getSkillInvocations();
    console.log(`[ProcessMgr] SDK skill invocations: ${JSON.stringify(invocations)}`);

    return {
      exitCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ProcessMgr] SDK error: ${errorMsg}`);
    return {
      exitCode: 1,
      stdout,
      stderr: errorMsg,
    };
  } finally {
    if (client) await client.destroy();
    this.processes.delete(taskId);
    console.log(`[ProcessMgr] ========== SDK RUN AGENT COMPLETE ==========`);
  }
}
```

- [ ] **Step 4: Modify engine selection in `runAgent`**

Find lines 329-335 where engine is checked for claudecode. Instead of launching `claude-agent-acp` via command, route to SDK adapter:

```typescript
// REPLACE the existing claudecode block (lines 329-335) with:
if (engine === 'claudecode') {
  // Use SDK adapter for claudecode engine
  console.log(`[ProcessMgr] Using SDK adapter for claudecode engine`);
  return this.runAgentWithSDK(
    taskId,
    workspace,
    agentName,
    apiKey,
    model,
    mergedEnv,
    instruction,
    onEvent,
    apiBaseUrl,
  );
}
```

- [ ] **Step 5: Build and verify**

Run: `cd codeswarm/packages/worker && pnpm build`

Expected: Compiles without errors

---

## Chunk 3: End-to-End Testing

- [ ] **Step 1: Start the worker**

Run: `cd codeswarm && pnpm dev:worker`

Expected: Worker starts without errors

- [ ] **Step 2: Create a test task via API**

```bash
curl -X POST "http://localhost:3000/api/codeswarm/tasks" \
  -H "Content-Type: application/json" \
  -d '{"instruction": "/api-scan", "engine": "claudecode", "workspacePath": "D:/shared-workspace/1b6bedb6-41a8-4c7c-9e49-7bebac5f5330"}'
```

- [ ] **Step 3: Check logs for skill capture**

Expected in worker logs:
```
[SDK] canUseTool Skill: scan-init, input: {"skill":"scan-init",...}
[ProcessMgr] SDK skillStart: scan-init
[SDK] canUseTool Skill: scan-log, input: {"skill":"scan-log",...}
[ProcessMgr] SDK skillStart: scan-log
```

- [ ] **Step 4: Verify Dashboard displays correct skill names**

Expected: Dashboard shows `scan-init`, `scan-log`, `api-rules` with proper skill_start/skill_complete events (not "unknown")

---

## Chunk 4: Commit Changes

- [ ] **Step 1: Stage and commit**

```bash
git add codeswarm/packages/sdk-adapter/
git add codeswarm/packages/worker/src/process-manager.ts
git commit -m "feat: Add @anthropic-ai/claude-agent-sdk adapter for Claude Code with skill capture

- Add @codeswarm/sdk-adapter package wrapping official SDK
- Implement canUseTool hook to capture skill names before execution
- Track skill invocations with timing for self-evolution analytics
- Integrate SDK adapter into ProcessManager for claudecode engine

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] SDK adapter package compiles without errors
- [ ] Worker uses SDK adapter when engine='claudecode'
- [ ] `canUseTool` callback receives skill tool calls with skill name in input
- [ ] Dashboard displays correct skill names (not "unknown")
- [ ] Skill invocation records include timing data for analytics
- [ ] Existing opencode engine (ACP) still works unchanged