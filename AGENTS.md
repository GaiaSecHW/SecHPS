# AI4WEB 测试平台 - 开发指南

Next.js 16 + React 19 + TypeScript App Router 平台，支持 RBAC 权限、AI 评估、Skill 进化等功能。

## 开发命令

```bash
npm run dev              # 开发服务器 (localhost:3000)
npm run build            # 构建 (自动执行 lint + typecheck)
npm run lint             # 代码检查

# 数据库
npm run db:generate      # 生成 Prisma 客户端 (postinstall 自动执行)
npm run db:push          # 推送 schema 变更
npm run db:seed          # 初始化数据库 + 默认管理员
```
**语言规则**: 用中文回答

## 认证模块导入规则 (关键)

**服务端 API 路由** 使用 `@/lib/api-auth`:
```typescript
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
if (!auth.success) return authErrorResponse(auth);
```

**客户端组件** 使用 `@/lib/permissions` (避免服务端环境变量检查):
```typescript
import { hasPermission } from '@/lib/permissions';
```

**权限常量** 在 `@/types/permissions.ts`，格式 `module:action` (如 `skill-evolution:manage`).

## Prisma 规范

- **版本**: 必须使用 v5.22.0 (v7 配置方式不同，会出问题)
- **导入**: 从 `@/lib/prisma` 导入单例
- **数据库**: SQLite `prisma/dev.db`
- **schema**: `prisma/schema.prisma` 1700+ 行

```typescript
import { prisma } from '@/lib/prisma';
```

## 漏洞状态值格式

数据库存储使用 **连字符** 格式:
- `false-positive` (不是 `false_positive`)
- `confirmed`
- `ignored`

前端需兼容两种格式（历史数据可能用下划线）。

## Skill 进化系统

位于 `src/services/skill-evolution/`:

- **达标标准**: 漏检数 = 0，排除率 ≥ 50%
- **重试机制**: 最多 10 次，每次记录到 `EvolutionAttempt` 表
- **失败处理**: 10 次都失败 → 状态设为 `rejected`
- **反馈驱动**: 失败信息传递给下次尝试的 AI prompt

核心服务:
- `task-manager.ts`: 任务调度、重试循环
- `backtest-validator.ts`: 回测验证、JSON 解析(自动修复非标准格式)
- `improvement-generator.ts`: 生成改进建议
- `evolution-attempt-manager.ts`: 尝试记录管理

## 项目结构要点

```
src/
├── app/api/          # 30+ API 端点 (REST)
├── services/         # 业务逻辑层
│   └── skill-evolution/  # Skill 进化核心
├── lib/
│   ├── auth.ts       # JWT 验证、权限检查
│   ├── api-auth.ts   # API 认证中间件
│   ├── prisma.ts     # Prisma 单例
│   └── permissions.ts  # 客户端权限检查
├── types/permissions.ts  # 权限常量定义
data/skills/          # Skill Markdown 文件 (运行时加载)
uploads/              # 用户上传文件
plugins/              # 插件存储
```

## 构建注意事项

- `npm run build` = `next build && node scripts/postbuild.js`
- postbuild 复制: `.next/`, `prisma/`, `plugins/` → `.next/standalone/`
- 不复制: `data/`, `uploads/` (运行时动态)

## 默认账户

- admin@ai4web.com / admin123 (seed 创建)
- 角色: admin, manager, developer, user, viewer

## TypeScript 配置

- `strict: true`
- Path alias: `@/*` → `./src/*`
- 排除: `src/lib/claude-router`, `src/examples`, `tmp`, `scripts`, `uploads`, `data`, `prisma`

## 客户端组件

使用 hooks 或浏览器 API 的组件必须添加 `'use client'`:
```typescript
'use client';
import { useState } from 'react';
```

## 常见错误修复

| 问题 | 解决方案 |
|------|----------|
| Prisma 配置报错 | 确保使用 v5，检查 schema.prisma url 配置 |
| PERMISSIONS.xxx 不存在 | 在 `src/types/permissions.ts` 添加常量 |
| LOG_MODULES.xxx 不存在 | 在 `src/lib/logger.ts` LOG_MODULES 添加 |
| 漏洞状态类型不匹配 | 使用 `false-positive` (连字符) |
| JSON.parse 失败 | backtest-validator 已有自动修复逻辑 |
| SkillImprovement taskId 冲突 | 使用 `upsert` 代替 `create` |

## 环境变量

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key"
NODE_ENV="development"
```

## 测试

```bash
npm run test    # vitest
```

配置: `vitest.config.ts`, 环境: node

## Linux 部署注意事项

**重要**: `@anthropic-ai/claude-agent-sdk` 依赖平台原生二进制文件（可选依赖）。

部署时 **不能使用** `--omit=optional` 或 `--production` 标志，否则会报错：
```
Native CLI binary for linux-x64 not found
```

正确安装方式：
```bash
# 生产环境部署
npm install                    # ✅ 正确
npm install --omit=optional    # ❌ 错误（会跳过 SDK 二进制）
npm ci --production            # ❌ 错误（同上）
```

如果已安装缺依赖，手动补装：
```bash
npm install @anthropic-ai/claude-agent-sdk-linux-x64@0.2.123
# ARM 服务器用 linux-arm64
npm install @anthropic-ai/claude-agent-sdk-linux-arm64@0.2.123
```

## 本地测试功能 (LocalTest)

位于 `src/app/api/codeswarm/local-test/`，用于在指定工作区执行 opencode skill 并解析结果。

**跨平台执行方式**：
- Windows: 直接调用 `opencode run --agent build "..."` (shell: true)
- Linux: 使用 `bash -c` 执行，解决 spawn 输出为空问题

**环境变量**：
- `TERM=dumb`: 禁用 TUI 界面
- `NO_COLOR=1`: 禁用颜色输出

**调试模式**: 失败时输出保存到 `/tmp/opencode/debug-{taskId}.log`