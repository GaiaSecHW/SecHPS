# 平台权限整改：思路、方案与执行计划

**日期**: 2026-06-12
**前置文档**: `docs/url-permission-control-spec.md` (V6) + `docs/tenant-isolation-remediation-plan.md` (V1)

---

## 一、整改思路

两大系统性缺陷：

1. **权限控制缺陷**：大量API无认证或仅认证无权限；前端页面无路由守卫；user角色权限声明与生效范围矛盾。
2. **租户隔离缺陷**：5个核心实体无tenantId字段；大量API仅userId级隔离；CodeswarmTask完全无认证。

**顺序**: 先URL权限后租户隔离——URL整改统一认证架构后，租户整改可直接复用，避免重复认证重构。

```
Phase A: URL权限 → 统认证架构 + 路由守卫 + 权限映射
Phase B: 租户隔离 → Schema补tenantId + API租户过滤 + 数据迁移
```

---

## 二、方案简述

### Phase A: URL权限控制

**A0 认证架构改造** — HttpOnly Cookie替代localStorage token：
- 新增 `/api/auth/me` + `AuthContext`，替代60+处localStorage读取
- middleware改读HttpOnly `access_token` cookie
- 移除60+处手动 `Authorization: Bearer` header
- SSE天然认证解决（浏览器自动携带cookie）

**A1-A2 路由守卫与角色体系** — 四层角色：

| 角色 | 权限边界 |
|------|----------|
| platform_admin (admin+!tenantId) | 全部权限+租户管理+纯后端调度 |
| admin (admin+tenantId) | 租户内全权限，不可跨租户 |
| developer | 开发权限+非GET，仅本租户数据 |
| user | 仅GET+task-builder，仅本租户数据 |

9条权限规则（R1-R9），核心：非GET限developer+、Sessions指定developer、无认证API对齐、租户管理仅platform_admin、纯后端调度仅platform_admin。

DEFAULT_ROLE_PERMISSIONS调整：user移除PROJECT/MODEL写权限。

**A3-A6 API权限补全** — 约60个API路由补requiredPermission；13个无认证API加认证；CodeSwarm前端路径加admin权限、Worker回调保留verifyWorkerToken。

### Phase B: 租户隔离

**B0 Schema补tenantId** — 5个模型加tenantId字段+索引+关系，数据迁移回填。

**B1 tenant-filter增强** — 新增 `buildTenantFilterForPrivateResource`（无isPublic实体）和 `buildTenantSqlCondition`（$queryRaw场景）。

**B2 API租户过滤** — 7个实体加validateTenantAccess/withTenantFilter：Project、Workflow、User、AgentFlowPipeline、EvaluationSession、TokenUsage/token-stats、CodeswarmTask。

**B3 写入链路** — 创建时从父表继承tenantId：EvaluationSession→Project、SessionMessage→EvaluationSession、TokenUsage→EvaluationSession/User、Vulnerability→TaskInstance/Project、CodeswarmTask→TaskInstance。

---

## 三、代码修改风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **60+处手动Authorization header移除遗漏** | 部分API调用因cookie未携带而401 | 逐文件grep `localStorage.getItem('token')` / `Authorization: Bearer` 确保全部移除 |
| **AuthContext刷新时序** | 页面首次加载时user=null导致守卫误判 | AuthContext loading状态期显示loading spinner而非redirect |
| **middleware JWT解析不验证签名** | atob解码JWT不验签，理论上可伪造 | 仅做路由拦截第一层，API层做完整JWT验证第二层 |
| **DEFAULT_ROLE_PERMISSIONS变更需DB同步** | 代码改了但数据库未同步，权限仍生效 | 改后必须执行 `db:seed` + `/api/admin/sync-permissions` |
| **R1影响user的project/model写操作** | user无法创建项目/模型（设计意图，通过task-builder间接使用） | 确认task-builder覆盖user核心工作流 |
| **R2 Sessions提升到developer** | user无法查看session详情 | user通过task-builder查看任务状态，session是developer调试工具 |
| **R8租户内admin排除** | 租户内admin无法管理租户（设计意图） | 文档明确platform_admin与租户内admin的区别 |
| **Schema补tenantId后数据迁移不完整** | NULL tenantId导致查询遗漏 | 迁移SQL覆盖所有回填路径；NULL表示平台级资源 |
| **CodeswarmTask $queryRaw加租户条件** | raw SQL需手动拼接WHERE片段，易遗漏 | 使用 `buildTenantSqlCondition` 统一生成 |
| **级联删除遗漏tenantId匹配** | EvaluationSession删除时跨租户级联删除 | 删除条件加tenantId匹配 |
| **SSE推送跨租户泄露** | 评估会话SSE推送未检查租户归属 | SSE handler加tenantId验证 |
| **前端移除localStorage后AuthContext未就绪** | 部分组件仍在读取localStorage.user | 全项目grep `localStorage.getItem('user')` 确保全部迁移到useAuth() |

---

## 四、执行计划与工作量

> 工作量以相对比例表示，Phase A占总量约50%，Phase B约18%，测试约32%。

### Phase A: URL权限控制（约50%）

| 步骤 | 任务 | 比例 |
|------|------|:----:|
| A0 | 认证架构：HttpOnly Cookie + AuthContext + /api/auth/me + middleware + 移除60+处header | 12% |
| A1 | route-permissions.ts + canAccessRoute | 4% |
| A2 | 侧边栏 + DEFAULT_ROLE_PERMISSIONS + seed同步 | 4% |
| A3 | 前端49个页面Guard + 子路由继承 | 8% |
| A4 | API权限: R1+R2+R3（约13个路由加认证/权限） | 8% |
| A5 | API权限: R6+R8+R9（约40个路由补requiredPermission） | 8% |
| A6 | CodeSwarm API认证（约17个路由） | 4% |

### Phase B: 租户隔离（约18%）

| 步骤 | 任务 | 比例 |
|------|------|:----:|
| B0 | Schema补tenantId + db:push + 数据迁移SQL | 4% |
| B1 | tenant-filter.ts增强 | 2% |
| B2 | API租户过滤（7个实体约8个route.ts） | 8% |
| B3 | 写入链路tenantId继承 | 4% |

### 集成测试（约32%）

| 步骤 | 验证内容 | 比例 |
|------|----------|:----:|
| T1 | 四层角色权限边界 | 4% |
| T2 | 租户隔离（私有数据不可跨租户） | 6% |
| T3 | 公开资源（isPublic跨租户可见） | 2% |
| T4 | 认证架构（cookie/SSE/登出） | 4% |
| T5 | 纯后端调度/租户管理 | 4% |
| T6 | CodeSwarm + Worker回调 | 4% |
| T7 | DEFAULT_ROLE_PERMISSIONS一致性 | 2% |
| T8 | 全量回归 | 10% |

---

## 五、Phase A → Phase B 依赖

| Phase A产出 | Phase B复用 |
|-------------|-----------|
| authenticateRequestEnhanced统一认证 | B2直接使用 |
| PERMISSIONS常量完善 | B2 requiredPermission已就绪 |
| AuthContext全局用户信息 | B2前端租户级数据展示基础 |

| Phase A不覆盖 | Phase B独立执行 |
|-------------|-----------|
| Schema tenantId | B0 |
| 数据迁移 | B0 |
| 写入链路tenantId | B3 |

---

## 六、验收标准

| # | 验收条件 | 验证方法 |
|---|----------|----------|
| V1 | user访问developer页面重定向到首页 | user访问 `/dashboard/skills` |
| V2 | user访问admin页面重定向到首页 | user访问 `/dashboard/users` |
| V3 | 租户内admin访问租户管理重定向到首页 | admin(有tenantId)访问 `/dashboard/admin/tenants` |
| V4 | platform_admin正常访问租户管理 | platform_admin访问 `/dashboard/admin/tenants` |
| V5 | user POST `/api/projects` 返回403 | user创建项目 |
| V6 | developer GET admin接口返回403 | developer访问 `/api/admin/models` |
| V7 | 无认证请求访问claude/evaluations/v1返回401 | 无token请求 |
| V8 | 租户A看不到租户B私有数据 | 租户A查询租户B私有Project/Workflow/Skill |
| V9 | isPublic资源跨租户可见 | 租户A查询租户B公开Skill |
| V10 | HttpOnly cookie认证正常 | 登录后检查cookie |
| V11 | localStorage无token | 登录后检查localStorage |
| V12 | SSE天然认证 | CodeSwarm SSE连接正常 |
| V13 | 登出后跳转/login | 登出后检查跳转 |
| V14 | token-stats按租户隔离 | 租户A不含租户B数据 |
| V15 | DEFAULT_ROLE_PERMISSIONS与实际生效一致 | db:seed后user无PROJECT/MODEL写权限 |
