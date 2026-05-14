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
| fanout | 并行扇出 | #06B6D4（青，带"⊕"图标） |
| merge | 汇聚 | #F59E0B（琥珀，带"⊗"图标） |
| evolve | 进化 | #EC4899（粉） |

### fanout / merge 节点的特殊语义

**fanout** 节点在编辑器中是**单一节点**，同时承载"扇出包装器"和"内嵌 agent"两层含义：
- 属性面板中同时显示内嵌 agent 类型（下拉选择）、agent 属性（prompt/model/tools 等）和扇出参数（count 或 values）
- 生成代码时：`var = fanout(inner_type(task_id=..., prompt=...), count=N)`
- 画布上显示为带"⊕ fanout"标签的节点，颜色取内嵌 agent 类型的颜色，边框加青色描边

**merge** 节点同理：
- 属性面板显示内嵌 agent 类型和 agent 属性，无额外参数
- 生成代码时：`var = merge(inner_type(task_id=..., prompt=...), source_node, by=[...])`

**evolve** 节点语义特殊：它不是独立执行节点，而是"对某个已有节点做进化优化"：
- 画布上通过**普通入边**连接到被优化的源节点（可多个）
- 属性面板只配置 `target`（被优化的 agent 类型，默认 `codex`）和 `optimizer`（执行优化的 agent 类型，默认 `codex`）
- 生成代码时：`var = evolve([source_var1, source_var2], target="codex", optimizer="codex")`
- 入边的源节点变量列表作为第一个位置参数传入
- 画布上显示为粉色节点，带"⚡ evolve"标签

### 边类型

- **普通依赖边**（`>>`）：蓝色实线，带箭头
- **失败回退边**（`.on_failure >>`）：红色虚线，右键边 → 菜单"切换为失败回退边"/"切换为普通边"

---

## 第三部分：节点属性面板

### 通用属性（所有 agent 节点）

| 属性 | 类型 | 说明 |
|------|------|------|
| `task_id` | 文本输入 | 必填，自动生成默认值 |
| `prompt` | 多行文本 | 必填（python/shell/sync 用各自专属字段替代） |
| `model` | 下拉选择 | 从平台 `/api/models` 拉取 ModelConfig；python/shell/sync 不显示 |
| `tools` | 下拉选择 | `read_only` / `read_write`；python/shell/sync/kimi 不显示 |
| `skills` | 多选 | 从平台 `/api/skills` 拉取；sync 不显示 |
| `mcps` | 多选 | 从平台 `/api/mcp-servers` 拉取；**pi/python/shell/sync 不显示**（pi 不支持） |
| `capture` | 下拉选择 | `final` / `trace`（框架枚举值，无 streaming/none） |
| `timeout_seconds` | 数字输入 | 默认 1800，必须 > 0 |
| `retries` | 数字输入 | 默认 0 |

> Skills、MCP、模型均从平台已有资源选择，不允许用户自行输入。
> `run_policy` 不是框架 NodeSpec 字段，不提供此配置项。

### 各类型专属属性

| 节点类型 | 额外属性 | 说明 |
|---------|---------|------|
| `python_node` | `code`（多行，替代 prompt） | 框架内部 agent 名为 `python` |
| `shell` | `script`（多行，替代 prompt） | |
| `sync` | `mode`（下拉：`repo` / `full`） | `repo`=仅同步 .git，`full`=整个目录 |
| 自定义 agent | `agent_name`（文本输入） | 不能与内置 AgentKind 重名 |
| `fanout` | `inner_agent_type`（下拉）+ 所有通用属性 + `fanout_source`（三选一：count 数字 / values JSON 数组 / matrix JSON 对象） | source 是位置参数，见第七部分 |
| `merge` | `inner_agent_type`（下拉）+ 所有通用属性 + `merge_source_node`（选择被 reduce 的 fanout 源节点）+ `merge_by`（多选，候选项 = 所有入边上游，默认全选）或 `merge_size`（数字，与 merge_by 二选一） | |
| `evolve` | `evolve_target`（下拉，默认 `codex`）+ `evolve_optimizer`（下拉，默认 `codex`） | 通过入边连接源节点，入边源节点列表作为第一个位置参数；不需要 prompt/task_id |

---

## 第四部分：Python DSL 生成（agentflow-codegen.ts）

### 生成示例

```python
from agentflow import Graph, codex, claude, agent, fanout, merge

with Graph("my-pipeline") as g:
    plan = codex(
        task_id="plan",
        prompt="Draft an implementation plan.",
        model="gpt-4o",
        tools="read_only",
    )
    review = claude(
        task_id="review",
        prompt="Review the plan.",
    )
    fix = agent("custom-agent",
        task_id="fix",
        prompt="Fix issues found.",
    )
    # fanout 第二个参数是位置参数 source（int | list | dict）
    parallel_check = fanout(codex(
        task_id="parallel_check",
        prompt="Check item {{item}}.",
    ), 3)
    # merge 第二个参数是位置参数 source（被 reduce 的 fanout 源节点）
    summary = merge(claude(
        task_id="summary",
        prompt="Summarize all results.",
    ), parallel_check, by=["parallel_check"])

    plan >> review
    review.on_failure >> fix
    review >> parallel_check
    parallel_check >> summary
```

### 关键映射规则

- 节点变量名 = `task_id`（去掉特殊字符，转 snake_case）
- `python_node` 节点 → 生成 `python_node(task_id=..., code=...)` 调用，框架内部 agent 名为 `python`
- `sync` 的 `mode` 值 → `"repo"` 或 `"full"`（不是 wait/signal）
- `skills` → `skills=[...]` 参数（skill name 列表）
- `mcps` → `mcps=[...]` 参数（mcp name 列表）；pi 节点不输出此参数
- `model` → `model="..."` 参数（ModelConfig.name）；python/shell/sync 不输出
- `tools` → `tools="..."` 参数；python/shell/sync/kimi 不输出
- `capture` 枚举值只有 `"final"` 和 `"trace"`
- fanout 节点 → `fanout(inner_agent(...), source)` 其中 source 是位置参数
- merge 节点 → `merge(inner_agent(...), source_node, by=[...])` 其中 source_node 是位置参数
- evolve 节点 → `evolve(source_nodes, target="codex", optimizer="codex")`
- `on_failure` 边 → `source.on_failure >> target`（写入 source 的 `on_failure_restart`）
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

## 第六部分：TypeScript 类型定义

### 节点数据结构（存入 DB 的 `nodes` JSON）

```typescript
// 所有 agent 节点的通用数据
interface AgentFlowNodeData {
  // 节点类型（决定生成哪种 agent 调用）
  nodeType: 'codex' | 'claude' | 'kimi' | 'opencode' | 'pi'
          | 'python_node' | 'shell' | 'sync' | 'custom'
          | 'fanout' | 'merge' | 'evolve';

  // 通用属性
  taskId: string;                              // 必填，唯一
  prompt?: string;                             // python_node/shell/sync 用各自专属字段
  model?: string;                              // ModelConfig.name；python/shell/sync 无效
  tools?: 'read_only' | 'read_write';          // 框架只有这两个值；kimi/python/shell/sync 无效
  skills?: string[];                           // Skill.name[]；sync 无效
  mcps?: string[];                             // McpServerConfig.name[]；pi/python/shell/sync 无效
  capture?: 'final' | 'trace';                 // 框架枚举：final | trace（无 streaming/none）
  timeoutSeconds?: number;                     // 默认 1800，必须 > 0
  retries?: number;                            // 默认 0
  // run_policy 不是框架 NodeSpec 字段，不存储

  // python_node 专属（替代 prompt）
  code?: string;
  // shell 专属（替代 prompt）
  script?: string;
  // sync 专属（替代 prompt）；值为 "repo" | "full"
  mode?: 'repo' | 'full';

  // 自定义 agent 专属
  agentName?: string;                          // agent("name", ...) 的 name

  // fanout 专属（source 是位置参数，三选一）
  innerAgentType?: string;                     // fanout/merge 内嵌 agent 类型
  fanoutSourceCount?: number;                  // fanout(node, 3)
  fanoutSourceValues?: string[];               // fanout(node, ["a","b","c"])
  fanoutSourceMatrix?: Record<string, string[]>; // fanout(node, {k: [...]})

  // merge 专属
  mergeSourceNodeId?: string;                  // merge 第二个位置参数：被 reduce 的 fanout 源节点 taskId
  mergeBy?: string[];                          // merge(by=[...])，与 mergeSize 二选一
  mergeSize?: number;                          // merge(size=N)，与 mergeBy 二选一

  // evolve 专属
  // evolve 专属（源节点通过入边确定，不存储 sourceNodeIds，运行时从 edges 推导）
  evolveTarget?: string;                       // 默认 "codex"，被优化的 agent 类型
  evolveOptimizer?: string;                    // 默认 "codex"，执行优化的 agent 类型
  // 注意：evolve 节点没有 taskId/prompt，变量名在 codegen 时取 "evolve_{index}"
}

// 存入 DB 的完整节点（ReactFlow Node 格式）
interface AgentFlowNode {
  id: string;                                  // ReactFlow 节点 ID（= taskId）
  type: 'agentFlowNode';                       // 统一使用一种自定义节点类型
  position: { x: number; y: number };
  data: AgentFlowNodeData;
}

// 存入 DB 的边（ReactFlow Edge 格式）
interface AgentFlowEdge {
  id: string;
  source: string;                              // 源节点 ID
  target: string;                              // 目标节点 ID
  data?: { isFailure: boolean };               // true = on_failure 边
}
```

### 编辑器页面 State

```typescript
interface EditorPageState {
  pipelineId: string;
  pipelineName: string;
  status: 'draft' | 'published';
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  selectedNodeId: string | null;
  saveState: 'saved' | 'saving' | 'dirty';    // 顶栏显示
  // 预加载资源（页面初始化时并发请求，缓存在 state）
  availableModels: { name: string; displayName: string }[];
  availableSkills: { name: string; displayName: string }[];
  availableMcps: { name: string }[];
}
```

---

## 第七部分：agentflow-codegen.ts 详细算法

### 函数签名

```typescript
export function generatePipelinePy(
  name: string,
  nodes: AgentFlowNode[],
  edges: AgentFlowEdge[]
): string
```

### 生成步骤

**步骤 1：收集 import 符号**

扫描所有节点的 `nodeType`（以及 fanout/merge 节点的 `innerAgentType`），收集用到的内置 agent 类型。特殊节点单独处理：
- `fanout` → 加入 `fanout`
- `merge` → 加入 `merge`
- `evolve` → 加入 `evolve`
- `custom` → 加入 `agent`

```python
from agentflow import Graph, codex, claude, fanout, agent
```

**步骤 2：变量名映射**

`taskId` → Python 变量名规则：
- 替换非 `[a-zA-Z0-9_]` 字符为 `_`
- 首字符为数字时加 `n_` 前缀
- 与 Python 关键字冲突时加 `_` 后缀
- 重复时加 `_2`、`_3` 后缀

**步骤 3：拓扑排序节点**

基于普通边（非 failure）构建 DAG，拓扑排序决定代码中节点定义的顺序。循环依赖（仅 failure 边形成的环）不影响排序。

**步骤 4：生成节点赋值语句**

对每个节点按拓扑顺序生成：

```
普通 agent 节点：
  {var} = {nodeType}(
      task_id="{taskId}",
      {非默认属性...}
  )
  # python_node 用 code= 替代 prompt=，shell 用 script=，sync 用 mode=

fanout 节点（source 是第二个位置参数，不是关键字参数）：
  {var} = fanout({innerAgentType}(
      task_id="{taskId}",
      {非默认属性...}
  ), {fanoutSourceCount})                    # count 模式：整数
  # 或 ), ["{v1}", "{v2}"])                  # values 模式：列表
  # 或 ), {{"k": ["{v1}", "{v2}"]}})         # matrix 模式：dict

merge 节点（source 是第二个位置参数，指向 fanout 源节点变量）：
  {var} = merge({innerAgentType}(
      task_id="{taskId}",
      {非默认属性...}
  ), {mergeSourceVar},                       # 位置参数：fanout 源节点变量名
  by=["{mergeBy[0]}", ...])                  # 或 size={mergeSize}
  # mergeBy 直接取 data.mergeBy[]

evolve 节点（第一个参数是入边源节点变量列表，不是 task_id）：
  # 单个源节点：
  {var} = evolve({sourceVar},
      target="{evolveTarget}",
      optimizer="{evolveOptimizer}",
  )
  # 多个源节点（多条入边）：
  {var} = evolve([{sourceVar1}, {sourceVar2}],
      target="{evolveTarget}",
      optimizer="{evolveOptimizer}",
  )
  # evolve 节点本身不生成 task_id，变量名取 "evolve_{index}"

自定义 agent：
  {var} = agent("{agentName}",
      task_id="{taskId}",
      {非默认属性...}
  )
```

**默认值省略规则**（不输出到代码）：

| 属性 | 框架默认值 |
|------|--------|
| `tools` | `"read_only"`（注意：框架默认是 read_only，不是 none） |
| `capture` | `"final"` |
| `timeout_seconds` | `1800` |
| `retries` | `0` |
| `skills` | `[]` |
| `mcps` | `[]` |
| `evolveTarget` | `"codex"` |
| `evolveOptimizer` | `"codex"` |

**步骤 5：生成边语句**

分两组处理：

*普通边*（`>>`）：
1. 按 source 分组，得到 `source → [target1, target2, ...]`
2. 尝试链式合并：若 `a` 只有一个出边到 `b`，且 `b` 只有一个入边来自 `a`，则合并为 `a >> b >> c`
3. 多目标：`a >> [b, c]`
4. 多源单目标：`[a, b] >> c`

*失败边*（`.on_failure >>`）：
- 每条单独输出：`{source}.on_failure >> {target}`

**步骤 6：组装完整文件**

```python
from agentflow import Graph, {symbols}

with Graph("{name}") as g:
    {节点赋值，4 空格缩进}

    {边语句，4 空格缩进}
```

### 生成示例（对应画布：plan → review，review.on_failure → fix，review → [check_1, check_2]）

```python
from agentflow import Graph, codex, claude, fanout

with Graph("my-pipeline") as g:
    plan = codex(
        task_id="plan",
        prompt="Draft an implementation plan.",
        model="gpt-4o",
        tools="read_only",
    )
    review = claude(
        task_id="review",
        prompt="Review the plan.",
    )
    fix = codex(
        task_id="fix",
        prompt="Fix issues found.",
    )
    parallel_check = fanout(codex(
        task_id="parallel_check",
        prompt="Check item {{item}}.",
    ), 3)                                    # source 是位置参数，不是 count=

    plan >> review
    review.on_failure >> fix
    review >> parallel_check
```

---

## 第八部分：发布 API 详细流程

### `POST /api/agentflow-pipelines/[id]/publish`

**请求**：无 body，从 URL 取 pipeline id。

**执行步骤**：

```
1. 鉴权（authenticateRequestEnhanced）
2. 读取 AgentFlowPipeline（含 nodes, edges, name, agentAppId）
3. 校验：nodes 不为空，至少有一条边或一个节点
4. 调用 generatePipelinePy(name, nodes, edges) → pipelineSource
5. 确定 AgentApp：
   a. 若 agentAppId 已存在 → 查询确认 AgentApp 仍存在
   b. 若不存在 → 创建新 AgentApp：
      {
        name: pipeline.name,
        engine: "agentflow",
        startCommand: "agentflow run pipeline.py",
        userId, tenantId, isPublic: false
      }
6. 上传 pipeline.py 到 Gitea：
   uploadFileToGitea(appId, "pipeline.py", pipelineSource)
   - Gitea 未配置时：跳过上传，仍完成发布（本地模式）
   - GiteaAuthError：返回 500，提示检查 GITEA_TOKEN
7. 更新 AgentFlowPipeline：
   { agentAppId, status: "published", updatedAt: now }
8. 返回：{ agentAppId, agentAppName, giteaUrl? }
```

**错误处理**：

| 场景 | HTTP 状态 | 处理 |
|------|-----------|------|
| pipeline 不存在 | 404 | 直接返回 |
| nodes 为空 | 400 | 返回"画布为空，无法发布" |
| Gitea 认证失败 | 500 | 返回"Gitea Token 失效，请联系管理员" |
| AgentApp 创建失败 | 500 | 回滚：不更新 pipeline status |
| Gitea 上传失败（非认证） | 200 | 仍发布成功，response 中加 `giteaWarning` 字段 |

**回滚策略**：步骤 5b（创建 AgentApp）成功但步骤 6/7 失败时，删除刚创建的 AgentApp，保持 pipeline 为 draft 状态。

---

## 第九部分：编辑器交互细节

### 拖拽添加节点

1. 左侧面板节点卡片设置 `draggable` + `onDragStart` 携带 `nodeType`
2. 画布 `onDrop` 接收，调用 `screenToFlowPosition` 转换坐标
3. 自动生成 `taskId`：`{nodeType}_{timestamp后4位}`（如 `codex_3421`）
4. 新节点立即选中，右侧属性面板展开

### 节点选中与属性面板

- 点击节点 → `selectedNodeId` 更新 → 右侧面板渲染该节点的 `AgentFlowNodeData`
- 点击画布空白 → 取消选中，右侧面板收起（显示"点击节点编辑属性"提示）
- 属性面板修改 → 实时更新 `nodes` state → 触发 2 秒 debounce 自动保存

**merge 节点的 `merge_by` 多选框**：
- 候选项 = 当前节点所有入边的上游 taskId，实时从 `edges` state 计算
- 初始化（新建节点或新增入边）时默认全选
- 删除某条入边时，若该上游在 `mergeBy` 中，自动从列表移除
- 用户可手动取消勾选，缩小 merge 范围

### 边的右键菜单

ReactFlow `onEdgeContextMenu` 事件：
```
右键点击边 → 显示浮层菜单：
  ├── 切换为失败回退边（当前为普通边时）
  ├── 切换为普通边（当前为失败边时）
  └── 删除此边
```
切换后立即更新 `edges[].data.isFailure`，边颜色/样式实时变化。

### 自动保存

```
nodes/edges 变化
  → isDirty = true，顶栏显示"未保存"
  → 2 秒 debounce
  → PUT /api/agentflow-pipelines/[id]（静默，不打断操作）
  → 成功：isDirty = false，顶栏显示"已保存"
  → 失败：顶栏显示"保存失败，请手动保存"（红色）
```

### 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Delete` / `Backspace` | 删除选中节点或边 |
| `Ctrl+S` | 手动保存草稿 |
| `Ctrl+Z` | 撤销（ReactFlow 内置） |
| `Escape` | 取消选中 |

### 发布确认弹窗

点击"发布"按钮 → 弹出确认弹窗：
```
发布 Pipeline

将生成 pipeline.py 并上传到 Gitea，
同时创建/更新 AgentApp "{name}"。

[取消]  [确认发布]
```
发布中：按钮 loading 状态，禁止重复点击。
发布成功：Toast 提示"发布成功"，顶栏状态更新为"已发布"，显示"查看 AgentApp →"链接。

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
5. 拖入 merge 节点，连接两条入边 → 属性面板"汇聚来源"默认全选两个上游，可手动取消勾选
6. 取消勾选一个上游后点击"发布" → 生成的 pipeline.py 中 `by=[...]` 只包含勾选的 taskId
7. 点击"发布" → 自动创建 AgentApp，跳转到"Agent 应用开发"可看到新应用
8. 在"我的任务"选择该 AgentApp 启动任务 → 正常执行
