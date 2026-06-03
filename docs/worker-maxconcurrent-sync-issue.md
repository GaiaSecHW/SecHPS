# Worker maxConcurrent 配置同步问题分析与修复方案

## 问题描述

修改 Worker 最大并发数（`maxConcurrent`）后，配置值已更新为期望值，但实际执行中的并发数未发生变化。

## 涉及文件

| 文件 | 作用 |
|------|------|
| `codeswarm/packages/worker/src/index.ts` | Worker 启动入口，从 `MAX_CONCURRENT` 环境变量构建 Semaphore |
| `codeswarm/packages/worker/src/daemon.ts` | Worker 心跳上报 + `maxConcurrentOverride` 接收与 Semaphore 动态调整 |
| `codeswarm/packages/worker/src/semaphore.ts` | 信号量实现，支持 `resize()` 动态调整容量 |
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | 服务端心跳 API，DB upsert + dispatcher 内存更新 + override 判断 |
| `src/app/api/codeswarm/nodes/[nodeId]/route.ts` | Dashboard PATCH API，DB 更新 + dispatcher 内存更新 |
| `src/services/codeswarm-dispatcher.ts` | 调度器，维护 Worker 内存拓扑，`selectWorker` 用 `currentTasks < maxConcurrent` 判断容量 |
| `src/components/codeswarm/WorkerNodesTable.tsx` | 前端 Dashboard，支持在线编辑 `maxConcurrent` |

## 问题产生过程

系统中有三个存储 `maxConcurrent` 的位置，三者需要保持一致才能正确控制并发：

1. **Worker 进程 Semaphore** — 实际控制任务接受的并发上限
2. **数据库 `CodeswarmWorker.maxConcurrent`** — 持久化配置值
3. **Dispatcher 内存 `WorkerInfo.maxConcurrent`** — 控制任务分发的容量判断

### 数据流分析

#### 正常心跳流程（每 30 秒）

```
Worker → POST /api/codeswarm/worker/heartbeat
  body: { nodeId, maxConcurrent: <环境变量值>, currentTasks, address }

服务端处理:
  1. upsert DB:
     - create: maxConcurrent = body.maxConcurrent || 5  ← 新 Worker 首次注册时写入
     - update: **不包含 maxConcurrent 字段**            ← ← ← 问题根源！
  
  2. onHeartbeat(dispatcher内存):
     maxConcurrent = worker.maxConcurrent  ← 用 DB 值（而非 Worker 上报值）
  
  3. override 判断:
     if DB值 ≠ Worker上报值 → response.maxConcurrentOverride = DB值

Worker 收到响应:
  if maxConcurrentOverride 存在且 ≠ 当前值 → semaphore.resize(override值)
```

#### Dashboard 修改流程

```
Dashboard PATCH /api/codeswarm/nodes/{nodeId}
  body: { maxConcurrent: 10 }

服务端处理:
  1. DB UPDATE: maxConcurrent = 10  ✓
  2. dispatcher.updateWorkerMaxConcurrent(nodeId, 10)  ✓
```

### 问题根源：心跳 upsert 不更新 maxConcurrent

`heartbeat/route.ts` 第 27-49 行的 `upsert` 操作中，`update` 块**缺少 `maxConcurrent` 字段**：

```typescript
const worker = await prisma.codeswarmWorker.upsert({
  where: { nodeId },
  update: {
    address: address || '',
    systemType: systemType || null,
    arch: arch || null,
    status: 'online',
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
    // ← maxConcurrent 不在 update 块中！
  },
  create: {
    maxConcurrent: maxConcurrent || 5,  // 仅首次注册时设置
  },
});
```

这导致了两种故障场景：

### 场景 A：修改 Worker 环境变量并重启，但 Dashboard 未同步修改

1. Worker 重启后 `MAX_CONCURRENT=10`，Semaphore 初始容量 = 10
2. 第一次心跳：Worker 上报 `maxConcurrent=10`
3. DB upsert 的 `update` 块不更新 `maxConcurrent`，DB 仍为旧值 5
4. 心跳响应判断：DB 值(5) ≠ 上报值(10) → 返回 `maxConcurrentOverride=5`
5. Worker 收到 override=5，调用 `semaphore.resize(5)` — **Worker 被强制回退到旧值！**
6. 之后每 30 秒心跳重复此过程：Worker 上报 10 → override 回退到 5 → Semaphore 又 resize 到 5

**结果**：Worker 环境变量改了，进程也重启了，但实际并发上限被 DB 旧值覆盖，始终无法生效。

### 场景 B：仅修改 Dashboard，Worker 环境变量未改

1. Dashboard 修改 `maxConcurrent=10`，DB 和 dispatcher 内存都更新为 10
2. Worker 下次心跳：上报 `maxConcurrent=5`（环境变量未改）
3. DB upsert 不更新 `maxConcurrent`，DB 保持 Dashboard 设置的 10
4. 心跳响应判断：DB 值(10) ≠ 上报值(5) → 返回 `maxConcurrentOverride=10`
5. Worker 收到 override=10，调用 `semaphore.resize(10)`
6. **此时 Worker Semaphore 容量确实是 10，分发容量判断也是 10 — 并发数已生效**

但存在一个延迟窗口：从 Dashboard 修改到 Worker 下次心跳（最长 30 秒），期间 Worker Semaphore 仍是旧值。若在此窗口内 dispatcher 分发超出旧 Semaphore 容量的任务，Worker 会返回 503，任务被回滚重排队，产生无效的分发-拒绝-重排循环。

### 场景 C（最隐蔽）：并发数"看起来没变"

即使最终三个存储位置都同步了（场景 B 在心跳后），用户可能仍觉得"并发数没变"。原因：

- **增大并发**：已有排队任务才会填满新增的槽位。如果队列中没有足够任务，并发数自然不会增加到新上限。
- **缩小并发**：正在运行的任务不会被中断。Semaphore `resize()` 将 `available` 钳位到 `max(0, newMax - running)`，已有任务继续执行直到完成，只是不再接受新任务。只有当运行数自然降至新上限以下，效果才可见。

## 修复方案

### 方案 1（推荐）：心跳 upsert 同步 maxConcurrent

让 DB 值始终反映 Worker 的实际配置，消除不必要的 override 交互。

**修改 `src/app/api/codeswarm/worker/heartbeat/route.ts`**：

```typescript
const worker = await prisma.codeswarmWorker.upsert({
  where: { nodeId },
  update: {
    address: address || '',
    systemType: systemType || null,
    arch: arch || null,
    status: 'online',
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
    maxConcurrent: maxConcurrent || 5,  // ← 新增：每次心跳同步 Worker 上报值
  },
  create: {
    id: `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    nodeId,
    address: address || '',
    systemType: systemType || null,
    arch: arch || null,
    status: 'online',
    maxConcurrent: maxConcurrent || 5,
    currentTasks: currentTasks || 0,
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  },
});
```

同时修改 `onHeartbeat` 调用，使用 Worker 上报值而非 DB 值：

```typescript
codeswarmDispatcher.onHeartbeat({
  nodeId,
  id: worker.id,
  address: address || worker.address,
  maxConcurrent: maxConcurrent || worker.maxConcurrent,  // ← 改为优先使用上报值
  currentTasks,
});
```

**效果**：

- Worker 环境变量修改 + 重启 → 心跳上报新值 → DB 同步更新 → dispatcher 内存更新 → 三者一致，无需 override
- Dashboard 修改 → DB 更新 → dispatcher 内存更新 → 下次心跳 Worker 上报旧值 → DB 被覆盖回旧值

**问题**：Dashboard 的 admin 修改会被下次心跳覆盖。如果需要 Dashboard 修改优先级高于 Worker 环境变量，需配合方案 1a。

#### 方案 1a：增加"锁定"机制保留 Dashboard 优先级

在 `CodeswarmWorker` 模型中增加 `maxConcurrentLocked: Boolean` 字段。当 admin 在 Dashboard 修改 `maxConcurrent` 时，同时设置 `maxConcurrentLocked = true`。心跳 upsert 中：

```typescript
update: {
  // 只有未被 admin 锁定时，才用 Worker 上报值覆盖 DB
  ...(worker.maxConcurrentLocked ? {} : { maxConcurrent: maxConcurrent || 5 }),
}
```

这样 admin 的修改不会被心跳覆盖，而 Worker 自身的环境变量变更也能正常同步（未被锁定时）。

### 方案 2：保留 Dashboard Override 优先权，修复 override 传递链

不修改 upsert（保持 DB 值由 Dashboard 控制），但确保 override 从 DB 正确传递到 Worker Semaphore，并消除 30 秒延迟窗口。

**修改 `src/app/api/codeswarm/nodes/[nodeId]/route.ts`** PATCH 处理：

在 Dashboard 修改 `maxConcurrent` 后，**主动通知 Worker** 而非等下次心跳：

```typescript
if (maxConcurrent !== undefined) {
  const newMax = Math.max(1, Math.min(50, maxConcurrent));
  codeswarmDispatcher.updateWorkerMaxConcurrent(nodeId, newMax);

  // 主动推送 override 到 Worker（而非等 30 秒心跳）
  const workerInfo = codeswarmDispatcher.getWorkerInfo(nodeId);
  if (workerInfo?.address) {
    const addresses = workerInfo.address.split(',').map(a => a.trim()).filter(Boolean);
    for (const addr of addresses) {
      try {
        await fetch(`http://${addr}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxConcurrentOverride: newMax }),
          signal: AbortSignal.timeout(5000),
        });
        break;  // 第一个可达地址成功即可
      } catch { /* Worker 可能暂时不可达 */ }
    }
  }
}
```

同时需要在 Worker `daemon.ts` 中新增 `/config` 端点接收主动推送：

```typescript
this.server.post('/config', async (request, reply) => {
  const body = request.body as { maxConcurrentOverride?: number };
  if (typeof body.maxConcurrentOverride === 'number') {
    const currentMax = this.semaphore.max;
    if (body.maxConcurrentOverride !== currentMax) {
      this.semaphore.resize(body.maxConcurrentOverride);
      this.server.log.info(
        { previousMax: currentMax, newMax: body.maxConcurrentOverride },
        'maxConcurrent adjusted via push config'
      );
    }
    return reply.send({ success: true, maxConcurrent: this.semaphore.max });
  }
  return reply.send({ success: true });
});
```

**效果**：

- Dashboard 修改 → 立即推送到 Worker → Semaphore 即刻生效 → 无 30 秒延迟窗口
- DB 值由 Dashboard 控制，不被 Worker 上报覆盖
- 心跳 override 作为兜底：如果推送失败（Worker 暂时不可达），下次心跳仍会传递 override

## 方案对比

| | 方案 1 | 方案 1a | 方案 2 |
|---|---|---|---|
| 复杂度 | 低（1 处改动） | 中（DB schema + 2 处改动） | 中（Worker 新端点 + PATCH 改动） |
| Worker 环境变量修改生效 | ✅ 立即（心跳同步） | ✅ 立即（未锁定时） | ❌ 被 DB 覆盖回旧值 |
| Dashboard 修改生效 | ❌ 被下次心跳覆盖 | ✅ 锁定保护 | ✅ 立即推送 |
| 30 秒延迟窗口 | 存在（仅 Dashboard→Worker 方向） | 存在（仅 Dashboard→Worker 方向） | ✅ 消除 |
| 需要改 DB schema | 否 | 是（新增字段） | 否 |
| 需要改 Worker 代码 | 否 | 否 | 是（新增端点） |

## 建议

对于当前使用场景（以 Worker 环境变量为主要配置方式，Dashboard 编辑为辅助），**方案 1** 最简单有效：让 DB 始终反映 Worker 实际配置，消除 DB 与 Worker 之间的不一致。

如果后续需要 Dashboard 修改优先级高于 Worker 配置（例如运维人员在线调整、不重启 Worker），则升级到**方案 1a** 或**方案 2**。

## 验证方法

修复后，可通过以下步骤验证：

```bash
# 1. 修改 Worker 环境变量并重启
MAX_CONCURRENT=10 node dist/index.js

# 2. 等待 30 秒（心跳周期），检查 Worker 实际并发上限
curl http://localhost:8090/health
# 期望: { maxConcurrent: 10, ... }

# 3. 检查 DB 值是否同步
curl http://localhost:3000/api/codeswarm/nodes
# 期望: worker.maxConcurrent = 10

# 4. 在 Dashboard 修改并发数，观察 Worker 即时响应
curl http://localhost:8090/health
# 期望: maxConcurrent 与 Dashboard 设置一致
```