# CodeSwarm Worker Claude Code 引擎适配 - 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CodeSwarm Worker 中增加 Claude Code 引擎支持，复用 ACP 协议实现 opencode/claudecode 双引擎切换。

**Architecture:** 现有 `ACPClient` 基于 `@agentclientprotocol/sdk`，通过 `command` + `args` 参数控制 spawn 哪个 agent 进程。Claude Code 引擎使用 `@zed-industries/claude-code-acp` 作为 ACP 桥接，模型配置通过环境变量注入。

**Tech Stack:** TypeScript, `@agentclientprotocol/sdk`, `@zed-industries/claude-code-acp`, Next.js 16, React 19, Prisma, Zod

---

## Chunk 1: Worker 类型与 ACP 客户端

### Task 1: TaskPayloadSchema 新增 apiBaseUrl

**Files:**
- Modify: `codeswarm/packages/types/src/index.ts:101-125`

- [ ] **Step 1: 在 TaskPayloadSchema 中添加 apiBaseUrl 字段**

在 `codeswarm/packages/types/src/index.ts` 的 `TaskPayloadSchema` 中，在 `apiKey` 字段后添加：

```typescript
// line 110, 在 apiKey 之后添加:
apiBaseUrl: z.string().optional(),
```

- [ ] **Step 2: 验证类型编译**

Run: `cd codeswarm && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add codeswarm/packages/types/src/index.ts
git commit -m "feat(types): add apiBaseUrl to TaskPayloadSchema"
```

---

### Task 2: ACPClient args 可配置化 + raw 事件兜底 + 错误提示

**Files:**
- Modify: `codeswarm/packages/acp/src/index.ts`

- [ ] **Step 1: ACPClientConfig 新增 args 字段**

在 `codeswarm/packages/acp/src/index.ts` 的 `ACPClientConfig` 接口中，在 `agent` 字段后添加：

```typescript
/** Custom args (overrides default opencode args) */
args?: string[];
```

- [ ] **Step 2: start() 方法支持自定义 args**

修改 `start()` 方法中 line 84-100 的命令构造逻辑：

```typescript
// 替换 line 84-100:
// Determine command and args
let cmd: string;
let args: string[];
const isWin32 = process.platform === 'win32';

if (config.command) {
  cmd = config.command;
} else if (isWin32) {
  // On Windows, resolve opencode.exe directly to avoid cmd.exe pipe issues.
  const appData = process.env.APPDATA || '';
  const exePath = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  cmd = exePath;
} else {
  cmd = 'opencode';
}

// Use custom args if provided, otherwise default to opencode acp args
if (config.args) {
  args = config.args;
} else {
  args = ['acp', '--pure', '--print-logs', '--log-level', 'DEBUG', '--cwd', config.cwd];
}
```

- [ ] **Step 3: 改进 spawn 错误提示**

修改 line 166-173 的错误处理，区分不同 command 的安装提示：

```typescript
// 替换 line 166-173:
await new Promise(resolve => setTimeout(resolve, 100));
if (this._spawnError) {
  this.destroy();
  if (this._spawnError.message.includes('ENOENT')) {
    const cmdName = config.command || 'opencode';
    const installHint = cmdName === 'opencode'
      ? 'Install: npm i -g opencode-ai@latest'
      : `Install: npm i -g ${cmdName}`;
    throw new Error(`${cmdName} not found. ${installHint}`);
  }
  throw this._spawnError;
}
```

- [ ] **Step 4: handleSessionUpdate default 分支增加 raw 回调**

修改 line 286-291 的 default 分支：

```typescript
// 替换 line 286-291:
default:
  if (updateType) {
    console.log('[ACP] unknown update type:', updateType);
    this.eventHandlers.raw?.(JSON.stringify(update));
  }
```

- [ ] **Step 5: 验证编译**

Run: `cd codeswarm/packages/acp && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add codeswarm/packages/acp/src/index.ts
git commit -m "feat(acp): make ACPClient args configurable, add raw event fallback and better error messages"
```

---

### Task 3: ProcessManager 引擎分支 + 环境变量注入

**Files:**
- Modify: `codeswarm/packages/worker/src/process-manager.ts`

- [ ] **Step 1: runAgent() 签名新增 apiBaseUrl 参数**

在 `codeswarm/packages/worker/src/process-manager.ts` 的 `runAgent()` 方法签名中新增 `apiBaseUrl` 参数：

```typescript
// 替换 line 99-109 的方法签名:
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
```

- [ ] **Step 2: mergedEnv 中注入 ANTHROPIC_MODEL 和 ANTHROPIC_BASE_URL**

在 line 137 之后（mergedEnv keys 日志之后）添加环境变量注入：

```typescript
// 在 mergedEnv 构造后（约 line 137 之后）添加:
if (model) {
  mergedEnv.ANTHROPIC_MODEL = model;
  console.log(`[ProcessMgr] Added ANTHROPIC_MODEL=${model} to env`);
}
if (apiBaseUrl) {
  mergedEnv.ANTHROPIC_BASE_URL = apiBaseUrl;
  console.log(`[ProcessMgr] Added ANTHROPIC_BASE_URL=${apiBaseUrl} to env`);
}
```

- [ ] **Step 3: 根据 engine 构造不同的 ACPClientConfig**

替换 line 192-204 的 client.start() 调用：

```typescript
// 替换 Step D 部分:
console.log(`[ProcessMgr] Step D: Calling client.start()...`);

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
  model,
  agent: agentName,
};

if (engine === 'claudecode') {
  clientConfig.command = 'claude-code-acp';
  clientConfig.args = ['--cwd', workspace];
  console.log(`[ProcessMgr]   Using claude-code-acp engine`);
} else {
  console.log(`[ProcessMgr]   Using opencode engine (default)`);
}

console.log(`[ProcessMgr]   cwd: ${workspace}`);
console.log(`[ProcessMgr]   model: ${model}`);
console.log(`[ProcessMgr]   agent: ${agentName}`);
console.log(`[ProcessMgr]   command: ${clientConfig.command || 'opencode (default)'}`);

await client.start(clientConfig);
console.log(`[ProcessMgr] Step D DONE: client.start() completed`);
```

- [ ] **Step 4: 验证编译**

Run: `cd codeswarm/packages/worker && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add codeswarm/packages/worker/src/process-manager.ts
git commit -m "feat(worker): add engine branching in ProcessManager with ANTHROPIC_MODEL/BASE_URL injection"
```

---

### Task 4: EnvironmentFactory claudecode 环境适配

**Files:**
- Modify: `codeswarm/packages/worker/src/environment.ts`

- [ ] **Step 1: BuildResult 新增 engine 字段**

在 `codeswarm/packages/worker/src/environment.ts` 的 `BuildResult` 接口中新增：

```typescript
export interface BuildResult {
  workspacePath: string;
  agent?: string;
  instruction?: string;
  commandTemplate?: string;
  model?: string;
  engine?: 'opencode' | 'claudecode';  // 新增
}
```

- [ ] **Step 2: build() 方法签名新增 engine 参数**

修改 `build()` 方法签名（约 line 48）：

```typescript
async build(
  payload: TaskPayload,
  onProgress?: BuildProgressCallback,
  engine?: 'opencode' | 'claudecode',
): Promise<BuildResult> {
```

- [ ] **Step 3: NFS passthrough 模式下 claudecode 跳过 opencode.json**

在 NFS passthrough 模式中，将 opencode.json 读写逻辑（约 line 98-191）用 engine 判断包裹：

```typescript
// 在 line 97 "resolvedInstruction = payload.instruction ?? undefined;" 之后，
// 将 line 98-191 的 opencode.json 逻辑用条件包裹:

if (engine !== 'claudecode') {
  // 现有的 opencode.json 读写逻辑保持不变
  progress(`Step 2: 检查 opencode.json...`);
  const directOpencodeJsonPath = path.join(localWorkspacePath, 'opencode.json');
  // ... (所有现有 opencode.json 逻辑)
} else {
  progress(`Step 2: claudecode 引擎，跳过 opencode.json 读写`);
}

// NFS return 语句修改:
progress(`BUILD COMPLETE (NFS mode) - workspace: ${actualWorkspacePath}, agent: ${resolvedAgent}`);
return { workspacePath: actualWorkspacePath, agent: resolvedAgent, instruction: resolvedInstruction, commandTemplate, model: payload.model, engine };
```

- [ ] **Step 4: Local workspace 模式下 claudecode 跳过 opencode.json 生成**

在 local workspace 模式（约 line 197 开始）中，将 Step 3-5 和 Step 5-6 用 engine 判断包裹：

```typescript
// Step 3: 创建技能目录 (仅 opencode)
if (engine !== 'claudecode') {
  progress(`Step 3: 创建技能目录`);
  const skillsDir = path.join(workspacePath, '.opencode', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  // ... (现有技能拷贝逻辑)
} else {
  progress(`Step 3: claudecode 引擎，跳过技能目录创建`);
}

// Step 5: 生成 opencode.json (仅 opencode)
if (engine !== 'claudecode') {
  const opencodeConfig: Record<string, any> = {};
  // ... (现有 opencode.json 生成逻辑)
} else {
  progress(`Step 5: claudecode 引擎，跳过 opencode.json 生成`);
}

// local workspace return 修改:
progress(`BUILD COMPLETE (local mode) - workspace: ${workspacePath}`);
return { workspacePath, agent: payload.agent, engine };
```

- [ ] **Step 5: 验证编译**

Run: `cd codeswarm/packages/worker && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add codeswarm/packages/worker/src/environment.ts
git commit -m "feat(worker): adapt EnvironmentFactory for claudecode engine, skip opencode.json"
```

---

### Task 5: Daemon 传递 engine + apiBaseUrl + 日志补全

**Files:**
- Modify: `codeswarm/packages/worker/src/daemon.ts`

- [ ] **Step 1: envFactory.build() 传递 engine 参数**

修改 `executeTask()` 中约 line 219 的 build 调用：

```typescript
// 替换:
buildResult = await this.envFactory.build(payload, (msg) => {
// 为:
const engine: 'opencode' | 'claudecode' = payloadEngine || 'opencode';
buildResult = await this.envFactory.build(payload, (msg) => {
```

同时将 line 271 的 engine 声明移到 build 之前（删除 line 271 的重复声明）。

- [ ] **Step 2: processMgr.runAgent() 传递 apiBaseUrl**

修改约 line 306 的 runAgent 调用，新增 apiBaseUrl 参数：

```typescript
const result = await this.processMgr.runAgent(
  taskId,
  workspacePath,
  engine,
  agentName,
  apiKey,
  model,
  env,
  instruction,
  onEvent,
  payload.apiBaseUrl,  // 新增
);
```

- [ ] **Step 3: 日志补全 - apiBaseUrl 和 engine 注入**

在 `console.log` 区域（约 line 278-303）补充日志：

```typescript
console.log(`[Daemon] apiBaseUrl: ${payload.apiBaseUrl || 'none'}`);
```

- [ ] **Step 4: 验证编译**

Run: `cd codeswarm/packages/worker && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add codeswarm/packages/worker/src/daemon.ts
git commit -m "feat(worker): pass engine and apiBaseUrl through daemon, add logging"
```

---

## Chunk 2: 平台端 API apiBaseUrl 传递

### Task 6: Execute route 补全 apiBaseUrl

**Files:**
- Modify: `src/app/api/task-builder/tasks/[id]/execute/route.ts`

- [ ] **Step 1: ModelConfig select 新增 apiBaseUrl**

在 ModelConfig select 中（约 line 54-58）添加 `apiBaseUrl`:

```typescript
ModelConfig: {
  select: {
    apiKey: true,
    name: true,
    models: true,
    apiBaseUrl: true,  // 新增
  },
},
```

- [ ] **Step 2: 从 ModelConfig 读取 apiBaseUrl**

在约 line 149 附近（apiKey 赋值之后）添加：

```typescript
const apiKey = task.ModelConfig?.apiKey || undefined;
const apiBaseUrl = task.ModelConfig?.apiBaseUrl || undefined;  // 新增
```

- [ ] **Step 3: TaskPayload 构造传入 apiBaseUrl**

在 TaskPayload 构造处（约 line 160-170 的 INSERT 或 payload 对象）传入 apiBaseUrl。

- [ ] **Step 4: 验证编译**

Run: `cd D:/work/claude-web-plaatform/20260514/claude-web-platform && npx tsc --noEmit`
Expected: 无错误（或仅有已有的非本次改动的错误）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/task-builder/tasks/[id]/execute/route.ts
git commit -m "feat(api): pass apiBaseUrl from ModelConfig to task payload"
```

---

### Task 7: Dispatch route 传递 apiBaseUrl

**Files:**
- Modify: `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts`

- [ ] **Step 1: 在 payload 中传入 apiBaseUrl**

查看 dispatch route 中构造 payload 的位置，确保 `apiBaseUrl` 从 task 记录中读取并传入 payload。如果 task 记录有 `apiBaseUrl` 字段，则加入 payload 构造。

- [ ] **Step 2: 验证编译 + Commit**

```bash
git add src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts
git commit -m "feat(api): pass apiBaseUrl in dispatch payload"
```

---

## Chunk 3: 前端调试页面

### Task 8: TaskDebugPanel 引擎选择器

**Files:**
- Modify: `src/components/codeswarm/TaskDebugPanel.tsx`

- [ ] **Step 1: form state 新增 engine 字段**

在 `TaskDebugPanel.tsx` 的 form state（约 line 35-46）中新增 engine：

```typescript
const [form, setForm] = useState({
  instruction: '',
  agent: '',
  projectPath: '',
  workspacePath: '',
  apiKey: '',
  timeoutSec: 300,
  skills: '',
  mcps: '',
  preferredWorkerNodeId: '',
  engine: 'opencode' as 'opencode' | 'claudecode',  // 新增
});
```

- [ ] **Step 2: 添加引擎选择器 UI**

在表单中「执行方式」选择器之后（约 line 353），添加引擎选择器：

```tsx
{/* Engine Selector */}
<div>
  <label className="block text-sm font-medium text-gray-300 mb-2">
    执行引擎
  </label>
  <div className="flex gap-3">
    <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${form.engine === 'opencode' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
      <input
        type="radio"
        name="engine"
        value="opencode"
        checked={form.engine === 'opencode'}
        onChange={() => setForm({ ...form, engine: 'opencode' })}
        className="sr-only"
      />
      <span className="font-medium">OpenCode</span>
      <span className="text-xs opacity-70">ACP 协议</span>
    </label>
    <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${form.engine === 'claudecode' ? 'border-purple-500 bg-purple-500/20 text-purple-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
      <input
        type="radio"
        name="engine"
        value="claudecode"
        checked={form.engine === 'claudecode'}
        onChange={() => setForm({ ...form, engine: 'claudecode' })}
        className="sr-only"
      />
      <span className="font-medium">Claude Code</span>
      <span className="text-xs opacity-70">ACP 桥接</span>
    </label>
  </div>
</div>
```

- [ ] **Step 3: command 模式预览文本根据引擎切换**

修改 command 模式的 `startCommand`（约 line 226）：

```typescript
startCommand: form.engine === 'claudecode'
  ? `claude -p ${form.instruction}`
  : `opencode run --command ${form.instruction}`,
```

- [ ] **Step 4: payload 中传入 engine 字段**

在 instruction 模式和 command 模式的 payload 中都加入 `engine: form.engine`。

- [ ] **Step 5: 验证 UI + Commit**

在浏览器中打开调试面板，确认引擎选择器显示正确。

```bash
git add src/components/codeswarm/TaskDebugPanel.tsx
git commit -m "feat(ui): add engine selector to TaskDebugPanel"
```

---

### Task 9: LocalTestPanel + local-test route claudecode 分支

**Files:**
- Modify: `src/components/codeswarm/LocalTestPanel.tsx`
- Modify: `src/app/api/codeswarm/local-test/route.ts`

- [ ] **Step 1: LocalTestPanel state 新增 engine**

在 `LocalTestPanel.tsx` 中（约 line 92-111）新增 state：

```typescript
const [engine, setEngine] = useState<'opencode' | 'claudecode'>('opencode');
```

- [ ] **Step 2: 添加引擎选择 UI**

在工作区选择区域下方添加引擎选择：

```tsx
{/* Engine Selection */}
<div className="flex gap-2 mt-2">
  <button
    onClick={() => setEngine('opencode')}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${engine === 'opencode' ? 'bg-blue-500/20 text-blue-400 border border-blue-500' : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:text-gray-300'}`}
  >
    OpenCode
  </button>
  <button
    onClick={() => setEngine('claudecode')}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${engine === 'claudecode' ? 'bg-purple-500/20 text-purple-400 border border-purple-500' : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:text-gray-300'}`}
  >
    Claude Code
  </button>
</div>
```

- [ ] **Step 3: handleRun 传递 engine 参数**

修改 `handleRun()` 中的 fetch body（约 line 214-218）：

```typescript
body: JSON.stringify({ workspacePath, timeoutSec, engine }),
```

- [ ] **Step 4: local-test route.ts 新增 engine 参数**

在 `src/app/api/codeswarm/local-test/route.ts` 的 `LocalTestRequest` 接口中新增：

```typescript
interface LocalTestRequest {
  workspacePath: string;
  timeoutSec?: number;
  engine?: 'opencode' | 'claudecode';  // 新增
}
```

- [ ] **Step 5: executeTaskAsync 新增 claudecode 分支**

在 `executeTaskAsync()` 的参数中新增 `engine`，并在 Phase 2 fallback 中根据 engine 分支：

```typescript
function executeTaskAsync(
  taskId: string,
  workspacePath: string,
  timeoutSec: number,
  engine: 'opencode' | 'claudecode' = 'opencode',  // 新增参数
): void {
```

在 Phase 2 fallback（约 line 306-384）中，根据 engine 使用不同的 spawn 命令：

```typescript
// Phase 2: Fallback
if (!report) {
  if (engine === 'claudecode') {
    // Claude Code 直接 spawn（不走 ACP）
    addLog('info', '使用 Claude Code 引擎解析');

    const instruction = '执行审计分析，生成 AUDIT_REPORT.md...';
    let cmd: string;
    let finalArgs: string[];

    if (isWindows) {
      cmd = 'claude';
      finalArgs = ['-p', instruction, '--output-format', 'stream-json', '--verbose'];
    } else {
      cmd = 'claude';
      finalArgs = ['-p', instruction, '--output-format', 'stream-json', '--verbose'];
    }

    addLog('info', `执行: claude -p "审计指令"`);

    // spawn 逻辑与 opencode 分支类似
    childProcess = spawn(cmd, finalArgs, {
      cwd: workspacePath,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // stdout/stderr 处理 + exit code 处理（与 opencode 分支相同）
    // ...
  } else {
    // 现有 opencode 逻辑保持不变
    // ...
  }
}
```

- [ ] **Step 6: POST handler 传递 engine**

在 POST handler 中（约 line 213）传递 engine：

```typescript
executeTaskAsync(taskId, workspacePath, timeoutSec || 600, body.engine);
```

- [ ] **Step 7: 验证 + Commit**

```bash
git add src/components/codeswarm/LocalTestPanel.tsx src/app/api/codeswarm/local-test/route.ts
git commit -m "feat(ui+api): add engine selector to LocalTestPanel with claudecode support"
```

---

## Chunk 4: 编译验证与集成测试

### Task 10: 全量编译验证 + CodeswarmTask DB schema 检查

- [ ] **Step 1: 验证 Worker 端编译**

Run: `cd codeswarm && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: 验证平台端编译**

Run: `cd D:/work/claude-web-plaatform/20260514/claude-web-platform && npx tsc --noEmit`
Expected: 无与本次改动相关的错误

- [ ] **Step 3: 检查 CodeswarmTask 表是否需要新增 apiBaseUrl 列**

Run: `grep -n "apiBaseUrl" prisma/schema.prisma`

如果 `CodeswarmTask` model 没有 `apiBaseUrl` 字段，需要在 schema 中添加：

```prisma
model CodeswarmTask {
  // ... 现有字段
  apiBaseUrl  String?   // 新增
}
```

然后运行: `npx prisma db push` 或 `npx prisma migrate dev`

- [ ] **Step 4: 启动 dev server 验证前端页面**

Run: `npm run dev`

打开浏览器访问 CodeSwarm 调试面板，确认：
1. TaskDebugPanel 引擎选择器显示正常
2. LocalTestPanel 引擎选择器显示正常
3. 切换引擎时 UI 状态正确

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "chore: schema update and integration verification for claudecode engine"
```
