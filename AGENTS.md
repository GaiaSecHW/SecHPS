# AGENTS.md

SecHPS 测试平台 - 开发参考指南。Next.js 16 + React 19 + TypeScript 6 + Prisma 6 + PostgreSQL。

## 开发命令

```bash
npm run dev              # 开发服务器 (localhost:3000)
npm run dev:webpack      # 开发服务器（Webpack 模式）
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

# 迁移
npm run migrate:workflow-to-agent-team  # 工作流迁移到 AgentTeam
npm run rollback:agent-team             # 回滚 AgentTeam 迁移
```

## 运维命令

```bash
# 启动服务
screen -dmS sechps bash -c 'npm start > app.log 2>&1; exec bash'   # 启动 Web 应用（自动加载 .env）
screen -dmS worker1 bash -c 'cd codeswarm-service/packages/worker && PORT=8090 NODE_ID=worker-1 MAX_CONCURRENT=5 SCHEDULER_URL=http://<主机IP>:8080 node dist/index.js > /tmp/worker1.log 2>&1; exec bash'  # 启动 Worker（注意 SCHEDULER_URL 指向实际可达地址）

# 停止服务
screen -S sechps -X quit                                             # 停止 Web 应用
screen -S worker1 -X quit                                            # 停止 Worker 进程

# 查看日志
tail -f app.log                      # Web 应用日志
tail -f /tmp/worker1.log             # Worker 日志
screen -r sechps                     # 进入 Web 应用 screen 会话

# 健康检查
curl -s http://localhost:3000/api/global/health   # Web 应用状态
curl -s http://localhost:8090/health              # Worker 状态

# 重启流程
screen -S sechps -X quit && screen -dmS sechps bash -c 'npm start > app.log 2>&1; exec bash'
screen -S worker1 -X quit && screen -dmS worker1 bash -c 'cd codeswarm-service/packages/worker && PORT=8090 NODE_ID=worker-1 MAX_CONCURRENT=5 SCHEDULER_URL=http://<主机IP>:8080 node dist/index.js > /tmp/worker1.log 2>&1; exec bash'
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
- **schema**: `prisma/schema.prisma`（60+ 模型）

```typescript
import { prisma } from '@/lib/prisma';
```

## 核心模块

### API 路由 (`src/app/api/`)

40+ 端点，主要模块：auth、users、roles、permissions、sessions、projects、workflows、agent-apps、agent-definitions、agentflow-pipelines、skills、models、mcp-servers、evaluations、codeswarm（browse-dirs、download-report、local-test、nodes、session-extract、tasks、worker）、vulnerabilities、vulnerability-patterns、config、plugins、tenants、admin（api-keys、sdk、tenants、vulnerabilities）、v1（版本化 API）

### Dashboard 页面 (`src/app/dashboard/`)

admin（api-keys、sdk、tenants、vulnerabilities）、agent-apps、agentflow-pipelines、claude、codeswarm、config、evaluations、mcp-servers、models、plugins、profile、projects、roles、sessions、skills、task-builder、tech-stack、token-stats、users、workflows

### 关键库 (`src/lib/`)

- `auth.ts` — JWT 验证、密码哈希、权限检查
- `api-auth.ts` — 增强认证中间件（含租户上下文）
- `prisma.ts` — Prisma 单例（连接重试、30s keep-alive）
- `tenant.ts` / `tenant-filter.ts` — 多租户上下文与隔离过滤
- `claude-router/` — AI 模型路由（排除 TS 编译）
- `workflow/` — 工作流引擎
- `fsm/` — 有限状态机
- `gitea.ts` — Gitea 文件同步
- `minio-client.ts` — MinIO 对象存储
- `codeswarm-worker-auth.ts` — CodeSwarm Worker 认证
- `mcp-client.ts` / `mcp-loader.ts` — MCP 协议客户端

### 服务层 (`src/services/`)

- `evaluation/` — 评估服务（队列、恢复、完成、消息存储）
- `skill-evolution/` — Skill 进化管道
- `autonomous-evolution/` — 自主进化系统
- `providers/` — AI 提供商适配（多模型支持）
- `skills.ts` — Skill 业务逻辑
- `codeswarm-dispatcher.ts` — CodeSwarm 任务调度
- `session-manager.ts` — 会话管理
- `terminal-manager.ts` — 终端会话管理
- `plugin-manager.ts` / `plugin-runner.ts` — 插件系统

### Hooks (`src/hooks/`)

`useAuth`、`useApiFetch`、`useQueueStatus`、`useSkillCategories`、`useTechStackOptions`、`useVulnerabilityPatterns`、`use-ralph-events`

## 子系统架构

### CodeSwarm（分布式调度）

- Redis 队列驱动的任务调度系统
- `codeswarm-service/` — Scheduler 调度引擎 + Worker 进程 + ACP 通信协议 + 共享类型
- Worker 独立配置: `codeswarm-service/.env.example`
- Worker 回调地址: `NEXT_PUBLIC_BASE_URL`（主服务器侧配置）
- 本地测试: `src/app/api/codeswarm/local-test/`
- **任务输入子目录**: 用户上传文件统一放入 `TASK_INPUT_DIR` 子目录（默认 `vlu_scan_code`），不在工作区根目录散布
- Worker 环境构建时自动排除输入子目录，防止误判为项目子目录

### ~~CodeMap（已移除）~~
- C/C++ 和 Python 规则集

### AgentFlow（可视化编排）

- `src/components/agentflow-editor/` — 可视化管道编辑器
- `src/app/api/agentflow-pipelines/` — 管道 CRUD + 发布
- DAG 编排 Agent 执行流程

## 漏洞状态值格式

数据库使用 **连字符**: `false-positive`、`confirmed`、`ignored`。前端需兼容下划线历史数据。

## Skill 系统

- Git 同步: Gitea 仓库存储 Skill 文件
- Skill 构建/导出/模板: `src/lib/skill-*.ts`
- 分类与去重: `src/lib/categories.ts`
- 进化与治理: `src/services/skill-evolution/`、`src/services/skill-governance.ts`

## 构建注意事项

- `npm run build` = `next build && node scripts/postbuild.js`
- postbuild 复制: `.next/`、`prisma/`、`plugins/`、`.env` → `.next/standalone/`
- 不复制: `data/`、`uploads/`（运行时动态）
- `npm start` 使用 `node --env-file=.env .next/standalone/server.js`，自动加载根目录 `.env`
- standalone 目录下的 `.env` 由 postbuild 同步，修改根目录 `.env` 后需 `npm run build` 或手动 `cp .env .next/standalone/.env`
- `.env` 中 `PORT` 为 Web 应用端口（默认 3000），Worker 的 `PORT=8090` 在其启动命令中硬编码

## 默认账户

- 用户名: `admin` / `admin123`（邮箱 admin@SecHPS.com）
- 角色: admin、manager、developer、user、viewer

## 环境变量

**主服务器** `.env` 必需: `DATABASE_URL`、`JWT_SECRET`、`NODE_ENV`、`REDIS_URL`。完整列表见 `.env.example`。

**CodeSwarm Service** 独立配置见 `codeswarm-service/.env.example`（Scheduler 专属变量: `PORT`、`JWT_SECRET`；Worker 专属变量: `SCHEDULER_URL`、`MINIO_*` 等）。

关键可选配置:
- `NEXT_PUBLIC_BASE_URL` — Worker 回调地址（必须指向 Web 应用可达地址）
- `REDIS_URL` — Redis 连接（CodeSwarm 调度队列，指定 db 编号如 `/3`）
- `PORT` — Web 应用端口（默认 3000，Worker 端口在启动命令硬编码为 8090）
- `GITEA_*` — Gitea 文件同步
- `MINIO_*` — MinIO 对象存储
- `TASK_INPUT_DIR` — 任务输入子目录名（默认 `vlu_scan_code`），主服务器和 Worker 必须一致

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
| Worker 心跳失败/任务排队 | 检查 Worker 的 `ORCHESTRATOR_URL` 是否指向 Web 应用可达地址 |
| standalone 不加载 .env | `npm start` 已改为 `node --env-file=.env`，确保根目录有 `.env` |
| Web 应用启动端口冲突 | `.env` 中 `PORT` 为 Web 应用端口（默认 3000），Worker 端口 8090 在启动命令硬编码 |

## LLM 编码行为准则

根据需要与项目特定说明合并。权衡：这些指导原则倾向于谨慎而非速度。对于琐碎的任务，请自行判断。

### 1. 编码前先思考

不要妄下断言。不要掩饰困惑。坦诚地权衡利弊。

**实施前：**

- 请明确陈述您的假设。如有疑问，请提出。
- 如果存在多种解释，请将它们提出来——不要默默地做出选择。
- 如果存在更简单的方法，请提出来。必要时要坚持己见。
- 如果有什么不清楚的地方，停下来。说出让你困惑的地方。然后提问。

### 2. 简单至上

用最少的代码解决问题。不要进行任何推测。

- 没有超出要求的功能。
- 不为一次性代码进行抽象。
- 没有提供任何未要求的"灵活性"或"可配置性"。
- 对于不可能出现的情况，不进行错误处理。
- 如果你写了 200 行，而 50 行就可以写完，那就重写。
- 问问自己："一位资深工程师会认为这过于复杂吗？" 如果答案是肯定的，那就简化它。

### 3. 手术改变

只碰你必须碰的东西。只收拾你自己的烂摊子。

**编辑现有代码时：**

- 不要"改进"相邻的代码、注释或格式。
- 不要重构没有问题的代码。
- 即使你的做法不同，也要保持与现有风格一致。
- 如果你发现无关的死代码，请指出来——不要删除它。

**当你的更改创建了孤立文件时：**

- 删除因您的修改而不再使用的导入项/变量/函数。
- 除非另有要求，否则不要删除已有的无效代码。

**测试要求：每一行修改后的代码都应该直接追溯到用户的请求。**

### 4. 目标驱动型执行

定义成功标准。循环直至验证通过。

**将任务转化为可验证的目标：**

- "添加验证"→"编写针对无效输入的测试，并确保它们都能通过"
- "修复漏洞"→"编写一个能够重现该漏洞的测试，然后使其通过"。
- "重构 X" → "确保重构前后测试均通过"

**对于多步骤任务，请简要说明计划：**

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

明确的成功标准能让你独立循环迭代。而模糊的标准（"只要能行就行"）则需要不断澄清。

**如果以下情况发生，则这些指导原则是有效的：** 差异中不必要的更改减少，由于过于复杂而导致的重写减少，并且在实施之前而不是在出错之后提出澄清问题。
