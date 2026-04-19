# 方案：WorkflowNode 漏洞分类节点 + Skills 动态过滤

## 一、需求总结

### 核心需求

| 维度 | 内容 |
|------|------|
| **问题** | 任务描述不明确 → Skills 有时加载有时不加载 |
| **方案** | WorkflowNode 改造，支持漏洞分类节点 |
| **期望** | 漏洞类别 + 编排技术栈 → 动态过滤匹配的 Skills |

### WorkflowNode 三种模式

| 模式 | 字段配置 | 用途 | Skills 来源 |
|------|----------|------|-------------|
| **自定义描述** | 只有 data | "非 Skill 的活"，不加载 Skills | 无 |
| **手工指定** | data + skills | 加载指定的 Skills | skills 字段（JSON 数组） |
| **漏洞类别** | data + vulnerabilityCategory | 实时加载该类别下所有匹配的 Skills | 数据库实时查询 + 技术栈过滤 |

---

## 二、WorkflowNode 生成逻辑

### 2.1 预设节点生成规则

```
VulnerabilityPattern（漏洞模式）
    ↓ 检查是否有关联的 Skill
    ├── 有 Skill → 生成 WorkflowNode 预设节点
    └── 无 Skill（孤儿）→ 不生成节点
```

**注意**：生成的 WorkflowNode 只是"预设节点"，用户需要手动拉进画板才能使用。

### 2.2 TechStack 来源

TechStack 定义在 `SystemConfig.skill_categories`，共 30 个：

| 分类 | 说明 |
|------|------|
| access-control, authentication, auth, privilege | 访问控制相关 |
| injection, input-validation, deserialization | 注入攻击相关 |
| crypto, cryptography | 加密安全 |
| file, file-ops, traversal | 文件操作相关 |
| infra, components, supply-chain | 基础设施相关 |
| frontend, mobile, api | 平台相关 |
| logic, business-logic, design | 逻辑相关 |
| logging, compliance, info, sensitive | 信息安全相关 |
| memory, integrity | 数据安全相关 |
| ai, other, configuration | 其他 |

---

## 三、Skill 过滤显示逻辑

### 3.1 过滤规则

当用户在编排画板上使用 WorkflowNode 时：

```
用户选择一个 WorkflowNode（如 "SQL注入扫描"）
    ↓
读取 WorkflowNode 关联的 VulnerabilityPattern
    ↓
查询该 VulnerabilityPattern 下的所有 Skill
    ↓
根据当前编排的技术栈过滤 Skill：
    ├── Skill.techStack 与 编排技术栈 匹配 → 显示
    ├── Skill.techStack 为空（通用 Skill）→ 显示（匹配所有）
    └── Skill.techStack 与 编排技术栈 不匹配 → 不显示
```

### 3.2 过滤规则详解

| Skill.techStack | 编排技术栈 | 是否显示 | 原因 |
|-----------------|-----------|----------|------|
| `["typescript"]` | `["typescript", "react"]` | ✅ 显示 | 匹配 |
| `["python"]` | `["typescript", "react"]` | ❌ 不显示 | 不匹配 |
| `null` 或 `[]` | 任意 | ✅ 显示 | 通用 Skill，匹配所有 |
| `["typescript", "node"]` | `["typescript"]` | ✅ 显示 | 部分匹配 |

### 3.3 数据流

```
编排画板
    │
    ├── 用户设置编排技术栈: ["typescript", "react"]
    │
    ├── 用户拖入 WorkflowNode: "SQL注入扫描"
    │       │
    │       └── 关联 VulnerabilityPattern: "sql-injection"
    │               │
    │               └── 查询 Skill:
    │                       WHERE vulnerabilityPatternId = "sql-injection"
    │                       AND (
    │                         techStack IS NULL        -- 通用 Skill
    │                         OR techStack CONTAINS "typescript"  -- 匹配
    │                       )
    │
    └── 显示过滤后的 Skill 列表供选择
```

---

## 四、数据模型改造

### 2.1 WorkflowNode 模型增加字段

**文件**：`prisma/schema.prisma`

**现有模型**（约第 1355 行）：
```
model WorkflowNode {
  id          String   @id
  workflowId  String
  roleId      String?
  type        String
  positionX   Float
  positionY   Float
  data        String
  ...
}
```

**改造后**：
```
model WorkflowNode {
  id                   String   @id
  workflowId           String
  roleId               String?
  type                 String
  positionX            Float
  positionY            Float
  data                 String   // 任务描述
  
  // 新增字段（互斥关系）
  vulnerabilityCategory String?  // 漏洞类别（模式 3）
  skills                String?  // 手工指定的 Skills（模式 2，JSON 数组）
  
  // 注意：
  // - vulnerabilityCategory 和 skills 互斥
  // - 两者都为空 = 自定义描述模式（模式 1）
  ...
}
```

### 2.2 三种模式的字段关系

| 模式 | vulnerabilityCategory | skills | 含义 |
|------|----------------------|--------|------|
| 自定义描述 | NULL | NULL | 不加载 Skills |
| 手工指定 | NULL | ["id1", "id2"] | 加载指定的 Skills |
| 漏洞类别 | "sql-injection" | NULL | 实时查询匹配的 Skills |

---

## 五、完整数据流验证

### 预设漏洞类别

| 类别 ID | 类别名称 | 说明 |
|---------|----------|------|
| `sql-injection` | SQL 注入 | 数据库注入漏洞 |
| `xss` | XSS 漏洞 | 跨站脚本攻击 |
| `auth` | 认证漏洞 | 认证绕过、弱密码等 |
| `config` | 配置漏洞 | 敏感信息泄露、错误配置 |
| `crypto` | 加密漏洞 | 弱加密、密钥管理问题 |
| `ssrf` | SSRF | 服务端请求伪造 |
| `rce` | 远程执行 | 远程代码执行漏洞 |
| `file` | 文件漏洞 | 文件上传、路径遍历等 |

---

## 四、实时匹配逻辑

### 4.1 匹配规则

```
输入：
- WorkflowNode.vulnerabilityCategory = "sql-injection"
- Project.techStack = ["typescript"]

实时查询数据库：
SELECT id FROM Skill
WHERE category = "sql-injection"
AND isActive = true
AND isLatest = true
AND (
  techStack IS NULL           -- 通用 Skill
  OR techStack CONTAINS "typescript"  -- 匹配语言
)

输出：Skill ID 列表
```

### 4.2 匹配服务

**新建文件**：`src/services/skill-matcher.ts`

**核心函数**：
```
matchSkillsByCategory(category, techStack) → string[]
  - 根据 category 和 techStack 查询数据库
  - 返回匹配的 Skill ID 列表
  - 每次执行时实时查询（确保最新）
```

---

## 五、执行流程

### 5.1 Skills 加载流程

```
启动评估
    ↓
获取 Workflow 的所有节点
    ↓
遍历每个节点：
    ├── 有 vulnerabilityCategory？
    │   └── 是 → 实时查询匹配的 Skills
    │
    ├── 有 skills 字段？
    │   └── 是 → 解析 JSON，获取 Skill IDs
    │
    └── 都没有？
        └── 自定义描述模式，不加载 Skills
    ↓
合并所有 Skill IDs（去重）
    ↓
拷贝指定的 Skills 到项目目录
    ↓
Claude SDK 加载 Skills
```

### 5.2 模式判断代码

```
function getNodeSkills(node, projectTechStack) {
  // 模式 3：漏洞类别
  if (node.vulnerabilityCategory) {
    return await matchSkillsByCategory(
      node.vulnerabilityCategory,
      projectTechStack
    );
  }
  
  // 模式 2：手工指定
  if (node.skills) {
    return JSON.parse(node.skills);
  }
  
  // 模式 1：自定义描述
  return [];
}
```

---

## 六、执行阶段

### 阶段 1：配置修复（立即生效，解决根本问题）

**目的**：让现有的 Skills 能被 Claude SDK 加载

| 任务 | 文件 | 改动 |
|------|------|------|
| 1.1 | src/services/ai/claude-agent.ts | allowedTools 默认值增加 "Skill" |
| 1.2 | src/app/api/projects/[id]/start/route.ts | settingSources: ['project'] |
| 1.3 | src/lib/agent-executor.ts | allowedTools 增加 "Skill" |
| 1.4 | src/lib/workflow-actions/ai-executor.ts | allowedTools 增加 "Skill" |

### 阶段 2：数据模型

**目的**：WorkflowNode 支持三种模式

| 任务 | 文件 | 改动 |
|------|------|------|
| 2.1 | prisma/schema.prisma | WorkflowNode 增加 vulnerabilityCategory 字段 |
| 2.2 | prisma/schema.prisma | WorkflowNode 增加 skills 字段 |
| 2.3 | - | 数据库迁移 |
| 2.4 | src/types/workflow.ts | NodeData 接口增加新字段 |

### 阶段 3：匹配逻辑

**目的**：实现漏洞类别的实时匹配

| 任务 | 文件 | 改动 |
|------|------|------|
| 3.1 | - | 确认 Skill 模型是否有 category, techStack 字段 |
| 3.2 | src/services/skill-matcher.ts（新建） | matchSkillsByCategory 函数 |
| 3.3 | src/services/skill-files.ts | copySkillsByIds 函数（按 ID 列表拷贝） |
| 3.4 | src/app/api/projects/[id]/start/route.ts | 按 WorkflowNode 加载 Skills |

### 阶段 4：前端

**目的**：支持节点配置

| 任务 | 文件 | 改动 |
|------|------|------|
| 4.1 | src/components/workflow/node-editor.tsx | 支持三种模式的配置 |
| 4.2 | src/components/workflow/vulnerability-category-select.tsx（新建） | 漏洞类别选择器 |
| 4.3 | src/components/workflow/skill-selector.tsx（新建） | Skills 多选器 |

---

## 七、数据流完整性验证

### 7.1 Skill 模型字段确认 ✅

**文件**：`prisma/schema.prisma` 第 717-769 行

```
model Skill {
  id          String   @id
  category    String      ← 漏洞分类（已存在）
  techStack   String?     ← 适用语言 JSON 数组（已存在）
  isActive    Boolean     ← 是否激活
  isLatest    Boolean     ← 是否最新版本
  ...
}
```

**结论**：Skill 模型已有 `category` 和 `techStack` 字段，阶段 3 的匹配逻辑可直接使用。

---

### 7.2 完整数据流追踪

#### 阶段 1：配置修复

| 改动 | 输入 | 来源 | 输出 | 去处 | 状态 |
|------|------|------|------|------|------|
| 1.1 allowedTools 增加 "Skill" | - | 硬编码 | allowedTools 列表 | Claude SDK | ✅ 可执行 |
| 1.2 settingSources: ['project'] | - | 硬编码 | settingSources 配置 | Claude SDK | ✅ 可执行 |

#### 阶段 2：数据模型

| 改动 | 输入 | 来源 | 输出 | 去处 | 状态 |
|------|------|------|------|------|------|
| 2.1 vulnerabilityCategory 字段 | - | 新增字段 | schema.prisma | 数据库 | ✅ 可执行 |
| 2.2 skills 字段 | - | 新增字段 | schema.prisma | 数据库 | ✅ 可执行 |
| 2.3 前端保存 | 用户输入 | 前端表单 | WorkflowNode 表 | 数据库 | ✅ 可执行 |

#### 阶段 3：匹配逻辑

| 改动 | 输入 | 来源 | 输出 | 去处 | 状态 |
|------|------|------|------|------|------|
| 3.1 matchSkillsByCategory | vulnerabilityCategory, techStack | WorkflowNode, Project | Skill ID 列表 | 调用方 | ✅ 可执行 |
| 3.2 copySkillsByIds | Skill ID 列表 | matchSkillsByCategory | .claude/skills/ 目录 | 磁盘 | ✅ 可执行 |
| 3.3 start/route.ts 改造 | WorkflowNode, Project | 数据库 | Skill ID 列表 | copySkillsByIds | ✅ 可执行 |

#### 阶段 4：前端

| 改动 | 输入 | 来源 | 输出 | 去处 | 状态 |
|------|------|------|------|------|------|
| 4.1 节点编辑器 | 用户操作 | 前端交互 | vulnerabilityCategory/skills | API 请求 | ✅ 可执行 |
| 4.2 漏洞类别选择 | 预设列表 | 硬编码 | 选中的 category | 表单字段 | ✅ 可执行 |
| 4.3 Skills 多选 | Skill 列表 | /api/skills | 选中的 skill IDs | 表单字段 | ✅ 可执行 |

---

### 7.3 三种模式的数据流

#### 模式 1：自定义描述

```
WorkflowNode.data = "整理报告"
WorkflowNode.vulnerabilityCategory = NULL
WorkflowNode.skills = NULL
    ↓
不加载任何 Skills
    ↓
Agent 只执行任务描述中的内容
```

#### 模式 2：手工指定

```
WorkflowNode.data = "SQL 注入扫描"
WorkflowNode.skills = '["skill-1", "skill-2"]'
    ↓
解析 JSON → ["skill-1", "skill-2"]
    ↓
copySkillsByIds(["skill-1", "skill-2"])
    ↓
加载指定的 Skills
```

#### 模式 3：漏洞类别自动匹配

```
WorkflowNode.data = "SQL 注入扫描"
WorkflowNode.vulnerabilityCategory = "sql-injection"
Project.techStack = '["typescript"]'
    ↓
matchSkillsByCategory("sql-injection", ["typescript"])
    ↓
查询数据库:
  WHERE category = "sql-injection"
  AND isActive = true
  AND isLatest = true
  AND (techStack IS NULL OR techStack CONTAINS "typescript")
    ↓
返回: ["skill-3", "skill-4", "skill-5"]
    ↓
copySkillsByIds(["skill-3", "skill-4", "skill-5"])
    ↓
加载匹配的 Skills
```

---

### 7.4 数据来源与去处汇总

| 数据 | 来源 | 去处 |
|------|------|------|
| **vulnerabilityCategory** | 用户在前端选择 → API → 数据库 | start/route.ts 读取 → matchSkillsByCategory |
| **skills（手工指定）** | 用户在前端多选 → API → 数据库 | start/route.ts 读取 → copySkillsByIds |
| **Project.techStack** | 项目设置 → 数据库 | start/route.ts 读取 → matchSkillsByCategory |
| **Skill.category** | Skill 定义 → 数据库 | matchSkillsByCategory 查询条件 |
| **Skill.techStack** | Skill 定义 → 数据库 | matchSkillsByCategory 查询条件 |
| **Skill ID 列表** | matchSkillsByCategory 返回 | copySkillsByIds 参数 |
| **Skills 文件** | data/skills/ 磁盘 | copySkillsByIds 拷贝 → .claude/skills/ |
| **allowedTools** | 代码配置 | Claude SDK 参数 |
| **settingSources** | 代码配置 | Claude SDK 参数 |

---

### 7.5 验证结论

**所有数据的输入输出都有明确的来源和去处，方案可行。**

### 阶段 1：配置修复

- [x] 1.1 claude-agent.ts - allowedTools 增加 "Skill"
- [x] 1.2 start/route.ts - settingSources: ['project']
- [x] 1.3 agent-executor.ts - allowedTools 增加 "Skill"
- [x] 1.4 ai-executor.ts - allowedTools 增加 "Skill"
- [x] 1.5 验证：Skills 能被 SDK 加载

### 阶段 2：数据模型

- [x] 2.1 schema.prisma - WorkflowNode 增加 vulnerabilityCategory
- [x] 2.2 schema.prisma - WorkflowNode 增加 skills
- [x] 2.3 数据库迁移
- [x] 2.4 types/workflow.ts - 更新接口

### 阶段 3：匹配逻辑

- [x] 3.1 确认 Skill 模型字段（category, techStack）
- [x] 3.2 新建 skill-matcher.ts
- [x] 3.3 skill-files.ts - copySkillsByIds
- [x] 3.4 start/route.ts - 改造加载逻辑

### 阶段 4：前端

- [x] 4.1 node-editor.tsx - 三种模式配置
- [x] 4.2 vulnerability-category-select.tsx - 漏洞类别选择器
- [x] 4.3 skill-selector.tsx - Skills 多选器

### Final 验证

- [x] F1. 自定义描述模式：不加载 Skills
- [x] F2. 手工指定模式：加载指定的 Skills
- [x] F3. 漏洞类别模式：实时匹配 Skills
- [x] F4. 新增 Skill 自动纳入扫描
