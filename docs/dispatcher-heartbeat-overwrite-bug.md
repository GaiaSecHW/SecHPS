# Dispatcher 心跳覆盖内存拓扑 Bug 分析与修复

## 问题现象

Worker 节点在未达到最大并发数的情况下，任务仍在排队状态无法转为执行中。

## 涉及文件

| 文件 | 作用 |
|------|------|
| `src/services/codeswarm-dispatcher.ts` | 中央调度器：Redis Stream 消费、Worker 选择、任务分发、健康检查 |
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | 心跳端点：Worker 注册/更新、DB fallback 分发触发 |
| `src/app/api/codeswarm/worker/result/route.ts` | 结果回调端点：任务完成/失败处理 |
| `codeswarm/packages/worker/src/daemon.ts` | Worker Daemon：HTTP 端点、Semaphore 并发控制、心跳发送 |
| `codeswarm/packages/worker/src/semaphore.ts` | 并发信号量：tryAcquire/release/resize |

## 根因分析

### Bug 位置：`onHeartbeat` 用心跳上报值覆盖 dispatcher 内存拓扑

`codeswarm-dispatcher.ts` 原始代码（第 247-263 行）：

```typescript
onHeartbeat(data: { nodeId: string; id: string; address: string; maxConcurrent: number; currentTasks?: number }) {
  const existing = this.workers.get(data.nodeId);
  const reportedTasks = data.currentTasks ?? 0;
  const currentTasks = reportedTasks;  // ← 直接用上报值覆盖内存值
  this.workers.set(data.nodeId, {      // ← 整体替换 WorkerInfo 对象
    id: data.id,
    nodeId: data.nodeId,
    address: data.address,
    maxConcurrent: data.maxConcurrent,
    currentTasks,                       // ← 任何 dispatcher 侧的修改都被抹掉
    lastHeartbeat: Date.now(),
  });
}
```

`onHeartbeat` 每 30 秒被调用一次（Worker 心跳间隔），它使用 `this.workers.set()` **整体替换** `WorkerInfo` 对象，而非选择性更新。这意味着 dispatcher 在两次心跳之间对 `currentTasks` 的所有修改（乐观递增、完成递减）都可能被下一次心跳覆盖。

### 竞态场景一：分发后覆盖（虚低→过分发）

```
时间线：
T0  dispatcher 分发任务 → worker.currentTasks++ (乐观递增) → 内存=4
T1  HTTP POST 到 Worker → Semaphore.tryAcquire → Worker 接受 → 实际=4
T2  Worker 发送心跳（可能在 T0-T1 之间的旧状态）→ reported=3 → 内存被覆盖为 3
T3  dispatcher 认为 Worker 有 2 个空位（max=5, current=3）→ 再分发 2 个任务
T4  Worker 实际只有 1 个空位 → 1 个任务 503 → 回滚 queued
```

**结果**：过分发 → 503 拒绝 → 任务回滚 → 排队→503 循环。但下次心跳（30s后）上报值=4，自然修正为正确值，**30s 内自愈**。

### 竞态场景二：完成后覆盖（虚高→任务排队）

```
时间线：
T0  Worker maxConcurrent=5, 实际运行=5, 内存=5
T1  任务完成 → decrementWorkerMemoryLoad → 内存=4
T2  过期心跳到达（发送时 actual=5，网络延迟晚到）→ reported=5 → 内存被覆盖回 5
T3  selectWorker: currentTasks=5 >= maxConcurrent=5 → 无容量 → 任务排队
T4  下次心跳（发送时 actual=4）→ reported=4 → 内存=4 → 有容量 ✓
```

**结果**：临时性排队，最长持续一个心跳周期（30s），**30s 内自愈**。

### 关键结论

原始 bug 导致的是 **临时性延迟（≤30s），而非永久排队**。每次心跳上报值都是 Worker 当前真实状态，下一次心跳自然会修正被覆盖的错误值。

### 但有 exacerbating 因素

如果系统持续处于高并发状态（任务频繁完成 → 过期心跳频繁覆盖递减），会出现 **持续性 30s 级延迟**：每个任务完成后都有一个心跳周期的"窗口期"内 Worker 看似满载。用户感知上就是"明明有空位但任务一直排队"。

---

## 修复方案演进与回归分析

### 方案 A（已否决）：`Math.max(内存值, 上报值)`

```typescript
const currentTasks = Math.max(existing?.currentTasks ?? 0, reportedTasks);
```

**初衷**：保护乐观递增不被心跳抹掉。

**回归**：阻止了自然修正，把临时 bug 变成永久 bug。

```
竞态场景二（Math.max 版）：
T0  内存=5, 实际=5
T1  任务完成 → decrement → 内存=4
T2  过期心跳 reported=5 → Math.max(4, 5)=5 → 内存回到 5
T3  下次心跳 reported=4 → Math.max(5, 4)=5 → 永远 stuck！
```

`Math.max` 阻止上报值低于内存值的修正，导致虚高计数 **永远无法自愈**。这是比原始 bug 更严重的回归。

### 方案 B（已否决）：`Math.max` 对 `maxConcurrent` 也适用

```typescript
const maxConcurrent = Math.max(existing?.maxConcurrent ?? 0, data.maxConcurrent);
```

**初衷**：admin 在 Dashboard 调大 `maxConcurrent` 后不应被心跳覆盖回旧值。

**回归**：admin 调小 `maxConcurrent` 后也无法生效（`Math.max` 阻止降低）。

实际上心跳端点传的 `data.maxConcurrent` 来自 DB `upsert` 返回值（而非 Worker 上报值），所以当前路径中 `maxConcurrent` 不会被覆盖回旧值。但设计上脆弱——如果心跳改用 Worker 上报值就会出问题。

### 方案 C（最终采纳）：选择性更新

**核心思路**：心跳只更新它权威的字段，`currentTasks` 由 dispatcher 自行管理。

```typescript
onHeartbeat(data: { nodeId: string; id: string; address: string; maxConcurrent: number; currentTasks?: number }) {
  const existing = this.workers.get(data.nodeId);
  if (existing) {
    // 选择性更新：仅覆盖心跳权威字段，保留 dispatcher 管理的 currentTasks
    // currentTasks 由 dispatcher 通过乐观递增（分发）和递减（完成/超时/离线）管理，
    // 不被心跳覆盖，避免过期心跳抹掉递增或回滚递减导致永久虚高
    existing.id = data.id;
    existing.address = data.address;
    existing.maxConcurrent = data.maxConcurrent;
    existing.lastHeartbeat = Date.now();
  } else {
    // 新注册 Worker：使用上报值初始化
    this.workers.set(data.nodeId, {
      id: data.id,
      nodeId: data.nodeId,
      address: data.address,
      maxConcurrent: data.maxConcurrent,
      currentTasks: data.currentTasks ?? 0,
      lastHeartbeat: Date.now(),
    });
  }
}
```

**优势**：
- 保护乐观递增不被覆盖 ✓
- 允许递减生效（任务完成后内存自然降低） ✓
- 无永久虚高风险（不像 Math.max 阻止自修正） ✓
- 语义清晰：心跳权威字段 vs dispatcher 管理字段 ✓

**`currentTasks` 内存值的完整生命周期**：

| 操作 | 代码位置 | 说明 |
|------|---------|------|
| 初始化 | `recoverWorkersFromDB` 第 519 行 | 从 DB 加载 |
| 新 Worker 注册 | `onHeartbeat` else 分支 第 264 行 | 使用上报值 |
| 乐观递增 | `dispatchOne` 第 437 行 | 分发时 `++` |
| 分发失败回滚 | `dispatchOne` 第 442/446 行 | `--` |
| 任务完成递减 | `decrementWorkerMemoryLoad` 第 286 行 | result 回调触发 |
| 超时递减 | `checkTimeoutTasks` 第 989 行 | 超时扫描触发 |
| Worker 离线清零 | `checkOfflineWorkers` 第 770 行 | `= 0`，然后删除 |
| **心跳** | `onHeartbeat` | **不再覆盖** |

所有修改路径都是 dispatcher 自身操作，互不干扰，能正确收敛。

## 与 maxConcurrent 修改不生效的关系

**没有直接关系**，但属于同一类设计缺陷（心跳覆盖内存拓扑）。

`maxConcurrent` 的心跳路径使用 DB `upsert` 返回值（而非 Worker 上报值），所以 admin 在 Dashboard 修改后不会被覆盖回旧值。详细分析见 `docs/worker-maxconcurrent-sync-issue.md`。

但在方案 C 中，`maxConcurrent` 也采用了选择性更新而非 `Math.max`，原因是：
- `Math.max` 会阻止 admin 调小 `maxConcurrent`
- 心跳传的是 DB 值（已反映 admin 修改），直接赋值即可
- `updateWorkerMaxConcurrent`（PATCH 调用）在 admin 修改时立即设置内存值，与后续心跳传的 DB 值一致，无冲突

## 方案对比

| | 原始代码 | 方案 A (Math.max) | 方案 C (选择性更新) |
|---|---|---|---|
| 乐观递增保护 | ❌ 可被覆盖 | ✅ 不被覆盖 | ✅ 不被覆盖 |
| 完成递减生效 | ✅ 下次心跳修正 | ❌ 被过期心跳回滚 | ✅ 立即生效 |
| 自修正能力 | ✅ 下次心跳修正 | ❌ Math.max 阻止 | ✅ 递减自然生效 |
| 永久虚高风险 | ❌（30s 自愈） | ✅（无法自愈） | ❌ |
| 代码改动量 | — | 1 行 | ~10 行 |
| maxConcurrent 调小生效 | ✅ | ❌ Math.max 阻止 | ✅ 直接赋值 |

## 修改内容

仅修改 `src/services/codeswarm-dispatcher.ts` 的 `onHeartbeat` 方法（第 247-268 行），从 `this.workers.set()` 整体替换改为对已注册 Worker 选择性更新字段。

新注册 Worker 仍使用 `this.workers.set()` 初始化完整对象（含 `currentTasks` 上报值）。