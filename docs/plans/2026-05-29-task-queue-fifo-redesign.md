# 任务队列 FIFO 永久等待方案

> 日期：2026-05-29
> 状态：待实施

## 摘要

**将任务队列从"快速重试10次后失败"改为"FIFO 永久等待，直到有 Worker 空出来"。**

当前行为：Worker 全满时，任务被立即重新塞回 Redis Stream，最多重试 10 次，全部失败后任务标记 `failed`。高峰期提交的任务根本没机会执行。

新行为：Worker 全满时，任务保持 `queued` 状态，无限等待。Worker 完成任务后立即触发下一次分发（事件驱动），每 5 分钟兜底轮询一次防止回调丢失。前端显示"排队中"状态。

**改动范围：** 仅 `src/services/codeswarm-dispatcher.ts`，前端任务状态展示。

---

## 核心设计

### 触发机制：事件驱动 + 兜底轮询

```
Worker 完成任务
    → POST /api/codeswarm/worker/result
        → Server 处理结果、释放 Worker slot
        → 立即调用 dispatcher.tryDispatchNext()   ← 主路径（即时）

每 5 分钟
    → dispatcher.tryDispatchNext()                ← 兜底（防回调丢失）
```

两路触发均调用同一个 `tryDispatchNext()`，该方法幂等：从队列头取任务，找空闲 Worker，分发。Redis Stream `XREAD` 是原子操作，并发触发安全，不会重复分发同一任务。

### 队列行为变更

| | 当前 | 新方案 |
|---|---|---|
| Worker 全满时 | 立即重入队，最多 10 次 | 保持 `queued`，无限等待 |
| 重试计数 | `retryCounts` Map，10 次上限 | 移除 |
| 任务失败条件 | 10 次分发失败 | Worker 拒绝执行（HTTP 错误）、任务超时 |
| 前端状态 | 无"排队中"展示 | 显示 `queued` = "排队中" |

---

## 改动清单

### Step 1: dispatcher.ts — 移除重试上限，改为永久等待

**文件：** `src/services/codeswarm-dispatcher.ts`

**1a. 删除 `MAX_REQUEUE_ATTEMPTS` 常量**（line 587）：

```typescript
// 删除此行
private static readonly MAX_REQUEUE_ATTEMPTS = 10;
```

**1b. `dispatchLoop()` 中的重试逻辑**（line 371-394）：

```typescript
// 原来：
if (!dispatched) {
  const retries = (this.retryCounts.get(dbTaskId) || 0) + 1;
  this.retryCounts.set(dbTaskId, retries);
  if (retries >= CodeswarmDispatcher.MAX_REQUEUE_ATTEMPTS) {
    // 标记 failed ...
  } else {
    await this.redis!.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
  }
} else {
  this.retryCounts.delete(dbTaskId);
}

// 改为：
if (!dispatched) {
  // Worker 全满，任务保持 queued，不重入队
  // 等待 Worker 完成后的事件触发或 5 分钟兜底轮询
  logger.info(LOG_MODULES.CODESWARM, `Task ${dbTaskId} waiting for available worker`);
} else {
  this.retryCounts.delete(dbTaskId);
}
```

**1c. 删除 `retryCounts` Map 的相关代码**：

```typescript
// 删除声明
private retryCounts = new Map<string, number>();
// 删除所有 retryCounts.get/set/delete 调用
```

**1d. 新增 `tryDispatchNext()` 方法**：

```typescript
async tryDispatchNext(): Promise<void> {
  if (!this.redis || !this.running) return;

  // 从 Redis Stream 取一个待处理任务
  const messages = await this.redis.xreadgroup(
    'GROUP', CONSUMER_GROUP, `${CONSUMER_NAME}-dispatch`,
    'COUNT', 1,
    'STREAMS', STREAM_KEY, '>'
  ) as [string, [string, string[]][]][] | null;

  if (!messages || messages.length === 0) return;

  for (const [, msgs] of messages) {
    for (const [msgId, fields] of msgs) {
      const dbTaskId = fields[1];
      if (!dbTaskId) {
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
        continue;
      }

      const dispatched = await this.dispatchOne(dbTaskId);
      if (dispatched) {
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
      } else {
        // 仍无可用 Worker，重新入队，等待下次触发
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
        await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
      }
    }
  }
}
```

**1e. 新增 5 分钟兜底轮询**（在 `start()` 方法中）：

```typescript
// 在 dispatchLoop() 启动后添加
this.startFallbackPoller();

private startFallbackPoller(): void {
  const INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
  const poll = async () => {
    if (!this.running) return;
    try {
      await this.tryDispatchNext();
    } catch (e) {
      logger.warn(LOG_MODULES.CODESWARM, '兜底轮询失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
    setTimeout(poll, INTERVAL_MS);
  };
  setTimeout(poll, INTERVAL_MS);
}
```

### Step 2: result/route.ts — Worker 完成后触发分发

**文件：** `src/app/api/codeswarm/worker/result/route.ts`

在 Worker 结果处理完成后（事务提交后），调用 dispatcher 触发下一个任务：

```typescript
// 在事务提交后、触发漏洞解析之前
import { getDispatcher } from '@/services/codeswarm-dispatcher';

// 释放 Worker slot 后立即尝试分发下一个任务
const dispatcher = getDispatcher();
if (dispatcher) {
  dispatcher.tryDispatchNext().catch(e =>
    logger.warn(LOG_MODULES.CODESWARM, '触发下一任务分发失败', { details: { error: e instanceof Error ? e.message : String(e) } })
  );
}
```

需确认 `codeswarm-dispatcher.ts` 是否已导出单例获取方法 `getDispatcher()`，若无则新增：

```typescript
// 在 dispatcher.ts 末尾
let _instance: CodeswarmDispatcher | null = null;
export function getDispatcher(): CodeswarmDispatcher | null {
  return _instance;
}
// 在 start() 中赋值 _instance = this
```

### Step 3: 前端状态展示

**涉及文件：** 任务列表/详情相关组件（具体路径待确认）

将 `queued` 状态映射为"排队中"文案，与 `running`（执行中）、`completed`（已完成）、`failed`（失败）并列展示。

---

## 异常处理

| 场景 | 处理 |
|------|------|
| Worker 回调失败（网络抖动） | 5 分钟兜底轮询补触发 |
| Server 重启 | `dispatchLoop` 重启后继续消费 Redis Stream；兜底轮询重新启动 |
| Redis 连接断开 | 现有重连逻辑不变 |
| DB 连接耗尽 | 现有 10 秒延迟逻辑保留，不重入队，等下次触发 |
| 任务永久卡队列 | 不存在——只要有 Worker 空出来就会被分发 |
| 队列积压过深 | 运维层面扩容 Worker，代码层面无需处理 |

---

## 实施顺序

1. **Step 1** — 改 dispatcher，移除重试上限，加 `tryDispatchNext()` 和兜底轮询
2. **Step 2** — result/route.ts 触发事件
3. **Step 3** — 前端状态展示

每步可独立验证：
1. 提交任务，Worker 全满 → 任务保持 `queued` 不变为 `failed`
2. Worker 完成任务 → 队列中下一个任务立即被分发（日志可见）
3. 前端显示"排队中"

---

## 验证方式

1. 将所有 Worker `maxConcurrent` 调低（如设为 1），提交 3 个任务
2. 观察：第 1 个任务执行，第 2、3 个保持 `queued`（前端显示"排队中"）
3. 第 1 个任务完成后，第 2 个立即开始执行（日志显示事件触发）
4. 第 2 个完成后，第 3 个立即开始执行
5. 停止 Server 30 秒后重启，验证队列中的任务在 5 分钟内被兜底轮询捡起
