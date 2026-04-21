# 评估提示词生成需求文档

## 一、发送给大模型的内容

| 类型 | 来源 | 要求 |
|------|------|------|
| **系统提示词** | `globalConfig.customSystemPrompt` | 必填，为空则启动失败 |
| **用户提示词** | WorkflowNode 动态生成 | 必填，为空则启动失败 |

---

## 二、数据来源与去处

### 2.1 系统提示词
| 项目 | 说明 |
|------|------|
| **来源** | `OpencodeConfig.customSystemPrompt`（数据库） |
| **去处** | `sdkOptions.systemPrompt` → Claude SDK |
| **必填检查** | 为空返回 400 错误 |

### 2.2 用户提示词
| 项目 | 说明 |
|------|------|
| **来源** | `WorkflowNode` 三种模式动态生成 |
| **去处** | `initialMessage` → `agent.loop({ context: { initialMessage } })` |
| **必填检查** | 为空返回 400 错误 |

### 2.3 WorkflowNode 数据来源

| 字段 | 来源 | 用途 |
|------|------|------|
| `data` | `WorkflowNode.data`（数据库） | 节点描述（JSON 字符串，需解析） |
| `data.label` | 前端编辑器输入 | 节点名称 |
| `data.description` | 前端编辑器输入 | **用户提示词来源** |
| `data.skills` | 前端编辑器选择 | 模式2：手工指定的 Skill IDs（JSON 数组） |
| `data.vulnerabilityCategories` | 前端编辑器选择 | 模式3：漏洞分类（JSON 数组） |

**NodeData 结构定义**（`src/types/workflow.ts`）：
```typescript
interface NodeData {
  label: string;              // 节点名称
  description?: string;       // 节点描述 ← 用户提示词来源
  skillLoadingMode?: 'description' | 'manual' | 'vulnerability';
  vulnerabilityCategories?: string[];  // 模式3
  skills?: string;  // 模式2：JSON 数组字符串
}
```

### 2.4 Skill 信息来源

| 数据 | 来源 |
|------|------|
| Skill ID 列表 | 模式2从 `skills` 字段解析，模式3从数据库查询 |
| Skill 名称/描述 | `Skill` 表（`name`, `displayName`, `description`） |
| 技术栈过滤 | `Project.techStack` → `matchSkillsByCategoryValues()` |

---

## 三、用户提示词生成逻辑

### 3.1 数据输入

```
输入：WorkflowNode[]（从数据库查询）
  ↓
每个节点的 data 字段（JSON 字符串）解析为 NodeData 对象
  ↓
NodeData {
  label: string;           // 节点名称
  description?: string;    // 节点描述 ← 用户提示词来源
  skills?: string;         // 模式2：Skill IDs（JSON 数组字符串）
  vulnerabilityCategories?: string[];  // 模式3：漏洞分类
}
```

### 3.2 模式判断

| 条件 | 模式 |
|------|------|
| `skills` 有值 | 模式2：手工指定 |
| `vulnerabilityCategories` 有值 | 模式3：漏洞类别 |
| 两者都为空 | 模式1：自定义描述 |

### 3.3 各模式生成逻辑

#### 模式1：自定义描述
- **条件**：`skills` 为空 且 `vulnerabilityCategories` 为空
- **输入**：`node.data.description`
- **输出**：
```
[node.data.description 内容]
```

#### 模式2：手工指定 Skills
- **条件**：`skills` 有值
- **输入**：
  - `node.data.description`
  - `node.data.skills` → 解析为 Skill ID 数组
- **加工**：查询数据库获取 Skills 信息
- **输出**：
```
[node.data.description 内容]

请执行以下安全检查任务，必须执行所有指定的 Skills：

必须执行的 Skills：
1. [Skill.displayName] - [Skill.description]
2. [Skill.displayName] - [Skill.description]
...

请确保以上所有 Skills 都被执行，不要遗漏。
```

#### 模式3：漏洞类别
- **条件**：`vulnerabilityCategories` 有值
- **输入**：
  - `node.data.description`
  - `node.data.vulnerabilityCategories`
  - `project.techStack`
- **加工**：调用 `matchSkillsByCategoryValues(categories, techStack)` 查询匹配的 Skills
- **输出**：
```
[node.data.description 内容]

请执行以下安全检查任务，必须执行所有匹配的 Skills：

必须执行的 Skills：
1. [Skill.displayName] - [Skill.description]
2. [Skill.displayName] - [Skill.description]
...

请确保以上所有 Skills 都被执行，不要遗漏。
```

---

## 四、多个节点的处理

**规则**：所有节点描述拼接，一个节点就是一个 Agent 任务

### 处理流程

```
输入：WorkflowNode[]（多个节点）
  ↓
遍历每个节点，生成各自的描述
  ↓
拼接所有节点的描述
  ↓
输出：完整的用户提示词
```

### 示例

```
节点1（模式1）: "整理项目结构"
节点2（模式2）: "SQL注入扫描" + Skills列表
节点3（模式3）: "XSS扫描" + Skills列表
  ↓
拼接后：
"## 任务 1：整理项目结构
整理项目结构

---

## 任务 2：SQL注入扫描
SQL注入扫描
必须执行的 Skills：
1. SQL注入检测 - 检测SQL注入漏洞

---

## 任务 3：XSS扫描
XSS扫描
必须执行的 Skills：
1. XSS检测 - 检测XSS漏洞
"
```

---

## 五、存储方案

| 内容 | 存储位置 | 格式 |
|------|----------|------|
| 分析报告 | **数据库** | `AnalysisReport` 表 |
| Skill 执行记录 | **文件** | `workspace/skill-execution-log-{startedAt}.json` |

### 4.1 分析报告（数据库）
| 字段 | 来源 | 说明 |
|------|------|------|
| `evaluationId` | 当前评估 ID | 关联评估会话 |
| `projectId` | 当前项目 ID | 关联项目 |
| `projectName` | 大模型输出 | 项目名称 |
| `description` | 大模型输出 | 项目描述 |
| `techStack` | 大模型输出 | 技术栈数组 |
| `architectureSummary` | 大模型输出 | 架构摘要 |
| `apiEndpoints` | 大模型输出 | API 入口点 |
| `authSummary` | 大模型输出 | 认证鉴权摘要 |
| ... | ... | 其他字段 |

### 4.2 Skill 执行记录文件

**路径**：`{project.projectPath}/workspace/skill-execution-log.json`

**内容**：
```json
{
  "evaluationId": "eval-xxx",
  "projectId": "proj-xxx",
  "startedAt": "2026-04-19T12:05:30.000Z",
  "skills": [
    {
      "id": "skill-1",
      "name": "sql-injection",
      "displayName": "SQL 注入检测",
      "description": "检测 SQL 注入漏洞",
      "status": "pending",
      "startedAt": null,
      "completedAt": null,
      "findingsCount": 0
    }
  ]
}
```

---

## 六、代码修改清单

### 6.1 必填检查（当前代码位置：第 270-296 行）
- [x] 检查 `customSystemPrompt` 是否存在
- [ ] ~~检查 `workflowConfig.startNodeDescription`~~ **需修改**：改为从 WorkflowNode 动态生成

### 6.2 用户提示词生成（需修改）
- [ ] 遍历所有 WorkflowNode
- [ ] 每个节点根据三种模式生成描述
- [ ] 拼接所有节点的描述
- [ ] 模式1：从 `node.data` 解析描述
- [ ] 模式2：`node.data` + 查询 Skills 信息
- [ ] 模式3：`node.data` + 匹配 Skills 信息

### 6.3 Skill 执行记录文件（需新增）
- [ ] 启动时创建 `workspace/skill-execution-log.json`
- [ ] 写入 Skills 清单（状态为 pending）

---

## 七、现有代码已实现的功能

| 功能 | 状态 | 代码位置 |
|------|------|----------|
| 系统提示词必填检查 | ✅ 已实现 | 第 271-275 行 |
| 用户提示词从 `workflowConfig.startNodeDescription` | ❌ 需修改 | 第 277-296 行 |
| 三种模式的 Skills 拷贝 | ✅ 已实现 | 第 455-506 行 |
| Skills 使用说明追加到系统提示词 | ✅ 已实现 | 第 607-616 行 |
| 评估报告分析要求追加 | ✅ 已实现 | 第 619-622 行 |
| 分析报告存储到数据库 | ✅ 已实现 | `createEmptyAnalysisReport()` |
| Skill 执行记录文件 | ❌ 未实现 | - |

---

## 八、错误提示

| 场景 | 错误信息 |
|------|----------|
| 系统提示词为空 | `系统配置缺少系统提示词（customSystemPrompt），无法启动评估` |
| WorkflowNode 不存在 | `工作流配置缺少节点，无法启动评估` |
| 用户提示词为空 | `工作流节点缺少描述，无法启动评估` |
