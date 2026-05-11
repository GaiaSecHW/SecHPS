# Bug: Prisma findMany + include 在远程 PostgreSQL 上无限挂起

**状态**: 已修复
**发现日期**: 2026-05-10
**影响范围**: 全平台 API 接口、服务启动流程

---

## 现象

- `/api/projects` 接口请求无限挂起（无响应）
- `/api/codeswarm/tasks` 接口请求无限挂起
- 服务器启动后所有数据库查询逐渐变慢直至完全无响应
- 远程 PostgreSQL 连接池被耗尽，`pg_terminate_backend()` 清理后短暂恢复

## 根因

### 1. Prisma 5.22.0 ORM Bug

Prisma 5.22.0 的 `findMany` / `findFirst` + `include`（加载关联关系）在远程 PostgreSQL 上会无限挂起。

- `findUnique`、`count`、`$queryRaw` 均正常
- 仅 `findMany` / `findFirst` + `include` 触发
- 本地数据库不重现，仅远程 PostgreSQL 出现
- 与 `take` 限制无关，加 `take: 1` 仍然挂起

受影响的表：`EvaluationSession`（最严重，使用最频繁）、`CodeswarmTask`

### 2. 启动查询阻塞整个服务

`instrumentation.ts` 在服务启动时执行：

```
Step 1: restoreLocksFromDatabase() — findMany + select（正常）
Step 2: 查询活跃评估 — findMany + include: { Project }（挂起！）
Step 3: 查询排队评估 — findMany + include: { Project }（挂起！）
```

Step 2 挂起后占用数据库连接池连接，导致后续所有 API 请求也无法获取连接。

### 3. $extends 超时包装器适得其反

`prisma.ts` 中添加的 `$extends` Promise.race 超时包装：

```typescript
prisma.$extends({
  query: {
    async $allOperations({ operation, model, args, query }) {
      const result = await Promise.race([
        query(args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Query timeout ...`)), 30000)
        ),
      ]);
      return result;
    },
  },
});
```

问题：超时后仅放弃 JS Promise，**底层数据库连接仍然被占用**。这实际上加剧了连接池耗尽。

### 4. SELECT t.* 拉取大字段

`/api/codeswarm/tasks` 使用 `$queryRaw` + `SELECT t.*`，拉取了 `events`、`result`、`reportContent` 等可能很大的 JSON/文本字段，导致即使查询不挂起也需 15 秒。

---

## 修复方案

### 修复 1: 升级 Prisma（根本解决）

```
@prisma/client: 5.22.0 → 6.19.3
prisma:          5.22.0 → 6.19.3
```

Prisma 6.x 修复了 `findMany` + `include` 在 PostgreSQL 上挂起的 ORM 层 bug。

### 修复 2: 移除有害的 $extends 超时包装器

**文件**: `src/lib/prisma.ts`

移除 `$extends` 中的 Promise.race 超时包装。它不取消底层查询，反而导致连接泄漏。

### 修复 3: 全面替换 include 为 select + 独立查询

将所有 `evaluationSession.findMany/findFirst` + `include` 替换为 `select`（仅标量字段）+ 独立查询关联数据。

**涉及文件（共 22 个）**：

| 文件 | 改动 |
|------|------|
| `instrumentation.ts` | 2 处 `include: { Project }` → `select` + 独立查询 |
| `src/services/evaluation-recovery.ts` | `include: { Project, NodeExecution }` → `select` + 2 个独立查询 |
| `src/services/evaluation-queue.ts` | 2 处 `include: { Project }` → `select` + 独立查询 |
| `src/app/api/projects/[id]/sessions/route.ts` | `include: { AgentTeam, _count }` → `select` + 独立查询 |
| `src/app/api/projects/[id]/sessions/query/route.ts` | 2 处 `include: { _count }` → `select` |
| `src/app/api/evaluations/[id]/route.ts` | GET + DELETE 的 `include` → `select` + 独立查询 |
| `src/app/api/evaluations/[id]/fsm-start/route.ts` | `include: { Project, Workflow }` → 独立查询 |
| `src/app/api/evaluations/[id]/execute/route.ts` | `include: { Project, Workflow }` → 独立查询 |
| `src/app/api/evaluations/[id]/chat/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/ask-progress/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/nodes/route.ts` | 3 处 `include` → 独立查询 |
| `src/app/api/evaluations/[id]/ralph-start/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/results/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/stop/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/vulnerabilities/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/status/route.ts` | 关系 `select: { Project, AgentTeam }` → 独立查询 |
| `src/app/api/evaluations/[id]/report/route.ts` | `include: { Project, AgentTeam }` → 独立查询 |
| `src/app/api/evaluations/[id]/report/download/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/evaluations/[id]/report/sections/[section]/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/sessions/[id]/route.ts` | GET + DELETE → 独立查询 |
| `src/app/api/sessions/[id]/messages/route.ts` | `include: { Project }` → 独立查询 |
| `src/app/api/sessions/[id]/children/route.ts` | `include: { Project }` → 独立查询 |

**替换模式**：

```typescript
// 之前（挂起）
const evaluation = await prisma.evaluationSession.findFirst({
  where: { id },
  include: {
    Project: { select: { name: true } },
  },
});
const name = evaluation.Project?.name;

// 之后（正常）
const evaluation = await prisma.evaluationSession.findFirst({
  where: { id },
  select: {
    id: true,
    projectId: true,
    // ... 所有需要的标量字段
  },
});
const project = evaluation
  ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { name: true },
    })
  : null;
const name = project?.name;
```

### 修复 4: 优化 $queryRaw 排除大字段

**文件**: `src/app/api/codeswarm/tasks/route.ts`

```typescript
// 之前（15 秒）
SELECT t.*, w."nodeId" ...

// 之后（180ms）
SELECT t.id, t."taskId", t."workerId", t.state, t.instruction, ...
// 排除 events、result、reportContent 大字段
```

---

## 验证结果

| 接口 | 修复前 | 修复后 |
|------|--------|--------|
| `/api/codeswarm/tasks` | 无限挂起 | 200 / 180ms |
| `/api/codeswarm/nodes` | 200 / 260ms | 200 / 190ms |
| `/api/projects` | 无限挂起 | 200 / 300ms |
| 服务启动（instrumentation） | findMany 挂起，阻塞启动 | 瞬间完成 |

---

## 经验教训

1. **Prisma `include` 在大数据量表上需谨慎** — `include` 生成 JOIN 或多次查询，ORM 层 bug 会导致整个服务不可用
2. **不要用 Promise.race 给数据库查询加超时** — 它只放弃 JS Promise，不取消底层连接
3. **避免 `SELECT *`** — 始终明确列出需要的列，排除大字段
4. **启动流程的查询必须稳定** — `instrumentation.ts` 中的挂起会阻塞整个服务
5. **保持 Prisma 版本更新** — 5.22.0 的 bug 在 6.x 中已修复
