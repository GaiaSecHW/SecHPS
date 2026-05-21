# Simplified Graph Schema for Agent-Driven Vulnerability Hunting

## Design Motivation

完整的 CPG（Code Property Graph）对于 LLM/Agent 驱动的漏洞挖掘来说是过度设计。Agent 不需要遍历 AST 父子关系，它需要的是：

1. **Call Graph** — 函数间调用关系（定位攻击面、追踪跨函数污点）
2. **CFG** — 函数内控制流（理解分支路径、判断是否有校验）
3. **Data Flow** — 数据依赖（污点追踪的核心）

AST 层对 agent 来说是噪音：agent 看的是 `x = foo(user_input)` 这一行代码，不需要知道 `foo` 是 CallNode、`user_input` 是 IdentifierNode。

## Core Insight: Display vs Compute Separation

关键设计决策：**DDG 不放在 agent 的上下文里，而是作为确定性计算后端**。

Agent 读源码推理数据流 = 高 token 消耗 + 可能幻觉。Agent 查询 DDG 引擎 = 低 token 消耗 + 100% 精确。

```
┌─────────────────────────────────────────────┐
│  Display Layer (进 agent context window)      │
│                                              │
│  - Call Graph (函数间调用关系)                 │
│  - CFG (block-level 控制流)                   │
│  - Flow Summary (函数级数据流摘要)             │
│  - Source Code (按需加载)                     │
└──────────────────┬──────────────────────────┘
                   │ tool call / query
┌──────────────────▼──────────────────────────┐
│  Compute Layer (不进 context, 确定性引擎)      │
│                                              │
│  - DDG (statement-level 数据依赖边)           │
│  - Taint propagation query                   │
│  - Reachability / slice extraction           │
│  - Points-to / alias analysis                │
└─────────────────────────────────────────────┘
```

**两层的职责：**

| 层 | 内容 | 用途 |
|----|------|------|
| Display Layer | Function, BasicBlock, Statement, Call Graph, CFG, Flow Summary | Agent 上下文，用于推理和规划 |
| Compute Layer | DDG edges, Points-to, Alias info | 后端引擎，agent 通过 tool 查询，获取确定性答案 |

**Agent 工作流：**
1. 读 Call Graph + Flow Summary → 快速判断"从 entry point 能否到达 sink"
2. 读 CFG → 理解分支结构，判断是否有校验/sanitizer 在路径上
3. 调用 Compute Layer tool → 精确验证数据流可达性，获取完整污点路径
4. 读 Source Code → 对可疑路径做最终语义确认

## Display Layer: Node Types (4 types)

### Function

调用图的基本单元。

| Field | Type | Description |
|-------|------|-------------|
| id | int | Deterministic: hash(file + name + signature) |
| name | str | 函数名 |
| signature | str | 完整签名（含参数类型） |
| file | str | 所属文件路径 |
| line_start | int | 起始行 |
| line_end | int | 结束行 |
| return_type | str | 返回类型 |
| is_external | bool | 是否为外部/库函数（无源码） |
| tags | List[str] | 安全标注：source/sink/sanitizer 等 |
| flow_summary | List[FlowRule] | 函数级数据流摘要（见下文） |

#### Flow Summary

函数级数据流摘要，是 DDG 的预计算压缩。Agent 通过它快速判断跨函数污点传播，无需查询 Compute Layer。

```python
class FlowRule:
    source: str      # "param[0]" / "param[1]" / "global(g_buf)" / "return_of(callee)"
    sink: str        # "return" / "call(target, arg=N)" / "global(g_buf)"
    transforms: List[str]  # 经过的转换: ["sanitize", "encode", "copy"] 或空
```

示例：
```
Function(name="handle_request"):
  flow_summary:
    - param[0] → return                          # 参数0直接影响返回值
    - param[1] → call(sql_execute, arg=0)        # 参数1流向 sql_execute 的第一个参数
    - param[0] → global(g_session_buf)           # 参数0写入全局缓冲区
    - param[2] → call(log_write, arg=0)          # 参数2流向日志（低风险）
      transforms: ["format_string"]
```

### Parameter

函数参数，污点分析的入口点。

| Field | Type | Description |
|-------|------|-------------|
| id | int | Deterministic: hash(function_id + index) |
| name | str | 参数名 |
| type | str | 参数类型 |
| index | int | 参数位置（0-based） |
| function_id | int | 所属函数 |

### BasicBlock

CFG 的节点，包含一组顺序执行的语句。

| Field | Type | Description |
|-------|------|-------------|
| id | int | Deterministic: hash(function_id + index) |
| function_id | int | 所属函数 |
| index | int | 块在函数内的序号 |
| line_start | int | 起始行 |
| line_end | int | 结束行 |
| is_entry | bool | 是否为函数入口块 |
| is_exit | bool | 是否为函数出口块 |

### Statement

基本块内的单条语句，服务于 CFG 展示和 Compute Layer 的 DDG 计算。

| Field | Type | Description |
|-------|------|-------------|
| id | int | Deterministic: hash(file + line + code_hash) |
| block_id | int | 所属基本块 |
| code | str | 原始代码片段 |
| kind | StatementKind | call / assign / branch / return / other |
| line | int | 行号 |

## Display Layer: Edge Types (3 types)

### CALLS (Function → Function)

函数间调用关系，构成 call graph。

| Property | Type | Description |
|----------|------|-------------|
| call_site_line | int | 调用发生的行号 |
| is_indirect | bool | 是否为间接调用（函数指针/虚函数） |

### CFG (BasicBlock → BasicBlock)

函数内控制流，连接基本块。

| Property | Type | Description |
|----------|------|-------------|
| condition | str? | 分支条件："true" / "false" / null（无条件跳转） |

### CDG (BasicBlock → BasicBlock)

控制依赖，表示哪个分支决定了某个块是否执行。

无额外属性。

## Compute Layer: DDG Engine

DDG 不作为 agent 上下文的一部分，而是作为确定性计算后端，通过 tool call 暴露查询能力。

### 存储的数据

| 数据 | 粒度 | 用途 |
|------|------|------|
| DDG edges | Statement → Statement | 精确的 def-use 链 |
| defs/uses per statement | Statement 属性 | DDG 边的构建基础 |
| Points-to relations | Variable → Location | 指针别名分析（C/C++） |
| Global read/write | Function → Global | 跨函数共享状态追踪 |

### Agent 可调用的 Tool API

```python
# 1. 数据流可达性查询
query_data_flow(
    source="recv_request:param[0]",
    sink="sql_execute:arg[0]"
) -> {
    "reachable": true,
    "path": [
        "recv_request:param[0]",
        "parse_body:param[0]",
        "parse_body:return",
        "handle_query:local(query)",
        "sql_execute:arg[0]"
    ],
    "sanitizers_on_path": []
}

# 2. 前向污点传播（从 source 出发能到哪些 sink）
taint_forward(
    source="read_input:return",
    max_depth=5
) -> {
    "reachable_sinks": [
        {"sink": "exec_cmd:arg[0]", "path_length": 3},
        {"sink": "write_file:arg[1]", "path_length": 4}
    ]
}

# 3. 后向溯源（某个 sink 的数据从哪来）
taint_backward(
    sink="sql_execute:arg[0]",
    max_depth=5
) -> {
    "sources": [
        {"source": "http_handler:param[1]", "path_length": 2},
        {"source": "read_config:return", "path_length": 3}
    ]
}

# 4. 程序切片（提取与某变量相关的所有语句）
extract_slice(
    target="handle_request:line_42:var(query)",
    direction="backward"
) -> {
    "statements": [
        {"func": "handle_request", "line": 38, "code": "query = req.params['q']"},
        {"func": "handle_request", "line": 40, "code": "query = decode(query)"},
        {"func": "handle_request", "line": 42, "code": "db.execute(query)"}
    ]
}
```

### 为什么这样设计

| 对比 | Agent 读 DDG 边 | Agent 调用 DDG Tool |
|------|----------------|-------------------|
| Token 消耗 | 高（50+ 条边进 context） | 低（一问一答） |
| 准确性 | Agent 可能推理出错 | 确定性结果，不会幻觉 |
| 复杂查询 | Agent 需要自己做图遍历 | 引擎直接返回路径 |
| 跨函数分析 | 需要大量上下文 | 引擎内部处理，只返回结果 |

## Compared to Full CPG: What's Removed

| Removed Layer | Reason |
|---------------|--------|
| AST edges & hierarchy | Agent 不需要语法树结构，读 code 字段即可 |
| Fine-grained AST nodes (Identifier, Literal, Block, FieldIdentifier...) | 合并为 Statement，code 字段保留原始文本 |
| Type system (TypeNode, TypeRefNode, BindingNode, ClosureBinding) | 类型信息内联到 Parameter.type |
| Structural edges (CONTAINS, SOURCE_FILE, ARGUMENT, RECEIVER) | 用 function_id / block_id 外键替代 |
| AI/RAG nodes (Embedding, Insight, Vector) | 不属于图本身，agent 有自己的记忆机制 |
| Overlay nodes (Fuzzing, Trace) | 运行时信息，按需独立存储 |
| Complex ID generation (AST positional hash) | 简化为 file+line+signature 级别的哈希 |
| DDG edges in agent context | 移入 Compute Layer，通过 tool call 查询 |

## What's Transformed (not removed)

| Original | New Form | Rationale |
|----------|----------|-----------|
| Statement-level DDG | Compute Layer tool API | 确定性查询，省 token |
| DDG 跨函数部分 | Function.flow_summary | 预计算摘要，agent 快速判断 |
| Statement.defs/uses | Compute Layer 内部数据 | Agent 不需要直接看，引擎用于计算 |
| Global node | flow_summary 中的 global(...) 引用 | 不需要独立节点 |

## ID Generation (Simplified)

| Node | Hash Inputs | Stability |
|------|-------------|-----------|
| Function | file + name + signature | Cross-run stable |
| Parameter | function_id + index | Derived from Function |
| BasicBlock | function_id + block_index | Derived from Function |
| Statement | file + line + code_hash | Stable if source unchanged |
| Global | file + name | Cross-run stable |

All IDs: SHA-256 truncated to 63-bit positive int (same as current project).

## Security Annotations

不再使用独立的 TagNode。安全标注作为 Function 的 `tags` 属性：

```
Function.tags = ["source:network", "entry_point:http_handler", "sink:sql_exec", "sanitizer:escape_html"]
```

Agent 通过 tags 快速定位 source/sink/sanitizer，然后通过 Compute Layer 验证污点路径。

## Optional Extensions

根据目标场景按需添加：

| Extension | When Needed |
|-----------|-------------|
| File node | 需要按文件组织查询时 |
| Cross-boundary edges (IPC/RPC/SYSCALL) | 系统级漏洞挖掘 |
| INHERITS_FROM edge | OOP 虚函数分派分析 |

## Benefits for Agent Consumption

1. **Token efficient** — Display Layer 紧凑（call graph + CFG + flow summary），Compute Layer 按需查询不占 context
2. **Deterministic where it matters** — 数据流分析由引擎完成，不依赖 LLM 推理，零幻觉
3. **Semantic reasoning where LLM excels** — 控制流理解、sanitizer 有效性判断、漏洞可利用性评估交给 agent 读代码
4. **Build cost reduction** — Display Layer 构建简单（函数签名 + basic block 划分），Compute Layer 可增量构建
5. **Clear separation of concerns** — Agent 负责"该查什么"（策略），引擎负责"精确计算"（执行）
