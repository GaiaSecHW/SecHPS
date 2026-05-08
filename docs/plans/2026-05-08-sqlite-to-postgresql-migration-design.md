# SQLite → PostgreSQL Migration Design

## Goal

Replace SQLite with PostgreSQL as the database backend, migrating all existing data.

## PG Connection

- Address: `172.31.23.182:5432`
- Database: `ai4sec`
- URL: `postgresql://postgres:Huawei12%23%24@172.31.23.182:5432/ai4sec`

## Schema Changes

Minimal — only the datasource config changes:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

All models use String `@id` (no autoincrement), so no schema model changes needed.

## SQLite-Specific Code Fixes (3 places)

1. **`src/app/api/token-stats/route.ts:350`** — Remove `// SQLite 不支持复杂的日期分组` comment only. JS grouping logic works on PG, optimization deferred.
2. **`src/services/skill-governance.ts:231`** — Enable `skipDuplicates: true` (PG supports it, SQLite didn't).
3. **`src/lib/monitoring/health-check.ts:35`** — Change hardcoded `dbConnections: 1` to reflect PG connection pool.

## Migration Script: `scripts/migrate-sqlite-to-pg.ts`

- Read from SQLite via `better-sqlite3`
- Write to PG via Prisma client
- Insert in dependency order (no-FK tables first)
- Preserve all existing String IDs
- Skip tables already seeded by `npm run db:seed`
- Validation: compare row counts per table after migration

---

## Execution Steps

### 已完成

- [x] `schema.prisma`: provider sqlite → postgresql
- [x] `.env`: DATABASE_URL → PG connection string
- [x] 删除 `prisma/migrations/` 旧目录（provider 变更需要重建迁移历史）
- [x] Step 1: prisma migrate dev — PG schema 创建成功
- [x] Step 2: db:seed — 基础数据写入成功
- [x] Step 3: 数据迁移脚本 `db/migrate-sqlite-to-pg.ts` — 所有核心表迁移成功
- [x] Step 4: 3 处 SQLite 特定代码已修复
- [x] Step 5: API 验证通过（login/projects/users/skills 均正常）

### 待完成

- [ ] Step 6: 清理 SQLite 旧文件（确认无问题后手动执行）

```bash
npx prisma migrate dev --name init-postgresql
```

→ 在 PG 中创建所有表，生成新的 migration 文件和 Prisma client

### Step 2: 运行 db:seed

```bash
npm run db:seed
```

→ 写入基础数据（roles, permissions, SkillCategory, admin 用户等）

### Step 3: 编写并执行数据迁移脚本

创建 `scripts/migrate-sqlite-to-pg.ts`：

- 用 `better-sqlite3` 读取 `prisma/dev.db`
- 用 Prisma client 写入 PG
- 按外键依赖顺序插入
- 跳过 seed 已创建的记录（通过 ID 查重）
- 迁移后对比行数验证

需要先安装依赖：

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

外键依赖顺序（层级结构）：

```
层0 (无FK依赖): Tenant, Role, Permission, SkillCategory, VulnerabilityTree,
                 ProductTag, AlertRule, FSMTemplate, NotificationChannel,
                 OpencodeConfig, Plugin, SystemConfig, TechStackOption,
                 SkillEvolutionConfig, SkillEvolutionPrompt, SkillGovernanceConfig,
                 ExpectedOutputTemplate, LogFileRecord, CodeswarmWorker,
                 VulnerabilityCategory, ModelConfig (userId nullable)

层1 (依赖层0):  User (→ Tenant), Skill (→ SkillCategory, User, VulnerabilityTree),
                 AgentDefinition (→ ModelConfig, User)

层2 (依赖层1):  UserRole (→ User, Role), Project (→ User, Tenant, OpencodeConfig),
                 Workflow (→ User, Tenant, FSMTemplate), AgentTeam (→ User, AgentDefinition),
                 McpServerConfig (→ User, Tenant, Project)

层3 (依赖层2):  WorkflowNode (→ Workflow, WorkflowRole), WorkflowEdge (→ WorkflowNode),
                 WorkflowRole (→ Workflow), WorkflowShare (→ Workflow, User),
                 AgentTeamMember (→ AgentTeam, AgentDefinition),
                 SkillProductTag (→ Skill, ProductTag), ScanTask (→ Project),
                 SkillExecution (→ Skill, Project, EvaluationSession), ...

层4+:           所有子表/关联表 (NodeExecution, PhaseOutput, Vulnerability, TokenUsage, ...)
```

### Step 4: 修复 3 处 SQLite 特定代码

| 文件 | 改动 |
|------|------|
| `src/app/api/token-stats/route.ts:350` | 删除 `// SQLite 不支持复杂的日期分组` 注释 |
| `src/services/skill-governance.ts:231` | 取消注释，启用 `skipDuplicates: true` |
| `src/lib/monitoring/health-check.ts:35` | `dbConnections: 1` 改为动态或注释说明 PG 使用连接池 |

### Step 5: 验证

```bash
npm run dev
```

前端操作步骤：
1. 打开登录页 → 用 admin@opencode.com / admin123 登录 → 表现：成功进入 Dashboard
2. 查看用户列表 → 表现：显示已有用户数据
3. 查看技能列表 → 表现：显示迁移后的技能数据
4. 查看工作流列表 → 表现：显示迁移后的工作流
5. 查看执行历史 → 表现：显示迁移后的执行记录

### Step 6: 清理

```bash
rm prisma/dev.db prisma/dev.db-shm prisma/dev.db-wal
```

删除 SQLite 旧文件（确认 PG 迁移成功后）

---

## Rollback

SQLite original files are never deleted until Step 6. Reverting DATABASE_URL back to `file:./dev.db` restores SQLite usage.

## Out of Scope

- token-stats date grouping optimization (separate task)
- .gitignore cleanup for dev.db entries
