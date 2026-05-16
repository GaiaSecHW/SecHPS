# AI4WEB Test Platform

AI 驱动的编码辅助测试平台，支持多租户、RBAC 权限、工作流编排、AI 模型路由、分布式任务调度等功能。

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **数据库**: Prisma 6 + PostgreSQL
- **认证**: JWT + bcryptjs（RBAC，5 种默认角色）
- **工作流**: @xyflow/react 可视化编辑器
- **AI 路由**: 多模型统一路由（OpenAI、Anthropic、Gemini、DeepSeek 等）
- **任务调度**: CodeSwarm（Redis 队列 + Worker）
- **文件存储**: Gitea（AgentApp/Skill）+ NFS/SFTP

## 功能模块

- **多租户管理** — 平台管理员、ICSL 租户、普通租户三类用户，应用层数据隔离
- **RBAC 权限** — 动态角色权限分配，模块级粒度控制
- **Agent 管理** — AgentApp、AgentDefinition、AgentTeam（多智能体编排）
- **工作流引擎** — 可视化拖拽编辑，拓扑排序执行
- **Skill 系统** — 技能构建、分类、去重、Gitea 同步
- **评估系统** — 代码扫描评估、漏洞管理、Skill 进化
- **CodeSwarm** — 分布式任务调度、Worker 管理
- **MCP Server** — 模型上下文协议管理
- **插件系统** — 可扩展插件架构

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
npm run db:push    # 推送 schema
npm run db:seed    # 种子数据
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
│   ├── api/               # 40+ REST API 端点
│   ├── dashboard/         # 受保护的管理页面
│   ├── login/             # 登录页
│   └── layout.tsx         # 根布局
├── components/            # UI 组件
│   ├── workflow/          # 工作流编辑器
│   ├── chat/              # 聊天组件
│   ├── terminal/          # 终端组件
│   ├── skills/            # 技能管理
│   └── ...
├── lib/                   # 核心库
│   ├── auth.ts            # JWT 认证
│   ├── api-auth.ts        # API 认证中间件
│   ├── tenant.ts          # 多租户上下文
│   ├── tenant-filter.ts   # 租户隔离过滤
│   ├── prisma.ts          # Prisma 单例
│   ├── claude-router/     # AI 模型路由
│   └── ...
├── types/                 # 类型定义
└── prisma/
    └── schema.prisma      # 数据库 Schema
```

## 常用命令

```bash
npm run dev           # 开发服务器
npm run build         # 生产构建
npm start             # 生产运行
npm run lint          # 代码检查
npm run test          # 运行测试 (vitest)
npm run db:generate   # 生成 Prisma Client
npm run db:push       # 推送 Schema 变更
npm run db:seed       # 初始化数据
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
| `SFTP_*` / `NFS_*` | 文件存储配置 |

## 部署

详见 [README-DEPLOY.md](./README-DEPLOY.md)。

关键注意：`@anthropic-ai/claude-agent-sdk` 含平台原生二进制，生产安装不能用 `--omit=optional` 或 `--production`。

## 许可证

MIT License
