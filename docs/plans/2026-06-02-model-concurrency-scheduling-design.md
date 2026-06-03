# 任务模型并发智能调度设计方案

## 背景

当前模型资源池由人工问答和自动化扫描任务共同使用。工作日白天人工问答请求较多，模型资源紧张；夜间和周末人工问答请求较少，模型资源空闲，自动化扫描任务应尽量提高吞吐以利用空闲容量。

现有系统主要控制 Worker 侧并发，例如 Worker 节点 `MAX_CONCURRENT` 和任务执行 semaphore，但缺少按模型、API Key、网关通道维度的并发控制。任务调用模型时通常使用共享模型配置，难以做到单任务隔离、按任务追踪成本、按时段动态调整并发。

本方案第一版不在平台侧实现复杂请求级调度，而是利用 LiteLLM Proxy 的 Virtual Key 并发限制能力：每个自动化任务实例动态生成一个任务专属 Virtual Key，并按固定日夜策略修改该 Key 的 `max_parallel_requests` 和 `rpm_limit`。这样可以用较小改动实现自动化扫描资源池的基础动态调度，并为后续实时自适应调度保留数据和控制点。

## 目标

### 第一版目标

- 每个自动化任务实例绑定一个 LiteLLM 任务专属 Virtual Key。
- 工作日白天降低自动化扫描任务并发。
- 工作日夜间提高自动化扫描任务并发。
- 周末全天按夜间策略处理。
- 任务运行中遇到时段切换时，自动同步任务 Key 的 LiteLLM 并发限制。
- 任务结束后禁用任务专属 Key，保留审计记录。
- 采集请求量、429、延迟、任务队列等指标，为后续自适应调度做准备。

### 非目标

- 第一版不做人机请求统一队列。
- 第一版不做实时负载预测。
- 第一版不做多时段复杂排班。
- 第一版不做按租户、项目、模型的精细化差异策略。

### 长期目标

最终将固定日夜策略演进为实时负载自适应调度，根据人工问答负载、扫描队列长度、429 率、P95 延迟、成功率、模型通道健康度等指标动态调整自动化扫描任务并发。

## 核心决策

采用"任务实例级 LiteLLM Virtual Key + 固定日夜并发策略"。

平台负责：

- 创建任务专属 Key（`POST /key/generate`）。
- 计算当前时段对应的扫描并发上限。
- 将任务 Key 注入 Worker。
- 在时段切换后同步 LiteLLM Key 并发（`POST /key/update`）。
- 任务结束后禁用 Key（`POST /key/block`）。
- 记录审计和指标。

LiteLLM Proxy 负责：

- 真实模型请求转发和负载均衡。
- 按 Virtual Key 执行 `max_parallel_requests`、`rpm_limit`、`tpm_limit` 限制。
- 统计 Key 级别调用量、Token 用量和费用。
- Dynamic TPM/RPM Allocation（按活跃 Key 数量动态分配配额）。

选择该方案的原因：

- 改动小，不需要平台接管所有模型请求。
- 与现有 Worker 并发控制互补，不冲突。
- 每个任务独立 Key，隔离和回收清晰。
- 可以按任务维度审计调用量和成本。
- LiteLLM 原生支持 `max_parallel_requests`、`rpm_limit`、`tpm_limit`，无需平台自行实现限流。
- LiteLLM 支持 Priority Reservation，天然适配"人工问答高优先、自动化扫描低优先"的需求。
- 后续可以把固定并发值替换为自适应算法输出。

## 资源池模型

逻辑上将模型资源拆成两个池：

- 人工问答池：用户直接使用模型问答、聊天、交互式编码等实时请求。
- 自动化扫描池：后台安全扫描、AgentHarness、CodeSwarm 等自动化任务请求。

第一版只控制自动化扫描池。人工问答池继续使用原有 Key 或通道配置，不受任务 Key 调度影响。人工问答 Key 和自动化扫描 Key 的优先级隔离通过 LiteLLM Priority Reservation 实现。

固定日夜策略：

- 工作日白天：自动化扫描任务使用低并发。
- 工作日夜间：自动化扫描任务使用高并发。
- 周末：全天使用夜间高并发。

示例配置：

```ts
{
  litellmProxyUrl: 'http://litellm:4000',
  litellmMasterKey: 'sk-xxx',
  dayStartTime: '08:00',
  dayEndTime: '20:00',
  scanDayConcurrency: 2,    // max_parallel_requests
  scanDayRpm: 10,            // rpm_limit
  scanNightConcurrency: 8,
  scanNightRpm: 60,
  weekendUsesNightPolicy: true,
  syncIntervalMinutes: 10,
  keyRetentionDays: 7
}
```

## 数据模型

建议新增 `TaskModelApiKey` 表，避免将 Virtual Key 生命周期直接塞进 `TaskInstance`。

任务实例和模型凭证的生命周期不同：任务结束后，Key 应立即禁用，但仍需要保留一段时间用于审计、费用核对和问题追踪。

核心字段：

```ts
type TaskModelApiKey = {
  id: string
  taskInstanceId: string
  litellmKeyId: string              // LiteLLM Virtual Key hash（用于 update/block/info）
  apiKeyEncrypted: string           // 任务专属 API Key 的加密值（sk-xxx）
  litellmProxyUrl: string           // 任务请求使用的 LiteLLM Proxy 地址
  model: string
  poolType: 'manual' | 'scan'
  maxParallelRequests: number       // 当前已同步的并发上限
  rpmLimit: number                  // 当前已同步的 RPM 上限
  status: 'active' | 'disabled' | 'deleted' | 'sync-failed'
  createdAt: Date
  disabledAt?: Date
  deletedAt?: Date
  lastSyncedAt?: Date
  lastSyncError?: string
}
```

字段说明：

- `taskInstanceId`：绑定单个任务实例。
- `litellmKeyId`：LiteLLM 中的 Key hash，用于更新并发、禁用和查询统计。
- `apiKeyEncrypted`：任务专属 Virtual Key 的加密值（`sk-xxx` 格式），只在 Dispatcher 下发 Worker 时解密。
- `litellmProxyUrl`：任务请求使用的 LiteLLM Proxy 地址。
- `model`：任务使用的模型。
- `poolType`：资源池类型，第一版自动化任务使用 `scan`。
- `maxParallelRequests`：当前已同步到 LiteLLM 的并发上限。
- `rpmLimit`：当前已同步到 LiteLLM 的 RPM 上限。
- `status`：本地记录的 Key 生命周期状态。
- `lastSyncError`：同步失败原因，用于后台重试和告警。

配置项可先放系统配置表或环境变量：

```ts
type ModelSchedulingConfig = {
  litellmProxyUrl: string
  litellmMasterKey: string
  dayStartTime: string
  dayEndTime: string
  scanDayConcurrency: number
  scanDayRpm: number
  scanNightConcurrency: number
  scanNightRpm: number
  syncIntervalMinutes: number
  keyRetentionDays: number
}
```

## 运行流程

### 任务启动流程

自动化扫描任务进入可执行状态后，Dispatcher 在投递 Worker 前创建任务专属 Key。

```text
TaskInstance created
  ↓
Dispatcher prepares task
  ↓
Calculate current policy: day or night
  ↓
Call LiteLLM POST /key/generate (with max_parallel_requests, rpm_limit, models, duration)
  ↓
Save TaskModelApiKey
  ↓
Inject task Key + litellmProxyUrl into Worker
  ↓
Worker calls model via LiteLLM Proxy
```

步骤说明：

1. 读取任务需要的 `model` 和 LiteLLM Proxy 配置。
2. 判断当前时段（要以东八区时间为准）：
   - 周一到周五，`08:00-20:00` 为白天。
   - 周一到周五，其余时间为夜间。
   - 周六、周日全天按夜间。
3. 根据时段计算扫描任务并发：
   - 白天使用 `scanDayConcurrency` + `scanDayRpm`。
   - 夜间和周末使用 `scanNightConcurrency` + `scanNightRpm`。
4. 调用 LiteLLM `POST /key/generate`，设置 `max_parallel_requests`、`rpm_limit`、`models`、`duration`。
5. 写入 `TaskModelApiKey`。
6. 将任务专属 Key、LiteLLM Proxy URL、model 注入 Worker。
7. Worker 使用任务专属 Key 调用 LiteLLM Proxy。

### 时段切换流程

平台启动定时同步任务，例如每 10 分钟执行一次。

```text
Find active TaskModelApiKey records
  ↓
Check whether TaskInstance is still running
  ↓
Calculate expected concurrency + rpm
  ↓
If changed, call LiteLLM POST /key/update
  ↓
Update local maxParallelRequests / rpmLimit / lastSyncedAt
```

同步规则：

1. 查询所有 `status=active` 且任务仍在运行中的 `TaskModelApiKey`。
2. 重新计算当前时段对应的并发值和 RPM。
3. 如果本地 `maxParallelRequests` 或 `rpmLimit` 与期望值不同，调用 LiteLLM `POST /key/update`。
4. 更新 `maxParallelRequests`、`rpmLimit` 和 `lastSyncedAt`。
5. 如果更新失败，记录 `lastSyncError`，下一轮继续重试。

白天切换到夜间时，运行中的扫描任务会逐步获得更高并发。夜间切换到白天时，LiteLLM 会降低任务 Key 的并发和 RPM 限制，平台不强行中断 Worker。

### 任务结束流程

任务成功、失败、取消或超时后，平台禁用任务专属 Key。

```text
Task succeeds / fails / cancels / times out
  ↓
Call LiteLLM POST /key/block
  ↓
Update TaskModelApiKey.status = disabled
  ↓
Keep audit data
  ↓
Cleanup job deletes archived keys after retention period
```

处理规则：

1. 调用 LiteLLM `POST /key/block` 禁用该任务 Key。
2. 更新 `status=disabled` 和 `disabledAt`。
3. 保留审计数据。
4. 后台清理任务在保留期后调用 `DELETE /key/delete` 删除 Key。

## LiteLLM 服务封装

建议新增一个薄封装服务，例如 `LiteLLMKeyService`。Dispatcher、并发同步任务、Key 清理任务都通过该服务访问 LiteLLM Proxy API，避免业务代码散落接口细节。

建议接口：

```ts
type CreateTaskKeyInput = {
  taskInstanceId: string
  model: string
  maxParallelRequests: number
  rpmLimit: number
  duration?: string              // Key 有效期，如 '7d'
}

type CreateTaskKeyResult = {
  key: string                    // sk-xxx 格式的 Virtual Key
}

type KeyInfo = {
  spend: number
  models: string[]
  maxParallelRequests: number
  rpmLimit: number
  tpmLimit: number
  expires: string
  metadata: Record<string, unknown>
}

interface LiteLLMKeyService {
  createTaskKey(input: CreateTaskKeyInput): Promise<CreateTaskKeyResult>
  updateLimits(key: string, maxParallelRequests: number, rpmLimit: number): Promise<void>
  blockKey(key: string): Promise<void>
  deleteKey(key: string): Promise<void>
  getKeyInfo(key: string): Promise<KeyInfo>
}
```

能力说明：

- `createTaskKey`：调用 `POST /key/generate`，设置 `max_parallel_requests`、`rpm_limit`、`models`、`duration`。
- `updateLimits`：调用 `POST /key/update`，时段变化时更新 active Key 的并发和 RPM 限制。
- `blockKey`：调用 `POST /key/block`，任务结束后立即禁用 Key。
- `deleteKey`：调用 `DELETE /key/delete`，清理保留期已过的 disabled Key。
- `getKeyInfo`：调用 `GET /key/info`，查询 Key 花费和使用统计。

安全边界：

- Worker 不应该拿到平台共享模型 Key（`litellmMasterKey`）。
- Worker 只拿到任务专属 Key。
- 即使 Worker 日志泄漏 Key，影响范围也被限制在单个任务。
- 任务结束后 Key 会被禁用，降低长期泄漏风险。

## 失败策略

### 创建 Key 失败

任务不投递 Worker。

可选处理：

- 标记任务失败，错误为"模型任务凭证创建失败"。
- 或保持 pending，等待调度器下一轮重试。

第一版建议失败后保留明确错误，避免任务在没有有效模型凭证的情况下启动。

### 更新并发失败

不中断任务。

处理方式：

- 记录 `lastSyncError`。
- 保持本地状态为 `sync-failed` 或保留 active 并记录错误。
- 下一轮同步任务继续重试。

原因：并发同步失败只影响资源调度精度，不一定代表任务无法继续执行。

### 禁用 Key 失败

这是安全风险，需要后台持续重试并告警。

处理方式：

- 标记为待禁用或 `sync-failed`。
- 记录错误。
- 清理任务或补偿任务继续调用 `blockKey`。
- 必要时触发告警。

### 删除 Key 失败

只影响清理，不影响任务状态。

处理方式：

- 记录错误。
- 下一轮清理任务继续重试。

## 指标采集

第一版虽然不做实时自适应，但必须从第一天开始采集指标，为后续升级做基础。

### 指标来源

指标来自两个位置，职责不同：

| 来源 | 指标 | 采集方式 |
|------|------|---------|
| LiteLLM Proxy API (`GET /key/info`) | 请求数、Token 用量、估算成本（USD spend） | 主动拉取，按 Key 粒度 |
| 平台侧本地 | 任务队列长度、任务运行时长、并发限制值、时段、Worker 负载 | 采集时机嵌入调度流程 |

**关于延迟指标**：LiteLLM `GET /key/info` 不直接暴露 P95 延迟。第一版建议在 Worker 侧记录每次模型调用的耗时（开始时间、结束时间），通过任务事件或任务完成回调上报到平台，平台侧自行计算 avg 和 P95。如果 Worker 侧接入成本高，可以推迟到阶段 2，第一版只采集 LiteLLM 侧的基础计数类指标。

### 数据模型

新增两张表：

#### `TaskModelKeyMetrics`：任务级别 Key 调用统计

每个任务结束时写入一条（任务级快照），定时批采时做增量更新。

```ts
type TaskModelKeyMetrics = {
  id: string
  taskInstanceId: string
  taskModelApiKeyId: string
  model: string
  period: 'day' | 'night' | 'weekend'   // 任务创建时所在时段
  maxParallelRequests: number            // 任务生命周期内最后生效的并发上限
  rpmLimit: number                       // 任务生命周期内最后生效的 RPM 上限
  requestCount: number
  successCount: number
  failCount: number
  rateLimitCount: number                 // 429 次数
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number               // 来自 LiteLLM spend（USD）
  avgLatencyMs: number | null            // 来自 Worker 上报，null 表示未采集
  p95LatencyMs: number | null
  taskDurationMs: number | null          // 任务实际运行时长（startedAt → completedAt）
  windowStart: Date                      // 统计窗口开始
  windowEnd: Date                        // 统计窗口结束（快照时间）
  createdAt: Date
}
```

#### `SchedulingMetricsSnapshot`：系统级调度快照

每次并发同步任务执行时（每 10 分钟），写入一条系统级快照。用于回答"当时整体负载如何"。

```ts
type SchedulingMetricsSnapshot = {
  id: string
  sampledAt: Date
  period: 'day' | 'night' | 'weekend'
  queueLength: number               // 当前 queued 状态的自动化扫描任务数
  activeTaskCount: number           // 当前 running 状态的自动化扫描任务数
  activeKeyCount: number            // 当前 active TaskModelApiKey 数
  totalMaxParallelRequests: number  // 所有 active Key 并发上限之和
  totalRpmLimit: number             // 所有 active Key RPM 上限之和
  periodRateLimitCount: number      // 近一个采集周期内 429 总数
  periodRequestCount: number        // 近一个采集周期内请求总数
}
```

### 采集时机

#### 1. 任务结束时快照

触发点：任务状态变为 `completed`、`failed`、`cancelled`、`timeout` 时，在禁用 Key 之前。

步骤：
1. 调用 `LiteLLMKeyService.getKeyInfo(key)` 拉取该 Key 从创建到当前的累计统计。
2. 结合平台本地数据（`TaskInstance.startedAt`、`completedAt`、`maxParallelRequests`、`rpmLimit`）。
3. 写入 `TaskModelKeyMetrics`。

```ts
// 伪代码，在任务结束处理中
const info = await litellmKeyService.getKeyInfo(taskModelApiKey.apiKeyEncrypted);
await prisma.taskModelKeyMetrics.create({
  data: {
    taskInstanceId,
    taskModelApiKeyId: taskModelApiKey.id,
    model: taskModelApiKey.model,
    period: getCurrentPeriod(),
    maxParallelRequests: taskModelApiKey.maxParallelRequests,
    rpmLimit: taskModelApiKey.rpmLimit,
    requestCount: info.requestCount ?? 0,
    estimatedCostUsd: info.spend,
    taskDurationMs: taskInstance.completedAt && taskInstance.startedAt
      ? taskInstance.completedAt.getTime() - taskInstance.startedAt.getTime()
      : null,
    windowStart: taskModelApiKey.createdAt,
    windowEnd: new Date(),
  },
});
```

#### 2. 并发同步任务（每 10 分钟）顺带采集系统快照

并发同步任务在更新 Key 并发之后，顺带：
1. 拉取所有 active Key 的 `getKeyInfo` 统计。
2. 统计当前队列长度和活跃任务数。
3. 写入一条 `SchedulingMetricsSnapshot`。

这条快照用于回答"调度系统整体状态随时间的变化趋势"，不依赖任务结束事件。

#### 3. 调度时点采集队列长度

在 Dispatcher 每次执行分发逻辑时，记录当前队列长度到日志（不单独写 DB，日志中已有时间戳）。队列长度的精确统计在上述定时快照中完成。

### 数据保留策略

| 表 | 保留时长 | 清理方式 |
|---|---------|---------|
| `TaskModelKeyMetrics` | 与 `TaskModelApiKey` 保留期一致，默认 30 天 | 定时任务按 `createdAt` 删除 |
| `SchedulingMetricsSnapshot` | 30 天 | 定时任务按 `sampledAt` 删除 |

保留期通过系统配置 `metricsRetentionDays` 控制。

### 用途与查询入口

这些指标回答的问题：

| 问题 | 数据来源 |
|------|---------|
| 白天扫描是否抢占了人工问答资源 | `SchedulingMetricsSnapshot` 的 `periodRateLimitCount` 趋势 |
| 夜间并发是否配置过低，任务积压 | `SchedulingMetricsSnapshot` 的 `queueLength` 趋势 |
| 某模型/通道是否频繁 429 | `TaskModelKeyMetrics` 按 `model` 聚合 `rateLimitCount` |
| 单任务成本是否合理 | `TaskModelKeyMetrics.estimatedCostUsd` |
| 自动化任务平均耗时 | `TaskModelKeyMetrics.taskDurationMs` 分布 |
| 阶段 2 自适应输入 | 读取最近 N 条 `SchedulingMetricsSnapshot` 计算趋势 |

第一版只写入数据，不建查询 API。等积累了 2-4 周数据后，再基于实际分布决定自适应规则的阈值。

## LiteLLM Priority Reservation（后续利用）

LiteLLM 支持 Priority Reservation，可以为不同类型的 Key 分配不同优先级。这天然适配我们的资源池模型：

```yaml
# config.yaml
litellm_settings:
  callbacks: ["dynamic_rate_limiter_v3"]
  priority_reservation:
    "manual": 0.8    # 人工问答池保留 80% 容量
    "scan": 0.2      # 自动化扫描池保留 20% 容量
  priority_reservation_settings:
    default_priority: 0    # 未标记的 Key 不分配容量
    saturation_threshold: 0.5
```

创建 Key 时通过 `metadata: { "priority": "scan" }` 标记优先级。

第一版不启用此功能，待积累数据后根据实际情况配置比例。

## 演进路径

### 阶段 1：固定日夜策略

当前方案。

```text
工作日白天 → 扫描低并发 + 低 RPM
工作日夜间/周末 → 扫描高并发 + 高 RPM
```

特点：

- 简单。
- 可控。
- 风险低。
- 依赖 LiteLLM Proxy 做真实限流。

### 阶段 2：规则型自适应 + Priority Reservation

在固定日夜策略基础上引入简单反馈规则和 LiteLLM Priority Reservation。

示例：

```text
如果 429 率升高 → 降低扫描并发
如果 P95 延迟升高 → 降低扫描并发
如果扫描队列很长且错误率低 → 提高扫描并发
如果人工问答请求量升高 → 降低扫描并发
启用 Priority Reservation → 人工问答 Key 自动抢占扫描 Key 容量
```

该阶段仍然保持可解释，不引入复杂预测模型。

### 阶段 3：实时负载自适应

最终目标是将固定并发值替换为动态计算结果。

```text
目标并发 = f(
  人工问答负载,
  扫描队列长度,
  429 率,
  P95 延迟,
  成功率,
  当前时段,
  模型通道健康度
)
```

目标是自动逼近以下状态：

- 模型资源利用率最大化。
- 人工问答体验稳定。
- 自动化扫描吞吐最大。
- 429 和超时处于可控范围。

## 推荐实施步骤

1. 部署 LiteLLM Proxy（Docker），配置 `config.yaml` 和 PostgreSQL 数据库。
2. 迁移现有模型通道到 LiteLLM（从 newapi 或直连迁移）。
3. 新增 `TaskModelApiKey` 表。
4. 封装 `LiteLLMKeyService`。
5. 新增日夜策略函数。
6. 在 Dispatcher 投递任务前创建任务专属 Key。
7. Worker 改为使用任务专属 Key + LiteLLM Proxy URL。
8. 新增并发同步定时任务。
9. 在任务成功、失败、取消、超时时禁用 Key。
10. 新增 Key 清理任务。
11. 新增基础指标采集。
12. 后续再演进到 Priority Reservation 和实时负载自适应。

## 验证方式

第一版实现完成后，需要从前端完整验证自动化任务链路，不使用 curl 或 Postman。

前端操作步骤：

1. 打开自动化扫描任务创建页面，创建一个使用模型的扫描任务。
2. 启动任务，确认任务进入运行状态。
3. 在任务详情或日志中确认 Worker 使用任务专属 LiteLLM Virtual Key。
4. 在 LiteLLM Admin UI 确认该任务 Key 已创建，`max_parallel_requests` 和 `rpm_limit` 符合当前时段策略。
5. 调整系统时间或配置触发日夜策略变化，等待同步任务执行。
6. 在 LiteLLM Admin UI 确认该任务 Key 的并发和 RPM 被更新。
7. 等待任务完成或手动取消任务。
8. 在 LiteLLM Admin UI 确认该任务 Key 已被禁用。
9. 在平台任务详情或审计记录中确认保留了 Key 绑定、并发、调用量和错误信息。
