# 续推 Cancel 导致子 Session 工具执行中断 — 修复设计

> 日期: 2026-06-03
> 状态: 已实施（含审查修复）
> 涉及模块: `codeswarm/packages/worker/src/process-manager.ts`
> 备注: INACTIVITY_TIMEOUT_MS 默认值从 1500000 (25min) 调整为 3600000 (1h)，与 CHILD_SESSION_TIMEOUT_MS 一致

## 1. 问题背景

### 1.1 现象

Worker 的续推机制检测到父 Agent 1500s 无响应后，触发方案 A (`session/cancel`)，cancel 信号传播到子 session，导致子 Agent 正在执行的 `fast_write` 等工具被强制中断：

```
Agent 无响应 1500s → 触发续推 → client.cancel()
  → cancel 信号传播到父子两个 session
  → 子 session 正在执行 fast_write → 抛出 "Aborted process"
  → 子 Agent 返回 {error: "Tool execution aborted", interrupted: true}
  → 父 session 收到子 Agent 的 Task 工具返回 → 标记为 error
```

### 1.2 根因：父 Session 视角盲区

不活跃计时器只监控**父 session 的 ACP 事件流**，子 session 的活动对父 session 不可见：

| 时间点 | 父 session 事件 | 子 session 事件 | 计时器行为 |
|--------|-----------------|-----------------|------------|
| T=0s | `toolCall(Agent, {...})` | — | ✅ 重置计时器 |
| T=1s ~ T+1500s | **无事件**（等待子返回） | text/toolCall/toolCallUpdate... | ❌ 计时器到期 |

当父 Agent 通过 `Agent`/`Task` 工具调用子 Agent 后，父 session 进入"等待"状态，不再产生任何 ACP 事件。子 session 内部的工作（文本输出、工具调用、工具更新）不会作为 ACP 事件冒泡到父 session 的 stream。1500s 后不活跃计时器到期，触发续推 cancel。

**核心矛盾**：当前代码无法区分以下三种场景：

| 场景 | 父 session 表现 | 实际情况 | 应该怎么处理 |
|------|-----------------|----------|-------------|
| Agent 真正卡死 | 1500s 无事件 | 进程/模型 API 挂起 | ✅ 应触发续推 |
| 父等待子完成 | 1500s 无事件 | 子 session 正在工作 | ❌ 不应触发续推 |
| Extended Thinking | 1500s 无事件（但有 `__alive__`） | 模型推理中 | ❌ 不应触发续推 |

### 1.3 现有代码问题定位

`process-manager.ts` 的 `toolCall` handler（原第 805-809 行）对所有工具调用统一重置不活跃计时器，对 `Agent`/`Task` 工具没有特殊处理：

```typescript
// 原代码 — 所有 toolCall 事件统一重置计时器
toolCall: (tool: string, input: unknown, title?: string) => {
  if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
    clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
  // ← Agent/Task 工具调用后，父 session 不再产生事件，计时器仍以 1500s 为限
```

## 2. 设计目标

1. **工具感知**：当 `toolCall` 事件为 `Agent`/`Task` 工具时，暂停不活跃计时器，因为子 session 工作不会在父 session 产生 ACP 事件
2. **兜底保护**：暂停不活跃计时器后，启动子 session 专用超时计时器，防止子 session 也卡死导致父 session 永久挂起
3. **存活信号映射**：`__alive__` 信号在 `waitingForChildSession` 状态下应重置子 session 超时计时器（而非普通不活跃计时器）
4. **计数器防循环**：cancel 成功后续推计数器不应重置为 0，防止无限续推

## 3. 修改详情

### 3.1 RunState 接口新增字段

**文件**: `process-manager.ts` 第 109-121 行

```typescript
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
```

### 3.2 CHILD_SESSION_TIMEOUT_MS 配置常量

**文件**: `process-manager.ts` 第 187 行

```typescript
const CHILD_SESSION_TIMEOUT_MS = parseInt(process.env.CHILD_SESSION_TIMEOUT_MS || '3600000');
```

默认值 3600000ms = 1 小时。通过环境变量 `CHILD_SESSION_TIMEOUT_MS` 可调整。

### 3.3 状态初始化

**文件**: `process-manager.ts` 第 189-198 行

```typescript
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
```

### 3.4 handleChildSessionTimeout 处理函数

**文件**: `process-manager.ts` 第 223-229 行

```typescript
const handleChildSessionTimeout = () => {
  if (!continuationEnabled || state.inactivityTimeoutReject === null) return;
  const timeoutSecs = CHILD_SESSION_TIMEOUT_MS / 1000;
  logger.taskInfo(taskId, LOG_MODULES.PROCESS, `Child session timeout: Agent/Task tool call not returning for ${timeoutSecs}s`);
  state.waitingForChildSession = false;
  state.inactivityTimeoutTriggered = true;
  state.inactivityTimeoutReject(new Error(`Inactivity timeout: child session not returning for ${timeoutSecs}s`));
};
```

关键设计：
- 错误消息包含 "Inactivity timeout" 前缀，确保 catch 块中 `errorMsg.includes('Inactivity timeout')` 识别为续推场景
- 重置 `waitingForChildSession = false` 恢复状态
- 触发与普通不活跃超时相同的续推机制（方案 A → 方案 B）

### 3.5 registerEventHandlers 配置扩展

**文件**: `process-manager.ts` 第 769-777 行

```typescript
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
```

`createAndStartClient` 调用点同步更新（第 236-241 行）：

```typescript
registerEventHandlers(c, state, ctx, {
  INACTIVITY_TIMEOUT_MS,
  CHILD_SESSION_TIMEOUT_MS,
  handleInactivityTimeout,
  handleChildSessionTimeout,
}, onEvent, taskId);
```

### 3.6 toolCall Handler — 工具感知型计时器管理

**文件**: `process-manager.ts` 第 808-821 行

**修改前**:
```typescript
toolCall: (tool: string, input: unknown, title?: string) => {
  if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
    clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
```

**修改后**:
```typescript
toolCall: (tool: string, input: unknown, title?: string) => {
  const actualToolName = (title || tool).toLowerCase();
  const isChildSessionTool = actualToolName === 'agent' || actualToolName === 'task';

  if (isChildSessionTool) {
    if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
    state.waitingForChildSession = true;
    if (state.childSessionTimeoutTimer) clearTimeout(state.childSessionTimeoutTimer);
    state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
    // ... 日志
  } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
    clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
```

逻辑说明：
- **Agent/Task 工具调用** → 清除不活跃计时器并置 null（暂停），设置 `waitingForChildSession = true`，启动子 session 超时计时器
- **其他工具调用** → 正常重置不活跃计时器（行为不变）

### 3.7 toolCallUpdate Handler — 子 Session 返回后恢复计时器

**文件**: `process-manager.ts` 第 899-910 行

**修改前**:
```typescript
toolCallUpdate: (output: string) => {
  if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
    clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
```

**修改后**:
```typescript
toolCallUpdate: (output: string) => {
  if (state.waitingForChildSession) {
    state.waitingForChildSession = false;
    if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); state.childSessionTimeoutTimer = null; }
    if (config.INACTIVITY_TIMEOUT_MS > 0) {
      state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
    }
    // ... 日志
  } else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
    clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
```

逻辑说明：
- **waitingForChildSession 状态** → 子 Agent 的 `Agent`/`Task` 工具返回结果 → 清除子 session 超时计时器，恢复不活跃计时器
- **非等待状态** → 正常重置不活跃计时器（行为不变）

### 3.8 raw(__alive__) Handler — 存活信号映射到对应计时器

**文件**: `process-manager.ts` 第 994-998 行

**修改前**:
```typescript
raw: (data: string) => {
  if (data === '__alive__' && config.INACTIVITY_TIMEOUT_MS > 0) {
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
  }
},
```

**修改后**:
```typescript
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
```

逻辑说明：
- **waitingForChildSession 状态** → `__alive__` 表示子 session 进程仍在运行 → 重置子 session 超时计时器（延长兜底窗口）
- **非等待状态** → 正常重置不活跃计时器（行为不变）

### 3.9 续推计数器防循环修复（两处）

**位置 1**: `process-manager.ts` 第 360 行（try 块，`stopReason === 'cancelled'`）

**位置 2**: `process-manager.ts` 第 451 行（catch 块，cancel 成功路径）

两处原始代码均为：
```typescript
ctx.continueAttempt = 0;
```

修改后：
```typescript
ctx.continueAttempt = Math.max(0, ctx.continueAttempt - 1);
```

原代码在 cancel 成功后续推计数器重置为 0，若 Agent 反复卡住又恢复，计数器不断归零，可能导致无限续推循环。修改为递减而非归零，保证每次完整续推周期都消耗计数配额，cancel 成功恢复只返还 1 次配额。

**审查发现**: 初次修复仅修了第 360 行（try 块），遗漏了第 451 行（catch 块内的 cancel 成功路径）。两处必须同时修复，否则 catch 块路径仍可触发无限循环。

### 3.11 text/error/stderr Handler — waitingForChildSession 时的存活信号

**文件**: `process-manager.ts` 第 786-789 行 (text)、946-949 行 (error)、966-969 行 (stderr)

**修改前**（三处相同模式）:
```typescript
if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
  clearTimeout(state.inactivityTimer);
  state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
}
```

**修改后**（三处相同模式）:
```typescript
if (state.waitingForChildSession && state.childSessionTimeoutTimer) {
  clearTimeout(state.childSessionTimeoutTimer);
  state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
} else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
  clearTimeout(state.inactivityTimer);
  state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
}
```

当 `waitingForChildSession = true` 时，`state.inactivityTimer` 为 null，原条件 `state.inactivityTimer` 为 false 导致整个计时器重置逻辑被跳过——既不误启不活跃计时器，也没重置 childSessionTimeoutTimer。如果子 session 的 text/error/stderr 事件冒泡到父 stream，这些事件表示进程存活，应该延长兜底窗口。

### 3.12 续推日志消息超时值修正

**文件**: `process-manager.ts` 第 437 行

**修改前**:
```typescript
message: `Agent 无响应 ${INACTIVITY_TIMEOUT_MS/1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`
```

**修改后**:
```typescript
message: `Agent 无响应 ${state.inactivityTimeoutTriggered ? INACTIVITY_TIMEOUT_MS/1000 : CHILD_SESSION_TIMEOUT_MS/1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`
```

原日志消息永远显示 1500s（不活跃超时阈值），但 child session timeout 触发时实际等待了 3600s（子 session 兜底阈值）。修改后根据 `state.inactivityTimeoutTriggered` 标志选择正确的超时值：普通不活跃超时显示 1500s，子 session 超时显示 3600s。

### 3.13 childSessionTimeoutTimer 清理路径

**catch 块** (第 387-389 行):
```typescript
if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); state.inactivityTimer = null; }
if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); state.childSessionTimeoutTimer = null; }
state.waitingForChildSession = false;
state.inactivityTimeoutReject = null;
```

**finally 块** (第 520-526 行):
```typescript
if (state.inactivityTimer) { clearTimeout(state.inactivityTimer); }
if (state.childSessionTimeoutTimer) { clearTimeout(state.childSessionTimeoutTimer); }
if (client) await client.destroy();
this.processes.delete(taskId);
```

所有退出路径（end_turn / cancelled / exitCode / 错误返回 / finally）均清理 `childSessionTimeoutTimer`，避免悬挂计时器。

## 4. 状态转换图

### 修改前

```
toolCall(Agent/Task) → 重置 inactivityTimer(1500s) → 等待子返回
  → 1500s 内无事件 → inactivityTimer 到期 → handleInactivityTimeout
  → client.cancel() → cancel 传播到子 session → 子 session 工具被中断
```

### 修改后

```
toolCall(Agent/Task) → 清除 inactivityTimer(null) → waitingForChildSession = true
  → 启动 childSessionTimeoutTimer(1h) → 等待子返回
  
  子正常完成:
    toolCallUpdate → waitingForChildSession = false
      → 清除 childSessionTimeoutTimer → 恢复 inactivityTimer(1500s)
  
  __alive__ 信号:
    raw('__alive__') → waitingForChildSession 时重置 childSessionTimeoutTimer

  text/error/stderr 事件:
    text/error/stderr → waitingForChildSession 时重置 childSessionTimeoutTimer
    （子 session 输出冒泡到父 stream 时，表示进程存活）
  
  子 session 卡死(1h无 alive 也无 return):
    childSessionTimeoutTimer 到期 → handleChildSessionTimeout
      → 触发与普通不活跃超时相同的续推机制（方案 A → 方案 B）
```

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHILD_SESSION_TIMEOUT_MS` | `3600000`（1小时） | 子 session 兜底超时。父 session 等待 Agent/Task 工具调用返回的最大时间，超时后触发续推。0 = 无兜底（风险：子 session 卡死导致父 session 永久挂起） |

新增环境变量需在 `codeswarm/.env` 中添加（如需自定义值）：

```bash
# 子 session 兜底超时（默认 1 小时）
# 仅在父 session 等待 Agent/Task 工具调用期间生效
CHILD_SESSION_TIMEOUT_MS=3600000
```

## 6. 风险评估

### 6.1 子 session 卡死且 1h 兜底超时也不够

**风险**: 子 session 因模型 API 永久故障等原因卡死超过 1 小时。
**缓解**: 兜底超时触发后走正常续推流程（cancel → destroy → 重建），最多 5 次续推。总兜底时间 = 1h × 5 = 5h，在 7 天任务总超时下可接受。可通过 `CHILD_SESSION_TIMEOUT_MS` 调大兜底窗口。

### 6.2 `__alive__` 信号未冒泡到父 session

**风险**: opencode 在子 session 执行期间不向父 session stream 发送 `usage_update`，导致 `__alive__` 不可用。
**缓解**: 即使没有 `__alive__`，兜底计时器仍以 1h 为限运行。`__alive__` 是优化（延长兜底窗口），不是必需条件。

### 6.3 toolCallUpdate 状态不匹配

**风险**: 非子 session 工具的 `toolCallUpdate` 在 `waitingForChildSession` 状态下触发（理论上不可能：父 session 等待子时不应有其他 toolCallUpdate）。
**缓解**: 即使误触发，handler 只是恢复不活跃计时器并清除等待状态，不会造成破坏性后果。正常情况下 Agent/Task 工具的 toolCallUpdate 一定在 waitingForChildSession 状态下触发。

### 6.4 续推计数器递减策略

**风险**: `ctx.continueAttempt = Math.max(0, ctx.continueAttempt - 1)` 让 cancel 成功返还 1 次配额，若 Agent 在 cancel 后立刻再次卡住，计数器净增长为 0（-1 + +1），可能反复。
**缓解**: 即使净增长为 0，每次完整续推周期仍有时间开销（cancel等待10s + 可能的重建5s），实际不会无限快循环。如需更严格，可改为完全不返还（保持 `ctx.continueAttempt` 不变）。

### 6.5 审查发现的额外问题（已修复）

#### 6.5.1 catch 块内续推计数器归零遗漏

**问题**: 第 360 行（try 块 `stopReason === 'cancelled'`）已修复为 `Math.max(0, ctx.continueAttempt - 1)`，但第 451 行（catch 块内 cancel 成功路径）仍为 `ctx.continueAttempt = 0`。这是同一类 bug 的漏修。

**复现路径**: inactivity timeout → catch → `ctx.continueAttempt++` → cancel 成功 → `ctx.continueAttempt = 0` → 下次 timeout → `ctx.continueAttempt++` (变 1) → cancel 成功 → `ctx.continueAttempt = 0` → 无限循环，永远不超过 `CONTINUE_MAX_ATTEMPTS`。

**修复**: 第 451 行同样改为 `ctx.continueAttempt = Math.max(0, ctx.continueAttempt - 1)`。

#### 6.5.2 text/error/stderr handler 在 waitingForChildSession 时未处理

**问题**: 当 `waitingForChildSession = true` 时，`state.inactivityTimer` 为 null。`text`、`error`、`stderr` handler 的条件 `state.inactivityTimer` 为 false，直接跳过计时器重置——既不误启不活跃计时器，**也没重置 childSessionTimeoutTimer**。如果子 session 的输出冒泡到父 stream，这些事件表示进程存活，应重置兜底计时器。

**修复**: 三个 handler 增加 `waitingForChildSession` 分支：

```typescript
// text handler — 修改后
if (state.waitingForChildSession && state.childSessionTimeoutTimer) {
  clearTimeout(state.childSessionTimeoutTimer);
  state.childSessionTimeoutTimer = setTimeout(config.handleChildSessionTimeout, config.CHILD_SESSION_TIMEOUT_MS);
} else if (config.INACTIVITY_TIMEOUT_MS > 0 && state.inactivityTimer) {
  clearTimeout(state.inactivityTimer);
  state.inactivityTimer = setTimeout(config.handleInactivityTimeout, config.INACTIVITY_TIMEOUT_MS);
}
// error handler、stderr handler 同理
```

#### 6.5.3 续推日志消息显示超时值不准确

**问题**: 第 437 行的续推事件日志永远显示 `INACTIVITY_TIMEOUT_MS/1000`（1500s），但 child session timeout 触发时实际等待了 `CHILD_SESSION_TIMEOUT_MS/1000`（3600s）。

**修复**: 根据 `state.inactivityTimeoutTriggered` 标志选择正确的超时值：

```typescript
message: `Agent 无响应 ${state.inactivityTimeoutTriggered ? INACTIVITY_TIMEOUT_MS/1000 : CHILD_SESSION_TIMEOUT_MS/1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`
```

## 7. 测试场景

### 7.1 子 session 正常执行（最常见场景）

- 父 Agent 调用 `Agent`/`Task` 工具
- 子 session 正常工作 10-30 分钟
- 子 session 返回结果 → `toolCallUpdate` 事件
- **预期**: 不活跃计时器暂停 → 子 session 超时计时器运行 → 子返回后恢复正常计时 → 不触发续推

### 7.2 子 session 执行超过 1500s（原 bug 场景）

- 父 Agent 调用 `Agent`/`Task` 工具
- 子 session 执行 > 1500s（如执行多个 Skill）
- **预期**: 不活跃计时器已暂停 → 不会在 1500s 时触发续推 → 子正常完成 → 不触发 cancel → fast_write 不被中断

### 7.3 子 session 卡死 1 小时（兜底场景）

- 父 Agent 调用 `Agent`/`Task` 工具
- 子 session 卡死（模型 API 挂起）
- 1 小时无 `__alive__` 也无 `toolCallUpdate`
- **预期**: `childSessionTimeoutTimer` 到期 → `handleChildSessionTimeout` 触发 → 走正常续推流程

### 7.4 子 session 卡死但 `__alive__` 可用

- 子 session 进程存活但不响应 prompt
- `usage_update` 每 30-60s 发送一次 `__alive__`
- **预期**: `__alive__` 不断重置 `childSessionTimeoutTimer` → 兜底窗口无限延长 → 需依赖任务总超时 (`TASK_TIMEOUT_SEC`) 作为最终终止条件

### 7.5 嵌套子 session（Agent 调用 Agent）

- 父 → 子1 → 子2 的嵌套调用
- **预期**: 父的 `toolCall(Agent)` 暂停不活跃计时器。子1 内部的 `Agent`/`Task` 调用不影响父的计时器（子1 的 ACP 事件不冒泡到父）。父仍依赖 `childSessionTimeoutTimer` 兜底。

## 8. 与 ACP-continuation-design.md 的关系

本修复是在 [ACP-continuation-design.md](./ACP-continuation-design.md) 续推机制基础上的**补充优化**，不改变续推的核心流程（方案 A/B），只改变了**不活跃超时的触发条件**：

| 对比项 | 续推设计（原） | 本修复（新） |
|--------|---------------|-------------|
| 不活跃超时触发条件 | 任何 1500s 无 ACP 事件 | 普通工具：1500s 无事件；Agent/Task 工具：暂停，1h 兜底 |
| `__alive__` 信号处理 | 重置不活跃计时器 | 按状态映射：等待子时重置兜底计时器 |
| 续推计数器 | cancel 成功后归零 | cancel 成功后递减（-1） |