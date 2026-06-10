# SecHPS

AI 驱动的编码辅助测试平台，支持多租户、RBAC 权限、工作流编排、AI 模型路由、分布式任务调度、代码安全分析等功能。

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + TypeScript 6 + Tailwind CSS 3
- **数据库**: Prisma 6 + PostgreSQL（Drizzle ORM 辅助）
- **认证**: JWT + bcryptjs（RBAC，5 种默认角色）
- **工作流**: @xyflow/react 可视化编辑器 + FSM 状态机引擎
- **AI 路由**: 多模型统一路由（OpenAI、Anthropic、Gemini、DeepSeek 等）
- **任务调度**: CodeSwarm（Redis 队列 + Worker 分布式执行）
- **代码分析**: CodeMap（Python，污点分析、Joern、Neo4j）
- **文件存储**: Gitea（AgentApp/Skill）+ NFS + MinIO
- **测试**: Vitest

## 功能模块

- **多租户管理** — 平台管理员、ICSL 租户、普通租户三类用户，应用层数据隔离
- **RBAC 权限** — 动态角色权限分配，模块级粒度控制
- **Agent 管理** — AgentApp、AgentDefinition、AgentTeam（多智能体编排）
- **AgentFlow** — 可视化管道编辑器，DAG 编排 Agent 执行流程
- **工作流引擎** — 可视化拖拽编辑，DAG 拓扑排序 + FSM 状态机双引擎
- **Skill 系统** — 技能构建、分类、去重、进化、治理、Gitea 同步
- **评估系统** — 代码扫描评估、漏洞管理、Skill 进化
- **CodeSwarm** — 分布式任务调度、Worker 管理、实时状态追踪
- **CodeMap** — Python 代码安全分析引擎（污点分析、数据流、Neo4j 图存储）
- **漏洞管理** — 全生命周期漏洞追踪（发现、确认、误报标记、修复验证）
- **MCP Server** — 模型上下文协议管理
- **插件系统** — 可扩展插件架构
- **实时终端** — WebSocket + node-pty 终端模拟

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，配置 DATABASE_URL、JWT_SECRET 等
```

### 3. 初始化数据库

```bash
npm run db:push              # 推送 schema
npm run db:seed              # 种子数据（用户 + 角色 + 权限）
npm run db:seed-techstack    # 技术栈种子数据
npm run db:seed-agents       # Agent 定义种子数据
npm run db:seed-fsm          # FSM 模板种子数据
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000，使用 `admin` / `admin123` 登录。

## 项目结构

```
src/
├── app/
│   ├── api/                    # 40+ REST API 端点
│   │   ├── admin/              # 管理后台 API
│   │   ├── agent-apps/         # Agent 应用管理
│   │   ├── agentflow-pipelines/ # AgentFlow 管道
│   │   ├── codeswarm/          # CodeSwarm 调度
│   │   ├── skills/             # 技能管理
│   │   ├── vulnerabilities/    # 漏洞管理
│   │   ├── workflows/          # 工作流
│   │   └── ...（auth、users、roles、sessions、projects、models、evaluations 等）
│   ├── dashboard/              # 受保护的管理页面（20+ 模块）
│   ├── login/                  # 登录页
│   └── skills/[id]/            # Skill 详情页
├── components/                 # UI 组件
│   ├── agent-apps/             # Agent 应用管理
│   ├── agentflow-editor/       # AgentFlow 可视化编辑器
│   ├── agentflow-pipeline/     # AgentFlow 管道
│   ├── chat/                   # 聊天组件
│   ├── codeswarm/              # CodeSwarm 管理界面
│   ├── evaluation/             # 评估组件
│   ├── skills/                 # 技能管理
│   ├── terminal/               # 终端组件
│   ├── workflow/               # 工作流编辑器
│   └── ui/                     # 基础 UI 组件
├── hooks/                      # React Hooks（useAuth、useApiFetch 等）
├── lib/                        # 核心库（60+ 文件）
│   ├── auth.ts                 # JWT 认证
│   ├── api-auth.ts             # API 认证中间件
│   ├── tenant.ts               # 多租户上下文
│   ├── tenant-filter.ts        # 租户隔离过滤
│   ├── prisma.ts               # Prisma 单例
│   ├── claude-router/          # AI 模型路由
│   ├── workflow/               # 工作流引擎
│   ├── fsm/                    # 有限状态机
│   └── ...（agent、mcp、vulnerability 等）
├── services/                   # 业务服务层
│   ├── evaluation/             # 评估服务
│   ├── skill-evolution/        # Skill 进化
│   ├── autonomous-evolution/   # 自主进化
│   ├── providers/              # AI 提供商适配
│   └── ...
├── types/                      # 类型定义
└── middleware.ts               # Next.js 中间件

codeswarm-service/              # 分布式调度微服务（Scheduler + Worker + ACP + Types）
plugins/codedmap/               # Python 代码安全分析引擎（污点分析、Joern、Neo4j）
prisma/schema.prisma            # 数据库 Schema（60+ 模型）
scripts/                        # 构建/迁移脚本
plugins/                        # 插件目录
docs/                           # 设计文档与架构图
```

## 常用命令

```bash
npm run dev              # 开发服务器
npm run build            # 生产构建
npm start                # 生产运行
npm run lint             # 代码检查
npm run test             # 运行测试（Vitest）
npm run db:generate      # 生成 Prisma Client
npm run db:push          # 推送 Schema 变更
npm run db:seed          # 初始化数据
```

## 环境变量

详见 `.env.example`。核心配置：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `REDIS_URL` | Redis 连接（CodeSwarm 调度） |
| `NEXT_PUBLIC_BASE_URL` | Worker 回调地址 |
| `GITEA_*` | Gitea 文件同步配置 |
| `NFS_*` | NFS 文件存储配置 |
| `MINIO_*` | MinIO 对象存储配置 |

## 部署

详见 [README-DEPLOY.md](./README-DEPLOY.md)。

关键注意：`@anthropic-ai/claude-agent-sdk` 含平台原生二进制，生产安装不能用 `--omit=optional` 或 `--production`。

## 许可证

MIT License
