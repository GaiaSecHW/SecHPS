# CodeSwarm Service

分布式 AI Agent 任务调度微服务。Scheduler + Worker 架构，Redis 驱动的任务队列，支持多 Worker 节点并行执行。

## 技术栈

- **运行时**: Node.js 20 + TypeScript 5.8（ESM）
- **HTTP 框架**: Fastify 5
- **数据库**: Prisma 6 + PostgreSQL（3 模型）
- **消息队列**: Redis Stream（ioredis）
- **对象存储**: MinIO
- **AI 引擎**: OpenCode CLI + Claude Code CLI（ACP 协议）
- **包管理**: pnpm workspace monorepo

## 子包

| 包名 | 说明 |
|------|------|
| `@codeswarm/types` | 共享 Zod 类型定义 |
| `@codeswarm/acp` | Agent Client Protocol 适配 |
| `@codeswarm/sdk-adapter` | Claude Agent SDK 适配 |
| `@codeswarm/scheduler` | 调度器微服务（HTTP API + Redis Dispatcher） |
| `@codeswarm/worker` | Worker 守护进程（Agent 执行引擎） |
| `@codeswarm/debug-ui` | 调试面板（Vite + React） |

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，配置 DATABASE_URL、REDIS_URL 等
```

### 3. 初始化数据库

```bash
pnpm run db:push        # 推送 schema
pnpm run db:generate    # 生成 Prisma Client
```

### 4. 启动服务

```bash
# 开发模式
pnpm run dev:scheduler   # 调度器（端口 8080）
pnpm run dev:worker      # Worker（端口 8090）

# 或使用 Docker Compose（含 PostgreSQL + Redis + MinIO）
cd docker && docker compose up --build
```

## 项目结构

```
packages/
├── types/           # 共享类型
├── acp/             # ACP 协议适配
├── sdk-adapter/     # Claude Agent SDK 适配
├── scheduler/       # 调度器（Fastify + Redis Dispatcher）
│   └── src/
│       ├── index.ts         # 入口
│       ├── server.ts        # HTTP 服务
│       ├── dispatcher.ts    # 调度核心
│       ├── auth.ts          # JWT 认证
│       ├── routes/          # API 路由
│       └── services/        # 指标、工作区管理
├── worker/          # Worker 执行引擎
│   └── src/
│       ├── daemon.ts        # Worker 主循环
│       ├── environment.ts   # 运行环境
│       ├── process-manager.ts # 子进程管理
│       └── minio-client.ts  # 对象存储
└── debug-ui/        # 调试面板
prisma/
└── schema.prisma    # 3 模型（Task, Worker, Event）
docker/              # Docker 部署配置
k8s/                 # Kubernetes 部署配置
scripts/             # 构建/开发脚本
```

## API

| 路径 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /metrics` | Prometheus 指标 |
| `POST /api/task/create` | 创建任务（支持 Tool 调度：toolId, toolPath, toolWorkDir） |
| `GET /api/task/list` | 任务列表 |
| `POST /api/worker/heartbeat` | Worker 心跳 |
| `POST /api/worker/event` | Worker 事件上报 |
| `POST /api/worker/result` | Worker 结果回调 |
| `GET /api/stream/events/:taskId` | SSE 事件流 |
| `GET /debug/*` | Debug UI |

## 环境变量

详见 `.env.example`。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `REDIS_URL` | Redis 连接 |
| `JWT_SECRET` | JWT 签名密钥 |
| `PORT` | Scheduler 端口（默认 8080） |
| `MINIO_*` | MinIO 对象存储配置 |

## 部署

### Docker Compose（本地开发）

```bash
cd docker && docker compose up --build
```

### Kubernetes（生产）

配置文件在 `k8s/` 目录，包含 Scheduler Deployment、Worker Deployment（含 HPA）、Service、ConfigMap、Secret 等。

## 许可证

MIT License
