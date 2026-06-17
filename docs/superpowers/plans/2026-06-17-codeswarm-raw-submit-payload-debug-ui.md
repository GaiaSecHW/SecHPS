# CodeSwarm Raw Submit Payload Debug UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the original `/api/codeswarm/task/submit` request JSON and show it to the right of the existing “输入参数” panel in the debug-ui task list, while fixing tool-mode workspace path handling.

**Architecture:** Store the raw submit body on `CodeswarmTask` before scheduler normalization mutates effective task fields. The scheduler list/detail APIs return both effective fields and the raw payload; the debug UI renders the existing effective input JSON beside the new original request JSON. Tool-mode path allocation should prefer caller-provided `workspacePath` and `toolTaskId`, with `toolWorkDir/run` as the fallback workspace instead of `toolWorkDir/toolTaskId/run`.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, React, Tailwind-style classes, pnpm.

---

## File Structure

- Modify `prisma/schema.prisma`
  - Add `rawSubmitPayload String? @db.Text` to `CodeswarmTask`.
  - Keep it as text JSON to match existing JSON-ish fields (`skills`, `mcps`, `env`) and avoid provider-specific JSON migration risk.

- Modify `packages/scheduler/src/services/workspace.ts`
  - Change tool workspace fallback allocator from `toolWorkDir/toolTaskId/run` to `toolWorkDir/run`.
  - Keep the `toolTaskId` parameter out of the allocator signature unless a caller still needs it.

- Modify `packages/scheduler/src/routes/task.ts`
  - Add `toolTaskId?: string` to submit body type.
  - Capture `const rawSubmitPayload = JSON.stringify(body);` immediately after request body parsing.
  - In tool mode, use `body.toolTaskId` if provided; otherwise generate a new one.
  - In tool mode, use `body.workspacePath` first; otherwise use `allocateToolWorkspacePath(resolvedToolWorkDir)`.
  - Persist `rawSubmitPayload` in `prisma.codeswarmTask.create`.
  - Return/select `rawSubmitPayload` from `/api/codeswarm/task/list`; detail route already returns full task.

- Modify `packages/debug-ui/src/components/TaskResultViewer.tsx`
  - Add `rawSubmitPayload` to the `Task` interface.
  - Add helper to parse/display raw payload safely.
  - Replace the single “输入参数” panel block with a two-column responsive grid:
    - left: existing effective input params
    - right: new “原始输入参数” panel
  - Each panel gets its own copy button.
  - Existing tasks with no raw payload show “无原始输入参数记录”.

- Optional verification commands:
  - `pnpm db:generate`
  - `pnpm --filter @codeswarm/scheduler typecheck`
  - `pnpm --filter @codeswarm/debug-ui typecheck`
  - If available/fast enough: `pnpm typecheck`

---

## Chunk 1: Scheduler Data Model and Workspace Contract

### Task 1: Persist raw submit payload and fix tool workspace allocation

**Files:**
- Modify: `prisma/schema.prisma:13-64`
- Modify: `packages/scheduler/src/services/workspace.ts:32-38`
- Modify: `packages/scheduler/src/routes/task.ts:47-153`

- [ ] **Step 1: Add raw payload field to Prisma schema**

In `prisma/schema.prisma`, add the field near other request/input fields, for example after `env`:

```prisma
  env                   String?   // JSON
  rawSubmitPayload      String?   @db.Text // 原始 /api/codeswarm/task/submit 请求 JSON
```

- [ ] **Step 2: Regenerate Prisma client**

Run:

```bash
cd D:/work/claude-web-plaatform/20260609/SecHPS && pnpm db:generate
```

Expected: Prisma client generation succeeds. If `pnpm` reports missing dependencies, stop and report the dependency issue instead of editing generated files manually.

- [ ] **Step 3: Fix tool workspace fallback allocator**

In `packages/scheduler/src/services/workspace.ts`, replace:

```ts
/**
 * 为 tool 任务分配工作区路径
 * 格式: TOOL_WORK_DIR/toolTaskId/run
 */
export function allocateToolWorkspacePath(toolWorkDir: string, toolTaskId: string): string {
  return `${toolWorkDir}/${toolTaskId}/run`;
}
```

with:

```ts
/**
 * 为 tool 任务分配工作区路径
 * 格式: TOOL_WORK_DIR/run
 */
export function allocateToolWorkspacePath(toolWorkDir: string): string {
  return `${toolWorkDir.replace(/[\\/]+$/, '')}/run`;
}
```

Rationale: the upstream scheduler already treats `TOOL_WORK_DIR` as `/data/files/{project_id}/{platform_task_id}/{tool_task_id}`, so adding another `toolTaskId` duplicates a path segment.

- [ ] **Step 4: Update submit body type**

In `packages/scheduler/src/routes/task.ts`, extend the submit body type under tool fields:

```ts
      // Tool 调度字段
      toolId?: string;
      toolTaskId?: string;
      toolPath?: string;
      toolWorkDir?: string;
```

- [ ] **Step 5: Capture raw request payload before normalization**

Immediately after `const body = request.body as { ... };`, add:

```ts
    const rawSubmitPayload = JSON.stringify(body ?? {});
```

Do not build this from normalized fields. It must reflect the original request JSON from the caller.

- [ ] **Step 6: Use caller-provided toolTaskId and workspacePath in tool mode**

Replace the current tool-mode block:

```ts
    if (body.toolId) {
      const uuidPart = crypto.randomUUID().split('-')[0]; // 8 chars
      toolTaskId = `${body.toolId}-${uuidPart}-${Date.now()}`;
      resolvedToolWorkDir = normalizedEnv.toolWorkDir || process.env.TOOL_WORK_DIR || '/mnt/tool-workspace';
      toolWorkspacePath = allocateToolWorkspacePath(resolvedToolWorkDir, toolTaskId);
      ensureWorkspaceDir(toolWorkspacePath);
      normalizedEnv.env.TOOL_WORK_DIR = resolvedToolWorkDir;
      normalizedEnv.env.TOOL_ID = body.toolId;
      normalizedEnv.env.TOOL_TASK_ID = toolTaskId;
      logger.info(`[Task] Tool mode: toolTaskId=${toolTaskId}, workspace=${toolWorkspacePath}`);
    }
```

with:

```ts
    if (body.toolId) {
      const requestedToolTaskId = String(body.toolTaskId || '').trim();
      const uuidPart = crypto.randomUUID().split('-')[0]; // 8 chars
      toolTaskId = requestedToolTaskId || `${body.toolId}-${uuidPart}-${Date.now()}`;
      resolvedToolWorkDir = normalizedEnv.toolWorkDir || process.env.TOOL_WORK_DIR || '/mnt/tool-workspace';
      toolWorkspacePath = body.workspacePath || allocateToolWorkspacePath(resolvedToolWorkDir);
      ensureWorkspaceDir(toolWorkspacePath);
      normalizedEnv.env.TOOL_WORK_DIR = resolvedToolWorkDir;
      normalizedEnv.env.TOOL_ID = body.toolId;
      normalizedEnv.env.TOOL_TASK_ID = toolTaskId;
      logger.info(`[Task] Tool mode: toolTaskId=${toolTaskId}, workspace=${toolWorkspacePath}`);
    }
```

- [ ] **Step 7: Persist rawSubmitPayload and caller-compatible tool fields**

In the `prisma.codeswarmTask.create({ data: { ... } })` data object, add:

```ts
            rawSubmitPayload,
```

Keep existing effective fields. Ensure these lines still persist the resolved values:

```ts
            toolTaskId: toolTaskId || null,
            toolWorkDir: resolvedToolWorkDir || normalizedEnv.toolWorkDir || null,
```

- [ ] **Step 8: Include raw payload in task list API**

In `/api/codeswarm/task/list` select block, add:

```ts
          rawSubmitPayload: true,
```

The detail route returns `...task`, so it should include the new Prisma field automatically after regeneration.

- [ ] **Step 9: Run scheduler typecheck**

Run:

```bash
cd D:/work/claude-web-plaatform/20260609/SecHPS && pnpm --filter @codeswarm/scheduler typecheck
```

Expected: typecheck passes. If it fails because the Prisma client is stale, rerun `pnpm db:generate` and typecheck again. If it fails for unrelated pre-existing errors, capture the output and report it.

- [ ] **Step 10: Commit scheduler/data changes**

Only commit if the user explicitly asked to commit. If committing, use:

```bash
git add prisma/schema.prisma packages/scheduler/src/services/workspace.ts packages/scheduler/src/routes/task.ts
 git commit -m "fix(scheduler): preserve raw submit payload and tool workspace path"
```

Commit message body must end with:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Chunk 2: Debug UI Raw Input Panel

### Task 2: Render original request JSON beside effective input params

**Files:**
- Modify: `packages/debug-ui/src/components/TaskResultViewer.tsx:8-110`
- Modify: `packages/debug-ui/src/components/TaskResultViewer.tsx:302-313`

- [ ] **Step 1: Extend Task interface**

In `packages/debug-ui/src/components/TaskResultViewer.tsx`, add to `interface Task` near `env`:

```ts
  rawSubmitPayload: any;
```

- [ ] **Step 2: Add helper for display JSON**

After `parseJsonField`, add:

```ts
function formatJsonForDisplay(value: any) {
  const parsed = parseJsonField(value);
  if (parsed === null || parsed === undefined || parsed === '') return null;
  return parsed;
}
```

- [ ] **Step 3: Replace single input params panel with two-column grid**

Replace the existing block at `TaskResultViewer.tsx:302-313`:

```tsx
                    {/* Input Params */}
                    {(() => {
                      const params = buildInputParams(task);
                      const hasParams = Object.keys(params).length > 0;
                      if (!hasParams) return null;
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-medium text-gray-300">输入参数</h4><CopyButton text={JSON.stringify(params, null, 2)} /></div>
                          <div className="bg-gray-900 rounded-lg p-3 max-h-[70vh] overflow-auto"><pre className="text-xs text-cyan-400 font-mono whitespace-pre-wrap break-words">{JSON.stringify(params, null, 2)}</pre></div>
                        </div>
                      );
                    })()}
```

with:

```tsx
                    {/* Input Params */}
                    {(() => {
                      const params = buildInputParams(task);
                      const rawSubmitPayload = formatJsonForDisplay(task.rawSubmitPayload);
                      const hasParams = Object.keys(params).length > 0;
                      if (!hasParams && !rawSubmitPayload) return null;
                      const paramsJson = JSON.stringify(params, null, 2);
                      const rawJson = rawSubmitPayload ? JSON.stringify(rawSubmitPayload, null, 2) : '';
                      return (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                          {hasParams && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-medium text-gray-300">输入参数</h4>
                                <CopyButton text={paramsJson} />
                              </div>
                              <div className="bg-gray-900 rounded-lg p-3 max-h-[70vh] overflow-auto">
                                <pre className="text-xs text-cyan-400 font-mono whitespace-pre-wrap break-words">{paramsJson}</pre>
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-medium text-gray-300">原始输入参数</h4>
                              {rawSubmitPayload && <CopyButton text={rawJson} />}
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3 max-h-[70vh] overflow-auto">
                              {rawSubmitPayload ? (
                                <pre className="text-xs text-amber-300 font-mono whitespace-pre-wrap break-words">{rawJson}</pre>
                              ) : (
                                <p className="text-xs text-gray-500">无原始输入参数记录</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
```

- [ ] **Step 4: Run debug UI typecheck**

Run:

```bash
cd D:/work/claude-web-plaatform/20260609/SecHPS && pnpm --filter @codeswarm/debug-ui typecheck
```

Expected: typecheck passes. If it fails because the package lacks a typecheck script, run the project-level `pnpm typecheck` or `pnpm --filter @codeswarm/debug-ui build` and report the exact command used.

- [ ] **Step 5: Manual UI verification**

Start the scheduler/debug UI as appropriate for the local environment, then submit a task with a payload like:

```json
{
  "instruction": "debug raw payload",
  "toolId": "agent-app-1",
  "toolTaskId": "tool-task-1",
  "toolWorkDir": "/data/files/project/platform-task-1/tool-task-1",
  "workspacePath": "/data/files/project/platform-task-1/tool-task-1/run",
  "env": {
    "TOOL_WORK_DIR": "/data/files/project/platform-task-1/tool-task-1"
  }
}
```

Expected in task list expanded row:

- Left panel “输入参数” shows effective fields, including `workspacePath` equal to `/data/files/project/platform-task-1/tool-task-1/run`.
- Right panel “原始输入参数” shows the request body exactly, including the original `toolTaskId`, `toolWorkDir`, `workspacePath`, and `env`.
- There is no duplicated `/tool-task-1/tool-task-1/run` workspace path.

- [ ] **Step 6: Commit debug UI changes**

Only commit if the user explicitly asked to commit. If committing, use:

```bash
git add packages/debug-ui/src/components/TaskResultViewer.tsx
 git commit -m "feat(debug-ui): show raw submit payload"
```

Commit message body must end with:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Chunk 3: Final Verification

### Task 3: End-to-end validation

**Files:**
- Verify: `prisma/schema.prisma`
- Verify: `packages/scheduler/src/services/workspace.ts`
- Verify: `packages/scheduler/src/routes/task.ts`
- Verify: `packages/debug-ui/src/components/TaskResultViewer.tsx`

- [ ] **Step 1: Run full typecheck if feasible**

Run:

```bash
cd D:/work/claude-web-plaatform/20260609/SecHPS && pnpm typecheck
```

Expected: all packages typecheck. If unrelated packages fail, record failures and still report whether scheduler/debug-ui checks passed.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
cd D:/work/claude-web-plaatform/20260609/SecHPS && git diff -- prisma/schema.prisma packages/scheduler/src/services/workspace.ts packages/scheduler/src/routes/task.ts packages/debug-ui/src/components/TaskResultViewer.tsx
```

Expected:

- `rawSubmitPayload` is added to schema and API selection.
- Tool workspace fallback no longer appends `toolTaskId`.
- Submit route uses caller `toolTaskId`/`workspacePath` when present.
- Debug UI renders a two-column input section.

- [ ] **Step 3: Report final status**

Summarize:

- What changed.
- Which verification commands passed/failed.
- Whether manual UI verification was performed.
- Any migration/deploy note: run `pnpm db:push` or apply the equivalent Prisma migration/deployment process before deploying to an environment whose DB lacks `rawSubmitPayload`.
