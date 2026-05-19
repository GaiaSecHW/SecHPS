# 多租户系统使用与验收文档

**版本**: 1.0
**日期**: 2026-05-09
**状态**: 待验收

---

## 1. 设计概述

### 1.1 目标

SecHPS 平台支持多部门独立使用，确保各部门数据互相隔离，同时允许公共资源共享。系统实现三类角色：

- **平台管理员** — 系统级管理，无租户绑定，可访问所有数据
- **ICSL 租户** — 特权租户，拥有完整访问权限，可创建公共资源供其他租户使用
- **普通租户** — 只能访问本租户私有资源 + 所有公共资源

### 1.2 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                        平台管理员                         │
│              admin 角色，tenantId = null                   │
│              管理租户、用户、全局配置                       │
└────────────────────────┬─────────────────────────────────┘
                         │ 管理所有租户
            ┌────────────┼────────────────┐
            ▼                             ▼
┌──────────────────────┐      ┌──────────────────────┐
│     ICSL 租户        │      │    普通租户 (如 TeamA) │
│  isIcsTenant = true  │      │  isIcsTenant = false  │
│  可访问所有数据       │      │  仅本租户 + public     │
│  可创建 public 资源   │      │  不能创建 public 资源  │
└──────────┬───────────┘      └──────────┬────────────┘
           │                             │
     ┌─────┴─────┐               ┌──────┴──────┐
     │ 用户 A, B │               │  用户 C, D  │
     └───────────┘               └─────────────┘
```

### 1.3 数据隔离方式

采用**应用层过滤**（非数据库 RLS），通过 `tenantId` + `isPublic` 字段实现：

| 字段 | 值 | 含义 |
|------|------|------|
| `tenantId` | `"xxx"` | 属于指定租户 |
| `tenantId` | `null` | 公共资源，不属于任何租户 |
| `isPublic` | `true` | 所有用户可见 |
| `isPublic` | `false` | 仅同租户用户可见 |

**查询过滤规则：**

| 用户类型 | 查询条件 |
|---------|---------|
| 平台管理员 | 无过滤（可见所有） |
| ICSL 租户 | 无过滤（可见所有） |
| 无租户用户 | `isPublic = true` |
| 普通租户用户 | `tenantId = 自己的租户ID OR isPublic = true` |

### 1.4 涉及租户隔离的业务表

| 表名 | tenantId | isPublic | 说明 |
|------|----------|------------|------|
| User | ✅ | — | 用户所属租户 |
| AgentApp | ✅ | ✅ | Agent 应用 |
| AgentTeam | ✅ | ✅ | Agent 团队 |
| Project | ✅ | ✅ | 项目 |
| Workflow | ✅ | ✅ | 工作流 |
| Skill | ✅ | ✅ | 技能 |
| ModelConfig | ✅ | ✅ | 模型配置 |
| McpServerConfig | ✅ | — | MCP 服务器 |
| TaskInstance | ✅ | ✅ | 任务实例 |

### 1.5 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| JWT 扩展 | `src/lib/auth.ts` | JWT payload 包含 `tenantId`、`isIcsTenant` |
| 租户上下文 | `src/lib/tenant.ts` | `getTenantContext()` 从 JWT 解析出三类用户身份 |
| 租户过滤 | `src/lib/tenant-filter.ts` | `buildTenantFilter()` 构建 Prisma WHERE 条件 |
| 增强认证 | `src/lib/api-auth.ts` | `authenticateRequestEnhanced()` 返回带租户上下文的认证结果 |

---

## 2. 用户角色与权限

### 2.1 三类用户权限对比

| 操作 | 平台管理员 | ICSL 租户用户 | 普通租户用户 |
|------|-----------|-------------|-------------|
| 查看所有租户数据 | ✅ | ✅ | ❌ |
| 查看本租户 + 公共资源 | ✅ | ✅ | ✅ |
| 创建私有资源（自动绑定租户） | ✅ | ✅ | ✅ |
| 创建公共资源（isPublic=true） | ✅ | ✅ | ❌ |
| 管理租户（CRUD） | ✅ | ❌ | ❌ |
| 分配/移除租户用户 | ✅ | ❌ | ❌ |
| 删除租户 | ✅（无用户时） | ❌ | ❌ |

### 2.2 JWT Token 结构

登录后返回的 Token 和用户信息包含租户字段：

```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "user_xxx",
    "username": "zhangsan",
    "roles": ["developer"],
    "tenantId": "tenant_team_a",
    "tenantName": "产品线A",
    "isIcsTenant": false
  }
}
```

---

## 3. API 接口说明

### 3.1 租户管理 API（仅平台管理员）

**基础路径**: `/api/admin/tenants`

| 方法 | 路径 | 功能 | 请求体/参数 |
|------|------|------|------------|
| GET | `/api/admin/tenants` | 获取租户列表 | Query: `?search=关键词` |
| POST | `/api/admin/tenants` | 创建租户 | `{ name, slug, isIcsTenant? }` |
| GET | `/api/admin/tenants/[id]` | 获取租户详情 | — |
| PATCH | `/api/admin/tenants/[id]` | 更新租户 | `{ name?, isIcsTenant? }` |
| DELETE | `/api/admin/tenants/[id]` | 删除租户（租户下无用户时） | — |
| GET | `/api/admin/tenants/[id]/users` | 获取租户下用户列表 | — |
| POST | `/api/admin/tenants/[id]/users` | 将用户分配到租户 | `{ userId }` |
| DELETE | `/api/admin/tenants/[id]/users?userId=xxx` | 从租户移除用户 | Query: `?userId=xxx` |

### 3.2 租户感知的资源 API

以下 API 在创建资源时自动绑定当前用户的租户，查询时按租户过滤：

| API 路径 | GET 行为 | POST 行为 |
|----------|---------|----------|
| `/api/workflows` | 按租户过滤 | 绑定 tenantId + isPublic |
| `/api/agent-apps` | 按租户过滤 | 绑定 tenantId + isPublic |
| `/api/skills` | 按租户过滤 | 绑定 tenantId + isPublic |
| `/api/models` | 按租户过滤 | 绑定 tenantId + isPublic |
| `/api/mcp-servers` | 按租户过滤 | 绑定 tenantId |
| `/api/projects` | 按租户过滤 | 绑定 tenantId + isPublic |
| `/api/task-builder/tasks` | 按租户过滤 | 绑定 tenantId + isPublic |

---

## 4. 验收测试用例

### 4.1 前置条件

1. 系统已启动（`npm run dev`）
2. 已执行数据库种子（`npm run db:seed`）
3. 已有测试账户：
   - 平台管理员：`admin` / `admin123`
   - ICSL 租户用户：`icsl_user`
   - 普通租户用户：`team_a_user`

> 以下测试用例中的 `{ADMIN_TOKEN}`、`{ICSL_TOKEN}`、`{TENANT_TOKEN}` 分别代表三类用户登录后获取的 JWT Token。

---

### 4.2 测试用例 1：登录与租户信息绑定

**目的**：验证不同角色登录后返回正确的租户信息

**步骤 1：平台管理员登录**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

**预期结果**：
```json
{
  "user": {
    "tenantId": null,
    "tenantName": null,
    "isIcsTenant": false,
    "roles": ["admin"]
  }
}
```
验证点：`tenantId` 为 `null`，`roles` 包含 `admin`。

**步骤 2：ICSL 租户用户登录**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"icsl_user","password":"<密码>"}'
```

**预期结果**：
```json
{
  "user": {
    "tenantId": "tenant_icsl_xxx",
    "tenantName": "ICSL",
    "isIcsTenant": true
  }
}
```
验证点：`isIcsTenant` 为 `true`，`tenantId` 非空。

**步骤 3：普通租户用户登录**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"team_a_user","password":"<密码>"}'
```

**预期结果**：
```json
{
  "user": {
    "tenantId": "tenant_team_a_xxx",
    "tenantName": "TeamA",
    "isIcsTenant": false
  }
}
```
验证点：`isIcsTenant` 为 `false`，`tenantId` 非空且不是 ICSL 的租户 ID。

---

### 4.3 测试用例 2：资源创建自动绑定租户

**目的**：验证创建资源时自动关联当前用户的租户

**步骤 1：普通租户用户创建私有资源**
```bash
curl -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TENANT_TOKEN}" \
  -d '{"name":"test-skill-private","displayName":"测试私有技能","type":"custom","content":"# Test"}'
```

**预期结果**：
```json
{
  "skill": {
    "tenantId": "tenant_team_a_xxx",
    "isPublic": false,
    "userId": "user_team_a_xxx"
  }
}
```
验证点：`tenantId` 为当前用户的租户 ID，`isPublic` 为 `false`。

**步骤 2：普通租户用户尝试创建公共资源（应被拒绝）**
```bash
curl -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {TENANT_TOKEN}" \
  -d '{"name":"test-skill-public","displayName":"测试公共技能","type":"custom","content":"# Test","isPublic":true}'
```

**预期结果**：HTTP 403
```json
{ "error": "只有 ICSL 租户可以创建公共资源" }
```

**步骤 3：ICSL 用户创建公共资源（应成功）**
```bash
curl -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {ICSL_TOKEN}" \
  -d '{"name":"test-skill-public","displayName":"公共技能","type":"custom","content":"# Public","isPublic":true}'
```

**预期结果**：
```json
{
  "skill": {
    "tenantId": null,
    "isPublic": true
  }
}
```
验证点：公共资源 `tenantId` 为 `null`，`isPublic` 为 `true`。

---

### 4.4 测试用例 3：数据查询租户隔离

**目的**：验证不同角色查询到的数据范围不同

**前置**：确保系统中有 ICSL 创建的公共资源和不同租户的私有资源。

**步骤 1：普通租户用户查询 Skills**
```bash
curl http://localhost:3000/api/skills?scope=all \
  -H "Authorization: Bearer {TENANT_TOKEN}"
```

**预期结果**：返回列表仅包含：
- 本租户的私有资源
- 所有公共资源（isPublic=true）

**验证点**：不包含其他租户的私有资源。

**步骤 2：ICSL 用户查询 Skills**
```bash
curl http://localhost:3000/api/skills?scope=all \
  -H "Authorization: Bearer {ICSL_TOKEN}"
```

**预期结果**：返回所有租户的所有资源。

**步骤 3：平台管理员查询 Skills**
```bash
curl http://localhost:3000/api/skills?scope=all \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：返回所有租户的所有资源。

**步骤 4：对比数据量**
- 普通租户用户可见数 ≤ ICSL 用户可见数
- 普通租户用户可见数 ≤ 管理员可见数
- ICSL 用户可见数 = 管理员可见数

---

### 4.5 测试用例 4：租户管理 API 权限控制

**目的**：验证租户管理 API 仅平台管理员可访问

**步骤 1：普通用户访问租户列表（应被拒绝）**
```bash
curl http://localhost:3000/api/admin/tenants \
  -H "Authorization: Bearer {TENANT_TOKEN}"
```

**预期结果**：HTTP 403
```json
{ "error": "禁止访问" }
```

**步骤 2：ICSL 用户访问租户列表（应被拒绝）**
```bash
curl http://localhost:3000/api/admin/tenants \
  -H "Authorization: Bearer {ICSL_TOKEN}"
```

**预期结果**：HTTP 403
```json
{ "error": "禁止访问" }
```

**步骤 3：平台管理员访问租户列表（应成功）**
```bash
curl http://localhost:3000/api/admin/tenants \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：HTTP 200
```json
{
  "tenants": [
    { "id": "...", "name": "ICSL", "slug": "icsl", "isIcsTenant": true, "userCount": 3 },
    { "id": "...", "name": "TeamA", "slug": "team-a", "isIcsTenant": false, "userCount": 2 }
  ]
}
```

---

### 4.6 测试用例 5：租户 CRUD 操作

**目的**：验证租户的创建、查询、更新、删除流程

**步骤 1：创建新租户**
```bash
curl -X POST http://localhost:3000/api/admin/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -d '{"name":"测试部门B","slug":"team-b","isIcsTenant":false}'
```

**预期结果**：HTTP 201
```json
{ "tenant": { "id": "tenant_xxx", "name": "测试部门B", "slug": "team-b", "isIcsTenant": false } }
```

**步骤 2：查询租户详情**
```bash
curl http://localhost:3000/api/admin/tenants/{tenant_id} \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：返回租户详情及用户数。

**步骤 3：更新租户**
```bash
curl -X PATCH http://localhost:3000/api/admin/tenants/{tenant_id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -d '{"name":"测试部门B-更新"}'
```

**预期结果**：返回更新后的租户信息。

**步骤 4：删除无用户的租户**
```bash
curl -X DELETE http://localhost:3000/api/admin/tenants/{tenant_id} \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：HTTP 200
```json
{ "success": true }
```

**步骤 5：尝试删除有用户的租户（应被拒绝）**
```bash
curl -X DELETE http://localhost:3000/api/admin/tenants/{icsl_tenant_id} \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：HTTP 400
```json
{ "error": "租户下有用户，无法删除" }
```

---

### 4.7 测试用例 6：租户用户分配与移除

**目的**：验证用户与租户的关联管理

**步骤 1：将用户分配到租户**
```bash
curl -X POST http://localhost:3000/api/admin/tenants/{tenant_id}/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -d '{"userId":"user_xxx"}'
```

**预期结果**：HTTP 201，用户 `tenantId` 被更新。

**步骤 2：查询租户下用户列表**
```bash
curl http://localhost:3000/api/admin/tenants/{tenant_id}/users \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：返回该租户下所有用户。

**步骤 3：从租户移除用户**
```bash
curl -X DELETE "http://localhost:3000/api/admin/tenants/{tenant_id}/users?userId=user_xxx" \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：HTTP 200，用户 `tenantId` 被设为 `null`。

**步骤 4：尝试移除 admin 用户的租户（应被拒绝）**
```bash
curl -X DELETE "http://localhost:3000/api/admin/tenants/{tenant_id}/users?userId=admin_user_id" \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**预期结果**：HTTP 400
```json
{ "error": "不能从平台管理员移除租户" }
```

---

### 4.8 测试用例 7：Dashboard 前端验证

**目的**：验证前端页面正确展示租户信息和管理功能

**步骤 1：登录管理员，验证头部标签**
1. 以 `admin` 登录
2. 查看顶部导航栏

**预期结果**：显示红色「平台管理员」标签。

**步骤 2：登录 ICSL 用户，验证头部标签**
1. 以 `icsl_user` 登录
2. 查看顶部导航栏

**预期结果**：显示蓝色租户名称标签 + 紫色「ICSL」标签。

**步骤 3：登录普通租户用户，验证头部标签**
1. 以 `team_a_user` 登录
2. 查看顶部导航栏

**预期结果**：显示蓝色租户名称标签。

**步骤 4：租户管理页面**
1. 以 `admin` 登录
2. 访问 `/dashboard/admin/tenants`

**预期结果**：
- 显示租户列表（含名称、slug、用户数、ICSL 标识）
- 可搜索租户
- 可创建/编辑/删除租户
- 可管理租户下的用户（添加/移除）

---

## 5. 自动化测试

项目提供自动化测试脚本，可快速验证多租户核心功能：

```bash
# 确保服务已启动
npm run dev

# 在另一个终端运行测试
node scripts/test-multi-tenant.js
```

**测试脚本覆盖内容**：
- [x] 用户登录正确绑定租户信息
- [x] 平台管理员自动识别（tenantId=null）
- [x] 资源创建自动关联租户 ID
- [x] Skills 租户隔离
- [x] Workflows 租户隔离
- [x] 普通用户无法访问租户管理 API
- [x] 平台管理员可访问所有租户数据

---

## 6. 验收标准

### 6.1 必须通过项（P0）

| 编号 | 验收项 | 对应用例 |
|------|--------|---------|
| A01 | 三类用户登录后返回正确的租户信息 | 4.2 |
| A02 | 普通租户用户创建的资源自动绑定其租户 | 4.3 步骤 1 |
| A03 | 普通租户用户无法创建公共资源 | 4.3 步骤 2 |
| A04 | ICSL 用户可创建公共资源 | 4.3 步骤 3 |
| A05 | 普通租户用户只能看到本租户 + 公共资源 | 4.4 |
| A06 | ICSL 用户和平台管理员可看到所有资源 | 4.4 |
| A07 | 非平台管理员无法访问租户管理 API | 4.5 |
| A08 | 租户 CRUD 操作正常 | 4.6 |
| A09 | 有用户的租户无法删除 | 4.6 步骤 5 |
| A10 | 用户分配/移除租户正常 | 4.7 |

### 6.2 建议通过项（P1）

| 编号 | 验收项 | 对应用例 |
|------|--------|---------|
| A11 | 前端头部正确显示租户标签 | 4.8 |
| A12 | 租户管理页面 CRUD 功能正常 | 4.8 步骤 4 |
| A13 | admin 用户不能被移除租户绑定 | 4.7 步骤 4 |
| A14 | 自动化测试脚本全部通过 | 5 |

### 6.3 验收判定

- **通过**：P0 全部通过（A01-A10）
- **附条件通过**：P0 全部通过，P1 有不超过 2 项未通过
- **不通过**：P0 有任何一项未通过

---

## 7. 注意事项

1. **密码重置**：如需重置测试账户密码，运行 `node reset_admin.js`
2. **数据隔离**：租户隔离为应用层实现，直接操作数据库可绕过隔离，请勿直接修改业务表
3. **Token 时效**：JWT Token 过期后需重新登录获取，测试时注意 Token 有效期
4. **admin 用户保护**：系统禁止将 admin 用户分配到任何租户或从租户移除，以保障平台管理员身份
