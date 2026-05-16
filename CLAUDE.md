# CLAUDE.md

## Project Overview

AI4WEB Test Platform - AI 驱动的编码辅助平台。Next.js 16 + React 19 + TypeScript + Prisma + PostgreSQL。

## Commands

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建（含 postbuild）
npm start            # 生产运行
npm run lint         # 代码检查
npm run db:generate  # 生成 Prisma Client
npm run db:push      # 推送 schema 到数据库
npm run db:seed      # 种子数据
```

## Tech Stack

- Next.js 16 App Router + React 19 + Tailwind CSS 4
- Prisma ORM + PostgreSQL
- JWT + bcryptjs 认证（`src/lib/auth.ts`）
- @xyflow/react 工作流编辑器
- Claude Router 多 AI 模型路由（`src/lib/claude-router/`，已排除 TS 编译）

## Architecture

### Key Directories

- `src/app/api/` — REST API 路由
- `src/app/dashboard/` — 受保护的页面
- `src/components/` — UI 组件（workflow/、chat/、terminal/、skills/ 等）
- `src/lib/` — 核心库（auth、tenant、prisma、workflow、agent 等）
- `src/types/` — 类型定义（permissions、workflow、config）
- `prisma/schema.prisma` — 数据库 schema

### Multi-Tenancy（关键设计）

三 类用户，应用层隔离：

| User Type | Tenant Binding | Access Scope |
|-----------|---------------|--------------|
| Platform Admin | `tenantId=null` | 所有数据 |
| ICSL Tenant | `isIcsTenant=true` | 所有数据 |
| Regular Tenant | `tenantId=<id>` | 本租户 + 公开数据 |

核心文件：
- `src/lib/tenant.ts` — TenantContext 解析
- `src/lib/tenant-filter.ts` — `buildTenantFilter()` 租户隔离查询
- `src/lib/api-auth.ts` — `authenticateRequestEnhanced()` 带租户上下文认证

业务表（AgentApp、Project、Workflow、Skill、AgentTeam、ModelConfig、McpServerConfig、TaskInstance）含 `tenantId`（nullable）和 `isPublic` 字段。

详细设计见 `docs/multi-tenant-design.md`。

### API Pattern

所有 API 路由：JWT 验证 → 权限检查 → 租户上下文解析 → 租户隔离过滤 → 业务逻辑。

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

## Test Accounts

`npm run db:seed` 后可用：
- **Platform Admin**: `admin` / `admin123`（admin@ai4web.com）
- **ICSL User**: `icsl_user`
- **Regular Tenant**: `team_a_user`

## Environment

`.env` 必需：`DATABASE_URL`、`JWT_SECRET`、`NODE_ENV`。详见 `.env.example`。
