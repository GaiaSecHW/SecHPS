# ACP 任务中断续推机制设计

> 日期: 2026-05-27
> 状态: 设计阶段（已评审修订）
> 涉及模块: `codeswarm/packages/worker/src/process-manager.ts`, `codeswarm/packages/acp/src/index.ts`, `codeswarm/packages/worker/src/daemon.ts`

## 1. 问题背景

### 1.1 现象

Worker 使用 opencode ACP 协议执行长任务时，任务在运行一段时间后出现"卡住"现象——无返回、无事件、无进度更新，看起来像永久挂起。

### 1.2 根因分析

`ACPClient.sendPrompt()` 调用 `connection.prompt()`（来自 `@agentclientprotocol/sdk`），该调用在 SDK 内部将请求存入 `pendingResponses` Map，等待 JSON-RPC 响应。此 Promise **没有内置超时**，只有以下解除路径：

1. opencode 进程发送 JSON-RPC 响应 → `handleResponse()` resolve
2. nd-json stream 关闭（进程退出）→ SDK `close()` reject 所有 pending

当 opencode 进程活着但模型 API 卡住（无限等待、rate limit 内部重试、连接挂起等），进程不发任何 ACP 数据，stream 仍然开着 → `pendingResponses` 中的 Promise **永远不解除**。

### 1.3 ACP 协议中的事件类型与静默窗口

ACP 协议定义的 session update 类型：

| 类型 | 说明 | 是否重置不活跃计时器 |
|------|------|---------------------|
| `agent_message_chunk` | Agent 文本输出 | ✅ 是 |
| `agent_thought_chunk` | Agent 思考过程 | ✅ 是 |
| `tool_call` | 工具调用开始 | ✅ 是 |
| `tool_call_update` | 工具调用结果 | ✅ 是 |
| `usage_update` | Token 用量报告 | ❌ 当前被忽略 |
| `available_commands_update` | 可用命令更新 | ❌ 当前被忽略 |
| `plan` | Agent 计划步骤 | ❌ 当前被忽略 |

**关键发现**：ACP 协议**没有 heartbeat/keepalive 机制**。opencode 在等待模型 API 响应期间（从 prompt 发出到第一个 token 返回），不会发送任何 ACP 事件。这意味着正常的模型推理静默期（extended thinking 3-5 分钟、高负载 TTFT 2-5 分钟）与真正的"卡死"在事件层面无法区分。

### 1.4 现有打破机制及其缺陷

| 机制 | 位置 | 默认值 | 问题 |
|------|------|--------|------|
| 不活跃超时 | `process-manager.ts:147` | `0`（禁用） | 触发后直接 destroy 进程 → 任务彻底失败，无法恢复 |
| 任务总超时 | `process-manager.ts:450` | 7天 | 太长，实际等于无保护 |
| sendPrompt destroyed 检查 | `acp/index.ts:254-260` | 100ms 轮询 | 只检查 `this.destroyed` 标志，不自驱打破 |
| 进程退出 → stream 关闭 | SDK `close()` | 自动 | 对活进程无效 |

**核心矛盾**：当前不活跃超时触发后的唯一动作是 `client.destroy()`（杀进程），任务直接标记为 `failed`。在高延迟模型环境下，"卡住"往往是暂时性的（模型 API 瞬时故障、rate limit 重试中），不应该直接放弃整个任务。

### 1.5 外部验证

- [opencode Issue #11865](https://github.com/anomalyco/opencode/issues/11865)：确认 opencode 子任务卡住后"hangs the session forever"，opencode 自身没有内置超时/重试
- [ACP Request Cancellation RFD](https://agentclientprotocol.com/rfds/request-cancellation)：协议层面的取消机制仍在 RFD 阶段（`$/cancel_request`），尚未正式发布

## 2. 设计目标

1. **不死即续**：当 Agent 出现暂时性中断时，不立即终止任务，而是尝试续推恢复
2. **有限续推**：最多续推 N 次（默认 5 次），超过上限才真正标记失败
3. **进度保持**：续推时尽可能保持已有工作进度，避免从头重新执行
4. **渐进策略**：先尝试协议级 cancel（轻量），失败后再 destroy 重建（重量）
5. **兼容现有架构**：改动局限在 `process-manager.ts` 和 `acp/index.ts`，不影响 daemon.ts 和上层调度

## 3. 核心设计：分层续推策略

### 3.1 当前流程

```
client.start() → client.createSession() → client.sendPrompt(instruction)
  └── Promise.race([sendPrompt, timeoutPromise(7d), inactivityTimeoutPromise(禁用)])
      ├── 正常返回 stopReason → 完成/等待 exitCode
      ├── 不活跃超时 → client.destroy() → catch块 → 任务failed
      └── 7天超时 → 任务failed
```

单次执行，失败即死。

### 3.2 新流程：分层续推循环

```
client.start() → client.createSession() → 
  while (continueAttempts <= MAX_CONTINUE_ATTEMPTS) {
    try {
      stopReason = await Promise.race([
        client.sendPrompt(currentInstruction),
        inactivityPromise(INACTIVITY_TIMEOUT_MS),   // 15分钟
        taskTimeoutPromise(整体上限),
      ])
      
      if (stopReason === 'cancelled') {
        → cancel 成功，同 session 发续推 prompt
        continue
      }
      → 正常完成：break 退出循环
      
    } catch (inactivityError) {
      continueAttempts++
      → 第一步：尝试 session/cancel（协议级取消）
        ├── 10秒内收到 stopReason:"cancelled" → 同 session 续推（方案 A）
        └── 10秒内无响应 → destroy + 重建 client + 新 session（方案 B）
      → 超过 MAX_CONTINUE_ATTEMPTS → 标记 failed
    }
  }
```

### 3.3 续推策略详解

#### 方案 A：协议级 Cancel + 同 Session 续推（首选）

**原理**：ACP 协议定义了 `session/cancel` 通知，客户端可以发送给 Agent 请求取消当前 prompt。

**协议流程**：
1. Client 发送 `session/cancel` 通知（JSON-RPC notification，无需响应）
2. Agent 收到后停止当前工作
3. Agent 以 `stopReason: "cancelled"` 响应原始 `session/prompt` 请求
4. `connection.prompt()` 的 Promise 正常 resolve
5. Session 保持存活，可以继续发送新 prompt

**步骤**：
1. 调用 `client.cancel(sessionId)` 发送 `session/cancel` 通知
2. 等待 `sendPrompt()` 返回（最多 10 秒）
3. 如果收到 `stopReason: "cancelled"` → 在同一 session 中发送续推 prompt
4. Agent 基于已有的 session 上下文继续工作

**优势**：
- 使用协议标准机制，不是 hack
- 完整保留 session 上下文（Agent 知道之前做了什么）
- 不需要重建 client，开销最小
- 如果 opencode 能响应 cancel，恢复最快

**限制**：
- Cancel 是**协作式的**（cooperative）——Agent 必须主动检查 cancel 标志
- 如果 opencode 阻塞在模型 API HTTP 请求上，可能不会检查 cancel
- opencode Issue #11865 证实：opencode 在模型 API 等待期间可能不响应 cancel

**降级条件**：发送 cancel 后 10 秒内 `sendPrompt()` 未返回 → 降级到方案 B

#### 方案 B：Destroy + 新 Session 续推（降级方案）

**条件**：方案 A 超时未响应，或进程已退出

**步骤**：
1. `client.destroy()` 完全终止当前 client（SIGTERM → 5s → SIGKILL）
2. 重新创建 `ACPClient`，调用 `start()` + `createSession()`
3. 从已收集的事件中提取进度摘要
4. 调用 `sendPrompt(摘要 + 续推指令)` 在新 session 中续推

**优势**：
- 完全干净的状态，不会有 SDK 残留问题
- 可靠性高，不依赖 opencode 的 cancel 实现

**劣势**：
- 丢失原始 session 的完整上下文
- Agent 不知道之前的具体工作细节，只能通过摘要了解大致进度
- 可能重复已完成的工作

**缓解措施**：
- 进度摘要尽可能详细（已完成的 Skill 列表、已发现的漏洞、当前所在阶段）
- 在续推指令中明确说明"以下工作已完成，请不要重复执行"
- workspace 中的文件保持不变，Agent 可以读取这些文件了解进度
- 续推 prompt 中明确指示 Agent 检查 workspace 已有文件

#### 策略选择流程图

```
不活跃超时触发（15分钟无事件）
  ↓
continueAttempts++ → 检查是否超过 MAX_CONTINUE_ATTEMPTS
  ├── 超过 → 任务 failed
  └── 未超过 ↓
      
发送 session/cancel 通知
  ↓ 等待 10 秒
  ├── sendPrompt 返回 stopReason:"cancelled"
  │     → 方案 A：同 session 发续推 prompt
  │     → 重置不活跃计时器，继续循环
  │
  ├── sendPrompt 返回其他 stopReason（end_turn 等）
  │     → 任务实际已完成，正常退出
  │
  └── 10 秒内无响应
        → 方案 B：destroy 进程 + 重建 client + 新 session + 进度摘要注入
        → 重置不活跃计时器，继续循环
```

## 4. 详细实现设计

### 4.1 配置参数

环境变量（统一命名）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `INACTIVITY_TIMEOUT_MS` | `1500000`（25分钟） | 不活跃超时触发间隔，0=禁用续推（回退到当前行为） |
| `CONTINUE_MAX_ATTEMPTS` | `5` | 最大续推次数，0=禁用续推 |
| `CANCEL_WAIT_MS` | `10000`（10秒） | 发送 session/cancel 后等待响应的超时 |
| `TASK_TIMEOUT_SEC` | `604800`（7天） | 任务总超时（含所有续推尝试的总时长） |

**阈值选择理由**：
- 25 分钟：兼容 extended thinking（最长可达 10 分钟）+ 高负载 TTFT（2-5 分钟）+ 安全余量（2.5 倍于最长正常静默期）。正常模型输出时 `agent_message_chunk` 会持续重置计时器，加上 `usage_update` 存活信号，只有"完全无任何 ACP 事件"才会触发。
- 5 次续推：长任务（小时级）中模型 API 可能多次间歇性故障，5 次机会提供更高的最终完成率。最坏情况额外耗时 ~135 分钟（25 分钟×5 + 10 秒×5 + 重建时间），在 7 天总超时下完全可接受。
- 10 秒 cancel 等待：如果 opencode 能响应 cancel，通常在 1-2 秒内就会返回。10 秒足够宽裕又不会浪费太多时间。

### 4.2 ACPClient 新增 cancel 方法

```typescript
// acp/src/index.ts 新增

/** Send session/cancel notification to abort current prompt */
async cancel(): Promise<void> {
  if (!this.sessionId || !this.connection) {
    console.log('[ACP] Cannot cancel: no active session');
    return;
  }
  console.log(`[ACP] Sending session/cancel for session ${this.sessionId}`);
  // session/cancel 是 notification（单向），不需要等待响应
  this.connection.sendNotification('session/cancel', {
    sessionId: this.sessionId,
  });
}
```

注意：`sendNotification` 是 fire-and-forget，不会阻塞。cancel 的效果通过 `sendPrompt()` 返回 `stopReason: "cancelled"` 来体现。

### 4.3 数据结构

```typescript
// process-manager.ts 内部新增

interface ContinuationContext {
  /** 原始指令 */
  originalInstruction: string;
  /** 当前续推次数（0=首次执行, 1-N=续推） */
  continueAttempt: number;
  /** 已收集的关键事件（用于提取进度摘要，限制最近 200 条） */
  eventHistory: AgentEvent[];
  /** 已完成的 Skill 列表 */
  completedSkills: string[];
  /** 上次使用的续推策略 */
  lastStrategy: 'cancel_same_session' | 'destroy_new_session';
}

const MAX_EVENT_HISTORY = 200;
```

### 4.4 runAgent() 改造伪代码

```typescript
async runAgent(taskId, workspace, engine, agentName, apiKey, model, env, 
               instruction, onEvent, apiBaseUrl, timeoutMs): Promise<RunAgentResult> {
  
  const INACTIVITY_TIMEOUT_MS = parseInt(process.env.INACTIVITY_TIMEOUT_MS || '900000');
  const CONTINUE_MAX_ATTEMPTS = parseInt(process.env.CONTINUE_MAX_ATTEMPTS || '5');
  const CANCEL_WAIT_MS = parseInt(process.env.CANCEL_WAIT_MS || '10000');
  
  // 如果 INACTIVITY_TIMEOUT_MS === 0 或 CONTINUE_MAX_ATTEMPTS === 0，回退到当前行为
  const continuationEnabled = INACTIVITY_TIMEOUT_MS > 0 && CONTINUE_MAX_ATTEMPTS > 0;
  
  // 续推上下文
  const ctx: ContinuationContext = {
    originalInstruction: instruction || '执行任务',
    continueAttempt: 0,
    eventHistory: [],
    completedSkills: [],
    lastStrategy: 'cancel_same_session',
  };
  
  let client: ACPClient | null = null;
  let stdout = '';
  let stderr = '';
  let currentSkill: string | null = null;
  let inactivityTimer: NodeJS.Timeout | null = null;
  let inactivityTimeoutReject: ((reason: Error) => void) | null = null;
  
  const taskStartTime = Date.now();
  const effectiveTimeoutMs = timeoutMs || 7 * 24 * 3600 * 1000;

  // ... 环境变量合并（现有逻辑不变）...
  // ... client 创建、start、createSession（现有逻辑不变）...
  // ... 事件处理器注册（现有逻辑 + 追加 eventHistory 收集）...

  // ========== 事件处理器中追加进度收集 ==========
  // 在现有 text/toolCall/toolCallUpdate/error 处理器中，每次事件时：
  //   1. 重置不活跃计时器（已有）
  //   2. 追加到 ctx.eventHistory（新增，限制 MAX_EVENT_HISTORY 条）
  //   3. 更新 ctx.completedSkills（已有 skill_complete 逻辑）

  // ========== 续推循环 ==========
  while (ctx.continueAttempt <= CONTINUE_MAX_ATTEMPTS) {
    
    // 检查任务总超时
    const elapsed = Date.now() - taskStartTime;
    if (elapsed >= effectiveTimeoutMs) {
      console.log(`[ProcessMgr] 任务总超时 (${effectiveTimeoutMs/1000}s)，终止`);
      break;
    }
    const remainingTimeoutMs = effectiveTimeoutMs - elapsed;
    
    // 根据续推状态决定当前指令
    const currentInstruction = ctx.continueAttempt === 0
      ? ctx.originalInstruction
      : buildContinuationPrompt(ctx);
    
    // 如果上次是 destroy_new_session 策略，需要重建 client
    if (ctx.lastStrategy === 'destroy_new_session' && ctx.continueAttempt > 0) {
      console.log(`[ProcessMgr] 重建 client（新 session 续推）`);
      client = new ACPClient();
      await client.start(clientConfig);
      await client.createSession(sessionAgent);
      registerEventHandlers(client, ctx, onEvent, ...);
    }
    
    // 发送 prompt
    try {
      // 设置不活跃计时器
      const inactivityPromise = new Promise<never>((_, reject) => {
        inactivityTimeoutReject = reject;
      });
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (continuationEnabled) {
        inactivityTimer = setTimeout(() => {
          inactivityTimeoutReject?.(
            new Error(`Inactivity timeout: no events for ${INACTIVITY_TIMEOUT_MS/1000}s`)
          );
        }, INACTIVITY_TIMEOUT_MS);
      }
      
      const stopReason = await Promise.race([
        client.sendPrompt(currentInstruction),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Task overall timeout')), remainingTimeoutMs)),
        continuationEnabled ? inactivityPromise : new Promise<never>(() => {}),
      ]);
      
      // 清理计时器
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
      inactivityTimeoutReject = null;
      
      // ========== 正常完成 ==========
      if (stopReason === 'end_turn') {
        await client.destroy();
        return { exitCode: 0, stdout, stderr };
      }
      
      if (stopReason === 'cancelled') {
        // cancel 成功返回，继续循环发送续推 prompt（方案 A 成功路径）
        console.log(`[ProcessMgr] Cancel 成功，同 session 续推`);
        ctx.lastStrategy = 'cancel_same_session';
        continue;
      }
      
      // 其他 stopReason → 等待 exitCode（现有逻辑）
      const exitCode = await Promise.race([
        client.exitCode,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout waiting for exit')), 30000)),
      ]);
      await client.destroy();
      return { exitCode: exitCode ?? 1, stdout, stderr };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isInactivityTimeout = errorMsg.includes('Inactivity timeout');
      
      if (!isInactivityTimeout) {
        // 非不活跃超时（真正的进程错误、SDK 错误等）→ 现有错误处理逻辑
        if (hasSubstantialOutput(stdout)) {
          return { exitCode: 0, stdout, stderr };
        }
        return { exitCode: 1, stdout, stderr };
      }
      
      // ========== 不活跃超时 → 进入续推流程 ==========
      ctx.continueAttempt++;
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
      
      if (ctx.continueAttempt > CONTINUE_MAX_ATTEMPTS) {
        console.log(`[ProcessMgr] 超过最大续推次数(${CONTINUE_MAX_ATTEMPTS})，任务失败`);
        if (onEvent) {
          onEvent({
            type: 'error',
            message: `Agent 连续 ${CONTINUE_MAX_ATTEMPTS} 次无响应，任务终止`,
            timestamp: new Date().toISOString(),
          });
        }
        if (client) await client.destroy();
        return { exitCode: 1, stdout, stderr };
      }
      
      // 推送续推事件给前端
      if (onEvent) {
        onEvent({
          type: 'continuation_attempt',
          message: `Agent 无响应 ${INACTIVITY_TIMEOUT_MS/1000}s，第 ${ctx.continueAttempt}/${CONTINUE_MAX_ATTEMPTS} 次续推`,
          continueAttempt: ctx.continueAttempt,
          timestamp: new Date().toISOString(),
        });
      }
      
      // ========== 第一步：尝试协议级 cancel ==========
      const clientAlive = client?.process?.exitCode === null;
      
      if (clientAlive) {
        console.log(`[ProcessMgr] 进程存活，尝试 session/cancel`);
        client.cancel();
        
        // 等待 sendPrompt 返回（cancel 成功时会返回 stopReason:"cancelled"）
        const cancelResult = await Promise.race([
          client.sendPrompt.__currentPromise, // 等待当前 pending 的 prompt resolve
          new Promise<'timeout'>((resolve) => 
            setTimeout(() => resolve('timeout'), CANCEL_WAIT_MS)),
        ]);
        
        if (cancelResult !== 'timeout') {
          // cancel 成功，sendPrompt 已返回
          console.log(`[ProcessMgr] session/cancel 成功，同 session 续推`);
          ctx.lastStrategy = 'cancel_same_session';
          continue; // 回到循环顶部发送续推 prompt
        }
        
        // cancel 超时，降级到方案 B
        console.log(`[ProcessMgr] session/cancel 无响应(${CANCEL_WAIT_MS}ms)，降级到 destroy`);
      }
      
      // ========== 第二步：方案 B - destroy + 重建 ==========
      console.log(`[ProcessMgr] 执行方案 B：destroy 进程 + 新 session`);
      ctx.lastStrategy = 'destroy_new_session';
      if (client) {
        await client.destroy();
        client = null;
      }
      continue; // 回到循环顶部，重建 client 并发送续推 prompt
    }
  }
  
  // 超过最大续推次数或总超时
  if (client) await client.destroy();
  return { exitCode: 1, stdout, stderr };
}
```

**注意**：上述伪代码中 `client.sendPrompt.__currentPromise` 是简化表示。实际实现中，需要将 `sendPrompt()` 的 Promise 保存为实例变量，以便在 catch 块中等待其 resolve（cancel 成功时 SDK 会 resolve 该 Promise）。

### 4.5 实际实现中 cancel 等待的处理

由于 `sendPrompt()` 在 `Promise.race` 中被不活跃超时 reject 打断，但 SDK 内部的 `connection.prompt()` 仍在运行。发送 `session/cancel` 后，SDK 内部的 prompt 会以 `stopReason: "cancelled"` resolve。

实现方式：将 `connection.prompt()` 的原始 Promise 保存，cancel 后等待它：

```typescript
// ACPClient 改造
private _currentPromptPromise: Promise<any> | null = null;

async sendPrompt(prompt: string): Promise<StopReason> {
  // ... 现有验证逻辑 ...
  this._abortController = new AbortController();
  
  // 保存原始 prompt promise
  this._currentPromptPromise = this.connection.prompt({
    sessionId: this.sessionId,
    prompt: [{ type: 'text', text: prompt }],
  });
  
  try {
    const result = await Promise.race([
      this._currentPromptPromise,
      new Promise<never>((_, reject) => {
        const checkDestroyed = setInterval(() => {
          if (this.destroyed) { clearInterval(checkDestroyed); reject(new Error('Prompt cancelled by destroy')); }
        }, 100);
        this._abortController?.signal.addEventListener('abort', () => {
          clearInterval(checkDestroyed);
          reject(new Error('Prompt aborted'));
        });
      }),
    ]);
    return result.stopReason;
  } finally {
    this._abortController = null;
    this._currentPromptPromise = null;
  }
}

/** 等待当前 prompt 完成（用于 cancel 后等待 SDK 返回） */
async waitForCurrentPrompt(timeoutMs: number): Promise<StopReason | null> {
  if (!this._currentPromptPromise) return null;
  try {
    const result = await Promise.race([
      this._currentPromptPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result?.stopReason ?? null;
  } catch {
    return null;
  }
}
```

ProcessManager 中的 cancel 等待逻辑：

```typescript
// 在 catch 块中，cancel 后等待
if (clientAlive) {
  client.cancel();
  const cancelStopReason = await client.waitForCurrentPrompt(CANCEL_WAIT_MS);
  
  if (cancelStopReason === 'cancelled') {
    ctx.lastStrategy = 'cancel_same_session';
    continue;
  }
  // 未返回或返回其他 → 降级方案 B
}
```

### 4.6 续推指令构造

```typescript
function buildContinuationPrompt(ctx: ContinuationContext): string {
  const attempt = ctx.continueAttempt;
  const original = ctx.originalInstruction;
  const summary = extractProgressSummary(ctx);
  
  // 根据策略和次数构造不同强度的提醒
  const strategyHint = ctx.lastStrategy === 'cancel_same_session'
    ? '（你之前的工作上下文仍然保留，请直接继续）'
    : '（这是一个新的会话，请根据以下进度摘要继续工作）';
  
  if (attempt === 1) {
    return [
      `你之前的任务执行中断了，请继续完成原始任务。${strategyHint}`,
      summary ? `\n当前进度:\n${summary}` : '',
      `\n原始指令:\n${original}`,
      `\n请从上次中断的地方继续，不要重复已完成的工作。`,
      ctx.lastStrategy === 'destroy_new_session'
        ? `\n请先检查工作目录中已有的文件，了解之前的工作进度。`
        : '',
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
  
  // 第三次：最后警告
  return [
    `🔴 最后一次续推提醒。如果仍然无法继续，任务将被终止。`,
    summary ? `\n进度: ${summary}` : '',
    `\n原始指令（精简）:\n${original.substring(0, 300)}`,
    `\n请立即执行剩余任务。`,
  ].join('');
}
```

### 4.7 进度摘要提取

```typescript
function extractProgressSummary(ctx: ContinuationContext): string {
  const lines: string[] = [];
  
  // 已完成的 Skill
  if (ctx.completedSkills.length > 0) {
    lines.push(`已完成的检测: ${ctx.completedSkills.join(', ')}`);
  }
  
  // 从 eventHistory 提取工具调用摘要
  const toolCalls = ctx.eventHistory.filter(e => e.type === 'tool_call');
  const toolNames = toolCalls.map(e => e.tool).filter(Boolean);
  if (toolNames.length > 0) {
    const uniqueTools = [...new Set(toolNames)];
    lines.push(`已使用的工具: ${uniqueTools.join(', ')} (共${toolNames.length}次调用)`);
  }
  
  // 最近的文本输出（最后 200 字符）
  const textChunks = ctx.eventHistory.filter(e => e.type === 'agent_message_chunk');
  if (textChunks.length > 0) {
    const lastText = textChunks.slice(-5).map(e => e.content).join('');
    if (lastText.length > 0) {
      lines.push(`最后输出: "${lastText.substring(0, 200)}..."`);
    }
  }
  
  // 限制总长度 500 字符
  const result = lines.join('\n');
  return result.length > 500 ? result.substring(0, 500) + '...' : result;
}
```

### 4.8 事件收集（在现有 handler 中追加）

在 `runAgent()` 的事件处理器中，每次事件到达时追加到 `ctx.eventHistory`：

```typescript
// 在现有 text handler 中追加一行：
text: (content: string) => {
  // ... 现有逻辑（重置计时器、追加 stdout、推送 onEvent）...
  
  // 新增：收集到续推上下文
  ctx.eventHistory.push({ type: 'agent_message_chunk', content, timestamp: new Date().toISOString() });
  if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();
},

// 在现有 toolCall handler 中追加一行：
toolCall: (tool: string, input: unknown, title?: string) => {
  // ... 现有逻辑 ...
  
  ctx.eventHistory.push({ type: 'tool_call', tool: (title || tool).toLowerCase(), timestamp: new Date().toISOString() });
  if (ctx.eventHistory.length > MAX_EVENT_HISTORY) ctx.eventHistory.shift();
},

// skill_complete 事件时更新 completedSkills：
if (currentSkill && currentSkill !== skillName) {
  ctx.completedSkills.push(currentSkill);
  // ... 现有 onEvent 推送 ...
}
```

### 4.9 usage_update 作为存活信号

当前 `usage_update` 被 ACPClient 静默忽略。建议将其作为"进程存活"信号，重置不活跃计时器：

```typescript
// acp/src/index.ts handleSessionUpdate 中修改
case 'usage_update':
case 'available_commands_update':
  // 不发射业务事件，但触发存活信号
  this.eventHandlers.raw?.('__alive__');
  break;
```

ProcessManager 中注册 `raw` handler 用于重置计时器：

```typescript
raw: (data: string) => {
  if (data === '__alive__' && INACTIVITY_TIMEOUT_MS > 0) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT_MS);
  }
},
```

## 5. 与现有超时机制的协调

| 机制 | 当前行为 | 续推后行为 | 关系 |
|------|---------|-----------|------|
| `INACTIVITY_TIMEOUT_MS` | `0`（禁用）或直接杀进程 | `900000`（15分钟），触发续推流程 | 语义变更：从"超时→杀"到"超时→续推" |
| `TASK_TIMEOUT_SEC` | 7天 | 保持不变，作为整体上限 | 续推循环的总耗时不能超过此值 |
| `CONTINUE_MAX_ATTEMPTS` | — | 5次 | 新增 |
| `CANCEL_WAIT_MS` | — | 10秒 | 新增 |
| Stream Watchdog | 6小时空闲超时 | 不受影响（主服务器侧） | 独立机制 |
| Worker 心跳 | 90s 过期 | 不受影响（独立心跳通道） | 独立机制 |

**任务总超时计算**：

最坏情况耗时 = 原始执行时间 + (不活跃超时 + cancel等待 + 重建时间) × 续推次数
= 原始时间 + (25分钟 + 10秒 + ~5秒) × 5次 ≈ 原始时间 + 135分钟

在 7 天总超时下，61 分钟的续推开销完全可接受。

## 6. 事件推送与前端交互

### 6.1 续推过程中的事件流

```
[正常执行阶段]
  onEvent: agent_message_chunk, tool_call, skill_start, ...

[不活跃超时触发 → 尝试 cancel]
  onEvent: { type: 'continuation_attempt', continueAttempt: 1,
             message: 'Agent 无响应 900s，第 1/5 次续推' }

[Cancel 成功 → 同 session 续推]
  onEvent: { type: 'continuation_success', strategy: 'cancel_same_session',
             message: 'Agent 已恢复（同会话续推）' }
  onEvent: agent_message_chunk, tool_call, ...  (恢复正常)

[Cancel 失败 → destroy + 新 session 续推]
  onEvent: { type: 'continuation_fallback', strategy: 'destroy_new_session',
             message: 'Cancel 无响应，重建会话续推' }
  onEvent: agent_message_chunk, tool_call, ...  (新 session 恢复)

[最终失败]
  onEvent: { type: 'error', message: 'Agent 连续 5 次无响应，任务终止' }
```

### 6.2 前端展示建议

- 续推尝试时显示黄色警告条："Agent 暂时无响应，正在尝试恢复...（第 1/5 次）"
- Cancel 成功恢复时显示绿色提示："Agent 已恢复，继续执行"
- 降级到新 session 时显示橙色提示："已重建会话，继续执行"
- 最终失败时显示红色错误："Agent 连续多次无响应，任务已终止"

## 7. 风险评估与缓解

### 7.1 Cancel 不响应风险（最常见场景）

**风险**：opencode 阻塞在模型 API HTTP 请求上，不检查 cancel 标志。

**缓解**：10 秒等待后自动降级到方案 B（destroy + 重建）。这是预期中的常见路径——方案 A 是"尝试性优化"，方案 B 是"保底方案"。

**预期**：大部分续推会走方案 B 路径。方案 A 主要在 opencode 内部重试（rate limit 等待中有检查点）时生效。

### 7.2 新 Session 进度丢失风险

**风险**：新 session 中 Agent 不知道之前的详细工作，可能重复已完成的工作。

**缓解**：
1. 进度摘要包含已完成 Skill 列表和工具调用摘要
2. 续推 prompt 明确指示"请先检查工作目录中已有的文件"
3. workspace 中的文件保持不变（已完成 Skill 的输出文件还在磁盘上）
4. 进度摘要限制 500 字符，避免超长 prompt

### 7.3 误触发风险

**风险**：正常的模型推理静默期（extended thinking）触发不活跃超时。

**缓解**：
1. 默认 15 分钟阈值，是正常 extended thinking 时间（3-5 分钟）的 3 倍安全余量
2. `usage_update` 作为存活信号重置计时器（模型调用完成后会发送）
3. 即使误触发，方案 A（cancel）对正在正常工作的 Agent 影响最小——Agent 收到 cancel 后以 `cancelled` 返回，续推 prompt 让它继续，相当于一次"打断后继续"
4. 5 次续推机会意味着即使偶尔误触发，也不会轻易耗尽配额

### 7.4 eventHistory 内存风险

**风险**：长时间运行的任务产生大量事件。

**缓解**：`MAX_EVENT_HISTORY = 200` 条上限，FIFO 淘汰旧事件。200 条事件约占 ~50KB 内存，完全可控。

### 7.5 续推 prompt 过长风险

**风险**：原始指令 + 进度摘要超过模型 token 限制。

**缓解**：
1. 进度摘要限制 500 字符
2. 第三次续推时原始指令截取前 300 字符
3. 总续推 prompt 控制在 2000 字符以内

### 7.6 进程僵尸风险

**风险**：opencode 进程变成僵尸（活着但不响应任何消息）。

**缓解**：
1. `destroy()` 中 SIGTERM → 5秒 → SIGKILL（已有）
2. 方案 B 的 destroy 是强制性的，不依赖进程配合
3. 如果 SIGKILL 后进程仍未退出，记录日志并继续（极端情况）

## 8. 实施计划

### Phase 1：核心续推循环（P0，预计 2-3 天）

**改动文件**：
- `codeswarm/packages/acp/src/index.ts`
  - 新增 `cancel()` 方法（~10 行）
  - 新增 `_currentPromptPromise` 字段和 `waitForCurrentPrompt()` 方法（~20 行）
  - 修改 `handleSessionUpdate` 中 `usage_update` 处理（~5 行）
- `codeswarm/packages/worker/src/process-manager.ts`
  - 改造 `runAgent()` 为续推循环结构（~80 行新增，~20 行修改）
  - 新增 `buildContinuationPrompt()` 函数（~30 行）
  - 新增 `extractProgressSummary()` 函数（~25 行）
  - 新增 `ContinuationContext` 类型（~10 行）
  - 事件处理器中追加 eventHistory 收集（~10 行）

**预期总改动量**：~210 行新增/修改

### Phase 2：前端事件展示（P1，预计 1 天）

**改动文件**：
- `src/components/codeswarm/` 相关组件 — 续推状态展示
- 新增 `continuation_attempt`、`continuation_success`、`continuation_fallback` 事件类型处理

### Phase 3：可观测性增强（P2，可选）

- 续推次数、策略选择、成功率的 metrics 上报
- 日志中记录每次续推的详细信息（原因、策略、耗时）
- 管理后台展示任务续推历史

## 9. 测试场景

### 9.1 正常执行（无中断）

- 预期：单次 `sendPrompt()` 正常返回 `end_turn`
- 续推循环不触发
- 行为与当前完全一致

### 9.2 模型 API 瞬时卡住 → 15分钟后 cancel 成功

- 预期：不活跃超时触发 → 发送 session/cancel → opencode 响应 cancelled → 同 session 续推
- 续推次数：1
- 策略：cancel_same_session
- 最终结果：任务完成

### 9.3 模型 API 卡死 → cancel 无响应 → destroy 重建

- 预期：不活跃超时触发 → 发送 session/cancel → 10秒无响应 → destroy → 重建 → 新 session 续推
- 续推次数：1
- 策略：destroy_new_session
- 最终结果：任务完成（新 session 中继续）

### 9.4 持续卡死 → 5次续推均失败

- 预期：5次续推尝试（每次都走方案 B）
- 总耗时：~135 分钟（25分钟×5 + 10秒×5 + 重建时间）
- 最终结果：任务 failed

### 9.5 误触发 → cancel 打断正常工作

- 预期：Agent 正在 extended thinking → 15分钟超时 → cancel → Agent 返回 cancelled → 续推 prompt 让它继续
- 影响：Agent 丢失当前思考上下文，但收到续推 prompt 后可以继续
- 最终结果：任务完成（可能有少量重复工作）

### 9.6 进程崩溃（OOM）

- 预期：进程退出 → stream 关闭 → `sendPrompt()` reject（非不活跃超时类型）
- 续推循环不触发（非不活跃超时错误走现有错误处理流程）
- 最终结果：根据 `hasSubstantialOutput()` 判断是否部分成功

### 9.7 续推功能禁用（INACTIVITY_TIMEOUT_MS=0）

- 预期：完全回退到当前行为，续推循环不生效
- 兼容性：100%

## 10. 环境变量完整列表

```bash
# Worker .env 续推相关配置

# 不活跃超时（续推检测间隔）
# 0 = 禁用续推机制（回退到当前行为：超时直接杀进程）
# 默认 1500000ms = 25分钟
INACTIVITY_TIMEOUT_MS=1500000

# 最大续推次数
# 0 = 禁用续推（超时直接失败）
# 默认 5
CONTINUE_MAX_ATTEMPTS=5

# 发送 session/cancel 后等待响应的超时
# 超过此时间无响应则降级到 destroy + 重建
# 默认 10000ms = 10秒
CANCEL_WAIT_MS=10000

# 任务总超时（含所有续推尝试的总时长）
# 默认 604800秒 = 7天
TASK_TIMEOUT_SEC=604800
```

## 11. 与设计文档 v1 的主要变更

| 项目 | v1 设计 | v2 修订 | 原因 |
|------|---------|---------|------|
| 方案 A 机制 | `_abortController.abort()` | `session/cancel` 协议通知 | abort 只是本地逃逸，不通知 Agent；cancel 是 ACP 标准机制 |
| 方案 A 降级检测 | "5秒内无新事件" | "10秒内 prompt 未返回 cancelled" | 更精确：直接等待 SDK 层面的 resolve |
| 默认不活跃超时 | 15分钟 | 25分钟 | 25分钟覆盖 extended thinking 最长 10 分钟场景（仍有 2.5 倍安全余量），配合 usage_update 存活信号进一步降低误触发 |
| 环境变量命名 | `CONTINUE_INTERVAL_MS` + `INACTIVITY_TIMEOUT_MS` 混用 | 统一为 `INACTIVITY_TIMEOUT_MS` | 消除歧义 |
| eventHistory 上限 | 无限制 | 200 条 FIFO | 防止内存泄漏 |
| usage_update 处理 | 静默忽略 | 作为存活信号重置计时器 | 减少误触发 |
| 续推计数 | 方案 A→B 降级消耗次数 | 只有完整续推周期（cancel+等待+可能的重建）才计数 | 更合理 |
| ACPClient 改动 | 无 | 新增 `cancel()`、`waitForCurrentPrompt()` | 支持协议级取消 |

## 12. 参考资料

- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk) — `@agentclientprotocol/sdk ^0.20.0`
- [ACP Request Cancellation RFD](https://agentclientprotocol.com/rfds/request-cancellation) — 通用取消机制（`$/cancel_request`）设计
- [ACP Cancellation Tutorial (Java SDK)](https://springaicommunity.mintlify.app/acp-java-sdk/tutorial/10-cancellation) — `session/cancel` 使用示例
- [opencode Issue #11865](https://github.com/anomalyco/opencode/issues/11865) — 确认 opencode 子任务卡住无超时/重试
- [ACP Streaming Updates](https://springaicommunity.mintlify.app/acp-java-sdk/tutorial/05-streaming-updates) — session update 类型完整列表
