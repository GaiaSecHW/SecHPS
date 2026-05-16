# codedmap/app/query/slicer.py
# Migrated from features/slicing/slicer.py

from typing import List, Set, Optional, Union
from collections import deque
import logging

from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

class GraphSlicer:
    """
    图切片引擎 (Architecture: Storage-Agnostic).

    完全解耦：不包含任何 Cypher 或后端特定逻辑。
    完全依赖 store.get_neighbors() 和 store.get_subgraph()。
    """

    def __init__(self, store: CPGStore):
        self.store = store

    # =========================================================================
    # 公开 API
    # =========================================================================

    def slice_forward(self, start_node: AnyNode, edge_types: List[EdgeType], max_depth: int = 20) -> CPGGraph:
        visited_ids = self._bfs(start_node.id, "OUT", edge_types, max_depth)
        return self._build_result(visited_ids)

    def slice_backward(self, start_node: AnyNode, edge_types: List[EdgeType], max_depth: int = 20) -> CPGGraph:
        visited_ids = self._bfs(start_node.id, "IN", edge_types, max_depth)
        return self._build_result(visited_ids)

    def data_flow_chop(self, source: AnyNode, sink: AnyNode) -> CPGGraph:
        """
        计算从 Source 到 Sink 的数据流切片 (Chop)。
        算法: (Forward(Source) INTERSECT Backward(Sink)) + Context + Guards
        """

        relevant_types = [EdgeType.DDG, EdgeType.CDG]

        # 1. 智能起点扩展 (Smart Seeds)
        forward_seeds = {source.id}
        ref_type = [EdgeType.REF]

        usages = self._get_neighbors_internal(source.id, "IN", ref_type)
        if usages:
            forward_seeds.update(usages)
            for uid in usages:
                parents = self._get_neighbors_internal(uid, "IN", [EdgeType.AST])
                forward_seeds.update(parents)

        # 2. Forward & Backward BFS
        forward_set = set()
        for seed_id in forward_seeds:
            visited = self._bfs(seed_id, "OUT", relevant_types, max_depth=50)
            forward_set.update(visited)

        if sink.id not in forward_set:
            logger.info("Sink not reachable from Source via Data Flow.")
            return CPGGraph()

        backward_set = self._bfs(sink.id, "IN", relevant_types, max_depth=50)

        # 3. Intersection (核心路径)
        intersection = forward_set.intersection(backward_set)

        # 4. Context Enrichment (AST Parents)
        context_nodes = self._enrich_context(intersection)

        # 5. Sibling Enrichment (兄弟节点扩充)
        full_context_nodes = self._enrich_siblings(context_nodes)

        # 6. Control Guard Augmentation (控制依赖增强)
        final_nodes = self._augment_with_guards(full_context_nodes)

        return self._build_result(final_nodes)

    # =========================================================================
    # 核心算法
    # =========================================================================

    def _bfs(self, start_id: int, direction: str, edge_types: List[EdgeType], max_depth: int) -> Set[int]:
        visited = {start_id}
        queue = deque([(start_id, 0)])

        while queue:
            curr_id, depth = queue.popleft()
            if depth >= max_depth:
                continue

            neighbors = self._get_neighbors_internal(curr_id, direction, edge_types)

            for n_id in neighbors:
                if n_id not in visited:
                    visited.add(n_id)
                    queue.append((n_id, depth + 1))

        return visited

    def _enrich_context(self, node_ids: Set[int]) -> Set[int]:
        """向上补充 AST 父节点 (直到文件/方法根)"""
        enriched = node_ids.copy()
        queue = list(node_ids)
        ast_type = [EdgeType.AST]

        while queue:
            curr_id = queue.pop(0)
            parents = self._get_neighbors_internal(curr_id, "IN", ast_type)
            for pid in parents:
                if pid not in enriched:
                    enriched.add(pid)
                    queue.append(pid)
        return enriched

    def _augment_with_guards(self, node_ids: Set[int]) -> Set[int]:
        """补充控制依赖 (CDG) 的 Guard 节点 (如 if/while 条件)"""
        augmented = node_ids.copy()
        queue = list(node_ids)
        visited_guards = set()

        cdg_type = [EdgeType.CDG]
        ast_type = [EdgeType.AST]

        while queue:
            curr_id = queue.pop(0)
            controllers = self._get_neighbors_internal(curr_id, "IN", cdg_type)

            for cid in controllers:
                if cid not in visited_guards:
                    visited_guards.add(cid)
                    if cid not in augmented:
                        augmented.add(cid)
                        queue.append(cid)

                    children = self._get_neighbors_internal(cid, "OUT", ast_type)
                    for child in children:
                        augmented.add(child)
                        grand_children = self._get_neighbors_internal(child, "OUT", ast_type)
                        augmented.update(grand_children)

        return self._enrich_context(augmented)

    def _enrich_siblings(self, node_ids: Set[int]) -> Set[int]:
        """
        兄弟节点扩充。
        如果切片包含了一个 Block 中的某条语句，尝试把该 Block 的其他直接子节点也拉进来。
        """
        enriched = node_ids.copy()
        candidates = list(node_ids)
        ast_type = [EdgeType.AST]

        parents = set()
        for nid in candidates:
             p_list = self._get_neighbors_internal(nid, "IN", ast_type)
             parents.update(p_list)

        for pid in parents:
            children = self._get_neighbors_internal(pid, "OUT", ast_type)
            enriched.update(children)

        return enriched

    # =========================================================================
    # 内部辅助
    # =========================================================================

    def _get_neighbors_internal(self, node_id: int, direction: str, edge_types: Optional[List[Union[EdgeType, str]]]) -> List[int]:
        type_strs = None
        if edge_types:
            type_strs = [
                t.value if hasattr(t, 'value') else str(t)
                for t in edge_types
            ]

        return self.store.get_neighbors(node_id, direction, type_strs)

    def _build_result(self, node_ids: Set[int]) -> CPGGraph:
        """根据 ID 集合从 Store 中提取子图。"""
        if not node_ids:
            return CPGGraph()
        return self.store.get_subgraph(list(node_ids))
