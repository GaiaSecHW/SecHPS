# AIGW Work-Key 虚拟 API Key 设计文档

## 1. 背景与动机

Worker 在执行 Agent 时，直接使用 `ModelConfig.apiKey`（从平台 → Dispatcher → TaskPayload 传递而来）调用模型 API。该 apiKey 是租户/平台级别的长期密钥，直接暴露给 Agent 进程存在以下问题：

- **安全风险**：长期密钥随 Agent 进程生命周期暴露在环境变量中
- **无法控流**：无法按任务/Agent 粒度限制并发或配额
- **审计困难**：无法区分不同任务使用的密钥来源

AIGW 网关提供 work-key 机制，可通过父级 API Key 动态派生出短期、受限的子密钥（work-key），用于替代原始密钥。

## 2. 设计目标

1. **透明集成**：对平台调度端（Dispatcher、TaskInstance）零改动
2. **按任务隔离**：每个任务使用独立的 work-key secret
3. **失败即终止**：work-key 获取失败直接标记任务 failed，不静默降级
4. **可配置开关**：通过环境变量控制启用/禁用

## 3. 整体架构

```
┌─────────────┐    ┌──────────────┐    ┌───────────────────┐    ┌──────────┐
│  Platform   │───>│  Dispatcher  │───>│  Worker daemon.ts │───>│   AIGW   │
│  (apiKey)   │    │  (透传)      │    │  resolveWorkKey() │    │  Gateway │
└─────────────┘    └──────────────┘    │         │          │    └──────────┘
                                       │         ▼          │
                                       │  POST /api/aigw/   │
                                       │  work-keys          │
                                       │  (Bearer: apiKey)   │
                                       │         │          │
                                       │         ▼          │
                                       │  secret 替换 apiKey│
                                       │         │          │
                                       │         ▼          │
                                       │  processMgr        │
                                       │  .runAgent(secret) │
                                       └───────────────────┘
```

## 4. API 接口定义

### 4.1 请求

```
POST {AIGW_WORK_KEYS_URL}/api/aigw/work-keys
Authorization: Bearer <原始 apiKey>
Content-Type: application/json
```

请求体：

```json
{
  "key_name": "<taskId>",
  "sub_task_id": "<agentName>",
  "max_concurrency": 0,
  "enabled": true,
  "description": "work key for <taskId>/<agentName>"
}
```

| 字段 | 来源 | 说明 |
|------|------|------|
| `key_name` | `taskId` | CodeswarmTask 的唯一标识 |
| `sub_task_id` | `agentName` | Agent 名称（如 `nazhua-audit`） |
| `max_concurrency` | 固定 `0` | 不限制并发 |
| `enabled` | 固定 `true` | 立即生效 |
| `description` | 拼接 | 描述文本 |

### 4.2 响应

```json
{
  "key": {
    "id": 7,
    "key_name": "task-xxx-worker-1",
    "key_type": "work",
    "parent_key_id": 3,
    "key_prefix": "gb7tb8dsrnvr",
    "max_concurrency": 0,
    "task_id": "aaa",
    "sub_task_id": "sub-a",
    "enabled": true,
    "description": "work key for task-a/sub-a",
    "capacity_pool_ids": [],
    "created_at": "2026-06-09T08:23:36.170360442Z",
    "updated_at": "2026-06-09T08:23:36.170360522Z"
  },
  "secret": "wsk_gb7tb8dsrnvrjz68x5vjv473y89zfq9u"
}
```

提取 `key.secret`（如 `wsk_gb7tb8dsrnvrjz68x5vjv473y89zfq9u`）作为 Agent 的实际 API Key。

## 5. 核心实现

### 5.1 修改文件

| 文件 | 修改内容 |
|------|---------|
| `codeswarm/packages/worker/src/daemon.ts` | 新增 `resolveWorkKey()` + PHASE 1.8 调用 |
| `codeswarm/.env.example` | 新增 `AIGW_WORK_KEYS_URL` 配置项 |

### 5.2 resolveWorkKey() 函数

```typescript
async function resolveWorkKey(
  apiKey: string,
  taskId: string,
  agentName: string,
): Promise<string>
```

**执行逻辑**：

1. 检查 `process.env.AIGW_WORK_KEYS_URL`，未设置 → 直接返回原始 `apiKey`
2. 发起 POST 请求（超时 10s）
3. HTTP 非 200 → 抛出错误（含状态码和响应体）
4. 响应 JSON 中 `key.secret` 为空 → 抛出错误（含完整响应）
5. 成功 → 返回 `secret`

### 5.3 executeTask() 中的调用时机

```
PHASE 0.5: 动态获取虚拟 API Key (resolveWorkKey)  ← 新增，在构建环境之前
PHASE 1:   构建环境 (envFactory.build)             ← payload.apiKey 已替换为 secret，写入 opencode.json
PHASE 1.5: Codedmap 知识图谱预处理 (并行)
PHASE 2:   执行 Agent (processMgr.runAgent)        ← apiKey 已是 secret
```

**关键设计**：work-key 解析必须在 `envFactory.build()` **之前**执行，因为 `environment.ts:buildModelConfig()` 会将 `payload.apiKey` 写入 `opencode.json` 的 provider 配置。通过直接覆盖 `payload.apiKey`，后续 `envFactory.build()` 和 `processMgr.runAgent()` 都自动使用 secret，无需额外传参。

### 5.4 错误处理

`resolveWorkKey()` 抛出的错误被 `executeTask()` 的 `try-catch` 捕获：

```
resolveWorkKey 抛错
  → executeTask catch 块
    → postResult(status: 'failed', error: errorMsg)
    → postEvent(type: 'error')
    → 任务标记 failed，释放 semaphore
```

## 6. 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `AIGW_WORK_KEYS_URL` | 否 | 无（跳过） | AIGW 网关地址（含协议），未设置则透传原始 apiKey |

示例：

```bash
AIGW_WORK_KEYS_URL=http://secflow.ai.icsl.huawei.com
```

## 7. 兼容性

| 场景 | 行为 |
|------|------|
| `AIGW_WORK_KEYS_URL` 未设置 | 完全兼容，透传原始 apiKey，无额外请求 |
| `AIGW_WORK_KEYS_URL` 已设置 + 网关正常 | 使用 work-key secret 执行 Agent |
| `AIGW_WORK_KEYS_URL` 已设置 + 网关不可用 | 任务 failed，错误信息包含网关详情 |
| 任务无 apiKey（`apiKey` 为空） | 跳过 work-key 请求，直接执行 |

## 8. 对上游透明

```
Platform (TaskInstance/ModelConfig) → 无修改
Dispatcher (codeswarm-dispatcher.ts)       → 无修改
CodeswarmTask (DB schema)                  → 无修改
TaskPayload (types)                        → 无修改
ProcessManager (process-manager.ts)        → 无修改（接收替换后的 apiKey）
```

整个 work-key 解析在 Worker 内部闭环，对外部系统完全透明。
