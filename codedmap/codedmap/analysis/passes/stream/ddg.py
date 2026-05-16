# codedmap/analysis/passes/stream/ddg.py

from typing import List, Dict, Set, Optional
from collections import defaultdict, deque
import logging
import time

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, CallNode, IdentifierNode, MethodParameterInNode,
    ReturnNode, MethodReturnNode
)
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.core.schema.graph.operators import Operators

logger = logging.getLogger(__name__)

_ASSIGNMENT_OPS = frozenset({
    Operators.assignment,
    Operators.assignmentPlus,
    Operators.assignmentMinus,
    Operators.assignmentMultiplication,
    Operators.assignmentDivision,
    Operators.postIncrement,
    Operators.preIncrement,
    Operators.postDecrement,
    Operators.preDecrement,
})

_FIELD_ACCESS_OPS = frozenset({
    Operators.fieldAccess,
    Operators.indirectFieldAccess,
})

_TAINT_PROPAGATORS = frozenset({
    "memcpy", "memmove", "memccpy", "wmemcpy", "wmemmove",
    "strcpy", "strncpy", "wcscpy", "wcsncpy",
    "strcat", "strncat", "wcscat", "wcsncat",
    "bcopy",
})


class CFGView:
    """Pre-built CFG adjacency for O(1) predecessor/successor lookup."""

    __slots__ = ('_preds', '_succs')

    def __init__(self, graph: CPGGraph):
        preds: Dict[int, List[int]] = defaultdict(list)
        succs: Dict[int, List[int]] = defaultdict(list)
        for edge_list in graph._out_index.values():
            for e in edge_list:
                if e.type == EdgeType.CFG:
                    succs[e.src].append(e.dst)
                    preds[e.dst].append(e.src)
        self._preds = dict(preds)
        self._succs = dict(succs)

    def get_preds(self, node_id: int) -> List[int]:
        return self._preds.get(node_id, [])

    def get_succs(self, node_id: int) -> List[int]:
        return self._succs.get(node_id, [])


class DataFlowPass(StreamPass):
    """
    数据依赖图 (DDG) 构建 Pass (Stream Architecture).
    """

    def analyze(self, graph: CPGGraph):
        start_time = time.time()

        methods = [
            n for n in graph.nodes.values()
            if isinstance(n, MethodNode) and not getattr(n, 'is_stub', False)
        ]

        stats = {
            "methods_processed": 0,
            "edges_created": 0,
            "total_iterations": 0,
            "errors": 0
        }

        cfg_view = CFGView(graph)

        for method in methods:
            try:
                processor = DDGProcessor(method, graph, cfg_view)
                res = processor.process()

                if res:
                    stats["methods_processed"] += 1
                    stats["edges_created"] += res["edges"]
                    stats["total_iterations"] += res["iterations"]

            except Exception as e:
                stats["errors"] += 1
                logger.error(f"Error processing DDG for method '{method.name}': {e}", exc_info=True)

        duration = time.time() - start_time

        if stats["methods_processed"] > 0:
            avg_iter = stats["total_iterations"] / stats["methods_processed"]
            logger.debug(
                f"[DDGPass] Processed {stats['methods_processed']} methods in {duration:.3f}s. "
                f"Edges: {stats['edges_created']}, Avg Iterations: {avg_iter:.1f}. "
                f"Errors: {stats['errors']}."
            )


class DDGProcessor:
    """
    [Internal Worker] 封装单次方法分析的状态和逻辑。
    """

    def __init__(self, method: MethodNode, graph: CPGGraph, cfg_view: CFGView):
        self.method = method
        self.graph = graph
        self.cfg_view = cfg_view

        self._param_cache: Optional[List[MethodParameterInNode]] = None
        self._children_cache: Dict[int, List[AnyNode]] = {}

    def _get_children(self, node_id: int) -> List[AnyNode]:
        cached = self._children_cache.get(node_id)
        if cached is not None:
            return cached
        children = self.graph.get_ast_children(node_id)
        self._children_cache[node_id] = children
        return children

    # =========================================================================
    # Core Logic
    # =========================================================================

    def process(self) -> Optional[Dict[str, int]]:
        """
        执行 DDG 分析的主入口
        Returns: 统计字典 {"edges": int, "iterations": int}
        """
        # 1. 收集 AST 后代, 并从中筛选 CFG 参与节点 (用于求解)
        ast_nodes = self._collect_ast_nodes_recursive(self.method)
        if not ast_nodes:
            return None

        cfg_nodes = self._extract_cfg_participants(ast_nodes)

        # 2. 准备 Gen / Kill (遍历 AST 节点构建定义信息)
        gen_map: Dict[int, Set[int]] = defaultdict(set)
        definitions_by_var: Dict[int, Set[int]] = defaultdict(set)

        params = self._get_method_params(self.method)
        if params:
            for param in params:
                gen_map[self.method.id].add(param.id)
                definitions_by_var[param.id].add(self.method.id)

        for node in ast_nodes:
            if not isinstance(node, CallNode):
                continue
            defined_vars = self._get_defined_variables_robust(node)
            if defined_vars:
                for var in defined_vars:
                    gen_map[node.id].add(var.id)
                    definitions_by_var[var.id].add(node.id)

        # 3. 计算 Kill
        kill_map: Dict[int, Set[int]] = {}
        for node_id, var_ids in gen_map.items():
            current_kill = set()
            for var_id in var_ids:
                all_defs = definitions_by_var.get(var_id)
                if all_defs:
                    current_kill |= (all_defs - {node_id})
            if current_kill:
                kill_map[node_id] = current_kill

        # 4. 求解 Reaching Definitions (仅在 CFG 节点上迭代, RPO 初始化)
        cfg_id_set = frozenset(n.id for n in cfg_nodes)
        in_sets, iterations = self._solve_reaching_definitions(cfg_nodes, gen_map, kill_map, cfg_id_set)

        # 查找 MethodReturn
        method_return_node = None
        for e in self.graph.get_out_edges(self.method.id, EdgeType.AST):
            child = self.graph.get_node_by_id(e.dst)
            if isinstance(child, MethodReturnNode):
                method_return_node = child
                break

        # 5. 构建 DDG 边 (遍历 AST 节点建立 Use-Def + Structural 边)
        new_edges: List[tuple] = []

        for node in ast_nodes:
            # --- Part A: Use-Def Chain ---
            used_vars = self._get_used_variables(node)
            if used_vars:
                reaching_defs = in_sets.get(node.id)
                if not reaching_defs:
                    # 非 CFG 节点: 查找 AST 祖先中最近的 CFG 节点的 in_set
                    reaching_defs = self._find_reaching_defs_via_ancestor(node.id, in_sets, cfg_id_set)
                if reaching_defs:
                    for var in used_vars:
                        for def_node_id in reaching_defs:
                            defined_var_ids = gen_map.get(def_node_id)
                            if defined_var_ids and var.id in defined_var_ids:
                                def_node_obj = self.graph.get_node_by_id(def_node_id)
                                if not def_node_obj:
                                    continue

                                actual_src = def_node_obj
                                if isinstance(def_node_obj, CallNode) and def_node_obj.name in _ASSIGNMENT_OPS:
                                    children = self._get_children(def_node_obj.id)
                                    if children and isinstance(children[0], IdentifierNode):
                                        actual_src = children[0]
                                elif isinstance(def_node_obj, MethodNode):
                                    param_node = next((p for p in params if p.id == var.id), None)
                                    if param_node:
                                        actual_src = param_node

                                new_edges.append((actual_src, node, var.name))

            # --- Part B: Structural Data Flow ---
            if isinstance(node, CallNode) and node.name in _ASSIGNMENT_OPS:
                children = self._get_children(node.id)
                if len(children) >= 2:
                    lhs, rhs = children[0], children[1]
                    var_name = getattr(lhs, 'name', '<VAL>')
                    new_edges.append((rhs, lhs, var_name))

            if isinstance(node, ReturnNode) and method_return_node:
                children = self._get_children(node.id)
                for child in children:
                    new_edges.append((child, method_return_node, "RET"))

            # Taint Propagation
            if isinstance(node, CallNode) and node.name in _TAINT_PROPAGATORS:
                args = self._get_children(node.id)
                if len(args) >= 2:
                    new_edges.append((args[1], args[0], "TAINT_PROPAGATION"))

        # 6. 写入图
        for src, dst, var in new_edges:
            self.graph.add_ddg_edge(src, dst, variable=var)

        return {
            "edges": len(new_edges),
            "iterations": iterations
        }

    # =========================================================================
    # Helpers
    # =========================================================================

    def _extract_cfg_participants(self, ast_nodes: List[AnyNode]) -> List[AnyNode]:
        """从 AST 后代中筛选参与 CFG 的节点 (有 CFG 入边或出边)。
        始终包含 method 入口节点。"""
        cfg_preds = self.cfg_view._preds
        cfg_succs = self.cfg_view._succs
        result = []
        for n in ast_nodes:
            nid = n.id
            if nid in cfg_preds or nid in cfg_succs or isinstance(n, MethodNode):
                result.append(n)
        return result

    def _collect_ast_nodes_recursive(self, root: AnyNode) -> List[AnyNode]:
        """DFS 收集 AST 后代节点 (用于 gen/use 分析和边构建)。"""
        collected = []
        stack = [root]
        visited = set()
        while stack:
            n = stack.pop()
            if n.id in visited:
                continue
            visited.add(n.id)
            collected.append(n)
            edges = self.graph.get_out_edges(n.id, EdgeType.AST)
            for edge in reversed(edges):
                child = self.graph.get_node_by_id(edge.dst)
                if child:
                    stack.append(child)
        return collected

    def _compute_rpo(self, nodes: List[AnyNode]) -> List[int]:
        """计算 Reverse Postorder 用于 worklist 初始化, 加速不动点收敛。"""
        node_ids = frozenset(n.id for n in nodes)
        if not node_ids:
            return []

        visited: Set[int] = set()
        postorder: List[int] = []
        entry = nodes[0].id

        stack: List[tuple] = [(entry, False)]
        while stack:
            nid, expanded = stack.pop()
            if nid in visited:
                continue
            if expanded:
                visited.add(nid)
                postorder.append(nid)
                continue
            visited.add(nid)
            stack.append((nid, True))
            visited.discard(nid)
            for succ in self.cfg_view.get_succs(nid):
                if succ in node_ids and succ not in visited:
                    stack.append((succ, False))

        postorder.reverse()
        seen = set(postorder)
        for n in nodes:
            if n.id not in seen:
                postorder.append(n.id)
        return postorder

    def _solve_reaching_definitions(
        self,
        nodes: List[AnyNode],
        gen_map: Dict[int, Set[int]],
        kill_map: Dict[int, Set[int]],
        valid_ids: frozenset,
    ):
        """
        求解 Reaching Definitions (仅 CFG 节点, RPO 初始化).
        Returns: (IN_SETS, IterationCount)
        """
        out_sets: Dict[int, Set[int]] = {}
        in_sets: Dict[int, Set[int]] = {}

        rpo_order = self._compute_rpo(nodes)

        worklist = deque(rpo_order)
        in_worklist = set(rpo_order)

        iterations = 0
        get_preds = self.cfg_view.get_preds
        get_succs = self.cfg_view.get_succs

        while worklist:
            n = worklist.popleft()
            in_worklist.discard(n)
            iterations += 1

            # IN[n] = Union(OUT[p])
            new_in: Optional[Set[int]] = None
            for p in get_preds(n):
                p_out = out_sets.get(p)
                if p_out:
                    if new_in is None:
                        new_in = p_out.copy()
                    else:
                        new_in |= p_out

            old_out = out_sets.get(n)

            if new_in is None:
                new_in = set()
            in_sets[n] = new_in

            # OUT[n] = GEN[n] U (IN[n] - KILL[n])
            kill = kill_map.get(n)
            surviving = (new_in - kill) if kill else new_in

            if n in gen_map:
                new_out = surviving | {n}
            else:
                new_out = surviving

            if new_out != old_out:
                out_sets[n] = new_out
                for s in get_succs(n):
                    if s in valid_ids and s not in in_worklist:
                        worklist.append(s)
                        in_worklist.add(s)

        return in_sets, iterations

    def _find_reaching_defs_via_ancestor(
        self, node_id: int, in_sets: Dict[int, Set[int]], cfg_ids: frozenset
    ) -> Optional[Set[int]]:
        """对非 CFG 的 AST 叶子节点, 向上查找最近的 CFG 祖先的 in_set。"""
        current = node_id
        for _ in range(50):
            in_edges = self.graph.get_in_edges(current, EdgeType.AST)
            if not in_edges:
                return None
            parent_id = in_edges[0].src
            if parent_id in cfg_ids:
                return in_sets.get(parent_id)
            current = parent_id
        return None

    def _resolve_ref(self, node_id: int) -> Optional[AnyNode]:
        edges = self.graph.get_out_edges(node_id, EdgeType.REF)
        if edges:
            return self.graph.get_node_by_id(edges[0].dst)
        return None

    def _get_method_params(self, method: MethodNode) -> List[MethodParameterInNode]:
        if self._param_cache is not None:
            return self._param_cache
        edges = self.graph.get_out_edges(method.id, EdgeType.AST)
        params = []
        for e in edges:
            node = self.graph.get_node_by_id(e.dst)
            if isinstance(node, MethodParameterInNode):
                params.append(node)
        self._param_cache = params
        return params

    def _is_compound_assignment(self, node: CallNode) -> bool:
        return node.name != Operators.assignment and node.name in _ASSIGNMENT_OPS

    def _get_defined_variables_robust(self, node: CallNode) -> List[AnyNode]:
        defined = []
        if node.name in _ASSIGNMENT_OPS:
            children = self._get_children(node.id)
            if children:
                lhs = children[0]
                if isinstance(lhs, IdentifierNode):
                    var = self._resolve_ref(lhs.id)
                    if var:
                        defined.append(var)
        else:
            args = self._get_children(node.id)
            for arg in args:
                if isinstance(arg, CallNode) and arg.name == Operators.addressOf:
                    grand_children = self._get_children(arg.id)
                    if grand_children and isinstance(grand_children[0], IdentifierNode):
                        var = self._resolve_ref(grand_children[0].id)
                        if var:
                            defined.append(var)
        return defined

    def _get_used_variables(self, node: AnyNode) -> List[AnyNode]:
        if isinstance(node, IdentifierNode):
            var = self._resolve_ref(node.id)
            if var and not self._is_pure_lhs_of_assignment(node):
                return [var]
        elif isinstance(node, CallNode) and node.name in _FIELD_ACCESS_OPS:
            if not self._is_assignment_lhs(node):
                children = self._get_children(node.id)
                if children and isinstance(children[0], IdentifierNode):
                    var = self._resolve_ref(children[0].id)
                    if var:
                        return [var]
        return []

    def _is_assignment_lhs(self, node: AnyNode) -> bool:
        in_edges = self.graph.get_in_edges(node.id, EdgeType.AST)
        if not in_edges:
            return False
        parent = self.graph.get_node_by_id(in_edges[0].src)
        if isinstance(parent, CallNode) and parent.name in _ASSIGNMENT_OPS:
            children = self._get_children(parent.id)
            return bool(children) and children[0].id == node.id
        return False

    def _is_pure_lhs_of_assignment(self, ident: IdentifierNode) -> bool:
        in_edges = self.graph.get_in_edges(ident.id, EdgeType.AST)
        if not in_edges:
            return False
        parent = self.graph.get_node_by_id(in_edges[0].src)
        if isinstance(parent, CallNode) and parent.name in _ASSIGNMENT_OPS:
            children = self._get_children(parent.id)
            if children and children[0].id == ident.id:
                if self._is_compound_assignment(parent):
                    return False
                return True
        return False
