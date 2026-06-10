# CLAUDE.md

## Project Overview

SecHPS Test Platform - AI 驱动的编码辅助平台。Next.js 16 + React 19 + TypeScript + Prisma 6 + PostgreSQL。

## Commands

```bash
npm run dev              # 开发服务器
npm run dev:webpack      # 开发服务器（Webpack 模式）
npm run build            # 生产构建（含 postbuild）
npm start                # 生产运行
npm run lint             # 代码检查
npm run test             # 运行测试（Vitest）

# 数据库
npm run db:generate      # 生成 Prisma Client（postinstall 自动执行）
npm run db:push          # 推送 schema 到数据库
npm run db:seed          # 种子数据（用户 + 角色 + 权限）
npm run db:seed-techstack   # 技术栈种子数据
npm run db:seed-agents      # Agent 定义种子数据
npm run db:seed-fsm         # FSM 模板种子数据
```

## Tech Stack

- Next.js 16 App Router + React 19 + TypeScript 6 + Tailwind CSS 3
- Prisma 6 ORM + PostgreSQL（Drizzle ORM 作为辅助）
- JWT + bcryptjs 认证（`src/lib/auth.ts`），RBAC 权限
- @xyflow/react 工作流编辑器
- Claude Router 多 AI 模型路由（`src/lib/claude-router/`，已排除 TS 编译）
- Fastify 高性能 HTTP 服务（`src/lib/api/`）
- WebSocket 实时通信（`ws`）
- Redis 任务队列（CodeSwarm 调度）
- MinIO 对象存储
- Vitest 测试框架

## Architecture

### Key Directories

```
项目根目录/
├── src/
│   ├── app/
│   │   ├── api/                    # 40+ REST API 端点
│   │   ├── dashboard/              # 受保护的管理页面（20+ 模块）
│   │   ├── login/                  # 登录页
│   │   └── skills/[id]/            # Skill 详情页
│   ├── components/                 # UI 组件
│   │   ├── agent-apps/             # Agent 应用管理
│   │   ├── agentflow-editor/       # AgentFlow 可视化编辑器
│   │   ├── agentflow-pipeline/     # AgentFlow 管道管理
│   │   ├── chat/                   # 聊天组件
│   │   ├── codeswarm/              # CodeSwarm 分布式调度（已迁移至 codeswarm-service/）
│   │   ├── evaluation/             # 评估系统
│   │   ├── files/                  # 文件管理
│   │   ├── plugins/                # 插件系统
│   │   ├── skills/                 # 技能管理
│   │   ├── terminal/               # 终端组件
│   │   ├── ui/                     # 基础 UI 组件
│   │   └── workflow/               # 工作流编辑器
│   ├── hooks/                      # React Hooks（useAuth、useApiFetch 等）
│   ├── lib/                        # 核心库（60+ 文件，16+ 子目录）
│   │   ├── api/                    # Fastify API 服务
│   │   ├── audit/                  # 审计模块
│   │   ├── code-analyzer/          # 代码分析
│   │   ├── fsm/                    # 有限状态机
│   │   ├── metrics/                # 指标收集
│   │   ├── middleware/             # 中间件
│   │   ├── monitoring/             # 监控
│   │   ├── reports/                # 报告生成
│   │   ├── vulnerability/          # 漏洞管理
│   │   ├── workflow/               # 工作流引擎
│   │   ├── workflow-actions/       # 工作流动作
│   │   ├── workspace/              # 工作空间管理
│   │   └── ...（auth、tenant、prisma、agent 等）
│   ├── services/                   # 业务服务层（评估、Skill 进化、CodeSwarm 调度等）
│   ├── types/                      # 类型定义（permissions、workflow、config）
│   └── middleware.ts               # Next.js 中间件
├── codeswarm-service/              # 分布式调度微服务（Scheduler + Worker + ACP + Types）
├── plugins/codedmap/               # Python 代码安全分析引擎（污点分析、Joern、Neo4j）
│   └── plugins/codedmap/           # Python 代码分析引擎（污点分析、Joern 集成、Neo4j）
├── prisma/
│   ├── schema.prisma               # 数据库 Schema（60+ 模型）
│   └── seed*.ts                    # 多个种子数据脚本
├── scripts/                        # 构建/迁移脚本
├── plugins/                        # 插件目录
├── skills/                         # Skill 文件
├── docs/                           # 设计文档与架构图
└── instrumentation.ts              # Next.js Instrumentation
```

### Multi-Tenancy（关键设计）

三类用户，应用层隔离：

| User Type | Tenant Binding | Access Scope |
|-----------|---------------|--------------|
| Platform Admin | `tenantId=null` | 所有数据 |
| ICSL Tenant | `isIcsTenant=true` | 所有数据 |
| Regular Tenant | `tenantId=<id>` | 本租户 + 公开数据 |

核心文件：
- `src/lib/tenant.ts` — TenantContext 解析
- `src/lib/tenant-filter.ts` — `buildTenantFilter()` 租户隔离查询
- `src/lib/api-auth.ts` — `authenticateRequestEnhanced()` 带租户上下文认证

业务表含 `tenantId`（nullable）和 `isPublic` 字段：AgentApp、Project、Workflow、Skill、AgentTeam、ModelConfig、McpServerConfig、TaskInstance 等。

详细设计见 `docs/multi-tenant-design.md`。

### API Pattern

所有 API 路由：JWT 验证 → 权限检查 → 租户上下文解析 → 租户隔离过滤 → 业务逻辑。

### 核心子系统

| 子系统 | 关键文件/目录 | 说明 |
|--------|-------------|------|
| Agent 管理 | `src/lib/agent-*.ts`、`src/app/api/agent-apps/` | AgentApp、AgentDefinition、AgentTeam |
| AgentFlow | `src/app/api/agentflow-pipelines/`、`src/components/agentflow-editor/` | 可视化管道编辑器，DAG 编排 |
| CodeSwarm | `codeswarm-service/`、`src/services/codeswarm-dispatcher.ts` | Scheduler + Worker 独立微服务，Redis 驱动的分布式任务调度 |
| CodeMap | `plugins/codedmap/` | Python 代码安全分析（污点分析、Joern、Neo4j） |
| 工作流引擎 | `src/lib/workflow/`、`src/lib/fsm/` | DAG/FSM 双引擎工作流 |
| Skill 系统 | `src/lib/skill-*.ts`、`src/services/skill-*.ts` | 构建、分类、去重、进化、治理 |
| 漏洞管理 | `src/lib/vulnerability/`、`src/app/api/vulnerabilities/` | 全生命周期漏洞追踪 |
| 评估系统 | `src/services/evaluation/`、`src/app/api/evaluations/` | 代码扫描评估 |
| MCP Server | `src/lib/mcp-*.ts`、`src/app/api/mcp-servers/` | 模型上下文协议管理 |
| 插件系统 | `src/services/plugin-*.ts`、`src/app/api/plugins/` | 可扩展插件架构 |

## Code Conventions

1. **称呼规则**: 每次回复前必须使用"Boss"作为称呼
2. **决策确认**: 遇到不确定的设计问题，必须先询问 Boss
3. **不写兼容性代码**: 除非 Boss 主动要求
4. **中文回答**
5. **大项目拆分**: 大范围任务拆分为更小的计划，避免输出 token 上限

### General

- Import 顺序: React → 第三方库 → `@/` 内部模块
- 命名: 组件 PascalCase、函数 camelCase、常量 UPPER_SNAKE_CASE、文件 kebab-case
- 需要客户端组件时加 `'use client'`
- 数据库操作统一用 `import { prisma } from '@/lib/prisma'`
- 漏洞状态使用连字符格式: `false-positive`、`confirmed`、`ignored`

## Test Accounts

`npm run db:seed` 后可用：
- **Platform Admin**: `admin` / `admin123`（admin@SecHPS.com）
- **ICSL User**: `icsl_user`
- **Regular Tenant**: `team_a_user`

## Environment

`.env` 必需：`DATABASE_URL`、`JWT_SECRET`、`NODE_ENV`。详见 `.env.example`。

关键可选配置：
- `REDIS_URL` — CodeSwarm 调度队列
- `NEXT_PUBLIC_BASE_URL` — Worker 回调地址
- `GITEA_*` — Gitea 文件同步
- `NFS_*` — NFS 文件存储
- `MINIO_*` — MinIO 对象存储
