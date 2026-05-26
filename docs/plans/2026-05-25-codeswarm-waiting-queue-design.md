# CodeSwarm 等待队列设计

## 问题

Worker 全部满载时，任务分发失败后快速重试 10 次（`MAX_REQUEUE_ATTEMPTS = 10`）即标记为 `failed`，报错 `No available worker after 10 attempts`。任务没有真正的等待机制。

## 目标

Worker 满载时任务无限等待，直到有 Worker 空闲后自动执行。

## 设计

### 存储

新增 Redis List：`codeswarm:task:waiting`（FIFO）

- 入队：`rpush codeswarm:task:waiting <dbTaskId>`
- 出队：`lpop codeswarm:task:waiting`
- 任务数据库状态保持 `queued` 不变

### 入队（Worker 满时）

`dispatchOne()` 返回 `false` 时，不再重入 Redis Stream，改为写入等待队列：

```typescript
await this.redis.rpush('codeswarm:task:waiting', dbTaskId);
```

### 出队（Worker 完成任务时）

`onTaskCompleted()` 末尾追加：

```typescript
const waitingTaskId = await this.redis?.lpop('codeswarm:task:waiting');
if (waitingTaskId) {
  const dispatched = await this.dispatchOne(waitingTaskId);
  if (!dispatched) {
    // 放回队尾，避免饿死后面的任务
    await this.redis?.rpush('codeswarm:task:waiting', waitingTaskId);
  }
}
```

### 边界情况

| 场景 | 处理 |
|---|---|
| Server 重启 | waiting 队列在 Redis，任务不丢失 |
| 任务被用户取消 | `dispatchOne` 检查 `state !== 'queued'` 直接跳过 |
| 多个 Worker 同时完成 | `lpop` 是 Redis 原子操作，天然防并发 |
| 再次分发失败 | `rpush` 放回队尾，不阻塞其他任务 |

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/services/codeswarm-dispatcher.ts` | 删除 `retryCounts`、`MAX_REQUEUE_ATTEMPTS`、重试逻辑；`dispatchOne` 失败时 `rpush`；`onTaskCompleted` 末尾追加 `lpop` + `dispatchOne` |
