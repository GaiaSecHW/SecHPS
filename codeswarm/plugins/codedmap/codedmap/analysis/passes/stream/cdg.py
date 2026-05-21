# codedmap/passes/cdg_pass.py

from typing import List, Dict, Set, Optional, Tuple
import logging
import time

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.edges import CPGEdge
from codedmap.core.schema.graph.nodes import (
    MethodNode, ControlStructureNode, MethodReturnNode,
    MethodParameterInNode, BlockNode, CallNode,
    ReturnNode, JumpTargetNode, IdentifierNode, LiteralNode
)
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.analysis.algorithms.dominator import PostDominatorTree

logger = logging.getLogger(__name__)

DEFAULT_MAX_CFG_NODES = 5000
DEFAULT_MAX_AST_DEPTH = 50
_PROGRESS_INTERVAL = 200


class CDGPass(StreamPass):
    """
    控制依赖图 (CDG) 构建 Pass.
    基于 Post-Dominator Frontier 算法构建。
    """

    def __init__(self, config=None, max_cfg_nodes: int = DEFAULT_MAX_CFG_NODES,
                 max_ast_depth: int = DEFAULT_MAX_AST_DEPTH):
        super().__init__(config)
        self.max_cfg_nodes = max_cfg_nodes
        self.max_ast_depth = max_ast_depth

    def analyze(self, graph: CPGGraph):
        start_time = time.time()
        methods = [
            n for n in graph.nodes.values()
            if isinstance(n, MethodNode) and not getattr(n, 'is_stub', False)
        ]

        stats = {
            "processed": 0,
            "skipped_oversize": 0,
            "edges_created": 0,
            "errors": 0
        }

        total = len(methods)
        for i, method in enumerate(methods):
            try:
                processor = CDGProcessor(
                    method, graph,
                    max_cfg_nodes=self.max_cfg_nodes,
                    max_ast_depth=self.max_ast_depth,
                )
                edges_count = processor.process()

                if edges_count < 0:
                    stats["skipped_oversize"] += 1
                else:
                    stats["processed"] += 1
                    stats["edges_created"] += edges_count

            except Exception as e:
                stats["errors"] += 1
                logger.error(f"Error processing CDG for method '{method.name}': {e}", exc_info=True)

            if total > _PROGRESS_INTERVAL and (i + 1) % _PROGRESS_INTERVAL == 0:
                logger.info(f"[CDGPass] Progress: {i + 1}/{total} methods")

        duration = time.time() - start_time
        if stats["processed"] > 0 or stats["skipped_oversize"] > 0:
            logger.debug(
                f"[CDGPass] Done in {duration:.3f}s. "
                f"Processed: {stats['processed']}, Edges: {stats['edges_created']}, "
                f"Oversize skipped: {stats['skipped_oversize']}, Errors: {stats['errors']}."
            )


class CDGProcessor:

    __slots__ = ('method', 'graph', 'max_cfg_nodes', 'max_ast_depth')

    def __init__(self, method: MethodNode, graph: CPGGraph, *,
                 max_cfg_nodes: int = DEFAULT_MAX_CFG_NODES,
                 max_ast_depth: int = DEFAULT_MAX_AST_DEPTH):
        self.method = method
        self.graph = graph
        self.max_cfg_nodes = max_cfg_nodes
        self.max_ast_depth = max_ast_depth

    def process(self) -> int:
        """
        执行 CDG 分析。
        Returns: 创建的边数, -1 表示因超大跳过。
        """
        edges_count = 0

        # 1. 收集节点
        nodes, ast_parent_map = self._collect_method_nodes()
        if not nodes:
            return 0

        # 2. 收集 CFG 边
        cfg_edges = self._get_method_cfg_edges(nodes)
        if not cfg_edges:
            return 0

        # 3. 超大方法保护: CFG 参与节点过多时跳过
        cfg_participants = set()
        for e in cfg_edges:
            cfg_participants.add(e.src)
            cfg_participants.add(e.dst)

        if len(cfg_participants) > self.max_cfg_nodes:
            logger.warning(
                f"[CDGPass] Skipping oversized method '{self.method.name}' "
                f"({len(cfg_participants)} CFG nodes > {self.max_cfg_nodes})"
            )
            return -1

        # 4. 构建后支配树
        dt = PostDominatorTree(self.graph, self.method)
        try:
            dt.build_from_edges(nodes, cfg_edges)
        except Exception:
            return 0

        # 5. 获取 CDG 关系 {Controller -> Dependents}
        relations = dt.calculate_control_dependence()

        controlled_nodes: Set[int] = set()

        # 6. 生成 CDG 边
        for controller_id, dependents in relations.items():
            real_controller = self._resolve_semantic_controller(controller_id, ast_parent_map)

            if not real_controller or real_controller.id == self.method.id:
                continue

            for dep_id in dependents:
                dependent = self.graph.get_node_by_id(dep_id)
                if not dependent:
                    continue

                if real_controller.id == dependent.id:
                    continue

                self.graph.add_edge(real_controller.id, dependent.id, EdgeType.CDG)
                edges_count += 1
                controlled_nodes.add(dep_id)

                if isinstance(dependent, (ControlStructureNode, BlockNode)):
                    controlled_nodes.add(dependent.id)

        # 7. Entry Dependence (孤儿节点)
        method_entry_id = self.method.id
        reachable_nodes = dt.get_reachable_nodes()

        for node in nodes:
            if isinstance(node, (MethodNode, MethodReturnNode, MethodParameterInNode)):
                continue

            if node.id not in cfg_participants:
                continue

            if node.id not in controlled_nodes:
                if node.id in reachable_nodes:
                    self.graph.add_edge(method_entry_id, node.id, EdgeType.CDG)
                    edges_count += 1

        return edges_count

    def _collect_method_nodes(self) -> Tuple[List[AnyNode], Dict[int, int]]:
        """收集 AST 节点及父子关系映射。"""
        nodes = []
        ast_parent_map: Dict[int, int] = {}

        root = self.graph.get_node_by_id(self.method.id)
        if not root:
            return [], {}

        stack = [root]
        visited: Set[int] = set()

        while stack:
            parent = stack.pop()
            if parent.id in visited:
                continue
            visited.add(parent.id)
            nodes.append(parent)

            edges = self.graph.get_out_edges(parent.id, EdgeType.AST)
            for e in reversed(edges):
                child = self.graph.get_node_by_id(e.dst)
                if child:
                    ast_parent_map[child.id] = parent.id
                    stack.append(child)
        return nodes, ast_parent_map

    def _get_method_cfg_edges(self, nodes: List[AnyNode]) -> List[CPGEdge]:
        node_ids = {n.id for n in nodes}
        cfg_edges: List[CPGEdge] = []
        for n in nodes:
            out_edges = self.graph.get_out_edges(n.id, EdgeType.CFG)
            for e in out_edges:
                if e.dst in node_ids:
                    cfg_edges.append(e)
        return cfg_edges

    def _resolve_semantic_controller(
        self, controller_id: int, ast_parent_map: Dict[int, int]
    ) -> Optional[AnyNode]:
        """
        语义回溯：将 CFG 节点映射回产生分支的 AST 结构。
        """
        node = self.graph.get_node_by_id(controller_id)
        if not node:
            return None

        curr = node
        depth = 0
        max_depth = self.max_ast_depth

        while curr and depth < max_depth:
            if isinstance(curr, ControlStructureNode):
                return curr

            if isinstance(curr, CallNode):
                if curr.name in (
                    "<operator>.logicalAnd",
                    "<operator>.logicalOr",
                    "<operator>.conditional",
                ):
                    return curr

            if isinstance(curr, MethodNode):
                return None

            p_id = ast_parent_map.get(curr.id)
            if not p_id:
                break

            curr = self.graph.get_node_by_id(p_id)
            depth += 1

        # Fallback: 仅允许语句级节点 (Call/JumpTarget/Return) 作为 controller，
        # 过滤掉叶子节点 (Identifier/Literal) 避免 CDG 噪声。
        if isinstance(node, (IdentifierNode, LiteralNode)):
            return None
        return node
