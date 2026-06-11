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
| `codeswarm/packages/worker/src/daemon.ts` | 新增 `resolveWorkKey()` + PHASE 0.5 调用 |
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

## 8. 任务创建输入参数释义

平台创建 CodeswarmTask 时（`src/app/api/task-builder/tasks/[id]/execute/route.ts`），组装以下参数写入 DB 并经 Dispatcher 发送给 Worker。

### 8.1 完整参数表

| 参数 | 类型 | 来源 | 必填 | 说明 |
|------|------|------|------|------|
| `taskId` | `string` | 自动生成 | ✅ | 格式 `task-{timestamp}-{random}`，全局唯一，作为 **work-key 的 `key_name`** |
| `instruction` | `string` | `AgentApp.startCommand` ∥ `TaskInstance.notes` | ✅ | Agent 执行指令，写入工作区 `instruction.txt` |
| `workspacePath` | `string` | `TaskInstance.projectPath` | 推荐 | NFS 模式下直接使用的共享路径，跳过文件拷贝 |
| `projectPath` | `string` | 保留字段 | 否 | 本地拷贝模式的项目源路径（NFS 模式下为 `null`） |
| `model` | `string` | `ModelConfig.models[0]` | 推荐 | 模型全名（如 `alibaba-cn/MiniMax/MiniMax-M2.7`），用于 opencode.json provider 配置 |
| `apiKey` | `string` | `ModelConfig.apiKey` | ⚠️ 见下方 | 模型 API Key，**作为 work-key 请求的 Bearer token**，Worker 会用 secret 替换 |
| `apiBaseUrl` | `string` | `ModelConfig.apiBaseUrl` | 否 | 自定义模型端点 URL，设置后 opencode.json 创建 `custom-*` provider |
| `engine` | `'opencode'` \| `'claudecode'` | `AgentApp.engine` | ✅ | 执行引擎，默认 `opencode` |
| `agent` | `string` | `AgentApp.defaultAgentName` | 推荐 | Agent 名称（如 `nazhua-audit`），**作为 work-key 的 `sub_task_id`** |
| `skills` | `string[]` | `TaskInstance.mergedSkills` | 否 | Skill ID 列表，拷贝到工作区 `.opencode/skills/` |
| `scripts` | `string[]` | `TaskInstance.mergedScripts` | 否 | 脚本列表 |
| `mcps` | `MCPService[]` | 保留字段 | 否 | MCP 服务配置（local/remote） |
| `timeoutSec` | `number` | 环境变量 `TASK_TIMEOUT_SEC` | 否 | 任务超时（秒），默认 604800（7天） |
| `maxTokens` | `number` | `ModelConfig.maxTokens` | 否 | 模型最大输出 token 数 |
| `contextWindow` | `number` | `ModelConfig.contextWindow` | 否 | 模型上下文窗口大小 |
| `targetProduct` | `string` | `TaskInstance.targetProduct` | 否 | 目标产品名，用于 Codedmap 知识图谱预处理 |
| `preferredWorkerNodeId` | `string` | 手动指定 | 否 | 指定 Worker 节点 ID，空则自动分配 |
| `callbackUrl` | `string` | 平台配置 | 否 | Worker 回调地址覆盖，默认使用 `ORCHESTRATOR_URL` |
| `env` | `Record<string,string>` | 保留字段 | 否 | 额外环境变量注入 Agent 进程 |

### 8.2 work-key 相关参数要求

启用 `AIGW_WORK_KEYS_URL` 后，以下参数**必须正确设置**，否则任务会失败：

| 参数 | 要求 | 失败场景 |
|------|------|---------|
| `apiKey` | **必须非空**，且是 AIGW 网关认可的父级 API Key（`tsk_*` 格式） | 为空 → 跳过 work-key 请求，用原始 key；无效 → AIGW 返回 401，任务 failed |
| `taskId` | 已自动生成，无需关注 | — |
| `agent` | **建议非空**，作为 `sub_task_id` 传给网关；为空时默认 `'default'` | 不影响任务执行，但网关侧无法按 Agent 区分审计 |

### 8.3 参数流转链路

```
用户创建任务（前端）
  → TaskInstance 写入 DB（关联 ModelConfig + AgentApp）
    → POST /api/task-builder/tasks/{id}/execute
      → 解析 modelConfig.apiKey / agentApp.engine / agentApp.defaultAgentName
      → INSERT CodeswarmTask（apiKey 存储）
        → Dispatcher 读取 → TaskPayload JSON → HTTP POST Worker /task
          → Worker daemon.executeTask(payload)
            → PHASE 0.5: resolveWorkKey(payload.apiKey, taskId, agent)  ← apiKey 替换为 secret
            → PHASE 1:   envFactory.build(payload)                      ← secret 写入 opencode.json
            → PHASE 2:   processMgr.runAgent(apiKey=secret)             ← Agent 使用 secret
```

## 9. 对上游透明

```
Platform (TaskInstance/ModelConfig) → 无修改
Dispatcher (codeswarm-dispatcher.ts)       → 无修改
CodeswarmTask (DB schema)                  → 无修改
TaskPayload (types)                        → 无修改
ProcessManager (process-manager.ts)        → 无修改（接收替换后的 apiKey）
```

整个 work-key 解析在 Worker 内部闭环，对外部系统完全透明。
