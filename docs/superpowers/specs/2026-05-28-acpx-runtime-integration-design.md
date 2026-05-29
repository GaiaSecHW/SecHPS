# acpx/runtime 集成设计文档

> 日期：2026-05-28
> 分支：dev-codeswarm
> 状态：已确认（v3 — 基于 acpx 0.10.0 runtime API 实际验证修订）

## 1. 概述

将 CodeSwarm Worker 中的自封装 ACP 客户端（`@codeswarm/acp` + `@codeswarm/sdk-adapter`）替换为开源项目 [acpx](https://github.com/openclaw/acpx) 的 `acpx/runtime` 库，统一 Agent 通信层。

### 设计目标

- 删除 ~730 行重复的 ACP 客户端代码，用成熟的 acpx 替代
- 通过 acpx 的 Agent 注册表支持 15+ 种 AI Agent（opencode、claude、codex、gemini、cursor 等），新增 Agent 零代码改动
- 保留 ProcessManager 的 Continuation 机制（Strategy A/B）、技能追踪、错误分类等核心业务逻辑
- 平台侧（Dispatcher、API 路由、前端 SSE）零改动
- TaskPayload / WorkerEvent schema 完全向后兼容

### 不做之事

- 不修改平台侧 Dispatcher 或任何 API 路由
- 不修改前端代码
- 不引入新的权限策略（保持 approve-all）
- 不改变 Continuation 的 Strategy A/B 逻辑
- 不改变会话存储为 PostgreSQL（使用 acpx 默认的文件存储）

## 2. 架构变更

### 2.1 删除的包

| 包 | 路径 | 估算行数 | 原因 |
|---|------|---------|------|
| `@codeswarm/acp` | `codeswarm/packages/acp/` | ~410 | 被 `acpx/runtime` 的 `AcpxRuntime` + `AcpClient` 替代 |
| `@codeswarm/sdk-adapter` | `codeswarm/packages/sdk-adapter/` | ~250 | 从未在 ProcessManager 中实际使用（仅 import 未调用），直接删除 |

> **发现**：源码审计确认 `process-manager.ts` 中 `ClaudeCodeClient` 仅有 import 声明，`runAgent()` 对所有 engine（包括 `claudecode`）均通过 `ACPClient` 执行。SDK adapter 是死代码。

### 2.2 新增依赖

在 `@codeswarm/worker` 的 `package.json` 中：

```json
{
  "acpx": "0.10.0"
}
```

> 版本锁定为精确版本，避免 0.x minor 更新引入不兼容变更。升级时显式修改。
> acpx 为 ESM-only 包，Worker 已配置 `"type": "module"`，无需额外改动。
> 注意：acpx 依赖 `zod@^4.4.3`，与项目的 `zod@^3.x` 不同版本，但作为内部依赖不会暴露给消费者。

### 2.3 保留不变的包

| 包 | 说明 |
|---|------|
| `@codeswarm/types` | Zod schema 不变 |
| `@codeswarm/worker` | Daemon + Semaphore + EnvironmentFactory 不变 |

### 2.4 改动的文件

| 文件 | 改动范围 |
|------|---------|
| `codeswarm/packages/worker/src/process-manager.ts` | 重写客户端创建 + 事件处理，保留 Continuation 骨架 |
| `codeswarm/packages/worker/src/daemon.ts` | 共享 sessionStore/registry 初始化（~10 行）+ 传递给 ProcessManager |
| `codeswarm/packages/worker/package.json` | 加 `acpx` 依赖，删 `@codeswarm/acp` 和 `@codeswarm/sdk-adapter` |

### 2.5 不改的文件

| 文件 | 原因 |
|------|------|
| `environment.ts` | 工作空间准备逻辑不变 |
| `semaphore.ts` | 并发控制不变 |
| `codedmap-manager.ts` | 知识图谱处理不变 |
| `minio-client.ts` | MinIO 客户端不变 |
| `src/services/codeswarm-dispatcher.ts` | 平台侧调度器完全不变 |
| 所有 `src/app/api/codeswarm/` 路由 | API 接口不变 |

### 2.6 架构图（改动后）

```
┌─ 不变 ──────────────────────────────────────────────┐
│  NAZHUA Platform                                     │
│  Dispatcher + API Routes + PostgreSQL + Redis        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP callbacks
┌── 改动 ──────────────┴──────────────────────────────┐
│  Worker Node                                         │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ Daemon   │  │ ProcessManager (改)             │   │
│  │ Semaphore│  │ ┌────────────────────────────┐ │   │
│  │ Env      │  │ │ AcpxRuntime (acpx/runtime) │ │   │
│  │ Codedmap │  │ │ ensureSession / startTurn   │ │   │
│  │ MinIO    │  │ │ cancel / close              │ │   │
│  └──────────┘  │ │ + Continuation Strategy A/B │ │   │
│                │ └────────────────────────────┘ │   │
│                │ + EventMapper + SkillTracker    │   │
│                └────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 3. ProcessManager 核心改造

### 3.1 Runtime 初始化

WorkerDaemon 启动时创建共享的 `sessionStore` 和 `agentRegistry`，每个任务创建独立的 `AcpxRuntime` 实例（含任务级 MCP 和 authCredentials）：

```typescript
import { createAcpRuntime, createFileSessionStore, createAgentRegistry } from 'acpx/runtime';

// 共享组件（Worker 启动时创建一次）
const sharedSessionStore = createFileSessionStore({
  stateDir: process.env.SESSION_DIR ?? '.acpx-state',
});
const sharedRegistry = createAgentRegistry();

// 每个任务创建独立 runtime（开销极低）
function createTaskRuntime(
  authCredentials?: Record<string, string>,
  mcpServers?: McpServer[],
): AcpxRuntime {
  return createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: sharedSessionStore,
    agentRegistry: sharedRegistry,
    permissionMode: 'approve-all',
    nonInteractivePermissions: 'deny',
    timeoutMs: Number(process.env.TASK_TIMEOUT_SEC ?? 604800) * 1000,
    authCredentials,
    mcpServers,
  });
}
```

**注意**：
- 工厂函数为 `createFileSessionStore`（`createRuntimeStore` 也导出但为同一实现）
- `permissionMode: 'approve-all'` 等价于当前 ACPClient 中硬编码的 `optionId: 'always'` 自动批准逻辑
- `nonInteractivePermissions: 'deny'` 确保无法交互时拒绝而非挂起
- `authCredentials` 传递 API Key，acpx 内部注入到 Agent 进程环境变量
- `mcpServers` 为任务级 MCP 配置，避免跨任务污染

### 3.2 Agent 名称映射

将 TaskPayload 的 `engine` 字段映射到 acpx 的 agent 注册表名称：

```typescript
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
```

**安全设计**：使用白名单校验，未知 engine 直接拒绝。acpx 的 agent 注册表对未知名称会作为 shell 命令执行（escape hatch），这是一个命令注入风险点。白名单在 Worker 侧阻断此路径。

**acpx 内置注册表实际命令**（供参考，Worker 无需关心）：

| Agent 名称 | 实际命令 |
|-----------|---------|
| `opencode` | `npx -y opencode-ai acp` |
| `claude` | `npx -y @agentclientprotocol/claude-agent-acp@^0.37.0` |
| `codex` | `npx -y @agentclientprotocol/codex-acp@^0.0.44` |
| `gemini` | `gemini --acp` |
| `cursor` | `cursor-agent acp` |
| `copilot` | `copilot --acp --stdio` |
| `kiro` | `kiro-cli-chat acp` |

### 3.3 API Key 注入

acpx 通过 `authCredentials` 选项传递 API Key，内部会将其注入到 Agent 进程的环境变量中：

```typescript
function buildAuthCredentials(
  engine: string,
  apiKey?: string,
  model?: string,
): Record<string, string> | undefined {
  if (!apiKey) return undefined;

  const credentials: Record<string, string> = {};
  const agent = resolveAgentName(engine);

  if (agent === 'claude') {
    credentials.ANTHROPIC_API_KEY = apiKey;
  } else if (agent === 'codex' || agent === 'copilot') {
    credentials.OPENAI_API_KEY = apiKey;
  } else if (agent === 'gemini') {
    credentials.GOOGLE_API_KEY = apiKey;
  } else if (model) {
    const providerId = model.split('/')[0]?.toUpperCase();
    if (providerId) credentials[`${providerId}_API_KEY`] = apiKey;
  }

  // 兜底：确保至少有一个 key 被设置
  if (Object.keys(credentials).length === 0) {
    credentials.ANTHROPIC_API_KEY = apiKey;
  }

  return credentials;
}
```

**与当前实现的差异**：
- 当前 ProcessManager 使用 `{ ...process.env }` 全量传递 + 手动注入 key
- 新设计通过 `authCredentials` 传递给 acpx，由 acpx 内部管理环境变量
- acpx 内部同样使用 `{ ...process.env }` spread（`buildAgentEnvironment()`），然后叠加 `authCredentials`

**环境变量隔离限制**：acpx 不暴露控制 spawn env 的接口，无法在应用层实现白名单。如需环境变量隔离，应在 Docker/容器层面限制 Worker 进程可见的环境变量。

**apiBaseUrl 传递**：acpx 不直接支持 base URL 配置。需要在 Worker 进程启动前通过环境变量设置 `ANTHROPIC_BASE_URL`，或通过 `authCredentials` 传递（acpx 会将其注入 env）：

```typescript
function buildAuthCredentials(
  engine: string,
  apiKey?: string,
  model?: string,
  apiBaseUrl?: string,
): Record<string, string> | undefined {
  // ... 同上 ...

  if (apiBaseUrl) {
    credentials.ANTHROPIC_BASE_URL = apiBaseUrl;
  }

  return credentials;
}
```

### 3.4 任务执行流程（runAgent 重写）

```
runAgent(taskId, workspace, engine, agent, apiKey?, model?, ..., onEvent)
│
├── ① 创建会话
│   handle = await runtime.ensureSession({
│     sessionKey: taskId,
│     agent: resolveAgentName(engine),
│     mode: 'oneshot',
│     cwd: workspace,
│     sessionOptions: { model },  // 注意：model 需在 agent 广告列表中
│   })
│
├── ② Continuation Loop（保留现有逻辑）
│   while (continueAttempt <= MAX_ATTEMPTS) {
│     │
│     ├── 构建指令（首次=原始 instruction，重试=continuation prompt）
│     │
│     ├── 创建 AbortController 用于不活跃超时
│     │   const controller = new AbortController();
│     │   inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_TIMEOUT_MS);
│     │
│     ├── turn = runtime.startTurn({
│     │     handle,
│     │     text: instruction,
│     │     mode: 'prompt',
│     │     requestId: `${taskId}-turn-${attempt}`,
│     │     timeoutMs: effectiveTimeoutMs,
│     │     signal: controller.signal,  // AbortSignal 用于超时控制
│     │   })
│     │
│     ├── 消费事件流（注意：startTurn 不发 done/error 终端事件）：
│     │   for await (const event of turn.events) {
│     │     mapAndForwardEvent(event, onEvent, runState);
│     │     resetInactivityTimer(controller, inactivityTimer);
│     │   }
│     │
│     ├── result = await turn.result
│     │   // result 类型: { status: 'completed' | 'cancelled' | 'failed', ... }
│     │
│     ├── result.status === 'completed' → break（成功）
│     ├── result.status === 'failed' → handleTurnError(result.error) → break
│     │
│     ├── 不活跃超时触发（signal aborted）→
│     │   Strategy A: await turn.cancel({ reason: 'inactivity' })
│     │     → result = await Promise.race([turn.result, timeout(CANCEL_WAIT_MS)])
│     │     如果 result.status === 'cancelled' → 重置计数，继续循环
│     │     如果 result.status === 'completed' → 任务实际完成，exitCode 0
│     │     如果超时 → fall through to Strategy B
│     │   Strategy B: await runtime.close({ handle, discardPersistentState: false })
│     │     → handle = await runtime.ensureSession({ ... }) 重建
│     │
│     └── 超过 MAX_ATTEMPTS → break（失败）
│   }
│
├── ③ 收集结果
│   return { exitCode, stdout, stderr }
│
└── ④ 关闭会话
    await runtime.close({ handle, discardPersistentState: true })
```

**关键差异**：
- `startTurn()` 的事件流不包含终端事件（`done`/`error`），必须通过 `turn.result` Promise 获取最终状态
- `turn.cancel()` 是异步方法，接受 `{ reason?: string }` 参数
- `runtime.close()` 接受 `{ handle, discardPersistentState?: boolean }`，`discardPersistentState: true` 会删除 session 文件
- `startTurn` 支持 `signal: AbortSignal`，可用于超时控制（比手动 cancel 更优雅）
- **Model 验证**：`ensureSession` 的 `sessionOptions.model` 会校验 model 是否在 agent 的 advertised models 列表中，不匹配时抛 `RequestedModelUnsupportedError`。建议 try-catch 包裹，失败时 fallback 到不指定 model

### 3.5 Continuation 操作映射

| 当前 ACPClient 操作 | acpx/runtime 等价操作 | 备注 |
|---------------------|----------------------|------|
| `client.cancel()` | `await turn.cancel({ reason })` | 异步，需 await |
| `client.waitForCurrentPrompt(10s)` | `Promise.race([turn.result, setTimeout(CANCEL_WAIT_MS)])` | cancel 后等待 result resolve |
| Strategy B: `client.destroy()` | `await runtime.close({ handle, discardPersistentState: false })` | 终止进程，保留 session 文件供重建 |
| Strategy B: `new ACPClient()` + `start()` | `await runtime.ensureSession({ mode: 'oneshot' })` | oneshot 模式每次创建新 session |
| `client.isAlive` | 维护 `turnActive: boolean` 标志 | 事件流结束后置 false |
| `client.exitCode` | `result.status === 'completed' ? 0 : 1` | 从 turn result 推导 |
| `client.getTextBuffer()` | 自维护 `textChunks: string[]`（最近 5 条） | 事件消费时 append |
| `client.sendPrompt(prompt)` 返回 `StopReason` | `turn.result` 返回 `AcpRuntimeTurnResult` | status 字段替代 StopReason |
| 不活跃超时 kill | `startTurn({ signal: controller.signal })` | AbortSignal 原生支持 |

**StopReason → TurnResult 映射**：

| 当前 StopReason | acpx TurnResult.status | 处理 |
|----------------|----------------------|------|
| `'end_turn'` | `'completed'` | 任务成功 |
| `'cancelled'` | `'cancelled'` | Strategy A 成功，可继续 |
| 其他 / 异常 | `'failed'` + error | 检查 error.retryable |

### 3.6 关键差异处理

| 问题 | 方案 |
|------|------|
| acpx 没有暴露 `getTextBuffer()` | 在事件流消费时自行维护 `textChunks: string[]`（最近 5 条），逻辑不变 |
| acpx 没有暴露 `isAlive` / `exitCode` | 维护 `turnActive` 标志位（startTurn 时 true，事件流结束/result resolve 时 false）。用 `result.status` 推导 exitCode |
| acpx 管理进程生命周期 | 不再由 ProcessManager 直接 spawn/kill，由 acpx 的 AcpClient 内部管理。`close()` 会终止底层进程 |
| `onEvent` 回调不变 | WorkerDaemon 的 `onEvent` 回调签名完全不变，ProcessManager 内部做事件转换 |
| acpx 是 ESM-only | Worker 已是 ESM（`"type": "module"`），无需改动 |
| `startTurn` 不发终端事件 | 不能依赖事件流判断完成，必须 await `turn.result` |
| `startTurn` 支持 `signal` | 可用 `AbortSignal` 实现超时控制，比手动 timer + cancel 更优雅 |
| Windows 兼容性 | acpx 内部已处理 Windows 进程管理（比当前 ACPClient 的 `opencode.exe` 路径 hack 更成熟） |
| `close()` 无 `reason` 参数 | 使用 `discardPersistentState: true/false` 控制是否删除 session 文件 |
| 环境变量传递 | acpx 内部使用 `{ ...process.env }` + `authCredentials` 注入，无法在应用层白名单过滤 |
| Model 验证 | `ensureSession` 会校验 model 是否在 agent advertised list 中，需 try-catch fallback |

## 4. 事件映射

### 4.1 acpx AcpRuntimeEvent 类型定义（实际）

```typescript
type AcpRuntimeEvent =
  | { type: "text_delta"; text: string; stream?: "output" | "thought"; tag?: AcpSessionUpdateTag }
  | { type: "status"; text: string; tag?: AcpSessionUpdateTag; used?: number; size?: number }
  | { type: "tool_call"; text: string; tag?: AcpSessionUpdateTag; toolCallId?: string;
      status?: string; title?: string; kind?: ToolKind; locations?: ToolCallLocation[];
      rawInput?: unknown; rawOutput?: unknown; content?: ToolCallContent[] }
  | { type: "done"; stopReason?: string }       // 仅 runTurn() 遗留 API 发出
  | { type: "error"; message: string; code?: string; detailCode?: string; retryable?: boolean };

type AcpSessionUpdateTag =
  | "agent_message_chunk" | "agent_thought_chunk"
  | "tool_call" | "tool_call_update"
  | "usage_update" | "available_commands_update"
  | "current_mode_update" | "config_option_update"
  | "session_info_update" | "plan"
  | (string & {});  // 开放扩展

type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "think" | "other";
```

### 4.2 事件映射表：acpx → CodeSwarm AgentEvent

| acpx 事件类型 | 区分条件 | → CodeSwarm AgentEvent | 转换逻辑 |
|--------------|---------|------------------------|---------|
| `text_delta` | `stream='output'` 或无 stream | `{ type: 'agent_message_chunk', content: event.text }` | 直接映射 |
| `text_delta` | `stream='thought'` | `{ type: 'agent_message_chunk', content: event.text }` | 统一为 message_chunk（思考过程也输出） |
| `tool_call` | `tag='tool_call'` | `{ type: 'tool_call', tool, input }` | `tool = event.title ?? event.kind ?? 'unknown'`，触发技能推断 |
| `tool_call` | `tag='tool_call_update'` | `{ type: 'tool_call_update', output }` | `output = String(event.rawOutput ?? event.text ?? '')` |
| `status` | `tag='usage_update'` | 不发送事件 | 仅重置不活跃计时器（alive 信号） |
| `status` | `tag='available_commands_update'` | 不发送事件 | 仅重置不活跃计时器（alive 信号） |
| `status` | 其他 tag | `{ type: 'log_chunk', content: event.text, level: 'info' }` | 日志信息 |
| `error` | — | `{ type: 'error', message: event.message }` | 分类后决定是 `'error'` 还是 `'phase_error'` |

**重要**：
- `startTurn()` 的事件流中**不会**出现 `done` 类型事件，终端状态通过 `turn.result` 获取
- `error` 类型事件可能在事件流中出现（运行时错误），与 `turn.result.status === 'failed'` 是不同的错误路径
- 所有事件都应重置不活跃计时器（包括 `error` 事件）

### 4.3 事件映射实现

```typescript
function mapAndForwardEvent(
  event: AcpRuntimeEvent,
  onEvent: AgentEventCallback,
  state: RunState,
): void {
  const timestamp = new Date().toISOString();

  // 所有事件重置不活跃计时器
  resetInactivityTimer(state);

  switch (event.type) {
    case 'text_delta': {
      const content = event.text;
      state.textChunks.push(content);
      if (state.textChunks.length > 5) state.textChunks.shift();
      state.stdout += content;
      onEvent({ type: 'agent_message_chunk', content, timestamp });
      break;
    }

    case 'tool_call': {
      mapToolCallEvent(event, onEvent, state, timestamp);
      break;
    }

    case 'status': {
      // usage_update 和 available_commands_update 仅作为 alive 信号
      if (event.tag === 'usage_update' || event.tag === 'available_commands_update') {
        return;
      }
      onEvent({ type: 'log_chunk', content: event.text, level: 'info', timestamp });
      break;
    }

    case 'error': {
      const classified = classifyAcpError(event.message);
      onEvent({
        type: classified.isCritical ? 'error' : 'phase_error',
        message: event.message,
        phase: classified.category,
        timestamp,
      });
      break;
    }
  }
}
```

### 4.4 技能（Skill）追踪保留

复用现有的 `extractSkillName()` + `inferSkillNameFromContext()` 逻辑。acpx 的 `tool_call` 事件比当前更丰富（多了 `title`、`kind`、`toolCallId`），使技能推断更准确：

```typescript
function mapToolCallEvent(
  event: AcpRuntimeEvent & { type: 'tool_call' },
  onEvent: AgentEventCallback,
  state: RunState,
  timestamp: string,
): void {
  const toolName = event.title ?? event.kind ?? 'unknown';
  const isUpdate = event.tag === 'tool_call_update';

  if (!isUpdate) {
    // 初始调用时进行技能推断
    const skillName = extractSkillName(toolName, event.rawInput)
      ?? inferSkillNameFromContext(state.textChunks);

    if (skillName && skillName !== state.currentSkill) {
      if (state.currentSkill) {
        onEvent({ type: 'skill_complete', skill: state.currentSkill, timestamp });
      }
      state.currentSkill = skillName;
      onEvent({ type: 'skill_start', skill: skillName, content: '', timestamp });
    }

    onEvent({ type: 'tool_call', tool: toolName, input: event.rawInput, timestamp });
  } else {
    // tool_call_update：检查 output 中是否有技能名称线索
    const output = String(event.rawOutput ?? event.text ?? '');
    if (!state.currentSkill) {
      const inferred = inferSkillFromOutput(output);
      if (inferred) {
        state.currentSkill = inferred;
        onEvent({ type: 'skill_start', skill: inferred, content: '', timestamp });
      }
    }
    onEvent({ type: 'tool_call_update', output, timestamp });
  }
}
```

## 5. 错误处理

### 5.1 acpx 错误体系

acpx 提供两层错误：

**运行时错误**（`AcpRuntimeError`）— 在 `ensureSession` / `startTurn` 调用时抛出：

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `ACP_BACKEND_MISSING` | Agent 命令不存在于 PATH | exitCode 2，Worker 级错误 |
| `ACP_BACKEND_UNAVAILABLE` | Agent 进程启动后无法建立连接 | exitCode 2，可换 Worker 重试 |
| `ACP_SESSION_INIT_FAILED` | 会话创建失败 | exitCode 1，任务级失败 |
| `ACP_TURN_FAILED` | Turn 执行异常 | exitCode 1，检查 retryable |
| `ACP_INVALID_RUNTIME_OPTION` | 配置错误 | exitCode 1，不可重试 |
| `ACP_DISPATCH_DISABLED` | 调度被禁用 | exitCode 1，不可重试 |

**Turn 结果错误**（`AcpRuntimeTurnResultError`）— 通过 `turn.result` 返回：

```typescript
interface AcpRuntimeTurnResultError {
  message: string;
  code?: string;          // 如 'ACP_BACKEND_UNAVAILABLE'
  detailCode?: string;    // 更细的错误分类
  retryable?: boolean;    // 是否可重试
}
```

### 5.2 exitCode 约定

| exitCode | 含义 | Dispatcher 行为 |
|----------|------|----------------|
| `0` | 成功 | 正常完成 |
| `1` | 任务级失败（指令错误、Agent 逻辑异常） | 标记任务失败 |
| `2` | Worker 级失败（Agent 后端不可用、命令缺失） | 可考虑换 Worker 重试 |

### 5.3 错误处理逻辑

```typescript
import { isAcpRuntimeError } from 'acpx/runtime';

function handleTurnError(
  error: AcpRuntimeTurnResultError,
  ctx: RunState,
): RunAgentResult {
  // 可重试错误 + 有实质输出 → 容忍（保留现有逻辑）
  if (error.retryable && hasSubstantialOutput(ctx.stdout)) {
    return { exitCode: 0, stdout: ctx.stdout, stderr: error.message };
  }

  // Agent 后端不可用 → Worker 级错误
  if (error.code === 'ACP_BACKEND_UNAVAILABLE' || error.code === 'ACP_BACKEND_MISSING') {
    return { exitCode: 2, stdout: ctx.stdout, stderr: `Agent unavailable: ${error.message}` };
  }

  // 分类：保留现有 classifyAcpError 逻辑
  const classified = classifyAcpError(error.message);
  if (!classified.isCritical && hasSubstantialOutput(ctx.stdout)) {
    return { exitCode: 0, stdout: ctx.stdout, stderr: error.message };
  }

  return { exitCode: 1, stdout: ctx.stdout, stderr: error.message };
}

function handleRuntimeError(
  error: unknown,
  ctx: RunState,
): RunAgentResult {
  if (isAcpRuntimeError(error)) {
    if (error.code === 'ACP_BACKEND_MISSING' || error.code === 'ACP_BACKEND_UNAVAILABLE') {
      return { exitCode: 2, stdout: ctx.stdout, stderr: error.message };
    }
    return { exitCode: 1, stdout: ctx.stdout, stderr: error.message };
  }
  return { exitCode: 1, stdout: ctx.stdout, stderr: String(error) };
}
```

### 5.4 hasSubstantialOutput 保留

保留现有的 `hasSubstantialOutput()` 逻辑（stdout 去空白后 ≥ 100 字符视为有实质输出），用于判断是否容忍非关键错误。

### 5.5 classifyAcpError 保留

保留现有分类逻辑，增加对 acpx 错误码的识别：

```typescript
function classifyAcpError(message: string): ClassifiedError {
  if (/title.*generat/i.test(message)) {
    return { isCritical: false, category: 'title_generation', rawMessage: message };
  }
  if (/rate.?limit|429|FreeUsageLimitError/i.test(message)) {
    return { isCritical: false, category: 'rate_limit', rawMessage: message };
  }
  return { isCritical: true, category: 'unknown', rawMessage: message };
}
```

## 6. MCP Server 传递

### 6.1 acpx McpServer 类型定义（实际）

acpx 支持三种 MCP Server 传输类型，通过 `AcpRuntimeOptions.mcpServers` 传入：

```typescript
// stdio 类型（默认）
type McpServerStdio = {
  name: string;
  type?: "stdio";
  command: string;
  args?: string[];
  env?: { name: string; value: string }[];
  _meta?: Record<string, unknown> | null;
};

// HTTP 类型
type McpServerHttp = {
  name: string;
  type: "http";
  url: string;
  headers?: { name: string; value: string }[];
  _meta?: Record<string, unknown> | null;
};

// SSE 类型
type McpServerSse = {
  name: string;
  type: "sse";
  url: string;
  headers?: { name: string; value: string }[];
  _meta?: Record<string, unknown> | null;
};

type McpServer = McpServerStdio | McpServerHttp | McpServerSse;
```

### 6.2 TaskPayload mcps 字段转换

当前 TaskPayload 的 `mcps` 字段为 JSON 字符串，格式为平台侧定义的 MCP 配置。需要转换为 acpx 的 `McpServer[]` 格式：

```typescript
interface PlatformMcpConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

function convertMcpServers(mcpsJson?: string): McpServer[] | undefined {
  if (!mcpsJson) return undefined;

  try {
    const configs: PlatformMcpConfig[] = JSON.parse(mcpsJson);
    return configs.map((cfg) => {
      if (cfg.transport === 'http') {
        return {
          name: cfg.name,
          type: 'http' as const,
          url: cfg.url!,
          headers: cfg.headers
            ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value }))
            : undefined,
        };
      }
      if (cfg.transport === 'sse') {
        return {
          name: cfg.name,
          type: 'sse' as const,
          url: cfg.url!,
          headers: cfg.headers
            ? Object.entries(cfg.headers).map(([name, value]) => ({ name, value }))
            : undefined,
        };
      }
      // 默认 stdio
      return {
        name: cfg.name,
        type: 'stdio' as const,
        command: cfg.command!,
        args: cfg.args,
        env: cfg.env
          ? Object.entries(cfg.env).map(([name, value]) => ({ name, value }))
          : undefined,
      };
    });
  } catch {
    return undefined;
  }
}
```

### 6.3 MCP 传递时机

MCP servers 在 `createAcpRuntime` 时传入（runtime 级别配置）。acpx 内部会将 `options.mcpServers` 透传到每个 AcpClient 创建和 session 建立请求中。

**验证结果**：`mcpServers` 不在 `ensureSession` 的参数中，仅在 runtime options 级别接受。因此：

**推荐方案**：为每个任务创建独立的 runtime 实例（开销极低，仅是配置对象 + 延迟初始化的 manager），避免跨任务 MCP 配置污染。

```typescript
function createTaskRuntime(taskMcps?: string, authCredentials?: Record<string, string>): AcpxRuntime {
  return createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: sharedSessionStore,  // store 可共享
    agentRegistry: sharedRegistry,     // registry 可共享
    permissionMode: 'approve-all',
    nonInteractivePermissions: 'deny',
    mcpServers: convertMcpServers(taskMcps),
    authCredentials,
  });
}
```

## 7. SessionAgentOptions 传递

### 7.1 acpx SessionAgentOptions 类型

```typescript
type SessionAgentOptions = {
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string | { append: string };
};
```

### 7.2 映射

| TaskPayload 字段 | → SessionAgentOptions | 说明 |
|-----------------|----------------------|------|
| `model` | `model` | 直接传递，如 `"anthropic/claude-4"` |
| `maxTurns`（如有） | `maxTurns` | 当前 TaskPayload 无此字段，预留 |
| `systemPrompt`（如有） | `systemPrompt` | 当前通过 instruction 前缀实现，可迁移 |

**注意**：`sessionOptions` 仅在创建新 session 时生效。对于 `oneshot` 模式每次都是新 session，所以每次都会应用。

## 8. 环境配置 & 部署

### 8.1 新增环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SESSION_DIR` | `.acpx-state` | acpx 会话文件存储路径 |

### 8.2 Node.js 版本升级

acpx 要求 `Node.js >= 22.13.0`（`package.json` engines 字段）。

**升级计划**：

| 步骤 | 操作 | 影响范围 |
|------|------|---------|
| 1 | Worker Dockerfile 基础镜像从 `node:20` 升级到 `node:22` | 仅 Worker 容器 |
| 2 | 验证 Worker 依赖兼容性（`@codeswarm/types` Zod、`ws`、`minio`） | Worker 包 |
| 3 | 平台侧保持 Node 20 不变 | 无影响 |

**风险**：Node 22 是 LTS（2024-10 发布），生态兼容性良好。Worker 依赖均为标准 npm 包，无已知 Node 22 不兼容问题。

### 8.3 ESM 兼容性

~~acpx 是 ESM-only 包。Worker 当前为 CJS。~~

**已验证**：Worker 的 `package.json` 已配置 `"type": "module"`，Worker 已经是 ESM。无需任何迁移工作。

### 8.4 Docker 变更

```dockerfile
# 变更前
FROM node:20-slim

# 变更后
FROM node:22-slim

# 新增 volume
VOLUME ["/app/.acpx-state"]
```

### 8.5 向后兼容性

| 组件 | 是否改动 | 说明 |
|------|---------|------|
| TaskPayload schema | 不变 | `engine` 字段映射到 agent 名称 |
| WorkerEvent schema | 不变 | 事件类型保持原样 |
| Dispatcher | 不变 | HTTP 回调接口不变 |
| 前端 SSE 流 | 不变 | 消费的事件格式不变 |
| API 路由 | 不变 | 所有 `/api/codeswarm/*` 端点不变 |

### 8.6 回滚策略

1. Git revert ProcessManager 改动
2. 恢复 `@codeswarm/acp` 和 `@codeswarm/sdk-adapter` 两个包
3. Docker 镜像回退到 node:20
4. 平台侧零改动，回滚只在 Worker 侧

## 9. 会话文件清理

acpx 使用 `oneshot` 模式，每次 `ensureSession` 创建唯一 session ID（`{taskId}:oneshot:{uuid}`），任务完成后通过 `runtime.close()` 释放底层进程。

### 9.1 清理策略

| 时机 | 操作 | 说明 |
|------|------|------|
| 任务正常完成 | `runtime.close({ handle, discardPersistentState: true })` | 终止进程 + 删除 session 文件 |
| Strategy B 重建 | `runtime.close({ handle, discardPersistentState: false })` | 终止进程，保留文件供 ensureSession 重建 |
| Worker 启动 | 扫描 `SESSION_DIR/sessions/`，删除 `lastUsedAt` 超过 24h 的文件 | 兜底清理 |
| 异常退出 | 依赖 Worker 启动时的兜底清理 | 无需额外机制 |

### 9.2 竞态条件处理

Strategy B 的 `close()` → `ensureSession()` 重建之间：
- `close({ discardPersistentState: false })` 终止 Agent 进程但保留 session record 文件
- `ensureSession({ mode: 'oneshot' })` 创建全新的 session record（含新 UUID），不会复用旧 record
- 文件删除仅在最终的 `close({ discardPersistentState: true })` 时执行
- 这消除了 close 回调与重建之间的竞态

## 10. 代码量估算

| 操作 | 行数 |
|------|------|
| 删除 `@codeswarm/acp` | ~410 |
| 删除 `@codeswarm/sdk-adapter` | ~250 |
| 删除 ProcessManager 中 engine 分支 + classifyAcpError 部分 | ~130 |
| **总删除** | **~790** |
| 新增 acpx 事件映射函数 | ~120 |
| 新增 Agent 名称映射 + authCredentials 构建 + 白名单 | ~40 |
| 新增 MCP 转换逻辑 | ~40 |
| 新增错误处理适配 | ~30 |
| **总新增** | **~230** |
| **净减少** | **~560** |

## 11. 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| acpx 0.x API 不稳定（自称 alpha） | 中 | 版本锁定 + MIT 可 fork；关注 upstream changelog；建议 fork 到内部 registry |
| Node.js 22 升级引入兼容问题 | 低 | Node 22 是 LTS，Worker 依赖均为标准包；先在 CI 验证 |
| ~~ESM 迁移遗漏~~ | ~~低~~ | ~~已验证 Worker 已是 ESM，无需迁移~~ |
| 未知 engine 命令注入 | 高 | 白名单校验（3.2 节），拒绝未知 engine |
| 环境变量泄露 | 中 | acpx 内部使用 `{ ...process.env }`，无法应用层白名单；需在 Docker 层面限制 Worker 可见 env |
| acpx 进程管理与 Continuation 冲突 | 中 | Strategy B 的 close 用 `discardPersistentState: false`，ensureSession 创建新 ID（9.2 节） |
| MCP 配置格式不兼容 | 低 | 转换函数有 try-catch 兜底，格式不匹配时降级为无 MCP |
| acpx 不支持某些 ACP 操作 | 低 | acpx 基于同一 `@agentclientprotocol/sdk`，API 覆盖更全 |
| 性能差异 | 低 | acpx 的 persistent client pooling 比当前每次新建更高效 |
| Model 验证阻断任务 | 中 | `ensureSession` 校验 model 是否在 agent advertised list 中；需 try-catch fallback 到不指定 model |
| Zod v4 vs v3 依赖冲突 | 低 | acpx 内部依赖 zod@4，项目用 zod@3；作为内部依赖不暴露，仅增加包体积 |

## 12. 实施步骤

| 阶段 | 任务 | 预估工时 |
|------|------|---------|
| 1 | Dockerfile 升级 Node 22 + CI 验证 | 1h |
| 2 | 添加 acpx 依赖，实现 Runtime 初始化（含 `authCredentials` 适配） | 1.5h |
| 3 | 重写 ProcessManager.runAgent（事件映射 + Continuation + AbortSignal） | 4h |
| 4 | 实现 MCP 转换 + Agent 白名单 + model fallback | 2h |
| 5 | 删除 `@codeswarm/acp` 和 `@codeswarm/sdk-adapter` | 0.5h |
| 6 | 集成测试（opencode + claude engine） | 3h |
| 7 | 回归测试（Continuation Strategy A/B） | 2h |
| **总计** | | **~14h** |

## 附录 A：acpx Agent 注册表完整列表

| Agent 名称 | 命令 | 备注 |
|-----------|------|------|
| `pi` | `npx pi-acp@^0.0.26` | |
| `openclaw` | `openclaw acp` | |
| `codex` | `npx -y @agentclientprotocol/codex-acp@^0.0.44` | acpx 默认 agent |
| `claude` | `npx -y @agentclientprotocol/claude-agent-acp@^0.37.0` | |
| `gemini` | `gemini --acp` | |
| `cursor` | `cursor-agent acp` | |
| `copilot` | `copilot --acp --stdio` | |
| `droid` | `droid exec --output-format acp` | 别名: factory-droid, factorydroid |
| `iflow` | `iflow --experimental-acp` | |
| `kilocode` | `npx -y @kilocode/cli acp` | |
| `kimi` | `kimi acp` | |
| `kiro` | `kiro-cli-chat acp` | |
| `opencode` | `npx -y opencode-ai acp` | |
| `qoder` | `qodercli --acp` | |
| `qwen` | `qwen --acp` | |
| `trae` | `traecli acp serve` | |

## 附录 B：与 v1/v2 设计文档的差异

| 项目 | v1（原文档） | v2 | v3（本文档） | 原因 |
|------|------------|-----|------------|------|
| Session store 工厂 | `createRuntimeStore` | `createFileSessionStore` | `createFileSessionStore`（两者均导出） | 实际 API 验证 |
| SDK adapter 行数 | ~350 | ~250 | ~250 | 实际代码审计 |
| ACP 包行数 | ~250 | ~410 | ~410 | 实际代码审计 |
| 未知 engine 处理 | 透传给 acpx | 白名单拒绝 | 白名单拒绝 | 安全风险修复 |
| 环境变量传递 | `...process.env` | 白名单模式 | `authCredentials` 选项 | acpx API 实际验证：不暴露 env 控制接口 |
| MCP 传递 | "实现阶段处理" | 完整转换方案 | 确认 runtime-level only（非 session-level） | API 验证：ensureSession 不接受 mcpServers |
| Node.js 升级 | 仅提及风险 | 完整升级计划 | 完整升级计划 | 可执行性 |
| ESM 兼容 | 未提及 | 方案 A（Worker 改 ESM） | **无需改动**（Worker 已是 ESM） | 实际 package.json 验证 |
| 事件流终端事件 | 未区分 | 明确 startTurn 不发 done | 同 v2 | 避免实现踩坑 |
| error 事件映射 | 未覆盖 | 完整映射 | 同 v2 | 事件完整性 |
| 会话清理竞态 | 未处理 | Strategy B 不删文件 | `discardPersistentState: false` | close() 实际签名验证 |
| 实施步骤 | 无 | 8 阶段 ~15.5h | 7 阶段 ~14h（删除 ESM 迁移） | Worker 已是 ESM |
| `close()` 签名 | — | `{ handle, reason }` | `{ handle, discardPersistentState? }` | API 实际验证 |
| `startTurn` signal | — | 未提及 | 支持 `signal: AbortSignal` | API 实际验证，改进超时控制 |
| GitHub URL | — | `nicepkg/acpx` | `openclaw/acpx` | npm readme 确认 |
| Model 验证 | — | 直接传递 | 需 try-catch fallback | ensureSession 会校验 advertised models |
| acpx 稳定性 | — | "0.x 不稳定" | 明确 alpha 状态，建议 fork | npm readme 自称 alpha |
