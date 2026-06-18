# Task Debug Console Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Debug UI task creation into a three-engine advanced debug console for OpenCode, Claude Code, and Script tasks.

**Architecture:** Keep `TaskDebugPanel` as the container for state, submit, worker loading, and SSE logs. Move form sections, payload construction, validation, and templates into focused `task-debug/*` modules so engine-specific logic is explicit and testable through type/build/manual checks.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS, Fastify scheduler endpoint `/api/codeswarm/task/submit`.

---

## Source References

- Spec: `docs/superpowers/specs/2026-06-18-task-debug-console-design.md`
- Current UI container: `packages/debug-ui/src/components/TaskDebugPanel.tsx`
- Submit route: `packages/scheduler/src/routes/task.ts`
- Payload schema: `packages/types/src/index.ts`
- Debug UI package scripts: `packages/debug-ui/package.json`

## File Structure

Create these focused files:

- `packages/debug-ui/src/components/task-debug/types.ts`
  - Owns `TaskEngine`, `TaskDebugForm`, `SubmitTaskPayload`, `ValidationIssue`, `TaskTemplate` types.
- `packages/debug-ui/src/components/task-debug/payload.ts`
  - Owns `buildSubmitPayload`, JSON parsing helpers, empty-field filtering, env merging, and MCP shape checks.
- `packages/debug-ui/src/components/task-debug/validation.ts`
  - Owns `validateSubmitPayload` and submit-blocking issue helpers.
- `packages/debug-ui/src/components/task-debug/templates.ts`
  - Owns built-in templates and `applyTaskTemplate`.
- `packages/debug-ui/src/components/task-debug/EngineSelector.tsx`
  - Left-column engine cards and compact status summary.
- `packages/debug-ui/src/components/task-debug/TaskBaseFields.tsx`
  - Shared task fields.
- `packages/debug-ui/src/components/task-debug/EngineFields.tsx`
  - Engine-specific form fields.
- `packages/debug-ui/src/components/task-debug/ToolDispatchFields.tsx`
  - Tool mode fields.
- `packages/debug-ui/src/components/task-debug/AdvancedFields.tsx`
  - Env, skills, mcps, and target product fields.
- `packages/debug-ui/src/components/task-debug/PayloadPreview.tsx`
  - Right-column JSON preview.
- `packages/debug-ui/src/components/task-debug/ValidationSummary.tsx`
  - Right-column error/warning list.
- `packages/debug-ui/src/components/task-debug/TaskTemplates.tsx`
  - Template buttons.

Modify:

- `packages/debug-ui/src/components/TaskDebugPanel.tsx`
  - Convert to three-column workbench container.
  - Use new helper functions/components.
  - Preserve worker fetch, submit request, toast behavior, and SSE log panel.

Do not modify:

Before running any checklist commit step, confirm Boss has explicitly authorized commits in this session. If not authorized, skip the commit command and leave changes staged/unstaged for review.

- `packages/scheduler/src/routes/task.ts`
- `packages/types/src/index.ts`
- Database schema
- Worker engine runtime

---

## Chunk 1: Types And Payload Builder

### Task 1: Add Debug Form Types

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/types.ts`

- [ ] **Step 1: Create the task-debug directory and types file**

Create `packages/debug-ui/src/components/task-debug/types.ts` with:

```ts
import type { ReactNode } from 'react';

export type TaskEngine = 'opencode' | 'claudecode' | 'script';
export type ValidationSeverity = 'error' | 'warning';

export interface WorkerOption {
  nodeId: string;
  address: string;
  status: string;
}

export interface TaskDebugForm {
  instruction: string;
  projectPath: string;
  workspacePath: string;
  platformTaskId: string;
  apiKey: string;
  timeoutSec: number;
  preferredWorkerNodeId: string;
  engine: TaskEngine;
  model: string;
  apiBaseUrl: string;
  maxTokens: number;
  contextWindow: number;
  commandJson: string;
  scriptCwd: string;
  toolId: string;
  toolPath: string;
  toolWorkDir: string;
  skills: string;
  mcps: string;
  env: string;
  targetProduct: string;
}

export interface SubmitTaskPayload {
  instruction: string;
  engine: TaskEngine;
  workspacePath?: string;
  projectPath?: string;
  apiKey?: string;
  timeoutSec?: number;
  preferredWorkerNodeId?: string;
  model?: string;
  apiBaseUrl?: string;
  maxTokens?: number;
  contextWindow?: number;
  command?: string[];
  scriptCwd?: string;
  toolId?: string;
  toolPath?: string;
  toolWorkDir?: string;
  skills?: string[];
  mcps?: unknown[];
  env?: Record<string, string>;
  targetProduct?: string;
}

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
}

export interface TaskTemplate {
  id: string;
  label: string;
  description: string;
  engine: TaskEngine;
  icon?: ReactNode;
  apply: (form: TaskDebugForm) => TaskDebugForm;
}

export function createDefaultTaskDebugForm(): TaskDebugForm {
  return {
    instruction: '',
    projectPath: '',
    workspacePath: '',
    platformTaskId: '',
    apiKey: '',
    timeoutSec: 300,
    preferredWorkerNodeId: '',
    engine: 'opencode',
    model: '',
    apiBaseUrl: '',
    maxTokens: 0,
    contextWindow: 0,
    commandJson: '["bash", "scripts/build.sh"]',
    scriptCwd: '',
    toolId: '',
    toolPath: '',
    toolWorkDir: '',
    skills: '',
    mcps: '[]',
    env: '',
    targetProduct: '',
  };
}
```

- [ ] **Step 2: Run TypeScript build to catch syntax errors**

Run:

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: build may still pass because the file is not imported yet. If it fails, fix syntax/type errors before continuing.

- [ ] **Step 3: Commit type scaffold if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/types.ts
git commit -m "feat(debug-ui): add task debug form types"
```

### Task 2: Add Payload Builder And Parsers

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/payload.ts`

- [ ] **Step 1: Create payload helper file**

Create `packages/debug-ui/src/components/task-debug/payload.ts` with:

```ts
import type { SubmitTaskPayload, TaskDebugForm } from './types.js';

export interface ParseResult<T> {
  value?: T;
  error?: string;
}

function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function splitCommaList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function parseJsonObject(value: string): ParseResult<Record<string, string>> {
  if (!value.trim()) return { value: undefined };

  try {
    const parsed = JSON.parse(value.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'env 必须是 JSON 对象' };
    }

    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item !== 'string') {
        return { error: `env.${key} 必须是字符串` };
      }
    }

    return { value: parsed as Record<string, string> };
  } catch {
    return { error: 'env JSON 格式无效' };
  }
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function isValidMcpService(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const service = value as Record<string, unknown>;
  if (service.type === 'local') {
    if (!isNonEmptyStringArray(service.command)) return false;
    if (service.environment !== undefined && !isStringRecord(service.environment)) return false;
  } else if (service.type === 'remote') {
    if (typeof service.url !== 'string' || !service.url.trim()) return false;
    try {
      new URL(service.url);
    } catch {
      return false;
    }
    if (service.headers !== undefined && !isStringRecord(service.headers)) return false;
  } else {
    return false;
  }

  if (service.enabled !== undefined && typeof service.enabled !== 'boolean') return false;
  if (service.timeout !== undefined && typeof service.timeout !== 'number') return false;
  return true;
}

export function parseMcps(value: string): ParseResult<unknown[]> {
  if (!value.trim()) return { value: undefined };

  try {
    const parsed = JSON.parse(value.trim());
    if (!Array.isArray(parsed)) {
      return { error: 'mcps 必须是 JSON 数组' };
    }

    const invalidIndex = parsed.findIndex((item) => {
      if (typeof item === 'string') return item.trim().length === 0;
      return !isValidMcpService(item);
    });

    if (invalidIndex >= 0) {
      return { error: `mcps[${invalidIndex}] 必须是非空字符串或合法 MCP service 对象` };
    }

    return { value: parsed };
  } catch {
    return { error: 'mcps JSON 格式无效' };
  }
}

export function parseCommandJson(value: string): ParseResult<string[]> {
  if (!value.trim()) return { error: 'Script command 不能为空' };

  try {
    const parsed = JSON.parse(value.trim());
    if (!isNonEmptyStringArray(parsed)) {
      return { error: 'Script command 必须是非空字符串数组' };
    }
    return { value: parsed };
  } catch {
    return { error: 'Script command JSON 格式无效' };
  }
}

export function buildSubmitPayload(form: TaskDebugForm): SubmitTaskPayload {
  const envParsed = parseJsonObject(form.env).value || {};
  const reservedEnv = {
    ...(form.projectPath.trim() ? { INPUT_DIR: form.projectPath.trim() } : {}),
    ...(form.toolId.trim() && form.toolWorkDir.trim() ? { TOOL_WORK_DIR: form.toolWorkDir.trim() } : {}),
    ...(form.platformTaskId.trim() ? { PLATFORM_TASK_ID: form.platformTaskId.trim() } : {}),
  };
  const env = { ...envParsed, ...reservedEnv };
  const payload: SubmitTaskPayload = {
    instruction: form.instruction,
    engine: form.engine,
    workspacePath: trimToUndefined(form.workspacePath),
    projectPath: trimToUndefined(form.projectPath),
    apiKey: trimToUndefined(form.apiKey),
    timeoutSec: form.timeoutSec || undefined,
    preferredWorkerNodeId: trimToUndefined(form.preferredWorkerNodeId),
    model: trimToUndefined(form.model),
    apiBaseUrl: trimToUndefined(form.apiBaseUrl),
    toolId: trimToUndefined(form.toolId),
    toolPath: form.toolId.trim() ? trimToUndefined(form.toolPath) : undefined,
    toolWorkDir: trimToUndefined(form.toolWorkDir),
    skills: splitCommaList(form.skills),
    mcps: parseMcps(form.mcps).value,
    env: Object.keys(env).length > 0 ? env : undefined,
    targetProduct: trimToUndefined(form.targetProduct),
  };

  if (form.engine === 'opencode') {
    payload.maxTokens = form.maxTokens > 0 ? form.maxTokens : undefined;
    payload.contextWindow = form.contextWindow > 0 ? form.contextWindow : undefined;
  }

  if (form.engine === 'script') {
    payload.command = parseCommandJson(form.commandJson).value;
    payload.scriptCwd = trimToUndefined(form.scriptCwd);
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as SubmitTaskPayload;
}
```

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS. Fix any ESM import/type errors.

- [ ] **Step 3: Commit payload helpers if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/payload.ts
git commit -m "feat(debug-ui): add task payload builder"
```

### Task 3: Add Validation Helpers

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/validation.ts`

- [ ] **Step 1: Create validation helper file**

Create `packages/debug-ui/src/components/task-debug/validation.ts` with:

```ts
import { parseCommandJson, parseJsonObject, parseMcps } from './payload.js';
import type { SubmitTaskPayload, TaskDebugForm, ValidationIssue } from './types.js';

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function validateSubmitPayload(form: TaskDebugForm, _payload: SubmitTaskPayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!form.instruction.trim()) {
    issues.push({ id: 'instruction-required', severity: 'error', message: '执行指令不能为空' });
  }

  if (form.timeoutSec < 60 || form.timeoutSec > 3600) {
    issues.push({ id: 'timeout-range', severity: 'error', message: '超时必须在 60 到 3600 秒之间' });
  }

  const envResult = parseJsonObject(form.env);
  if (envResult.error) {
    issues.push({ id: 'env-json', severity: 'error', message: envResult.error });
  }

  const mcpsResult = parseMcps(form.mcps);
  if (mcpsResult.error) {
    issues.push({ id: 'mcps-json', severity: 'error', message: mcpsResult.error });
  }

  if (form.engine === 'script') {
    const commandResult = parseCommandJson(form.commandJson);
    if (commandResult.error) {
      issues.push({ id: 'script-command', severity: 'error', message: commandResult.error });
    }
    if (!form.scriptCwd.trim()) {
      issues.push({ id: 'script-cwd', severity: 'warning', message: '未填写 scriptCwd，将由 Worker 使用默认工作目录' });
    }
  }

  if (form.engine === 'opencode' && !form.model.trim()) {
    issues.push({ id: 'opencode-model', severity: 'warning', message: 'OpenCode 未填写模型，将使用 Worker 默认配置' });
  }

  if (form.toolId.trim() && !form.toolPath.trim()) {
    issues.push({ id: 'tool-path', severity: 'warning', message: 'Tool 模式未填写 toolPath，确认 Worker 是否可自行解析' });
  }

  return issues;
}
```

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 3: Commit validation helpers if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/validation.ts
git commit -m "feat(debug-ui): add task form validation"
```

### Task 4: Add Templates

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/templates.ts`

- [ ] **Step 1: Create template helper file**

Create `packages/debug-ui/src/components/task-debug/templates.ts` with:

```ts
import type { TaskDebugForm, TaskTemplate } from './types.js';

function keepExisting(existing: string, fallback: string): string {
  return existing.trim() ? existing : fallback;
}

export function applyTaskTemplate(form: TaskDebugForm, template: TaskTemplate): TaskDebugForm {
  return template.apply(form);
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'opencode-security-audit',
    label: 'OpenCode 安全审计',
    description: '生成安全审计任务示例',
    engine: 'opencode',
    apply: (form) => ({
      ...form,
      engine: 'opencode',
      instruction: keepExisting(form.instruction, '分析这个代码库的安全漏洞，重点关注 OWASP Top 10、敏感信息泄露、认证和授权问题，并给出修复建议。'),
      model: keepExisting(form.model, 'MiniMax-M2.7'),
      targetProduct: keepExisting(form.targetProduct, 'codeswarm'),
    }),
  },
  {
    id: 'claudecode-analysis',
    label: 'Claude Code 代码分析',
    description: '生成 Claude Code 代码分析任务示例',
    engine: 'claudecode',
    apply: (form) => ({
      ...form,
      engine: 'claudecode',
      instruction: keepExisting(form.instruction, '分析当前代码实现，指出主要风险、可维护性问题和推荐改进步骤。'),
      model: keepExisting(form.model, 'claude-sonnet-4-6'),
    }),
  },
  {
    id: 'script-command',
    label: 'Script 命令执行',
    description: '生成 Script 引擎命令执行示例',
    engine: 'script',
    apply: (form) => ({
      ...form,
      engine: 'script',
      instruction: keepExisting(form.instruction, '执行脚本任务'),
      commandJson: keepExisting(form.commandJson, '["bash", "scripts/build.sh"]'),
      scriptCwd: keepExisting(form.scriptCwd, form.workspacePath || form.projectPath),
    }),
  },
];
```

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 3: Commit templates if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/templates.ts
git commit -m "feat(debug-ui): add task debug templates"
```

---

## Chunk 2: Form Components

### Task 5: Add Engine Selector

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/EngineSelector.tsx`

- [ ] **Step 1: Create EngineSelector component**

Create `packages/debug-ui/src/components/task-debug/EngineSelector.tsx` with:

```tsx
import { Code2, FileTerminal, Workflow } from 'lucide-react';
import type { TaskDebugForm, TaskEngine, ValidationIssue, WorkerOption } from './types.js';

interface EngineSelectorProps {
  form: TaskDebugForm;
  issues: ValidationIssue[];
  workerOptions: WorkerOption[];
  onEngineChange: (engine: TaskEngine) => void;
}

const ENGINES = [
  { id: 'opencode' as const, label: 'OpenCode', description: '模型与 provider 调试', icon: Code2 },
  { id: 'claudecode' as const, label: 'Claude Code', description: 'Claude Code ACP 执行', icon: Workflow },
  { id: 'script' as const, label: 'Script', description: '直接 argv 命令执行', icon: FileTerminal },
];

export function EngineSelector({ form, issues, workerOptions, onEngineChange }: EngineSelectorProps) {
  const selectedWorker = workerOptions.find((worker) => worker.nodeId === form.preferredWorkerNodeId);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <aside className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-100 mb-3">执行引擎</h3>
        <div className="space-y-2">
          {ENGINES.map((engine) => {
            const Icon = engine.icon;
            const active = form.engine === engine.id;
            return (
              <button
                key={engine.id}
                type="button"
                onClick={() => onEngineChange(engine.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                    : 'border-gray-700 bg-dark-bg text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{engine.label}</span>
                </div>
                <p className="text-xs opacity-75 mt-1">{engine.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 rounded-lg bg-dark-bg border border-gray-700 space-y-2 text-xs">
        <h4 className="font-medium text-gray-200">当前摘要</h4>
        <div className="text-gray-400">Worker: {selectedWorker ? selectedWorker.nodeId : '自动分配'}</div>
        <div className="text-gray-400">Timeout: {form.timeoutSec}s</div>
        <div className="text-gray-400">Workspace: {form.workspacePath ? '自定义' : '自动分配'}</div>
        <div className="text-gray-400">Tool: {form.toolId.trim() ? '已启用' : '未启用'}</div>
        <div className="pt-2 border-t border-gray-700 text-gray-400">
          校验: <span className="text-red-400">{errorCount} error</span> / <span className="text-yellow-400">{warningCount} warning</span>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 3: Commit EngineSelector if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/EngineSelector.tsx
git commit -m "feat(debug-ui): add task engine selector"
```

### Task 6: Add Shared Field Components

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/TaskBaseFields.tsx`
- Create: `packages/debug-ui/src/components/task-debug/ToolDispatchFields.tsx`
- Create: `packages/debug-ui/src/components/task-debug/AdvancedFields.tsx`

- [ ] **Step 1: Create TaskBaseFields**

Create `packages/debug-ui/src/components/task-debug/TaskBaseFields.tsx` with controlled inputs for:

- `instruction`
- `projectPath`
- `workspacePath`
- `platformTaskId`
- `preferredWorkerNodeId`
- `timeoutSec`

Use this prop shape:

```tsx
import type { TaskDebugForm, WorkerOption } from './types.js';

interface TaskBaseFieldsProps {
  form: TaskDebugForm;
  workerOptions: WorkerOption[];
  updateForm: (patch: Partial<TaskDebugForm>) => void;
}
```

Implementation requirements:

- Use existing dark Tailwind classes from `TaskDebugPanel.tsx`.
- Keep the existing instruction placeholder.
- Filter workers with `worker.status === 'online'`.
- Keep timeout input min `60` and max `3600`.

- [ ] **Step 2: Create ToolDispatchFields**

Create `packages/debug-ui/src/components/task-debug/ToolDispatchFields.tsx` with inputs for:

- `toolId`
- `toolPath`
- `toolWorkDir`

Implementation requirements:

- Show a yellow badge when `toolId.trim()` is non-empty.
- Only show `toolPath` and `toolWorkDir` when Tool mode is active.
- Keep existing explanatory text that `toolTaskId` is generated automatically by backend.

- [ ] **Step 3: Create AdvancedFields**

Create `packages/debug-ui/src/components/task-debug/AdvancedFields.tsx` with inputs for:

- `skills`
- `mcps`
- `targetProduct`
- `env`

Implementation requirements:

- Do not include the old `scripts` field.
- `mcps` is a textarea with JSON array placeholder:

```json
[{"type":"local","command":["npx","my-mcp"]}]
```

- `env` remains a JSON object textarea.
- Explain that `INPUT_DIR`, `TOOL_WORK_DIR`, and `PLATFORM_TASK_ID` are reserved/merged fields.

- [ ] **Step 4: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 5: Commit shared fields if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/TaskBaseFields.tsx packages/debug-ui/src/components/task-debug/ToolDispatchFields.tsx packages/debug-ui/src/components/task-debug/AdvancedFields.tsx
git commit -m "feat(debug-ui): add task debug shared fields"
```

### Task 7: Add Engine-Specific Fields

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/EngineFields.tsx`

- [ ] **Step 1: Create EngineFields component**

Create `packages/debug-ui/src/components/task-debug/EngineFields.tsx`.

Requirements:

- Export one `EngineFields` component.
- Render OpenCode fields when `form.engine === 'opencode'`:
  - `model`
  - `apiBaseUrl`
  - `apiKey`
  - `maxTokens`
  - `contextWindow`
- Render Claude Code fields when `form.engine === 'claudecode'`:
  - `model`
  - `apiKey`
  - `apiBaseUrl`
- Render Script fields when `form.engine === 'script'`:
  - `commandJson` textarea
  - `scriptCwd`
- Do not render `maxTokens` or `contextWindow` for Claude Code or Script.
- Use JSON array command placeholder:

```json
["python", "run.py", "--target", "/workspace"]
```

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 3: Commit engine fields if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/EngineFields.tsx
git commit -m "feat(debug-ui): add engine-specific task fields"
```

---

## Chunk 3: Preview, Validation, Templates

### Task 8: Add Right-Side Preview Components

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/PayloadPreview.tsx`
- Create: `packages/debug-ui/src/components/task-debug/ValidationSummary.tsx`

- [ ] **Step 1: Create PayloadPreview component**

Create `packages/debug-ui/src/components/task-debug/PayloadPreview.tsx` with:

```tsx
import type { SubmitTaskPayload } from './types.js';

interface PayloadPreviewProps {
  payload: SubmitTaskPayload;
}

export function PayloadPreview({ payload }: PayloadPreviewProps) {
  return (
    <section className="p-4 rounded-lg bg-dark-bg border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Payload 预览</h3>
        <span className="text-xs text-gray-500">POST /api/codeswarm/task/submit</span>
      </div>
      <pre className="max-h-80 overflow-auto text-xs text-gray-300 whitespace-pre-wrap font-mono">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </section>
  );
}
```

- [ ] **Step 2: Create ValidationSummary component**

Create `packages/debug-ui/src/components/task-debug/ValidationSummary.tsx`.

Requirements:

- Accept `issues: ValidationIssue[]`.
- Show green “校验通过” when there are no issues.
- Show red rows for `error` issues.
- Show yellow rows for `warning` issues.
- Keep the component small and presentational.

- [ ] **Step 3: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 4: Commit preview components if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/PayloadPreview.tsx packages/debug-ui/src/components/task-debug/ValidationSummary.tsx
git commit -m "feat(debug-ui): add task payload preview"
```

### Task 9: Add Template Buttons Component

**Files:**
- Create: `packages/debug-ui/src/components/task-debug/TaskTemplates.tsx`

- [ ] **Step 1: Create TaskTemplates component**

Create `packages/debug-ui/src/components/task-debug/TaskTemplates.tsx`.

Requirements:

- Import `TASK_TEMPLATES` and `applyTaskTemplate` from `templates.ts`.
- Accept `form` and `setForm`/`onApply` callback.
- Render three compact buttons.
- On click, apply the template and update form.
- Do not submit automatically.

- [ ] **Step 2: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 3: Commit template buttons if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/task-debug/TaskTemplates.tsx
git commit -m "feat(debug-ui): add task debug templates UI"
```

---

## Chunk 4: Integrate Workbench

### Task 10: Refactor TaskDebugPanel State And Payload Flow

**Files:**
- Modify: `packages/debug-ui/src/components/TaskDebugPanel.tsx`

- [ ] **Step 1: Update imports**

In `TaskDebugPanel.tsx`, import:

```ts
import { EngineSelector } from './task-debug/EngineSelector.js';
import { TaskBaseFields } from './task-debug/TaskBaseFields.js';
import { EngineFields } from './task-debug/EngineFields.js';
import { ToolDispatchFields } from './task-debug/ToolDispatchFields.js';
import { AdvancedFields } from './task-debug/AdvancedFields.js';
import { PayloadPreview } from './task-debug/PayloadPreview.js';
import { ValidationSummary } from './task-debug/ValidationSummary.js';
import { TaskTemplates } from './task-debug/TaskTemplates.js';
import { buildSubmitPayload } from './task-debug/payload.js';
import { hasBlockingIssues, validateSubmitPayload } from './task-debug/validation.js';
import { createDefaultTaskDebugForm } from './task-debug/types.js';
import type { TaskDebugForm } from './task-debug/types.js';
```

Remove unused icons and local `WorkerOption` if replaced by shared type.

- [ ] **Step 2: Replace inline form state initializer**

Replace the current `useState({ ... })` form initializer with:

```ts
const [form, setForm] = useState<TaskDebugForm>(() => createDefaultTaskDebugForm());
```

Add:

```ts
const updateForm = (patch: Partial<TaskDebugForm>) => {
  setForm((prev) => ({ ...prev, ...patch }));
};

const payload = buildSubmitPayload(form);
const validationIssues = validateSubmitPayload(form, payload);
const submitDisabled = loading || hasBlockingIssues(validationIssues);
```

- [ ] **Step 3: Update handleSubmit to use built payload**

In `handleSubmit`:

- Remove old inline env parsing.
- Before submit, if `hasBlockingIssues(validationIssues)` show the first error toast and return.
- Send `payload` as request body.

Expected structure:

```ts
const blockingIssue = validationIssues.find((issue) => issue.severity === 'error');
if (blockingIssue) {
  toast.error(blockingIssue.message);
  return;
}

const resp = await fetch('/api/codeswarm/task/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

- [ ] **Step 4: Update post-success reset**

After successful submit, keep current behavior of clearing task-specific fields, but do not clear engine config:

```ts
setForm((prev) => ({
  ...prev,
  instruction: '',
  projectPath: '',
  workspacePath: '',
  platformTaskId: '',
}));
```

- [ ] **Step 5: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS or import/component errors only. Fix before continuing.

- [ ] **Step 6: Commit state integration if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/TaskDebugPanel.tsx
git commit -m "feat(debug-ui): integrate task payload flow"
```

### Task 11: Replace Long Form With Three-Column Layout

**Files:**
- Modify: `packages/debug-ui/src/components/TaskDebugPanel.tsx`

- [ ] **Step 1: Replace the current form body**

Inside the expanded form, replace the old single-column sections with a three-column grid:

```tsx
<form onSubmit={handleSubmit} className="p-6 border-t border-gray-700/50 space-y-4">
  <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_340px] gap-6 items-start">
    <EngineSelector
      form={form}
      issues={validationIssues}
      workerOptions={workerOptions}
      onEngineChange={(engine) => updateForm({ engine })}
    />

    <div className="space-y-4">
      <TaskBaseFields form={form} workerOptions={workerOptions} updateForm={updateForm} />
      <EngineFields form={form} updateForm={updateForm} />
      <ToolDispatchFields form={form} updateForm={updateForm} />
      <AdvancedFields form={form} updateForm={updateForm} />
    </div>

    <div className="space-y-4 xl:sticky xl:top-4">
      <TaskTemplates form={form} onApply={setForm} />
      <ValidationSummary issues={validationIssues} />
      <PayloadPreview payload={payload} />
    </div>
  </div>

  <div className="flex justify-end">
    <button type="submit" disabled={submitDisabled} className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
      {loading ? (
        <><Loader2 className="w-4 h-4 animate-spin" /><span>分发中...</span></>
      ) : (
        <><Play className="w-4 h-4" /><span>创建并分发任务</span></>
      )}
    </button>
  </div>
</form>
```

- [ ] **Step 2: Remove old inline sections**

Remove old inline JSX for:

- Engine radio selector.
- Instruction/basic fields.
- Model config collapsible section.
- Tool dispatch collapsible section.
- Advanced config collapsible section.

Keep:

- Header.
- SSE effects.
- Log panel.
- `cleanLogText`.
- `clearLogs`.

- [ ] **Step 3: Remove unused CollapsibleSection if no longer used**

If `CollapsibleSection` is no longer referenced in `TaskDebugPanel.tsx`, delete it from the file and remove related icon imports.

- [ ] **Step 4: Run Debug UI build**

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS. Fix unused imports and TS errors.

- [ ] **Step 5: Commit layout integration if Boss authorized commits**

```bash
git add packages/debug-ui/src/components/TaskDebugPanel.tsx
git commit -m "feat(debug-ui): add three-column task console"
```

---

## Chunk 5: Verification And Polish

### Task 12: Verify Implementation-Level Checks

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Build debug-ui**

Run:

```bash
pnpm --filter @codeswarm/debug-ui build
```

Expected: PASS.

- [ ] **Step 2: Run root typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: May fail if some packages do not define `typecheck`; if so, record the exact output and rely on `pnpm --filter @codeswarm/debug-ui build` plus root build.

- [ ] **Step 3: Run root build**

Run:

```bash
pnpm run build
```

Expected: PASS. If unrelated packages fail, capture output and diagnose before claiming completion.

- [ ] **Step 4: Manual payload verification in browser**

Run:

```bash
pnpm run dev:debug-ui
```

Open the Debug UI and verify:

- OpenCode selected: payload includes `engine: "opencode"`, model fields, no `command`.
- Claude Code selected: payload includes `engine: "claudecode"`, no `command`, no OpenCode-only token fields unless intentionally shared.
- Script selected with `commandJson = ["bash", "scripts/build.sh"]`: payload includes `engine: "script"`, `command: ["bash", "scripts/build.sh"]`, and optional `scriptCwd`.
- Invalid `env = []` shows blocking validation error.
- Invalid `mcps = {}` shows blocking validation error.
- `mcps = ["filesystem", {"type":"local","command":["npx","server"]}, {"type":"remote","url":"https://example.com/mcp"}]` is accepted.
- Tool mode with `toolId` includes `toolId`; `toolPath` is sent only when filled; `toolWorkDir` merges into `env.TOOL_WORK_DIR`.
- No `scripts` field appears in payload preview.

- [ ] **Step 5: Verify task creation and logs if scheduler is available**

If local scheduler/worker are running, submit one low-risk task per engine or at least one OpenCode/Script task. Confirm:

- Toast shows created task ID.
- `onTaskCreated` refreshes task list.
- SSE log panel opens and shows either logs or a waiting state.

If scheduler/worker are not available, state that manual submit verification was skipped and why.

- [ ] **Step 6: Commit verification fixes if Boss authorized commits**

If verification required fixes:

```bash
git add packages/debug-ui/src/components/TaskDebugPanel.tsx packages/debug-ui/src/components/task-debug
git commit -m "fix(debug-ui): polish task debug console"
```

If no fixes were required, do not create an empty commit.

### Task 13: Final Review

**Files:**
- All files changed in this plan.

- [ ] **Step 1: Review changed files**

Run:

```bash
git status --short
git diff --stat
git diff
```

Expected:

- Only Debug UI task console files and docs/plans/spec files are changed.
- No backend, worker, database, or unrelated config changes.

- [ ] **Step 2: Check for accidental `scripts` payload support**

Search:

```bash
rg "scripts" packages/debug-ui/src/components/task-debug packages/debug-ui/src/components/TaskDebugPanel.tsx
```

Expected:

- No form field or payload rule sends `scripts`.
- Occurrences are allowed only if comments explicitly say not to send it.

- [ ] **Step 3: Check for old two-engine-only assumptions**

Search:

```bash
rg "opencode' \| 'claudecode|claudecode' \| 'opencode|engine === 'script'" packages/debug-ui/src/components
```

Expected:

- No type excludes `script`.
- Script-specific branches exist where required.

- [ ] **Step 4: Request code review**

Use `superpowers:requesting-code-review` or the configured code-review agent to review the implementation against:

- `docs/superpowers/specs/2026-06-18-task-debug-console-design.md`
- This plan file
- Current diff

- [ ] **Step 5: Fix review findings**

For each confirmed finding:

- Make the smallest fix.
- Re-run `pnpm --filter @codeswarm/debug-ui build`.
- Re-run affected manual checks if behavior changed.
- Commit the fix.

- [ ] **Step 6: Report completion**

Final response must include:

- Files changed.
- Verification commands and results.
- Manual checks completed or skipped with reason.
- Any residual risks.

---

## Implementation Notes

- Keep import paths ESM-compatible with `.js` suffix, matching project convention.
- Do not introduce compatibility code unless Boss requests it.
- Do not add a test framework in this task; the approved spec explicitly avoids it.
- Do not change scheduler/worker behavior.
- Do not persist custom templates.
- Do not parse shell command text into argv.
- Preserve existing real-time log rendering unless a type/import change forces a small adjustment.

## Expected Commit Sequence

If implementing directly, prefer these commit boundaries:

1. `feat(debug-ui): add task debug form types`
2. `feat(debug-ui): add task payload builder`
3. `feat(debug-ui): add task form validation`
4. `feat(debug-ui): add task debug templates`
5. `feat(debug-ui): add task engine selector`
6. `feat(debug-ui): add task debug shared fields`
7. `feat(debug-ui): add engine-specific task fields`
8. `feat(debug-ui): add task payload preview`
9. `feat(debug-ui): add task debug templates UI`
10. `feat(debug-ui): integrate task payload flow`
11. `feat(debug-ui): add three-column task console`
12. Optional: `fix(debug-ui): polish task debug console`

Do not commit unless Boss explicitly authorizes commits in this session.
