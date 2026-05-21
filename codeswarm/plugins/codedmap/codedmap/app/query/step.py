import re
from typing import List, Union, Any, Optional, Iterator, Set, Callable, Pattern

from codedmap.core.schema.graph.nodes import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.infra.storage.interfaces import TraversalInterface
from codedmap.infra.storage.store import CPGStore

# Taint Engine Integration
from codedmap.app.taint.core.engine import TaintEngine
from codedmap.app.taint.rules.config import TaintConfiguration
from codedmap.app.query.results import QueryResult

class QueryStep:
    """
    [DSL Core] 全功能图查询 DSL (Security Enhanced).

    Capabilities:
    1. Graph Traversal (AST, CFG, DDG, CALL)
    2. Filtering (Exact, Regex, Lambda)
    3. Set Operations (Union, Dedup)
    4. Taint Analysis Integration
    5. Context Slicing (slice_forward, slice_backward, slice_to, neighborhood, etc.)
    """
    def __init__(self, traversal: TraversalInterface, store: CPGStore):
        self._t = traversal
        self._store = store

    # --- Iterator & Basic Operations ---

    def __iter__(self) -> Iterator[CPGNode]:
        return iter(self._t)

    def run(self) -> QueryResult:
        """
        [Action] 执行查询并返回封装的结果对象。
        推荐使用此方法替代 to_list() 以获得更好的交互体验。
        """
        raw_list = self._t.to_list()
        return QueryResult(raw_list)

    def to_list(self) -> List[CPGNode]:
        return self._t.to_list()

    def first(self) -> Optional[CPGNode]:
        """获取第一个结果节点，如果为空返回 None"""
        nodes = self._t.to_list()
        return nodes[0] if nodes else None

    def count(self) -> int:
        return self._t.count()

    def page(self, offset: int = 0, limit: int = 50) -> 'PageResult':
        """Paginated query with total count and has_more flag."""
        from codedmap.app.query.models import PageResult
        total = self._t.count()
        ordered = self._t.order_by("id")
        items = ordered.skip(offset).limit(limit).to_list()
        return PageResult(items=items, total=total, offset=offset, limit=limit, has_more=(offset + limit < total))

    def dedup(self) -> 'QueryStep':
        """去重"""
        nodes = self.to_list()
        unique_nodes = {n.id: n for n in nodes}.values()
        return self._new_step_from_nodes(list(unique_nodes))

    def union(self, *others: 'QueryStep') -> 'QueryStep':
        """
        [Set Op] 并集操作。
        用法: cpg.method("a").union(cpg.method("b"))
        """
        current_nodes = self.to_list()
        for step in others:
            current_nodes.extend(step.to_list())

        # 去重并返回新 Step
        unique_nodes = {n.id: n for n in current_nodes}.values()
        return self._new_step_from_nodes(list(unique_nodes))

    # --- 1. 过滤与属性 (Filtering) ---

    def filter(self, **kwargs) -> 'QueryStep':
        """精确属性匹配: .filter(name="main", is_external=True)"""
        return QueryStep(self._t.filter(**kwargs), self._store)

    def limit(self, count: int) -> 'QueryStep':
        """限制结果数量: .limit(10)"""
        return QueryStep(self._t.limit(count), self._store)

    def file(self, pattern: str) -> 'QueryStep':
        """Filter by file name pattern: .file('main.c')"""
        return self.where(lambda n: pattern in getattr(n, 'fileName', '') or pattern in getattr(n, 'file_name', ''))

    def where(self, predicate: Callable[[CPGNode], bool]) -> 'QueryStep':
        """内存 Lambda 过滤: .where(lambda n: n.code.startswith("print"))"""
        filtered = [n for n in self._t if predicate(n)]
        return self._new_step_from_nodes(filtered)

    def name(self, value: str) -> 'QueryStep':
        """精确名称匹配"""
        return self.filter(name=value)

    def name_matches(self, regex: str) -> 'QueryStep':
        """
        [Regex] 名称正则匹配。
        用法: cpg.call().name_matches("exec.*")
        """
        pattern = re.compile(regex)
        return self.where(lambda n: bool(getattr(n, 'name', None) and pattern.match(n.name)))

    def code_contains(self, snippet: str) -> 'QueryStep':
        """代码片段包含匹配"""
        return self.where(lambda n: snippet in getattr(n, 'code', ''))

    def has_label(self, label: NodeLabel) -> 'QueryStep':
        """
        [Filter] Filter nodes by their label type.

        Args:
            label: NodeLabel enum to filter by (e.g., NodeLabel.MODULE, NodeLabel.METHOD)

        Returns:
            QueryStep with only nodes matching the specified label.

        Example:
            cpg.find_tag("ONTOLOGY:ROLE:*").has_label(NodeLabel.MODULE)
        """
        return self.where(lambda n: getattr(n, 'label', None) == label)

    def sort_by(self, key: str, reverse: bool = True) -> 'QueryStep':
        """
        Sort results by a key. For 'attack_surface', compute composite score.

        Args:
            key: Sort key. Special key 'attack_surface' computes composite score.
                 Other keys sort by node attribute.
            reverse: If True (default), sort descending; else ascending.

        Returns:
            New QueryStep with sorted nodes.

        Example:
            cpg.modules().sort_by('attack_surface').limit(10).to_list()
            cpg.modules().sort_by('name', reverse=False).to_list()
        """
        nodes = self.to_list()
        if not nodes:
            return self._empty_step()

        if key == 'attack_surface':
            # Compute composite attack surface score
            # Score = (density * 0.5) + (norm_ep * 0.3) + (norm_sink * 0.2)
            # Need to normalize ep_count and sink_count by max in set

            # Collect raw metric values
            metrics_list = []
            for node in nodes:
                density = getattr(node, 'density', None) or 0.0
                ep_count = getattr(node, 'entry_point_count', None) or 0
                sink_count = getattr(node, 'sink_count', None) or 0
                metrics_list.append((node, density, ep_count, sink_count))

            # Find max values for normalization
            max_ep = max((m[2] for m in metrics_list), default=0)
            max_sink = max((m[3] for m in metrics_list), default=0)

            # Avoid division by zero
            max_ep = max(max_ep, 1)
            max_sink = max(max_sink, 1)

            # Compute scores
            scored = []
            for node, density, ep_count, sink_count in metrics_list:
                norm_ep = ep_count / max_ep
                norm_sink = sink_count / max_sink
                score = (density * 0.5) + (norm_ep * 0.3) + (norm_sink * 0.2)
                scored.append((score, node))

            # Sort by score
            scored.sort(key=lambda x: x[0], reverse=reverse)
            sorted_nodes = [item[1] for item in scored]
        else:
            # Simple attribute sort
            sorted_nodes = sorted(
                nodes,
                key=lambda n: getattr(n, key, 0) or 0,
                reverse=reverse
            )

        return self._new_step_from_nodes(sorted_nodes)

    def in_module(self, module_name: str) -> 'QueryStep':
        """
        Filter current results to nodes within a specific module.

        Args:
            module_name: Name of the module to filter by.

        Returns:
            New QueryStep with filtered nodes, or empty step if module not found.

        Example:
            cpg.entry_points().in_module('network').to_list()
        """
        # Lazy import to avoid circular dependency
        from codedmap.analysis.traversal.module import ModuleNavigator

        # Resolve module by name
        modules = self._store.modules.find_by_name(module_name)
        if not modules:
            return self._empty_step()

        module = modules[0]

        # Get module file IDs
        nav = ModuleNavigator(self._store)
        module_files = list(nav.get_files(module))
        module_file_ids = {f.id for f in module_files}

        if not module_file_ids:
            return self._empty_step()

        # Filter current nodes: keep if file ancestor is in module file set
        filtered = []
        for node in self._t:
            # Walk up to find file ancestor
            file_result = self._store.query.by_id(node.id).file().first()
            if file_result and file_result.id in module_file_ids:
                filtered.append(node)

        return self._new_step_from_nodes(filtered)

    # --- 2. 结构导航 (AST) ---

    def out(self, edge_type: Union[str, EdgeType]) -> 'QueryStep':
        return QueryStep(self._t.out(edge_type), self._store)

    def in_(self, edge_type: Union[str, EdgeType]) -> 'QueryStep':
        return QueryStep(self._t.in_(edge_type), self._store)

    def ast_parent(self) -> 'QueryStep':
        return self.in_(EdgeType.AST)

    def ast_children(self) -> 'QueryStep':
        return self.out(EdgeType.AST)

    # --- 3. 调用图导航 (Call Graph) ---

    def caller(self) -> 'QueryStep':
        """Method <-[CALL]- Call"""
        return self.in_(EdgeType.CALL)

    def callee(self) -> 'QueryStep':
        """Call -[CALL]-> Method"""
        return self.out(EdgeType.CALL)

    def argument(self, index: Optional[int] = None) -> 'QueryStep':
        """
        [Security Vital] 跳转到调用的参数。
        用法:
          cpg.call("memcpy").argument(1)  -> 获取 dest
          cpg.call("memcpy").argument()   -> 获取所有参数
        Path: Call -[ARGUMENT]-> Expression
        """
        step = self.out(EdgeType.ARGUMENT)
        if index is not None:
            return step.filter(argumentIndex=index)
        return step

    # --- 4. 控制流导航 (CFG) ---

    def cfg_next(self) -> 'QueryStep':
        """
        [Flow Sensitive] 控制流后继 (执行的下一条语句)。
        Path: Node -[CFG]-> Node
        """
        return self.out(EdgeType.CFG)

    def cfg_prev(self) -> 'QueryStep':
        """
        [Flow Sensitive] 控制流前驱 (执行的上一条语句)。
        Path: Node <-[CFG]- Node
        """
        return self.in_(EdgeType.CFG)

    # --- 5. 数据流导航 (DDG) ---

    def ddg_in(self) -> 'QueryStep':
        """
        [Data Flow] 查找定义 (Defs/Sources)。
        Path: Node <-[DDG]- Node
        """
        return self.in_(EdgeType.DDG)

    def ddg_out(self) -> 'QueryStep':
        """
        [Data Flow] 查找使用 (Uses).
        Path: Node -[DDG]-> Node
        """
        return self.out(EdgeType.DDG)

    # --- 6. 污点分析集成 (Taint Analysis) ---

    def reachable_by(self, source_query: 'QueryStep') -> 'QueryStep':
        """
        [High Level] 查找能被 source_query 污染的当前节点。
        """
        sources = source_query.to_list()
        if not sources: return self._empty_step()

        sinks = self.to_list()
        if not sinks: return self._empty_step()

        sink_ids_map = {n.id: n for n in sinks}

        # 配置引擎
        config = TaintConfiguration(
            sources=sources,
            sinks=set(sink_ids_map.keys())
        )

        # 运行分析
        engine = TaintEngine(self._store)
        flows = engine.scan(config)

        # 提取结果
        confirmed_sinks = []
        seen_ids = set()

        for flow in flows:
            sink_node = flow.sink.node
            if sink_node.id in sink_ids_map and sink_node.id not in seen_ids:
                confirmed_sinks.append(sink_node)
                seen_ids.add(sink_node.id)

        return self._new_step_from_nodes(confirmed_sinks)

    # --- 7. 上下文切片 (Context Slicing) ---

    def slice_forward(self, edge_types: Optional[List[EdgeType]] = None, max_depth: int = 20):
        """
        [Slicing] 从当前节点向前切片。
        返回包含切片节点的 CPGGraph。

        Args:
            edge_types: 要沿着遍历的边类型，默认 [DDG, CDG]
            max_depth: 最大切片深度
        """
        from codedmap.app.query.slicer import GraphSlicer
        node = self.first()
        if not node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        if edge_types is None:
            edge_types = [EdgeType.DDG, EdgeType.CDG]
        slicer = GraphSlicer(self._store)
        return slicer.slice_forward(node, edge_types, max_depth)

    def slice_backward(self, edge_types: Optional[List[EdgeType]] = None, max_depth: int = 20):
        """
        [Slicing] 从当前节点向后切片。
        返回包含切片节点的 CPGGraph。
        """
        from codedmap.app.query.slicer import GraphSlicer
        node = self.first()
        if not node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        if edge_types is None:
            edge_types = [EdgeType.DDG, EdgeType.CDG]
        slicer = GraphSlicer(self._store)
        return slicer.slice_backward(node, edge_types, max_depth)

    def slice_to(self, target: 'QueryStep'):
        """
        [Slicing] 计算从当前节点到目标节点的数据流切片 (Chop)。
        返回包含路径上所有节点的 CPGGraph。

        Usage:
            source = cpg.identifier("user_input").first()
            sink = cpg.call("sql_execute").first()
            chop = source.slice_to(sink)
        """
        from codedmap.app.query.slicer import GraphSlicer
        source_node = self.first()
        if isinstance(target, QueryStep):
            target_node = target.first()
        else:
            target_node = target
        if not source_node or not target_node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        slicer = GraphSlicer(self._store)
        return slicer.data_flow_chop(source_node, target_node)

    def neighborhood(self, steps: int = 2, direction: str = "UPSTREAM"):
        """
        [Context] 提取 k-hop 局部邻域子图。

        Args:
            steps: 跳数 (BFS 深度)
            direction: "UPSTREAM", "DOWNSTREAM", or "BOTH"
        """
        from codedmap.app.query.extractor import SubgraphExtractor
        node = self.first()
        if not node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        extractor = SubgraphExtractor(self._store)
        return extractor.extract_local_neighborhood(node.id, steps, direction)

    def ast_subtree(self):
        """
        [Context] 提取当前节点的完整 AST 子树。
        """
        from codedmap.app.query.extractor import SubgraphExtractor
        node = self.first()
        if not node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        extractor = SubgraphExtractor(self._store)
        return extractor._extract_ast_subtree(node.id)

    def call_hierarchy(self, depth: int = 3, direction: str = "CALLEE"):
        """
        [Context] 提取调用链层级。

        Args:
            depth: 层级深度
            direction: "CALLEE" (向下) 或 "CALLER" (向上)
        """
        from codedmap.app.query.extractor import SubgraphExtractor
        node = self.first()
        if not node:
            from codedmap.core.schema.graph import CPGGraph
            return CPGGraph()
        extractor = SubgraphExtractor(self._store)
        return extractor.extract_call_hierarchy(node.id, depth, direction)

    def to_code_context(self):
        """
        [Serialization] 将当前 QueryStep 结果序列化为 LLM 友好的代码上下文文本。
        通常在 slice_forward/slice_backward/slice_to 返回的 CPGGraph 上使用。
        对于 QueryStep 节点，使用 ast 上下文。
        """
        from codedmap.analysis.traversal import AstContextNavigator
        node = self.first()
        if not node:
            return "Empty query result."
        navigator = AstContextNavigator(self._store)
        return navigator.get_context_code(node, max_lines=50, window_strategy=True) or ""

    def data_flow_slice(self, direction: str = "IN", max_depth: int = 5) -> str:
        """
        [Context] 生成数据流切片文本（面向 LLM Prompt）。
        委托 DataFlowNavigator.get_data_slice()。

        Args:
            direction: "IN" (backward), "OUT" (forward), or "BOTH"
            max_depth: 切片深度
        """
        from codedmap.analysis.traversal import DataFlowNavigator
        node = self.first()
        if not node:
            return ""
        navigator = DataFlowNavigator(self._store)
        return navigator.get_data_slice(node, direction, max_depth)

    def code_context(self, max_lines: int = 50) -> str:
        """
        [Context] 获取代码上下文窗口。
        委托 AstContextNavigator.get_context_code()。
        """
        from codedmap.analysis.traversal import AstContextNavigator
        node = self.first()
        if not node:
            return ""
        navigator = AstContextNavigator(self._store)
        return navigator.get_context_code(node, max_lines=max_lines, window_strategy=True) or ""

    def context(
        self,
        lines: int = 25,
        call_depth: int = 1,
        include_trace: bool = True,
    ) -> "EntryPointContextResult":
        """
        [Context] Assemble LLM-ready context for all nodes in the query step.

        This method provides the fluent API for entry point context assembly.
        It materializes all nodes in the query step and assembles comprehensive
        context including code, callers, backward traces, and architecture info.

        Args:
            lines: Number of code lines to include (default 25)
            call_depth: Depth for caller chain traversal (default 1)
            include_trace: Whether to include backward trace summary (default True)

        Returns:
            EntryPointContextResult containing all assembled contexts

        Example:
            >>> # Get context for all entry points
            >>> result = cpg.entry_points().context()
            >>> print(result.to_json())

            >>> # Configure context assembly
            >>> result = cpg.entry_points().context(
            ...     lines=50,
            ...     call_depth=2,
            ...     include_trace=False
            ... )

            >>> # Get context for specific methods
            >>> result = cpg.method().name("handle_request").context()
        """
        from codedmap.app.query.context import assemble_entry_point_context

        nodes = self.to_list()
        return assemble_entry_point_context(
            store=self._store,
            nodes=nodes,
            lines=lines,
            call_depth=call_depth,
            include_trace=include_trace,
        )

    # --- Helpers ---

    def _new_step_from_nodes(self, nodes: List[CPGNode]) -> 'QueryStep':
        """Internal: List[Node] -> QueryStep"""
        ids = [n.id for n in nodes]
        if not ids:
            return self._empty_step()
        # 依赖 Store 的 by_ids 接口
        new_traversal = self._store.query.by_ids(ids)
        return QueryStep(new_traversal, self._store)

    def _empty_step(self) -> 'QueryStep':
        """Internal: Empty Step"""
        return QueryStep(self._store.query.by_id(-1), self._store)
