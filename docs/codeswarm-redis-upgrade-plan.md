# CodeSwarm 调度架构升级方案：从数据库轮询到 Redis 消息队列

> 状态：已完成
> 日期：2026-05-10
> 完成日期：2026-05-10
> 目标规模：50-100 Worker

---

## 一、现状分析

### 1.1 当前架构

CodeSwarm 是平台的分布式 Agent 执行层，当前处于 **V0 阶段**：

```
                    NAZHUA 后端（内嵌调度器）
                    ┌────────────────────────────────┐
                    │                                │
用户提交任务 ──────>│ POST /api/codeswarm/tasks      │
                    │   ↓                            │
                    │ 查 DB 找空闲 Worker             │
                    │   ├─ 有 → HTTP POST /task 直接推送 │──── Worker 001
                    │   └─ 无 → DB state='queued'    │──── Worker 002
                    │                                │
Worker 心跳 ──────>│ POST /api/codeswarm/worker/heartbeat │
  (每30秒)          │   ↓                            │
                    │ upsert DB                      │
                    │   ↓                            │
                    │ dispatchQueuedTasks()           │
                    │   查 DB state='queued' 的任务   │
                    │   查 DB 所有 Worker 排序        │
                    │   匹配空闲 Worker → 推送        │──── Worker N
                    └────────────────────────────────┘
```

核心特点：
- **任务队列**：数据库中 `state='queued'` 的行记录，无独立队列
- **出队触发**：依赖 Worker 心跳（30 秒间隔）
- **分发方式**：同步 HTTP POST 直连 Worker
- **事件存储**：所有事件追加到 `CodeswarmTask.events` 单个 JSON 字段
- **状态轮询**：Task Builder 每 2 秒查一次 DB（最多 600 次 = 20 分钟）

### 1.2 涉及的关键文件

| 文件 | 职责 |
|------|------|
| `src/app/api/codeswarm/tasks/route.ts` | 任务创建 GET/POST，含分发逻辑 |
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | Worker 心跳，含 `dispatchQueuedTasks()` |
| `src/app/api/codeswarm/worker/event/route.ts` | 事件回调（追加 JSON） |
| `src/app/api/codeswarm/worker/result/route.ts` | 结果回调（state 变更 + currentTasks-1） |
| `src/app/api/task-builder/tasks/[id]/execute/route.ts` | Task Builder 集成，含 2s 轮询 |
| `codeswarm/packages/worker/src/daemon.ts` | Worker 端 daemon（Fastify HTTP 服务） |
| `codeswarm/packages/worker/src/semaphore.ts` | Worker 并发信号量 |
| `prisma/schema.prisma` (308-350行) | CodeswarmTask + CodeswarmWorker 表定义 |

### 1.3 数据库表结构

```prisma
model CodeswarmTask {
  id              String   @id
  taskId          String   @unique
  workerId        String?              // FK → CodeswarmWorker
  state           String   @default("queued")  // queued/dispatched/running/completed/failed
  instruction     String               // AI 执行指令
  events          String?              // ⚠️ 所有事件追加到一个 JSON 字段
  // ... 其他字段
  @@index([state])
}

model CodeswarmWorker {
  id            String   @id
  nodeId        String   @unique
  status        String   @default("online")
  maxConcurrent Int      @default(5)
  currentTasks  Int      @default(0)   // ⚠️ 由心跳上报和回调分别更新，容易不一致
  lastHeartbeat DateTime @default(now())
}
```

---

## 二、为什么需要改

### 2.1 当前架构在 50-100 Worker 下的瓶颈

| # | 瓶颈 | 具体表现 | 严重程度 |
|---|------|---------|---------|
| 1 | **心跳风暴** | 100 Worker × 每 30s = **~3 次/s** DB upsert 打同一张 `CodeswarmWorker` 表 | 🟡 中等 |
| 2 | **出队延迟 30 秒** | Worker 完成任务后，排队任务要等下一次心跳才被分发，最坏 30 秒空转 | 🔴 严重 |
| 3 | **分发 O(N) 全表扫描** | `dispatchQueuedTasks()` 每次 `findMany` 所有 Worker 排序，100 行排序 | 🟡 中等 |
| 4 | **Task Builder 轮询风暴** | 每个任务每 2s 查 DB × 600 次，50 个并发任务 = **25 次/s** DB 查询 | 🔴 严重 |
| 5 | **事件 JSON 爆炸** | 大任务上千事件，每次追加读-改-写全量 JSON，`events` 字段可达数 MB | 🟡 中等 |
| 6 | **无任务重调度** | Worker 掉线后其任务状态永远卡在 `dispatched`/`running` | 🔴 严重 |
| 7 | **回调无认证** | `/api/codeswarm/worker/*` 无 JWT 校验，数十 Worker 暴露在网络上 | 🔴 严重 |
| 8 | **currentTasks 不一致** | 心跳上报 + 分发/完成回调分别更新同一字段，竞争条件导致计数漂移 | 🟡 中等 |

### 2.2 量化对比

| 指标 | 当前（10 Worker） | 当前（50-100 Worker） | 改造后（50-100 Worker） |
|------|-------------------|----------------------|------------------------|
| 心跳 DB 写入 | 0.3 次/s | 2-3 次/s | 2-3 次/s（异步，不阻塞） |
| 任务出队延迟 | 最坏 30s | 最坏 30s | **毫秒级** |
| 分发 Worker 查询 | 每次 10 行排序 | 每次 50-100 行排序 | **内存 Map O(1)** |
| Task Builder DB 查询 | 每 2s × 任务数 | **25-50 次/s** | **1 次 Redis 订阅/任务** |
| 任务完成→下次分发 | 30s 空转 | 30s 空转 | **立即（<100ms）** |
| Worker 掉线恢复 | 永久卡住 | 永久卡住 | **90s 自动重调度** |

---

## 三、改造方案

### 3.1 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        改造后架构                                 │
│                                                                  │
│  用户/Task Builder                                               │
│  ┌─────────────┐                                                 │
│  │ POST /tasks  │───> 写 DB(state=queued) + XADD Redis Stream   │
│  └─────────────┘            │                                    │
│                              ▼                                    │
│                    ┌──────────────────┐                           │
│                    │  Redis Stream     │  ← 任务队列               │
│                    │  task:queue       │                           │
│                    └────────┬─────────┘                           │
│                             │ XREADGROUP 阻塞消费                 │
│                             ▼                                     │
│                    ┌──────────────────┐                           │
│                    │  CodeswarmDispatcher │ ← 内存 Worker 拓扑     │
│                    │  (调度服务)         │    Map<nodeId, Info>    │
│                    └────────┬─────────┘                           │
│                             │ HTTP POST /task                     │
│              ┌──────────────┼──────────────┐                      │
│              ▼              ▼              ▼                      │
│        ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│        │ Worker 1 │  │ Worker 2 │  │ Worker N │                  │
│        └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│             │              │             │                         │
│             ▼              ▼             ▼                         │
│        ┌──────────────────────────────────────┐                   │
│        │   Redis Pub/Sub (事件通道)             │                   │
│        │   task:events:{taskId}               │                   │
│        └──────────────┬───────────────────────┘                   │
│                       │                                          │
│              ┌────────┴────────┐                                  │
│              ▼                 ▼                                  │
│     实时推送(Task Builder)  异步批量写 DB                           │
│     Redis SUBSCRIBE      CodeswarmEvent 表                        │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 核心变化

| 组件 | 改造前 | 改造后 |
|------|--------|--------|
| 任务队列 | DB `state='queued'` 行 | **Redis Stream** `task:queue` |
| Worker 拓扑 | 每次查 DB `findMany` | **内存 Map**（心跳更新） |
| 出队机制 | 心跳触发 `dispatchQueuedTasks()` | **Redis 消费循环**（阻塞读取） |
| 任务完成触发 | 无（等心跳） | **立即推送**下一个排队任务 |
| 事件存储 | 单 JSON 字段读-改-写 | **独立表**逐行 INSERT + Redis Pub/Sub |
| Task Builder 轮询 | 每 2s 查 DB | **Redis 订阅**实时推送 |
| currentTasks | 心跳上报 + 回调分别更新 | **编排器自己追踪**（分发+1，完成-1） |

---

## 四、分阶段实施计划

### Phase 1：基础架构改造（Redis 引入 + 调度解耦）

#### 1.1 新增调度服务

**新建文件**: `src/services/codeswarm-dispatcher.ts`

```typescript
class CodeswarmDispatcher {
  private workers = new Map<string, WorkerInfo>();  // 内存 Worker 拓扑
  private redis: Redis;
  private running = false;

  // 提交任务 → XADD Redis Stream
  async submitTask(task: TaskRequest): Promise<string>;

  // 消费循环：XREADGROUP 阻塞读取 → selectWorker → HTTP POST 推送
  async startDispatchLoop(): Promise<void>;

  // Worker 心跳：更新内存拓扑 + 异步 upsert DB
  onHeartbeat(nodeId: string, info: WorkerHeartbeat): void;

  // 任务完成：释放 Worker 槽位 → 立即检查排队任务
  onTaskCompleted(taskId: string, nodeId: string): void;

  // 编排器重启时：从 DB 加载所有 Worker 重建内存拓扑
  async recoverFromDB(): Promise<void>;

  // 获取有容量的 Worker（内存操作，O(N) 但 N 是在线节点数）
  private selectWorker(): WorkerInfo | null;
}
```

**关键设计**：
- Worker 拓扑在**内存**中维护，心跳更新，不阻塞响应
- `currentTasks` 由编排器自己追踪（分发 +1，完成 -1），不依赖 Worker 上报，消除不一致
- DB 仍然持久化 Worker 记录（异步写入），用于页面展示
- 编排器重启时从 DB 加载 Worker 重建内存拓扑

#### 1.2 改造心跳端点

**修改文件**: `src/app/api/codeswarm/worker/heartbeat/route.ts`

```
改动前：upsert DB → dispatchQueuedTasks()（查 DB 排队任务 + 查 DB Worker）
改动后：dispatcher.onHeartbeat()（更新内存）→ 异步 upsert DB
```

心跳不再触发调度，仅更新状态。调度由 Redis 消费循环驱动。

#### 1.3 改造任务创建端点

**修改文件**: `src/app/api/codeswarm/tasks/route.ts`

```
改动前：查 DB 找空闲 Worker → 有则直接分发，无则写入 DB state=queued
改动后：写入 DB state=queued → XADD 到 Redis Stream → 立即返回
```

任务创建与分发完全解耦。创建只负责入队，分发由消费循环异步处理。

#### 1.4 改造结果回调端点

**修改文件**: `src/app/api/codeswarm/worker/result/route.ts`

```
改动前：更新 DB 任务状态 → Worker currentTasks -1
改动后：更新 DB 任务状态 → dispatcher.onTaskCompleted()（释放槽位 → 立即检查排队任务）
```

任务完成时**立即触发**下一个排队任务分发，消除 30 秒空转。

#### 1.5 改造 Task Builder 集成

**修改文件**: `src/app/api/task-builder/tasks/[id]/execute/route.ts`

```
改动前：pollCodeswarmTask() 每 2s 查 DB（最多 600 次 = 1200 次 DB 查询/任务）
改动后：Redis SUBSCRIBE task:events:{taskId}，实时接收状态变更
```

每个任务从 600 次 DB 查询降为 1 次 Redis 订阅 + 1 次 DB 最终读取。

#### 1.6 环境变量

**修改文件**: `.env`

```bash
REDIS_URL="redis://localhost:6379"
```

#### 1.7 启动入口

**修改文件**: `instrumentation.ts`

编排器启动时初始化 `CodeswarmDispatcher`，启动消费循环：
```typescript
const dispatcher = new CodeswarmDispatcher(redis);
await dispatcher.recoverFromDB();
dispatcher.startDispatchLoop(); // 后台运行
```

---

### Phase 2：事件管道改造

#### 2.1 新增事件表

**修改文件**: `prisma/schema.prisma`

```prisma
model CodeswarmEvent {
  id        String   @id @default(cuid())
  taskId    String   // 关联 CodeswarmTask.taskId（逻辑外键）
  type      String   // agent_message_chunk | tool_call | tool_call_update | error
  data      String   // JSON 事件数据
  createdAt DateTime @default(now())

  @@index([taskId])
  @@index([taskId, createdAt])
}
```

#### 2.2 改造事件回调

**修改文件**: `src/app/api/codeswarm/worker/event/route.ts`

```
改动前：读取 events JSON → JSON.parse → 追加 → JSON.stringify → 写回
改动后：INSERT INTO "CodeswarmEvent" + Redis PUBLISH task:events:{taskId}
```

事件逐行插入（批量 INSERT 优化），同时通过 Redis Pub/Sub 实时推送。

`CodeswarmTask.events` 字段保留但不再写入（兼容旧数据读取）。

---

### Phase 3：健壮性增强

#### 3.1 Worker 掉线检测 + 任务重调度

**修改文件**: `src/services/codeswarm-dispatcher.ts`

- 定时器每 60 秒扫描 `lastHeartbeat` 超过 90 秒的 Worker → 标记 `offline`
- 将该 Worker 上 `state ∈ (dispatched, running)` 的任务 → 改回 `queued` + 重新 XADD Redis Stream
- 尽力通知 Worker 取消：`POST http://{worker.address}/task/{taskId}/cancel`

#### 3.2 任务超时处理

**修改文件**: `src/services/codeswarm-dispatcher.ts`

- 任务创建时将 `timeoutSec` 写入 Redis 有序集合 `task:timeouts`（score = 截止时间戳）
- 定时器每 30 秒 `ZRANGEBYSCORE` 查超时任务 → 标记 `failed` → 通知 Worker 取消

#### 3.3 回调接口认证

**修改文件**: 所有 `src/app/api/codeswarm/worker/*` 路由

- Worker 首次心跳时分配 `workerToken`（JWT，含 nodeId），写入 DB `CodeswarmWorker.token` 字段
- 回调接口校验 `Authorization: Bearer {workerToken}`
- 心跳时自动续期 token

#### 3.4 DB Schema 变更

**修改文件**: `prisma/schema.prisma`

```prisma
model CodeswarmWorker {
  // ... 现有字段 ...
  token  String?   // Worker 认证令牌
}
```

---

## 五、文件变更总览

| 阶段 | 文件 | 操作 | 复杂度 |
|------|------|------|--------|
| 1.1 | `src/services/codeswarm-dispatcher.ts` | **新建** | 高 |
| 1.2 | `src/app/api/codeswarm/worker/heartbeat/route.ts` | 改造 | 低 |
| 1.3 | `src/app/api/codeswarm/tasks/route.ts` | 改造 | 中 |
| 1.4 | `src/app/api/codeswarm/worker/result/route.ts` | 改造 | 低 |
| 1.5 | `src/app/api/task-builder/tasks/[id]/execute/route.ts` | 改造 | 中 |
| 1.6 | `.env` | 修改 | 低 |
| 1.7 | `instrumentation.ts` | 修改 | 低 |
| 2.1 | `prisma/schema.prisma` | 修改 | 低 |
| 2.2 | `src/app/api/codeswarm/worker/event/route.ts` | 改造 | 中 |
| 3.1-3.3 | `src/services/codeswarm-dispatcher.ts` | 扩展 | 中 |
| 3.4 | `prisma/schema.prisma` | 修改 | 低 |

### 依赖

- `ioredis` — Redis 客户端
- 部署 Redis 实例（用户确认可以部署）

---

## 六、验证方式

1. **功能测试**: 启动 1 个 Worker + 编排器，提交任务 → 验证正常完成
2. **出队延迟测试**: Worker 满载时提交任务 → 验证 Worker 完成当前任务后**立即**收到下一个（不再等 30s 心跳）
3. **故障测试**: 强制 kill Worker → 验证 90 秒内任务自动重调度到其他 Worker
4. **压力测试**: 模拟 100 Worker 心跳 + 50 并发任务，观察 Redis 和 DB 的 QPS
5. **前端验证**: Dashboard CodeSwarm 页面正常显示任务状态、Worker 列表、事件流
6. **回退测试**: 停掉 Redis → 验证系统降级为 DB 轮询模式

---

## 七、风险与回退

| 风险 | 应对策略 |
|------|---------|
| Redis 不可用 | 代码中保留 DB 轮询 fallback 路径，Redis 连接失败时自动降级 |
| 编排器重启丢失内存拓扑 | 启动时从 DB 加载 Worker 重建；Redis Stream 中未消费的任务不丢失 |
| Redis Stream 消息堆积 | 设置 MAXLEN 限制队列长度；消费失败的消息进死信队列 |
| 数据双写一致性 | 以 DB 为准，Redis 仅做调度通道；任务状态最终由 DB 持久化 |
| 向后兼容 | Worker 端无需改动（仍是 HTTP POST /task 接收任务）；前端 API 接口不变 |
