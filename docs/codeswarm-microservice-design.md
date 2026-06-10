# CodeSwarm 微服务拆分设计文档

> 版本: v1.0  
> 日期: 2026-06-10  
> 状态: 设计评审中

## 1. 背景与目标

### 1.1 现状

CodeSwarm 调度引擎（`CodeswarmDispatcher`）和 Worker 执行引擎目前嵌入在 Next.js 平台中：

- **调度器**：`src/services/codeswarm-dispatcher.ts`（~1441 行），由 `instrumentation.ts` 在 Next.js 启动时引导，与平台共享 DB/Redis 进程
- **Worker**：`codeswarm/packages/worker/`（独立 Fastify 进程），通过 HTTP 与平台交互
- **API 路由**：13 个 Next.js Route Handler 在 `src/app/api/codeswarm/` 下，混合了调度逻辑和平台业务（漏洞解析、TaskInstance 关联等）

### 1.2 问题

1. 调度器与平台强耦合，无法被其他平台复用
2. 调度器随 Next.js 进程启停，无法独立扩缩容
3. Worker 需要外部可达 IP，跨网络部署复杂
4. 本地开发调试困难（需要完整 Next.js 平台运行）

### 1.3 目标

将 Scheduler + Worker 拆分为独立微服务：

1. **通用化**：作为 AI Agent 调度基础设施，可被多个平台调用
2. **容器化**：Docker 镜像，本地 `docker-compose` 调试，生产 K8s 部署
3. **弹性伸缩**：Worker Deployment + HPA，按队列深度自动扩缩容
4. **共享存储**：NFS PVC 作为工作区，所有 Worker Pod 共享

### 1.4 已确认约束

| 约束 | 决策 |
|------|------|
| 存储后端 | NFS，单 ReadWriteMany PVC |
| Worker 部署形态 | Deployment + HPA（弹性池） |
| Scheduler 职责 | 中等：调度 + PVC 路径分配 + HPA 指标 + 事件桥接 |
| TaskInstance 创建 | 平台创建后通知 Scheduler |
| 集群位置 | 同一 K8s 集群 |
| 前端调试页面 | 保留，API 路由变 proxy |
| VulnReparsePanel | 移除 |

---

## 2. 目标架构

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│  K8s Namespace: codeswarm (或本地 docker-compose)                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  共享存储 (NFS PVC / Docker Volume)                        │  │
│  │  /mnt/workspace/{taskId}/                                  │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│       ┌───────────────────┼────────────────────────┐             │
│       │                   │                        │             │
│  ┌────┴─────────┐  ┌─────┴─────────┐  ┌──────────┴──────┐     │
│  │ Scheduler    │  │ Worker Pod-0  │  │ Worker Pod-N   │     │
│  │ (1 副本)     │  │ (HPA 1~20)   │  │ (HPA 1~20)    │     │
│  │              │  │               │  │               │     │
│  │ Fastify HTTP │◀─│ Fastify HTTP  │  │ Fastify HTTP  │     │
│  │ Redis Stream │  │ ACP Client    │  │ ACP Client    │     │
│  │ Prisma ORM   │  │ Semaphore     │  │ Semaphore     │     │
│  │ 定时健康检查  │  │ Env Factory   │  │ Env Factory   │     │
│  │ HPA Metrics  │  │ Codedmap      │  │ Codedmap      │     │
│  │ 事件桥接     │  │ MinIO Client  │  │ MinIO Client  │     │
│  └──────┬───────┘  └───────────────┘  └───────────────┘     │
│         │                                                      │
│         │ Service: scheduler:8080                              │
│         │                                                      │
│  ┌──────┴──────────────────────────────────────────────────┐   │
│  │  外部平台 (Next.js / 其他系统)                           │   │
│  │                                                         │   │
│  │  前端 ──proxy──▶ Scheduler API                         │   │
│  │  TaskInstance 管理 + 业务逻辑                           │   │
│  │  SSE 推送 + 漏洞解析 + 通知                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Scheduler 职责边界

```
✅ 核心调度（已有逻辑迁移）
   ├─ Redis Stream 消费循环（codeswarm:task:queue）
   ├─ Worker 拓扑管理（内存 Map + DB 持久化）
   ├─ 最少负载优先 Worker 选择
   ├─ 两阶段原子分发（DB 抢占 + HTTP POST）
   ├─ 任务超时 / Worker 掉线 / 僵尸检测
   └─ 失败重调度 + 退避重试

✅ PVC 路径分配（新增，纯逻辑，不需要 K8s API）
   ├─ submit 时生成 workspacePath: /mnt/workspace/{taskId}/
   ├─ 任务完成后标记目录可清理
   └─ 定时清理过期目录

✅ HPA 指标暴露（新增）
   ├─ /metrics 端点（Prometheus 格式）
   └─ 队列深度 + Worker 容量 + 任务统计

✅ 事件桥接（新增）
   ├─ 任务完成/失败 → 回调外部平台
   └─ 实时事件 → Redis PubSub → SSE 转发

✅ Worker 认证
   └─ JWT Token 签发/验证

❌ 不做的事
   ├─ 不创建/删除 PVC（预建共享卷）
   ├─ 不创建/删除 Pod（Deployment + HPA 管理）
   ├─ 不创建 TaskInstance（平台职责）
   ├─ 不做漏洞解析（平台业务）
   └─ 不写 TaskExecutionLog（平台业务）
```

---

## 3. 项目结构

```
codeswarm-service/                       ← 独立项目（monorepo 或独立仓库）
├── package.json                         ← pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
│
├── packages/
│   ├── types/                           ← 从 codeswarm/packages/types 整体搬入
│   │   ├── package.json
│   │   └── src/index.ts                 ← TaskPayload, TaskResult, WorkerEvent 等类型定义
│   │
│   ├── acp/                             ← 从 codeswarm/packages/acp 整体搬入
│   │   ├── package.json
│   │   └── src/index.ts                 ← ACPClient（Agent Client Protocol）
│   │
│   ├── sdk-adapter/                     ← 从 codeswarm/packages/sdk-adapter 整体搬入
│   │   ├── package.json
│   │   └── src/index.ts
│   │
│   ├── worker/                          ← 从 codeswarm/packages/worker 搬入 + 改造
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                 ← 入口，读取环境变量启动 daemon
│   │       ├── daemon.ts                ← WorkerDaemon（改 orchestratorUrl → SCHEDULER_URL）
│   │       ├── process-manager.ts       ← ACP 进程管理（不改）
│   │       ├── environment.ts           ← 工作区构建（新增 PVC 自动路径）
│   │       ├── agent-runner.ts          ← 直接 spawn 模式（不改）
│   │       ├── semaphore.ts             ← 并发控制（不改）
│   │       ├── codedmap-manager.ts      ← 知识图谱预处理（不改）
│   │       ├── minio-client.ts          ← 对象存储（不改）
│   │       └── logger.ts               ← 日志模块（不改）
│   │
│   └── scheduler/                       ← 新建：从平台提取调度引擎
│       ├── package.json
│       └── src/
│           ├── index.ts                 ← 入口：启动 Fastify + Dispatcher
│           ├── server.ts                ← Fastify 实例 + 路由注册
│           ├── dispatcher.ts            ← 核心调度逻辑（从 codeswarm-dispatcher.ts 搬入）
│           ├── routes/
│           │   ├── task.ts              ← 任务 CRUD + submit（从 tasks/route.ts 搬入）
│           │   ├── worker.ts            ← 心跳 + result + event（从 worker/* 搬入）
│           │   ├── nodes.ts             ← Worker 节点管理（从 nodes/* 搬入）
│           │   ├── stream.ts            ← SSE 事件流（从 tasks/[id]/stream 搬入）
│           │   └── platform.ts          ← 新增：平台回调接口
│           ├── services/
│           │   ├── workspace.ts         ← 新增：PVC 路径分配 + 过期清理
│           │   └── metrics.ts           ← 新增：Prometheus 指标
│           ├── auth.ts                  ← 从 codeswarm-worker-auth.ts 搬入
│           ├── prisma.ts                ← 独立 Prisma 客户端 + withDeadlockRetry
│           └── logger.ts                ← 日志模块
│
├── prisma/
│   └── schema.prisma                    ← 只含 CodeswarmTask / CodeswarmWorker / CodeswarmEvent
│
├── docker/                              ← 本地调试配置
│   ├── docker-compose.yml               ← 本地开发环境（Scheduler + Worker + Redis + PostgreSQL）
│   ├── Dockerfile.scheduler             ← Scheduler 镜像
│   ├── Dockerfile.worker                ← Worker 镜像
│   └── .env.docker                      ← Docker 环境变量
│
├── k8s/                                 ← 生产部署配置
│   ├── namespace.yaml
│   ├── scheduler-deployment.yaml
│   ├── scheduler-service.yaml
│   ├── worker-deployment.yaml
│   ├── worker-hpa.yaml
│   ├── pvc.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   └── servicemonitor.yaml
│
└── scripts/
    ├── dev.sh                           ← 本地开发启动脚本
    └── build.sh                         ← 构建脚本
```

---

## 4. 本地 Docker 调试环境

### 4.1 docker-compose.yml

```yaml
# docker/docker-compose.yml
# 本地开发调试环境：Scheduler + Worker + Redis + PostgreSQL + MinIO
#
# 使用方式：
#   cd docker && docker compose up --build
#
# Scheduler API: http://localhost:8080
# Worker Health: http://localhost:8081 (第一个), 8082 (第二个)
# MinIO Console: http://localhost:9001
# PostgreSQL:    localhost:5432

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: codeswarm
      POSTGRES_USER: codeswarm
      POSTGRES_PASSWORD: codeswarm_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U codeswarm"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  # 共享工作区卷（模拟 NFS PVC）
  workspace:
    image: busybox
    command: ["chmod", "777", "/mnt/workspace"]
    volumes:
      - workspace_data:/mnt/workspace

  scheduler:
    build:
      context: ..
      dockerfile: docker/Dockerfile.scheduler
    ports:
      - "8080:8080"
    environment:
      NODE_ENV: development
      PORT: 8080
      DATABASE_URL: postgresql://codeswarm:codeswarm_dev@postgres:5432/codeswarm
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-jwt-secret-change-in-production
      WORKSPACE_BASE_PATH: /mnt/workspace
      LOG_LEVEL: debug
    volumes:
      - workspace_data:/mnt/workspace
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker-1:
    build:
      context: ..
      dockerfile: docker/Dockerfile.worker
    ports:
      - "8081:8080"
    environment:
      NODE_ID: worker-1
      PORT: 8080
      MAX_CONCURRENT: 3
      SCHEDULER_URL: http://scheduler:8080
      WORKER_ADDRESS: worker-1:8080
      WORKSPACE_BASE_PATH: /mnt/workspace
      TASK_TIMEOUT_SEC: "86400"
    volumes:
      - workspace_data:/mnt/workspace
    depends_on:
      - scheduler

  worker-2:
    build:
      context: ..
      dockerfile: docker/Dockerfile.worker
    ports:
      - "8082:8080"
    environment:
      NODE_ID: worker-2
      PORT: 8080
      MAX_CONCURRENT: 3
      SCHEDULER_URL: http://scheduler:8080
      WORKER_ADDRESS: worker-2:8080
      WORKSPACE_BASE_PATH: /mnt/workspace
      TASK_TIMEOUT_SEC: "86400"
    volumes:
      - workspace_data:/mnt/workspace
    depends_on:
      - scheduler

volumes:
  pgdata:
  minio_data:
  workspace_data:              # 模拟 NFS PVC，所有容器共享
```

### 4.2 Dockerfile.scheduler

```dockerfile
# docker/Dockerfile.scheduler
FROM node:20-bookworm AS builder

WORKDIR /app
RUN corepack enable

# 先复制依赖声明
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY prisma/ ./prisma/

RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/types/ ./packages/types/
COPY packages/scheduler/ ./packages/scheduler/
COPY tsconfig.base.json ./

# 构建
RUN pnpm --filter @codeswarm/scheduler build
RUN pnpm --filter @codeswarm/types build

# 生成 Prisma Client
RUN npx prisma generate

# 生产镜像
FROM node:20-bookworm-slim

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/scheduler/dist ./dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### 4.3 Dockerfile.worker

```dockerfile
# docker/Dockerfile.worker
FROM node:20-bookworm AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/acp/package.json ./packages/acp/
COPY packages/sdk-adapter/package.json ./packages/sdk-adapter/
COPY packages/worker/package.json ./packages/worker/

RUN pnpm install --frozen-lockfile

COPY packages/types/ ./packages/types/
COPY packages/acp/ ./packages/acp/
COPY packages/sdk-adapter/ ./packages/sdk-adapter/
COPY packages/worker/ ./packages/worker/
COPY tsconfig.base.json ./

RUN pnpm -r build

# 生产镜像 — 需要预装 AI 引擎
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# 安装 opencode + claude-agent-acp（生产环境预装）
RUN npm install -g opencode-ai@latest 2>/dev/null || true
RUN npm install -g @agentclientprotocol/claude-agent-acp@latest 2>/dev/null || true

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/acp/dist ./packages/acp/dist
COPY --from=builder /app/packages/sdk-adapter/dist ./packages/sdk-adapter/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist

EXPOSE 8080
CMD ["node", "packages/worker/dist/index.js"]
```

### 4.4 本地调试流程

```bash
# 1. 启动全套环境
cd docker && docker compose up --build

# 2. 初始化数据库（首次）
docker compose exec scheduler npx prisma db push
docker compose exec scheduler npx prisma db seed   # 可选

# 3. 验证 Scheduler
curl http://localhost:8080/health
# → { nodeId: "scheduler", workers: 2, queueDepth: 0 }

# 4. 验证 Worker 注册
curl http://localhost:8080/api/node/list
# → { workers: [{ nodeId: "worker-1", status: "online" }, ...] }

# 5. 提交测试任务
curl -X POST http://localhost:8080/api/task/submit \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "列出当前目录文件",
    "engine": "opencode",
    "agent": "build",
    "workspacePath": "/mnt/workspace/test-001",
    "platformTaskId": "test-001",
    "callbackUrl": "http://host.docker.internal:3000/api/platform/task-callback"
  }'

# 6. 查看任务状态
curl http://localhost:8080/api/task/list

# 7. SSE 事件流
curl -N http://localhost:8080/api/task/{taskId}/stream

# 8. Prometheus 指标
curl http://localhost:8080/metrics
```

---

## 5. API 契约

### 5.1 Worker → Scheduler（Worker 主动调用）

| 方法 | 路径 | 说明 | 现有对应 |
|------|------|------|---------|
| POST | `/api/worker/heartbeat` | 心跳注册 + 拓扑同步 | `worker/heartbeat/route.ts` |
| POST | `/api/worker/event` | 实时事件上报 | `worker/event/route.ts` |
| POST | `/api/worker/result` | 任务完成/失败回调 | `worker/result/route.ts` |

心跳体不变：
```json
{
  "nodeId": "worker-1",
  "maxConcurrent": 5,
  "currentTasks": 2,
  "address": "10.0.1.5:8080",
  "systemType": "linux",
  "arch": "x64",
  "status": "online"          // 新增：online / draining
}
```

### 5.2 Scheduler → Worker（Scheduler 主动推送）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `http://{addr}/task` | 分发任务 |
| POST | `http://{addr}/config` | 配置推送（maxConcurrent） |
| POST | `http://{addr}/task/cancel` | 取消任务 |
| GET  | `http://{addr}/health` | 健康检查 |

任务 payload 不变（复用 `TaskPayloadSchema`），新增字段：
```json
{
  "taskId": "task-xxx",
  "instruction": "...",
  "workspacePath": "/mnt/workspace/task-xxx/",   // Scheduler 自动分配或平台指定
  "callbackUrl": "http://scheduler:8080",         // Worker 回调到 Scheduler，而非平台
  // ... 其他字段不变
}
```

**关键变化**：Worker 的 `callbackUrl` 指向 Scheduler（而非平台），Scheduler 收到 result 后再回调平台。

### 5.3 外部平台 → Scheduler（供所有平台调用）

#### 任务管理

```
POST /api/task/submit                # 提交任务（核心入口）
请求体:
{
  // 必填
  "instruction": "分析安全漏洞",       // AI 执行指令
  "platformTaskId": "ti-xxx",        // 平台侧关联 ID
  "callbackUrl": "http://platform/api/platform/task-callback",  // 平台回调地址

  // 可选 — 工作区
  "workspacePath": "/mnt/workspace/task-xxx/",  // 指定路径，空则自动分配
  "projectPath": "/path/to/project",            // 本地项目（非 PVC 模式）

  // 可选 — Agent 配置
  "engine": "opencode",               // opencode | claudecode
  "agent": "nazhua-audit",            // Agent 名称
  "model": "anthropic/claude-sonnet-4-6",
  "apiKey": "sk-xxx",                 // API Key
  "apiBaseUrl": "https://api.xxx.com",
  "timeoutSec": 3600,

  // 可选 — 任务参数
  "skills": ["security-audit"],
  "mcps": [...],
  "env": { "KEY": "VALUE" },
  "preferredWorkerNodeId": "worker-1",
  "targetProduct": "product-name",
  "maxTokens": 8192,
  "contextWindow": 200000
}

响应:
{
  "taskId": "task-1731234567-abc",
  "dbTaskId": "db-xxx",
  "workspacePath": "/mnt/workspace/task-1731234567-abc/",  // 实际使用的工作区路径
  "queued": true
}

GET  /api/task/list                   # 任务列表
GET  /api/task/:taskId                # 任务详情（含事件流）
DELETE /api/task/:taskId              # 删除任务（自动 cancel Worker）
POST /api/task/:taskId/dispatch       # 手动重新分发
POST /api/task/:taskId/cancel         # 取消任务

DELETE /api/task/batch                 # 批量删除
请求体: { "taskIds": ["task-1", "task-2"] }
```

#### Worker 节点管理

```
GET    /api/node/list                 # 节点列表
GET    /api/node/:nodeId              # 节点详情（含最近 20 条任务）
PATCH  /api/node/:nodeId              # 更新配置
请求体: { "maxConcurrent": 10 }
DELETE /api/node/:nodeId              # 删除节点
```

#### SSE 事件流

```
GET /api/task/:taskId/stream          # SSE 实时事件
响应: Content-Type: text/event-stream

data: {"type":"connected","taskId":"task-xxx"}
data: {"type":"agent_message_chunk","data":{...},"timestamp":"..."}
data: {"type":"tool_call","data":{...},"timestamp":"..."}
data: {"type":"task_complete","state":"completed","timestamp":"..."}
```

#### 健康检查 + 指标

```
GET /health                           # 健康状态
响应: { nodeId, workers, queueDepth, uptime }

GET /metrics                          # Prometheus 指标
```

### 5.4 Scheduler → 外部平台（回调）

任务完成时，Scheduler 主动回调平台：

```
POST {callbackUrl}                    # 平台提供的回调地址
请求体:
{
  "event": "task_completed",          // task_completed | task_failed
  "taskId": "task-xxx",
  "platformTaskId": "ti-xxx",        // 平台创建时传入的关联 ID
  "status": "completed",             // completed | failed
  "result": "...",                    // stdout 输出
  "error": null,                      // 错误信息
  "reportContent": "...",             // 安全报告
  "workspacePath": "/mnt/workspace/task-xxx/",
  "nodeId": "worker-1"
}
```

平台收到回调后的处理：
1. 更新 `TaskInstance` 状态（completed/failed）
2. 写入 `TaskExecutionLog`
3. 触发漏洞解析（如已完成）
4. 推送 SSE 事件到前端

---

## 6. 数据模型

### 6.1 Scheduler 独占的表（Prisma 管理）

```prisma
// prisma/schema.prisma — Scheduler 微服务的数据库模型

model CodeswarmTask {
  id                    String    @id @default(cuid())
  taskId                String    @unique
  workerId              String?
  state                 String    @default("queued")   // queued/dispatched/running/completed/failed/cancelled
  instruction           String?
  projectPath           String?
  workspacePath         String?
  gitUrl                String?
  gitRef                String?
  skills                String?                          // JSON
  scripts               String?                          // JSON
  mcps                  String?                          // JSON
  model                 String?
  apiKey                String?
  timeoutSec            Int?
  engine                String?
  agent                 String?
  preferredWorkerNodeId String?
  targetProduct         String?
  apiBaseUrl            String?
  maxTokens             Int?
  contextWindow         Int?
  platformTaskId        String?                          // 外部平台关联 ID
  platformCallbackUrl   String?                          // 平台回调地址
  sessionId             String?
  events                String?   @db.Text               // legacy JSON
  result                String?   @db.Text
  error                 String?   @db.Text
  reportContent         String?   @db.Text
  startedAt             DateTime?
  completedAt           DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  CodeswarmWorker       CodeswarmWorker? @relation(fields: [workerId], references: [id])
  CodeswarmEvents       CodeswarmEvent[]

  @@index([createdAt])
  @@index([workerId])
  @@index([state])
  @@index([platformTaskId])
}

model CodeswarmWorker {
  id            String    @id @default(cuid())
  nodeId        String    @unique
  address       String    @default("")
  systemType    String?
  arch          String?
  status        String    @default("offline")  // online/offline/draining
  maxConcurrent Int        @default(5)
  currentTasks  Int        @default(0)
  lastHeartbeat DateTime   @default(now())
  token         String?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  CodeswarmTasks CodeswarmTask[]
}

model CodeswarmEvent {
  id        String   @id @default(cuid())
  taskId    String                        // 关联 CodeswarmTask.taskId
  type      String
  data      String   @db.Text             // JSON string
  level     String?                        // worker | agent
  stream    String?                        // stdout | stderr
  createdAt DateTime @default(now())

  @@index([taskId])
  @@index([taskId, createdAt])
  @@index([taskId, level])
}
```

### 6.2 跨服务只读访问

Scheduler 的僵尸检测需要查询 `TaskInstance` 表。两种方案：

**方案 A（推荐）：Scheduler 保留 TaskInstance 只读访问**
- Prisma schema 中添加 `TaskInstance` 模型（只读，不写入）
- 僵尸检测 SQL 不需要改动
- 前提：Scheduler 和 Platform 共享同一 PostgreSQL 数据库

**方案 B：平台提供查询 API**
- Scheduler 通过 HTTP 查询平台的 TaskInstance 状态
- 需要新增 API 端点，增加延迟
- 适合数据库完全隔离的场景

本设计采用 **方案 A**，因为同一集群且同一数据库。

---

## 7. PVC 工作区管理

### 7.1 路径分配

```typescript
// packages/scheduler/src/services/workspace.ts

const WORKSPACE_BASE = process.env.WORKSPACE_BASE_PATH || '/mnt/workspace';

/**
 * 为任务分配工作区路径
 * 规则：
 *   1. 平台指定了 workspacePath → 直接使用（信任外部指定）
 *   2. 未指定 → 自动生成 /mnt/workspace/{taskId}/
 */
export function allocateWorkspacePath(taskId: string, specified?: string): string {
  if (specified) return specified;
  return `${WORKSPACE_BASE}/${taskId}`;
}

/**
 * 确保工作区目录存在且有正确权限
 */
export async function ensureWorkspaceDir(path: string): Promise<void> {
  fs.mkdirSync(path, { recursive: true });
  // NFS 场景下权限由 initContainer 或 fsGroup 保证
}

/**
 * 清理单个工作区
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  if (!workspacePath.startsWith(WORKSPACE_BASE)) return; // 不清理非 PVC 路径
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

/**
 * 定时清理过期工作区（每天执行）
 */
export async function cleanupExpiredWorkspaces(): Promise<number> {
  const retentionDays = parseInt(process.env.TASK_CLEANUP_RETENTION_DAYS || '30');
  const cutoff = new Date(Date.now() - retentionDays * 86400000);

  const expired = await prisma.codeswarmTask.findMany({
    where: {
      state: { in: ['completed', 'failed'] },
      completedAt: { lt: cutoff },
      workspacePath: { not: null },
    },
    select: { taskId: true, workspacePath: true },
    take: 100,
  });

  for (const t of expired) {
    await cleanupWorkspace(t.workspacePath!);
  }
  return expired.length;
}
```

### 7.2 本地 Docker 调试

本地使用 Docker Volume 模拟 PVC：

```yaml
# docker-compose.yml 中
volumes:
  workspace_data:              # Docker 管理的命名卷，所有容器共享

services:
  scheduler:
    volumes:
      - workspace_data:/mnt/workspace
  worker-1:
    volumes:
      - workspace_data:/mnt/workspace
  worker-2:
    volumes:
      - workspace_data:/mnt/workspace
```

### 7.3 生产 K8s PVC

```yaml
# k8s/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-workspace
  namespace: codeswarm
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nfs
  resources:
    requests:
      storage: 100Gi
```

---

## 8. HPA 弹性伸缩

### 8.1 指标定义

Scheduler `/metrics` 端点暴露：

```
# HELP codeswarm_queue_depth Number of tasks in queued state
# TYPE codeswarm_queue_depth gauge
codeswarm_queue_depth 5

# HELP codeswarm_workers_online Number of online workers
# TYPE codeswarm_workers_online gauge
codeswarm_workers_online 3

# HELP codeswarm_workers_capacity_total Total task capacity across all workers
# TYPE codeswarm_workers_capacity_total gauge
codeswarm_workers_capacity_total 15

# HELP codeswarm_workers_capacity_used Currently used task slots
# TYPE codeswarm_workers_capacity_used gauge
codeswarm_workers_capacity_used 8

# HELP codeswarm_tasks_completed_total Total completed tasks
# TYPE codeswarm_tasks_completed_total counter
codeswarm_tasks_completed_total 142

# HELP codeswarm_tasks_failed_total Total failed tasks
# TYPE codeswarm_tasks_failed_total counter
codeswarm_tasks_failed_total 7
```

### 8.2 HPA 规则

```yaml
# k8s/worker-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: worker-hpa
  namespace: codeswarm
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: worker
  minReplicas: 1
  maxReplicas: 20
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300    # 5min 观察窗口
      policies:
        - type: Pods
          value: 1                        # 每次最多缩 1 个 Pod
          periodSeconds: 120
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 3                        # 每次最多扩 3 个 Pod
          periodSeconds: 60
  metrics:
    - type: External
      external:
        metric:
          name: codeswarm_queue_depth
        target:
          type: AverageValue
          averageValue: "2"               # 每个 Pod 处理 2 个排队任务
```

### 8.3 Worker 缩容安全（Draining）

现有 `daemon.ts` 的 `shutdown()` 已处理 SIGTERM。改造：

```typescript
// packages/worker/src/daemon.ts

private draining = false;

async shutdown() {
  this.draining = true;
  logger.info('Worker entering draining mode, active tasks: ' + this.activeTasks.size);

  // 停止接受新任务（心跳上报 status='draining'）
  // Scheduler 的 selectWorker() 会跳过 draining 状态的 Worker

  // 等待活跃任务完成或超时强制中断
  if (this.activeTasks.size > 0) {
    const gracefulTimeout = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || '300000'); // 默认 5min
    const deadline = Date.now() + gracefulTimeout;

    while (this.activeTasks.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      logger.info(`Draining: ${this.activeTasks.size} tasks remaining`);
    }

    // 超时后强制处理
    for (const [taskId, payload] of this.activeTasks) {
      await this.postResult(payload, {
        taskId, nodeId: this.config.nodeId,
        status: 'failed', error: 'Worker shutting down, task interrupted',
      });
    }
  }

  // 清理
  for (const [taskId] of this.activeTasks) {
    await this.processMgr.terminate(taskId);
  }
  await this.server.close();
}
```

---

## 9. 代码迁移清单

### 9.1 整体搬入（零改动或微改）

| 源 | 目标 | 改动 |
|----|------|------|
| `codeswarm/packages/types/**` | `packages/types/**` | 无 |
| `codeswarm/packages/acp/**` | `packages/acp/**` | 无 |
| `codeswarm/packages/sdk-adapter/**` | `packages/sdk-adapter/**` | 无 |
| `codeswarm/packages/worker/semaphore.ts` | `packages/worker/src/` | 无 |
| `codeswarm/packages/worker/agent-runner.ts` | `packages/worker/src/` | 无 |
| `codeswarm/packages/worker/codedmap-manager.ts` | `packages/worker/src/` | 无 |
| `codeswarm/packages/worker/minio-client.ts` | `packages/worker/src/` | 无 |
| `codeswarm/packages/worker/logger.ts` | `packages/worker/src/` | 无 |
| `codeswarm/packages/worker/process-manager.ts` | `packages/worker/src/` | 无 |

### 9.2 搬入 + 改造

| 源 | 目标 | 改动 |
|----|------|------|
| `codeswarm/packages/worker/daemon.ts` | `packages/worker/src/` | `ORCHESTRATOR_URL` → `SCHEDULER_URL`；新增 draining 状态；心跳上报新增 `status` 字段 |
| `codeswarm/packages/worker/index.ts` | `packages/worker/src/` | 适配新环境变量名 |
| `codeswarm/packages/worker/environment.ts` | `packages/worker/src/` | 新增 PVC 自动路径创建逻辑 |
| `src/services/codeswarm-dispatcher.ts` | `packages/scheduler/src/dispatcher.ts` | 移除 `@/lib/*` 依赖，改用本地 prisma/logger |
| `src/lib/codeswarm-worker-auth.ts` | `packages/scheduler/src/auth.ts` | 搬入即可 |
| `src/lib/prisma.ts` (withDeadlockRetry) | `packages/scheduler/src/prisma.ts` | 只搬 retry 逻辑 |
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | `packages/scheduler/src/routes/worker.ts` | NextResponse → Fastify reply；移除 address 冲突清理中对 dispatcher 方法的调用（统一到 dispatcher 内部） |
| `src/app/api/codeswarm/worker/result/route.ts` | `packages/scheduler/src/routes/worker.ts` | **移除**漏洞解析、TaskExecutionLog、eventBus；改为调用 platform callback |
| `src/app/api/codeswarm/worker/event/route.ts` | `packages/scheduler/src/routes/worker.ts` | **移除** TaskExecutionLog 写入 |
| `src/app/api/codeswarm/tasks/route.ts` | `packages/scheduler/src/routes/task.ts` | **移除** ModelConfig 解析；新增 platformTaskId/callbackUrl 参数 |
| `src/app/api/codeswarm/tasks/[taskId]/*.ts` | `packages/scheduler/src/routes/task.ts` | 合并到统一路由 |
| `src/app/api/codeswarm/nodes/*.ts` | `packages/scheduler/src/routes/nodes.ts` | 合并到统一路由 |
| `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts` | `packages/scheduler/src/routes/stream.ts` | 改为 Fastify SSE 实现 |
| `src/lib/task-cleanup.ts` | `packages/scheduler/src/services/workspace.ts` | PVC 目录清理部分搬入 |

### 9.3 平台侧改造

| 文件 | 操作 |
|------|------|
| `instrumentation.ts` | 删除 Step 7（Dispatcher 初始化） |
| `src/services/codeswarm-dispatcher.ts` | **删除** |
| `src/lib/codeswarm-worker-auth.ts` | **删除**（已搬入 Scheduler） |
| `src/app/api/codeswarm/` 全部 13 个 route.ts | **改为 proxy**，转发到 Scheduler Service |
| `src/app/api/task-builder/tasks/[id]/execute/route.ts` | 改为 HTTP 调用 Scheduler API |
| `src/app/api/task-builder/tasks/[id]/stop/route.ts` | 改为 HTTP 调用 Scheduler API |
| `src/components/codeswarm/VulnReparsePanel.tsx` | **删除** |
| `src/app/dashboard/codeswarm/page.tsx` | 移除 VulnReparsePanel Tab |
| 新增 `src/app/api/platform/task-callback/route.ts` | 接收 Scheduler 的任务完成通知 |
| 新增 `SCHEDULER_SERVICE_URL` 环境变量 | 指向 Scheduler K8s Service |

### 9.4 Proxy 路由模式

平台侧所有 codeswarm API route 统一改为轻量 proxy：

```typescript
// src/app/api/codeswarm/[...path]/route.ts（catch-all 代理）
// 或者逐个文件改为 proxy

const SCHEDULER_URL = process.env.SCHEDULER_SERVICE_URL || 'http://localhost:8080';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetPath = url.pathname.replace('/api/codeswarm', '');
  const resp = await fetch(`${SCHEDULER_URL}${targetPath}`, {
    headers: forwardHeaders(request),
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}

// POST、PATCH、DELETE 同理
// SSE stream 路由特殊处理：透传 Content-Type: text/event-stream
```

---

## 10. 实施阶段

### Phase 0: 项目骨架 + Docker 环境（0.5 天）

- [ ] 创建 `codeswarm-service/` 目录结构
- [ ] 初始化 pnpm workspace + tsconfig
- [ ] 搬入 `packages/types`、`packages/acp`、`packages/sdk-adapter`
- [ ] 创建 Prisma schema（3 个核心模型）
- [ ] 编写 `docker-compose.yml` + 两个 Dockerfile
- [ ] 编写 `.env.example`
- [ ] 验证：`docker compose up` 能启动 PostgreSQL + Redis

### Phase 1: Worker 独立化（1 天）

- [ ] 搬入 `packages/worker/` 全部文件
- [ ] 改造 `daemon.ts`（`SCHEDULER_URL` + draining 状态）
- [ ] 改造 `environment.ts`（PVC 自动路径）
- [ ] 验证：Worker 容器独立启动，连接 Scheduler

### Phase 2: Scheduler 核心（2 天）

- [ ] 搬入并改造 `dispatcher.ts`
- [ ] 创建 Fastify server + 路由
- [ ] 实现 5 组 API 路由（task/worker/nodes/stream/platform）
- [ ] 实现 workspace 管理服务
- [ ] 实现 `/metrics` 指标端点
- [ ] 验证：完整链路（submit → dispatch → Worker 执行 → result → callback）

### Phase 3: 平台侧解耦（1.5 天）

- [ ] 删除 dispatcher + worker-auth
- [ ] `instrumentation.ts` 移除 Step 7
- [ ] API route 改 proxy
- [ ] 新增 platform callback 路由
- [ ] task-builder 改为调用 Scheduler API
- [ ] 删除 VulnReparsePanel
- [ ] 验证：前端操作全部正常

### Phase 4: K8s 部署（1 天）

- [ ] 编写全套 K8s manifests
- [ ] PVC + StorageClass 配置
- [ ] HPA + ServiceMonitor
- [ ] 部署到测试集群
- [ ] 灰度验证

### Phase 5: 集成测试（1 天）

- [ ] 端到端链路验证
- [ ] HPA 扩缩容验证
- [ ] Worker draining 安全缩容
- [ ] PVC workspace 创建和清理
- [ ] SSE 实时事件流
- [ ] 掉线检测 + 任务重调度

**总估算：7 天**

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Scheduler 单点（内存 Worker Map） | 进程重启丢失拓扑 | Worker 30s 心跳快速恢复；DB 持久化兜底 |
| DB 共享写入冲突 | 两套 Prisma 连接池 | 表级隔离：Scheduler 写 Codeswarm* 表，Platform 写 TaskInstance |
| SSE 跨服务转发延迟 | 前端感知延迟增加 | Redis PubSub 替代 DB 轮询，延迟 <100ms |
| Worker 冷启动慢（引擎安装） | HPA 扩容延迟 | Dockerfile 预装二进制，镜像内包含所有引擎 |
| PVC 目录权限问题 | Worker 无法写入 | Pod securityContext.fsGroup + initContainer chmod |

---

## 12. 本地调试 → K8s 部署的过渡路径

```
阶段 1: 本地 Docker 调试（开发验证）
  docker-compose up
  ├── PostgreSQL (Docker 容器)
  ├── Redis (Docker 容器)
  ├── MinIO (Docker 容器)
  ├── Scheduler (Docker 容器, 挂载 Docker Volume)
  └── Worker × 2 (Docker 容器, 挂载同一 Docker Volume)

阶段 2: K8s 部署（生产环境）
  kubectl apply -f k8s/
  ├── PostgreSQL (可能用外部实例或 K8s StatefulSet)
  ├── Redis (K8s Deployment 或外部实例)
  ├── MinIO (K8s Deployment 或外部实例)
  ├── PVC (NFS StorageClass)
  ├── Scheduler Deployment (1 副本)
  └── Worker Deployment + HPA (1~20 副本)

  过渡方式：
  1. Docker Compose 验证通过 → 镜像直接复用到 K8s
  2. Docker Volume → K8s PVC（只改挂载配置）
  3. 环境变量从 .env.docker → K8s ConfigMap/Secret
```
