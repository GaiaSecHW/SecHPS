# CodeSwarm Worker 任务可观测性增强实施方案

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** 为 Worker 任务增加实时日志流、进度跟踪、错误可见性和取消支持

**Architecture:** 
- Worker 端：增强 `emitEvent` 发送 `log_chunk`、`progress`、`tool_duration` 事件；增加 `POST /task/cancel` 接口
- 平台端：利用现有 EventBus + Redis pub/sub 实现 SSE 推送（替换 DB 轮询）
- 类型定义：扩展 `WorkerEventTypeEnum` 新增事件类型

**Tech Stack:** TypeScript, Redis pub/sub, SSE, Fastify (Worker), Next.js API Routes

---

## Chunk 1: Worker 端事件增强

### 涉及文件
- `codeswarm/packages/worker/src/daemon.ts`
- `codeswarm/packages/worker/src/process-manager.ts`
- `codeswarm/packages/acp/src/index.ts`
- `codeswarm/packages/types/src/index.ts`

### 1.1 扩展事件类型定义

**Files:** `codeswarm/packages/types/src/index.ts:139-144`

```typescript
// 新增 event type
export const WorkerEventTypeEnum = z.enum([
  'agent_message_chunk',
  'tool_call',
  'tool_call_update',
  'error',
  'log_chunk',        // 新增：stdout/stderr 日志块
  'progress',         // 新增：进度节点（如 "正在克隆仓库"）
  'tool_duration',    // 新增：tool 执行耗时
  'heartbeat',        // 新增：心跳日志
  'cancel_confirmed', // 新增：取消确认
]);
```

### 1.2 增强 ProcessManager runOpencodeCommand 日志流

**Files:** `codeswarm/packages/worker/src/process-manager.ts:207-231`

在现有 `stdout.on('data')` 和 `stderr.on('data')` 的 `onEvent` 调用中，已存在 `command_output` 事件发送。问题是没有为 `runAgent()` 路径发送事件。

### 1.3 增强 ACP Client 事件发送

**Files:** `codeswarm/packages/acp/src/index.ts:258-296`

`handleSessionUpdate()` 中：
- `agent_thought_chunk` / `agent_message_chunk` → 发送 `agent_message_chunk` 事件
- `tool_call` → 发送带计时的 `tool_call` 事件
- `tool_call_update` (completed) → 发送 `tool_duration` 事件

需要修改 ACPClient 支持注册 onEvent callback。

### 1.4 新增任务取消接口

**Files:** `codeswarm/packages/worker/src/daemon.ts`

```typescript
// 在 this.server 上新增
this.server.post('/task/cancel', async (request, reply) => {
  const { taskId } = request.body as { taskId: string };
  
  // 找到并终止进程
  const proc = this.runningTasks.get(taskId);
  if (proc) {
    proc.kill();
    this.runningTasks.delete(taskId);
    await this.emitEvent(callbackUrl, taskId, 'cancel_confirmed', {});
  }
  
  return { success: true };
});
```

### 1.5 错误可见性增强

**Files:** `codeswarm/packages/worker/src/daemon.ts:322-339`

将 `postResult()` 中的空 catch 改为记录日志并发送 `error` 事件。

---

## Chunk 2: 平台端 SSE 推送优化（基于 Redis）

### 涉及文件
- `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts`
- `src/services/codeswarm-dispatcher.ts`
- `src/lib/event-bus.ts`

### 2.1 Redis pub/sub 替代 DB 轮询

**Files:** `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts`

重构为：
1. 订阅 Redis channel `codeswarm:task:{taskId}`
2. 收到消息后直接推送 SSE
3. 同时保持 DB fallback（事件未发布到 Redis 时）

```typescript
// 伪代码
const subscriber = redis.duplicate();
await subscriber.subscribe(`codeswarm:task:${taskId}`);

subscriber.on('message', (ch, msg) => {
  controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
});
```

### 2.2 CodeswarmDispatcher 事件发布

**Files:** `src/services/codeswarm-dispatcher.ts:312-317`

`publishTaskEvent()` 已存在但依赖 Redis publisher。

---

## Chunk 3: 前端日志显示增强

### 涉及文件
- `src/components/codeswarm/TaskDebugPanel.tsx`

### 3.1 日志级别区分

- stdout: 白色/绿色
- stderr: 黄色
- error: 红色
- progress: 蓝色

### 3.2 进度信息显示

显示当前进度节点（如 "正在克隆 → 正在分析 → 已完成"）

---

## Task List

### Task 1: 扩展 Worker 事件类型

- [ ] **Step 1: 修改 `codeswarm/packages/types/src/index.ts` 新增事件类型**

```typescript
// Line 139-144: 扩展 WorkerEventTypeEnum
export const WorkerEventTypeEnum = z.enum([
  'agent_message_chunk',
  'tool_call',
  'tool_call_update',
  'error',
  'log_chunk',        // 新增
  'progress',         // 新增
  'tool_duration',    // 新增
  'heartbeat',        // 新增
  'cancel_confirmed', // 新增
]);
```

- [ ] **Step 2: 验证类型变更不破坏现有代码**

### Task 2: Worker 端错误可见性

- [ ] **Step 1: 修改 `daemon.ts` 的 `postResult()` 增强错误处理**

```typescript
// daemon.ts:322-339
private async postResult(payload: TaskPayload, result: {...}): Promise<void> {
  const callbackUrl = this.getCallbackUrl(payload);
  try {
    await fetch(`${callbackUrl}/api/codeswarm/worker/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch (err) {
    // 改为记录完整错误
    this.server.log.error({ taskId: result.taskId, error: err }, 'Failed to post result');
    // 同时发送 error 事件
    await this.emitEvent(callbackUrl, result.taskId, 'error', {
      message: err instanceof Error ? err.message : String(err),
      stage: 'post_result',
    });
  }
}
```

- [ ] **Step 2: 在 `executeTask()` catch 块中增强错误发送**

```typescript
// daemon.ts:274-281
} catch (error) {
  this.server.log.error({ taskId, error }, 'Task failed');
  await this.emitEvent(callbackUrl, taskId, 'error', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    stage: 'execute_task',
  });
  await this.postResult(payload, {
    taskId,
    nodeId: this.config.nodeId,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  });
}
```

### Task 3: ACP Client 事件流增强

- [ ] **Step 1: 修改 `acp/src/index.ts` 新增 eventHandlers 中的 onEvent 支持**

在 `ACPClient` 类中添加 `onEvent` callback 注册机制，让 `handleSessionUpdate` 能够通过 `emitEvent` 发送事件。

- [ ] **Step 2: 修改 `daemon.ts` 的 `runAgent()` 传递 onEvent callback**

### Task 4: 任务取消接口

- [ ] **Step 1: 在 `daemon.ts` 新增 `/task/cancel` 路由**

```typescript
this.server.post('/task/cancel', async (request, reply) => {
  const { taskId } = request.body as { taskId: string };
  
  // 查找并终止运行中的进程
  const entry = this.processMgr.getClient(taskId);
  if (entry) {
    await entry.client.destroy();
  }
  
  return reply.send({ success: true, taskId });
});
```

- [ ] **Step 2: 在 `dispatcher.ts` 的掉线检测中调用取消接口**

### Task 5: SSE 实时推送优化

- [ ] **Step 1: 创建 `src/lib/redis-subscriber.ts` 封装 Redis 订阅**

```typescript
// src/lib/redis-subscriber.ts
import Redis from 'ioredis';

export class RedisSubscriber {
  private subscriber: Redis | null = null;
  
  async subscribe(taskId: string, onMessage: (data: object) => void) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return false;
    
    this.subscriber = new Redis(redisUrl);
    await this.subscriber.subscribe(`codeswarm:task:${taskId}`);
    this.subscriber.on('message', (ch, msg) => {
      onMessage(JSON.parse(msg));
    });
    return true;
  }
  
  async unsubscribe(taskId: string) {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(`codeswarm:task:${taskId}`);
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }
}
```

- [ ] **Step 2: 修改 `/stream/route.ts` 使用 Redis 订阅 + DB fallback**

### Task 6: TaskDebugPanel 日志优化

- [ ] **Step 1: 新增日志级别样式映射**

```typescript
const levelStyles: Record<string, string> = {
  stdout: 'text-gray-300',
  stderr: 'text-yellow-400',
  error: 'text-red-400',
  progress: 'text-blue-400',
  tool_call: 'text-purple-400',
  tool_duration: 'text-cyan-400',
};
```

- [ ] **Step 2: 显示进度条**
