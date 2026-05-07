# CodeSwarm 集群架构设计文档

> 本文档描述 NAZHUA + CodeSwarm 集群模式的**当前实际实现**状态。
> 原始设计参见 `CodeSwarm.md`，其中部分设计尚未实现或已有变更。

---

## 1. 系统概述

NAZHUA 是代码审计平台，CodeSwarm 是其分布式执行层。用户在 NAZHUA 前端创建审计任务后，任务被分发到 CodeSwarm Worker 节点执行，结果通过 HTTP 回传到 NAZHUA 进行聚合展示。

### 1.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    NAZHUA（业务 + 编排）                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Frontend │  │ FastAPI  │  │  SQLite  │  │ 调度器        │ │
│  │ React    │  │ Backend  │  │ / PG     │  │ (负载均衡)    │ │
│  │ :8466    │  │ :8460    │  │          │  │              │ │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬───────┘ │
│       │             │                               │         │
│       │  SSE stream │  HTTP 回调接口                │         │
│       │←────────────│←─────────────────────────────│         │
│       │             │  /api/codeswarm/worker/*      │         │
│                     │                               │         │
│  文件系统: repos/{tenant}/audittasks/{task_id}/      │         │
│  ├── code/          ← 克隆的项目代码                 │         │
│  ├── .opencode/skills/ ← 复制的 Skill 文件           │         │
│  ├── opencode.json  ← 生成的模型+MCP配置             │         │
│  └── run.log        ← 运行日志                       │         │
└─────────────────────┼───────────────────────────────┼─────────┘
                      │         HTTP POST              │
                      │  任务分发 + 回调上报            │
              ┌───────┴──────────┬────────────────────┴──────┐
              │                  │                            │
      ┌───────┴──────┐  ┌───────┴──────┐  ┌────────┴────────┐
      │  Worker-1    │  │  Worker-2    │  │  Worker-3       │
      │  :8090       │  │  :8091       │  │  :8092          │
      │              │  │              │  │                 │
      │  Fastify     │  │  Fastify     │  │  Fastify        │
      │  Semaphore   │  │  Semaphore   │  │  Semaphore      │
      │  ACP Client  │  │  ACP Client  │  │  ACP Client     │
      │  OpenCode    │  │  OpenCode    │  │  OpenCode       │
      └──────────────┘  └──────────────┘  └─────────────────┘
```

### 1.2 设计 vs 实现差异

| 方面 | 原始设计 (`CodeSwarm.md`) | 当前实现 |
|------|--------------------------|---------|
| 编排器 | 独立 `packages/orchestrator`，Redis 队列 | **NAZHUA 后端内嵌**，直接 HTTP 分发 |
| 消息队列 | Redis Pub/Sub + 队列 | 无 Redis 依赖，直接 HTTP |
| 实时推送 | WebSocket | **SSE (EventSource)** |
| Skills 来源 | Worker 从 `shared/skills_registry/` 复制 | **NAZHUA 后端复制到任务目录**，Worker NFS 透传 |
| 节点注册 | Worker 启动时显式注册 | **心跳自动注册** + 手动添加 |
| 本地执行 | 未提及 | **已移除**，无 Worker 则任务失败 |
| ACP 通信 | 原始 ndJSON 解析 | **`@agentclientprotocol/sdk`** |
| 调度策略 | 轮询 / 最少负载 / 能力匹配 | **最少任务优先**（简单实现） |

---

## 2. 项目结构

```
NAZHUA/                              # 主项目
├── backend/                         # FastAPI 后端
│   └── app/
│       ├── models/
│       │   ├── codeswarm_node.py    # Worker 节点数据模型
│       │   └── audit_task.py        # 审计任务（含 assigned_node_* 字段）
│       ├── schemas/
│       │   └── codeswarm_node.py    # 节点 CRUD schema
│       ├── services/
│       │   ├── codeswarm_node.py    # 节点管理服务（注册/选择/心跳/健康检查）
│       │   └── audit_task.py        # 审计任务服务（克隆/配置/分发/回调）
│       ├── routers/
│       │   ├── codeswarm_nodes.py   # 节点管理 API（/api/codeswarm-nodes）
│       │   └── codeswarm_callbacks.py # Worker 回调 API（/api/codeswarm/worker）
│       └── scheduler.py             # 定时任务：离线节点检测
│
├── frontend/                        # React 前端
│   └── src/
│       ├── services/api.ts          # API 客户端（含 computeNodeApi）
│       ├── pages/
│       │   ├── AgentAudit/          # 审计任务列表（含集群状态栏）
│       │   └── AuditTaskDetail/     # 任务详情（含节点信息）
│       └── components/
│           └── TaskCard.tsx         # 任务卡片（含节点指示器）
│
└── codeswarm/                       # CodeSwarm 分布式执行框架
    ├── packages/
    │   ├── types/                   # @codeswarm/types — Zod Schema
    │   │   └── src/index.ts         # TaskPayloadSchema, MCPServiceSchema 等
    │   ├── acp/                     # @codeswarm/acp — ACP 协议封装
    │   │   └── src/index.ts         # ACP 客户端，对接 @agentclientprotocol/sdk
    │   └── worker/                  # Worker Daemon
    │       └── src/
    │           ├── daemon.ts        # 主服务（Fastify + 心跳 + 任务执行）
    │           ├── environment.ts   # 环境工厂（NFS 透传 / 本地模式）
    │           ├── process-manager.ts # OpenCode 进程管理
    │           ├── semaphore.ts     # 并发信号量
    │           └── index.ts         # 入口 + 优雅关闭
    └── shared/
        └── skills_registry/         # 本地模式的 Skills 仓库（未自动同步）
```

---

## 3. 核心组件

### 3.1 NAZHUA 后端（编排 + 业务）

#### 3.1.1 节点管理服务 (`services/codeswarm_node.py`)

| 方法 | 功能 |
|------|------|
| `select_available_node()` | 选择负载最低的在线节点（最少任务优先） |
| `get_by_id()` | 根据 ID 查询节点 |
| `create()` | 手动创建节点 |
| `update()` | 更新节点信息 |
| `delete()` | 删除节点 |
| `update_heartbeat()` | 更新心跳时间戳 |
| `increment_task_count()` | 任务分配后 +1 |
| `decrement_task_count()` | 任务完成后 -1 |
| `check_health()` | 主动健康检查（GET /health） |
| `list_nodes()` | 分页查询节点列表 |

节点选择策略（`select_available_node`）：
```sql
SELECT * FROM codeswarm_nodes
WHERE status = 'online'
  AND current_tasks < max_concurrent
ORDER BY current_tasks ASC
LIMIT 1
```

#### 3.1.2 Worker 回调接口 (`routers/codeswarm_callbacks.py`)

| 端点 | 方法 | 调用方 | 功能 |
|------|------|--------|------|
| `/api/codeswarm/worker/event` | POST | Worker | 接收实时事件，写入 run.log |
| `/api/codeswarm/worker/result` | POST | Worker | 接收任务结果，更新状态，解析报告 |
| `/api/codeswarm/worker/heartbeat` | POST | Worker | 接收心跳，自动注册未知节点 |

回调接口**无认证**，依赖网络隔离保护。

#### 3.1.3 节点管理 API (`routers/codeswarm_nodes.py`)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/codeswarm-nodes/cluster/status` | GET | 集群状态汇总（总数/在线/容量/任务数） |
| `/api/codeswarm-nodes` | GET | 节点列表（分页/搜索/过滤） |
| `/api/codeswarm-nodes/{id}` | GET | 节点详情 |
| `/api/codeswarm-nodes` | POST | 创建节点 |
| `/api/codeswarm-nodes/{id}` | PATCH | 更新节点 |
| `/api/codeswarm-nodes/{id}` | DELETE | 删除节点 |
| `/api/codeswarm-nodes/{id}/health` | POST | 主动健康检查 |

所有接口需要超级用户权限。

#### 3.1.4 定时离线检测 (`scheduler.py`)

- 每 **60 秒**运行一次
- 检查所有 ONLINE 节点的 `last_heartbeat`
- 心跳超过 **90 秒**未更新 → 标记为 OFFLINE
- 处理 SQLite 时区问题：naive datetime 视为 UTC

#### 3.1.5 数据模型 (`models/codeswarm_node.py`)

```
CodeSwarmNode:
  id              VARCHAR(36) PK    -- 节点 ID（Worker 自定义或自动生成）
  name            VARCHAR(255)      -- 显示名称
  address         VARCHAR(255)      -- 连接地址（host:port）
  status          ENUM              -- online / offline
  max_concurrent  INTEGER default 5 -- 最大并发任务数
  current_tasks   INTEGER default 0 -- 当前运行任务数
  capabilities    TEXT (JSON)       -- 节点能力标签
  last_heartbeat  DATETIME          -- 最后心跳时间
  created_at      DATETIME
  updated_at      DATETIME
```

### 3.2 CodeSwarm Worker

#### 3.2.1 Worker Daemon (`daemon.ts`)

Worker 是 Fastify HTTP 服务，核心职责：

1. **接收任务**：`POST /task`，用 Semaphore 控制并发
2. **执行任务**：启动 OpenCode ACP 进程，流式回传事件
3. **心跳上报**：每 30 秒向 NAZHUA 发送心跳
4. **健康检查**：`GET /health` 返回节点状态

配置项（环境变量）：
```
NODE_ID           节点唯一标识（默认随机）
PORT              监听端口（默认 8090）
MAX_CONCURRENT    最大并发（默认 5）
ORCHESTRATOR_URL  NAZHUA 地址（如 http://localhost:8460）
```

#### 3.2.2 环境工厂 (`environment.ts`)

两种工作模式：

**NFS 透传模式**（`payload.workspacePath` 非空时）：
- Worker 不做任何文件操作
- 只写入 `instruction.txt`
- 直接使用 NAZHUA 提供的路径
- **当前默认模式**（NAZHUA 始终传入 workspacePath）

**本地模式**（`payload.workspacePath` 为空时）：
- 创建临时工作目录 `data/task_workspaces/{taskId}/`
- 复制项目文件
- 从 `shared/skills_registry/` 复制 Skills
- 生成 `opencode.json`
- 适用于 Worker 与 NAZHUA 不共享文件系统的场景

#### 3.2.3 ACP 客户端 (`acp/src/index.ts`)

- 通过 `@agentclientprotocol/sdk` 与 OpenCode 通信
- 启动命令：`opencode acp --cwd {workspace}`
- 自动处理权限提示（选择第一个选项）
- 事件类型：`agent_message_chunk`, `tool_call`, `tool_call_update`, `error`

#### 3.2.4 并发控制 (`semaphore.ts`)

Semaphore 实现控制 Worker 同时执行的任务数：
- `tryAcquire()`：尝试获取槽位，满了返回 false → 返回 503
- `release()`：任务完成后释放
- `available`：当前可用槽位数

---

## 4. 任务执行全流程

### 4.1 完整时序

```
前端                NAZHUA 后端                          Worker
 │                     │                                    │
 │  POST /audit-tasks  │                                    │
 │────────────────────>│                                    │
 │                     │                                    │
 │                     │ ① 创建任务记录                      │
 │                     │ ② 创建工作空间目录                   │
 │                     │    repos/{tenant}/audittasks/{id}/  │
 │                     │                                    │
 │                     │ ③ 后台异步 _run_audit_task()        │
 │                     │                                    │
 │                     │ ④ git clone → code/                │
 │                     │                                    │
 │                     │ ⑤ 复制 Skills                      │
 │                     │    NAZHUA_ROOT/.opencode/skills/   │
 │                     │    → {workspace}/.opencode/skills/  │
 │                     │                                    │
 │                     │ ⑥ 生成 opencode.json               │
 │                     │    (model + mcp 配置)               │
 │                     │                                    │
 │                     │ ⑦ 选择 Worker 节点                  │
 │                     │    select_available_node()          │
 │                     │    (最少任务优先)                    │
 │                     │                                    │
 │                     │ ⑧ 记录分配信息                      │
 │                     │    assigned_node_id/name            │
 │                     │                                    │
 │                     │ ⑨ POST /task ──────────────────>  │
 │                     │    {workspacePath: ...}             │
 │                     │                       ← 202 ────── │
 │                     │                                    │
 │                     │                    ⑩ NFS透传模式    │
 │                     │                       写入instruction.txt
 │                     │                                    │
 │                     │                    ⑪ 启动 OpenCode  │
 │                     │                       opencode acp │
 │                     │                       --cwd {path} │
 │                     │                                    │
 │                     │                    ⑫ 发送 prompt    │
 │                     │                       等待完成      │
 │                     │                                    │
 │                     │<── POST /event ─────────────────── │
 │                     │    (agent_message_chunk)            │
 │                     │<── POST /event ─────────────────── │
 │                     │    (tool_call, tool_result)        │
 │                     │                                    │
 │                     │<── POST /result ────────────────── │
 │                     │    {status: completed}             │
 │                     │                                    │
 │                     │ ⑬ 解析安全报告                      │
 │                     │     生成 Issues                     │
 │                     │ ⑭ 释放 Worker 容量                  │
 │                     │     decrement_task_count()          │
 │                     │                                    │
 │  SSE stream         │                                    │
 │<────────────────────│  (读 run.log 实时推送)              │
 │                     │                                    │
```

### 4.2 阶段详解

#### 阶段一：任务创建（同步）

1. 前端调用 `POST /api/audit-tasks`
2. 后端创建 `AuditTask` 记录，生成 `repo_path` = `repos/{tenant}/audittasks/{task_id}/`
3. 创建目录，返回任务信息

#### 阶段二：代码准备（后台异步）

4. `asyncio.create_task(_run_audit_task())` 启动后台协程
5. 根据 `repository_id` 或 `repository_configs` 克隆代码：
   - 单仓库 → `{repo_path}/code/`
   - 多仓库 → `{repo_path}/code/{repo_name}/`
6. 如果是 PR 审计，额外获取 PR diff 保存为 `pr_diff.json`

#### 阶段三：工作空间配置

7. 从 `AuditTool` 读取启动命令、环境变量、MCP/Skill 引用
8. 查询 `LLMConfig` 生成模型配置
9. 查询 `MCPServer` 生成 MCP 配置 → 写入 `opencode.json` 和 `.mcp.json`
10. **复制 Skills**：
    ```
    源: NAZHUA_ROOT/.{location}/skills/{slug}/SKILL.md
    目标: {repo_path}/.opencode/skills/{normalized_name}/SKILL.md
    ```
    使用 `shutil.copytree` 整目录复制，重写 frontmatter 中的 name 字段

#### 阶段四：任务分发

11. `select_available_node()` 选择最空闲的 Worker
12. 记录 `task.assigned_node_id` 和 `task.assigned_node_name`
13. 构建任务 Payload：

```typescript
{
  taskId: string,
  instruction: string,          // 从 --prompt 参数提取
  projectPath: string,          // 代码目录路径
  workspacePath: string,        // 整个工作空间路径（触发 NFS 透传）
  env: { NAZHUA_TASK_ID, ... }, // 环境变量
  model: string,                // LLM 模型
  apiKey: string,               // API Key
  mcps: [...],                  // MCP 服务器配置
  skills: [...],                // Skill slug 列表
  nazhuaCallbackUrl: string,    // 回调地址
}
```

14. HTTP POST 到 `http://{node.address}/task`
    - 202 → 成功
    - 503 → 满载
    - 超时/其他 → 任务失败

#### 阶段五：Worker 执行

15. Worker 收到 `workspacePath` → NFS 透传模式
16. 启动 `opencode acp --cwd {workspace}`
17. 通过 ACP SDK 发送 prompt，接收事件流
18. 实时回传事件到 `POST /api/codeswarm/worker/event`
19. 完成后回传结果到 `POST /api/codeswarm/worker/result`

#### 阶段六：结果处理

20. NAZHUA 更新任务状态（COMPLETED/FAILED）
21. 解析安全报告文件，生成 Issues
22. `decrement_task_count()` 释放 Worker 容量
23. 前端通过 SSE 流实时读取 `run.log` 展示日志

---

## 5. 心跳与离线检测

### 5.1 心跳机制

```
Worker ──(每30秒)──> POST /api/codeswarm/worker/heartbeat ──> NAZHUA
                     {
                       nodeId: "xxx",
                       maxConcurrent: 5,
                       currentTasks: 2,
                       address: "localhost:8090"
                     }
```

心跳处理逻辑：
- 已知节点 → 更新 `last_heartbeat` 和 `current_tasks`
- 未知节点 → **自动注册**，以 `worker-{nodeId前8位}` 为名称
- 地址为 "unknown" 的节点 → 用心跳中的 `address` 更新

### 5.2 离线检测

```
NAZHUA 定时任务（每60秒）
  → 查询所有 ONLINE 节点
  → 检查 last_heartbeat 与当前时间差
  → 超过 90 秒 → 标记为 OFFLINE
```

### 5.3 时间线

```
0s          30s         60s         90s         120s
│           │           │           │           │
│  heartbeat │  heartbeat │  heartbeat │           │
│           │           │           │           │
│                                    │           │
│                              60s定时检测       │
│                              (90-60=30s < 90) │
│                              → 仍然 ONLINE    │
│                                              │
│                                    如果 Worker 挂了
│                                              │
│                                     120s定时检测
│                                     (120-60=60s > 90)
│                                     → 标记 OFFLINE ❌
```

---

## 6. 负载均衡

### 6.1 当前策略：最少任务优先

```sql
SELECT * FROM codeswarm_nodes
WHERE status = 'online'
  AND current_tasks < max_concurrent
ORDER BY current_tasks ASC
LIMIT 1
```

### 6.2 容量追踪

```
分配任务时:  increment_task_count(node_id)  → current_tasks + 1
完成/失败时: decrement_task_count(node_id)  → current_tasks - 1
心跳上报时:  current_tasks = maxConcurrent - semaphore.available
```

### 6.3 无节点处理

- `total_nodes == 0` → "未注册任何计算节点"
- `total_nodes > 0` 但无可用 → "所有计算节点不可用或已满载"
- 两种情况任务直接标记 FAILED，**无本地执行回退**

---

## 7. Skills 共享机制

### 7.1 当前路径（NFS 透传）

```
1. NAZHUA 从自身项目目录读取 Skill 文件
   .claude/skills/{slug}/SKILL.md
   .opencode/skills/user/{slug}/SKILL.md

2. 复制到任务工作空间
   {repo_path}/.opencode/skills/{normalized_name}/SKILL.md

3. Worker 通过 workspacePath 直接访问
   （无需任何文件操作）
```

### 7.2 本地模式路径（未激活）

```
Worker 从自身目录读取
  shared/skills_registry/{skillId}/latest/SKILL.md
复制到本地工作空间
  data/task_workspaces/{taskId}/.opencode/skills/{skillId}/SKILL.md
```

> 此目录目前没有自动同步机制，需手动或通过 Git 维护。

### 7.3 Skill 引用配置

Skill 通过 `AuditTool.skill_refs` JSON 字段关联：
```json
[
  {"location": "opencode", "slug": "security-audit"},
  {"location": "claude", "slug": "code-review"}
]
```

任务级 `skill_refs` 可覆盖工具默认值。

---

## 8. 前端集成

### 8.1 集群状态栏（审计任务列表页）

展示内容：
- 在线/离线节点数
- 总容量和当前任务数
- 利用率进度条

数据来源：`GET /api/codeswarm-nodes/cluster/status`

### 8.2 任务卡片（节点指示器）

运行中/等待中的任务显示分配的 Worker 节点名称。

### 8.3 任务详情页

显示执行节点名称和节点 ID。

### 8.4 实时日志

通过 SSE (`GET /api/audit-tasks/{id}/stream?token=xxx`) 读取 `run.log`，
Worker 回传的事件被格式化写入 run.log，前端用 `ansi_up` 渲染 ANSI 颜色。

---

## 9. 部署

### 9.1 单机开发（当前）

```
NAZHUA Backend  (:8460)    ← 同一台机器
NAZHUA Frontend (:8466)    ← 同一台机器
Worker-1        (:8090)    ← 同一台机器（文件系统共享）
Worker-2        (:8091)    ← 同一台机器
Worker-3        (:8092)    ← 同一台机器
```

启动 Worker：
```bash
cd codeswarm
CI=true npm exec pnpm -- install --no-frozen-lockfile
cd packages/worker
NODE_ID=worker-1 PORT=8090 MAX_CONCURRENT=5 ORCHESTRATOR_URL=http://localhost:8460 npx tsx src/index.ts
```

### 9.2 生产部署（NFS 模式）

```
Machine A (NAZHUA):
  ├── FastAPI (:8460)
  ├── React (:8466)
  ├── Redis
  └── NFS Server: /repos/

Machine B/C/D (Worker):
  ├── Worker Daemon
  ├── OpenCode CLI (npm i -g opencode-ai@latest)
  └── NFS Mount: /repos/ → Machine A:/repos/
```

### 9.3 生产部署（独立模式）

当 Worker 与 NAZHUA 不共享文件系统时：
- 不传 `workspacePath`，Worker 使用本地模式
- Worker 自己克隆代码和管理 Skills
- 需要预填充 `shared/skills_registry/`

---

## 10. 已知问题与 TODO

### 10.1 已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| 无本地执行回退 | 待修复 | 没有 Worker 时任务直接失败，需加回本地执行路径 |
| Skills 仓库无自动同步 | 待实现 | `shared/skills_registry/` 需手动维护 |
| 回调接口无认证 | 风险 | `/api/codeswarm/worker/*` 无 JWT 校验，依赖网络隔离 |
| 任务超时无处理 | 待实现 | Worker 侧未检查 `timeoutSec` |
| Worker 掉线任务不重调度 | 待实现 | 节点离线后运行中的任务状态未知 |

### 10.2 架构演进方向

| 阶段 | 内容 | 状态 |
|------|------|------|
| V0 | 当前：NAZHUA 内嵌调度，HTTP 直连 | ✅ 已实现 |
| V1 | 加回本地执行回退，无 Worker 也可运行 | 待实现 |
| V2 | 独立 `packages/orchestrator`，NAZHUA 解耦调度 | 待规划 |
| V3 | Redis 队列 + 任务重调度 + 能力匹配 | 待规划 |
| V4 | Engine Pool 复用 + 跨地域 S3 部署 | 待规划 |
