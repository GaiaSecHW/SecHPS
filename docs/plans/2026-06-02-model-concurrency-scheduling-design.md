# 任务模型并发智能调度设计方案

## 背景

当前模型资源池由人工问答和自动化扫描任务共同使用。工作日白天人工问答请求较多，模型资源紧张；夜间和周末人工问答请求较少，模型资源空闲，自动化扫描任务应尽量提高吞吐以利用空闲容量。

现有系统主要控制 Worker 侧并发，例如 Worker 节点 `MAX_CONCURRENT` 和任务执行 semaphore，但缺少按模型、API Key、newapi 网关通道维度的并发控制。任务调用模型时通常使用共享模型配置，难以做到单任务隔离、按任务追踪成本、按时段动态调整并发。

本方案第一版不在平台侧实现复杂请求级调度，而是利用 newapi 网关的 API Key 并发限制能力：每个自动化任务实例动态生成一个任务专属 API Key，并按固定日夜策略修改该 Key 的并发数。这样可以用较小改动实现自动化扫描资源池的基础动态调度，并为后续实时自适应调度保留数据和控制点。

## 目标

### 第一版目标

- 每个自动化任务实例绑定一个 newapi 任务专属 API Key。
- 工作日白天降低自动化扫描任务并发。
- 工作日夜间提高自动化扫描任务并发。
- 周末全天按夜间策略处理。
- 任务运行中遇到时段切换时，自动同步任务 Key 的 newapi 并发限制。
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

采用“任务实例级 newapi API Key + 固定日夜并发策略”。

平台负责：

- 创建任务专属 Key。
- 计算当前时段对应的扫描并发上限。
- 将任务 Key 注入 Worker。
- 在时段切换后同步 newapi Key 并发。
- 任务结束后禁用 Key。
- 记录审计和指标。

newapi 网关负责：

- 真实模型请求转发。
- 按 API Key 执行并发限制。
- 统计 Key 级别调用量、错误和费用。

选择该方案的原因：

- 改动小，不需要平台接管所有模型请求。
- 与现有 Worker 并发控制互补，不冲突。
- 每个任务独立 Key，隔离和回收清晰。
- 可以按任务维度审计调用量和成本。
- 后续可以把固定并发值替换为自适应算法输出。

## 资源池模型

逻辑上将模型资源拆成两个池：

- 人工问答池：用户直接使用模型问答、聊天、交互式编码等实时请求。
- 自动化扫描池：后台安全扫描、AgentHarness、CodeSwarm 等自动化任务请求。

第一版只控制自动化扫描池。人工问答池继续使用原有人工请求 Key 或通道配置，不受任务 Key 调度影响。

固定日夜策略：

- 工作日白天：自动化扫描任务使用低并发。
- 工作日夜间：自动化扫描任务使用高并发。
- 周末：全天使用夜间高并发。

示例配置：

```ts
{
  dayStartTime: '08:00',
  dayEndTime: '20:00',
  scanDayConcurrency: 2,
  scanNightConcurrency: 8,
  weekendUsesNightPolicy: true,
  syncIntervalMinutes: 10,
  keyRetentionDays: 7
}
```

## 数据模型

建议新增 `TaskModelApiKey` 表，避免将 newapi Key 生命周期直接塞进 `TaskInstance`。

任务实例和模型凭证的生命周期不同：任务结束后，Key 应立即禁用，但仍需要保留一段时间用于审计、费用核对和问题追踪。

核心字段：

```ts
type TaskModelApiKey = {
  id: string
  taskInstanceId: string
  newapiKeyId: string
  apiKeyEncrypted: string
  apiBaseUrl: string
  model: string
  poolType: 'manual' | 'scan'
  concurrencyLimit: number
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
- `newapiKeyId`：newapi 网关中的 Key ID，用于更新并发、禁用和删除。
- `apiKeyEncrypted`：任务专属 API Key 的加密值，只在 Dispatcher 下发 Worker 时解密。
- `apiBaseUrl`：任务请求使用的 newapi 网关地址。
- `model`：任务使用的模型。
- `poolType`：资源池类型，第一版自动化任务使用 `scan`。
- `concurrencyLimit`：当前已同步到 newapi 的并发上限。
- `status`：本地记录的 Key 生命周期状态。
- `lastSyncError`：同步失败原因，用于后台重试和告警。

配置项可先放系统配置表或环境变量：

```ts
type ModelSchedulingConfig = {
  newapiAdminBaseUrl: string
  newapiAdminToken: string
  dayStartTime: string
  dayEndTime: string
  scanDayConcurrency: number
  scanNightConcurrency: number
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
Create newapi task API Key
  ↓
Set concurrency limit on newapi
  ↓
Save TaskModelApiKey
  ↓
Inject task Key into Worker
  ↓
Worker calls model via newapi
```

步骤说明：

1. 读取任务需要的 `model` 和 newapi 网关配置。
2. 判断当前时段：
   - 周一到周五，`08:00-20:00` 为白天。
   - 周一到周五，其余时间为夜间。
   - 周六、周日全天按夜间。
3. 根据时段计算扫描任务并发：
   - 白天使用 `scanDayConcurrency`。
   - 夜间和周末使用 `scanNightConcurrency`。
4. 调用 newapi 管理接口创建任务专属 Key，并设置并发上限。
5. 写入 `TaskModelApiKey`。
6. 将任务专属 Key、newapi baseUrl、model 注入 Worker。
7. Worker 使用任务专属 Key 调用模型。

### 时段切换流程

平台启动定时同步任务，例如每 5 分钟执行一次。

```text
Find active TaskModelApiKey records
  ↓
Check whether TaskInstance is still running
  ↓
Calculate expected concurrency
  ↓
If changed, call newapi updateConcurrency
  ↓
Update local concurrencyLimit / lastSyncedAt
```

同步规则：

1. 查询所有 `status=active` 且任务仍在运行中的 `TaskModelApiKey`。
2. 重新计算当前时段对应的并发值。
3. 如果本地 `concurrencyLimit` 与期望值不同，调用 newapi 更新 Key 并发。
4. 更新 `concurrencyLimit` 和 `lastSyncedAt`。
5. 如果更新失败，记录 `lastSyncError`，下一轮继续重试。

白天切换到夜间时，运行中的扫描任务会逐步获得更高并发。夜间切换到白天时，newapi 会降低任务 Key 的并发限制，平台不强行中断 Worker。

### 任务结束流程

任务成功、失败、取消或超时后，平台禁用任务专属 Key。

```text
Task succeeds / fails / cancels / times out
  ↓
Call newapi disableKey
  ↓
Update TaskModelApiKey.status = disabled
  ↓
Keep audit data
  ↓
Cleanup job deletes archived keys after retention period
```

处理规则：

1. 调用 newapi 禁用该任务 Key。
2. 更新 `status=disabled` 和 `disabledAt`。
3. 保留审计数据。
4. 后台清理任务在保留期后删除或归档 Key。

## newapi 服务封装

建议新增一个薄封装服务，例如 `NewApiKeyService`。Dispatcher、并发同步任务、Key 清理任务都通过该服务访问 newapi 管理接口，避免业务代码散落 newapi 接口细节。

建议接口：

```ts
type CreateTaskKeyInput = {
  taskInstanceId: string
  model: string
  concurrencyLimit: number
}

type CreateTaskKeyResult = {
  newapiKeyId: string
  apiKey: string
}

interface NewApiKeyService {
  createTaskKey(input: CreateTaskKeyInput): Promise<CreateTaskKeyResult>
  updateConcurrency(newapiKeyId: string, concurrencyLimit: number): Promise<void>
  disableKey(newapiKeyId: string): Promise<void>
  deleteKey(newapiKeyId: string): Promise<void>
}
```

能力说明：

- `createTaskKey`：创建任务专属 Key，设置模型访问范围和并发上限。
- `updateConcurrency`：时段变化时更新 active Key 的并发限制。
- `disableKey`：任务结束后立即禁用 Key。
- `deleteKey`：清理保留期已过的 disabled Key。

安全边界：

- Worker 不应该拿到平台共享模型 Key。
- Worker 只拿到任务专属 Key。
- 即使 Worker 日志泄漏 Key，影响范围也被限制在单个任务。
- 任务结束后 Key 会被禁用，降低长期泄漏风险。

## 失败策略

### 创建 Key 失败

任务不投递 Worker。

可选处理：

- 标记任务失败，错误为“模型任务凭证创建失败”。
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
- 清理任务或补偿任务继续调用 `disableKey`。
- 必要时触发告警。

### 删除 Key 失败

只影响清理，不影响任务状态。

处理方式：

- 记录错误。
- 下一轮清理任务继续重试。

## 指标采集

第一版虽然不做实时自适应，但必须从第一天开始采集指标，为后续升级做基础。

建议采集：

- 每个任务 Key 当前并发值。
- 每个任务 Key 请求数。
- 成功数、失败数。
- 429 次数。
- 平均延迟和 P95 延迟。
- 任务队列长度。
- 任务实际运行时长。
- 按时段统计的调用量。
- 按模型统计的调用量。
- newapi 通道错误率。
- 每个任务的 Token 用量和成本。

这些指标用于回答：

- 白天扫描并发是否过高，是否影响人工问答。
- 夜间扫描并发是否过低，是否浪费资源。
- 某个模型或通道是否经常 429。
- 自动化扫描任务是否被模型资源限制。
- 未来自适应算法应该如何调整并发。

## 演进路径

### 阶段 1：固定日夜策略

当前方案。

```text
工作日白天 → 扫描低并发
工作日夜间/周末 → 扫描高并发
```

特点：

- 简单。
- 可控。
- 风险低。
- 依赖 newapi 做真实限流。

### 阶段 2：规则型自适应

在固定日夜策略基础上引入简单反馈规则。

示例：

```text
如果 429 率升高 → 降低扫描并发
如果 P95 延迟升高 → 降低扫描并发
如果扫描队列很长且错误率低 → 提高扫描并发
如果人工问答请求量升高 → 降低扫描并发
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

1. 新增 `TaskModelApiKey` 表。
2. 新增 newapi 管理配置。
3. 封装 `NewApiKeyService`。
4. 新增日夜策略函数。
5. 在 Dispatcher 投递任务前创建任务专属 Key。
6. Worker 改为使用任务专属 Key。
7. 新增并发同步定时任务。
8. 在任务成功、失败、取消、超时时禁用 Key。
9. 新增 Key 清理任务。
10. 新增基础指标采集。
11. 后续再演进到规则型自适应和实时负载自适应。

## 验证方式

第一版实现完成后，需要从前端完整验证自动化任务链路，不使用 curl 或 Postman。

前端操作步骤：

1. 打开自动化扫描任务创建页面，创建一个使用模型的扫描任务。
2. 启动任务，确认任务进入运行状态。
3. 在任务详情或日志中确认 Worker 使用任务专属 newapi Key。
4. 在 newapi 管理页面确认该任务 Key 已创建，并发值符合当前时段策略。
5. 调整系统时间或配置触发日夜策略变化，等待同步任务执行。
6. 在 newapi 管理页面确认该任务 Key 并发值被更新。
7. 等待任务完成或手动取消任务。
8. 在 newapi 管理页面确认该任务 Key 已被禁用。
9. 在平台任务详情或审计记录中确认保留了 Key 绑定、并发、调用量和错误信息。
