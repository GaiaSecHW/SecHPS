# AI4WEB 测试平台 - 开发指南

Next.js 16 + React 19 + TypeScript App Router 平台，支持 RBAC 权限、会话管理、代码搜索、AI 评估等功能。

## 开发命令

```bash
npm run dev              # 开发服务器 (localhost:3000)
npm run build            # 构建 + postbuild 复制运行时目录
npm run start            # 生产运行 (standalone server)
npm run lint             # 代码检查

# 数据库
npm run db:generate      # 生成 Prisma 客户端 (postinstall 自动执行)
npm run db:push          # 推送 schema 变更
npm run db:seed          # 初始化数据库 + 创建默认管理员
npm run db:seed-techstack  # 技术栈种子数据
```

## 项目结构要点

- **App Router**: `src/app/` - API 路由在 `src/app/api/` (30+ 端点)
- **Prisma**: `prisma/schema.prisma` - 1600+ 行，包含 User/Role/Permission/Workflow/Skill/Vulnerability 等模型
- **Skills**: `data/skills/` - Markdown 格式的 AI 技能定义
- **Plugins**: `plugins/` - 可插拔扩展
- **上传文件**: `uploads/` - 用户上传的项目文件

## 认证模块导入规则 (重要)

**服务端 API 路由** 必须从 `@/lib/auth` 导入:
```typescript
import { verifyToken, hasPermission } from '@/lib/auth';
```

**客户端组件** 必须从 `@/lib/permissions` 导入（避免服务端环境变量检查):
```typescript
import { hasPermission } from '@/lib/permissions';
```

## Prisma 使用规范

- **必须** 从 `@/lib/prisma` 导入 prisma 实例（单例模式）
- Prisma Client 在 `postinstall` 时自动生成
- SQLite 数据库文件: `prisma/dev.db`

```typescript
import { prisma } from '@/lib/prisma';
import type { User, Role } from '@prisma/client';
```

## 权限系统

权限常量在 `@/types/permissions.ts`，格式为 `module:action` (如 `session:create`).

API 路由权限检查模式:
```typescript
const authHeader = request.headers.get('authorization');
if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const token = authHeader.replace('Bearer ', '');
const payload = verifyToken(token);
if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_CREATE)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

默认角色: `admin`, `manager`, `developer`, `user`, `viewer`
默认管理员: `admin@ai4web.com` / `admin123` (seed 创建)

## API 路由结构

```
src/app/api/
├── auth/          # 认证 (login, register)
├── users/         # 用户管理
├── roles/         # 角色管理
├── permissions/   # 权限管理
├── sessions/      # 评估会话
├── projects/      # 项目管理
├── workflows/     # 工作流编排
├── skills/        # AI 技能定义
├── evaluations/   # AI 评估执行
├── models/        # 模型配置
├── mcp-servers/   # MCP 服务器配置
├── plugins/       # 插件管理
├── vulnerabilities/ # 漏洞管理
└── ...
```

## 客户端组件规范

使用 hooks 或浏览器 API 的组件必须添加 `'use client'` 指令:
```typescript
'use client';

import { useState, useEffect } from 'react';
```

## 命名约定

| 类型 | 格式 | 示例 |
|------|------|------|
| 组件 | PascalCase | `UserTable` |
| 函数 | camelCase | `fetchUsers` |
| 常量 | UPPER_SNAKE_CASE | `PERMISSIONS` |
| 文件 | kebab-case | `user-table.tsx` |

## 构建注意事项

`npm run build` 执行 `next build && node scripts/postbuild.js`:
- postbuild 复制运行时必需目录到 `.next/standalone/`
- 复制内容: `.next/` (部分), `prisma/` (schema + db), `plugins/`
- 不复制: `data/`, `uploads/` (运行时动态)

## TypeScript 配置

- `strict: true` - 新代码必须严格类型
- Path alias: `@/*` -> `./src/*`
- 排除目录: `src/lib/claude-router`, `src/examples`, `tmp`, `scripts`, `uploads`, `data`, `prisma`

## 运行时数据目录

- `data/skills/` - 技能 Markdown 文件 (运行时加载)
- `uploads/` - 用户上传文件
- `plugins/` - 插件存储

## 关键依赖

- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK
- `@prisma/client` + `prisma` - ORM
- `bcryptjs` + `jsonwebtoken` - 认证
- `@xyflow/react` - 工作流可视化
- `@xterm/xterm` - 终端组件
- `fastify` + `ws` - WebSocket 服务

## 环境变量

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key"
NODE_ENV="development"
CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=600000  # MCP 超时 10 分钟
```

## 测试

项目目前没有配置测试框架。

## 高级功能模块

- **Workflow 系统**: 可视化 Agent 编排 (`@xyflow/react`)
- **Skills 系统**: Markdown 定义 AI 技能 (`data/skills/`)
- **MCP 服务器**: Model Context Protocol 集成
- **自主进化**: 失败序列学习 (`AutonomousEvolutionExperience` model)
- **漏洞管理**: Vulnerability/VulnerabilityPattern/ScanTask 模型
- **Token 统计**: `TokenUsage` 模型追踪 API 调用成本