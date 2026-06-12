# SecHPS URL权限控制规范方案

> **版本**: V6 — 四层角色体系 + HttpOnly Cookie认证 + 租户隔离
> **日期**: 2026-06-12
> **前置文档**: `docs/permission-reform-plan.md`（V3最小改动版）
> **认证方案**: 方案B — HttpOnly `access_token` cookie + `/api/auth/me` 端点，移除localStorage token

---

## 1. 策略总览

本方案定义8条权限控制规则，覆盖前端页面、API接口、路由守卫、租户隔离四个层面：

| 编号 | 规则 | 核心要求 | 实施位置 |
|------|------|----------|----------|
| R1 | 非GET请求角色限制 | POST/PUT/PATCH/DELETE 仅允许 developer 及以上角色 | middleware.ts + API层 |
| R2 | Sessions模块角色指定 | `/dashboard/sessions` 及对应API/子路由 → developer | route-permissions.ts + API层 |
| R3 | 无认证API路由对齐 | 无认证API的权限对齐其对应dashboard页面 | API层补认证 |
| R4 | 子路由继承父路由守卫 | 父页守卫角色 → 所有子路由/子页面继承 | middleware.ts + 页面Guard |
| R5 | 动态URL最低developer + 租户认证 | `/api/v1/tasks/[taskId]/status` 等动态URL → developer最低 + tenant隔离 | API层 |
| R6 | 同URL混合权限用requirePermission | 读/写同路径 → 用已有权限常量做对象级控制 | API层 |
| R7 | PermissionGuard UX兜底 | 页面级Guard做用户体验兜底 | 页面组件 |
| R8 | 租户管理仅平台管理员 | 平台管理员（admin+无tenantId） → 唯一可访问者 | middleware + 侧边栏 + API |
| R9 | 纯后端调度接口仅平台管理员 | admin角色无权访问纯后端调度接口（如agent/execute、dispatch等） | middleware + API层 |

**认证架构变更**: 本方案采用 HttpOnly `access_token` cookie 认证（方案B），取代当前 localStorage + 非HttpOnly `auth-token` cookie 的双存储机制。详见第6节。

---

## 2. 角色层级定义

```
platform_admin (层级-1) ── 平台管理员（admin角色 + 无tenantId）
  │                           全部权限 + 租户管理 + 纯后端调度接口
  │                           可以做任何操作，包括跨租户数据访问
  │
admin       (层级0)  ── 租户内管理员（admin角色 + 有tenantId）
  │                           租户内全部权限 + 用户管理 + 模型管理等
  │                           ❌ 不能访问纯后端调度接口
  │                           ❌ 不能访问租户管理模块
  │                           仅能访问本租户数据（tenantFilter隔离）
  │
developer   (层级1)  ── 开发者权限 + 非GET请求权限
  │                           仅能访问本租户数据（tenantFilter隔离）
  │
user        (层级2)  ── 仅GET请求 + task-builder模块操作 + 基础模块访问
                           仅能访问本租户数据（tenantFilter隔离）
                           token统计仅GET查看本租户内数据
```

### 2.1 四层角色的权限边界

| 操作 | platform_admin | admin | developer | user |
|------|---------------|-------|-----------|------|
| 租户管理 CRUD | ✅ | ❌ | ❌ | ❌ |
| 纯后端调度接口 (R9) | ✅ | ❌ | ❌ | ❌ |
| 用户/角色/模型管理 | ✅(跨租户) | ✅(本租户内) | ❌ | ❌ |
| Skill/MCP/Agent等开发模块 | ✅ | ✅ | ✅ | ❌ |
| 非GET请求 (R1) | ✅ | ✅ | ✅ | ❌(task-builder例外) |
| task-builder操作 | ✅ | ✅ | ✅ | ✅ |
| GET查看基础数据 | ✅(跨租户) | ✅(本租户内) | ✅(本租户内) | ✅(本租户内) |
| token统计查看 | ✅(全系统) | ✅(本租户内) | ✅(本租户内) | ✅(GET, 本租户内) |

### 2.2 纯后端调度接口定义（R9）

**纯后端调度接口**：无前端页面消费者，仅用于系统内部调度、Worker通信、运维操作的API。admin角色无权访问这些接口，仅platform_admin可使用。

| API路径 | 功能 | 当前认证 | 整改后 |
|---------|------|---------|--------|
| `/api/codeswarm/tasks/[taskId]/dispatch` | 手动触发任务分发到Worker | **无认证** | 仅platform_admin（`isPlatformAdmin`） |
| `/api/agent/execute` | Skill执行(SSE流式) | authenticateRequest + AGENT_EXECUTE | 仅platform_admin |
| `/api/agent/chat` | Agent对话(SSE流式) | authenticateRequest + AGENT_CHAT | 仅platform_admin |
| `/api/agent/executions/[id]` | 获取执行记录 | verifyToken + isAdmin | 仅platform_admin |
| `/api/agent/executions/[id]/cancel` | 取消执行 | verifyToken | 仅platform_admin |
| `/api/admin/sync-permissions` | 权限同步到DB | ROLE_ASSIGN_PERMISSION | 仅platform_admin |
| `/api/admin/cache/clear` | 清除系统缓存 | CONFIG_UPDATE | 仅platform_admin |
| `/api/admin/cache/stats` | 缓存统计 | CONFIG_READ | 仅platform_admin |
| `/api/codeswarm/worker/heartbeat` | Worker心跳上报 | verifyWorkerToken(可选) | **保留Worker认证**（R9不适用） |
| `/api/codeswarm/worker/result` | Worker结果回调 | **无认证** | **保留Worker认证**（R9不适用） |
| `/api/codeswarm/worker/event` | Worker事件回调 | **无认证** | **保留Worker认证**（R9不适用） |
| `/api/global/health` | 健康检查 | 无认证 | 保持无认证 |

> **注意**: Worker回调接口（heartbeat/result/event）属于Worker→Orchestrator通信协议，使用独立Worker Token认证机制（`verifyWorkerToken`），不属于用户角色权限体系，因此R9不适用。

**角色层级判断**: `ROLE_HIERARCHY.indexOf(role)` 值越小权限越高。对于platform_admin特权（R8/R9），需额外检查 `!tenantId`。

---

## 3. 前端页面路由 → 角色映射

### 3.1 完整映射表（74个页面）

#### 所有用户可访问（user层级）

| URL路径 | 说明 | 子路由 |
|---------|------|--------|
| `/dashboard` | 首页 | — |
| `/dashboard/overview` | 仪表盘 | — |
| `/dashboard/task-builder` | 我的任务 | `/dashboard/task-builder/[id]` |
| `/dashboard/profile` | 个人中心 | — |
| `/dashboard/token-stats` | Token统计（仅GET，仅本租户内数据） | `/dashboard/token-stats/project/[id]`, `/dashboard/token-stats/users`(仅developer+可见) |

#### token统计模块权限策略

| 角色 | 页面可见性 | API权限 | 数据范围 |
|------|-----------|---------|---------|
| user | ✅（用户菜单保留入口） | 仅GET | **仅本租户内所有用户**的汇总统计 |
| developer | ✅ | GET | 本租户内所有用户 + TOKEN_DETAIL查看项目明细 |
| admin | ✅ | GET | 本租户内全部数据 |
| platform_admin | ✅ | GET | **全系统**跨租户全部数据 |

**整改要点**:
1. `/api/token-stats` 当前用 `authenticateRequest`（无租户隔离），需改用 `authenticateRequestEnhanced` + `withTenantFilter()`
2. user角色的数据过滤：从 `userId === payload.userId` 改为 `tenantId === payload.tenantId`（看本租户内所有用户，而非仅自己）
3. admin角色看全系统数据（platform_admin），租户内admin看本租户数据
4. `/dashboard/token-stats/users` 页面：当前仅admin可见，改为仅developer+可见（user看汇总但不看用户排行）
5. 用户菜单下拉入口保留给所有用户，但token统计数据范围按角色限制

#### developer 或 admin 可访问（developer层级）

| URL路径 | 说明 | 子路由（R4: 继承developer） |
|---------|------|--------|
| `/dashboard/sessions` | 会话管理（R2: 新指定为developer） | `/dashboard/sessions/[id]` |
| `/dashboard/skills` | Skill市场 | `/dashboard/skills/[id]`, `/dashboard/skills/create`, `/dashboard/skills/create-wizard`, `/dashboard/skills/import-create`, `/dashboard/skills/governance`, `/dashboard/skills/governance/review`, `/dashboard/skills/governance/migration` |
| `/dashboard/mcp-servers` | MCP市场 | — |
| `/dashboard/agent-apps` | Agent市场 | `/dashboard/agent-apps/developer-guide` |
| `/dashboard/agentflow-pipelines` | 工作流编排 | `/dashboard/agentflow-pipelines/[id]` |
| `/dashboard/evolution` | 智能体进化 | — |
| `/dashboard/knowledge-graph` | 知识图谱 | — |
| `/dashboard/data-feedback` | 数据回流 | — |
| `/dashboard/evaluation` | 测评基准 | `/dashboard/evaluations/[id]/report` |
| `/dashboard/claude` | Claude | `/dashboard/claude/[project]` |
| `/dashboard/tech-stack` | 技术栈 | — |

#### 仅 admin 可访问（admin层级）

| URL路径 | 说明 | 子路由（R4: 继承admin） |
|---------|------|--------|
| `/dashboard/users` | 用户管理 | `/dashboard/users/[id]` |
| `/dashboard/roles` | 角色管理 | — |
| `/dashboard/models` | 模型管理 | — |
| `/dashboard/admin` | 管理员模块 | 所有 `/dashboard/admin/*` 子路由 |
| `/dashboard/admin/api-keys` | API Key管理 | — |
| `/dashboard/admin/sdk` | 系统SDK | — |
| `/dashboard/admin/monitoring` | 系统监控 | — |
| `/dashboard/admin/vulnerabilities` | 漏洞管理 | `/dashboard/admin/vulnerabilities/[id]` |
| `/dashboard/admin/vulnerability-patterns` | 漏洞模式 | — |
| `/dashboard/admin/default-tool-permissions` | 默认工具权限 | — |
| `/dashboard/admin/categories` | 分类管理 | — |
| `/dashboard/admin/broadcast` | 广播 | — |
| `/dashboard/admin/fsm-templates` | FSM模板 | `/dashboard/admin/fsm-templates/[id]` |
| `/dashboard/admin/skills-evolution` | Skill进化 | `/dashboard/admin/skills-evolution/analysis/[id]`, `/dashboard/admin/skills-evolution/compare/[taskId]` |
| `/dashboard/admin/skills-governance` | Skill治理 | `/dashboard/admin/skills-governance/analysis-review`, `/dashboard/admin/skills-governance/analysis-review/[id]`, `/dashboard/admin/skills-governance/duplicate-groups`, `/dashboard/admin/skills-governance/duplicate-groups/[id]`, `/dashboard/admin/skills-governance/high-frequency`, `/dashboard/admin/skills-governance/merge`, `/dashboard/admin/skills-governance/merge-candidates`, `/dashboard/admin/skills-governance/new-impact`, `/dashboard/admin/skills-governance/trends` |
| `/dashboard/admin/tools` | 工具管理 | `/dashboard/admin/tools/create`, `/dashboard/admin/tools/[id]` |
| `/dashboard/admin/autonomous-evolution` | 自主进化 | `/dashboard/admin/autonomous-evolution/[id]` |
| `/dashboard/codeswarm` | 智能体集群 | — |
| `/dashboard/config` | 配置 | — |
| `/dashboard/plugins` | 插件 | — |

#### 仅平台管理员可访问（R8: admin + 无tenantId）

| URL路径 | 说明 | 子路由 |
|---------|------|--------|
| `/dashboard/admin/tenants` | 租户管理 | — |

### 3.2 前端导航整改

#### 侧边栏改动

| 位置 | 当前逻辑 | 整改后 |
|------|---------|--------|
| 使用者视图 | 所有用户可见 | 保持不变，但「我的模型」入口移除 |
| 开发者视图 | `user?.roles?.includes('developer') || user?.roles?.includes('admin')` | 改用 `canAccessRoute(user.roles, '/dashboard/skills')` |
| 数据与进化 | `user?.roles?.includes('developer') || user?.roles?.includes('admin')` | 改用 `canAccessRoute(user.roles, '/dashboard/evolution')` |
| 管理员视图 | `user?.roles?.includes('admin')` | 改用 `canAccessRoute(user.roles, '/dashboard/users')`，租户管理改用 `canAccessTenantManagement` |

#### 用户菜单下拉改动

| 入口 | 当前逻辑 | 整改后 |
|------|---------|--------|
| 个人中心 | 所有用户 | 保持不变 |
| **我的模型** | 所有用户（`/dashboard/models`） | **仅admin可见**（非admin移除该入口） |
| Token统计 | 所有用户 | **保留给所有用户**，但数据范围按角色+租户隔离（见3.1 token统计策略） |

### 3.3 当前守卫缺失统计

| 状态 | 页面数量 | 说明 |
|------|---------|------|
| **有守卫** | 24 | AdminGuard(15) + DeveloperGuard(4) + PermissionGuard(2) + inline(3) |
| **无守卫但侧边栏隐藏** | 23 | 可通过直接URL访问（R4将修复） |
| **无守卫且侧边栏可见** | 27 | 包括sessions、claude、tech-stack等 |

---

## 4. API路由 → 权限映射

### 4.1 规则R1: 非GET请求角色限制

**规则**: 所有 POST/PUT/PATCH/DELETE 请求，调用者角色必须是 developer 或 admin。user 角色只能发起 GET 请求。

**R1例外**（非GET但仍允许user的路径）:

| 路径 | HTTP方法 | 原因 |
|------|---------|------|
| `/api/task-builder/tasks` | POST | user需创建任务 |
| `/api/task-builder/tasks/[id]/execute` | POST | user需启动任务执行 |
| `/api/task-builder/tasks/[id]/stop` | POST | user需停止任务 |
| `/api/task-builder/tasks/[id]` | DELETE | user需删除自己的任务 |
| `/api/users/password` | POST | user需修改自己密码 |
| `/api/auth/login` | POST | 公开接口 |
| `/api/auth/logout` | POST | 公开接口 |
| `/api/auth/refresh` | POST | 公开接口 |
| `/api/auth/register` | POST | 公开接口 |

> **task-builder是唯一允许user角色非GET操作的模块**。user的核心工作流是：创建任务 → 启动执行 → 查看结果 → 下载报告 → 删除任务。所有这些操作对应的API路径都在 `/api/task-builder/` 下。

**受影响的API路由**（user角色原本可以POST/PUT/DELETE但现在被R1禁止的）:

| 模块 | 路由 | HTTP方法 | user原有权限常量 | R1后影响 |
|------|------|---------|---------------|---------|
| projects | `/api/projects` POST | POST | PROJECT_CREATE | **禁止**（R1） |
| projects | `/api/projects/[id]` PUT/PATCH/DELETE | PUT/PATCH/DELETE | PROJECT_UPDATE/DELETE | **禁止**（R1） |
| projects | `/api/projects/[id]/files` POST | POST | FILE_WRITE | **禁止**（R1） |
| projects | `/api/projects/[id]/start` POST | POST | PROJECT_UPDATE | **禁止**（R1） |
| models | `/api/models` POST | POST | MODEL_CREATE | **禁止**（R1） |
| models | `/api/models/[id]` PUT/DELETE | PUT/DELETE | MODEL_UPDATE/DELETE | **禁止**（R1） |

### 4.2 规则R2: Sessions模块

| 路由 | HTTP方法 | 权限要求 |
|------|---------|---------|
| `/api/sessions` | GET | developer+ (SESSION_READ) |
| `/api/sessions/search` | GET | developer+ (SESSION_READ) |
| `/api/sessions/search/all` | GET | developer+ (SESSION_READ) |
| `/api/sessions/projects` | POST | developer+ (SESSION_READ) |
| `/api/sessions/projects/[project]` | DELETE | developer+ (SESSION_UPDATE) |
| `/api/sessions/[id]` | GET | developer+ (SESSION_READ) |
| `/api/sessions/[id]` | DELETE | developer+ (SESSION_DELETE) |
| `/api/sessions/[id]/children` | GET | developer+ (SESSION_READ) |
| `/api/sessions/[id]/messages` | GET | developer+ (SESSION_READ) |
| `/api/sessions/[id]/resume` | POST | developer+ (SESSION_UPDATE) |
| `/api/sessions/[id]/todo` | GET | developer+ (SESSION_READ) |

> user角色通过 `/dashboard/task-builder` 查看任务详情（含执行状态），不需要直接访问sessions模块。sessions是developer+用于调试和会话管理的底层工具。

### 4.3 规则R3: 无认证API路由权限对齐

以下API路由当前**完全无认证**，需对齐对应dashboard页面的权限要求：

| API路由 | 对应dashboard页面 | 页面权限要求 | API应设权限 |
|---------|----------------|------------|------------|
| `/api/claude/*` (6个) | `/dashboard/claude` | developer | `authenticateRequestEnhanced` + `AGENT_CHAT` |
| `/api/evaluations/[id]/report` | `/dashboard/evaluation` | developer | `authenticateRequestEnhanced` + `EVALUATION_READ` |
| `/api/v1/vulnerabilities` POST | 无对应页面 | — | `authenticateRequestEnhanced` + `VULNERABILITY_CREATE` (admin级) |
| `/api/v1/tasks/*` (5个) | `/dashboard/task-builder` | user（但R5要求developer+） | 见R5 |
| `/api/techstack-options` GET | `/dashboard/tech-stack` | developer | `authenticateRequest` + 无requiredPermission（参考数据） |
| `/api/docs/agent-harness` GET | 无对应页面 | — | 保持无认证（纯文档） |
| `/api/global/health` GET | 无对应页面 | — | 保持无认证（健康检查） |
| `/api/broadcast` GET | 无对应页面 | — | 保持无认证（设计意图） |

#### CodeSwarm API路由清单（暂不输出整改方案）

以下 `/api/codeswarm/*` 路由当前完全无认证，对应 `/dashboard/codeswarm` 的权限要求为 admin。但需区分"前端发起的请求"和"Worker回调"。前端发起的路径要求 admin 权限才能使用。

| 路径 | 方法 | 功能 | 请求发起方 | 整改权限要求 |
|------|------|------|-----------|-------------|
| `/api/codeswarm/tasks` | GET | 获取任务列表 | 前端(page.tsx, useApiFetch) | admin + SESSION_READ |
| `/api/codeswarm/tasks` | POST | 创建任务 | 前端(TaskDebugPanel, plain fetch) | admin + CONFIG_UPDATE |
| `/api/codeswarm/tasks` | DELETE | 批量删除任务 | 前端(TaskResultViewer, plain fetch) | admin + CONFIG_UPDATE |
| `/api/codeswarm/tasks/[taskId]` | GET | 获取单个任务详情 | 前端(TaskResultViewer, WorkerLogsPage) | admin + SESSION_READ |
| `/api/codeswarm/tasks/[taskId]` | DELETE | 删除单个任务 | 前端(TaskResultViewer) | admin + CONFIG_UPDATE |
| `/api/codeswarm/tasks/[taskId]/stream` | GET(SSE) | 任务日志实时流 | 前端(TaskDebugPanel, EventSource) | admin + SESSION_READ |
| `/api/codeswarm/tasks/[taskId]/logs` | GET | 获取分页日志 | 前端(WorkerLogsPage) | admin + SESSION_READ |
| `/api/codeswarm/tasks/[taskId]/dispatch` | POST | 手动分发任务到Worker | **纯后端调度** | **仅platform_admin**(R9) |
| `/api/codeswarm/nodes` | GET | 获取Worker节点列表 | 前端(page.tsx, useApiFetch) | admin + CONFIG_READ |
| `/api/codeswarm/nodes` | GET | 获取节点(调试面板) | 前端(TaskDebugPanel) | admin + CONFIG_READ |
| `/api/codeswarm/nodes/[nodeId]` | DELETE | 删除Worker节点 | 前端(WorkerNodesTable) | admin + CONFIG_UPDATE |
| `/api/codeswarm/nodes/[nodeId]` | PATCH | 更新节点配置 | 前端(WorkerNodesTable) | admin + CONFIG_UPDATE |
| `/api/codeswarm/browse-dirs` | GET | 浏览服务器目录 | 前端(LocalTestPanel, SessionExtractPanel) | admin + CONFIG_READ |
| `/api/codeswarm/local-test` | GET | 获取本地测试记录 | 前端(LocalTestPanel) | admin + CONFIG_READ |
| `/api/codeswarm/local-test` | POST | 提交本地测试任务 | 前端(LocalTestPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/local-test/files` | GET | 获取测试报告文件列表 | 前端(LocalTestPanel) | admin + CONFIG_READ |
| `/api/codeswarm/codedmap/cache` | GET | 获取CodeMap缓存列表 | 前端(CodedmapDebugPanel) | admin + CONFIG_READ |
| `/api/codeswarm/codedmap/cache` | DELETE | 删除产品缓存 | 前端(CodedmapDebugPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/codedmap/build` | POST | 执行CodeMap构建(SSE) | 前端(CodedmapDebugPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/reparse` | GET | 获取可重解析任务列表 | 前端(VulnReparsePanel) | admin + CONFIG_READ |
| `/api/codeswarm/reparse` | POST | 触发漏洞重解析 | 前端(VulnReparsePanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/session-extract` | POST | 执行会话抽取 | 前端(SessionExtractPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/session-extract/history` | GET | 获取会话抽取历史 | 前端(SessionExtractPanel) | admin + CONFIG_READ |
| `/api/codeswarm/session-extract/history` | DELETE | 清除所有历史记录 | 前端(SessionExtractPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/session-extract/history/[id]` | GET | 获取单条历史详情 | 前端(SessionExtractPanel) | admin + CONFIG_READ |
| `/api/codeswarm/session-extract/history/[id]` | DELETE | 删除单条历史记录 | 前端(SessionExtractPanel) | admin + CONFIG_UPDATE |
| `/api/codeswarm/worker/heartbeat` | POST | Worker心跳上报 | Worker进程 | **保留verifyWorkerToken** |
| `/api/codeswarm/worker/result` | POST | Worker结果回调 | Worker进程 | **保留verifyWorkerToken**(⚠️当前无认证需补) |
| `/api/codeswarm/worker/event` | POST | Worker事件回调 | Worker进程 | **保留verifyWorkerToken**(⚠️当前无认证需补) |

**CodeSwarm整改前置问题**:
1. 方案B下浏览器自动携带HttpOnly cookie，SSE（EventSource）天然认证，**此问题已解决**
2. 方案B下plain fetch也自动携带cookie，**无需改用useApiFetch或手动添加header**
3. 部分API（如browse-dirs、local-test）涉及文件系统操作，安全性需额外评估
4. Worker回调（heartbeat/result/event）保留 `verifyWorkerToken`，不做用户认证（但result/event当前未使用verifyWorkerToken，需补上）
5. 需逐一为API路由加 `authenticateRequestEnhanced`（与其他模块整改方式一致）
6. `/api/codeswarm/tasks/[taskId]/dispatch` 为纯后端调度接口，仅platform_admin可使用(R9)

#### Worker回调例外

| 路由 | 处理方式 |
|------|---------|
| `/api/codeswarm/worker/heartbeat` | 保留 `verifyWorkerToken`，不做用户认证 |
| `/api/codeswarm/worker/result` | 保留 `verifyWorkerToken`，不做用户认证 |
| `/api/codeswarm/worker/event` | 保留 `verifyWorkerToken`，不做用户认证 |

### 4.4 规则R4: 子路由继承（已在3.1映射表中体现）

所有子路由页面和子路由API继承父路由的角色要求。

### 4.5 规则R5: 动态URL — developer最低 + 租户认证

| 路由模式 | 最低角色 | 租户隔离 | 说明 |
|---------|---------|---------|------|
| `/api/v1/tasks` GET/POST | developer | 同租户 | 外部API创建/查询任务，需developer+ |
| `/api/v1/tasks/[taskId]/status` GET | developer | 同租户 | 查询任务状态，仅同租户可查 |
| `/api/v1/tasks/[taskId]/result` GET | developer | 同租户 | 查询任务结果，仅同租户可查 |
| `/api/v1/tasks/[taskId]/report` GET | developer | 同租户 | 查询任务报告，仅同租户可查 |
| `/api/v1/tasks/[taskId]/stop` POST | developer | 同租户 | 停止任务，仅同租户可操作 |
| `/api/v1/vulnerabilities` POST | admin | 同租户 | 创建漏洞，需admin级 |
| `/api/v1/agents` GET | developer | 同租户 | 查询agent列表 |

**租户隔离实现**: 使用 `authenticateRequestEnhanced` 获取 `tenantFilter`，查询数据库时附加 `withTenantFilter()` 条件，确保仅返回同一租户的数据。

### 4.6 规则R6: 同URL混合权限 — requirePermission对象级控制

以下API路由在同路径上混合读/写操作，需按HTTP方法分别设置 `requiredPermission`：

#### task-builder模块（user可操作，R1例外模块）

| 路由 | GET → | POST/DELETE → |
|------|-------|---------------|
| `/api/task-builder/tasks` | SESSION_READ（当前用SESSION_CREATE，应改为SESSION_READ） | SESSION_CREATE |
| `/api/task-builder/tasks/[id]` | SESSION_READ | SESSION_DELETE |
| `/api/task-builder/tasks/[id]/execute` | — | SESSION_CREATE |
| `/api/task-builder/tasks/[id]/stop` | — | SESSION_UPDATE |
| `/api/task-builder/tasks/[id]/logs` | SESSION_READ | — |
| `/api/task-builder/tasks/[id]/logs/stream` | SESSION_READ | — |
| `/api/task-builder/tasks/[id]/download-report` | VULNERABILITY_READ | — |
| `/api/task-builder/tasks/[id]/report-files` | VULNERABILITY_READ | — |
| `/api/task-builder/tasks/[id]/result` | SESSION_READ | — |
| `/api/task-builder/stats` | SESSION_READ | — |
| `/api/task-builder/available-resources` | SESSION_CREATE | — |
| `/api/task-builder/nfs-status` | (无requiredPermission) | — |
| `/api/task-builder/scripts` | — | SESSION_CREATE |

> **task-builder对象级权限**: API层已有userId+tenantId双重检查，非管理员仅可操作自己创建的同一租户下的任务。

#### skills模块（developer+admin可访问）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/skills` | SKILL_READ | SKILL_CREATE |
| `/api/skills/[id]` | SKILL_READ | SKILL_UPDATE / SKILL_DELETE |
| `/api/skills/[id]/analyze` | — | SKILL_EXECUTE |
| `/api/skills/[id]/cases` | SKILL_READ | — |
| `/api/skills/[id]/evolve` | — | SKILL_EXECUTE |
| `/api/skills/[id]/metrics` | SKILL_READ | — |
| `/api/skills/[id]/replace` | — | SKILL_UPDATE |
| `/api/skills/[id]/rollback` | — | SKILL_UPDATE |
| `/api/skills/[id]/test` | — | SKILL_EXECUTE |
| `/api/skills/[id]/versions` | SKILL_READ | — |
| `/api/skills/[id]/vulnerabilities` | SKILL_READ | — |
| `/api/skills/analyze-duplication` | — | SKILL_READ |
| `/api/skills/categories` | SKILL_READ | — |
| `/api/skills/evaluation-data` | SKILL_READ | — |
| `/api/skills/export` | SKILL_READ | — |
| `/api/skills/generate` | — | SKILL_CREATE |
| `/api/skills/import` | — | SKILL_CREATE |
| `/api/skills/match` | — | SKILL_READ |
| `/api/skills/merge` | SKILL_READ | SKILL_MERGE |
| `/api/skills/optimize-skill` | — | SKILL_UPDATE |
| `/api/skills/predict` | SKILL_READ | SKILL_EXECUTE |
| `/api/skills/predict-tasks` | SKILL_READ | SKILL_EXECUTE |
| `/api/skills/product-tags` | SKILL_READ | — |
| `/api/skills/sync` | — | SKILL_UPDATE |
| `/api/skills/test-runs` | SKILL_READ | SKILL_EXECUTE |
| `/api/skills/upload` | — | SKILL_CREATE |
| `/api/skills/vulnerability-tree` | SKILL_READ | — |

#### models模块（admin可访问，R1已限制非GET）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/models` | MODEL_READ | MODEL_CREATE |
| `/api/models/[id]` | MODEL_READ | MODEL_UPDATE / MODEL_DELETE |
| `/api/models/[id]/duplicate` | — | MODEL_CREATE |
| `/api/models/[id]/reset-context-window` | — | MODEL_UPDATE |
| `/api/models/[id]/test` | — | MODEL_TEST |

#### mcp-servers模块（developer+admin）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/mcp-servers` | MCP_READ | MCP_CREATE |
| `/api/mcp-servers/[id]` | MCP_READ | MCP_UPDATE / MCP_DELETE |
| `/api/mcp-servers/test` | — | MCP_CONNECT |

#### agent-apps模块（developer+admin）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/agent-apps` | AGENT_TEAM_READ | AGENT_TEAM_CREATE |
| `/api/agent-apps/[id]` | AGENT_TEAM_READ | AGENT_TEAM_UPDATE / AGENT_TEAM_DELETE |
| `/api/agent-apps/[id]/branches` | AGENT_TEAM_READ | — |
| `/api/agent-apps/[id]/pipeline` | AGENT_TEAM_READ | — |
| `/api/agent-apps/sync` | — | AGENT_TEAM_UPDATE |

#### agentflow-pipelines模块（developer+admin）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/agentflow-pipelines` | WORKFLOW_READ | WORKFLOW_CREATE |
| `/api/agentflow-pipelines/[id]` | WORKFLOW_READ | WORKFLOW_UPDATE / WORKFLOW_DELETE |
| `/api/agentflow-pipelines/[id]/publish` | — | WORKFLOW_SHARE |

#### api-keys模块（R8: 仅平台管理员）

| 路由 | GET → | POST/DELETE → |
|------|-------|---------------|
| `/api/api-keys` | MODEL_READ（或新增API_KEY_READ） | MODEL_CREATE（仅平台管理员） |
| `/api/api-keys/[id]` | — | MODEL_DELETE（仅平台管理员或所有者） |

#### knowledge-graph模块（developer+admin）

| 路由 | GET → | POST/PATCH → |
|------|-------|---------------|
| `/api/knowledge-graph` | CODE_READ | — |
| `/api/knowledge-graph/[product]` | CODE_READ | — |
| `/api/knowledge-graph/[product]/sync` | — | CODE_ANALYZE |
| `/api/knowledge-graph/[product]/decompile` | — | CODE_ANALYZE |
| `/api/knowledge-graph/[product]/tag` | — | CODE_READ (写操作但属代码标记) |

#### vulnerabilities模块（developer+admin可读，admin可写）

| 路由 | GET → | POST/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/vulnerabilities` | VULNERABILITY_READ | VULNERABILITY_CREATE |
| `/api/vulnerabilities/stats` | VULNERABILITY_READ | — |
| `/api/vulnerabilities/[id]` | VULNERABILITY_READ | VULNERABILITY_UPDATE / VULNERABILITY_DELETE |
| `/api/vulnerabilities/[id]/confirm` | — | VULNERABILITY_UPDATE |
| `/api/vulnerabilities/[id]/false-positive` | — | VULNERABILITY_UPDATE |
| `/api/vulnerabilities/[id]/fix` | — | VULNERABILITY_UPDATE |
| `/api/vulnerabilities/[id]/verify` | — | VULNERABILITY_UPDATE |
| `/api/vulnerabilities/[id]/download-raw-report` | VULNERABILITY_READ | — |

#### autonomous-evolution模块（admin）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/autonomous-evolution` | AUTONOMOUS_EVOLUTION_READ | — |
| `/api/autonomous-evolution/batch-inject` | — | AUTONOMOUS_EVOLUTION_INJECT |
| `/api/autonomous-evolution/extract` | — | AUTONOMOUS_EVOLUTION_EXTRACT |
| `/api/autonomous-evolution/[id]` | AUTONOMOUS_EVOLUTION_READ | AUTONOMOUS_EVOLUTION_UPDATE / AUTONOMOUS_EVOLUTION_DELETE |
| `/api/autonomous-evolution/[id]/inject` | — | AUTONOMOUS_EVOLUTION_INJECT |
| `/api/autonomous-evolution/[id]/usage` | AUTONOMOUS_EVOLUTION_READ | — |
| `/api/autonomous-evolution/idle-config` | AUTONOMOUS_EVOLUTION_READ | AUTONOMOUS_EVOLUTION_UPDATE |
| `/api/autonomous-evolution/injection-config` | AUTONOMOUS_EVOLUTION_READ | AUTONOMOUS_EVOLUTION_UPDATE |
| `/api/autonomous-evolution/query` | — | AUTONOMOUS_EVOLUTION_READ |
| `/api/autonomous-evolution/run-logs` | AUTONOMOUS_EVOLUTION_READ | — |
| `/api/autonomous-evolution/stats` | AUTONOMOUS_EVOLUTION_READ | — |
| `/api/autonomous-evolution/system-prompt` | AUTONOMOUS_EVOLUTION_READ | — |

#### admin模块（admin）

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/admin/tenants` | USER_READ (R8: 仅平台管理员) | USER_CREATE (R8: 仅平台管理员) |
| `/api/admin/tenants/[id]` | USER_READ (R8) | USER_UPDATE / USER_DELETE (R8) |
| `/api/admin/tenants/[id]/users` | USER_READ (R8) | USER_ASSIGN_ROLE / USER_DELETE (R8) |
| `/api/admin/categories` | CONFIG_READ | CONFIG_UPDATE |
| `/api/admin/alerts` | CONFIG_READ | CONFIG_UPDATE |
| `/api/admin/broadcast` | CONFIG_READ | CONFIG_UPDATE |

#### 其他模块

| 路由 | GET → | POST/PUT/PATCH/DELETE → |
|------|-------|------------------------|
| `/api/config` | CONFIG_READ | CONFIG_UPDATE |
| `/api/config/[id]` | — | CONFIG_UPDATE / CONFIG_DELETE |
| `/api/evaluations/[id]/nodes` | EVALUATION_READ | EVALUATION_UPDATE |
| `/api/data-feedback/tasks` | CODE_READ | — |
| `/api/data-feedback/tasks/[id]` | CODE_READ | — |

### 4.7 规则R8: 租户管理模块 — 仅平台管理员

**平台管理员定义**: `user.roles.includes('admin') && !user.tenantId`

以下路由和页面**仅平台管理员**可访问/操作：

#### 前端页面

| URL路径 | 当前守卫 | 整改后 |
|---------|---------|--------|
| `/dashboard/admin/tenants` | 无守卫 | `isPlatformAdmin` Guard（admin + 无tenantId） |
| `/dashboard/admin/api-keys` | 无守卫 | `isPlatformAdmin` Guard |
| `/dashboard/admin/sdk` | 无守卫 | `isPlatformAdmin` Guard |

#### API路由

| 路由 | 当前状态 | 整改后 |
|------|---------|--------|
| `/api/admin/tenants` GET/POST | 仅认证无权限 | `isPlatformAdmin` + 对应权限 |
| `/api/admin/tenants/[id]` GET/PATCH/DELETE | 仅认证无权限 | `isPlatformAdmin` + 对应权限 |
| `/api/admin/tenants/[id]/users` GET/POST/DELETE | 仅认证无权限 | `isPlatformAdmin` + 对应权限 |
| `/api/api-keys` GET/POST | 仅认证无权限 | `isPlatformAdmin` + 对应权限 |
| `/api/api-keys/[id]` DELETE | 仅认证 + ownership检查 | `isPlatformAdmin` 或 ownership |

#### 前端导航

侧边栏中「租户管理」「API Key管理」「系统SDK」导航项的可见条件从 `user?.roles?.includes('admin')` 改为 `canAccessTenantManagement(user.roles, user.tenantId)`。

---

## 5. DEFAULT_ROLE_PERMISSIONS同步调整

当前 user 角色拥有 `PROJECT_CREATE/UPDATE/DELETE`、`MODEL_CREATE/UPDATE/DELETE`、`SESSION_*` 全套权限，但R1/R2使其在middleware层无法使用。需同步调整映射，消除权限声明与实际生效范围的矛盾。

### 5.1 整改后 DEFAULT_ROLE_PERMISSIONS

#### admin（不变，拥有全部权限）

所有 `PERMISSIONS` 值。

#### developer（不变）

| 权限模块 | 权限常量 |
|---------|---------|
| 会话(任务) | SESSION_CREATE, SESSION_READ, SESSION_UPDATE, SESSION_DELETE |
| 项目 | PROJECT_CREATE, PROJECT_READ, PROJECT_UPDATE, PROJECT_DELETE |
| 模型 | MODEL_CREATE, MODEL_READ, MODEL_UPDATE, MODEL_DELETE |
| Token | TOKEN_READ, TOKEN_DETAIL |
| 工作流 | WORKFLOW_CREATE, WORKFLOW_READ, WORKFLOW_UPDATE, WORKFLOW_DELETE, WORKFLOW_EXECUTE, WORKFLOW_SHARE |
| 技能 | SKILL_CREATE, SKILL_READ, SKILL_UPDATE, SKILL_DELETE, SKILL_EXECUTE |
| MCP | MCP_CREATE, MCP_READ, MCP_UPDATE, MCP_DELETE, MCP_CONNECT |
| 漏洞 | VULNERABILITY_READ |

#### user（**缩减**）

| 权限模块 | 权限常量 | 变化 |
|---------|---------|------|
| 会话(任务) | SESSION_CREATE, SESSION_READ, SESSION_UPDATE, SESSION_DELETE | **保留**（task-builder模块用） |
| 项目 | — | **移除全部**（user不再直接操作项目，通过task-builder间接使用） |
| 模型 | — | **移除全部**（models页面仅admin可见） |
| Token | TOKEN_READ | **保留**（dashboard概览用）；移除TOKEN_DETAIL |
| 漏洞 | VULNERABILITY_READ | **保留**（查看任务结果中的漏洞） |

> **user角色的写操作仅通过task-builder模块**: 创建任务(POST `/api/task-builder/tasks`)、启动执行(POST `/api/task-builder/tasks/[id]/execute`)、停止任务(POST `/api/task-builder/tasks/[id]/stop`)、删除任务(DELETE `/api/task-builder/tasks/[id]`)。这些路径在middleware的R1例外列表中。

---

## 6. 认证架构改造（方案B: HttpOnly Cookie）

### 6.1 当前认证机制（问题）

| 认证方式 | 位置 | 问题 |
|---------|------|------|
| `auth-token` cookie | 登录页面JS `document.cookie` 写入 | **非HttpOnly** → XSS可窃取JWT |
| `access_token` cookie | 登录API `Set-Cookie` 写入 | **HttpOnly** 但未被任何代码使用 |
| `refresh_token` cookie | 登录API `Set-Cookie` 写入 | HttpOnly，已正确使用 |
| localStorage `token` | 登录页面JS写入 | XSS可窃取；前端60+处手动 `Authorization: Bearer ${token}` |
| localStorage `user` | 登录页面JS写入 | 前端组件读取roles/permissions/tenantId |

**核心问题**:
1. 非HttpOnly `auth-token` cookie + localStorage token = XSS可窃取JWT
2. SSE（EventSource）无法携带 `Authorization` header → CodeSwarm实时日志无法加认证
3. 服务器已写入HttpOnly `access_token` cookie但未利用，导致两套重复存储

### 6.2 方案B: HttpOnly Cookie认证

**核心思路**: 移除localStorage token和非HttpOnly `auth-token` cookie，全面改用服务器端 `Set-Cookie` 写入的HttpOnly `access_token` cookie。浏览器自动携带cookie，所有HTTP请求（包括SSE、页面导航、fetch）天然带认证。

#### 6.2.1 改动清单

| 改动 | 文件 | 说明 |
|------|------|------|
| **移除** | `src/app/login/page.tsx` | 移除 `localStorage.setItem('token')`、`localStorage.setItem('user')`、`document.cookie = 'auth-token=...'` |
| **移除** | `src/app/dashboard/layout.tsx` | 移除 `localStorage.getItem('token')`/`localStorage.getItem('user')` 判断，改用AuthContext |
| **移除** | 全项目60+处API调用 | 移除手动 `Authorization: Bearer ${localStorage.getItem('token')}` header（浏览器自动携带cookie） |
| **移除** | `src/hooks/useAuth.ts` | 移除localStorage读取逻辑，改用AuthContext |
| **新增** | `src/app/api/auth/me/route.ts` | 从HttpOnly cookie读取JWT，返回用户信息（roles/permissions/tenantId等） |
| **新增** | `src/contexts/AuthContext.tsx` | 全局AuthContext，初始化时调用 `/api/auth/me` 获取用户信息，替代localStorage |
| **修改** | `src/middleware.ts` | 从 `auth-token` cookie → `access_token` HttpOnly cookie |
| **保留** | `src/app/api/auth/login/route.ts` | 已有 `Set-Cookie` 写入HttpOnly `access_token` + `refresh_token`，无需改动 |
| **保留** | `src/app/api/auth/logout/route.ts` | 已有清除cookie逻辑，无需改动 |
| **保留** | `src/app/api/auth/refresh/route.ts` | 已有刷新cookie逻辑，无需改动 |

#### 6.2.2 `/api/auth/me` 端点设计

```typescript
// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value;
  if (!token) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const payload = verifyToken(token);
  if (!payload) return NextResponse.json({ error: '无效令牌' }, { status: 401 });

  return NextResponse.json({
    user: {
      id: payload.userId,
      username: payload.username,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      tenantId: payload.tenantId,
      isIcsTenant: payload.isIcsTenant,
    },
  });
}
```

#### 6.2.3 AuthContext 设计

```typescript
// src/contexts/AuthContext.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface User { id: string; username: string; email: string; roles: string[];
  permissions: string[]; tenantId: string | null; isIcsTenant: boolean; }

const AuthContext = createContext<{ user: User | null; loading: boolean; refresh: () => void }>({
  user: null, loading: true, refresh: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/me'); // cookie自动携带
      if (res.ok) { const data = await res.json(); setUser(data.user); }
      else { setUser(null); }
    } catch { setUser(null); }
    setLoading(false);
  };

  useEffect(() => { fetchUser(); }, []);
  return <AuthContext.Provider value={{ user, loading, refresh: fetchUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
```

#### 6.2.4 前端调用改造示例

**当前（需移除）**:
```typescript
const token = localStorage.getItem('token');
const response = await fetch('/api/task-builder/tasks', {
  headers: { Authorization: `Bearer ${token}` },
});
```

**改后（cookie自动携带）**:
```typescript
const response = await fetch('/api/task-builder/tasks'); // 浏览器自动带access_token cookie
```

**SSE改造（当前无法认证 → 改后自动认证）**:
```typescript
// 当前: const es = new EventSource(`/api/codeswarm/tasks/${taskId}/stream`); // 无法带header
// 改后: 同样的代码，浏览器自动携带cookie → SSE认证问题解决
```

#### 6.2.5 用户信息获取改造

**当前（60+处引用localStorage.user）**:
```typescript
const user = JSON.parse(localStorage.getItem('user') || '{}');
const isAdmin = user?.roles?.includes('admin');
```

**改后（AuthContext）**:
```typescript
const { user } = useAuth();
const isAdmin = user?.roles?.includes('admin');
```

### 6.3 方案B优势

| 优势 | 说明 |
|------|------|
| **XSS安全** | HttpOnly cookie JS不可读，XSS无法窃取JWT |
| **SSE天然认证** | EventSource自动携带cookie，CodeSwarm SSE问题解决 |
| **代码简化** | 移除60+处手动Authorization header，浏览器自动携带 |
| **统一存储** | 单一HttpOnly cookie，不再localStorage+cookie双存储 |
| **页面导航认证** | `<Link>` 点击触发浏览器请求自动带cookie，无需手动注入header |

### 6.4 middleware无法从localStorage读取的原因

Next.js middleware运行在**Edge Runtime**（服务器端），在浏览器渲染页面之前执行。localStorage存在于浏览器内存中，HTTP请求不携带localStorage数据。middleware的请求上下文（`NextRequest`）只能访问：
- `request.cookies` — HTTP cookie
- `request.headers` — HTTP请求头
- URL参数

**页面导航无法携带Authorization header**: 当用户点击 `<Link href="/dashboard/skills">` 时，浏览器发起普通HTTP GET请求，前端JS无法注入自定义header。**必须依赖cookie**。

**API调用可以携带Authorization header**: 前端 `fetch('/api/...', { headers: { Authorization: ... }})` 是JS发起的请求，可以手动添加。但方案B下不再需要手动添加，浏览器自动携带HttpOnly cookie。

### 6.5 登出流程

当前登录页JS写入3处：`localStorage.removeItem('token')`、`localStorage.removeItem('user')`、`document.cookie = 'auth-token=; max-age=0'`。

方案B下简化为：
- `POST /api/auth/logout` 已清除HttpOnly cookie（无需前端操作）
- 前端仅调用 `AuthContext.refresh()` 触发 `/api/auth/me` 返回401 → AuthContext设置user=null → 自动跳转/login
- 移除 `localStorage.removeItem` 和 `document.cookie` 操作

### 6.6 COOKIE_CONFIG 调整

当前 `src/lib/auth.ts` 中 `COOKIE_CONFIG.ACCESS_TOKEN.name = 'access_token'`，`SameSite=Strict`。

方案B下需确认：
- `SameSite=Strict` 足够（所有请求同源）
- `Secure` flag 在生产环境正确设置（当前代码已根据 `NODE_ENV` 判断）
- cookie `Path=/` 确保所有路径都携带

---

## 7. 整改范围汇总

### 7.1 涉及文件

| 类别 | 文件 | 改动内容 |
|------|------|---------|
| **新建** | `src/lib/route-permissions.ts` | 路径→角色映射表 + canAccessRoute/canAccessTenantManagement |
| **新建** | `src/middleware.ts`（重写） | Dashboard角色拦截 + API非GET拦截 + 租户管理特殊拦截；读取HttpOnly `access_token` cookie |
| **新建** | `src/app/api/auth/me/route.ts` | 从HttpOnly cookie读取JWT返回用户信息 |
| **新建** | `src/contexts/AuthContext.tsx` | 全局AuthContext替代localStorage.user |
| **修改** | `src/app/login/page.tsx` | 移除localStorage写入和auth-token cookie写入，仅保留路由跳转 |
| **修改** | `src/app/dashboard/layout.tsx` | 改用AuthContext + canAccessRoute + canAccessTenantManagement + 移除「我的模型」入口 |
| **修改** | `src/hooks/useAuth.ts` | 改为从AuthContext获取用户信息，移除localStorage读取 |
| **修改** | `src/types/permissions.ts` | DEFAULT_ROLE_PERMISSIONS中user角色缩减权限 |
| **修改** | `src/components/PermissionGuard.tsx` | 改用AuthContext，增加isPlatformAdmin Guard |
| **修改** | 全项目60+处API调用 | 移除手动 `Authorization: Bearer ${localStorage.getItem('token')}` header |
| **修改** | ~60个 API route.ts | 补 authenticateRequest + requiredPermission 或 isPlatformAdmin |
| **修改** | ~49个 dashboard page.tsx | 补 PermissionGuard / AdminGuard / DeveloperGuard，改用AuthContext |
| **不改动** | `src/app/api/auth/login/route.ts` | 已有Set-Cookie写入HttpOnly cookie |
| **不改动** | `src/app/api/auth/logout/route.ts` | 已有清除cookie逻辑 |
| **不改动** | `src/app/api/auth/refresh/route.ts` | 已有刷新cookie逻辑 |
| **不改动** | 权限常量(PERMISSIONS) | 不新增常量 |
| **不改动** | CodeSwarm API路由 | 暂不整改（待确认前端依赖后补充方案） |

### 7.2 数量统计

| 整改项 | 数量 |
|--------|------|
| 认证架构改造（方案B） | 新增2文件 + 修改登录页/布局/useAuth/PermissionGuard + 移除60+处手动header |
| 无认证API需补认证（不含codeswarm） | 6（claude） + 1（evaluations/report） + 1（v1/vulnerabilities） + 5（v1/tasks） = **13** |
| 仅认证无权限API需补requiredPermission | **~60** |
| 前端页面需补Guard | **49** |
| 侧边栏需改造条件 | **4处**（开发者视图 + 数据与进化 + 管理员视图 + 用户菜单） |
| DEFAULT_ROLE_PERMISSIONS调整 | **1处**（user角色缩减） |
| middleware需重写 | **1** |
| 需新建文件 | **4**（route-permissions.ts + middleware.ts + auth/me + AuthContext） |
| CodeSwarm API（暂不整改） | **17个无认证 + 6个有认证无权限** = 23（待后续方案） |

---

## 8. 风险评估

### 8.1 高风险项

| 风险 | 等级 | 影响范围 | 缓解措施 |
|------|------|---------|---------|
| **CodeSwarm 17个无认证路由** | **CRITICAL** | 当前任何人可无token访问worker token、apiKey、任意目录浏览 | 暂不整改，需先确认前端依赖后制定方案；**建议立即在nginx/防火墙层面限制 `/api/codeswarm/*` 仅内网访问** |
| **R1影响user的project/model写操作** | **HIGH** | user角色无法创建/修改/删除项目和模型 | 已确认：user通过task-builder模块操作任务，不直接操作project/model。DEFAULT_ROLE_PERMISSIONS将同步移除这些权限 |
| **R2将sessions提升到developer** | **MEDIUM** | user角色无法查看sessions详情，但可通过task-builder查看任务状态 | user通过task-builder查看任务执行结果，sessions是developer调试工具 |
| **R8: 租户内admin被排除** | **MEDIUM** | 租户内admin角色无法管理租户（设计意图） | 文档明确「平台管理员」与「租户内管理员」的区别 |
| **CodeSwarm SSE无法携带Authorization** | **已解决** | 方案B下浏览器自动携带HttpOnly cookie，SSE天然认证，无需改用fetch+ReadableStream |

### 8.2 中风险项

| 风险 | 等级 | 影响范围 | 缓解措施 |
|------|------|---------|---------|
| **middleware用atob解析JWT** | **MEDIUM** | 不验证签名，理论上可伪造 | 仅做路由拦截（第一层），API层做完整JWT验证（第二层） |
| **verifyToken旧模式23个路由** | **MEDIUM** | 缺乏多租户隔离 | 逐批迁移到authenticateRequestEnhanced |
| **CodeSwarm前端大量plain fetch** | **已解决** | 方案B下浏览器自动携带cookie，plain fetch无需手动加header；但需移除所有手动Authorization header |
| **DEFAULT_ROLE_PERMISSIONS变更需seed同步** | **MEDIUM** | 修改映射后需执行 `npm run db:seed` 或调用 `/api/admin/sync-permissions` | 执行seed/sync-permissions确保数据库角色权限同步 |
| **task-builder部分路由认证不一致** | **LOW-MEDIUM** | result/available-resources/nfs-status用旧版authenticateRequest，缺tenant隔离 | 逐步迁移到authenticateRequestEnhanced |

### 8.3 低风险项

| 风险 | 等级 | 影响范围 | 缓解措施 |
|------|------|---------|---------|
| **techstack-options加认证** | **LOW** | 公开参考数据 | 可保留无认证GET |
| **docs/agent-harness** | **LOW** | 纯文档 | 保持无认证 |
| **expected-output-templates GET用CONFIG_UPDATE** | **LOW** | 写权限做读检查 | 改GET为CONFIG_READ |

### 8.4 风险矩阵

```
影响范围 × 严重度

                低严重度    中严重度    高严重度    严重度
单模块           ─          expected    ─           ─
多模块           techstack  verifyToken ─           ─
全局安全         ─          seed同步    R1/R2影响   codeswarm无认证
数据完整性       ─          AuthContext 租户内admin  v1/vulnerabilities无认证
认证架构         ─          token刷新   ─           ─(方案B已解决XSS+SSE)
```

---

## 9. 实施阶段

| 阶段 | 时间 | 任务 | 验证方式 |
|------|------|------|---------|
| **Phase 0** | 1-2天 | 认证架构改造（方案B）: 新增 `/api/auth/me` + AuthContext + 移除localStorage/auth-token cookie + 移除60+处手动Authorization header + middleware改读 `access_token` cookie | 登录后AuthContext正确获取用户信息；登出后cookie清除自动跳转/login；所有API调用无手动header仍正常工作 |
| **Phase 1** | 1天 | 创建route-permissions.ts + 改造侧边栏 + DEFAULT_ROLE_PERMISSIONS调整 + seed同步 | 不同角色登录验证导航可见性 + URL直接访问被拦截 |
| **Phase 2** | 2天 | P0级API: claude(加认证) + v1/vulnerabilities + evaluations/report + v1/tasks(加认证+租户隔离) | 无认证请求返回401；低权限角色返回403 |
| **Phase 3** | 3天 | P1级API: skills/mcp-servers/agent-apps/agentflow-pipelines 补requiredPermission | developer调用成功，user调用非GET返回403（task-builder例外） |
| **Phase 4** | 2天 | P2级API: sessions/autonomous-evolution/admin/tenants + R8租户管理加固(api-keys/sdk) | 平台管理员正常，租户内admin返回403 |
| **Phase 5** | 2天 | 前端页面补Guard: 49个page.tsx补PermissionGuard/AdminGuard/DeveloperGuard（改用AuthContext） | 直接URL访问受保护页面显示AccessDenied |
| **Phase 6** | 2天 | verifyToken旧模式迁移 + expected-output-templates修正 + task-builder认证统一 + 全量回归 | 全角色回归测试通过 |
| **Phase 7** | 待定 | CodeSwarm认证整改（方案B下SSE已解决，仅需API层加authenticateRequest + 前端移除剩余手动header） | — |

---

## 10. 验收标准

| 编号 | 验收条件 | 验证方法 |
|------|----------|----------|
| V1 | user角色URL直接访问developer页面被重定向到首页 | user访问 `/dashboard/skills`、`/dashboard/sessions`、`/dashboard/agent-apps` |
| V2 | user角色URL直接访问admin页面被重定向到首页 | user访问 `/dashboard/users`、`/dashboard/models`、`/dashboard/admin/*` |
| V3 | 租户内admin访问租户管理页面被重定向到首页 | 租户内admin访问 `/dashboard/admin/tenants` |
| V4 | user角色POST `/api/task-builder/tasks` 成功创建任务 | user创建任务、启动执行、下载报告 |
| V5 | user角色POST `/api/models` 返回403 | user尝试创建模型 |
| V6 | developer角色GET `/api/admin/models` 返回403 | developer访问admin接口 |
| V7 | 平台管理员正常访问租户管理API | 平台管理员 GET/POST `/api/admin/tenants` |
| V8 | 租户内admin GET `/api/admin/tenants` 返回403 | 租户内admin被拦截 |
| V9 | 无认证请求访问claude/evaluations/v1返回401 | 无token请求 |
| V10 | 侧边栏导航按角色层级正确显示 | user无「我的模型」入口；developer有Skill/MCP等；admin有全部 |
| V11 | 子路由继承父路由守卫 | user访问 `/dashboard/skills/[id]`、`/dashboard/admin/tools/create` 被拦截 |
| V12 | `/api/v1/tasks/[taskId]/status` 仅同租户developer+可访问 | 跨租户developer返回403/空 |
| V13 | `/api/users/password` POST 允许user修改自己密码 | user修改自己密码成功，修改他人密码返回403 |
| V14 | DEFAULT_ROLE_PERMISSIONS与实际生效范围一致 | `db:seed`后数据库中user角色不再有PROJECT/MODEL权限 |
| V15 | HttpOnly cookie认证工作正常 | 登录后浏览器携带 `access_token` cookie；localStorage无token；API调用无需手动header |
| V16 | 登出后cookie清除自动跳转 | 调用logout后 `/api/auth/me` 返回401 → AuthContext.user=null → 跳转/login |
| V17 | AuthContext替代localStorage.user | 所有组件通过 `useAuth()` 获取用户信息，localStorage不再存储token/user |
| V18 | 租户内admin无法访问纯后端调度接口 | 租户内admin POST `/api/agent/execute` 返回403 |
| V19 | platform_admin可以访问纯后端调度接口 | platform_admin POST `/api/agent/execute` 成功 |
| V20 | user查看token统计仅见本租户数据 | user GET `/api/token-stats` 返回数据仅限本租户内用户 |
| V21 | 租户内admin查看token统计仅见本租户数据 | 租户内admin GET `/api/token-stats` 返回本租户全数据，不含其他租户 |
| V22 | platform_admin查看token统计见全系统数据 | platform_admin GET `/api/token-stats` 返回跨租户全数据 |
| V23 | 公共skill/model跨租户可见 | 租户A用户GET `/api/skills?isPublic=true` 可见租户B的公共skill |

---

## 11. middleware.ts 实现参考

```typescript
import { NextRequest, NextResponse } from 'next/server';

const ROLE_HIERARCHY = ['admin', 'developer', 'user'];

const DASHBOARD_ROLE_MAP: Record<string, string> = {
  '/dashboard/sessions': 'developer',
  '/dashboard/skills': 'developer',
  '/dashboard/mcp-servers': 'developer',
  '/dashboard/agent-apps': 'developer',
  '/dashboard/agentflow-pipelines': 'developer',
  '/dashboard/evolution': 'developer',
  '/dashboard/knowledge-graph': 'developer',
  '/dashboard/data-feedback': 'developer',
  '/dashboard/evaluation': 'developer',
  '/dashboard/claude': 'developer',
  '/dashboard/tech-stack': 'developer',
  '/dashboard/users': 'admin',
  '/dashboard/roles': 'admin',
  '/dashboard/models': 'admin',
  '/dashboard/admin': 'admin',
  '/dashboard/codeswarm': 'admin',
  '/dashboard/config': 'admin',
  '/dashboard/plugins': 'admin',
};

const PLATFORM_ADMIN_ONLY_PATHS = [
  '/dashboard/admin/tenants',
  '/dashboard/admin/api-keys',
  '/dashboard/admin/sdk',
];

// R9: 纯后端调度接口（仅platform_admin可访问）
const BACKEND_DISPATCH_API_PATHS = [
  '/api/codeswarm/tasks/',      // dispatch子路径
  '/api/agent/execute',
  '/api/agent/chat',
  '/api/agent/executions/',
  '/api/admin/sync-permissions',
  '/api/admin/cache/',
];

const R1_NON_GET_EXCEPTIONS = [
  '/api/task-builder/tasks',
  '/api/task-builder/tasks/',
  '/api/users/password',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/register',
];

function findRequiredRole(pathname: string, map: Record<string, string>): string | undefined {
  if (map[pathname]) return map[pathname];
  const matched = Object.keys(map)
    .filter(key => pathname.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return matched ? map[matched] : undefined;
}

function isR1Exception(pathname: string): boolean {
  // 精确匹配和前缀匹配
  if (R1_NON_GET_EXCEPTIONS.some(p => pathname === p || pathname.startsWith(p))) {
    // task-builder子路径的DELETE也需要确认是同一个task-builder路径
    if (pathname.startsWith('/api/task-builder/tasks/')) {
      // 仅允许 execute, stop, DELETE(删除任务) 等子操作
      const subPath = pathname.replace('/api/task-builder/tasks/', '');
      const allowedSuffixes = ['execute', 'stop', 'logs', 'logs/stream', 'download-report', 'report-files', 'result'];
      // 如果是动态ID路径如 /api/task-builder/tasks/abc123，则允许DELETE和GET
      // 如果是 /api/task-builder/tasks/abc123/execute，则允许POST
      return true; // task-builder所有子路径都是R1例外
    }
    return true;
  }
  return false;
}

function extractToken(request: NextRequest): string | null {
  // 方案B: 仅读取HttpOnly access_token cookie
  // 浏览器对所有同源请求自动携带，无需Authorization header
  return request.cookies.get('access_token')?.value || null;
}

function parseJWTPayload(token: string): { roles: string[]; tenantId: string | null } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      roles: payload.roles || [],
      tenantId: payload.tenantId || null,
    };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Dashboard路径拦截 ───
  if (pathname.startsWith('/dashboard')) {
    const token = extractToken(request);
    if (!token) return NextResponse.redirect(new URL('/login', request.url));

    const payload = parseJWTPayload(token);
    if (!payload) return NextResponse.redirect(new URL('/login', request.url));

    // R8: 租户管理仅平台管理员
    if (PLATFORM_ADMIN_ONLY_PATHS.some(p => pathname.startsWith(p))) {
      if (!payload.roles.includes('admin') || payload.tenantId) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // R4: 子路由继承父路由角色
    const requiredRole = findRequiredRole(pathname, DASHBOARD_ROLE_MAP);
    if (requiredRole) {
      const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
      const hasAccess = payload.roles.some(r => ROLE_HIERARCHY.indexOf(r) <= requiredLevel);
      if (!hasAccess) return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return NextResponse.next();
  }

  // ─── API路径拦截 ───
  if (pathname.startsWith('/api')) {
    // R9: 纯后端调度接口仅platform_admin
    if (BACKEND_DISPATCH_API_PATHS.some(p => pathname.startsWith(p))) {
      const token = extractToken(request);
      if (!token) return NextResponse.json({ error: '未授权' }, { status: 401 });
      const payload = parseJWTPayload(token);
      if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });
      if (!payload.roles.includes('admin') || payload.tenantId) {
        return NextResponse.json({ error: '纯后端调度接口仅平台管理员可访问' }, { status: 403 });
      }
      return NextResponse.next();
    }

    // R1: 非GET请求拦截
    if (request.method !== 'GET') {
      if (isR1Exception(pathname)) return NextResponse.next();
      // Worker回调例外
      if (pathname.startsWith('/api/codeswarm/worker/')) return NextResponse.next();

      const token = extractToken(request);
      if (!token) return NextResponse.json({ error: '未授权' }, { status: 401 });

      const payload = parseJWTPayload(token);
      if (!payload) return NextResponse.json({ error: '未授权' }, { status: 401 });

      // developer及以上角色（含admin、platform_admin）
      const hasAccess = payload.roles.some(r =>
        ['developer', 'admin'].includes(r)
      );
      if (!hasAccess) {
        return NextResponse.json(
          { error: '禁止访问: 非GET请求需要developer及以上角色' },
          { status: 403 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

---

## 12. 版本演进对比

| 项目 | V3 | V4.1 | V5 | **本方案(V6)** |
|------|-----|------|-----|-------------|
| 认证机制 | 未涉及 | localStorage+非HttpOnly cookie | HttpOnly cookie + AuthContext | 同V5 |
| 角色层级 | 3层(admin>dev>user) | 3层(admin>dev>user) | 3层(admin>dev>user) | **4层(platform_admin>admin>dev>user)** |
| admin特权范围 | 全部权限 | 全部权限 | 全部权限 | **不含纯后端调度接口(R9)** |
| 纯后端调度接口 | 未区分 | 未区分 | 未区分 | **仅platform_admin(R9)** |
| 非GET请求 | 无规则 | user仅GET | 同V4.1 | 同V4.1 |
| token统计 | 未提及 | 建议developer+ | 未明确 | **user可GET看本租户内数据** |
| 租户隔离影响 | 未评估 | 未评估 | 未评估 | **新增15节评估** |
| DEFAULT_ROLE_PERMISSIONS | 不改 | user缩减 | 同V4.1 | 同V4.1 |
| CodeSwarm | 全部补认证 | 清单(无功能列) | 同V4.1 | **清单含功能+权限列** |
| SSE认证 | 无法解决 | 已解决 | 同V5 | 同V5 |

---

## 13. 讨论与决策记录

### 13.1 已确认事项

| 编号 | 事项 | 决策结论 |
|--------|------|---------|
| D1 | R1: user角色写操作权限 | **user仅允许task-builder模块的写操作（创建/执行/停止/删除任务），其余写操作禁止** |
| D2 | R2: sessions模块角色 | **sessions仅developer+可见。user通过task-builder查看任务状态，无需直接访问sessions** |
| D3 | 前端「我的模型」链接 | **仅admin可见。非admin用户菜单移除该入口** |
| D4 | DEFAULT_ROLE_PERMISSIONS同步 | **同步调整：user移除PROJECT/MODEL全部权限，移除TOKEN_DETAIL** |
| D5 | CodeSwarm前端依赖 | **已输出完整清单（4.3节），暂不输出整改方案。方案B下SSE/plain fetch认证问题已解决** |
| D6 | 认证方案选择 | **采用方案B: HttpOnly `access_token` cookie + `/api/auth/me` + AuthContext** |
| D7 | 角色层级调整 | **四层: platform_admin > admin > developer > user。admin不含纯后端调度接口特权(R9)** |
| D8 | token统计user权限 | **user仅GET查看本租户内所有用户统计，非仅自己。API需改用authenticateRequestEnhanced + tenantFilter** |
| D9 | CodeSwarm API分类 | **前端发起路径需admin权限；纯后端调度(dispatch)仅platform_admin；Worker回调保留独立认证** |

### 13.2 方案选择过程

**方案A（保留localStorage+auth-token cookie）vs 方案B（HttpOnly cookie认证）**:

| 对比维度 | 方案A | 方案B |
|---------|-------|-------|
| 权限控制逻辑 | 一样 | 一样 |
| XSS安全 | 非HttpOnly cookie可被JS窃取 | **HttpOnly cookie JS不可读** |
| SSE认证 | **无法解决**（EventSource无法带header） | **天然解决**（浏览器自动携带cookie） |
| API调用代码 | 60+处手动Authorization header | **移除所有手动header** |
| 用户信息获取 | localStorage.user（直接读取） | `/api/auth/me` + AuthContext（需新增1个端点+1个Context） |
| 登出流程 | localStorage.removeItem + cookie清除 | **仅清除HttpOnly cookie（服务器端完成）** |
| middleware读取 | `auth-token`（非HttpOnly） | `access_token`（HttpOnly） |
| 额外工作量 | 无 | 约1-2天（AuthContext改造 + 移除手动header） |

**决策**: 选择方案B，理由:
1. 解决SSE认证问题（否则CodeSwarm整改无法推进）
2. HttpOnly防XSS窃取token
3. 移除60+处手动header减少代码量
4. 权限控制逻辑不受影响

### 13.3 补充确认的细节

**login/page.tsx 当前行为**:
- Line 47: `localStorage.setItem('token', data.token)` — 方案B下移除
- Line 48: `localStorage.setItem('user', JSON.stringify(data.user))` — 方案B下移除
- Line 49: `document.cookie = `auth-token=${data.token}; path=/; max-age=...`` — 方案B下移除
- 服务器端login API已有 `Set-Cookie` 写入HttpOnly `access_token` + `refresh_token` — 保持不变

**COOKIE_CONFIG（src/lib/auth.ts）**:
- `ACCESS_TOKEN.name = 'access_token'`，HttpOnly，SameSite=Strict，7天有效期
- `REFRESH_TOKEN.name = 'refresh_token'`，HttpOnly，SameSite=Strict，30天有效期
- 方案B下middleware读 `access_token` cookie

**task-builder API认证现状**:
- 大部分用 `authenticateRequestEnhanced` + `SESSION_CREATE`
- `download-report`/`report-files` 用 `VULNERABILITY_READ`
- `result`/`available-resources`/`nfs-status` 用旧版 `authenticateRequest`（缺tenant隔离）
- 已有userId+tenantId对象级权限检查（非管理员仅操作自己的任务）

---

## 14. 长期改进方向

1. **CodeSwarm认证整改**: 方案B下SSE/plain fetch认证已解决，仅需为 `/api/codeswarm/*` 路由逐一加 `authenticateRequestEnhanced` + 对应权限常量。

2. **manager/viewer角色**: 当前 `ROLES` 常量仅定义admin/developer/user三个角色。AGENTS.md文档提到5个角色（含manager/viewer），但代码中未实现。如需引入，需扩展 `DEFAULT_ROLE_PERMISSIONS`。

3. **RBAC动态权限**: 当前权限映射是静态的（代码级DEFAULT_ROLE_PERMISSIONS）。长期应改为数据库驱动的RBAC，支持自定义角色和权限组合。

4. **token刷新优化**: 当前 `/api/auth/refresh` 用HttpOnly `refresh_token` cookie换新 `access_token` cookie。方案B下AuthContext需监听401响应自动触发refresh，避免用户手动重新登录。

5. **Worker回调认证补全**: `/api/codeswarm/worker/result` 和 `/api/codeswarm/worker/event` 当前完全无认证。`verifyWorkerToken` 机制已存在于 `codeswarm-worker-auth.ts`，需在此两个路由中补上调用，防止伪造Worker结果。

---

## 15. 权限策略对租户隔离机制的影响

### 15.1 租户隔离现状

当前系统中 **大部分API路由缺乏租户隔离**：

| 认证模式 | 路由数 | 是否含tenantFilter | 说明 |
|---------|-------|-------------------|------|
| `authenticateRequestEnhanced` | ~40 | ✅ | 包含 `tenantFilter` / `withTenantFilter()`，正确隔离 |
| `authenticateRequest` (基础版) | ~30 | ❌ | 仅JWT验证+可选权限检查，无租户上下文 |
| `verifyToken` (旧模式) | ~23 | ❌ | 手动权限检查，无租户上下文 |
| 无认证 | ~25 | ❌ | 完全开放 |

### 15.2 V6权限策略对租户隔离的影响

#### 租户内资源共享（允许）

| 场景 | 机制 | 说明 |
|------|------|------|
| 同租户developer+查看skill列表 | `authenticateRequestEnhanced` + `SKILL_READ` + `withTenantFilter()` | 同租户的skill共享可见 |
| 同租户developer+共享workflow | `authenticateRequestEnhanced` + `WORKFLOW_SHARE` + `withTenantFilter()` | workflow可在租户内共享 |
| 同租户user查看token统计 | `authenticateRequestEnhanced` + `tenantFilter` | user可看本租户内所有用户的统计（而非仅自己） |
| 同租户developer+查看sessions | `authenticateRequestEnhanced` + `SESSION_READ` + `withTenantFilter()` | 同租户session共享可见 |
| 同租户用户协作同一project | `authenticateRequestEnhanced` + `PROJECT_READ` + `withTenantFilter()` | 租户内project共享 |
| 同租户用户查看漏洞统计 | `authenticateRequestEnhanced` + `VULNERABILITY_READ` + `withTenantFilter()` | 租户内漏洞共享 |

#### 非租户内资源屏蔽（禁止）

| 场景 | 机制 | 说明 |
|------|------|------|
| 租户内admin查看其他租户数据 | `authenticateRequestEnhanced` + `tenantFilter` | **被屏蔽**。admin != platform_admin，tenantFilter限制为本租户 |
| 租户内developer访问其他租户的skill | `authenticateRequestEnhanced` + `withTenantFilter()` | **被屏蔽**。skill查询自动附加tenantFilter |
| 租户内user查看其他租户的token统计 | `authenticateRequestEnhanced` + `tenantFilter` | **被屏蔽**。统计查询自动附加tenantFilter |
| 租户内admin访问租户管理模块 | middleware R8检查 `tenantId != null` | **被屏蔽**。重定向到/dashboard |
| 租户内admin访问纯后端调度接口 | middleware R9 + API层isPlatformAdmin | **被屏蔽**。返回403 |
| 跨租户任务查询 | `/api/v1/tasks` + `authenticateRequestEnhanced` + `withTenantFilter()` | **被屏蔽**。仅返回本租户的任务 |

#### platform_admin跨租户特权

| 场景 | 机制 | 说明 |
|------|------|------|
| platform_admin查看全系统token统计 | `authenticateRequestEnhanced` + `isPlatformAdmin` → 无tenantFilter | ✅ 可见全系统数据 |
| platform_admin管理租户 | middleware R8 + API层isPlatformAdmin | ✅ 可CRUD租户 |
| platform_admin调用纯后端调度接口 | middleware R9 + isPlatformAdmin | ✅ 可调度Worker |
| platform_admin查看任意租户漏洞 | isPlatformAdmin → 无tenantFilter | ✅ 可跨租户查看 |

### 15.3 需迁移到authenticateRequestEnhanced的路由

以下路由当前使用基础版 `authenticateRequest` 或 `verifyToken`，无租户隔离，整改后需迁移：

| 模块 | 当前模式 | 路由数 | 迁移影响 |
|------|---------|-------|---------|
| token-stats | `authenticateRequest` | 2 | **关键**: 当前无租户过滤，admin看全系统。迁移后租户内admin仅看本租户；platform_admin看全系统 |
| task-builder部分 | `authenticateRequest` | 3(result, available-resources, nfs-status) | 迁移后非管理员仅看本租户资源 |
| evaluations | `verifyToken` | 15 | 迁移后租户内评估数据隔离 |
| claude | 无认证→需补 | 6 | 补认证时直接用enhanced版本 |
| sessions | `authenticateRequest` | ~8 | 迁移后租户内session隔离 |
| agent | `verifyToken` | 4 | 迁移后执行记录租户隔离 |
| files | `verifyToken` | 3 | 迁移后文件访问租户隔离 |

### 15.4 租户隔离对现有业务流程的影响

| 业务流程 | 当前行为 | 整改后变化 | 影响评估 |
|---------|---------|-----------|---------|
| **租户内协作** | 同租户用户通过projectId间接共享 | 机制不变，仍通过project关联共享 | **无影响** |
| **租户内admin管理** | admin看全系统所有用户/数据 | 租户内admin仅看本租户用户/数据 | **有影响**: admin需要知道他只能管理本租户，不可跨租户 |
| **platform_admin运维** | admin看全系统 | 仅platform_admin看全系统 | **有影响**: 需确保有且仅有1个platform_admin账户可用 |
| **token统计查看** | admin看全系统，user看自己 | user看本租户内，租户内admin看本租户内，platform_admin看全系统 | **有影响**: 数据范围收窄，需UI提示 |
| **Skill共享** | 所有认证用户看所有skill | 同租户skill可见 | **有影响**: 需确认skill是否有跨租户共享需求（当前skill有isPublic标记，整改后isPublic skill需额外处理） |
| **漏洞数据** | admin看全系统 | 租户内admin看本租户漏洞 | **有影响**: 漏洞关联到task，task属于project，project属于租户，天然隔离 |
| **CodeSwarm调度** | 无认证任何人都可操作 | 仅admin+可操作前端路径，仅platform_admin可调度 | **重大影响**: 当前完全开放的调度接口将受限 |

### 15.5 跨租户共享需求的处理

| 场景 | 需求 | 处理方案 |
|------|------|---------|
| **Skill跨租户共享** | 租户A开发的skill供租户B使用 | `isPublic=true` 的skill在 `authenticateRequestEnhanced` 中需**豁免tenantFilter**（全局可见），仅 `isPublic=false` 的skill受限本租户 |
| **Model跨租户使用** | 平台提供的公共模型供所有租户使用 | `isPublic=true` / `isActive=true` 的model读取需**豁免tenantFilter**；创建/修改/删除仍限本租户 |
| **漏洞模式跨租户共享** | 平台定义的漏洞模式供所有租户使用 | vulnerability-patterns是平台级资源，读取可**豁免tenantFilter** |
| **技术栈选项** | 公共参考数据 | 保持无认证GET（不涉及租户隔离） |

> **关键设计决策**: `isPublic` 资源的读取是否豁免tenantFilter？建议 **是** —— 公共skill/model的GET查询不加tenantFilter，但创建/修改/删除仍限本租户。这需要在API层对 `authenticateRequestEnhanced` 返回的 `tenantFilter` 做条件性豁免。

### 15.6 tenantFilter豁免模式

```typescript
// 示例: Skill读取时，公共skill豁免tenantFilter
const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SKILL_READ });
if (!auth.success) return authErrorResponse(auth);

// 租户隔离 + 公共资源豁免
const skills = await prisma.skill.findMany({
  where: {
    ...auth.tenant.tenantFilter,  // 默认限本租户
    OR: [{ isPublic: true }],      // 但公共skill也可见
  },
});
```