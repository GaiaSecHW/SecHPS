# CLAUDE.md

## Project Overview

CodeSwarm Service — 分布式 AI Agent 任务调度微服务。基于 Fastify + Redis + Prisma + PostgreSQL 的 Scheduler/Worker 架构，支持多 Worker 节点、ACP 协议、Claude Agent SDK。

## Commands

```bash
pnpm install                # 安装依赖
pnpm run build              # 构建所有包（types → acp → sdk-adapter → worker → scheduler → debug-ui）
pnpm run typecheck          # TypeScript 类型检查
pnpm run dev:scheduler      # 开发模式启动 Scheduler
pnpm run dev:worker         # 开发模式启动 Worker
pnpm run dev:debug-ui       # 开发模式启动 Debug UI

# 数据库
pnpm run db:generate        # 生成 Prisma Client
pnpm run db:push            # 推送 schema 到数据库

# Docker
cd docker && docker compose up --build   # 本地完整环境（PostgreSQL + Redis + MinIO + Scheduler + Workers）

# 脚本
bash scripts/build.sh       # 构建
bash scripts/dev.sh         # 开发环境初始化
```

## Tech Stack

- TypeScript 5.8 + Node.js 20 + pnpm workspace monorepo
- Fastify 5（Scheduler/Worker HTTP 服务）
- Prisma 6 + PostgreSQL（3 模型：CodeswarmTask、CodeswarmWorker、CodeswarmEvent）
- ioredis（Redis Stream 任务队列）
- MinIO（对象存储，报告/工作区文件）
- Zod（运行时 schema 验证）
- @agentclientprotocol/sdk（ACP Agent 协议）
- @anthropic-ai/claude-agent-sdk（Claude Agent SDK）
- Vite + React + Tailwind（Debug UI）

## Architecture

### 目录结构

```
项目根目录/
├── packages/
│   ├── types/         # @codeswarm/types — 共享 Zod 类型定义
│   ├── acp/           # @codeswarm/acp — ACP 协议适配
│   ├── sdk-adapter/   # @codeswarm/sdk-adapter — Claude Agent SDK 适配
│   ├── scheduler/     # @codeswarm/scheduler — 调度器微服务
│   │   ├── src/
│   │   │   ├── index.ts        # 入口（启动 Fastify + Dispatcher）
│   │   │   ├── server.ts       # Fastify HTTP 路由注册
│   │   │   ├── dispatcher.ts   # Redis Stream 任务调度核心
│   │   │   ├── auth.ts         # JWT 认证
│   │   │   ├── prisma.ts       # Prisma Client + 死锁重试
│   │   │   ├── routes/         # API 路由（task, worker, nodes, stream, platform）
│   │   │   └── services/       # 指标采集、工作区管理
│   │   └── dist/               # 编译输出
│   ├── worker/        # @codeswarm/worker — Worker 执行守护进程
│   │   ├── src/
│   │   │   ├── daemon.ts           # Worker 主循环（心跳、任务接收、报告轮询）
│   │   │   ├── agent-runner.ts     # Agent 执行（OpenCode/Claude Code）
│   │   │   ├── environment.ts      # 运行环境工厂
│   │   │   ├── process-manager.ts  # 子进程管理 + 事件流
│   │   │   ├── minio-client.ts     # MinIO 上传
│   │   │   └── semaphore.ts        # 并发控制
│   │   └── dist/
│   └── debug-ui/      # @codeswarm/debug-ui — Vite + React 调试面板
├── prisma/
│   └── schema.prisma  # 3 模型数据库 schema
├── docker/            # Docker 部署配置
│   ├── Dockerfile.scheduler
│   ├── Dockerfile.worker
│   ├── docker-compose.yml
│   └── .env.docker
├── k8s/               # Kubernetes 部署配置
├── scripts/           # 构建/开发脚本
├── package.json       # pnpm monorepo 根配置
└── tsconfig.json      # 共享 TypeScript 配置
```

### 调度流程

```
外部平台/用户 → POST /api/task/create → Scheduler
  → Redis Stream (codeswarm:task:queue) → Dispatcher 消费
  → 选择可用 Worker → 两阶段原子分发
  → Worker 拉取执行 → Agent Runner (OpenCode/Claude Code)
  → 结果/事件回调 → Scheduler → HTTP callback 到外部平台
```

### API 路由

| 路由组 | 前缀 | 说明 |
|--------|------|------|
| Worker | `/api/worker/*` | 心跳、事件上报、结果回调 |
| Task | `/api/task/*` | 任务创建、查询、取消、重试（支持 Tool 调度模式） |
| Nodes | `/api/nodes/*` | Worker 节点管理 |
| Stream | `/api/stream/*` | SSE 事件流推送 |
| Platform | `/api/platform/*` | 平台状态查询（预留） |
| Debug UI | `/debug/*` | SPA 调试面板 |
| Health | `/health` | 健康检查 |
| Metrics | `/metrics` | Prometheus 指标 |

## Code Conventions

1. **称呼规则**: 每次回复前必须使用"Boss"作为称呼
2. **决策确认**: 遇到不确定的设计问题，必须先询问 Boss
3. **不写兼容性代码**: 除非 Boss 主动要求
4. **中文回答**
5. **大项目拆分**: 大范围任务拆分为更小的计划，避免输出 token 上限

### General

- ESM 模块系统（`"type": "module"`），import 带 `.js` 后缀
- 命名: 函数/变量 camelCase、常量 UPPER_SNAKE_CASE、文件 kebab-case
- Zod schema 做运行时验证，不使用 class-validator
- Prisma 操作统一用 `import { prisma } from './prisma.js'`
- 日志用 `import { logger } from './logger.js'`

## Environment

`.env` 必需：`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`。详见 `.env.example`。

## Database

仅 3 个模型：
- `CodeswarmTask` — 任务（queued → dispatched → running → completed/failed/cancelled）
- `CodeswarmWorker` — Worker 节点注册与心跳
- `CodeswarmEvent` — 任务事件日志
