# 多租户系统设计文档

**版本**: 1.0
**日期**: 2026-05-08
**状态**: 已实施

---

## 1. 背景与目标

### 1.1 业务场景

将现有 AI4WEB 平台改造为多租户系统，支持：
- **ICSL 部门**：拥有所有权限，可创建公共（public）资源供其他租户使用
- **其他产品线部门**：只能访问 public 资源和自己部门的数据

### 1.2 设计原则

1. **强制租户 + 平台管理员**：普通用户必须属于租户；admin 角色可无租户（tenantId=null）
2. **SQLite 兼容**：使用应用层过滤（SQLite 不支持 RLS）
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

| 表名 | tenantId | visibility | 说明 |
|------|----------|------------|------|
| User | ✅ | ❌ | 用户所属租户 |
| AgentApp | ✅ | ✅ | Agent 应用 |
| Project | ✅ | ✅ | 项目 |
| Workflow | ✅ | ✅ | 工作流 |
| Skill | ✅ | ✅ | 技能 |
| AgentTeam | ✅ | ✅ | Agent 团队 |
| ModelConfig | ✅ | ✅ | 模型配置 |
| McpServerConfig | ✅ | ❌ | MCP 服务器 |
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
  options?: { tenantField?: string; visibilityField?: string; }
): object

// 获取创建资源时的租户字段值
export function getTenantIdForCreate(context: TenantContext, isPublic: boolean): string | null

// 获取 visibility 值
export function getVisibility(isPublic: boolean): string
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
    visibilityField: 'visibility',
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

const visibility = getVisibility(isPublic);
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
| TaskInstances | `/api/task-builder/tasks/route.ts` | GET list, POST create |
| Login | `/api/auth/login/route.ts` | 返回 tenantId, isIcsTenant |

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