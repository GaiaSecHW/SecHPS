# 租户隔离整改方案

**版本**: 1.0
**日期**: 2026-06-12
**状态**: 待实施

---

## 一、背景与目标

当前系统已建立租户隔离基础设施（`tenant.ts` / `tenant-filter.ts` / `api-auth.ts`），但大量实体在数据库层和 API 层未完整应用租户过滤。需实现以下三条策略：

1. **公开资源跨租户可见**：标记为 `isPublic` 的 Skill、Agent、模型，非所属租户用户也可使用；未标记公开的仅同租户可使用。
2. **前端展示租户级数据**：Skill、Agent、模型、任务、token 消耗、用户统计、API Key 等信息，当前用户仅能看到所在租户下的相关数据。
3. **数据库记录含租户归属**：所有需隔离的实体在数据库中必须有 `tenantId` 字段；后端查询时基于用户所属租户过滤后再做统计。

---

## 二、现状分析

### 2.1 Schema 层 tenantId 分布

| 实体 | Schema 有 tenantId | 有 isPublic | 状态 |
|------|:---:|:---:|------|
| AgentApp | ✅ | ✅ | 🟢 正常 |
| AgentDefinition | ✅ | ✅ | 🟢 正常 |
| AgentTeam | ✅ | ❌ | 🟡 无独立 API 路由 |
| ModelConfig | ✅ | ✅ | 🟢 正常 |
| Skill | ✅ | ✅ | 🟢 正常 |
| Skill2 | ✅ | ✅ | 🟡 无独立 API 路由 |
| Project | ✅ | ❌ | 🔴 API 未使用租户过滤 |
| Workflow | ✅ | ✅ | 🔴 API 未使用租户过滤 |
| AgentFlowPipeline | ✅ | ✅ | 🔴 API 缺同租户可见逻辑 |
| McpServerConfig | ✅ | ✅ | 🟢 正常 |
| ApiKey | ✅ | ❌ | 🟢 正常 |
| User | ✅ | ❌ | 🔴 API 未使用租户过滤 |
| TaskInstance | ✅ | ✅ | 🟡 需确认 |
| **EvaluationSession** | ❌ | ❌ | 🔴 **缺失 tenantId** |
| **TokenUsage** | ❌ | ❌ | 🔴 **缺失 tenantId** |
| **SessionMessage** | ❌ | ❌ | 🔴 **缺失 tenantId** |
| **Vulnerability** | ❌ | ❌ | 🔴 **缺失 tenantId** |
| **CodeswarmTask** | ❌ | ❌ | 🔴 **缺失 tenantId + 无认证** |

### 2.2 API 层租户过滤现状

| 实体 | 列表查询 | 详情查询 | 创建 | 更新/删除 | 问题摘要 |
|------|:---:|:---:|:---:|:---:|------|
| AgentApp | ✅ buildTenantFilter | ✅ 手动 tenantId | ✅ | ✅ userId | 🟢 正常 |
| AgentDefinition | ✅ buildTenantFilter | — | — | — | 🟢 正常 |
| ModelConfig | ✅ 手动 tenantId | ✅ canViewModel | — | ✅ canManageModel | 🟢 正常 |
| Skill | ✅ buildTenantFilter | — | ✅ getTenantIdForCreate | — | 🟢 正常 |
| McpServerConfig | ✅ 手动 tenantId | ✅ canViewMcp | ✅ | ✅ canManageMcp | 🟢 正常 |
| ApiKey | ✅ tenantId | — | — | ✅ sameTenant | 🟢 正常 |
| **Project** | ✅ buildTenantFilter | ❌ 仅 userId+isAdmin | ✅ | ❌ 仅 userId+isAdmin | 🔴 使用旧版 authenticateRequest |
| **Workflow** | ✅ buildTenantFilter | ❌ userId+isPublic+Share | ✅ | ❌ userId+isAdmin | 🔴 详情不含 tenantId 过滤 |
| **User** | ✅ 手动 tenantId | ❌ USER_READ+isSelf | — | ❌ 仅 USER_UPDATE | 🔴 完全无租户检查 |
| **AgentFlowPipeline** | ✅ buildTenantFilter | ❌ isPublic+userId | ✅ | ❌ 仅 userId | 🔴 缺同租户可见逻辑 |
| **EvaluationSession** | — | ❌ project.userId | — | ❌ project.userId | 🔴 无 tenantId，仅 userId |
| **TokenUsage** | — | — | — | — | 🔴 无 tenantId，仅 userId/projectId |
| **CodeswarmTask** | ❌ 无认证 | ❌ 无认证 | ❌ 无认证 | ❌ 无认证 | 🔴 完全无认证+无过滤 |

### 2.3 根因总结

1. **旧版 API 未迁移**：Project、Workflow、EvaluationSession 等使用 `authenticateRequest`（不返回租户上下文），而非 `authenticateRequestEnhanced`。
2. **userId 隔离 ≠ tenantId 隔离**：多处仅检查"是否是自己的"或"是否是 admin"，而非"是否属于同租户"。同租户协作无法实现，跨租户 admin 可越权。
3. **Schema 缺 tenantId**：EvaluationSession、TokenUsage、SessionMessage、Vulnerability、CodeswarmTask 五个核心实体缺失。
4. **CodeswarmTask 无认证**：最严重的安全缺陷。

---

## 三、整改方案

### 3.0 整改原则

| 原则 | 说明 |
|------|------|
| **统一 authenticateRequestEnhanced** | 所有需租户隔离的 API 路由统一切换，获取 `tenant` 上下文 |
| **统一 buildTenantFilter / withTenantFilter / validateTenantAccess** | 列表查询用 `withTenantFilter`，详情/更新/删除用 `validateTenantAccess` |
| **统一 getTenantIdForCreate** | 创建资源时写入 `tenantId` |
| **公开资源策略** | `isPublic=true` 的对所有租户可见，非公开的仅同租户可见（`buildTenantFilter` OR 条件自动实现） |

### 3.1 Schema 层整改：补充 tenantId

以下 5 个模型需添加 `tenantId String?`、`Tenant Tenant? @relation`、`@@index([tenantId])`：

#### EvaluationSession（schema 第 449 行）

```prisma
model EvaluationSession {
  id                        String                      @id
  tenantId                  String?                     // 🆕
  projectId                 String
  // ... 其余字段不变
  Tenant                    Tenant?                     @relation(fields: [tenantId], references: [id])  // 🆕

  @@index([tenantId])       // 🆕
  @@index([tenantId, status])  // 🆕（列表查询优化）
}
```

#### TokenUsage（schema 第 1747 行）

```prisma
model TokenUsage {
  id                 String             @id
  tenantId           String?            // 🆕
  evaluationId       String?
  // ... 其余字段不变
  Tenant             Tenant?            @relation(fields: [tenantId], references: [id])  // 🆕

  @@index([tenantId])       // 🆕
  @@index([tenantId, createdAt])  // 🆕（趋势查询优化）
}
```

#### SessionMessage（schema 第 1026 行附近）

```prisma
model SessionMessage {
  id                 String   @id
  tenantId           String?  // 🆕（冗余字段，避免 JOIN）
  evaluationSessionId String
  // ... 其余字段不变
  Tenant             Tenant?  @relation(fields: [tenantId], references: [id])  // 🆕

  @@index([tenantId])       // 🆕
}
```

#### Vulnerability（schema 第 1866 行）

```prisma
model Vulnerability {
  id                        String                      @id
  tenantId                  String?                     // 🆕
  taskId                    String?
  // ... 其余字段不变
  Tenant                    Tenant?                     @relation(fields: [tenantId], references: [id])  // 🆕

  @@index([tenantId])       // 🆕
  @@index([tenantId, status])  // 🆕
}
```

#### CodeswarmTask（schema 第 316 行）

```prisma
model CodeswarmTask {
  id                String           @id
  tenantId          String?          // 🆕
  taskId            String           @unique
  // ... 其余字段不变
  Tenant            Tenant?          @relation(fields: [tenantId], references: [id])  // 🆕

  @@index([tenantId])       // 🆕
}
```

> **说明**：SessionMessage 和 Vulnerability 添加冗余 `tenantId` 是为了避免每次查询都 JOIN 父表。写入时从父级 EvaluationSession/TaskInstance/Project 的 `tenantId` 同步写入。

### 3.2 tenant-filter.ts 增强

新增两个辅助函数覆盖无 `isPublic` 的实体和 `$queryRaw` 场景：

```typescript
/**
 * 对无 isPublic 的私有资源（User、ApiKey 等）的租户过滤
 * 仅按 tenantId 过滤：同 tenantId 或 tenantId=null（平台级）
 */
export function buildTenantFilterForPrivateResource(
  context: TenantContext,
  options?: { tenantField?: string; userRoles?: string[] }
): Record<string, unknown> {
  const { tenantField = 'tenantId' } = options ?? {};
  if (context.isPlatformAdmin) return {};
  if (context.isIcsTenant && options?.userRoles?.some(r => ['admin'].includes(r))) return {};
  if (!context.tenantId) return { [tenantField]: null };
  return {
    OR: [
      { [tenantField]: context.tenantId },
      { [tenantField]: null },
    ],
  };
}

/**
 * 对 $queryRaw 场景，生成 Prisma.Sql WHERE 片段
 */
export function buildTenantSqlCondition(
  context: TenantContext,
  options?: { tenantField?: string; userRoles?: string[] }
): Prisma.Sql | Prisma.Empty {
  if (context.isPlatformAdmin) return Prisma.empty;
  if (context.isIcsTenant && options?.userRoles?.some(r => ['admin'].includes(r))) return Prisma.empty;
  const field = options?.tenantField ?? 'tenantId';
  if (!context.tenantId) return Prisma.sql`AND ${Prisma.raw(`"${field}"`)} IS NULL`;
  return Prisma.sql`AND (${Prisma.raw(`"${field}"`)} = ${context.tenantId} OR ${Prisma.raw(`"${field}"`)} IS NULL)`;
}
```

### 3.3 API 层整改：逐实体修复

#### 3.3.1 Project — `src/app/api/projects/[id]/route.ts`

**问题**：全部使用 `authenticateRequest`（无租户上下文），GET/PUT/PATCH/DELETE 仅 userId+isAdmin 过滤。

**整改**：

1. 全部替换 `authenticateRequest` → `authenticateRequestEnhanced`
2. GET 详情：`where = { id, ...validateTenantAccess(tenant, { userRoles }) }`
3. PUT/PATCH/DELETE：`findFirst` 加 `validateTenantAccess`，同租户内仅 owner 或 admin 可修改

**整改后 GET 示例**：

```typescript
const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.PROJECT_READ });
if (!auth.success) return authErrorResponse(auth);
const { payload, tenant } = auth as AuthSuccessResult;

const project = await prisma.project.findFirst({
  where: { id, ...validateTenantAccess(tenant, { userRoles: payload.roles }) },
  include: { ... },
});
```

**整改后 PUT/PATCH/DELETE 示例**：

```typescript
const existingProject = await prisma.project.findFirst({
  where: { id, ...validateTenantAccess(tenant, { userRoles: payload.roles }) },
});
if (!existingProject) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
if (!isAdmin(payload) && existingProject.userId !== payload.userId) {
  return NextResponse.json({ error: '项目不存在' }, { status: 404 });
}
```

#### 3.3.2 Workflow — `src/app/api/workflows/[id]/route.ts`

**问题**：使用 `authenticateRequest`，详情 OR 含 userId+isPublic+WorkflowShare 但不含 tenantId。

**整改**：

1. 替换 `authenticateRequest` → `authenticateRequestEnhanced`
2. GET 详情：非管理员时，合入 `tenantId` 条件：同租户 OR isPublic OR 被分享
3. PATCH/DELETE：`findFirst` 加 `validateTenantAccess`

**整改后 GET where 构建**：

```typescript
if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles?.includes('admin'))) {
  where = {
    id,
    OR: [
      { tenantId: tenant.tenantId },
      { isPublic: true },
      { WorkflowShare: { some: { sharedWith: payload.userId } } },
    ],
  };
}
```

#### 3.3.3 User — `src/app/api/users/[id]/route.ts`

**问题**：GET/PATCH/DELETE 仅 USER_READ 权限+isSelf，完全不检查 tenantId。

**整改**：

1. 替换 `authenticateRequest` → `authenticateRequestEnhanced`
2. GET 详情：非自己时，使用 `buildTenantFilterForPrivateResource`（User 无 isPublic）
3. PATCH：同租户可修改自己，admin 可修改同租户所有
4. DELETE：仅 admin 可删除同租户用户

**整改后 GET 示例**：

```typescript
const auth = authenticateRequestEnhanced(request);
if (!auth.success) return authErrorResponse(auth);
const { payload, tenant } = auth as AuthSuccessResult;
const { id } = await params;
const isSelf = payload.userId === id;

if (!isSelf && !hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
  return NextResponse.json({ error: '禁止访问' }, { status: 403 });
}

const user = await prisma.user.findFirst({
  where: { id, ...(isSelf ? {} : buildTenantFilterForPrivateResource(tenant, { userRoles: payload.roles })) },
  include: { ... },
});
```

#### 3.3.4 AgentFlowPipeline — `src/app/api/agentflow-pipelines/[id]/route.ts`

**问题**：GET 检查 `isPublic || userId === payload.userId`，缺少同租户可见逻辑。

**整改**：

1. 已用 `authenticateRequestEnhanced` ✅，仅修改访问判断逻辑
2. GET：改为 `pipeline.isPublic || pipeline.tenantId === tenant.tenantId`
3. PUT/DELETE：增加租户内协作逻辑——同租户 owner 或 admin 可修改/删除

**整改后 GET 访问判断**：

```typescript
if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles?.includes('admin'))) {
  const canAccess = pipeline.isPublic || pipeline.tenantId === tenant.tenantId;
  if (!canAccess) {
    return NextResponse.json({ error: '无权访问此 Pipeline' }, { status: 403 });
  }
}
```

#### 3.3.5 EvaluationSession — `src/app/api/evaluations/[id]/route.ts`

**问题**：Schema 无 tenantId，仅 project.userId 检查。

**整改**：

1. Schema 补充 tenantId（见 3.1）
2. 替换 `verifyToken` 手动解析 → `authenticateRequestEnhanced`
3. GET/DELETE：`findFirst` 加 `validateTenantAccess`
4. 创建时写入 `tenantId`：从 Project.tenantId 继承
5. 数据迁移：从 Project.tenantId 回填

**整改后 GET 示例**：

```typescript
const auth = authenticateRequestEnhanced(request);
if (!auth.success) return authErrorResponse(auth);
const { payload, tenant } = auth as AuthSuccessResult;

const evaluation = await prisma.evaluationSession.findFirst({
  where: { id, ...validateTenantAccess(tenant, { userRoles: payload.roles }) },
  select: { ... },
});
```

#### 3.3.6 TokenUsage / token-stats — `src/app/api/token-stats/route.ts`

**问题**：Schema 无 tenantId，普通用户按 userId 过滤，admin 看所有租户数据。

**整改**：

1. Schema 补充 tenantId（见 3.1）
2. 替换 `authenticateRequest` → `authenticateRequestEnhanced`
3. 普通租户用户：`tokenWhereClause.tenantId = tenant.tenantId`
4. 管理员：`tenantAccessFilter` 返回空条件（看所有）
5. 数据迁移：从 EvaluationSession/Project.tenantId 回填

**整改后过滤逻辑**：

```typescript
const auth = authenticateRequestEnhanced(request);
if (!auth.success) return authErrorResponseNested(auth);
const { payload, tenant } = auth as AuthSuccessResult;

if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles?.includes('admin'))) {
  evalWhereClause.tenantId = tenant.tenantId;
  tokenWhereClause.tenantId = tenant.tenantId;
}
```

#### 3.3.7 CodeswarmTask — `src/app/api/codeswarm/tasks/route.ts`

**问题**：完全无认证，任何人可查看/创建/删除任务。

**整改**：

1. Schema 补充 tenantId（见 3.1）
2. 全部方法添加 `authenticateRequestEnhanced` 认证
3. GET：raw SQL 加 `buildTenantSqlCondition`
4. POST：写入 `tenantId`（从当前用户）
5. DELETE：认证 + tenantId 过滤

**整改后 GET 示例**：

```typescript
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.TASK_READ });
  if (!auth.success) return authErrorResponse(auth);
  const { payload, tenant } = auth as AuthSuccessResult;

  const tenantCondition = buildTenantSqlCondition(tenant, { userRoles: payload.roles });

  const tasks = await prisma.$queryRaw`
    SELECT ... FROM "CodeswarmTask" t
    LEFT JOIN ...
    WHERE true ${tenantCondition}
    ORDER BY t."createdAt" DESC
    LIMIT 100
  `;
}
```

#### 3.3.8 SessionMessage

**整改要点**：

- Schema 补充 tenantId（见 3.1）
- 无独立 API 路由，随 EvaluationSession 查询
- 创建时从 EvaluationSession.tenantId 同步写入

#### 3.3.9 Vulnerability

**整改要点**：

- Schema 补充 tenantId（见 3.1）
- 创建时从 EvaluationSession/TaskInstance/Project.tenantId 同步写入
- `src/app/api/vulnerabilities/route.ts` GET 和统计查询加 tenantId 条件

### 3.4 创建流程的 tenantId 写入策略

| 场景 | tenantId 来源 |
|------|----------|
| API 路由创建（有认证） | `getTenantIdForCreate(tenant, isPublic)` |
| EvaluationSession 创建 | 从 Project.tenantId 继承 |
| SessionMessage 创建 | 从 EvaluationSession.tenantId 继承 |
| TokenUsage 创建 | 从 EvaluationSession.tenantId 或 User.tenantId |
| Vulnerability 创建 | 从 EvaluationSession/TaskInstance/Project.tenantId 继承 |
| CodeswarmTask 创建 | 从 TaskInstance.tenantId 或当前用户 tenantId |

### 3.5 数据迁移 SQL

Schema 变更后需回填已有记录的 tenantId：

```sql
-- EvaluationSession: 从 Project.tenantId 回填
UPDATE "EvaluationSession" es
SET "tenantId" = p."tenantId"
FROM "Project" p
WHERE es."projectId" = p.id AND es."tenantId" IS NULL;

-- TokenUsage: 从 EvaluationSession.tenantId 回填
UPDATE "TokenUsage" tu
SET "tenantId" = es."tenantId"
FROM "EvaluationSession" es
WHERE tu."evaluationId" = es.id AND tu."tenantId" IS NULL;

-- TokenUsage: 从 Project.tenantId 回填（无 evaluationId）
UPDATE "TokenUsage" tu
SET "tenantId" = p."tenantId"
FROM "Project" p
WHERE tu."projectId" = p.id AND tu."tenantId" IS NULL AND tu."evaluationId" IS NULL;

-- TokenUsage: 从 User.tenantId 回填（仅 userId）
UPDATE "TokenUsage" tu
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE tu."userId" = u.id AND tu."tenantId" IS NULL;

-- SessionMessage: 从 EvaluationSession.tenantId 回填
UPDATE "SessionMessage" sm
SET "tenantId" = es."tenantId"
FROM "EvaluationSession" es
WHERE sm."evaluationSessionId" = es.id AND sm."tenantId" IS NULL;

-- Vulnerability: 从 TaskInstance.tenantId 回填
UPDATE "Vulnerability" v
SET "tenantId" = ti."tenantId"
FROM "TaskInstance" ti
WHERE v."taskId" = ti.id AND v."tenantId" IS NULL;

-- Vulnerability: 从 Project.tenantId 回填
UPDATE "Vulnerability" v
SET "tenantId" = p."tenantId"
FROM "Project" p
WHERE v."projectId" = p.id AND v."tenantId" IS NULL;

-- CodeswarmTask: 从 TaskInstance.tenantId 回填
UPDATE "CodeswarmTask" ct
SET "tenantId" = ti."tenantId"
FROM "TaskInstance" ti
WHERE ct."platformTaskId" = ti.id AND ct."tenantId" IS NULL;
```

---

## 四、实施优先级与工作量估算

### Phase 1 — 安全关键（1-2 天）

| # | 任务 | 文件 | 工作量 |
|:---:|------|------|:---:|
| 1 | Schema 补充 5 个模型的 tenantId | `prisma/schema.prisma` | 0.5h |
| 2 | `npm run db:push` 执行 Schema 变更 | — | 0.5h |
| 3 | 数据迁移 SQL（回填 tenantId） | 新建脚本 | 1h |
| 4 | CodeswarmTask 添加认证 + tenantId | `src/app/api/codeswarm/tasks/route.ts` | 2h |
| 5 | tenant-filter.ts 新增辅助函数 | `src/lib/tenant-filter.ts` | 1h |

### Phase 2 — 核心实体 API 整改（3-5 天）

| # | 任务 | 文件 | 工作量 |
|:---:|------|------|:---:|
| 6 | Project 全部路由切换 Enhanced + tenantAccessFilter | `src/app/api/projects/[id]/route.ts` | 2h |
| 7 | Workflow 全部路由切换 + tenantId 过滤 | `src/app/api/workflows/[id]/route.ts` | 2h |
| 8 | User GET/PATCH/DELETE 加租户过滤 | `src/app/api/users/[id]/route.ts` | 2h |
| 9 | AgentFlowPipeline 详情/编辑加 tenantId 检查 | `src/app/api/agentflow-pipelines/[id]/route.ts` | 1h |
| 10 | EvaluationSession GET/DELETE 加 tenantAccessFilter | `src/app/api/evaluations/[id]/route.ts` | 2h |
| 11 | TokenUsage / token-stats 加 tenantId 过滤 | `src/app/api/token-stats/route.ts` | 3h |

### Phase 3 — 关联实体与内部服务（2-3 天）

| # | 任务 | 文件 | 工作量 |
|:---:|------|------|:---:|
| 12 | Vulnerability API 加 tenantId 过滤 | `src/app/api/vulnerabilities/route.ts` | 2h |
| 13 | SessionMessage 写入 tenantId | `src/services/evaluation/` | 1h |
| 14 | TokenUsage 写入 tenantId | `src/lib/system-token-tracker.ts` 等 | 1h |
| 15 | CodeswarmTask POST 写入 tenantId | `src/app/api/codeswarm/tasks/route.ts` | 0.5h |
| 16 | Vulnerability 创建写入 tenantId | `src/app/api/vulnerabilities/route.ts` | 0.5h |
| 17 | EvaluationSession 创建写入 tenantId | `src/services/evaluation/` | 0.5h |

### Phase 4 — 验证与测试（1-2 天）

| # | 任务 | 工作量 |
|:---:|------|:---:|
| 18 | 多租户集成测试：租户 A 看不到租户 B 的私有数据 | 3h |
| 19 | 公开资源测试：isPublic=true 跨租户可见 | 1h |
| 20 | admin 角色测试：平台管理员看所有，租户管理员看本租户 | 2h |
| 21 | 前端展示验证 | 2h |

**总计估算**：7-12 天（含测试），约 20-25h 实际编码量。

---

## 五、风险与注意事项

| 风险 | 说明 |
|------|------|
| **数据迁移不可逆** | 回填 tenantId 前需备份数据库；回填后 NULL 值表示平台级资源或历史遗留 |
| **$queryRaw 查询** | CodeswarmTask 和 token-stats 趋势查询使用原生 SQL，需手动拼接租户条件 |
| **前端适配** | 后端加租户过滤后前端无需改动（数据已过滤），但需确认无绕过后端的场景 |
| **性能** | 新增 tenantId 索引对查询性能影响极小；`buildTenantFilter` OR 条件需关注慢查询 |
| **级联删除** | EvaluationSession 删除时需级联删除同 tenantId 的 TokenUsage、SessionMessage、Vulnerability |
| **SSE 推送** | 评估会话的 SSE 推送也需检查租户归属，避免跨租户推送 |
| **Codeswarm Worker** | Worker 内部创建的数据（事件、心跳）无需 tenantId，但关联的 CodeswarmTask 需要 |

---

## 六、整改后预期效果

- **Skill/Agent/模型**：isPublic=true 对所有租户可见，私有仅同租户可见 ✅
- **任务**：仅同租户可见，admin 可看所有 ✅
- **token 消耗/用户统计**：按租户聚合，租户间不可互看 ✅
- **API Key**：仅同租户可见和管理 ✅
- **User**：仅同租户可见 ✅
- **数据库**：所有需隔离实体均有 tenantId ✅

---

## 七、与 URL 权限控制整改的关系

若先完成 `docs/url-permission-control-spec.md` 的整改（API 路径权限化），再进行租户隔离整改，两者关系如下：

| 方面 | URL 权限控制整改对租户隔离的影响 |
|------|------|
| **authenticateRequestEnhanced 推广** | URL 权限整改会统一将路由迁移到 `authenticateRequestEnhanced`，**租户隔离整改可直接复用**，减少 Phase 2 中 6/7/8/10/11 的认证切换工作量 |
| **中间件架构** | URL 权限整改可能引入路由级中间件，租户过滤可**作为中间件的一环**而非每个路由手动编码 |
| **PERMISSIONS 常量** | URL 权限整改会完善 `PERMISSIONS` 定义，租户隔离依赖的 `requiredPermission` 参数**已就绪** |
| **Schema tenantId** | URL 权限整改**不涉及 Schema 变更**，Phase 1 的 tenantId 补充仍需独立执行 |
| **CodeswarmTask** | URL 权限整改**会为其添加认证**，但不会添加 tenantId 过滤——仍需 Phase 1 补充 |
| **总工作量变化** | URL 权限整改完成后，租户隔离的 Phase 2 工作量**减少约 30%**（认证切换和权限检查部分已由 URL 权限整改覆盖），但 Phase 1（Schema+迁移）和 Phase 3（写入链路）不受影响 |

**建议顺序**：先完成 URL 权限控制整改 → 再执行租户隔离整改，可避免重复的认证重构工作。
