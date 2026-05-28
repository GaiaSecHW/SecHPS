# acpx/runtime 集成设计文档

> 日期：2026-05-28
> 分支：dev-codeswarm
> 状态：已确认

## 1. 概述

将 CodeSwarm Worker 中的自封装 ACP 客户端（`@codeswarm/acp` + `@codeswarm/sdk-adapter`）替换为开源项目 [acpx](https://github.com/nicepkg/acpx) 的 `acpx/runtime` 库，统一 Agent 通信层。

### 设计目标

- 删除 ~730 行重复的 ACP 客户端代码，用成熟的 acpx 替代
- 通过 acpx 的 Agent 注册表支持 20+ 种 AI Agent（opencode、claude、codex、gemini 等），新增 Agent 零代码改动
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
| `@codeswarm/acp` | `codeswarm/packages/acp/` | ~250 | 被 `acpx/runtime` 的 `AcpxRuntime` + `AcpClient` 替代 |
| `@codeswarm/sdk-adapter` | `codeswarm/packages/sdk-adapter/` | ~350 | 被 acpx Agent 注册表替代（claude 引擎走 ACP 协议） |

### 2.2 新增依赖

在 `@codeswarm/worker` 的 `package.json` 中：

```json
{
  "acpx": "0.10.0"
}
```

> 版本锁定为精确版本，避免 minor 更新引入不兼容变更。升级时显式修改。

### 2.3 保留不变的包

| 包 | 说明 |
|---|------|
| `@codeswarm/types` | Zod schema 不变 |
| `@codeswarm/worker` | Daemon + Semaphore + EnvironmentFactory 不变 |

### 2.4 改动的文件

| 文件 | 改动范围 |
|------|---------|
| `codeswarm/packages/worker/src/process-manager.ts` | 重写客户端创建 + 事件处理，保留 Continuation 骨架 |
| `codeswarm/packages/worker/package.json` | 加 `acpx` 依赖，删 `@codeswarm/acp` 和 `@codeswarm/sdk-adapter` |
| `codeswarm/packages/worker/src/daemon.ts` | 微调：Runtime 初始化（~10 行） |

### 2.5 不改的文件

| 文件 | 原因 |
|------|------|
| `daemon.ts`（主体） | 接口不变（`processManager.runAgent()` + `onEvent` 回调） |
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
                       │ HTTP
┌── 改动 ──────────────┴──────────────────────────────┐
│  Worker Node                                         │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ Daemon   │  │ ProcessManager (改)             │   │
│  │ Semaphore│  │ ┌────────────────────────────┐ │   │
│  │ Env      │  │ │ AcpxRuntime               │ │   │
│  │ Codedmap │  │ │ ensureSession / startTurn  │ │   │
│  │ MinIO    │  │ │ cancel / close             │ │   │
│  └──────────┘  │ │ + Continuation Strategy A/B│ │   │
│                │ └────────────────────────────┘ │   │
│                └────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 3. ProcessManager 核心改造

### 3.1 Runtime 初始化

WorkerDaemon 启动时创建一个共享的 `AcpxRuntime` 实例：

```typescript
import { createAcpRuntime, createRuntimeStore, createAgentRegistry } from 'acpx/runtime';

const runtime = createAcpRuntime({
  cwd: process.cwd(),
  sessionStore: createRuntimeStore({
    stateDir: process.env.SESSION_DIR ?? '.acpx-state',
  }),
  agentRegistry: createAgentRegistry(),
  permissionMode: 'approve-all',
});
```

`createAgentRegistry()` 内置 20+ Agent 的注册表，包括 opencode、claude、codex、gemini 等。

### 3.2 Agent 名称映射

将 TaskPayload 的 `engine` 字段映射到 acpx 的 agent 注册表名称：

```typescript
function resolveAgentName(engine: string): string {
  const map: Record<string, string> = {
    opencode: 'opencode',
    claudecode: 'claude',
    codex: 'codex',
    gemini: 'gemini',
  };
  return map[engine] ?? engine;
}
```

**未知 Agent 处理**：未知 engine 值直接透传给 acpx 的 `resolveAgentCommand()`，acpx 会将其作为原始 shell 命令尝试执行（escape hatch）。如果 Worker PATH 上不存在该命令，`ensureSession()` 会抛出 `ACP_BACKEND_UNAVAILABLE` 错误，任务标记为失败。这是预期行为——不支持盲目尝试不存在的 Agent。

### 3.3 API Key 注入

acpx 的 AcpClient 从环境变量读取 API Key。保留当前 ProcessManager 的 provider 动态推断逻辑，适配多 provider 场景：

```typescript
function buildEnvVars(engine: string, apiKey?: string, apiBaseUrl?: string, model?: string): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (apiKey) {
    const agent = resolveAgentName(engine);
    // 优先按 agent 类型注入
    if (agent === 'claude') {
      env.ANTHROPIC_API_KEY = apiKey;
    } else if (agent === 'codex') {
      env.OPENAI_API_KEY = apiKey;
    } else if (agent === 'gemini') {
      env.GOOGLE_API_KEY = apiKey;
    } else if (model) {
      // 回退：从 model 名称推断 provider（如 "anthropic/claude-4" → ANTHROPIC_API_KEY）
      const providerId = model.split('/')[0]?.toUpperCase();
      if (providerId) env[`${providerId}_API_KEY`] = apiKey;
    }
    if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GOOGLE_API_KEY) {
      env.ANTHROPIC_API_KEY = apiKey; // 最终默认
    }
  }
  if (apiBaseUrl) {
    env.ANTHROPIC_BASE_URL = apiBaseUrl; // 主要用于 Anthropic 兼容 API
  }
  return env;
}
```

### 3.4 任务执行流程（runAgent 重写）

```
runAgent(taskId, workspace, engine, agent, apiKey?, model?, ..., onEvent)
│
├── ① 创建会话
│   handle = runtime.ensureSession({
│     sessionKey: taskId,
│     agent: resolveAgentName(engine),
│     mode: 'oneshot',
│     cwd: workspace,
│     sessionOptions: { model },
│   })
│
├── ② Continuation Loop（保留现有逻辑）
│   while (continueAttempt <= MAX_ATTEMPTS) {
│     │
│     ├── 构建指令（首次=原始 instruction，重试=continuation prompt）
│     │
│     ├── turn = runtime.startTurn({
│     │     handle, text: instruction, mode: 'prompt',
│     │     requestId: `${taskId}-${attempt}`,
│     │     timeoutMs: effectiveTimeoutMs,
│     │   })
│     │
│     ├── 消费事件流：
│     │   for await (const event of turn.events) {
│     │     mapAndForwardEvent(event, onEvent);
│     │     resetInactivityTimer();
│     │   }
│     │
│     ├── result = await turn.result
│     │
│     ├── result.status === 'completed' → break（成功）
│     │
│     ├── 不活跃超时触发 →
│     │   Strategy A: turn.cancel() →
│     │     result = Promise.race([turn.result, timeout(CANCEL_WAIT_MS)])
│     │     如果 result.status === 'cancelled' → 重置计数，继续循环
│     │     如果 result.status === 'completed' → 任务实际完成，exitCode 0
│     │     如果超时 → fall through to Strategy B
│     │   Strategy B: runtime.close({ handle, reason: 'continuation-fallback' })
│     │     → ensureSession 重建
│     │
│     └── 超过 MAX_ATTEMPTS → break（失败）
│   }
│
├── ③ 收集结果
│   return { exitCode, stdout, stderr }
│
└── ④ 关闭会话
    runtime.close({ handle, reason: 'task-done' })
```

### 3.5 Continuation 操作映射

| 当前 ACPClient 操作 | acpx/runtime 等价操作 |
|---------------------|----------------------|
| `client.cancel()` | `turn.cancel()` |
| `client.waitForCurrentPrompt(10s)` | `Promise.race([turn.result, setTimeout(CANCEL_WAIT_MS)])` — 显式超时竞争，cancel 后 Agent 可能不响应 |
| Strategy B: `client.destroy()` | `runtime.close({ handle, reason: 'continuation-fallback' })` |
| Strategy B: `new ACPClient()` + `start()` | `runtime.ensureSession({ mode: 'oneshot' })` |
| `client.isAlive` | 维护 `turnActive: boolean` 标志，事件流结束后置 false |
| `client.exitCode` | `result.status === 'completed' ? 0 : 1` |
| `client.getTextBuffer()` | 自维护 `textChunks: string[]`（事件消费时 append，保留最近 5 条） |

### 3.6 关键差异处理

| 问题 | 方案 |
|------|------|
| acpx 没有暴露 `getTextBuffer()` | 在事件流消费时自行维护 `textChunks: string[]`（最近 5 条），逻辑不变 |
| acpx 没有暴露 `isAlive` / `exitCode` | 维护 `turnActive` 标志位（startTurn 时 true，事件流结束/result resolve 时 false）。用 `result.status` 推导 exitCode |
| acpx 管理进程生命周期 | 不再由 ProcessManager 直接 spawn/kill，由 acpx 的 AcpClient 内部管理。`close()` 会终止底层进程 |
| `onEvent` 回调不变 | WorkerDaemon 的 `onEvent` 回调签名完全不变，ProcessManager 内部做事件转换 |

## 4. 事件映射

### 4.1 acpx 事件 → CodeSwarm AgentEvent

acpx 的 `tool_call` 事件同时用于初始调用和完成更新，通过 `tag` 字段区分（不是 `status` 字段）。

| acpx 事件 | 区分条件 | → CodeSwarm AgentEvent | 转换逻辑 |
|-----------|---------|------------------------|---------|
| `text_delta` | `stream='output'` | `{ type: 'agent_message_chunk', content }` | 直接映射 |
| `text_delta` | `stream='thought'` | `{ type: 'agent_message_chunk', content }` | 统一为 message_chunk |
| `tool_call` | `tag='tool_call'`（初始调用） | `{ type: 'tool_call', tool, input }` | `tool = title ?? kind`，status 通常为 in_progress |
| `tool_call` | `tag='tool_call_update'`（完成/失败） | `{ type: 'tool_call_update', output }` | `status='completed'` 或 `'failed'`，output 来自 rawOutput |
| `status` | `tag='usage_update'` | 不发送事件 | 仅重置不活跃计时器（alive 信号） |
| `status` | `tag='available_commands_update'` | 不发送事件 | 仅重置不活跃计时器（alive 信号） |
| `status` | 其他 tag | `{ type: 'log_chunk', content, level: 'info' }` | 日志信息 |

**关键**：acpx 的 `tool_call` 类型事件通过 `event.tag` 区分是初始调用还是更新，而非通过 `event.status` 是否存在。`tag='tool_call'` 表示工具开始执行，`tag='tool_call_update'` 表示工具执行完成。

### 4.2 技能（Skill）追踪保留

复用现有的 `extractSkillName()` + `inferSkillNameFromContext()` 逻辑。acpx 的 `tool_call` 事件比当前更丰富（多了 `title`、`kind`、`toolCallId`），使技能推断更准确：

```typescript
function mapToolCallEvent(event: AcpRuntimeEvent, ctx: EventContext): void {
  if (event.type !== 'tool_call') return;

  const toolName = event.title ?? event.kind ?? 'unknown';
  const isUpdate = event.tag === 'tool_call_update';

  // 初始调用时进行技能推断
  if (!isUpdate) {
    const skillName = extractSkillName(toolName, event.rawInput)
      ?? inferSkillNameFromContext(ctx.textChunks);

    if (skillName && skillName !== ctx.currentSkill) {
      if (ctx.currentSkill) emitSkillComplete(ctx.currentSkill);
      ctx.currentSkill = skillName;
      onEvent({ type: 'skill_start', skill: skillName, content: '' });
    }
  }

  if (isUpdate) {
    onEvent({ type: 'tool_call_update', output: String(event.rawOutput ?? '') });
  } else {
    onEvent({ type: 'tool_call', tool: toolName, input: event.rawInput });
  }
}
```

## 5. 错误处理

### 5.1 结构化错误

acpx 的 `AcpRuntimeTurnResultError` 提供结构化错误信息：

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
| `1` | 任务级失败（指令错误、Agent 异常） | 标记任务失败 |
| `2` | Worker 级失败（Agent 后端不可用） | 可考虑换 Worker 重试 |

### 5.3 错误处理逻辑

```typescript
function handleTurnError(
  error: AcpRuntimeTurnResultError,
  ctx: RunContext,
): RunAgentResult {
  // 可重试错误 + 有实质输出 → 容忍
  if (error.retryable && hasSubstantialOutput(ctx.stdout)) {
    return { exitCode: 0, stdout: ctx.stdout, stderr: error.message };
  }

  // Agent 后端不可用 → Worker 级错误
  if (error.code === 'ACP_BACKEND_UNAVAILABLE') {
    return { exitCode: 2, stdout: ctx.stdout, stderr: `Agent unavailable: ${error.message}` };
  }

  return { exitCode: 1, stdout: ctx.stdout, stderr: error.message };
}
```

### 5.4 hasSubstantialOutput 保留

保留现有的 `hasSubstantialOutput()` 逻辑（stdout 去空白后 ≥ 100 字符视为有实质输出），用于判断是否容忍非关键错误。

## 6. 环境配置 & 部署

### 6.1 新增环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SESSION_DIR` | `.acpx-state` | acpx 会话文件存储路径 |

### 6.2 Docker 变更

- Node.js 版本要求 >= 22.13.0（acpx 依赖）
- 新增 `SESSION_DIR` volume：`VOLUME ["/app/.acpx-state"]`
- acpx 的 Agent 注册表通过 npx 自动拉取适配器，无需预装 opencode-ai

### 6.3 向后兼容性

| 组件 | 是否改动 | 说明 |
|------|---------|------|
| TaskPayload schema | 不变 | `engine` 字段映射到 agent 名称 |
| WorkerEvent schema | 不变 | 事件类型保持原样 |
| Dispatcher | 不变 | HTTP 回调接口不变 |
| 前端 SSE 流 | 不变 | 消费的事件格式不变 |
| API 路由 | 不变 | 所有 `/api/codeswarm/*` 端点不变 |

### 6.4 回滚策略

1. Git revert ProcessManager 改动
2. 恢复 `@codeswarm/acp` 和 `@codeswarm/sdk-adapter` 两个包
3. 平台侧零改动，回滚只在 Worker 侧

## 7. 代码量估算

| 操作 | 行数 |
|------|------|
| 删除 `@codeswarm/acp` | ~250 |
| 删除 `@codeswarm/sdk-adapter` | ~350 |
| 删除 ProcessManager 中 engine 分支 + classifyAcpError | ~130 |
| **总删除** | **~730** |
| 新增 acpx 事件映射函数 | ~120 |
| 新增 Agent 名称映射 + API Key 注入 | ~30 |
| **总新增** | **~150** |
| **净减少** | **~580** |

## 8. 会话文件清理

acpx 使用 `oneshot` 模式，每次 `ensureSession` 创建唯一 session ID（`taskId:oneshot:<uuid>`），任务完成后通过 `runtime.close()` 释放底层进程。

**文件清理策略**：
- `SESSION_DIR` 下的会话文件由 Worker 的定时清理任务管理
- Worker 启动时清理超过 24 小时的旧会话文件
- 每次任务完成后立即删除对应会话文件（`runtime.close()` 后删除）
- acpx 的 persistent session pooling 在 `oneshot` 模式下不生效（oneshot 不复用），不影响资源管理

## 9. MCP Server 传递

acpx 的 `AcpRuntimeOptions` 支持 `mcpServers?: McpServer[]`。当前 TaskPayload 的 `mcps` 字段（JSON 字符串）包含 MCP 服务配置。

**集成方式**：在 `createAcpRuntime` 时传入 MCP 配置，或在 `ensureSession` 时通过 `sessionOptions` 传入。具体格式转换在实现阶段处理，当前设计预留了接口。

## 10. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| acpx 依赖引入 Bug | acpx 是 MIT 开源项目，可 fork 维护；回滚成本低 |
| acpx 不支持某些 ACP 操作 | acpx 基于同一 `@agentclientprotocol/sdk`，API 覆盖更全 |
| Node.js 版本要求 22.13+ | Docker 镜像已基于 Node 20，需升级 |
| 性能差异 | acpx 的 persistent client pooling 比当前每次新建更高效 |
| Windows 兼容性 | acpx 在 Windows 上经过测试，比当前自封装的 pipe 处理更成熟 |
