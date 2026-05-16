# cpg_schema/analysis/traversal — Graph Traversal & Context Assembly

CPG 图遍历与上下文组装层。为 AI Passes 和外部 Agent 提供多维度的代码切片与上下文服务。所有 Navigator 基于惰性求值 (Lazy Evaluation)，通过 Storage DSL 延迟执行查询。

## 设计目标

作为对外提供丰富上下文的**代码切片服务层**，将底层图存储的拓扑查询能力封装为面向业务语义的 API。消费方包括：
1. **AI Passes** (SmartSummary, SecurityTagging 等) — 通过 `ContextLoader` 获取结构化上下文数据，用于 Prompt 组装
2. **Agent/LLM** — 通过 `ContextLoader` 的统一接口获取代码切片、调用链、架构骨架等信息
3. **Pipeline Coordinator** — 在主进程中利用 `ContextLoader` 访问图数据库生成 Prompt

## 模块文件总览

```
traversal/
  base.py           # BaseGraphNavigator — 所有 Navigator 的基类 (Layer Supertype)
  ast.py            # AstContextNavigator — AST 维度: 层级结构、代码上下文提取
  dataflow.py       # DataFlowNavigator — 数据流维度: Def-Use 链追踪与切片
  call.py           # CallGraphNavigator — 调用图维度: Caller/Callee 关系查询
  cfg.py            # ControlFlowNavigator — 控制流维度: 前驱/后继、可达性
  structure.py      # RepoStructureNavigator — 项目级: 目录树、文件依赖分析
  formatter.py      # ChainFormatter — 调用链格式化 (聚焦策略 + 多级展示)
  context.py        # ContextLoader — Facade, 统一上下文数据加载入口
  tag.py            # TagNavigator — 安全标签: 验证、增删查、批量操作
  __init__.py       # 公开导出: 8 个类
```

## 架构层次

```
┌─────────────────────────────────────────────────────────┐
│  AI Passes / Agent / Pipeline                           │
│  (消费方: 需要代码上下文来生成 Prompt 或做分析)            │
├─────────────────────────────────────────────────────────┤
│                    ContextLoader [Facade]                │
│    统一入口, 组合所有 Navigator + ChainFormatter          │
│    get_context_data(node, strategy) -> Dict              │
│    format_trace(trace_nodes, strategy) -> str            │
│    get_project_skeleton() -> str                         │
├─────────────────────────────────────────────────────────┤
│   ┌──────────┬──────────┬──────────┬──────────┬─────┐    │
│   │   AST    │ DataFlow │  Call    │   CFG    │ Tag │    │
│   │Navigator │Navigator │Navigator │Navigator │ Nav │    │
│   └────┬─────┴────┬─────┴────┬─────┴────┬─────┴──┬──┘    │
│        │          │          │          │                │
│   ┌────┴──────────┴──────────┴──────────┴─────┐         │
│   │  RepoStructureNavigator  │ ChainFormatter │         │
│   └──────────────────────────┴────────────────┘         │
├─────────────────────────────────────────────────────────┤
│              BaseGraphNavigator [Layer Supertype]        │
│   Safe Access / _get_neighbors / _find_ancestor / Batch │
├─────────────────────────────────────────────────────────┤
│              CPGStore.query (TraversalSourceProtocol)    │
│              Storage DSL (Lazy Evaluation)               │
└─────────────────────────────────────────────────────────┘
```

## 核心类详解

### BaseGraphNavigator (`base.py`)

所有 Navigator 的公共基类。封装对 `CPGStore` 的依赖，提供三类基础设施：

| 功能分组 | 方法 | 说明 |
|---------|------|------|
| **Safe Access** | `_get_node_attr(node, attr, default)` | 防御性属性访问，自动处理 snake_case↔camelCase 别名、`code` 字段的 `get_code()` 代理、`line_number` 的多别名兼容 |
| **Safe Access** | `_ensure_node_id(node)` | 接受 CPGNode 或 int，统一返回 int ID |
| **Graph Primitives** | `_get_neighbors(node, edge_type, direction)` → `Iterator[CPGNode]` | 单跳邻居查询，惰性返回。通过 Storage DSL 的 `in_()` / `out()` 实现 |
| **Graph Primitives** | `_get_neighbors_batch(nodes, edge_type, direction)` → `Dict[int, List[CPGNode]]` | 批量邻居查询，适用于需要聚合结果的场景 (如 Taint)。内部做 ID 收集 → 批量查询 → Hydration |
| **Graph Primitives** | `_find_ancestor(start, target_type, max_depth=20)` → `Optional[T]` | 沿 AST 向上查找特定类型祖先，使用 `repeat()` + `limit(1)` 优化 |

### AstContextNavigator (`ast.py`)

AST 维度导航，负责代码位置、层级结构查询与代码上下文提取。

| 方法 | 返回 | 说明 |
|------|------|------|
| `get_enclosing_method(node)` | `Optional[MethodNode]` | 向上查找所属方法 (via `_find_ancestor`) |
| `get_enclosing_file(node)` | `Optional[FileNode]` | 向上查找所属文件 (via DSL `.file()`) |
| `get_enclosing_type(node)` | `Optional[TypeDeclNode]` | 向上查找所属类型 (优先 DSL，fallback `_find_ancestor`) |
| `get_enclosing_namespace(node)` | `Optional[NamespaceBlockNode]` | 向上查找所属命名空间 |
| `get_methods_in_file(file)` | `Iterator[MethodNode]` | 文件内所有方法 (via `descendants`) |
| `get_methods_in_type(type_decl)` | `Iterator[MethodNode]` | 类型内所有方法 |
| `get_base_types(type_decl)` | `Iterator[TypeDeclNode]` | 基类列表 (via `INHERITS_FROM` 边) |
| `get_docstring(node)` | `Optional[str]` | 提取 Python docstring (heuristic: 检查引号包裹的 LITERAL 子节点) |
| `get_annotations(node)` | `List[str]` | 提取注解/装饰器 |
| `get_context_code(node, max_lines=50, window_strategy=True)` | `Optional[str]` | **核心方法**: 获取代码上下文窗口。策略: 先找 METHOD 容器，找不到则用 FILE。`window_strategy=True` 时以目标节点行号为中心截取窗口；`False` 时截取头部 N 行 |

**智能窗口算法** (`_extract_smart_window`): 以目标节点行号为中心，向前后各取 `max_lines/2` 行，处理行号偏移 (METHOD 容器内的相对行号)，超出范围时添加 `[N lines hidden]` 标记。

### DataFlowNavigator (`dataflow.py`)

数据流维度导航，负责 Def-Use 链追踪和数据流切片。

| 方法 | 返回 | 说明 |
|------|------|------|
| `get_definitions(node)` | `Iterator[CPGNode]` | 反向单跳: 查找 Reaching Definitions (DDG IN) |
| `get_usages(node)` | `Iterator[CPGNode]` | 正向单跳: 查找 Usages (DDG OUT) |
| `get_data_slice(node, direction="IN", max_depth=5)` | `str` | **核心方法**: 生成数据流切片文本 |

**数据流切片算法** (`get_data_slice`):
1. 使用 `repeat(DDG)` 沿指定方向收集数据流节点 (支持 IN/OUT/BOTH)
2. **矢量化上下文补充**: 将所有数据流节点 ID 做一次批量查询，沿 AST 向上找控制结构 (CONTROL_STRUCTURE)，max_depth=3
3. 确保包含起始节点本身
4. 按行号排序、去重，用 `>>` 标记起始节点，输出格式: `Line NNN  | >> code`

### CallGraphNavigator (`call.py`)

调用图维度导航，负责 Caller/Callee 关系查询。

| 方法 | 返回 | 说明 |
|------|------|------|
| `get_callers(method)` | `Iterator[CallNode]` | 直接调用者 (CALL IN) |
| `get_callees(method)` | `Iterator[MethodNode]` | 被调用方法: `descendants(CALL)` → `out(CALL, MethodNode)` → `distinct()` |
| `get_recursive_callers(method, max_depth=5)` | `Iterator[MethodNode]` | **核心方法**: 递归向上查找调用方。惰性 BFS (deque)，yield-per-discovery，自带环路检测 (visited set) |

### ControlFlowNavigator (`cfg.py`)

控制流维度导航，查询语句执行顺序。

| 方法 | 返回 | 说明 |
|------|------|------|
| `get_predecessors(node)` | `Iterator[CPGNode]` | 前驱节点 (CFG IN) |
| `get_successors(node)` | `Iterator[CPGNode]` | 后继节点 (CFG OUT) |
| `is_reachable(start, end, max_steps=100)` | `bool` | CFG 结构可达性检查。使用 `repeat(CFG, OUT)` + `filter(id=end_id)` + `limit(1)` 实现短路求值 |

### RepoStructureNavigator (`structure.py`)

项目级结构导航，生成目录树和文件依赖分析。

| 方法 | 返回 | 说明 |
|------|------|------|
| `generate_repo_skeleton(max_depth=5, ignore_dirs, style)` | `str` | 生成项目树状结构。流式处理 FILE 节点 → 内存字典树 → DFS 渲染。支持 `ascii`/`markdown`/`indent` 三种风格 |
| `get_module_dependencies(file_node)` | `List[str]` | 文件依赖分析 (带缓存)。路径: `descendants(CALL)` → `out(CALL, MethodNode)` → `file()` → `distinct()` |

**树状结构渲染**: 渲染时会深入到文件内部，展示 `class` 和 `def` 级别的结构信息。

### ChainFormatter (`formatter.py`)

调用链格式化器，作为 Pipeline 的终结节点 (Terminal Operation)。

**聚焦策略** (`FocusStrategy`):
| 策略 | 行为 |
|------|------|
| `SINK` | 聚焦最后一个节点 (展示 FULL Code)，默认 |
| `SOURCE` | 聚焦第一个节点 |
| `ENDS` | 聚焦首尾两个节点 (哑铃模式) |
| `ALL` | 全部展开 (慎用，仅限短链) |
| Custom Index | 通过 `focus_index` 参数指定 |

**展示等级** (`ContextLevel`):
| 等级 | 内容 | 适用场景 |
|------|------|---------|
| `FULL` | 完整代码 (max 100 lines) | 焦点节点 |
| `HEAD` | AI Summary (优先) 或 前 10 行代码 | 焦点节点的邻居 |
| `SIGNATURE` | 仅函数签名 | 其余节点 |

**核心算法** (`_calculate_levels`): 焦点节点设为 FULL，其前后各一个邻居设为 HEAD，其余为 SIGNATURE。输出格式包含 `[FOCUS]` 标记和 `▼ (calls)` 连接符。

### ContextLoader (`context.py`)

**Facade 模式**。统一上下文数据加载入口，组合所有 Navigator 和 ChainFormatter。

**构造**: 接受 `CPGStore`，内部实例化所有 Navigator：
```python
self.ast = AstContextNavigator(store)
self.dataflow = DataFlowNavigator(store)
self.call = CallGraphNavigator(store)
self.cfg = ControlFlowNavigator(store)
self.structure = RepoStructureNavigator(store)
self.formatter = ChainFormatter(self.ast, self.dataflow)
```

**主入口** `get_context_data(node, strategy)` → `Dict[str, Any]`:

| 策略 | 输出字段 | 数据来源 |
|------|---------|---------|
| `PRECISE_SLICE` | `code` (切片文本), `insights` (安全 Insight), `similar_vulnerabilities` | DDG repeat → 控制结构补充 → CodeSlicer 重组; Embedding 向量搜索相似方法 |
| `SUMMARY` | `code` (窗口), `architecture` (文件/模块摘要), `existing_summary`, `callees` | AST 代码窗口; 文件→目录的摘要; CONTAINS→CALL 边获取 callee |
| `HIERARCHY` | `class_info` (name, base_types, methods) | AST 向上找 TypeDecl → 基类 + 内部方法 |

**辅助方法**:
| 方法 | 说明 |
|------|------|
| `get_project_skeleton()` | 委托 `RepoStructureNavigator.generate_repo_skeleton()` |
| `format_trace(trace_nodes, strategy, focus_index)` | 委托 `ChainFormatter.format_call_chain()` |

### TagNavigator (`tag.py`)

安全标签业务逻辑层。CLI `tag` 命令和 `/cpg-tag` Skill 的后端。**唯一执行写操作的 Navigator** (通过 `CPGStore.tags` 写入)。

| 方法 | 返回 | 说明 |
|------|------|------|
| `validate_tag(tag)` | `Tuple[str, Optional[str]]` | 验证+规范化 tag (自动 uppercase，`^[A-Z][A-Z0-9_]*$`)，返回 (normalized, warning) |
| `add_tag(node, tag)` | `TagResult` | 单节点加标签 (幂等: 重复添加返回 `already_exists`) |
| `remove_tag(node, tag)` | `TagResult` | 单节点删标签 (不存在返回 `not_found`) |
| `list_tags(node)` | `List[str]` | 获取节点所有标签 |
| `find_by_tag(tag, limit=50)` | `List[CPGNode]` | 按标签查找节点 |
| `bulk_tag(pattern, tag, node_type="method")` | `List[TagResult]` | 按名称模式批量打标签 |

**已知前缀** (`_KNOWN_PREFIXES`): `SOURCE`, `SINK`, `SANITIZER`, `SUPPRESSED`, `REVIEWED`, `CUSTOM` — 使用这些前缀时发出 warning 提示推荐格式，但不阻止。

## 关键外部依赖

| 依赖 | 来自 | 用途 |
|------|------|------|
| `CPGStore` | `cpg_schema.infra.storage.store` | 图存储门面，提供 `query` (TraversalSourceProtocol) |
| `CPGNode`, `MethodNode`, `FileNode` 等 | `cpg_schema.core.schema` | 节点类型 |
| `EdgeType`, `NodeLabel` | `cpg_schema.core.schema.enums` | 边类型和节点标签枚举 |
| `CodeSlicer` | `cpg_schema.analysis.utils.code_cleaner` | 将离散 AST 节点重组为按行号排序、去重、带 `>>` 高亮的代码切片文本 |

## 被谁消费

| 消费方 | 引用方式 | 用途 |
|--------|---------|------|
| `AI Pass 基类` (`analysis/passes/ai/base.py`) | `self.context_loader = ContextLoader(self.store)` | 所有 AI Pass 共享的上下文加载器 |
| `SmartGraphResolver` | `context_loader.dataflow.get_definitions()` | 解析宏/类型时获取 Def-Use 链 |
| `SecurityTagging` / `SmartMacro` | `ContextStrategy.PRECISE_SLICE` / `SUMMARY` | 获取结构化上下文 |
| `SemanticPass` | `context_loader.ast.get_methods_in_file()` | 获取文件内方法列表 |
| `Pipeline Coordinator` | via AI Pass | 主进程中利用 ContextLoader 生成 Prompt |
| `CLI tag command` (`cli/commands/tag.py`) | `TagNavigator(store)` | `/cpg-tag` Skill 的 CLI 后端 |

## 设计模式

| 模式 | 位置 | 目的 |
|------|------|------|
| **Layer Supertype** | `BaseGraphNavigator` | 抽取公共图操作到基类 |
| **Facade** | `ContextLoader` | 统一入口，屏蔽多维度 Navigator 复杂性 |
| **Strategy** | `FocusStrategy`, `ContextStrategy` | 可插拔的上下文组装策略和调用链聚焦策略 |
| **Iterator/Lazy** | 所有 Navigator 返回 `Iterator` | 延迟求值，按需加载，减少内存占用 |
| **Template Method** | `ChainFormatter._calculate_levels` → `_render_node` | 先计算等级再逐节点渲染 |
| **Cache** | `RepoStructureNavigator._deps_cache` | 文件依赖结果缓存 |

## 测试

```
tests/analysis/traversal/
  test_navigator.py         # AST / Call / DataFlow / CFG Navigator + ContextLoader 集成测试
  test_struct_navigator.py  # RepoStructureNavigator 单元测试 (树渲染、依赖分析)
  test_tag_navigator.py     # TagNavigator 单元测试 (验证、增删查、批量、幂等性)
```

## 当前局限性与未来改进方向

1. **切片维度单一**: `PRECISE_SLICE` 仅组合 DDG + 控制结构，缺少 PDG (程序依赖图) 切片、thin slice、跨过程切片等高级切片模式
2. **CodeSlicer 重组质量有限**: 基于行号去重的简单策略，无法处理多语句同一行、宏展开后的行号错位等场景
3. **Formatter 硬编码 Python 语法**: `_render_node` 中使用 ` ```python ` 代码块，不适配 C/C++ 等其他语言
4. **缺少跨过程数据流切片**: `_collect_slice_nodes` 仅沿 DDG 边遍历，不跨过程追踪 (需要结合 CallGraph + DDG)
5. **缺少 Insight 聚合视图**: SECURITY 类别硬编码在 `_enrich_slice_data`，缺乏灵活的 category 参数传递
6. **向量搜索相似漏洞的 top_k=10 硬编码**: 不支持外部配置或按场景调整
7. **缺少程序切片准则 (Slicing Criterion) 的抽象**: 当前切片起点固定为单个节点，未来应支持多起点、条件切片等

## Agent Rules

修改 traversal 模块时的注意事项：
- **添加新 Navigator**: 继承 `BaseGraphNavigator`，返回 `Iterator` 优先于 `List`，在 `ContextLoader.__init__` 中注册，在 `__init__.py` 中导出
- **添加新 ContextStrategy**: 在 `ContextStrategy` 枚举中添加值，在 `ContextLoader.get_context_data` 中添加 elif 分支，实现对应的 `_enrich_*_data` 方法
- **添加新 FocusStrategy**: 在 `FocusStrategy` 枚举中添加值，在 `ChainFormatter._calculate_levels` 中添加分支
- **修改切片逻辑**: 注意 `_collect_slice_nodes` 返回 `Set[CPGNode]`，依赖节点的 `__hash__` 和 `__eq__` (基于 id)
- **性能注意**: `_get_neighbors_batch` 中 `by_ids().to_list()` 会完全物化，大量节点时可能成为内存瓶颈
- 修改后更新此 CLAUDE.md
