# ACP 任务中断续推机制设计

> 日期: 2026-05-27
> 状态: 设计阶段
> 涉及模块: `codeswarm/packages/worker/src/process-manager.ts`, `codeswarm/packages/acp/src/index.ts`, `codeswarm/packages/worker/src/daemon.ts`

## 1. 问题背景

### 1.1 现象

Worker 使用 opencode ACP 协议执行长任务时，任务在运行一段时间后出现"卡住"现象——无返回、无事件、无进度更新，看起来像永久挂起。

### 1.2 根因分析

`ACPClient.sendPrompt()` 调用 `connection.prompt()`（来自 `@agentclientprotocol/sdk`），该调用在 SDK 内部将请求存入 `pendingResponses` Map，等待 JSON-RPC 响应。此 Promise **没有内置超时**，只有以下解除路径：

1. opencode 进程发送 JSON-RPC 响应 → `handleResponse()` resolve
2. nd-json stream 关闭（进程退出）→ SDK `close()` reject 所有 pending

当 opencode 进程活着但模型 API 卡住（无限等待、rate limit 内部重试、连接挂起等），进程不发任何 ACP 数据，stream 仍然开着 → `pendingResponses` 中的 Promise **永远不解除**。

### 1.3 现有打破机制及其缺陷

| 机制 | 位置 | 默认值 | 问题 |
|------|------|--------|------|
| 不活跃超时 | `process-manager.ts:147` | `0`（禁用） | 触发后直接 destroy 进程 → 任务彻底失败，无法恢复 |
| 任务总超时 | `process-manager.ts:450` | 7天 | 太长，实际等于无保护 |
| sendPrompt destroyed 检查 | `acp/index.ts:254-260` | 100ms 轮询 | 只检查 `this.destroyed` 标志，不自驱打破 |
| 进程退出 → stream 关闭 | SDK `close()` | 自动 | 对活进程无效，对僵尸进程可能失效 |

**核心矛盾**：当前不活跃超时触发后的唯一动作是 `client.destroy()`（杀进程），任务直接标记为 `failed`。在高延迟模型环境下，"卡住"往往是暂时性的（模型 API 瞬时故障、rate limit 重试中），不应该直接放弃整个任务。

## 2. 设计目标

1. **不死即续**：当 Agent 出现暂时性中断时，不立即终止任务，而是尝试续推恢复
2. **有限续推**：最多续推 N 次（建议 3 次），超过上限才真正标记失败
3. **进度保持**：续推时尽可能保持已有工作进度，避免从头重新执行
4. **渐进提醒**：续推间隔可配置，提醒内容随次数递进（从温和提醒到明确指示）
5. **兼容现有架构**：改动局限在 `process-manager.ts` 的 `runAgent()` 方法内，不影响 daemon.ts 和 ACP 协议层

## 3. 核心设计：中断-续推循环

### 3.1 当前流程

```
client.start() → client.createSession() → client.sendPrompt(instruction)
  └── Promise.race([sendPrompt, timeoutPromise(7d), inactivityTimeoutPromise(禁用)])
      ├── 正常返回 stopReason → 完成/等待 exitCode
      ├── 不活跃超时 → client.destroy() → catch块 → 任务failed
      └── 7天超时 → 任务failed
```

单次执行，失败即死。

### 3.2 新流程：循环续推

```
client.start() → client.createSession() → 
  while (continueAttempts <= MAX_CONTINUE_ATTEMPTS) {
    try {
      stopReason = await Promise.race([
        client.sendPrompt(currentInstruction),
        inactivityPromise(CONTINUE_INTERVAL_MS),   // 15分钟
        taskTimeoutPromise(整体上限),
      ])
      → 正常完成：break 退出循环
    } catch (inactivityError) {
      continueAttempts++
      → 检查 client 连接是否存活
        ├── 存活 → 尝试同 session 续推（abort 当前 prompt + 重发）
        ├── 不存活 → destroy + 重建 client + 新 session + 注入进度摘要
        └── 超过 MAX_CONTINUE_ATTEMPTS → 标记 failed
    }
  }
```

### 3.3 续推策略选择

ACP 协议中同一 session 不允许并发 prompt。当 `sendPrompt()` 卡住时，必须先中断当前请求才能发送续推 prompt。

#### 方案 A：同 session 续推（首选）

**条件**：ACP 连接仍然存活（进程活着、stream 未断开）

**步骤**：
1. 调用 `client._abortController.abort()` 中断当前 `sendPrompt()`
2. 等待 `sendPrompt()` 的 `Promise.race` 返回（abort 分支 reject）
3. 在同一 session 中调用 `client.sendPrompt(续推指令)`
4. Agent 收到续推指令后，基于已有的 session 上下文继续工作

**优势**：
- 完整保留 session 上下文（Agent 知道之前做了什么）
- 不需要重建 client，开销最小

**风险**：
- abort 后 SDK 内部 `pendingResponses` 中可能有残留条目（未被 reject 的旧请求）
- 如果 opencode 进程内部状态异常（如正在重试模型 API），abort 信号到达后进程可能不正确处理

**缓解措施**：
- 在 abort 后添加 2-3 秒等待期，让 opencode 进程处理 abort 信号
- 检查 SDK `connection` 对象是否有清理 pendingResponses 的方法
- 如果续推 prompt 在 5 秒内无响应 → 降级到方案 B

#### 方案 B：新 session 续推 + 进度摘要注入（降级方案）

**条件**：ACP 连接已断开（进程退出或 stream 关闭），或方案 A 续推后仍然无响应

**步骤**：
1. `client.destroy()` 完全终止当前 client
2. 重新创建 `ACPClient`，调用 `start()` + `createSession()`
3. 从已收集的事件中提取进度摘要
4. 调用 `sendPrompt(摘要 + 原始指令)` 在新 session 中续推

**优势**：
- 完全干净的状态，不会有 SDK 残留问题
- 可靠性高

**劣势**：
- 丢失原始 session 的完整上下文
- Agent 不知道之前的具体工作细节，只能通过摘要了解大致进度
- 可能重复已完成的工作（如重新执行已完成的 Skill）

**缓解措施**：
- 进度摘要尽可能详细（已完成的 Skill 列表、已发现的漏洞、当前所在阶段）
- 在续推指令中明确说明"以下工作已完成，请不要重复执行"

#### 方案选择流程图

```
不活跃超时触发
  ↓
检查 client 进程是否存活（process.exitCode === null）
  ├── 进程已退出 → 方案 B（新 session + 进度摘要）
  ├── 进程活着，stream 看起来正常 → 方案 A（同 session 续推）
  │     ├── 续推后 5 秒内收到事件 → ✅ 续推成功
  │     └── 续推后 5 秒内无事件 → 降级到方案 B
  └── 无法判断 → 方案 B（安全优先）
```

## 4. 详细实现设计

### 4.1 配置参数

新增环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CONTINUE_INTERVAL_MS` | `900000`（15分钟） | 不活跃超时触发间隔（同时也是续推检测间隔） |
| `MAX_CONTINUE_ATTEMPTS` | `3` | 最大续推次数 |
| `CONTINUE_RETRY_DELAY_MS` | `3000` | abort 后等待进程恢复的延迟 |

注意：`INACTIVITY_TIMEOUT_MS` 环境变量保持不变，但语义从"不活跃→直接杀"变为"不活跃→尝试续推"。默认值从 `0` 改为 `900000`（15分钟）。

### 4.2 数据结构变更

#### ProcessManager 新增字段

```typescript
// process-manager.ts 内部新增

interface ContinuationContext {
  /** 原始指令 */
  originalInstruction: string;
  /** 当前续推次数（0=首次执行, 1-N=续推） */
  continueAttempt: number;
  /** 已收集的事件历史（用于提取进度摘要） */
  eventHistory: AgentEvent[];
  /** 已完成的 Skill 列表 */
  completedSkills: string[];
  /** 续推策略：'same_session' 或 'new_session' */
  strategy: 'same_session' | 'new_session';
}
```

#### runAgent() 方法签名变更

```typescript
// 新增可选参数
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
  timeoutMs?: number,
  // ===== 新增 =====
  continuationContext?: ContinuationContext,  // 续推上下文（首次执行时不传）
): Promise<RunAgentResult>
```

### 4.3 runAgent() 改造伪代码

```typescript
async runAgent(taskId, workspace, engine, agentName, apiKey, model, env, 
               instruction, onEvent, apiBaseUrl, timeoutMs, continuationContext): 
               Promise<RunAgentResult> {
  
  const CONTINUE_INTERVAL_MS = parseInt(process.env.CONTINUE_INTERVAL_MS || '900000');
  const MAX_CONTINUE_ATTEMPTS = parseInt(process.env.MAX_CONTINUE_ATTEMPTS || '3');
  const CONTINUE_RETRY_DELAY_MS = parseInt(process.env.CONTINUE_RETRY_DELAY_MS || '3000');
  
  // 续推上下文初始化
  let ctx: ContinuationContext = continuationContext || {
    originalInstruction: instruction || '执行任务',
    continueAttempt: 0,
    eventHistory: [],
    completedSkills: [],
    strategy: 'same_session',
  };
  
  let client: ACPClient | null = null;
  let stdout = '';
  let stderr = '';
  let currentSkill: string | null = null;
  let inactivityTimer: NodeJS.Timeout | null = null;
  let inactivityTimeoutReject: ((reason: Error) => void) | null = null;
  let inactivityTimeoutTriggered = false;
  
  // ... 环境变量合并、client 创建（现有逻辑保持不变）...
  
  // ========== 新增：续推循环 ==========
  while (ctx.continueAttempt <= MAX_CONTINUE_ATTEMPTS) {
    
    // 根据续推策略决定当前指令
    const currentInstruction = ctx.continueAttempt === 0
      ? ctx.originalInstruction  // 首次执行用原始指令
      : buildContinuationPrompt(ctx);  // 续推用构造的提醒指令
    
    // 如果是新 session 策略，需要重建 client
    if (ctx.strategy === 'new_session' && ctx.continueAttempt > 0) {
      if (client) await client.destroy();
      client = new ACPClient();
      await client.start(clientConfig);
      await client.createSession(agentName);
      // 注册事件处理器（与首次执行相同）
      registerEventHandlers(client, onEvent, ...);
    }
    
    // 发送 prompt（核心执行）
    try {
      const effectiveTimeoutMs = timeoutMs || 7 * 24 * 3600 * 1000;
      
      // 不活跃超时 Promise
      const inactivityPromise = new Promise<never>((_, reject) => {
        inactivityTimeoutReject = reject;
      });
      
      // 设置不活跃计时器
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        inactivityTimeoutTriggered = true;
        inactivityTimeoutReject?.(new Error(`Inactivity after ${CONTINUE_INTERVAL_MS/1000}s`));
      }, CONTINUE_INTERVAL_MS);
      
      const stopReason = await Promise.race([
        client.sendPrompt(currentInstruction),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Task timeout after ${effectiveTimeoutMs/1000}s`)), 
                     effectiveTimeoutMs)),
        inactivityPromise,
      ]);
      
      // 清理计时器
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
      inactivityTimeoutReject = null;
      inactivityTimeoutTriggered = false;
      
      // ========== 正常完成 ==========
      if (stopReason === 'end_turn') {
        await client.destroy();
        return { exitCode: 0, stdout, stderr };
      }
      
      // 其他 stopReason → 等待 exitCode（现有逻辑）
      const exitCode = await Promise.race([
        client.exitCode,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout waiting for exit')), effectiveTimeoutMs)),
      ]);
      await client.destroy();
      return { exitCode: exitCode ?? 1, stdout, stderr };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // ========== 判断是否为不活跃超时 ==========
      const isInactivityTimeout = errorMsg.includes('Inactivity after');
      
      if (!isInactivityTimeout) {
        // 非不活跃超时错误（真正的进程错误、SDK 错误等）→ 直接失败
        // ... 现有的错误分类和返回逻辑 ...
        if (hasSubstantialOutput(stdout)) {
          return { exitCode: 0, stdout, stderr };
        }
        return { exitCode: 1, stdout, stderr };
      }
      
      // ========== 不活跃超时 → 进入续推流程 ==========
      ctx.continueAttempt++;
      
      if (ctx.continueAttempt > MAX_CONTINUE_ATTEMPTS) {
        console.log(`[ProcessMgr] 超过最大续推次数(${MAX_CONTINUE_ATTEMPTS})，标记任务失败`);
        if (onEvent) {
          onEvent({
            type: 'error',
            message: `Agent 连续 ${MAX_CONTINUE_ATTEMPTS} 次无响应，任务终止`,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        }
        return { exitCode: 1, stdout, stderr };
      }
      
      // 推送续推事件给前端
      if (onEvent) {
        onEvent({
          type: 'phase_start',
          phase: 'continuation',
          message: `Agent 无响应，第 ${ctx.continueAttempt} 次续推提醒（策略: ${ctx.strategy === 'same_session' ? '同会话续推' : '新会话续推'}）`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      }
      
      // ========== 检查 client 存活状态 ==========
      const clientAlive = client.process?.exitCode === null;
      
      if (clientAlive) {
        // 方案 A：同 session 续推
        console.log(`[ProcessMgr] 进程存活，尝试同 session 续推`);
        
        // abort 当前 pending prompt
        if (client._abortController) {
          client._abortController.abort();
        }
        
        // 等待进程恢复
        await new Promise(resolve => setTimeout(resolve, CONTINUE_RETRY_DELAY_MS));
        
        // 再次检查存活
        const stillAlive = client.process?.exitCode === null;
        if (stillAlive) {
          ctx.strategy = 'same_session';
          // 重置不活跃标志，继续循环
          inactivityTimeoutTriggered = false;
          continue;  // 回到 while 循环顶部，发送续推 prompt
        } else {
          // 进程在等待期间退出了
          ctx.strategy = 'new_session';
          continue;
        }
      } else {
        // 方案 B：新 session 续推
        console.log(`[ProcessMgr] 进程已退出，需要新 session 续推`);
        ctx.strategy = 'new_session';
        await client.destroy();
        client = null;
        continue;  // 回到 while 循环顶部，重建 client
      }
    }
  }
  
  // 超过最大续推次数
  return { exitCode: 1, stdout, stderr };
}
```

### 4.4 续推指令构造

```typescript
function buildContinuationPrompt(ctx: ContinuationContext): string {
  const attempt = ctx.continueAttempt;
  const original = ctx.originalInstruction;
  
  // 提取进度摘要
  const summary = extractProgressSummary(ctx);
  
  if (attempt === 1) {
    // 第一次续推：温和提醒
    return [
      `你之前的任务执行中断了，请继续完成原始任务。`,
      summary ? `\n当前进度:\n${summary}` : '',
      `\n原始指令:\n${original}`,
      `\n请从上次中断的地方继续，不要重复已完成的工作。`,
    ].join('');
  }
  
  if (attempt === 2) {
    // 第二次续推：更明确的指示
    return [
      `⚠️ 这是第二次续推提醒。你之前的任务已经两次中断，请务必继续执行。`,
      summary ? `\n当前进度:\n${summary}` : '',
      `\n原始指令:\n${original}`,
      `\n已完成的 Skill: ${ctx.completedSkills.join(', ')}`,
      `\n请不要重复执行上述已完成的 Skill，直接继续剩余工作。`,
    ].join('');
  }
  
  // 第三次续推：最后警告
  return [
    `🔴 这是最后一次续推提醒。如果仍然无响应，任务将被终止。`,
    summary ? `\n当前进度:\n${summary}` : '',
    `\n原始指令:\n${original}`,
    `\n请立即继续执行剩余任务。`,
  ].join('');
}
```

### 4.5 进度摘要提取

```typescript
function extractProgressSummary(ctx: ContinuationContext): string {
  const lines: string[] = [];
  
  // 从事件历史中提取关键信息
  const toolCalls = ctx.eventHistory.filter(e => e.type === 'tool_call');
  const skillStarts = ctx.eventHistory.filter(e => e.type === 'skill_start');
  const skillCompletes = ctx.eventHistory.filter(e => e.type === 'skill_complete');
  const errors = ctx.eventHistory.filter(e => e.type === 'error' || e.type === 'phase_error');
  const textChunks = ctx.eventHistory.filter(e => e.type === 'agent_message_chunk');
  
  // 已完成的 Skill
  if (ctx.completedSkills.length > 0) {
    lines.push(`已完成的检测: ${ctx.completedSkills.join(', ')}`);
  }
  
  // 正在执行的 Skill
  const currentSkills = skillStarts
    .map(e => e.skill)
    .filter(s => !ctx.completedSkills.includes(s));
  if (currentSkills.length > 0) {
    lines.push(`正在执行: ${currentSkills.join(', ')}`);
  }
  
  // 工具调用摘要
  const toolNames = toolCalls.map(e => e.tool).filter(Boolean);
  if (toolNames.length > 0) {
    const uniqueTools = [...new Set(toolNames)];
    lines.push(`已使用的工具: ${uniqueTools.join(', ')} (共${toolNames.length}次调用)`);
  }
  
  // 最近的文本输出摘要（最后 200 字符）
  if (textChunks.length > 0) {
    const lastText = textChunks.slice(-5).map(e => e.content).join('');
    if (lastText.length > 0) {
      lines.push(`最后输出: "${lastText.substring(0, 200)}..."`);
    }
  }
  
  // 错误信息
  if (errors.length > 0) {
    const lastError = errors[errors.length - 1];
    lines.push(`最后错误: ${lastError.message?.substring(0, 100)}`);
  }
  
  return lines.join('\n');
}
```

### 4.6 事件处理器中的进度收集

现有 `runAgent()` 的 `on` 回调处理器中，需要在每次事件时同时追加到 `ctx.eventHistory`，并更新 `completedSkills`：

```typescript
// 在现有 text/toolCall/toolCallUpdate/error 处理器中追加：

text: (content: string) => {
  // ... 现有逻辑 ...
  ctx.eventHistory.push({
    type: 'agent_message_chunk',
    content,
    timestamp: new Date().toISOString(),
  });
},

toolCall: (tool, input, title) => {
  // ... 现有逻辑 ...
  ctx.eventHistory.push({
    type: 'tool_call',
    tool: (title || tool).toLowerCase(),
    input,
    timestamp: new Date().toISOString(),
  });
},

skill_complete 事件（已有，在 skillStart 切换时触发）:
  ctx.completedSkills.push(currentSkill);
```

### 4.7 daemon.ts 的改动

daemon.ts 的 `executeTask()` 方法无需重大改动。`runAgent()` 返回的 `RunAgentResult` 结构不变（`{ exitCode, stdout, stderr }`），续推逻辑完全在 process-manager 内部处理。

唯一需要调整的是：**续推过程中的 `phase_start/phase_complete` 事件需要通过 `onEvent` 回调推送给 Orchestrator**。这些事件在现有 `onEvent` 机制下已经能正确推送（daemon.ts 的 `onEvent` 回调会把事件 `postEvent` 到 Orchestrator）。

新增的事件类型：

```typescript
// process-manager.ts AgentEventType 新增
export type AgentEventType =
  | ... // 现有类型
  | 'continuation_attempt'  // 续推尝试事件
```

新增的事件字段：

```typescript
export interface AgentEvent {
  // ... 现有字段
  continueAttempt?: number;  // 续推次数（仅 continuation_attempt 事件）
  strategy?: 'same_session' | 'new_session';  // 续推策略
}
```

## 5. 方案 A（同 session 续推）的 SDK 兼容性分析

### 5.1 abort 后 SDK 状态清理

`ACPClient.sendPrompt()` 的 `Promise.race` 中，abort 分支 reject 后：

- `setInterval` 检查被 `clearInterval`
- `_abortController` 监听器被移除
- `sendPrompt()` 返回 reject

**但 SDK 层面的问题**：`connection.prompt()` 创建的 Promise 在 `pendingResponses` Map 中仍然存在。abort 只是让外层 `Promise.race` 跳出，SDK 内部的 `pendingResponses` 条目不会被自动移除。

**解决方案**：

1. **短期**：在 abort 后等待 2-3 秒，然后检查 opencode 进程是否还在正常运行。如果进程仍在响应其他请求（如心跳），说明 abort 信号已被处理，可以安全地发送新 prompt。

2. **长期**：考虑给 `@agentclientprotocol/sdk` 提 PR，添加请求取消支持（通过 AbortSignal 或 request ID cancel 方法）。

### 5.2 实际可行性评估

在当前 SDK 版本下，方案 A 的可靠性取决于 opencode 进程对 abort 信号的响应：

| 情况 | abort 效果 | 后续行为 |
|------|-----------|---------|
| opencode 正在等模型 API 响应 | abort 到达 → `sendPrompt` reject → 但 opencode 进程可能还在内部等待模型 | 新 prompt 可能叠加在旧请求上 |
| opencode 内部重试（rate limit） | abort 到达 → `sendPrompt` reject → opencode 可能停止重试 | 新 prompt 正常处理 |
| opencode 进程已卡死（无响应） | abort 到达 → `sendPrompt` reject → 进程无反应 | 需要降级到方案 B |

**结论**：方案 A 适用于"进程活着但暂时卡住"的场景。如果 abort 后 5 秒内无任何新事件，应立即降级到方案 B。

### 5.3 降级检测

```typescript
// abort 后的存活检测
const abortTime = Date.now();
const waitForRecovery = 5000; // 5秒

await new Promise(resolve => setTimeout(resolve, CONTINUE_RETRY_DELAY_MS));

// 检查是否有新事件到达
const hasNewEvents = ctx.eventHistory.some(e => 
  new Date(e.timestamp).getTime() > abortTime
);

if (!hasNewEvents && client.process?.exitCode === null) {
  // 进程活着但5秒内无事件 → 降级到方案 B
  console.log('[ProcessMgr] 同 session 续推无响应，降级到新 session');
  ctx.strategy = 'new_session';
}
```

## 6. 事件推送与前端交互

### 6.1 续推过程中的事件流

```
[正常执行阶段]
  onEvent: agent_message_chunk, tool_call, skill_start, ...

[不活跃超时触发]
  onEvent: { type: 'continuation_attempt', continueAttempt: 1, strategy: 'same_session',
             message: 'Agent 无响应，第1次续推提醒（同会话续推）' }

[续推成功恢复]
  onEvent: { type: 'phase_complete', phase: 'continuation', success: true,
             message: 'Agent 已恢复响应，继续执行任务' }
  onEvent: agent_message_chunk, tool_call, ...  (恢复正常)

[续推仍然无响应]
  onEvent: { type: 'continuation_attempt', continueAttempt: 2, strategy: 'new_session',
             message: 'Agent 无响应，第2次续推提醒（新会话续推+进度摘要注入）' }

[最终失败]
  onEvent: { type: 'error', message: 'Agent 连续3次无响应，任务终止' }
```

### 6.2 前端展示建议

- 续推尝试时显示黄色警告条："Agent 暂时无响应，正在尝试恢复..."
- 每次续推成功恢复时显示绿色提示："Agent 已恢复，继续执行"
- 最终失败时显示红色错误："Agent 连续多次无响应，任务已终止"

## 7. 不活跃超时阈值建议

当前 `INACTIVITY_TIMEOUT_MS` 默认值为 `0`（禁用），改为续推机制后需要启用。

| 场景 | 建议阈值 | 理由 |
|------|----------|------|
| 低延迟模型（< 1 分钟响应） | `300000`（5分钟） | 正常情况下 5 分钟内应有事件 |
| 中等延迟模型（1-5 分钟响应） | `600000`（10分钟） | 单次模型响应可能需要几分钟 |
| 高延迟模型（5-10+ 分钟响应） | `900000`（15分钟） | 推荐：兼容大部分情况 |
| 极高延迟模型（> 10 分钟） | `1800000`（30分钟） | 保守设置，减少误判 |

**默认值建议**：`900000`（15分钟），可通过 `CONTINUE_INTERVAL_MS` 环境变量调整。

## 8. 与现有超时机制的协调

| 机制 | 当前行为 | 续推后行为 | 关系 |
|------|---------|-----------|------|
| `INACTIVITY_TIMEOUT_MS` | 禁用或直接杀进程 | 启用，触发续推流程 | **被 `CONTINUE_INTERVAL_MS` 替代语义** |
| `TASK_TIMEOUT_SEC`（任务总超时） | 7天，超出后标记 failed | 保持不变，作为整体上限 | 续推循环的总耗时不能超过此值 |
| `CONTINUE_INTERVAL_MS`（新增） | — | 15分钟，不活跃检测间隔 | 替代 `INACTIVITY_TIMEOUT_MS` 的续推版 |
| `MAX_CONTINUE_ATTEMPTS`（新增） | — | 3次，最大续推次数 | 新增 |
| Stream Watchdog | 6小时空闲超时 | 不受影响（仅主服务器侧） | 独立机制 |
| Worker 心跳 | 90s 过期 | 不受影响（独立的心跳通道） | 独立机制 |

**任务总超时计算**：

续推循环的总耗时 = 原始执行时间 + 续推等待时间 × 续推次数
= 原始时间 + 15分钟 × 3次 = 原始时间 + 45分钟

在 `taskTimeoutPromise` 中应从任务开始时间计算，而不是每次续推重置：

```typescript
const taskStartTime = Date.now();
const effectiveTimeoutMs = timeoutMs || 7 * 24 * 3600 * 1000;

// 每次循环中，剩余超时时间 = 总超时 - 已消耗时间
const remainingTimeoutMs = effectiveTimeoutMs - (Date.now() - taskStartTime);
if (remainingTimeoutMs <= 0) {
  throw new Error('Task overall timeout exceeded');
}
```

## 9. 风险评估与缓解

### 9.1 方案 A 的 SDK 状态残留风险

**风险**：abort 当前 prompt 后，SDK `pendingResponses` 中残留旧请求条目，可能干扰后续 prompt。

**缓解**：
1. abort 后等待 3 秒让进程处理
2. 续推 prompt 如果 5 秒内无响应 → 降级到方案 B（完全重建 client）
3. 长期：给 SDK 添加 cancel support

### 9.2 方案 B 的进度丢失风险

**风险**：新 session 中 Agent 不知道之前的详细工作，可能重复已完成的工作。

**缓解**：
1. 进度摘要尽可能详细（已完成 Skill 列表、已发现漏洞、当前阶段）
2. 在续推指令中明确标注"以下工作已完成，请勿重复"
3. workspace 中的文件保持不变（已完成 Skill 的输出文件还在磁盘上），Agent 可以读取这些文件了解进度

### 9.3 续推指令过长风险

**风险**：多次续推后，续推 prompt 可能非常长（原始指令 + 进度摘要 + 提醒语），超过模型 token 限制。

**缓解**：
1. 进度摘要限制在 500 字符以内
2. 原始指令只保留关键部分（截取前 200 字符 + 最后 100 字符）
3. 第三次续推时进一步精简指令

### 9.4 续推循环中 stdout/stderr 累积风险

**风险**：每次续推都在同一 `stdout`/`stderr` buffer 上追加，可能超过内存限制。

**缓解**：
1. 续推成功恢复时，不截断已有输出
2. 设置 buffer 上限（如 50MB），超过时截断旧内容
3. `RunAgentResult.stdout` 已经是累积的，无需额外处理

### 9.5 进程僵尸风险

**风险**：opencode 进程变成僵尸（活着但 stdout 不关闭），导致方案 A 和方案 B 都无法正确检测。

**缓解**：
1. 在 destroy() 中 SIGTERM → 5秒 → SIGKILL（已有）
2. 如果 SIGKILL 后 `process.exitCode` 仍为 null，记录日志并强制继续
3. 定期检查 `/proc/{pid}/status` 验证进程真实状态（Linux 环境）

## 10. 实施计划

### Phase 1：基础续推循环（P0）

**改动文件**：
- `codeswarm/packages/worker/src/process-manager.ts`
  - 改造 `runAgent()` 为循环续推结构
  - 新增 `buildContinuationPrompt()` 函数
  - 新增 `extractProgressSummary()` 函数
  - 新增 `ContinuationContext` 类型
  - 修改不活跃超时逻辑（从直接 destroy → 进入续推流程）
  - 新增环境变量读取（`CONTINUE_INTERVAL_MS`, `MAX_CONTINUE_ATTEMPTS`）

**预期改动量**：~80-100 行新增代码，~30 行修改现有代码

### Phase 2：方案 B 支持（P1）

**改动文件**：
- `codeswarm/packages/worker/src/process-manager.ts`
  - 在续推循环中添加 client 重建逻辑（新 session 策略）
  - 重建时重新注册事件处理器
  - 进度摘要注入到新 prompt

**预期改动量**：~40-50 行新增代码

### Phase 3：前端事件展示（P2）

**改动文件**：
- `codeswarm/packages/worker/src/process-manager.ts` — 新增 `continuation_attempt` 事件类型
- `src/components/codeswarm/` 相关组件 — 续推状态展示

**预期改动量**：前端改动较轻，后端 ~10 行

### Phase 4：SDK 请求取消支持（长期）

**方向**：
- 给 `@agentclientprotocol/sdk` 提 PR，添加 `cancelRequest(id)` 方法
- 或在 `sendPrompt()` 中支持 `AbortSignal` 传入 SDK 层
- 完善 abort 后的 SDK 内部清理

## 11. 测试场景

### 11.1 正常执行（无中断）

- 预期：单次 `sendPrompt()` 正常返回 `end_turn`
- 续推循环不触发
- 行为与当前完全一致

### 11.2 模型 API 瞬时卡住 → 15分钟后恢复

- 预期：不活跃超时触发 → 方案 A 续推 → Agent 恢复响应
- 续推次数：1
- 最终结果：任务完成

### 11.3 模型 API 持续卡住 → 续推3次均无响应

- 预期：3次续推尝试（同 session → 降级新 session → 最终新 session）
- 续推次数：3
- 最终结果：任务 failed，错误信息："Agent 连续3次无响应，任务终止"

### 11.4 模型 rate limit → opencode 内部重试（无 ACP 事件）

- 预期：不活跃超时触发 → abort → 等待恢复 → 续推 prompt
- 如果 opencode 在 abort 后恢复 → 续推成功
- 如果 opencode 在 abort 后仍然卡住 → 降级新 session

### 11.5 进程崩溃（OOM）

- 预期：进程退出 → stream 关闭 → `sendPrompt()` reject（非不活跃超时类型）
- 续推循环不触发（非不活跃超时错误走现有错误处理流程）
- 最终结果：根据 `hasSubstantialOutput()` 判断是否部分成功

### 11.6 新 session 续推后的上下文保持

- 预期：新 session 中 Agent 收到"已完成 Skill: XSS检测, SQL注入检测"的提示
- Agent 检查 workspace 中已有文件，了解进度
- Agent 继续执行剩余检测，不重复已完成的工作

## 12. 环境变量完整列表

| 变量 | 默认值 | 位置 | 说明 |
|------|--------|------|------|
```bash
# Worker .env 续推相关配置

# 不活跃超时（续推检测间隔）
# 0 = 禁用续推机制（回退到当前行为）
# 默认 900000ms = 15分钟
INACTIVITY_TIMEOUT_MS=900000

# 最大续推次数
# 0 = 禁用续推
# 默认 3
CONTINUE_MAX_ATTEMPTS=3

# sendPrompt 自身超时上限
# 默认 7200000ms = 2小时
# 此超时是 sendPrompt 的硬性上限, 超过此值直接失败（不续推）
ACP_PROMPT_TIMEOUT_MS=7200000

# 任务总超时（含所有续推尝试的总时长）
# 默认 86400秒 = 1天
TASK_TIMEOUT_SEC=86400
```