# AGENTS.md

AI4WEB 测试平台 - 开发参考指南。Next.js 16 + React 19 + TypeScript + Prisma 6 + PostgreSQL。

## 开发命令

```bash
npm run dev              # 开发服务器 (localhost:3000)
npm run build            # 生产构建（含 postbuild 复制资源）
npm start                # 生产运行
npm run lint             # 代码检查
npm run test             # vitest

# 数据库
npm run db:generate      # 生成 Prisma 客户端 (postinstall 自动执行)
npm run db:push          # 推送 schema 变更
npm run db:seed          # 初始化数据库 + 默认管理员
npm run db:seed-techstack # 技术栈种子数据
npm run db:seed-agents   # Agent 定义种子数据
npm run db:seed-fsm      # FSM 模板种子数据
```

**语言规则**: 用中文回答

## 认证模块导入规则（关键）

**服务端 API 路由** 使用 `@/lib/api-auth`:
```typescript
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
if (!auth.success) return authErrorResponse(auth);
```

**客户端组件** 使用 `@/lib/permissions`:
```typescript
import { hasPermission } from '@/lib/permissions';
```

**权限常量** 在 `@/types/permissions.ts`，格式 `module:action`。

## Prisma 规范

- **版本**: v6.19.3
- **导入**: 从 `@/lib/prisma` 导入单例
- **数据库**: PostgreSQL
- **schema**: `prisma/schema.prisma`

```typescript
import { prisma } from '@/lib/prisma';
```

## 核心模块

### API 路由 (`src/app/api/`)

40+ 端点，主要模块：auth、users、roles、permissions、sessions、projects、workflows、agent-apps、agent-definitions、agentflow-pipelines、skills、models、mcp-servers、evaluations、codeswarm、vulnerabilities、config、plugins、tenants

### Dashboard 页面 (`src/app/dashboard/`)

admin、agent-apps、agentflow-pipelines、claude、codeswarm、config、evaluations、mcp-servers、models、plugins、profile、projects、roles、sessions、skills、task-builder、tech-stack、token-stats、users、workflows

### 关键库 (`src/lib/`)

- `auth.ts` — JWT 验证、密码哈希、权限检查
- `api-auth.ts` — 增强认证中间件（含租户上下文）
- `prisma.ts` — Prisma 单例
- `tenant.ts` / `tenant-filter.ts` — 多租户上下文与隔离过滤
- `claude-router/` — AI 模型路由（排除 TS 编译）
- `workflow/` — 工作流引擎
- `fsm/` — 有限状态机
- `gitea.ts` — Gitea 文件同步

## 漏洞状态值格式

数据库使用 **连字符**: `false-positive`、`confirmed`、`ignored`。前端需兼容下划线历史数据。

## Skill 系统

- Git 同步: Gitea 仓库存储 Skill 文件
- Skill 构建/导出/模板: `src/lib/skill-*.ts`
- 分类与去重: `src/lib/categories.ts`

## CodeSwarm 分布式调度

- Redis 队列驱动的任务调度系统
- Worker 回调: `NEXT_PUBLIC_BASE_URL`
- 本地测试: `src/app/api/codeswarm/local-test/`

## 构建注意事项

- `npm run build` = `next build && node scripts/postbuild.js`
- postbuild 复制: `.next/`、`prisma/`、`plugins/` → `.next/standalone/`
- 不复制: `data/`、`uploads/`（运行时动态）

## 默认账户

- 用户名: `admin` / `admin123`（邮箱 admin@ai4web.com）
- 角色: admin、manager、developer、user、viewer

## 环境变量

`.env` 必需: `DATABASE_URL`、`JWT_SECRET`、`NODE_ENV`。完整列表见 `.env.example`。

关键可选配置: `REDIS_URL`（CodeSwarm）、`NEXT_PUBLIC_BASE_URL`（Worker 回调）、`GITEA_*`（文件同步）、`SFTP_*`/`NFS_*`（文件存储）。

## Linux 部署

`@anthropic-ai/claude-agent-sdk` 依赖平台原生二进制文件，不能用 `--omit=optional` 或 `--production` 安装。

## 常见错误修复

| 问题 | 解决方案 |
|------|----------|
| PERMISSIONS.xxx 不存在 | 在 `src/types/permissions.ts` 添加常量 |
| LOG_MODULES.xxx 不存在 | 在 `src/lib/logger.ts` LOG_MODULES 添加 |
| 漏洞状态类型不匹配 | 使用 `false-positive`（连字符） |
| SkillImprovement taskId 冲突 | 使用 `upsert` 代替 `create` |
| Agent SDK 二进制缺失 | 不用 `--production` 安装，手动补装对应平台包 |
