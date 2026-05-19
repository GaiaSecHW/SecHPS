# 多租户系统设计文档

**版本**: 1.1
**日期**: 2026-05-09
**状态**: 已实施

---

## 1. 背景与目标

### 1.1 业务场景

将现有 SecHPS 平台改造为多租户系统，支持：
- **ICSL 部门**：拥有所有权限，可创建公共（public）资源供其他租户使用
- **其他产品线部门**：只能访问 public 资源和自己部门的数据

### 1.2 设计原则

1. **强制租户 + 平台管理员**：普通用户必须属于租户；admin 角色可无租户（tenantId=null）
2. **应用层过滤**：使用应用层租户过滤（已从 SQLite 迁移至 PostgreSQL，未来可考虑 RLS 优化）
3. **最小改动**：尽量复用现有架构
4. **ICSL 特权**：ICSL 租户用户可跨租户访问所有数据

### 1.3 用户与租户关系

```
┌─────────────────────────────────────┐
│           平台管理员                 │  ← admin 角色，tenantId = null
│         (系统管理)                   │
└─────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐    ┌─────────────────┐
│    ICSL 租户     │    │  产品线A 租户    │
│   (所有权限)     │    │   (受限权限)     │
└─────────────────┘    └─────────────────┘
         │                    │
         ▼                    ▼
      用户A               用户B, 用户C
   (tenantId=icsl)     (tenantId=team-a)
```

---

## 2. 数据模型设计

### 2.1 Tenant 表

```prisma
model Tenant {
  id          String   @id
  name        String   // 部门名称
  slug        String   @unique
  isIcsTenant Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关联
  users       User[]
  AgentApp    AgentApp[]
  Project     Project[]
  Workflow    Workflow[]
  Skill       Skill[]
  AgentTeam   AgentTeam[]
  ModelConfig ModelConfig[]
  McpServerConfig McpServerConfig[]
  TaskInstance TaskInstance[]
}
```

### 2.2 业务表添加租户隔离字段

| 表名 | tenantId | isPublic | 说明 |
|------|----------|----------|------|
| User | ✅ | ❌ | 用户所属租户 |
| AgentApp | ✅ | ✅ | Agent 应用 |
| Project | ✅ | ✅ | 项目 |
| Workflow | ✅ | ✅ | 工作流 |
| Skill | ✅ | ✅ | 技能 |
| AgentTeam | ✅ | ❌ | Agent 团队 |
| ModelConfig | ✅ | ✅ | 模型配置 |
| McpServerConfig | ✅ | ✅ | MCP 服务器 |
| TaskInstance | ✅ | ✅ | 任务实例 |

---

## 3. JWT 扩展设计

### 3.1 扩展 JWTPayload

```typescript
export interface JWTPayload {
  userId: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
  tenantId: string | null;    // 租户ID
  isIcsTenant: boolean;       // 是否ICSL租户
}
```

---

## 4. 核心实现

### 4.1 租户上下文模块 (`src/lib/tenant.ts`)

```typescript
export interface TenantContext {
  tenantId: string | null;     // null 表示平台管理员
  isIcsTenant: boolean;
  isPlatformAdmin: boolean;    // admin 角色且无租户
}

export function getTenantContext(payload: JWTPayload): TenantContext {
  const isSuperAdmin = payload.roles.includes('admin');
  return {
    tenantId: payload.tenantId ?? null,
    isIcsTenant: payload.isIcsTenant ?? false,
    isPlatformAdmin: isSuperAdmin && !payload.tenantId,
  };
}
```

### 4.2 租户过滤工具 (`src/lib/tenant-filter.ts`)

```typescript
// 构建基于租户的 WHERE 条件
export function buildTenantFilter(
  context: TenantContext,
  options?: { tenantField?: string; isPublicField?: string; }
): object

// 获取创建资源时的租户字段值
export function getTenantIdForCreate(context: TenantContext, isPublic: boolean): string | null
```

### 4.3 API 认证中间件扩展 (`src/lib/api-auth.ts`)

```typescript
export interface AuthSuccessResult {
  success: true;
  payload: JWTPayload;
  tenant: TenantContext;
  isAdmin: boolean;
  userId: string;
}

// 使用 authenticateRequestEnhanced 替代 authenticateRequest
export function authenticateRequestEnhanced(
  request: Request,
  options?: AuthenticateOptions
): AuthResult | AuthSuccessResult
```

---

## 5. API 租户隔离规则

### 5.1 权限模型

| 用户类型 | 可访问范围 | 可创建 public |
|---------|-----------|--------------|
| 平台管理员 (admin) | 所有 | ✅ |
| ICSL 租户用户 | 所有 | ✅ |
| 普通租户用户 | public + 同租户 | ❌ |

### 5.2 查询过滤模式

```typescript
const { tenant, payload } = auth;

if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
  // 管理员/ICSL：可见所有
} else {
  // 普通用户：public + 同租户
  const filter = buildTenantFilter(tenant, {
    tenantField: 'tenantId',
    isPublicField: 'isPublic',
  });
  where.OR = [
    { userId: payload.userId },
    { ...filter },
  ];
}
```

### 5.3 创建资源模式

```typescript
const isPublic = body.isPublic ?? false;

// 验证权限
if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
  return NextResponse.json({ error: '只有 ICSL 租户可以创建公共资源' }, { status: 403 });
}

const tenantId = getTenantIdForCreate(tenant, isPublic);
```

---

## 6. 已改造的 API

| API | 文件 | 说明 |
|-----|------|------|
| Workflows | `/api/workflows/route.ts` | GET list, POST create |
| AgentApps | `/api/agent-apps/route.ts` | GET list, POST create |
| Skills | `/api/skills/route.ts` | GET list, POST create |
| Models | `/api/models/route.ts` | GET list, POST create |
| McpServers | `/api/mcp-servers/route.ts` | GET list, POST create |
| Projects | `/api/projects/route.ts` | GET list, POST create |
| Users | `/api/users/route.ts` | GET list with tenantId filter, POST create |
| TaskInstances | `/api/task-builder/tasks/route.ts` | GET list, POST create |
| Login | `/api/auth/login/route.ts` | 返回 tenantId, tenantName, isIcsTenant |

---

## 7. 租户管理 API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/admin/tenants` | 租户列表 |
| POST | `/api/admin/tenants` | 创建租户 |
| GET | `/api/admin/tenants/[id]` | 租户详情 |
| PATCH | `/api/admin/tenants/[id]` | 更新租户 |
| DELETE | `/api/admin/tenants/[id]` | 删除租户 |
| GET | `/api/admin/tenants/[id]/users` | 租户用户列表 |
| POST | `/api/admin/tenants/[id]/users` | 添加用户到租户 |
| DELETE | `/api/admin/tenants/[id]/users` | 从租户移除用户 |

---

## 8. Dashboard 前端

### 8.1 头部租户显示

在 `src/app/dashboard/layout.tsx` 中显示：
- 租户名称标签（蓝色）
- ICSL 标签（紫色）
- 平台管理员标签（红色）

### 8.2 租户管理页面

`/dashboard/admin/tenants` - 租户列表和 CRUD 操作

---

## 9. 注意事项

1. **缓存失效**：用户权限变更后需要清除缓存
2. **向后兼容**：现有数据 tenantId 为 null 的视为无租户
3. **种子数据**：运行 `npm run db:seed` 初始化租户数据
4. **数据库**：已从 SQLite 迁移至 PostgreSQL，数据库连接配置参见 `.env` 中的 `DATABASE_URL`
5. **集成测试**：运行 `node scripts/test-multi-tenant.js` 验证租户隔离是否正常
6. **迁移脚本**：`prisma/migrations/tenant_migration.ts` 用于已有数据的多租户字段初始化

---

## 10. 角色权限体系（RBAC）

### 10.1 角色概览

系统定义 5 个内置角色，定义于 `src/types/permissions.ts`：

| 角色 | 标识 | 定位 |
|------|------|------|
| 管理员 | `admin` | 超级管理员，拥有全部权限 |
| 管理者 | `manager` | 业务管理者，拥有大部分业务模块权限 |
| 开发者 | `developer` | 开发人员，专注于项目/模型/工作流/技能/MCP |
| 普通用户 | `user` | 基础用户，仅操作自己的项目和模型 |
| 只读用户 | `viewer` | 只读观察者，仅查看基础信息 |

### 10.2 各角色权限矩阵

#### 系统管理类

| 权限模块 | admin | manager | developer | user | viewer |
|---------|:-----:|:-------:|:---------:|:----:|:------:|
| 用户管理（CRUD + 分配角色） | ✅ | 读/改 | ❌ | ❌ | ❌ |
| 角色管理（CRUD + 分配权限） | ✅ | 读 | ❌ | ❌ | ❌ |
| 权限管理（CRUD） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 系统配置（读/改） | ✅ | 读/改 | ❌ | ❌ | ❌ |
| 审计日志 | ✅ | ✅ | ❌ | ❌ | ❌ |

#### 业务功能类

| 权限模块 | admin | manager | developer | user | viewer |
|---------|:-----:|:-------:|:---------:|:----:|:------:|
| 会话（Session） | ✅ | ✅ | ❌ | ❌ | ❌ |
| 插件（Plugin） | ✅ | ✅ | ❌ | ❌ | ❌ |
| Agent / Agent Definition | ✅ | ✅ | ❌ | ❌ | ❌ |
| Agent 团队 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 自主进化 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 代码分析 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 通知管理 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 漏洞管理 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 评估管理 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 搜索/文件 | ✅ | ✅ | ❌ | ❌ | ❌ |
| Skills Governance | ✅ | ❌ | ❌ | ❌ | ❌ |

#### 开发资源类

| 权限模块 | admin | manager | developer | user | viewer |
|---------|:-----:|:-------:|:---------:|:----:|:------:|
| 项目（Project） | ✅ | ✅ | ✅ | ✅ | 只读 |
| 模型（Model） | ✅ | ✅ | ✅ | ✅ | 只读 |
| 工作流（Workflow） | ✅ | ✅ | ✅ | ❌ | 只读 |
| 技能（Skill） | ✅ | ✅ | ✅ | ❌ | 只读 |
| MCP 服务器 | ✅ | ❌ | ✅ | ❌ | ❌ |
| Token 统计 | ✅ | ✅ | ✅ | ✅ | 只读 |

### 10.3 角色与租户的配合机制

角色（Role）控制**你能做什么**（功能权限），租户（Tenant）控制**你能看到哪些数据**（数据隔离）。两者正交组合。

#### 请求鉴权全流程

```
HTTP 请求
  → authenticateRequestEnhanced()
    → 1. 提取 JWT Token（Authorization Header）
    → 2. verifyToken() 验证签名和有效期
    → 3. hasPermission() 检查功能权限（角色维度）
    → 4. getTenantContext() 解析租户上下文
    → 5. buildTenantFilter() 构建数据隔离条件（租户维度）
    → 6. 执行 Prisma 查询（带租户过滤）
```

#### 租户过滤决策树

```
请求 → getTenantContext(JWT)
                │
    ┌───────────┼───────────────┐
    │           │               │
平台管理员    ICSL租户用户    普通租户用户
(tenantId=null, (isIcsTenant=true) (tenantId=有值)
 admin角色)
    │           │               │
    ▼           ▼               ▼
  {}           {}         { OR: [
(不过滤,      (不过滤,      { tenantId },
 全部可见)     全部可见)     { isPublic: true }
                          ] }
```

#### 权限 × 租户组合示例

| 场景 | 角色 | 租户类型 | 效果 |
|------|------|---------|------|
| 平台运维 | admin | 无租户 (tenantId=null) | 所有功能 + 所有数据 |
| ICSL 管理员 | admin | ICSL 租户 | 所有功能 + 所有数据 |
| 产品线经理 | manager | 普通租户 | 业务功能 + 本租户和公开数据 |
| 产品线开发 | developer | 普通租户 | 开发功能 + 本租户和公开数据 |
| 产品线普通用户 | user | 普通租户 | 基础功能 + 本租户和公开数据 |
| 外部观察者 | viewer | 普通租户 | 只读 + 本租户和公开数据 |

### 10.4 权限定义源码位置

- 权限常量：`src/types/permissions.ts` — `PERMISSIONS` 对象
- 角色常量：`src/types/permissions.ts` — `ROLES` 对象
- 角色权限映射：`src/types/permissions.ts` — `DEFAULT_ROLE_PERMISSIONS` 对象
- 权限检查函数：`src/lib/permissions.ts`（客户端） / `src/lib/auth.ts`（服务端）
- 租户上下文：`src/lib/tenant.ts` — `getTenantContext()`
- 租户过滤：`src/lib/tenant-filter.ts` — `buildTenantFilter()`
- 认证中间件：`src/lib/api-auth.ts` — `authenticateRequestEnhanced()`