# AgentFlow 可视化编排编辑器设计

## 目标

在平台新增独立菜单"AgentFlow 编排"，提供拖拽式可视化编辑器，让用户无需手写 Python DSL 即可构建 AgentFlow pipeline。发布后自动生成 `pipeline.py`、上传 Gitea、创建 AgentApp，与现有"我的任务"流程无缝衔接。

---

## 第一部分：整体架构

### 数据模型

新增 `AgentFlowPipeline` 表：

```prisma
model AgentFlowPipeline {
  id          String    @id @default(cuid())
  name        String
  nodes       Json      // 画布节点数据（ReactFlow node[]）
  edges       Json      // 画布边数据（ReactFlow edge[]）
  status      String    @default("draft")  // draft | published
  agentAppId  String?   // 发布后关联的 AgentApp
  tenantId    String?
  isPublic    Boolean   @default(false)
  userId      String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  AgentApp    AgentApp? @relation(fields: [agentAppId], references: [id])
  Tenant      Tenant?   @relation(fields: [tenantId], references: [id])
  User        User      @relation(fields: [userId], references: [id])
}
```

### 发布流程

```
画布 JSON
  → agentflow-codegen.ts 生成 pipeline.py
  → 上传到 Gitea（{appId}/pipeline.py）
  → 创建/更新 AgentApp（engine=agentflow, startCommand="agentflow run pipeline.py"）
  → 更新 AgentFlowPipeline.agentAppId + status=published
```

---

## 第二部分：编辑器画布

### 节点类型（左侧面板）

| 类型 | 对应 AgentFlow | 颜色 |
|------|---------------|------|
| codex | 内置 agent | #3B82F6（蓝） |
| claude | 内置 agent | #F97316（橙） |
| kimi | 内置 agent | #10B981（绿） |
| opencode | 内置 agent | #EF4444（红） |
| pi | 内置 agent | #8B5CF6（紫） |
| python_node | 内置 agent | #06B6D4（青） |
| shell | 内置 agent | #9CA3AF（灰） |
| sync | 内置 agent | #EAB308（黄） |
| 自定义 agent | `agent("name", ...)` | #7C3AED（深紫） |
| fanout | 并行扇出 | #06B6D4（青） |
| merge | 汇聚 | #F59E0B（琥珀） |
| evolve | 进化 | #EC4899（粉） |

### 边类型

- **普通依赖边**（`>>`）：蓝色实线，带箭头
- **失败回退边**（`.on_failure >>`）：红色虚线，右键菜单切换

---

## 第三部分：节点属性面板

### 通用属性（所有 agent 节点）

| 属性 | 类型 | 说明 |
|------|------|------|
| `task_id` | 文本输入 | 必填，自动生成默认值 |
| `prompt` | 多行文本 | 必填 |
| `model` | 下拉选择 | 从平台 `/api/models` 拉取 ModelConfig |
| `tools` | 下拉选择 | `read_only` / `read_write` / `none` |
| `skills` | 多选 | 从平台 `/api/skills` 拉取 Skill（显示 displayName） |
| `mcps` | 多选 | 从平台 `/api/mcp-servers` 拉取 McpServerConfig（显示 name） |
| `capture` | 下拉选择 | `final` / `streaming` / `none` |
| `timeout_seconds` | 数字输入 | 默认 1800 |
| `retries` | 数字输入 | 默认 0 |
| `run_policy` | 下拉选择 | `on_success` / `always` |

> Skills、MCP、模型均从平台已有资源选择，不允许用户自行输入。

### 各类型专属属性

| 节点类型 | 额外属性 |
|---------|---------|
| `python_node` | `code`（多行，替代 prompt） |
| `shell` | `script`（多行，替代 prompt） |
| `sync` | `mode`（下拉：wait / signal） |
| 自定义 agent | `agent_name`（文本输入） |
| `fanout` | `count`（数字）或 `values`（JSON 数组） |
| `merge` | 无额外属性，自动汇聚上游 fanout |
| `evolve` | 无额外属性 |

---

## 第四部分：Python DSL 生成（agentflow-codegen.ts）

### 生成示例

```python
from agentflow import Graph, codex, claude, agent, fanout

with Graph("my-pipeline") as g:
    plan = codex(
        task_id="plan",
        prompt="Draft an implementation plan.",
        model="gpt-4o",
        tools="read_only",
        timeout_seconds=1800,
    )
    review = claude(
        task_id="review",
        prompt="Review the plan.",
    )
    fix = agent("custom-agent",
        task_id="fix",
        prompt="Fix issues found.",
    )
    parallel_check = fanout(codex(
        task_id="parallel_check",
        prompt="Check item {{item}}.",
    ), count=3)

    plan >> review
    review.on_failure >> fix
    review >> parallel_check
```

### 关键映射规则

- 节点变量名 = `task_id`（去掉特殊字符，转 snake_case）
- `skills` → `skills=[...]` 参数（skill name 列表）
- `mcps` → `mcps=[...]` 参数（mcp name 列表）
- `model` → `model="..."` 参数（ModelConfig.name）
- fanout 节点 → 包裹内层 agent 调用
- `on_failure` 边 → `source.on_failure >> target`
- 普通边 → `source >> target`，链式合并（`a >> b >> c`）
- 只输出非默认值的参数，保持生成代码简洁

---

## 第五部分：页面结构

### 列表页 `/dashboard/agentflow-pipelines`

表格列：名称 | 节点数 | 状态（draft/published）| 关联 AgentApp | 更新时间 | 操作（编辑/发布/删除）

### 编辑器页 `/dashboard/agentflow-pipelines/[id]`

```
┌─────────────────────────────────────────────────────┐
│  顶栏：pipeline 名称（可编辑）| 保存草稿 | 发布     │
├──────────┬──────────────────────────┬───────────────┤
│ 节点面板 │      ReactFlow 画布      │  属性配置面板 │
│ (左侧)   │      (中间，占主体)      │  (右侧，点击  │
│ 拖拽节点 │                          │   节点后展开) │
└──────────┴──────────────────────────┴───────────────┘
```

### 数据流

1. 加载：`GET /api/agentflow-pipelines/[id]` → `{ nodes, edges, name, status }`
2. 保存草稿：`PUT /api/agentflow-pipelines/[id]` → 存画布 JSON
3. 发布：`POST /api/agentflow-pipelines/[id]/publish` → 生成 py + Gitea + AgentApp
4. 属性面板：并发加载 `/api/models`、`/api/skills`、`/api/mcp-servers`，缓存在编辑器 state，不每次点击节点都请求

---

## 新增文件清单

| 文件 | 说明 |
|------|------|
| `prisma/schema.prisma` | 新增 `AgentFlowPipeline` 表 |
| `src/app/api/agentflow-pipelines/route.ts` | 列表 CRUD（GET/POST） |
| `src/app/api/agentflow-pipelines/[id]/route.ts` | 单条 CRUD（GET/PUT/DELETE） |
| `src/app/api/agentflow-pipelines/[id]/publish/route.ts` | 发布接口（POST） |
| `src/lib/agentflow-codegen.ts` | 画布 JSON → Python DSL |
| `src/app/dashboard/agentflow-pipelines/page.tsx` | 列表页 |
| `src/app/dashboard/agentflow-pipelines/[id]/page.tsx` | 编辑器页 |
| `src/components/agentflow-editor/NodePalette.tsx` | 节点面板 |
| `src/components/agentflow-editor/NodeConfigPanel.tsx` | 属性配置面板 |
| `src/components/agentflow-editor/AgentFlowNode.tsx` | 自定义节点组件 |
| `src/app/dashboard/layout.tsx` | 侧边栏新增菜单项 |

---

## 复用的现有资源

- `@xyflow/react` — 已安装，ReactFlow v12
- `src/components/agent-apps/PipelineGraphViewer.tsx` — 节点配色体系参考
- `src/lib/agentflow-parser.ts` — 节点类型常量（AGENT_FUNCS）
- `src/lib/gitea.ts` — `uploadFileToGitea()`
- `src/app/api/agent-apps/route.ts` — AgentApp 创建逻辑参考
- `src/components/ui/Modal.tsx` — 通用弹窗

---

## 验证方式

1. 打开"AgentFlow 编排"菜单 → 列表页正常加载
2. 新建 pipeline → 进入编辑器，左侧节点面板可拖拽
3. 拖入 codex 节点 → 右侧属性面板展开，model/skills/mcps 均为下拉选择
4. 连接两个节点 → 右键边可切换为 on_failure 类型
5. 点击"发布" → 自动创建 AgentApp，跳转到"Agent 应用开发"可看到新应用
6. 在"我的任务"选择该 AgentApp 启动任务 → 正常执行
