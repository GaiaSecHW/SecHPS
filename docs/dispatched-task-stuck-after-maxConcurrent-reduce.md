# 减容后排队任务卡在 dispatched 状态的问题分析

## 问题现象

当 Worker 满载运行（5/5，5个运行中5个容量）时，手动将 `maxConcurrent` 从5减到2，容量变成（5/2）。此时有3个排队中任务，手动停止1个运行中的任务后，会出现1个排队任务转为 `dispatched` 状态，并长时间（约30分钟）停留在该状态。扩大容量（如改为15）后，剩余排队任务能正常执行，但这个 `dispatched` 任务仍卡住，直到超时扫描重置。

## 涉及文件

| 文件 | 行号 | 作用 |
|------|------|------|
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | 67-81 | 心跳端点：`currentTasks` 校正逻辑（三层 LEAST/GREATEST） |
| `src/services/codeswarm-dispatcher.ts` | 189-197 | 原子抢占：`WHERE currentTasks < maxConcurrent` |
| `src/services/codeswarm-dispatcher.ts` | 297-313 | 503 回滚：`WHERE state = 'dispatched'` |
| `src/services/codeswarm-dispatcher.ts` | 328-339 | `onHeartbeat`：`Math.min(reported, maxConcurrent)` 截断 |
| `src/services/codeswarm-dispatcher.ts` | 607-631 | `selectWorker`：`currentTasks < maxConcurrent` 判断 |
| `src/services/codeswarm-dispatcher.ts` | 902-944 | `checkStuckDispatchedTasks`：30分钟超时扫描重置 |
| `codeswarm/packages/worker/src/semaphore.ts` | 16-22, 29-30 | Semaphore `resize()` 和 `release()` |
| `codeswarm/packages/worker/src/daemon.ts` | 425 | 心跳上报 `currentTasks = max - available` |

## 根因分析

问题由两个独立 bug 叠加导致。两者都制造了"看似有容量但实际满载"的虚假容量窗口。

### Bug 1：心跳校正 `LEAST(..., maxConcurrent)` 制造虚假容量

**代码位置**：`heartbeat/route.ts:67-81`

```sql
UPDATE "CodeswarmWorker"
SET "currentTasks" = LEAST(
      GREATEST("currentTasks", ${reportedTasks}),          -- ① 防止覆盖刚分发的计数
      GREATEST(
        (SELECT COUNT(*)::int FROM "CodeswarmTask"         -- ② actualActive: 真实活跃数
         WHERE "workerId" = "CodeswarmWorker".id
           AND state IN ('dispatched', 'running')),
        ${reportedTasks}                                    -- ③ Worker 上报值兜底
      ),
      "maxConcurrent"                                       -- ④ ← BUG: 截断到容量上限
    ),
    "lastHeartbeat" = CURRENT_TIMESTAMP
WHERE "nodeId" = ${nodeId}
```

**问题**：`LEAST(..., "maxConcurrent")` 在超载场景（`currentTasks > maxConcurrent`，即减容后仍有超过新容量的任务在运行）时，将真实负载强压到 `maxConcurrent`，制造虚假容量。

**初衷**：防止 `currentTasks` 漂移超过容量上限。但 `actualActive` 子查询（②）已防止漂移超过真实活跃数，`maxConcurrent` 截断是冗余的，且在超载场景下有害。

**数值追踪**（5 running / max=5 → 减容 max=2 → 停1个 → 4 running / max=2）：

| 步骤 | 事件 | DB currentTasks | DB maxConcurrent | actualActive | Worker上报 | LEAST结果 | 真实running |
|------|------|-----------------|------------------|--------------|-----------|-----------|------------|
| 1 | 5 running / max=5 | 5 | 5 | 5 | 5 | LEAST(5,5,5)=5 | 5 |
| 2 | admin 减容 max→2 | 5 | 2 | 5 | 2 | LEAST(5,5,**2**)=**2** | **5** |
| 3 | 手动停1个 | 4 | 2 | 4 | 2 | LEAST(4,4,**2**)=**2** | **4** |
| 4 | 心跳校正生效 | **2** | 2 | 4 | 2 | 保持2 | **4** |

步骤2-3：`currentTasks` 被压到 `maxConcurrent=2`，但实际有4-5个任务在运行。DB 认为只有2个任务，看似 `currentTasks(2) < maxConcurrent(2)` = false（暂无容量）。但只要任何一个 running 任务自然完成：

| 步骤 | 事件 | DB currentTasks | actualActive | 判断 |
|------|------|-----------------|--------------|------|
| 5 | 1个自然完成 → result递减 | 2→1 | 3 | **1 < 2** → **虚假容量窗口出现！** |

此时原子抢占（`WHERE currentTasks < maxConcurrent`）通过，任务被标记为 `dispatched`，但 Worker 实际仍有3个任务在运行，Semaphore 拒绝新任务。

### Bug 2：Semaphore `release()` 在 `resize` 后产生虚假可用槽位

**代码位置**：`semaphore.ts:16-22, 29-30`

```typescript
resize(max: number): void {
  const running = this._max - this._available;   // resize前用旧max算running
  this._max = max;
  this._available = Math.max(0, max - running);  // clamp到0
}

release(): void {
  if (this._available < this._max) this._available++;  // 简单递增，不考虑真实running
}
```

**问题**：`resize()` 后 `_available` 被 clamp 到 `max(0, newMax - running)`，但 `release()` 只是简单的 `_available++`（条件 `_available < _max`），不检查真实 running 数是否仍超过 `_max`。每次超额任务完成并 `release()` 时，`_available` 递增，直到达到 `_max`，制造虚假可用槽位。

**数值追踪**：

| 步骤 | 事件 | _max | _available | 真实running | 期望available |
|------|------|------|-----------|------------|---------------|
| 1 | 初始 5/5 | 5 | 0 | 5 | 0 |
| 2 | resize(2) | 2 | max(0,2-5)=0 | 5 | 0 ✓ |
| 3 | 停1个 → release | 2 | 0→1 (**0 < 2** ✓条件) | **4** | **应为0** |
| 4 | 1个完成 → release | 2 | 1→2 (**1 < 2** ✓条件) | **3** | **应为0** |
| 5 | 又1完成 → release | 2 | 2→? (**2 < 2** ✗不递增) | 2 | 应为0 |

步骤3-4：`_available` 递增到 `_max=2`，Worker 认为有2个可用槽位。但实际仍有4/3个任务在运行！

**对心跳上报的影响**：

心跳上报 `currentTasks = currentMax - this.semaphore.available`（`daemon.ts:425`）：

| 步骤 | 上报 currentTasks | 真实running | 偏差 |
|------|-------------------|------------|------|
| 3 | 2-1=**1** | 4 | 低估3 |
| 4 | 2-2=**0** | 3 | 低估3 |

上报值严重低估真实负载，导致 Dispatcher 内存中的 `currentTasks` 虚低。

### Bug 2 传导：`onHeartbeat` `Math.min` 截断进一步加剧

**代码位置**：`codeswarm-dispatcher.ts:335-339`

```typescript
if (typeof data.currentTasks === 'number') {
  existing.currentTasks = Math.min(data.currentTasks, existing.maxConcurrent);
}
```

`Math.min` 将上报值截断到 `maxConcurrent`。在正常场景下这防止了漂移，但在超载场景下进一步掩盖了真实负载：

- 上报1 → `Math.min(1, 2) = 1` → 内存 `1 < 2` → **有容量** → `selectWorker` 选这个 Worker
- 上报0 → `Math.min(0, 2) = 0` → 内存 `0 < 2` → **有容量**

即使上报值不被截断（上报2），`2 < 2 = false` 暂无容量。但一旦有1个任务自然完成，result 回调递减内存 `currentTasks` 到1，`1 < 2` → 又出现虚假容量窗口。

### 两个 Bug 的叠加事件链

```
完整事件链：

T0   5 running / max=5 → admin 减容到 max=2
     DB: currentTasks=5, maxConcurrent=2
     Worker: _available=0, _max=2, running=5

T1   心跳校正: LEAST(5, 5, 2)=2 → DB currentTasks=2  ← Bug1生效
     心跳上报: currentMax-available = 2-0 = 2
     onHeartbeat: 内存 currentTasks = Math.min(2, 2) = 2  ← Bug2传导
     selectWorker: 2 < 2 = false → 暂不分发

T2   手动停1个 → DELETE路径: DB currentTasks 5→4
     Worker: release() → _available 0→1  ← Bug2生效
     tryDispatchNext触发 → 内存2 < 2 = false → 不分发（暂安全）

T3   下次心跳校正: LEAST(4, 4, 2)=2 → DB currentTasks=2
     心跳上报: 2-1=1
     onHeartbeat: Math.min(1, 2)=1 → 内存 currentTasks=1 ← Bug2传导
     1 < 2 = true! → 虚假容量窗口出现！

T4   1个自然完成 → result回调:
     DB currentTasks 2→1 (WHERE gt:0 递减)
     内存 decrementWorkerMemoryLoad → 1→0
     tryDispatchNext触发

T5   selectWorker: 内存 currentTasks=0 < maxConcurrent=2 → 选Worker
     原子抢占: WHERE currentTasks(1) < maxConcurrent(2) → 1<2 → claim=1 ✓
     DB currentTasks=2, 任务变为 dispatched

T6   HTTP POST → Worker:
     Worker semaphore: _available=2 (Bug2累积), _max=2
     tryAcquire(): _available(2)→1 → true → Worker接受
     但此时真实running=3, max=2 → Worker超载运行

     [或另一种时序: _available=0 → 503 → 进入T7分支]

T7   [503路径] sendTaskToWorker 回滚:
     WHERE state='dispatched' → 回滚成功 → 任务回 queued, currentTasks 2→1

T8   下次心跳校正: LEAST(1, actualActive=3, 2)=LEAST(1,3,2)=1
     → DB currentTasks=1 → 1 < 2 → 又有容量！→ 又分发 → 又503
     → 循环: 分发→503→回滚→心跳校正→虚假容量→分发→503...

T9   [某次回滚事务失败（死锁等）] → 任务卡在 dispatched
     直到30分钟后 checkStuckDispatchedTasks (codeswarm-dispatcher.ts:902-944)
     扫描 WHERE state='dispatched' AND updatedAt < NOW()-INTERVAL '30 minutes'
     → 重置为 queued
```

**关键理解**：T3 的虚假容量窗口是 Bug2（Semaphore）传导到心跳上报和 `onHeartbeat` 产生的。T4-T5 的原子抢占通过是因为 Bug1（心跳校正）在 T1 就把 DB `currentTasks` 压到2，后续 result 递减到1后 `1 < 2` 通过。两个 Bug 在不同层面制造虚假容量，叠加放大。

### 为什么扩大容量后其他 queued 正常但 dispatched 卡住

扩容到 `maxConcurrent=15` 后：

- **`queued` 任务**：`scanDbQueuedTasks` 入 Redis → `dispatchOne` → `selectWorker` → `currentTasks < 15` → 正常分发执行
- **`dispatched` 任务**：状态不是 `queued`，不会被任何分发逻辑处理。只能等 `checkStuckDispatchedTasks`（30分钟超时扫描）重置为 `queued`

### 为什么是"很长时间"而不是永远

`checkStuckDispatchedTasks`（`codeswarm-dispatcher.ts:902-944`）每周期扫描卡在 `dispatched` 超过 **30分钟** 的任务并重置为 `queued`。用户描述的"很长一段时间"与此吻合——任务卡在 `dispatched` 约30分钟后被自动重置。

### 回滚-重分发循环的收敛条件

循环（T8）并非无限持续。当超载的 running 任务逐渐自然完成到 `running ≤ maxConcurrent` 时：

- Worker Semaphore `available = max - running > 0` → `tryAcquire()` 成功 → Worker 真正接受任务
- DB `currentTasks = running` ≤ `maxConcurrent` → 不再是虚假容量

所以在没有回滚失败的情况下，循环会在 `running` 降到 `maxConcurrent` 以下时自然收敛。但如果**某次回滚事务失败**（PostgreSQL 死锁等），任务就卡在 `dispatched` 直到30分钟超时扫描。

## 修复方向

### 方向1：去掉心跳校正的 `LEAST(..., maxConcurrent)` 截断

**原理**：`currentTasks` 应反映真实负载。超载时（`currentTasks > maxConcurrent`）保留真实值，让原子抢占 `WHERE currentTasks < maxConcurrent` 自然拒绝分发。`actualActive` 子查询已防止漂移超过真实活跃数，`maxConcurrent` 截断是冗余的。

**修改**：`heartbeat/route.ts:67-81`，将 `LEAST(..., "maxConcurrent")` 改为两层 `GREATEST`：

```sql
UPDATE "CodeswarmWorker"
SET "currentTasks" = GREATEST(
      "currentTasks",
      GREATEST(
        ${reportedTasks},
        (SELECT COUNT(*)::int FROM "CodeswarmTask"
         WHERE "workerId" = "CodeswarmWorker".id
           AND state IN ('dispatched', 'running'))
      )
    ),
    "lastHeartbeat" = CURRENT_TIMESTAMP
WHERE "nodeId" = ${nodeId}
```

**安全性**：
- 正常场景（`currentTasks ≤ maxConcurrent`）：`GREATEST` 不截断，结果与原来相同
- 超载场景（`currentTasks > maxConcurrent`）：保留真实值，原子抢占拒绝分发 → **修复目标**
- 漂移防护：`actualActive` 子查询兜底，无需 `maxConcurrent` 截断

### 方向2：Semaphore 增加 `_running` 计数器

**原理**：`release()` 应基于真实 running 数计算 `_available`，而非简单 `_available++`。增加 `_running` 计数器精确跟踪，`release()` 时 `_available = max(0, _max - _running)`。

**修改**：`codeswarm/packages/worker/src/semaphore.ts`

```typescript
export class Semaphore {
  private _available: number;
  private _max: number;
  private _running: number;  // 新增：精确跟踪运行任务数

  constructor(max: number) {
    this._max = max;
    this._available = max;
    this._running = 0;
  }

  resize(max: number): void {
    this._max = max;
    this._available = Math.max(0, max - this._running);  // 基于 _running 计算
  }

  tryAcquire(): boolean {
    if (this._available > 0) {
      this._available--;
      this._running++;  // 新增
      return true;
    }
    return false;
  }

  release(): void {
    if (this._running > 0) {
      this._running--;  // 新增
      this._available = Math.max(0, this._max - this._running);  // 修改：基于 _running 计算
    }
  }

  get available(): number { return this._available; }
  get max(): number { return this._max; }
}
```

**场景验证**：

| 步骤 | 事件 | _max | _running | _available | 真实running | 期望 |
|------|------|------|---------|-----------|------------|------|
| 1 | 5/5, 5次acquire | 5 | 5 | 0 | 5 | ✓ |
| 2 | resize(2) | 2 | 5 | max(0,2-5)=0 | 5 | ✓ |
| 3 | 停1个 → release | 2 | 4 | max(0,2-4)=**0** | 4 | ✓ (不再虚假!) |
| 4 | 1完成 → release | 2 | 3 | max(0,2-3)=**0** | 3 | ✓ |
| 5 | 又1完成 → release | 2 | 2 | max(0,2-2)=**0** | 2 | ✓ |
| 6 | 又1完成 → release | 2 | 1 | max(0,2-1)=**1** | 1 | ✓ (真正有容量) |
| 7 | tryAcquire | 2 | 2 | 0 | 2 | ✓ |

### 方向3：心跳上报使用 `activeTasks.size` 替代 `max - available`

**原理**：Bug2 修复后 Semaphore 的 `_available` 在超载时正确为0，上报 `max - 0 = max = 2` 仍不反映真实 running=4。用 `activeTasks.size`（实际正在运行的任务Map）替代 semaphore 推算，上报真实值。

**修改**：`codeswarm/packages/worker/src/daemon.ts:425`

```typescript
// 原: currentTasks: currentMax - this.semaphore.available,
// 改: currentTasks: this.activeTasks.size,
```

`activeTasks` 是 `Map<string, TaskPayload>`，`activeTasks.size` 就是当前正在执行的任务数，不受 `_max` 截断影响。

### 方向4：`onHeartbeat` 去掉 `Math.min(reported, maxConcurrent)` 截断

**原理**：配合方向3（上报真实 running 数），`Math.min` 截断在超载时掩盖真实值。

**修改**：`src/services/codeswarm-dispatcher.ts:337-338`

```typescript
// 原: existing.currentTasks = Math.min(data.currentTasks, existing.maxConcurrent);
// 改: existing.currentTasks = data.currentTasks;
```

**安全性**：方向3修复后上报值是真实的 `activeTasks.size`，不会超过 `maxConcurrent`（除非超载）。超载时保留真实值让 `selectWorker` 正确判断无容量（`4 < 2 = false`）。

## 方向对比与建议

| | 方向1 | 方向2 | 方向3 | 方向4 | 全部修复 |
|---|---|---|---|---|---|
| 修复层面 | DB 原子抢占 | Worker Semaphore | Worker 心跳上报 | Dispatcher 内存 | 四层保障 |
| 虚假容量消除 | DB不再截断 | Semaphore正确 | 上报真实值 | 内存不截断 | ✓✓✓✓ |
| 分发-503循环 | 原子抢占拒绝 | tryAcquire拒绝 | selectWorker拒绝 | selectWorker拒绝 | 四条路径都拒绝 |
| 代码改动量 | 1处SQL | 1个文件 | 1行 | 1行 | 4处 |
| 独立有效性 | ✓（即使其他不修也有效） | ✓（即使其他不修也有效） | 需配合方向4 | 需配合方向3 | ✓✓✓✓ |

**建议全部修复**，形成四层保障：
- **方向1**：DB 层面 `currentTasks` 反映真实值，原子抢占在超载时拒绝
- **方向2**：Semaphore `_running` 精确跟踪，`release()` 不再制造虚假槽位
- **方向3**：心跳上报 `activeTasks.size` 真实值，不受 `_max` 截断
- **方向4**：`onHeartbeat` 不截断上报值，内存反映真实负载

任一方向独立修复即可阻止任务卡住（每条分发路径都有独立的安全检查），但全部修复能彻底消除虚假容量窗口，避免分发-503-回滚循环浪费。

## 验证方法

```bash
# 1. 启动 Worker (maxConcurrent=5)
MAX_CONCURRENT=5 node dist/index.js

# 2. 创建5个任务使其满载运行
# 3. 在 Dashboard 将 maxConcurrent 从5改为2
# 4. 创建3个排队任务
# 5. 手动停止1个运行中的任务

# 验证点：
# - DB currentTasks 应 > maxConcurrent（反映真实超载），而非被截断到 maxConcurrent
# - Worker /health: available=0, max=2（release后仍为0）
# - 心跳上报: currentTasks = activeTasks.size = 4（真实值）
# - Dispatcher内存: currentTasks=4 < maxConcurrent=2 = false → 不分发
# - 排队任务应保持 queued，不转为 dispatched

# 当运行任务自然完成到只剩1个时：
# - DB currentTasks=1 < maxConcurrent=2 → 分发成功
# - Worker tryAcquire → available=1 → 接受任务 → 正常执行
# - 不出现分发→503→回滚循环
```

## 与已有 Bug 文档的关系

| 文档 | Bug | 与本文关系 |
|------|-----|-----------|
| `dispatcher-heartbeat-overwrite-bug.md` | `onHeartbeat` 整体替换 WorkerInfo 覆盖 currentTasks | 已修复为选择性更新，但 `Math.min(reported, maxConcurrent)` 截断（本文方向4）仍存在 |
| `worker-maxconcurrent-sync-issue.md` | 心跳 upsert 不更新 `maxConcurrent` | 已修复（upsert update 包含 maxConcurrent + pushMaxConcurrentToWorker 主动推送），但 Semaphore `release()` 虚假槽位（本文方向2）是新发现的 bug |
