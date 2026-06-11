# SecHPS 权限体系整改方案（V3 — 最小改动版）

> **版本**: V3 最小改动版。不新增权限常量，不修改角色权限映射，仅做三处改动。
> **核心原则**: 利用现有 `PERMISSIONS` 常量和 `DEFAULT_ROLE_PERMISSIONS`，集中化前端路由拦截 + 后端 API 补 `requiredPermission`。
> **角色体系**: 保持 3 角色（admin / developer / user），不做扩展。

---

## 1. 整改策略

| 编号 | 策略 | 核心要求 |
|------|------|----------|
| S1 | 前端路由集中拦截 | 创建 `route-permissions.ts` + `middleware.ts`，按角色拦截未授权页面访问 |
| S2 | 租户管理隔离 | 侧边栏 + Middleware + API 三层均仅平台管理员（admin + 无 tenantId）可访问 |
| S3 | 后端 API 补权限 | 给仅认证无权限的 API 路由补上 `requiredPermission`（用已有常量） |

---

## 2. 现有权限覆盖情况

现有 `PERMISSIONS` 常量已能覆盖所有导航模块，无需新增：

| 导航模块 | 可复用的已有权限常量 |
|---|---|
| 我的任务 | `SESSION_CREATE/READ/UPDATE/DELETE/SHARE/REVERT` |
| Skill市场 | `SKILL_CREATE/READ/UPDATE/DELETE/EXECUTE` |
| MCP市场 | `MCP_CREATE/READ/UPDATE/DELETE/CONNECT` |
| Agent市场 | `AGENT_TEAM_CREATE/READ/UPDATE/DELETE/EXECUTE` |
| 工作流编排 | `WORKFLOW_CREATE/READ/UPDATE/DELETE/EXECUTE/SHARE`（复用） |
| 智能体进化 | `AUTONOMOUS_EVOLUTION_READ/CREATE/UPDATE/DELETE/EXTRACT/INJECT` |
| 知识图谱 | `CODE_READ` |
| 数据回流 | `CODE_READ` |
| 测评基准 | `EVALUATION_CREATE/READ/UPDATE/DELETE` |
| 用户管理 | `USER_CREATE/READ/UPDATE/DELETE/ASSIGN_ROLE` |
| 模型管理 | `MODEL_CREATE/READ/UPDATE/DELETE/TEST` |
| 租户管理 | `isPlatformAdmin` 检查（已有） |
| API Key | `isPlatformAdmin` 检查 |
| 系统SDK / 系统监控 | `CONFIG_READ` |
| 漏洞管理 | `VULNERABILITY_CREATE/READ/UPDATE/DELETE` |
| 智能体集群 | `CONFIG_UPDATE` |
| Token统计 | `TOKEN_READ/DETAIL` |

---

## 3. 改动1: 路由→角色映射 + 侧边栏改造

### 3.1 新建 `src/lib/route-permissions.ts`

```typescript
export const ROLE_HIERARCHY = ['admin', 'developer', 'user'];

// 路由 → 最低可见角色（与侧边栏三段对应）
export const ROUTE_ROLE_MAP: Record<string, string> = {
  '/dashboard/skills': 'developer',
  '/dashboard/mcp-servers': 'developer',
  '/dashboard/agent-apps': 'developer',
  '/dashboard/agentflow-pipelines': 'developer',
  '/dashboard/evolution': 'developer',
  '/dashboard/knowledge-graph': 'developer',
  '/dashboard/data-feedback': 'developer',
  '/dashboard/evaluation': 'developer',
  '/dashboard/users': 'admin',
  '/dashboard/models': 'admin',
  '/dashboard/admin': 'admin',
  '/dashboard/codeswarm': 'admin',
};

export function canAccessRoute(userRoles: string[], route: string): boolean {
  const required = findRequiredRole(route);
  if (!required) return true;
  const requiredLevel = ROLE_HIERARCHY.indexOf(required);
  return userRoles.some(role => ROLE_HIERARCHY.indexOf(role) <= requiredLevel);
}

function findRequiredRole(route: string): string | undefined {
  // 精确匹配
  if (ROUTE_ROLE_MAP[route]) return ROUTE_ROLE_MAP[route];
  // 前缀匹配（取最长匹配）
  const matched = Object.keys(ROUTE_ROLE_MAP)
    .filter(key => route.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return matched ? ROUTE_ROLE_MAP[matched] : undefined;
}

// 租户管理特殊判断: 仅平台管理员(admin角色 + 无tenantId)
export function canAccessTenantManagement(userRoles: string[], tenantId: string | null): boolean {
  return userRoles.includes('admin') && !tenantId;
}
```

### 3.2 修改 `src/app/dashboard/layout.tsx`

替换三处硬编码 `user?.roles?.includes(...)` 为 `canAccessRoute` / `canAccessTenantManagement`：

```typescript
import { canAccessRoute, canAccessTenantManagement } from '@/lib/route-permissions';

// 开发者视图（原: user?.roles?.includes('developer') || user?.roles?.includes('admin'))
{canAccessRoute(user.roles, '/dashboard/skills') && (
  <>
    {/* 分割线 */}
    <NavLink href="/dashboard/skills" ...>Skill市场</NavLink>
    <NavLink href="/dashboard/mcp-servers" ...>MCP市场</NavLink>
    <NavLink href="/dashboard/agent-apps" ...>Agent市场</NavLink>
    <NavLink href="/dashboard/agentflow-pipelines" ...>工作流编排</NavLink>
  </>
)}

// 数据与进化（原: user?.roles?.includes('developer') || user?.roles?.includes('admin'))
{canAccessRoute(user.roles, '/dashboard/evolution') && (
  <>
    {/* 分割线 */}
    <NavLink href="/dashboard/evolution" ...>智能体进化</NavLink>
    <NavLink href="/dashboard/knowledge-graph" ...>知识图谱</NavLink>
    <NavLink href="/dashboard/data-feedback" ...>数据回流</NavLink>
    <NavLink href="/dashboard/evaluation" ...>测评基准</NavLink>
  </>
)}

// 管理员视图（原: user?.roles?.includes('admin')）
{canAccessRoute(user.roles, '/dashboard/users') && (
  <>
    {/* 分割线 */}
    <NavLink href="/dashboard/users" ...>用户管理</NavLink>
    <NavLink href="/dashboard/models" ...>模型管理</NavLink>
    {/* 租户管理 — 仅平台管理员 */}
    {canAccessTenantManagement(user.roles, user.tenantId) && (
      <NavLink href="/dashboard/admin/tenants" ...>租户管理</NavLink>
    )}
    <NavLink href="/dashboard/admin/api-keys" ...>API Key管理</NavLink>
    <NavLink href="/dashboard/admin/sdk" ...>系统SDK</NavLink>
    <NavLink href="/dashboard/admin/monitoring" ...>系统监控</NavLink>
    <NavLink href="/dashboard/admin/vulnerabilities" ...>漏洞管理</NavLink>
    <NavLink href="/dashboard/codeswarm" ...>智能体集群</NavLink>
  </>
)}
```

---

## 4. 改动2: Middleware 前端路由拦截

### 4.1 新建 `src/middleware.ts`

在 Middleware 层拦截直接 URL 访问，与 `route-permissions.ts` 的映射保持一致：

```typescript
import { NextRequest, NextResponse } from 'next/server';

const ROLE_HIERARCHY = ['admin', 'developer', 'user'];

const PROTECTED_ROUTES: Record<string, string> = {
  '/dashboard/skills': 'developer',
  '/dashboard/mcp-servers': 'developer',
  '/dashboard/agent-apps': 'developer',
  '/dashboard/agentflow-pipelines': 'developer',
  '/dashboard/evolution': 'developer',
  '/dashboard/knowledge-graph': 'developer',
  '/dashboard/data-feedback': 'developer',
  '/dashboard/evaluation': 'developer',
  '/dashboard/users': 'admin',
  '/dashboard/models': 'admin',
  '/dashboard/admin': 'admin',
  '/dashboard/codeswarm': 'admin',
};

function findRequiredRole(pathname: string): string | undefined {
  if (PROTECTED_ROUTES[pathname]) return PROTECTED_ROUTES[pathname];
  const matched = Object.keys(PROTECTED_ROUTES)
    .filter(key => pathname.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return matched ? PROTECTED_ROUTES[matched] : undefined;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/dashboard')) return NextResponse.next();

  const requiredRole = findRequiredRole(pathname);
  if (!requiredRole) return NextResponse.next();

  // 从 cookie 或 header 获取 token
  const token = request.cookies.get('auth-token')?.value
    || request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.redirect(new URL('/login', request.url));

  try {
    // 仅解析 payload 用于路由拦截（不验证签名，API 层做完整验证）
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userRoles: string[] = payload.roles || [];
    const tenantId: string | null = payload.tenantId;

    // 租户管理特殊检查: admin角色 + 无tenantId
    if (pathname.startsWith('/dashboard/admin/tenants')) {
      if (!userRoles.includes('admin') || tenantId) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // 角色层级检查
    const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
    const hasAccess = userRoles.some(role => ROLE_HIERARCHY.indexOf(role) <= requiredLevel);
    if (!hasAccess) return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*'] };
```

---

## 5. 改动3: 后端 API 补 requiredPermission

给仅认证无权限的 API 路由补上 `requiredPermission`，**全部使用已有 PERMISSIONS 常量**。

### 5.1 按优先级排序

#### P0 — 无认证或关键模块仅认证无权限

| 模块 | 路由 | 当前问题 | 补加权限 |
|---|---|---|---|
| **codeswarm** | `tasks/`, `tasks/[taskId]/`, `tasks/[taskId]/logs/`, `tasks/[taskId]/stream/`, `tasks/[taskId]/dispatch/` | **无认证** | 加 `authenticateRequest` + `CONFIG_UPDATE` |
| **codeswarm** | `nodes/`, `nodes/[nodeId]/`, `browse-dirs/`, `download-report/`, `local-test/`, `local-test/files/`, `session-extract/history/`, `session-extract/history/[id]/`, `codedmap/cache/` | **无认证** | 加 `authenticateRequest` + `CONFIG_UPDATE` |
| **codeswarm** | `worker/result/`, `worker/event/` | **无认证**（Worker回调） | 保留 `verifyWorkerToken`，不改 |
| **agent-apps** | `route.ts` GET | 仅认证 | `AGENT_TEAM_READ` |
| **agent-apps** | `route.ts` POST | 仅认证 | `AGENT_TEAM_CREATE` |
| **agent-apps** | `[id]/route.ts` GET | 仅认证 | `AGENT_TEAM_READ` |
| **agent-apps** | `[id]/route.ts` PUT | 仅认证 | `AGENT_TEAM_UPDATE` |
| **agent-apps** | `[id]/route.ts` DELETE | 仅认证 | `AGENT_TEAM_DELETE` |
| **agent-apps** | `[id]/branches/route.ts` | 仅认证 | `AGENT_TEAM_READ` |
| **agent-apps** | `[id]/pipeline/route.ts` | 仅认证 | `AGENT_TEAM_READ` |
| **agent-apps** | `sync/route.ts` | 仅认证 | `AGENT_TEAM_UPDATE` |
| **agentflow-pipelines** | `route.ts` GET | 仅认证 | `WORKFLOW_READ` |
| **agentflow-pipelines** | `route.ts` POST | 仅认证 | `WORKFLOW_CREATE` |
| **agentflow-pipelines** | `[id]/route.ts` GET | 仅认证 | `WORKFLOW_READ` |
| **agentflow-pipelines** | `[id]/route.ts` PUT | 仅认证 | `WORKFLOW_UPDATE` |
| **agentflow-pipelines** | `[id]/route.ts` DELETE | 仅认证 | `WORKFLOW_DELETE` |
| **agentflow-pipelines** | `[id]/publish/route.ts` | 仅认证 | `WORKFLOW_SHARE` |
| **models (普通)** | `route.ts` GET | 仅认证 | `MODEL_READ` |
| **models (普通)** | `route.ts` POST | 仅认证 | `MODEL_CREATE` |
| **models (普通)** | `[id]/route.ts` GET | 仅认证 | `MODEL_READ` |
| **models (普通)** | `[id]/route.ts` PUT | 仅认证 | `MODEL_UPDATE` |
| **models (普通)** | `[id]/route.ts` DELETE | 仅认证 | `MODEL_DELETE` |
| **models (普通)** | `[id]/duplicate/route.ts` | 仅认证 | `MODEL_CREATE` |
| **models (普通)** | `[id]/test/route.ts` | 仅认证 | `MODEL_TEST` |
| **models (普通)** | `[id]/reset-context-window/route.ts` | 仅认证 | `MODEL_UPDATE` |

#### P1 — 核心业务模块仅认证无权限

| 模块 | 路由 | 补加权限 |
|---|---|---|
| **skills** | `route.ts` GET | `SKILL_READ` |
| **skills** | `route.ts` POST | `SKILL_CREATE` |
| **skills** | `[id]/route.ts` GET | `SKILL_READ` |
| **skills** | `[id]/route.ts` PUT | `SKILL_UPDATE` |
| **skills** | `[id]/route.ts` DELETE | `SKILL_DELETE` |
| **skills** | `[id]/replace/route.ts` | `SKILL_UPDATE` |
| **skills** | `[id]/vulnerabilities/route.ts` | `SKILL_READ` |
| **skills** | `[id]/metrics/route.ts` | `SKILL_READ` |
| **skills** | `[id]/evolve/route.ts` | `SKILL_EXECUTE` |
| **skills** | `[id]/test/route.ts` | `SKILL_EXECUTE` |
| **skills** | `[id]/analyze/route.ts` | `SKILL_EXECUTE` |
| **skills** | `[id]/cases/route.ts` | `SKILL_READ` |
| **skills** | `upload/route.ts` | `SKILL_CREATE` |
| **skills** | `vulnerability-tree/route.ts` | `SKILL_READ` |
| **skills** | `match/route.ts` | `SKILL_READ` |
| **skills** | `optimize-skill/route.ts` | `SKILL_UPDATE` |
| **skills** | `test-runs/route.ts` | `SKILL_READ` |
| **skills** | `predict-tasks/route.ts` | `SKILL_READ` |
| **skills** | `predict/route.ts` | `SKILL_EXECUTE` |
| **skills** | `sync/route.ts` | `SKILL_UPDATE` |
| **skills** | `product-tags/route.ts` | `SKILL_READ` |
| **skills** | `evolution/metrics/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/tasks/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/tasks/[taskId]/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/tasks/[taskId]/backtest/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/tasks/[taskId]/attempts/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/tasks/[taskId]/attempts/[attemptId]/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `evolution/config/route.ts` | `SKILL_EVOLUTION_MANAGE` |
| **skills** | `analyze-duplication/route.ts` | 已有 `SKILL_READ` ✅ |
| **skills** | `categories/route.ts` | `SKILL_READ` |
| **skills** | `export/route.ts` | `SKILL_READ` |
| **skills** | `batch/route.ts` | `SKILL_READ` |
| **skills** | `generate/route.ts` | `SKILL_CREATE` |
| **skills** | `import/route.ts` | `SKILL_CREATE` |
| **skills** | `evaluation-data/route.ts` | `SKILL_READ` |
| **sessions** | `[id]/todo/route.ts` | `SESSION_READ` |
| **sessions** | `[id]/children/route.ts` | `SESSION_READ` |
| **sessions** | `[id]/resume/route.ts` | `SESSION_UPDATE` |
| **sessions** | `[id]/messages/route.ts` | `SESSION_READ` |
| **sessions** | `search/route.ts` | `SESSION_READ` |
| **sessions** | `search/all/route.ts` | `SESSION_READ` |
| **sessions** | `projects/route.ts` | `SESSION_READ` |
| **sessions** | `projects/[project]/route.ts` | `SESSION_READ` |
| **evaluation** | 16个文件用 `verifyToken` 旧模式 | 统一迁移到 `authenticateRequest` + 对应 `EVALUATION_*` |
| **mcp-servers** | `route.ts` GET | `MCP_READ` |
| **mcp-servers** | `route.ts` POST | `MCP_CREATE` |
| **mcp-servers** | `[id]/route.ts` GET | `MCP_READ` |
| **mcp-servers** | `[id]/route.ts` PUT | `MCP_UPDATE` |
| **mcp-servers** | `[id]/route.ts` DELETE | `MCP_DELETE` |

#### P2 — 次要补充

| 模块 | 路由 | 补加权限 |
|---|---|---|
| **users** | `password/route.ts` | `USER_UPDATE` |
| **users** | `[id]/route.ts` GET | `USER_READ` |
| **users** | `[id]/route.ts` PUT | `USER_UPDATE` |
| **config** | `template/route.ts` | `CONFIG_READ` |
| **config** | `default-tool-permissions/route.ts` GET | `CONFIG_READ` |
| **admin/api-keys** | 加 `isPlatformAdmin` 检查 | 类似 tenants |
| **admin/sdk** | 加 `isPlatformAdmin` 检查 | 类似 tenants |
| **codeswarm** | `reparse/route.ts` | 已有权限 ✅ |
| **codeswarm** | `session-extract/route.ts` | `CONFIG_READ` |
| **codeswarm** | `worker/heartbeat/route.ts` | 保留 `verifyWorkerToken`，不改 |

---

## 6. 租户管理加固

### 6.1 现状

租户 API (`/api/admin/tenants/`) 已正确使用 `isPlatformAdmin` 检查：

```typescript
// 现有代码（正确）
if (!successAuth.tenant.isPlatformAdmin) {
  return NextResponse.json({ error: '禁止访问' }, { status: 403 });
}
```

### 6.2 需补充

| 层 | 当前问题 | 改动 |
|---|---|---|
| 侧边栏 | `user?.roles?.includes('admin')` 不区分租户内admin | → `canAccessTenantManagement(user.roles, user.tenantId)` |
| Middleware | 无拦截 | 新增租户管理路由特殊判断 |
| `admin/api-keys` API | 仅 `requiredPermission` 无 isPlatformAdmin | 补加 `isPlatformAdmin` 检查 |
| `admin/sdk` API | 仅认证无权限 | 补加 `isPlatformAdmin` 检查 |

---

## 7. 改动文件汇总

| 类型 | 文件数 | 改动内容 |
|---|---|---|
| **新建** | 2 | `src/lib/route-permissions.ts` + `src/middleware.ts` |
| **修改** | 1 | `src/app/dashboard/layout.tsx`（替换3处硬编码角色判断） |
| **修改** | ~50 | API route.ts（补 `requiredPermission` 参数或加认证） |

**不改动**：`src/types/permissions.ts`（权限常量）、`DEFAULT_ROLE_PERMISSIONS`（角色映射）、`ROLES`（角色定义）、`prisma/seed.ts`（种子数据）

---

## 8. 三层拦截架构

```
┌──────────────────────────────────────────────────┐
│  第1层: 前端导航过滤 (Sidebar + Middleware)       │
│  ─ 侧边栏: canAccessRoute() 按角色隐藏导航项     │
│  ─ Middleware: 角色层级拦截直接URL访问             │
│  ─ 租户管理: canAccessTenantManagement() 特殊判断 │
├──────────────────────────────────────────────────┤
│  第2层: 服务端 API 认证+权限                      │
│  ─ authenticateRequest({ requiredPermission })    │
│  ─ 租户管理: isPlatformAdmin 双重检查             │
├──────────────────────────────────────────────────┤
│  第3层: 数据层租户隔离 (tenant-filter)            │
│  ─ buildTenantFilter / withTenantFilter           │
│  ─ 保证跨租户数据不可见                           │
└──────────────────────────────────────────────────┘
```

---

## 9. 实施阶段

| 阶段 | 时间 | 任务 | 验证方式 |
|---|---|---|---|
| **Phase 1** | 1天 | 创建 `route-permissions.ts` + `middleware.ts`；改造侧边栏 | 不同角色登录验证导航可见性；URL直接访问受保护页面被拦截 |
| **Phase 2** | 3-5天 | P0级API权限：codeswarm(加认证)/agent-apps/agentflow/models | 低权限角色调用API返回403 |
| **Phase 3** | 3-5天 | P1级API权限：skills/sessions/evaluation/mcp-servers | 同上 |
| **Phase 4** | 1-2天 | P2级 + 租户API加固（api-keys/sdk isPlatformAdmin） | 全角色回归测试 |

---

## 10. 验收标准

| 编号 | 验收条件 | 验证方法 |
|------|----------|----------|
| V1 | user 角色 URL 直接访问管理员页面被重定向到首页 | user 账户访问 `/dashboard/users`、`/dashboard/models`、`/dashboard/admin/*` |
| V2 | user 角色 URL 直接访问开发者页面被重定向到首页 | user 账户访问 `/dashboard/skills`、`/dashboard/mcp-servers`、`/dashboard/agent-apps` |
| V3 | 租户管理仅平台管理员可见可访问 | 租户内admin → 侧边栏不显示租户管理，URL访问被重定向；平台管理员 → 正常 |
| V4 | user 角色 API 调用管理员/开发者接口返回 403 | user 账户 POST `/api/agent-apps`、GET `/api/models` |
| V5 | developer 角色 API 调用管理员接口返回 403 | developer 账户 GET `/api/users`、POST `/api/admin/models` |
| V6 | admin 角色（含租户内admin）无法访问租户管理API | 租户内admin → GET `/api/admin/tenants` 返回 403 |
| V7 | 侧边栏导航与角色层级一致 | 逐角色登录检查导航项可见性 |

---

## 11. 风险与注意事项

1. **CodeSwarm Worker 通信**: `worker/heartbeat`、`worker/result`、`worker/event` 保留 `verifyWorkerToken`，不做改动
2. **CodeSwarm 非Worker端点**: `tasks/`、`nodes/` 等当前无认证，需确认哪些是纯内部调用、哪些被前端使用后再加认证
3. **evaluation 旧模式**: 16个文件用 `verifyToken` + 手动 `hasPermission`，需逐文件迁移到 `authenticateRequest`
4. **middleware.ts 的 auth-token cookie**: 当前登录流程是否写入 `auth-token` cookie？需确认；若无则需在登录 API 中补充 cookie 设置，或 Middleware 仅依赖 Authorization header
5. **前端 localStorage.user**: 需确保登录时写入完整 `roles` + `tenantId`，否则 `canAccessRoute` 无法正确判断