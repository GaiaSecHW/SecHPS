# cpg_schema/analysis/passes — Analysis Pass Layer

基于 AST 的图增强分析层。Parser 产出 AST 后，Passes 在其上逐步构建 CFG、DDG、CDG、Call Graph、PDG、Points-to 等高级图结构。

## Module Map

```
passes/
  __init__.py               # 空
  manager.py                # PassManager — DAG 调度器 (Stream + Batch 双模式)
  base_stream.py            # StreamPass — 流式 Pass 基类 (内存, 单文件)
  base_batch.py             # BaseBatchPass — 批量 Pass 基类 (DB, 全局, 多进程)
  analysis_data.py          # PtsConstraint, ConstraintType — Points-to 约束定义

  stream/                   # 流式 Pass (Worker 内存, 单文件粒度)
    cfg.py                  # CFGPass — 控制流图 (最复杂)
    ddg.py                  # DataFlowPass — 数据依赖图 (Reaching Definitions)
    cdg.py                  # CDGPass — 控制依赖图 (Post-Dominator)
    local_ref.py            # LocalRefPass — 局部变量引用解析 (Scope Stack)
    local_points_to.py      # LocalPointsToPass — 局部指针约束生成
    macro_normalization.py  # MacroNormalizationPass — 宏循环识别 + AST Surgery

  batch/                    # 批量 Pass (DB 读写, 全局, 多进程并行)
    linker.py               # LinkerPass — 全局符号链接 (USR/Mangled/Alias/Static/Global)
    call_graph.py           # CallGraphPass — 调用图构建
    global_ref.py           # GlobalRefPass — 全局引用解析 (Member/TypeDecl)
    pdg.py                  # PDGPass — 过程间数据依赖图
    global_points_to.py     # GlobalPointsToPass — Anderson 指针分析求解器

  ai/                       # AI 增强 Pass (LLM-powered, ThreadPool)
    base.py                 # AIEnhancedPass — AI Pass 基类 (DiskMap 缓存 + ThreadPool)
    smart_summary.py        # 方法摘要生成
    smart_module_summary.py # 模块级摘要
    smart_type_inference.py # 类型推断
    smart_dataflow_tagging.py # 数据流安全标注 (Source/Sink/Sanitizer)
    smart_resolver.py       # AI 辅助符号解析
    smart_macro.py          # AI 辅助宏识别
    vuln_verification.py    # 漏洞验证
    semantic.py             # 语义嵌入

  utils/                    # 工具类
    scope.py                # ScopeManager — 嵌套作用域变量查找
    # disk_map.py moved to infra/storage/disk_map.py (Phase 20.6)
```

## 执行架构: Two-Phase Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│                  Phase 1: Stream (Per-File)                    │
│                                                                │
│  Worker Process 内存中, 单个 CPGGraph                          │
│                                                                │
│  Parser → [MacroNorm] → [CFG] → [DDG] → [CDG]               │
│           → [LocalRef] → [LocalPointsTo]                      │
│                                                                │
│  结果: 增强后的 CPGGraph → 写入 Storage                       │
├──────────────────────────────────────────────────────────────┤
│                  Phase 2: Batch (Global)                       │
│                                                                │
│  所有文件解析完毕后, 基于 Storage 全局数据                    │
│  DAG 调度 (Kahn 拓扑排序):                                    │
│                                                                │
│  [Linker] → [CallGraph] → [GlobalRef] → [PDG]               │
│                    └──→ [GlobalPointsTo]                       │
│                                                                │
│  AI Passes (可选, Subset 模式):                               │
│  [SmartSummary] [TypeInference] [DataflowTagging] [VulnVerify]│
└──────────────────────────────────────────────────────────────┘
```

## PassManager (manager.py)

### 职责

1. 注册 Pass (Stream + Batch 统一接口)
2. Stream Mode: 在 Worker 内存中顺序执行 StreamPass 链
3. Batch Mode: DAG 拓扑排序 → 顺序执行 BatchPass → 状态管理
4. Subset 模式: 仅运行指定 Pass (用于 AI 增强或调试)

### 关键接口

| 方法 | 用途 |
|---|---|
| `register(pass_cls, dependencies, enabled, **kwargs)` | 统一注册 (自动区分 Stream/Batch) |
| `run_stream(graph, strategy)` | 对单文件 CPGGraph 执行所有 StreamPass |
| `run_all(force_rerun)` | 执行全量 BatchPass (DAG 调度) |
| `run_subset(target_classes, force_rerun)` | 仅执行指定 BatchPass 子集 |

### 执行生命周期 (Batch)

```
for each BatchPass in topological_order:
  1. 检查 PipelineStateManager → 已完成则跳过
  2. 实例化 Pass (延迟实例化)
  3. instance.prune()     → Clean-Before-Write (删除上一次产生的边)
  4. instance.run()       → 核心分析逻辑
  5. mark_completed()     → 状态持久化
  6. instance.cleanup()   → 释放 DiskMap 等资源
```

## StreamPass 基类 (base_stream.py)

### 设计

- **运行环境**: Worker 进程内存
- **输入/输出**: CPGGraph (in-memory, mutable)
- **限制**: **禁止访问数据库或跨文件查询**

### Template Method

```python
run_on_graph(graph, strategy)
  ├── 空图检查 → 直接返回
  ├── SKELETON 策略检查 → skip_on_skeleton=True 时跳过
  ├── analyze(graph)    → [Hook] 子类实现
  └── except → logger.error (Fail-Safe, 不中断)
```

### Stream Pass 一览

| Pass | 输入依赖 | 产出边类型 | 算法 |
|---|---|---|---|
| MacroNormalizationPass | AST | AST (Surgery) | Registry 白名单 + 结构启发式 |
| CFGPass | AST | CFG | Recursive Descent + LoopContext Stack |
| DataFlowPass (DDG) | AST + CFG | DDG | Reaching Definitions (Worklist) |
| CDGPass | AST + CFG | CDG | Post-Dominator Frontier |
| LocalRefPass | AST | REF | Scope Stack (嵌套作用域查找) |
| LocalPointsToPass | AST + REF | 无 (写入 DiskMap) | 约束生成 (ADDR_OF/COPY/LOAD/STORE) |

## BaseBatchPass 基类 (base_batch.py)

### 设计

- **运行环境**: Master 进程 + Worker Pool
- **数据访问**: CPGStore (DB 读写)
- **并行模型**: ProcessPoolExecutor (规避 GIL)
- **核心工具**: DiskMap (SQLite KV, Worker 间共享), BatchWriterContext (批量写入)

### 三阶段流程

```
Phase 1: index_state()  → DiskMap 索引构建 (Master 端, 流式写入)
Phase 2: run_parallel()  → 并行分析 (Worker 读 DiskMap, 产出 Edge/Update)
Phase 3: BatchWriterContext → 批量写入 Store (Master 端, 5000 条/batch)
```

### Worker 架构

```
Master Process                         Worker Processes
────────────────                       ─────────────────
DiskMap (SQLite WAL)  ←─── read ───→  WorkerGlobalState._disk_map
                                       (只读, 进程级单例)

task_generator() ──→ Runner.execute() ──→ worker_handler(task)
                                              │
                                              ├── DiskMap.get() / get_batch()
                                              └── return BatchAnalysisResult
                                                    (new_edges, node_updates, metrics)

BatchWriterContext ←── new_edges ──── results_iter
  └── store.add_edges_batch()
```

### Prune (Clean-Before-Write)

每个 BatchPass 可声明 `prune_targets` (EdgeType 列表)。PassManager 在 `run()` 前自动调用 `prune()`，通过 GraphPatch 删除该 Pass (`created_by=self.name`) 上次产生的边。确保幂等重跑。

### BatchWriterContext

自动注入 `created_by` 到每条边，支持:
- `add_edge_tuple(src, dst, type_str, props)` — 单条边
- `add_raw_results(edges, updates)` — Worker 结果批量写入
- `flush()` — 批量提交到 Store (5000 条阈值自动触发)
- Context Manager: `__exit__` 自动 flush

## Stream Passes 详解

### CFGPass (cfg.py) — 最复杂的 Stream Pass

**核心类**: CFGProcessor (每个 MethodNode 一个实例)

**算法**: Recursive Descent, 返回 `(entry, exits)` 元组

```
visit(node) → (entry_node, exit_node_list)
  - entry: 该结构的 CFG 入口节点
  - exits: 该结构的所有 CFG 出口节点列表
  - 上层将 exits → next_entry 连边
```

**控制结构处理**:

| 结构 | 策略 | 关键逻辑 |
|---|---|---|
| Block | 顺序链接 children | exits[i] → entry[i+1] |
| IF | cond → TRUE/FALSE 分支 | order=1(cond), 2(true), 3(false) |
| WHILE | cond → body → back edge | LoopContext(pre_resolved=cond_entry) |
| DO-WHILE | body → cond → back edge | LoopContext(延迟绑定 continue) |
| FOR | init → cond → body → update → back | 含 Body/Update 错位修复 |
| SWITCH | cond → case/default labels | 嵌套在外层 LoopContext 中 |
| BREAK | exits=[] | 加入 ctx.break_exits |
| CONTINUE | 直连或延迟 | resolved → 直连; unresolved → ctx.continue_sources |
| GOTO/LABEL | 延迟解析 | _pending_gotos + _label_map 后处理 |
| RETURN | → MethodReturn | exits=[] (流终止) |

**特殊处理**:
- `<operator>.conditional` (三元) → TRUE/FALSE 双分支
- `<operator>.logicalAnd/Or` → 短路求值分支
- Macro Loop (`metadata.semantic_type == "LOOP"`) → While-like 拓扑
- AST 环检测 (`_visited` set)

### DataFlowPass / DDG (ddg.py)

**算法**: Reaching Definitions (Worklist-based)

```
1. collect_nodes_recursive(method) — AST DFS 收集所有节点
2. gen_map: node_id → {defined_var_ids}
   - Assignment LHS (Identifier)
   - &arg 取地址调用的参数
3. kill_map: node_id → {被杀死的 def_node_ids}
4. solve_reaching_definitions() — 迭代求不动点
   - IN[n] = ∪ OUT[p] for p ∈ pred(n)
   - OUT[n] = GEN[n] ∪ (IN[n] - KILL[n])
5. 构建 DDG 边:
   - Use-Def Chain: def_node → use_node (variable=var.name)
   - Structural: RHS → LHS (assignment)
   - Return: child → MethodReturn (variable="RET")
   - Taint: memcpy/memmove src → dst (variable="TAINT_PROPAGATION")
```

### CDGPass (cdg.py)

**算法**: Post-Dominator Frontier

```
1. 收集 Method 内所有 AST 节点 + CFG 边
2. PostDominatorTree.build_from_edges() — 构建后支配树
3. calculate_control_dependence() — 计算 CDG 关系
4. 语义回溯: CFG 节点 → AST ControlStructureNode/短路操作符
5. Entry Dependence: 未被控制的 CFG 可达节点 → Method 入口
```

### LocalRefPass (local_ref.py)

**算法**: Scope Stack (嵌套作用域)

```
1. 遍历 Method AST
2. BlockNode/ControlStructure → enter_scope / exit_scope
3. LocalNode → _is_valid_local_declaration() → add_declaration
4. IdentifierNode → scope_manager.resolve(name)
   - 找到 → add_ref_edge(identifier, definition)
   - 未找到 → 留给 Linker/GlobalRef
```

**防御检查**: `_is_valid_local_declaration` 验证 `astParentType` 不是 FILE/NAMESPACE (防止全局变量误入局部作用域)

### LocalPointsToPass (local_points_to.py)

**算法**: 约束生成 (不求解，留给 GlobalPointsToPass)

仅扫描 `Operators.assignment` 类型的 CallNode:

| 模式 | 约束类型 | 说明 |
|---|---|---|
| `x = &y` | ADDR_OF(src=y, dst=x) | 取地址 |
| `x = malloc()` | ADDR_OF(src=alloc_site, dst=x) | 分配 |
| `x = y` | COPY(src=y, dst=x) | 拷贝 |
| `x = *y` | LOAD(src=y, dst=x) | 解引用读 |
| `*x = y` | STORE(src=y, dst=x) | 解引用写 |
| `*x = &y` | ADDR_OF + STORE (via phantom) | 复合 |
| `*x = *y` | LOAD + STORE (via phantom) | 复合 |

**Phantom Temporary**: 复合操作通过负数 ID (`-abs(call_id)`) 的临时变量拆解。

**Allocator 识别**: 内置 54 个分配器名称 (C stdlib, GLib, Linux Kernel, C++)。

### MacroNormalizationPass (macro_normalization.py)

**三级识别策略**:
1. **Registry 白名单**: `MacroRegistry.is_loop(name)` → 确认为循环
2. **结构启发式**: Trailing Block + 内含 Break/Continue → 标记 suspicious_macro
3. **AST Surgery**: 将分离的 Body Block 从兄弟节点重新挂载为宏 CallNode 的子节点

## Batch Passes 详解

### LinkerPass (linker.py) — 全局符号链接

**Phase 1**: 构建 DiskMap 索引 (定义 → NodeID)

| Prefix | Key 格式 | 来源节点 | 匹配优先级 |
|---|---|---|---|
| `U:` | U:{usr} | METHOD, TYPE_DECL, MEMBER, LOCAL | 1 (最高) |
| `M:` | M:{mangled_name} | METHOD | 2 |
| `A:` | A:{alias_name} | METHOD | 3 |
| `S:` | S:{file}:{name} | Static 变量/函数 | 4 |
| `G:` | G:{name} | 全局可见符号 | 5 (最低) |

**Phase 2**: 并行解析引用节点 (CALL, IDENTIFIER, TYPE_REF)

Worker 按优先级尝试匹配: USR → Mangled → Alias → Static → Global

**产出**: REF 边 (IDENTIFIER → 定义), CALL 边 (CALL → METHOD), INHERITS_FROM 边 (TYPE_DECL → TYPE_DECL)

### CallGraphPass (call_graph.py) — 调用图

**索引分类** (利用 `astParentType` 区分):
- `F:` — Method fullName (最强)
- `SD:` — Static Definition (全局/命名空间函数)
- `MD:` — Member Definition (类成员方法)

Worker 根据匹配类型智能设置 `dispatchType`:
- 匹配到 SD → STATIC_DISPATCH
- 匹配到 MD 且原值非 STATIC → DYNAMIC_DISPATCH

### GlobalRefPass (global_ref.py) — 全局引用

仅处理 **未被 LocalRefPass 链接** 的 Identifier (`where_no_out_edge(REF)`)。

索引 MEMBER 和 TYPE_DECL，匹配策略: Static (`S:file:name`) > Global (`G:name`)。

### PDGPass (pdg.py) — 过程间数据依赖

**不使用 DiskMap 索引**，直接通过 `store.get_neighbor_nodes_batch()` 批量 IO。

核心逻辑:
1. 批量获取 Call → Method (CALL 边)
2. 预加载 Method 接口 (Params + Return) 和 Call 参数
3. Arg[i] → Param[i] (DDG, variable=`arg_i`)
4. 如果 Points-to 显示参数是指针 → Param[i] → Arg[i] (反向副作用边)
5. MethodReturn → Call (DDG, variable="RET")

### GlobalPointsToPass (global_points_to.py)

**Anderson's Inclusion-Based Analysis**:

```
Phase 1: Parallel Constraint Scan
  ├── assignment_worker — 扫描赋值: ADDR_OF/COPY/LOAD/STORE → 写入 DiskSets
  └── call_scan_worker — 扫描调用: Arg→Param COPY 约束

Phase 2: Solve Loop (Master 单线程)
  ├── Initialize Worklist from pts DB
  ├── while worklist:
  │     for var_id in worklist:
  │       pts = pts[var_id]
  │       Rule 1 (COPY): x=y → pts(target) ∪= pts(var_id)
  │       Rule 2 (LOAD): x=*var → new COPY edge o→x for o∈pts
  │       Rule 3 (STORE): *var=y → new COPY edge y→o for o∈pts
  │     Dynamic Dispatch Resolution (间接调用解析)
  │     LRU Cache clear
  └── Max 100 iterations

Phase 3: Save Results
  └── pts(src) → tgt → POINTS_TO 边 (过滤负数 phantom ID)
```

**DiskSet**: 4 个 SQLite DB 文件 (`pts.db`, `copy.db`, `load.db`, `store.db`)

## AI Passes (ai/)

基于 `AIEnhancedPass[T, R]` 基类:
- 继承 BaseBatchPass，兼容 PassManager
- 内置 ThreadPoolRunner (IO 密集型 LLM 请求)
- DiskMap 缓存: Prompt Hash → Result (断点续传)
- 批量 GraphPatch 提交

| Pass | 功能 |
|---|---|
| SmartSummary | 方法级摘要 (LLM) |
| SmartModuleSummary | 模块级摘要 |
| SmartTypeInference | 类型推断 |
| SecurityTaggingPass | Source/Sink/Sanitizer 标注 |
| SmartGraphResolver | AI 辅助符号解析 |
| SmartMacro | AI 辅助宏识别 |

## Utils

### DiskMap (disk_map.py)

SQLite-backed Key-Value Store:
- WAL mode (支持并发读)
- `bulk_set(generator)` — 流式批量写入
- `get(key)` / `get_batch(keys)` — 单条/批量查询
- Worker 通过 `existing_db_path` 只读连接 Master 创建的 DB

### DiskSet

基于 DiskMap 的 1:N 关系存储:
- `add(key, value)` — 添加到集合
- `get(key) → Set[int]` — 获取集合
- `update(key, new_set) → bool` — 合并集合 (返回是否有变化)
- `batch_update()` context manager — 事务写入

### ScopeManager (scope.py)

嵌套作用域管理:
- `enter_scope(node, name)` / `exit_scope()` — 压栈/出栈
- `add_declaration(name, node)` — 注册变量到当前作用域
- `resolve(name)` — 从内到外查找 (Shadowing)

## 数据流: Edge 类型产出映射

| Edge Type | 产出 Pass | 说明 |
|---|---|---|
| CFG | CFGPass (stream) | 控制流 (含 TRUE/FALSE/BACK/GOTO 标签) |
| DDG | DataFlowPass (stream) + PDGPass (batch) | 数据依赖 (variable 属性) |
| CDG | CDGPass (stream) | 控制依赖 |
| REF | LocalRefPass (stream) + LinkerPass + GlobalRefPass (batch) | 引用 (Identifier → 定义) |
| CALL | LinkerPass + CallGraphPass (batch) | 调用关系 |
| INHERITS_FROM | LinkerPass (batch) | 继承关系 |
| POINTS_TO | GlobalPointsToPass (batch) | 指针指向 |
| AST | MacroNormalizationPass (Surgery) | 宏循环 Body 重挂 |

## Known Issues & Tech Debt

1. **CFGPass FOR 循环错位修复** — 依赖启发式 (BlockNode vs 非 BlockNode) 判断 Body/Update 错位，可能误判
2. **DDG Taint Propagation 基于名称匹配** — `"cpy" in name` 匹配过于粗糙，可能误标
3. **CDG _resolve_semantic_controller 深度限制 50** — 硬编码，极深嵌套可能截断
4. **LocalRefPass handle_CallNode 跳过 fieldAccess 的子节点** — 只 visit children[0] (base)，children[1] (field_name) 不会被解析
5. **GlobalPointsToPass _resolve_indirect_calls** — 逐条创建 BatchWriterContext，性能差
6. **PDGPass 不使用 BaseBatchPass.run_parallel()** — 自行管理 Runner，绕过了 DiskMap state 检查
7. **BatchWriterContext update_nodes_properties** — 使用 `label="ANY"` 硬编码
8. **AI Passes 忽略 Manager 传入的 ProcessPoolRunner** — 内部使用 ThreadPoolRunner，参数冗余
9. **MacroNormalizationPass metadata bug** — `node.metadata["semantic_type"] = "LOOP"` 在 CFG 阶段可能看不到 (TODO 注释)
10. **DiskMap 生命周期管理** — 多处使用 `__enter__()` 但不在 `with` 中，依赖 `cleanup()` 手动关闭

## 依赖关系 (建议注册顺序)

```
Stream (在 Worker 内顺序执行):
  MacroNormalizationPass → CFGPass → DataFlowPass → CDGPass → LocalRefPass → LocalPointsToPass

Batch (DAG 调度):
  LinkerPass
    → CallGraphPass [depends: LinkerPass]
    → GlobalRefPass [depends: LinkerPass]
  PDGPass [depends: CallGraphPass]
  GlobalPointsToPass [depends: LinkerPass, CallGraphPass]

AI (Subset 模式):
  SmartSummary, SmartTypeInference, SecurityTaggingPass... [depends: varies]
```

## 改造指南

### 新增 Stream Pass

```python
class MyPass(StreamPass):
    @property
    def skip_on_skeleton(self) -> bool:
        return True  # SKELETON 模式下跳过

    def analyze(self, graph: CPGGraph):
        methods = [n for n in graph.nodes.values() if isinstance(n, MethodNode)]
        for method in methods:
            # 分析逻辑...
            graph.add_edge(src, dst, EdgeType.MY_EDGE)
```

### 新增 Batch Pass

```python
class MyBatchPass(BaseBatchPass):
    def __init__(self, store, runner, config=None):
        super().__init__(store, runner, config)
        self.prune_targets = [EdgeType.MY_EDGE]  # 声明清理目标

    def run(self):
        # Phase 1: 构建索引
        self.state_map = DiskMap(...)
        self.state_map.__enter__()
        self.state_map.bulk_set(self._index_generator())

        # Phase 2: 并行分析
        self.run_parallel(
            task_generator=self._gen_tasks(),
            worker_handler=my_worker_func,
            total_items=N
        )
        self.cleanup()
```

### 关键改造点

- 新增 Edge 类型 → 在 `EdgeType` 枚举中添加，并在对应 Pass 中产出
- 修改 CFG 逻辑 → `CFGProcessor._dispatch_map` 和对应 handler
- 修改 DDG 的 def/use 判定 → `_get_defined_variables_robust` / `_get_used_variables`
- 修改 Linker 匹配策略 → `linker_worker` 中的 Strategy 优先级链
- 优化 Points-to 性能 → `_solve_loop` 中 LRU cache 大小、batch 策略

## Agent Rules

1. **Stream Pass 禁止访问 DB** — 只能操作 CPGGraph 内存对象
2. **Batch Pass 的 Worker 函数必须是顶层函数** — ProcessPool 要求可 pickle
3. **Worker 访问 DiskMap 只读** — Master 端写入，Worker 通过 `existing_db_path` 只读连接
4. **prune_targets 必须与 Pass 产出的 Edge 类型匹配** — 否则重跑时旧数据不会被清理
5. **created_by 溯源** — 所有通过 BatchWriterContext 写入的边都会自动注入 `created_by=pass.name`
6. **修改 Stream Pass 执行顺序需同步检查依赖** — 例如 DDG 依赖 CFG，CDG 依赖 CFG
7. **GlobalPointsToPass 的 DiskSet 文件名是硬编码约定** — `pts.db`, `copy.db`, `load.db`, `store.db`，PDGPass 也依赖这些文件名
