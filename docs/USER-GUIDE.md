# SecHPS 用户使用指导手册

> AI 驱动的编码辅助安全测试平台，支持多租户、RBAC 权限、工作流编排、AI 模型路由、分布式任务调度、代码安全分析等功能。

---

## 目录

- [1. 平台概述](#1-平台概述)
- [2. 快速开始](#2-快速开始)
- [3. 认证与登录](#3-认证与登录)
- [4. 系统导航](#4-系统导航)
- [5. 用户管理](#5-用户管理)
- [6. 角色与权限](#6-角色与权限)
- [7. 多租户管理](#7-多租户管理)
- [8. 项目管理](#8-项目管理)
- [9. 工作流引擎](#9-工作流引擎)
- [10. 评估系统](#10-评估系统)
- [11. Agent 管理](#11-agent-管理)
- [12. AgentFlow 管道编排](#12-agentflow-管道编排)
- [13. Skill 系统](#13-skill-系统)
- [14. AI 模型配置](#14-ai-模型配置)
- [15. MCP 服务器集成](#15-mcp-服务器集成)
- [16. 漏洞管理](#16-漏洞管理)
- [17. CodeSwarm 分布式调度](#17-codeswarm-分布式调度)
- [18. 会话管理](#18-会话管理)
- [19. 插件系统](#19-插件系统)
- [20. Token 统计](#20-token-统计)
- [21. 系统配置](#21-系统配置)
- [22. 自主进化系统](#22-自主进化系统)
- [23. API 接口参考](#23-api-接口参考)
- [24. 常见问题](#24-常见问题)

---

## 1. 平台概述

SecHPS 是一款面向安全测试领域的 AI 驱动平台，核心能力包括：

- **智能安全审计**：基于 FSM 状态机 + DAG 工作流编排的多阶段安全评估
- **Agent 协作**：多智能体团队编排，支持 Claude/Codex/Gemini/OpenCode 等多种引擎
- **Skill 市场**：安全技能库，支持创建、进化、治理、匹配
- **分布式执行**：CodeSwarm Worker 集群，Redis 队列驱动的任务调度
- **代码分析**：CodeMap 引擎（Python），污点分析、数据流、Joern 集成
- **漏洞全生命周期**：发现 → 确认 → 误报标记 → 修复验证
- **多租户隔离**：应用层数据隔离，ICSL 特殊租户支持

**技术栈**：Next.js 16 + React 19 + TypeScript 6 + Tailwind CSS 3 + Prisma 6 + PostgreSQL + Redis

---

## 2. 快速开始

### 2.1 安装与初始化

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，配置 DATABASE_URL、JWT_SECRET、REDIS_URL 等

# 初始化数据库
npm run db:push              # 推送 schema
npm run db:seed              # 种子数据（用户 + 角色 + 权限）
npm run db:seed-techstack    # 技术栈种子数据
npm run db:seed-agents       # Agent 定义种子数据
npm run db:seed-fsm          # FSM 模板种子数据

# 启动开发服务器
npm run dev
```

### 2.2 首次登录

访问 http://localhost:3000，使用默认账户登录：

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `admin` | `admin123` | 平台管理员 | 拥有全部权限 |

**重要**：首次登录后系统会强制要求修改初始密码（至少 6 位），修改完成后自动注销，需用新密码重新登录。

### 2.3 生产部署

```bash
# 构建
npm run build

# 启动（自动加载 .env）
npm start

# 启动 Worker（独立进程）
screen -dmS worker1 bash -c 'cd codeswarm/packages/worker && PORT=8090 NODE_ID=worker-1 MAX_CONCURRENT=5 ORCHESTRATOR_URL=http://<主机IP>:3000 node --env-file=../../../.env dist/index.js > /tmp/worker1.log 2>&1; exec bash'

# 健康检查
curl -s http://localhost:3000/api/global/health   # Web 应用
curl -s http://localhost:8090/health              # Worker
```

---

## 3. 认证与登录

### 3.1 登录方式

系统支持**用户名登录**（不支持邮箱登录）：

- 登录页面：`/login`
- API 端点：`POST /api/auth/login`
- 参数：`{ username, password }`

### 3.2 Token 机制

| Token 类型 | 有效期 | 存储 | 说明 |
|-----------|--------|------|------|
| Access Token | 7 天 | HttpOnly Cookie + localStorage | 日常认证 |
| Refresh Token | 30 天 | HttpOnly Cookie + localStorage | 刷新 Access Token |

**Token 刷新**：Access Token 过期后，系统自动使用 Refresh Token 获取新 Token（轮换机制，每次刷新生成新 Refresh Token）。

**JWT Payload 包含**：
- `userId`、`username`、`email`
- `roles[]` — 角色列表（如 `["admin"]`）
- `permissions[]` — 权限列表（如 `["session:create", "workflow:execute"]`）
- `tenantId` — 租户 ID（可选）
- `isIcsTenant` — 是否 ICSL 租户

### 3.3 注册

- API 端点：`POST /api/auth/register`
- 参数：`{ username, password, name, email }`（username 和 password 必填）
- 注册后自动分配 `user` 角色，并自动登录

### 3.4 密码策略

| 场景 | 最低要求 |
|------|---------|
| 管理员创建用户 | 自动生成 12 位随机密码 + "Aa1" 后缀 |
| 管理员重置密码 | ≥ 8 字符，含大小写 + 数字 |
| 用户自修改密码 | ≥ 6 字符 |
| 首次登录强制改密 | ≥ 6 字符 |

### 3.5 登出

- 清除 localStorage（token、refreshToken、user）
- 清除 HttpOnly Cookie（access_token、refresh_token）
- 清除客户端 Cookie（auth-token）

---

## 4. 系统导航

系统侧边栏按角色分三个视图区域，可折叠/展开：

### 使用者视图（所有角色可见）

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `/dashboard` | 平台入口页面 |
| 仪表盘 | `/dashboard/overview` | 数据概览、统计图表 |
| 我的任务 | `/dashboard/task-builder` | 任务创建、执行、结果查看 |

### 开发者视图（developer + admin 可见）

| 页面 | 路径 | 功能 |
|------|------|------|
| Skill 市场 | `/dashboard/skills` | Skill 创建、管理、进化、治理 |
| MCP 市场 | `/dashboard/mcp-servers` | MCP 服务器配置、测试、管理 |
| Agent 市场 | `/dashboard/agent-apps` | Agent 应用创建、配置、指标 |
| 工作流编排 | `/dashboard/agentflow-pipelines` | AgentFlow 可视化管道编辑器（建设中） |
| 智能体进化 | `/dashboard/evolution` | Skill 进化调度、自主进化（对接中） |
| 知识图谱 | `/dashboard/knowledge-graph` | 代码知识图谱、反编译 |
| 数据回流 | `/dashboard/data-feedback` | 漏洞数据反馈 |
| 测评基准 | `/dashboard/evaluation` | Skill 评估基准（对接中） |

### 管理员视图（仅 admin 可见）

| 页面 | 路径 | 功能 |
|------|------|------|
| 用户管理 | `/dashboard/users` | 用户 CRUD、角色分配、密码重置 |
| 模型管理 | `/dashboard/models` | AI 模型配置、测试、路由管理 |
| 租户管理 | `/dashboard/admin/tenants` | 多租户 CRUD、用户分配 |
| API Key 管理 | `/dashboard/admin/api-keys` | API Key 创建、权限绑定 |
| 系统 SDK | `/dashboard/admin/sdk` | 系统配置、SDK 导出 |
| 系统监控 | `/dashboard/admin/monitoring` | 系统健康、缓存、告警 |
| 漏洞管理 | `/dashboard/admin/vulnerabilities` | 全平台漏洞管理 |
| 智能体集群 | `/dashboard/codeswarm` | Worker 管理、任务调度、日志 |

### 用户菜单（右上角）

| 功能 | 说明 |
|------|------|
| 个人中心 | `/dashboard/profile` — 个人信息、密码修改 |
| 我的模型 | `/dashboard/models` — 个人模型配置 |
| Token 统计 | `/dashboard/token-stats` — Token 消耗统计 |
| 退出登录 | 清除认证状态 |

---

## 5. 用户管理

> 仅管理员可操作（需要 `user:*` 权限）

### 5.1 创建用户

1. 进入 `/dashboard/users`，点击「创建用户」
2. 填写：用户名、邮箱、显示名称
3. 选择角色（admin 角色不可通过 API 分配）
4. 系统自动生成初始密码（12位 + "Aa1" 后缀）
5. 新用户 `mustChangePassword=true`，首次登录强制改密

### 5.2 用户状态

- `isActive=true` — 正常账户
- `isActive=false` — 禁用账户（登录返回 403）

### 5.3 角色分配

- 管理员可通过 `/api/users/[id]/roles` 分配角色
- **替换策略**：每次分配清除旧角色，设置新角色
- 分配后自动清除用户权限缓存

### 5.4 密码重置

- 管理员重置：`POST /api/users/[id]/reset-password`（≥ 8 字符 + 大小写 + 数字）
- 用户自修改：`POST /api/users/password`（≥ 6 字符）

---

## 6. 角色与权限

### 6.1 默认角色

| 角色 | 权限数 | 说明 |
|------|--------|------|
| **admin** | 75（全部） | 平台管理员，可访问所有功能 |
| **developer** | 31 | 开发者，可管理 Skill/工作流/MCP/模型/项目 |
| **user** | 15 | 普通用户，基础会话+项目+模型+漏洞查看 |

### 6.2 权限模块

系统采用 `module:action` 格式，共 18 个模块、75 个权限：

| 模块 | 权限示例 | 模块 | 权限示例 |
|------|---------|------|---------|
| session | `session:create` | user | `user:create` |
| role | `role:create` | permission | `permission:read` |
| config | `config:update` | search | `search:file` |
| file | `file:read` | audit | `audit:read` |
| plugin | `plugin:execute` | agent | `agent:chat` |
| agent-definition | `agent-definition:create` | autonomous_evolution | `autonomous_evolution:extract` |
| code | `code:analyze` | model | `model:test` |
| notification | `notification:create` | skill | `skill:create` |
| skill-governance | `skill:merge` | vulnerability | `vulnerability:update` |
| evaluation | `evaluation:create` | project | `project:delete` |
| token | `token:detail` | agent-team | `agent-team:execute` |
| workflow | `workflow:share` | mcp | `mcp:connect` |

### 6.3 developer 角色权限明细

developer 可操作：
- 会话：全权限（create/read/update/delete）
- 项目：全权限
- 模型：全权限
- Token：read/detail
- 工作流：全权限（含 share）
- Skill：全权限（含 execute）
- MCP：全权限（含 connect）
- 漏洞：仅 read

### 6.4 user 角色权限明细

user 可操作：
- 会话：全权限
- 项目：全权限
- 模型：全权限
- Token：read/detail
- 漏洞：仅 read

### 6.5 权限检查

**服务端**：API 路由通过 `authenticateRequest(request, { requiredPermission })` 检查
**客户端**：组件通过 `hasPermission(userPermissions, permission)` 检查，控制 UI 显示

---

## 7. 多租户管理

> 仅平台管理员可操作

### 7.1 租户模型

每个租户包含：`id`、`name`、`slug`（唯一标识，自动从 name 生成）、`isIcsTenant`

### 7.2 四类用户身份

| 身份 | 条件 | 数据访问范围 |
|------|------|-------------|
| 平台管理员 | admin 角色 + 无租户 | 所有数据（无过滤） |
| ICSL 租户管理员 | ICSL 租户 + admin 角色 | 所有数据（无过滤） |
| ICSL/普通租户用户 | 有 tenantId + 非特权 | 同租户数据 + 公共数据 |
| 无租户普通用户 | 无 tenantId + 非 admin | 仅公共数据（isPublic=true） |

### 7.3 数据隔离规则

- **平台管理员/ICSL管理员**：无过滤，可看所有数据
- **租户用户**：`OR: [{ tenantId: 我的租户 }, { isPublic: true }]`
- **无租户用户**：仅 `{ isPublic: true }`

隔离适用于：项目、Skill、工作流、模型、AgentApp、AgentDefinition、McpServerConfig 等

### 7.4 租户管理操作

- 创建租户：`POST /api/admin/tenants`（name, isIcsTenant）
- 更新租户：`PATCH /api/admin/tenants/[id]`
- 删除租户：`DELETE /api/admin/tenants/[id]`（必须无关联用户）
- 分配用户：`POST /api/admin/tenants/[id]/users`
- 移除用户：`DELETE /api/admin/tenants/[id]/users`

---

## 8. 项目管理

### 8.1 创建项目

1. 进入 `/dashboard/task-builder` 或通过 API
2. 提交 FormData：项目名称 + 上传文件 + 技术栈标签
3. 系统创建项目目录、继承全局默认工具权限
4. 只有 admin/ICSL 可创建 `isPublic=true` 的项目

### 8.2 项目配置

项目支持以下配置维度：

| 配置 | 说明 |
|------|------|
| 技术栈 | 标记项目技术栈（如 Java/Spring/MySQL） |
| AgentApp | 关联 Agent 应用 |
| OpencodeConfig | 关联系统配置 |
| 工具权限 | 定义 Agent 可用工具范围 |
| 系统提示词 | 项目级自定义提示词 |
| MCP 服务器 | 项目级 MCP 服务器配置 |
| 环境信息 | environmentUrl、adminUsername/Password 等 |

### 8.3 项目文件上传

- `POST /api/projects/[id]/files` — FormData 文件上传
- 上传文件存储在项目目录下

### 8.4 项目状态

| 状态 | 说明 |
|------|------|
| `idle` | 初始状态，无评估运行 |
| `running` | 有评估正在执行 |
| 其他 | 自定义状态 |

---

## 9. 工作流引擎

> developer + admin 可操作

SecHPS 工作流引擎采用**双引擎架构**：

### 9.1 工作流类型

| 类型 | workflowType | 说明 |
|------|-------------|------|
| DAG | `dag` | 自定义 DAG，用户自由编排节点和边 |
| FSM | `fsm` | FSM 模板驱动，固定 4 阶段流程（P1-P7） |

### 9.2 创建工作流

1. 进入工作流管理页面
2. 填写：名称、描述、技术栈
3. 选择工作流类型（DAG 或 FSM）
4. FSM 类型自动关联 `threat-modeling` 模板
5. 只有 admin/ICSL 可创建 `isPublic=true` 的工作流

### 9.3 DAG 工作流编辑

使用可视化拖拽编辑器（基于 @xyflow/react）：

**节点类型**：
| 类型 | 说明 |
|------|------|
| `start` | 开始节点（可配置描述，无描述则跳过） |
| `end` | 结束节点（可配置描述） |
| `task` | 任务节点（用户自定义） |

**节点配置选项**：
- **角色（roleId）**：不同角色可使用不同 AI 模型
- **Skill 加载模式**：
  - `description` — 按描述自动匹配
  - `vulnerability` — 按漏洞分类匹配
  - `manual` — 手动指定 Skill ID 列表
- **漏洞分类（vulnerabilityCategories）**：指定检测的漏洞类型
- **Skill 文件路径（skillPath）**：直接指定 Skill 文件

**边（Edge）**：连接节点，定义数据流向

**拓扑排序**：使用 Kahn 算法自动确定执行顺序，支持环检测

### 9.4 FSM 工作流

FSM 基于 FSMTemplate 预定义的固定流程：

| 阶段 | FSM Phase | 子阶段 | 名称 | 内容 |
|------|-----------|--------|------|------|
| Phase 1 | fsmPhase=1 | P1+P2 | 系统理解 | 项目上下文、模块清单、入口点、DFD |
| Phase 2 | fsmPhase=2 | P3+P4 | 安全评估 | 信任边界、安全设计审查 |
| Phase 3 | fsmPhase=3 | P5+P6 | 威胁分析 | STRIDE 分析、风险验证 |
| Phase 4 | fsmPhase=4 | P7 | 报告生成 | 缓解规划、路线图 |
| Agent Zone | fsmPhase=6 | 用户节点 | 渗透测试 | 用户编排的 task 节点 |

**4-Gate 协议**（每个 FSM 阶段执行）：
1. **READ** — 读取前序阶段输出
2. **ANALYZE** — 读取 Skill 内容并执行分析
3. **SYNTHESIZE** — 合并分析结果
4. **WRITE** — 写入 YAML 输出

**输出验证**：每个子阶段有严格 Zod Schema：
- P1: `project_context`, `module_inventory(M-XXX)`, `entry_point_inventory(EP-XXX)`
- P2: `interface_inventory(IF-XXX)`, `dfd_elements`, `l1_coverage(必须100%)`
- P3: `boundaries(TB-XXX, 7种类型)`, `cross_boundary_flows`
- P4: `gaps(GAP-XXX)`, `design_matrix(0-100分)`
- P5: `threats(T-[STRIDE]-XXX-XXX, 6类)`, `element_coverage_verification(≥80%)`
- P6: `risk_details(VR-XXX)`, `poc_details(POC-XXX)`, `count_conservation`
- P7: `mitigations(MIT-XXX)`, `roadmap(immediate/short/medium/long)`

### 9.5 工作流角色

工作流可定义多个角色（WorkflowRole），不同角色可使用不同模型配置：
- 角色属性：name、description、color、order
- 节点通过 roleId 关联角色
- 角色模型映射通过评估配置的 `roleModels` 字段设置

### 9.6 工作流分享

- 分享权限级别：`read`、`execute`、`edit`
- 不能分享给自己
- 分享可设置过期时间

### 9.7 DAG 验证

- `POST /api/workflows/validate` — 验证节点+边结构
- 检测：环检测、孤立节点、缺少开始/结束节点

---

## 10. 评估系统

### 10.1 评估类型

| 类型 | workflowType | 说明 |
|------|-------------|------|
| DAG 评估 | `dag` | 按工作流 DAG 拓扑顺序串行执行节点 |
| FSM 评估 | `fsm` | 按 FSM 4-Gate 协议执行固定阶段 |
| Ralph 评估 | `ralph` | 单 Agent Ralph Loop 评估（无工作流） |

### 10.2 评估生命周期

| 状态 | 说明 |
|------|------|
| `preparing` | 创建评估会话，预创建 NodeExecution |
| `ready` | 准备完成 |
| `running` | 执行引擎运行中 |
| `completed` | 执行完成 |
| `failed` | 执行失败 |
| `partial` | 部分完成 |

### 10.3 启动评估

1. 选择项目 + 工作流
2. `POST /api/evaluations/start` — 创建评估会话
3. 选择执行方式：
   - `POST /api/evaluations/[id]/fsm-start` — FSM 评估
   - `POST /api/evaluations/[id]/ralph-start` — Ralph 评估
   - `POST /api/evaluations/[id]/execute` — 通用执行

### 10.4 RalphLoopAgent

核心评估执行器，基于 Claude Agent SDK：

**迭代验证循环**：
- 执行 → 验证完成 → 未完成则继续迭代
- 停止条件：maxIterations（默认10）、maxTokens（默认100K）、maxCost（默认$5）

**完成验证器**：
- `securityAuditVerifier` — 安全审计验证
- `keywordVerifier` — 关键词验证
- `jsonReportVerifier` — JSON 报告验证
- `workflowNodeVerifier` — 工作流节点验证
- `combinedVerifier` — 组合验证器

**执行策略**：
- 串行执行所有节点
- 每个节点根据 roleId 选择模型配置
- 10 分钟无响应自动询问进展
- 6 小时无活动超时终止
- 重试机制（默认 15 次，间隔 60s）

### 10.5 评估监控

- 状态查询：`GET /api/evaluations/[id]/status`
- 进度查询：`POST /api/evaluations/[id]/ask-progress`
- 节点数据：`GET /api/evaluations/[id]/nodes`
- 停止评估：`POST /api/evaluations/[id]/stop`

### 10.6 评估结果

- 结果：`GET /api/evaluations/[id]/results`
- 漏洞列表：`GET /api/evaluations/[id]/vulnerabilities`
- 报告：`GET /api/evaluations/[id]/report`
- 报告下载：`GET /api/evaluations/[id]/report/download`

---

## 11. Agent 管理

### 11.1 AgentDefinition（Agent 定义）

系统内置 + 用户自定义的 Agent 定义模板：

- 字段：name、displayName、description、category、model、systemPrompt、skills、allowedTools
- 系统内置 Agent（isBuiltin=true）对所有用户可见
- 用户自定义 Agent 受租户隔离

### 11.2 AgentApp（Agent 应用）

可执行的 Agent 应用实例：

**创建流程**：
1. 上传 AgentHarness 文件（ZIP 或文件夹）
2. 系统解压并解析文件结构
3. 创建 Gitea 组织仓库（自动 sanitizeRepoName）
4. 推送文件到 Gitea
5. 创建 AgentApp 数据库记录
6. 异步同步 Skill（从上传包识别 `skills/{skillName}/SKILL.md`）

**AgentApp 字段**：
- `name` — 应用名称
- `engine` — 执行引擎类型
- `agentHarnessPath` — Harness 路径
- `defaultAgentName` — 默认 Agent 名（默认 "default-agent"）
- `startCommand` — 启动命令
- `requireCodedmap` — 是否需要 CodeMap 分析
- `isPublic` — 是否公开

**AgentApp 指标**：
- runCount — 运行次数
- successRate — 成功率
- vulnCount — 发现漏洞数
- falsePositiveRate — 误报率

### 11.3 AgentTeam（Agent 团队）

多智能体编排团队：

- 字段：name、description、leadAgentId、taskStrategy（parallel/sequential）、maxTeammates（默认5）
- 成员：AgentTeamMember（agentId、role、overrideModel、overrideTools）
- 执行：AgentTeamExecution + AgentMemberExecution

---

## 12. AgentFlow 管道编排

> 建设中功能

基于 @xyflow/react 的可视化 DAG 编辑器，编排多 Agent 执行流程。

### 12.1 节点类型（3 大类 12 种）

**智能体节点**（6 种）：

| 类型 | 颜色 | 说明 |
|------|------|------|
| `codex` | 蓝色 #3B82F6 | Codex Agent |
| `claude` | 橙色 #F97316 | Claude Agent |
| `kimi` | 绿色 #10B981 | Kimi Agent |
| `opencode` | 红色 #EF4444 | OpenCode Agent |
| `pi` | 紫色 #8B5CF6 | Pi Agent |
| `custom` | 深紫 #7C3AED | 自定义 Agent |

**代码执行节点**（3 种）：

| 类型 | 颜色 | 说明 |
|------|------|------|
| `python_node` | 青色 #06B6D4 | Python 脚本执行 |
| `shell` | 灰色 #9CA3AF | Shell 命令执行 |
| `sync` | 黄色 #EAB308 | 文件同步（repo/full 模式） |

**控制节点**（3 种）：

| 类型 | 颜色 | 说明 |
|------|------|------|
| `fanout` | 青色 #06B6D4 | 并行扇出（按数量/按值列表） |
| `merge` | 琥珀色 #F59E0B | 结果汇聚（按字段/按数量） |
| `evolve` | 粉色 #EC4899 | Agent 进化（目标+优化器） |

### 12.2 管道配置

每个节点可配置：
- **taskId** — 任务 ID（必填）
- **prompt** — 提示词（必填）
- **model** — 模型选择
- **tools** — 工具权限（read_only/read_write）
- **skills** — Skill 列表（多选）
- **mcps** — MCP 服务列表（多选）
- **capture** — 捕获模式（final/trace）
- **timeoutSeconds** — 超时（默认1800）
- **retries** — 重试次数（默认0）

### 12.3 管道发布

`POST /api/agentflow-pipelines/[id]/publish`：
1. 生成 Python 代码（`generatePipelinePy`）
2. 创建或关联 AgentApp（engine=agentflow）
3. 上传 pipeline.py 到 Gitea
4. 更新 Pipeline 状态为 published

---

## 13. Skill 系统

> developer + admin 可操作

### 13.1 Skill 创建方式

**方式一：手动创建**
1. 进入 `/dashboard/skills`，点击创建
2. 填写：name、displayName、description、categoryId、severity、content
3. 如分类有 `hasSubDimension`，需指定 vulnerabilityTreeId（漏洞模式叶子节点）
4. 保存后自动触发治理分析和相似度检测

**方式二：AI 生成**
1. `POST /api/skills/generate`
2. 提交 SkillIntent：name、category、whatDoesItDo、whenShouldItTrigger
3. 系统调用 AI 模型生成 Markdown Skill 内容
4. 自动补齐 YAML frontmatter（含 allowed-tools）和标题
5. 预览确认后保存

**方式三：Git 同步导入**
1. `POST /api/skills/sync`
2. 从 Gitea 仓库 `skill_management/` 执行 git pull
3. 扫描每个子目录下的 `SKILL.md` 文件
4. 自动解析 YAML frontmatter，创建/更新 Skill 记录

**方式四：Harness 上传同步**
- 从上传的 AgentApp 文件包中识别 `skills/{skillName}/SKILL.md` 路径
- 自动创建 Skill 记录并上传到 Gitea

### 13.2 Skill 数据结构

Skill 以完整 Markdown 存储，包含：

```markdown
---
name: skill-name
description: 技能描述
severity: high
allowed-tools: Read, Grep, Glob
---

# Skill 标题

技能正文内容...

## 标准输出格式
[输出模板]
```

### 13.3 Skill 分类体系

两级维度分类：
- **一级**：SkillCategory（如"漏洞挖掘"、"代码审计"）
- **二级**：有 `hasSubDimension=true` 的分类需要指定漏洞模式（VulnerabilityTree 的 pattern 类型叶子节点）
- **漏洞树结构**：language → pattern（如 Java → SQL注入）

### 13.4 Skill 版本管理

- `createSkillVersion()` — 创建新版本（旧版本 isLatest=false，新版本 version+1）
- `rollbackSkillVersion()` — 回滚到指定版本（基于目标版本创建新版本）
- 版本链：parentId 指向上一版本，同一 name+userId 下只有一个 isLatest=true
- 每次版本变更记录到 SkillEvolution 表

### 13.5 Skill 进化管道

进化管道完整流程（6 步）：

1. **调度触发**
   - 定时扫描（cron: `0 3 * * *`，凌晨3点）
   - 触发条件：精准率 < 0.7 或误报数 ≥ 10
   - 每日最大任务数限制（默认10）

2. **案例提取**
   - 从漏洞数据提取误报案例和确认案例

3. **平衡分析**
   - LLM 分析误报模式、原因、排除规则

4. **改进生成**
   - LLM 基于误报分析生成改进后的 Skill 内容

5. **回测验证**
   - 用改进后 Skill 对误报和确认案例进行 LLM 回测
   - 达标标准：漏检数=0 且误报排除率≥50%

6. **版本创建**
   - applyImprovement — 应用改进 → 创建新版本
   - rejectImprovement — 拒绝改进 → 更新状态

### 13.6 Skill 治理

三层检测机制：

1. **快速重复检测**
   - 同语言+同漏洞类型 → confidence 0.95
   - 同语言不同漏洞 → confidence 0.6
   - 同CWE → confidence 0.45

2. **LLM 深度分析**
   - 语义分析，结果：overlapType、confidence、recommendation(merge/keep_separate/review)

3. **审核流程**
   - confidence≥0.7 的分析进入待审核列表
   - 管理员审核通过/拒绝

### 13.7 Skill 其他操作

| 操作 | API | 说明 |
|------|-----|------|
| 测试 | `/api/skills/[id]/test` | 测试 Skill 效果 |
| 匹配 | `/api/skills/match` | 相似度匹配 |
| 合并 | `/api/skills/merge` | 合并重复 Skill |
| 预测 | `/api/skills/predict` | 预测适合的 Skill |
| 优化 | `/api/skills/optimize-skill` | AI 优化 Skill |
| 导入/导出 | `/api/skills/import` `/api/skills/export` | 批量导入/导出 |

---

## 14. AI 模型配置

### 14.1 模型提供商

| providerType | API 协议 | 兼容模型 |
|-------------|---------|---------|
| `claude` | `/v1/messages`（Anthropic） | Claude 系列 |
| `openai` | `/v1/chat/completions`（OpenAI） | OpenAI、DeepSeek、MiniMax 等 |

### 14.2 模型配置字段

| 字段 | 说明 | 默认值 |
|------|------|--------|
| name | 配置名称 | — |
| providerType | claude/openai | openai |
| apiBaseUrl | API 地址 | — |
| apiKey | API 密钥（返回时隐藏） | — |
| models | JSON 数组，支持的模型列表 | — |
| routeType | 路由类型 | — |
| maxTokens | 最大输出 token（256-192000） | 32000 |
| contextWindow | 上下文窗口大小 | 0（自动匹配） |
| temperature | 温度参数（0-2） | 0.3 |
| isActive | 是否激活 | true |
| isDefault | 是否默认模型 | false |
| isPublic | 是否公开 | false |

### 14.3 路由类型（routeType）

仅 OpenAI providerType 支持：

| routeType | 说明 |
|-----------|------|
| `default` | 默认路由 |
| `think` | 思考模式（DeepSeek-R1 等） |
| `background` | 后台任务 |
| `longContext` | 长上下文 |
| `webSearch` | 网络搜索 |

### 14.4 模型测试

`POST /api/models/[id]/test` — 发送测试请求验证模型配置是否正确

### 14.5 多租户模型访问

- admin/ICSL：可查看所有模型
- 普通租户用户：自己的 + 公开的 + 同租户的
- 无租户用户：自己的 + 公开的

---

## 15. MCP 服务器集成

> developer + admin 可操作

### 15.1 MCP 协议支持

| 协议 | type | 通信方式 | 配置 |
|------|------|---------|------|
| Local Stdio | `local` | 子进程 stdin/stdout JSON-RPC | command + args + env |
| Remote SSE | `sse` | HTTP/SSE | url（/sse + /message） |
| Streamable HTTP | `http` | HTTP POST/GET | url（/mcp） |

### 15.2 创建 MCP 服务器

1. 进入 `/dashboard/mcp-servers`
2. 选择协议类型（local/sse/http）
3. 配置：
   - local：command、args（JSON数组）、env（JSON对象）
   - sse/http：url
4. 点击「测试连接」验证连通性
5. 测试成功后自动保存工具列表

### 15.3 三级配置加载

MCP 配置按优先级加载：

| 优先级 | 级别 | 说明 |
|--------|------|------|
| 1（最高） | 项目级 | 关联 projectId |
| 2 | 用户私有 | 关联 userId，isPublic=false |
| 3（最低） | 共享级 | isPublic=true |

**去重规则**：按 name 去重，项目级 > 用户私有 > 共享

### 15.4 MCP 工具权限

格式：`mcp__<server-name>__*`，在评估执行时注入 Agent 的工具权限列表

---

## 16. 漏洞管理

### 16.1 漏洞生命周期

| 状态 | 说明 | 操作 |
|------|------|------|
| `new` | 新发现 | 初始状态 |
| `confirmed` | 已确认 | `POST /api/vulnerabilities/[id]/confirm` |
| `false-positive` | 误报 | `POST /api/vulnerabilities/[id]/false-positive` |
| `fixed` | 已修复 | `POST /api/vulnerabilities/[id]/fix` |
| `verified` | 已验证 | `POST /api/vulnerabilities/[id]/verify` |

> 注意：数据库使用连字符格式（`false-positive`），前端需兼容下划线历史数据

### 16.2 漏洞字段

| 字段 | 说明 |
|------|------|
| title | 漏洞标题 |
| description | 漏洞描述 |
| type | 漏洞类型 |
| cwe | CWE 编号 |
| severity | 严重程度（critical/high/medium/low/info） |
| location | 漏洞位置 |
| POC | 漏洞验证代码 |
| vulnerable | 是否确认可利用 |
| fixSuggestion | 修复建议 |
| filePath | 文件路径 |
| skill | 发现该漏洞的 Skill |
| status | 漏洞状态 |
| falsePositiveReason | 误报原因 |

### 16.3 漏洞统计

`GET /api/vulnerabilities/stats` — 按严重程度、状态、类型统计

### 16.4 漏洞模式（VulnerabilityPattern）

预定义的漏洞检测模式：
- 字段：name、displayName、description、cwe、cve、patterns、languages、exampleVulnerable、exampleFixed、fixGuidance
- 分类关联：VulnerabilityCategory
- 管理端点：`/api/admin/vulnerability-patterns`

### 16.5 漏洞树（VulnerabilityTree）

三级层级结构：
- `category` — 漏洞大类
- `subcategory` — 漏洞子类
- `pattern` — 具体漏洞模式（叶子节点，关联 Skill）

---

## 17. CodeSwarm 分布式调度

> 仅管理员可操作

### 17.1 架构

Redis Stream 队列驱动的分布式任务调度系统，支持 DB 轮询降级模式。

### 17.2 任务生命周期

| 状态 | 说明 |
|------|------|
| `queued` | 任务创建，等待分发 |
| `dispatched` | 已选择 Worker，等待确认 |
| `running` | Worker 确认接收，执行中 |
| `completed` | 执行完成 |
| `failed` | 执行失败 |

### 17.3 Worker 管理

**Worker 注册**（心跳机制）：
- `POST /api/codeswarm/worker/heartbeat`（每 30s）
- upsert Worker 记录（nodeId、address、maxConcurrent、currentTasks）
- 地址冲突检测（同主地址的旧 Worker 标记 offline）
- 90s 无心跳标记 offline，重调度其任务

**Worker 配置**：
- `NODE_ID` — Worker 节点标识
- `MAX_CONCURRENT` — 最大并发任务数（默认5）
- `ORCHESTRATOR_URL` — 主服务器地址

### 17.4 任务分发策略

- **最少负载优先**：选择 currentTasks 最少的健康 Worker
- **指定 Worker**：支持 preferredWorkerNodeId 手动选择
- **多地址 failover**：Worker 地址可逗号分隔，按可达性排序
- **两阶段提交**：先 DB 更新为 dispatched，再 HTTP 请求；失败则回滚

### 17.5 任务创建

`POST /api/codeswarm/tasks`：
- instruction — 任务指令
- projectPath — 项目路径
- skills/scripts/mcps — Skill/脚本/MCP 配置
- model — 模型选择
- engine/agent — 执行引擎和 Agent

### 17.6 漏洞解析流程（Worker 完成后）

1. Worker 上报 result → `POST /api/codeswarm/worker/result`
2. 事务更新 CodeswarmTask + TaskInstance + Worker.currentTasks decrement
3. 触发漏洞解析（异步）：
   - Phase 1：使用 audit-report-parser Skill 解析
   - Phase 2：AI Fallback 通用指令提取漏洞 JSON
   - 上传 Report 到 MinIO
   - 调用 `/api/v1/vulnerabilities` 入库

### 17.7 监控操作

- 任务列表：`GET /api/codeswarm/tasks`
- Worker 列表：`GET /api/codeswarm/nodes`
- 任务日志：`GET /api/codeswarm/tasks/[taskId]/logs`
- SSE 实时日志：`GET /api/codeswarm/tasks/[taskId]/stream`
- 手动分发：`POST /api/codeswarm/tasks/[taskId]/dispatch`

---

## 18. 会话管理

### 18.1 多源会话发现

系统兼容多种 AI 编码助手的本地会话数据：

| Provider | 存储路径 | 格式 |
|----------|---------|------|
| Claude SDK | `~/.claude/projects/` | JSONL |
| Cursor | `~/.cursor/sessions/` | — |
| Codex | `~/.codex/` | — |
| Gemini CLI | `~/.gemini/sessions/` | JSON |

### 18.2 会话操作

| 操作 | API | 说明 |
|------|-----|------|
| 会话列表 | `GET /api/sessions` | 多源项目发现，汇总所有 Provider |
| 会话详情 | `GET /api/sessions/[id]` | 消息历史 |
| 消息列表 | `GET /api/sessions/[id]/messages` | 分页消息 |
| 搜索 | `GET /api/sessions/search` | 项目内搜索 |
| 跨项目搜索 | `GET /api/sessions/search/all` | 全局搜索 |
| 恢复会话 | `POST /api/sessions/[id]/resume` | 加载历史上下文创建新会话 |
| 子代理 | `GET /api/sessions/[id]/children` | 子代理列表 |
| TODO | `GET /api/sessions/[id]/todo` | 从消息提取 TodoWrite |

---

## 19. 插件系统

### 19.1 插件类型

| 类型 | 说明 |
|------|------|
| `ui-tab` | UI 标签页插件（返回渲染信息） |
| `backend-service` | 后端服务插件 |
| `integration` | 集成插件 |
| `tool` | 工具插件 |

### 19.2 插件生命周期

1. **发现** — 扫描 `plugins/` 目录下的 manifest.json
2. **同步** — 将发现的插件同步到数据库
3. **安装** — 创建数据库记录
4. **启用/禁用** — toggle 插件状态
5. **执行** — 根据类型选择执行器运行
6. **卸载** — 内置插件不可卸载

### 19.3 插件权限

| 权限 | 说明 |
|------|------|
| `plugin:create` | 安装插件 |
| `plugin:read` | 查看插件 |
| `plugin:update` | 更新插件 |
| `plugin:delete` | 删除插件 |
| `plugin:toggle` | 启用/禁用 |
| `plugin:execute` | 执行插件 |

---

## 20. Token 统计

### 20.1 Token 消耗追踪

系统自动记录每次 AI 模型调用的 Token 消耗：

- API Provider（apiProvider）
- 模型名称（modelName）
- 调用类型（callType）
- 输入/输出/总 Token 数
- 估算费用（estimatedCost）
- 请求时间（durationMs）

### 20.2 Token 统计页面

- `/dashboard/token-stats` — 个人 Token 消耗统计
- `GET /api/token-stats` — 全局统计（需 `token:read` 权限）
- `GET /api/token-stats/project` — 项目级统计

---

## 21. 系统配置

### 21.1 OpencodeConfig

系统核心配置表，关键字段：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| name | 配置名称 | — |
| baseURL | 基础 URL | http://localhost:54321 |
| projectUploadDir | 项目上传目录 | — |
| taskDescription | 任务描述模板 | — |
| maxConcurrentEvaluations | 并发评估限制（1-10） | 3 |
| modelPreferences | 模型偏好 | — |
| customSystemPrompt | 自定义系统提示词 | — |
| skillOutputTemplate | Skill 标准输出格式 | — |
| defaultToolPermissions | 默认工具权限 | — |

### 21.2 自主进化配置

通过 SystemConfig 表管理：

| 配置键 | 说明 |
|--------|------|
| `autonomous_evolution_idle_trigger` | 闲时触发配置（时间窗口、轮询间隔） |
| `autonomous_evolution_injection_enabled` | 评估时注入经验开关 |

### 21.3 Skill 进化配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| precisionThreshold | 0.7 | 精准率阈值 |
| minFalsePositives | 5 | 最小误报数触发 |
| minConfirmed | 3 | 最小确认数 |
| maxDailyTasks | 10 | 每日最大进化任务数 |
| falsePositiveLimit | 10 | 回测误报案例上限 |
| confirmedLimit | 10 | 回测确认案例上限 |

---

## 22. 自主进化系统

### 22.1 经验生成流程

1. **闲时触发**（时间窗口 00:00-06:00）
   - 检查是否有运行中的评估
   - 每 30 分钟轮询

2. **日志解析** — 从 AI Agent 执行日志提取"失败→成功"序列

3. **经验生成** — LLM 分析序列，输出结构化经验：
   - title — 一句话概括
   - errorCategory — 错误分类
   - errorPatterns — 触发特征关键词
   - directSolution — 具体替代方案
   - lesson — 深层原因

4. **经验注入** — 将启用经验注入评估的系统提示词

### 22.2 经验管理

- 查看经验：`GET /api/autonomous-evolution`
- 注入经验：`POST /api/autonomous-evolution/[id]/inject`
- 批量注入：`POST /api/autonomous-evolution/batch-inject`
- 手动提取：`POST /api/autonomous-evolution/extract`
- 查询经验：`POST /api/autonomous-evolution/query`

---

## 23. API 接口参考

### 23.1 认证方式

所有 API 请求需携带 JWT Token：
- **HttpOnly Cookie**：浏览器自动发送（access_token）
- **Authorization Header**：`Authorization: Bearer <token>`
- **Cookie Query**：`Cookie: auth-token=<token>`

### 23.2 V1 版本化 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/tasks` | POST | 创建任务（SDK 接口） |
| `/api/v1/tasks/[taskId]/status` | GET | 任务状态 |
| `/api/v1/tasks/[taskId]/result` | GET | 任务结果 |
| `/api/v1/tasks/[taskId]/report` | GET | 任务报告 |
| `/api/v1/tasks/[taskId]/stop` | POST | 停止任务 |
| `/api/v1/agents` | GET | Agent 列表 |
| `/api/v1/vulnerabilities` | POST | 漏洞入库 |

### 23.3 API Key 管理

管理员可创建 API Key 用于外部系统集成：

- 创建：`POST /api/api-keys`（name + allowedAgents）
- 删除：`DELETE /api/api-keys/[id]`
- API Key 格式：`sk-xxx...`
- 关联 AgentApp：ApiKeyAgent（apiKeyId + agentAppId）

### 23.4 健康检查

- `GET /api/global/health` — 公开，无需认证
- `GET /api/admin/health` — 系统内部健康（需认证）

### 23.5 审计日志

管理员可查看系统操作审计日志：

- 列表：`GET /api/admin/audit-logs`
- 导出：`GET /api/admin/audit-logs/export`
- 报告：`GET /api/admin/audit-logs/report`

记录的操作：login、user_create、user_update、user_delete、user_assign_role、admin_reset_password、password_change、role_create、permission_create 等

---

## 24. 常见问题

### Q: 登录后提示修改密码？

首次登录管理员创建的用户时，系统强制要求修改初始密码（`mustChangePassword=true`）。修改完成后自动注销，需用新密码重新登录。

### Q: 为什么看不到某些数据？

数据受多租户隔离：
- 平台管理员/ICSL管理员：可看所有数据
- 租户用户：只看同租户数据 + 公共数据
- 无租户普通用户：只看公共数据

### Q: 如何创建公共资源？

只有 admin/ICSL 角色可创建 `isPublic=true` 的资源（项目、Skill、工作流、模型、AgentApp、MCP等）。

### Q: Agent 创建失败？

检查以下配置：
- Gitea 连接：`GITEA_URL`、`GITEA_TOKEN` 是否正确
- 文件格式：ZIP 包或文件夹结构是否正确
- sanitizeRepoName：名称中的特殊字符会被自动替换

### Q: Worker 心跳失败？

检查 `ORCHESTRATOR_URL` 是否指向 Web 应用可达地址（不能是 localhost，需是实际 IP）。

### Q: standalone 不加载 .env？

`npm start` 使用 `node --env-file=.env`，确保根目录有 `.env` 文件。修改 `.env` 后需 `npm run build` 或手动 `cp .env .next/standalone/.env`。

### Q: 端口冲突？

`.env` 中 `PORT` 为 Web 应用端口（默认3000），Worker 端口8090在启动命令硬编码。

### Q: PERMISSIONS.xxx 不存在？

在 `src/types/permissions.ts` 添加常量，格式 `module:action`。

### Q: 漏洞状态格式？

数据库使用连字符：`false-positive`、`confirmed`、`ignored`。前端需兼容下划线历史数据。

### Q: Skill 进化何时触发？

- 定时：凌晨3点扫描（cron: `0 3 * * *`）
- 条件：精准率 < 0.7 或误报数 ≥ 10
- 手动：`POST /api/skills/evolution/tasks/[taskId]/trigger`

### Q: Agent SDK 二进制缺失？

`@anthropic-ai/claude-agent-sdk` 含平台原生二进制，不能用 `--omit=optional` 或 `--production` 安装。

---

> **版本**: SecHPS v1.0 | **更新日期**: 2026-06-02 | **技术栈**: Next.js 16 + React 19 + Prisma 6 + PostgreSQL