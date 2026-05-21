# codedmap/app/query/extractor.py
# Migrated from features/export/extractor.py

from typing import Set, Literal, Optional, List, Deque
import logging
from collections import deque

from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.app.query.slicer import GraphSlicer

logger = logging.getLogger(__name__)

# 定义遍历方向类型
Direction = Literal["UPSTREAM", "DOWNSTREAM", "BOTH"]
CallDirection = Literal["CALLER", "CALLEE"]

class SubgraphExtractor:
    """
    [Service Layer] 子图提取器。

    职责：
    将高层的业务意图（如"查看漏洞路径"、"审计函数逻辑"、"查看变量来源"）
    翻译为底层的图操作，并提取出独立的 CPGGraph 子图。
    供 LLM Agent、IDE 插件或 CLI 工具使用。
    """

    def __init__(self, store: CPGStore):
        self.store = store
        # 依赖 Slicer 进行核心路径计算
        self.slicer = GraphSlicer(store)

    def extract_data_flow_slice(self, source_id: int, sink_id: int) -> CPGGraph:
        """
        [Scenario: Vulnerability Verification]
        提取从 Source 到 Sink 的完整数据流切片。
        """
        logger.info(f"Extracting data flow slice from {source_id} to {sink_id}...")

        path_node_ids = self.slicer.data_flow_chop(source_id, sink_id)

        if not path_node_ids:
            logger.warning("No path found between source and sink.")
            return CPGGraph()

        return self.store.get_induced_subgraph(path_node_ids)

    def extract_local_neighborhood(self,
                                   center_id: int,
                                   steps: int = 2,
                                   direction: Direction = "UPSTREAM") -> CPGGraph:
        """
        [Scenario: Code Auditing / Context Understanding]
        提取指定节点的 k-Hop 局部邻域。
        """
        logger.info(f"Extracting {steps}-hop neighborhood for {center_id} ({direction})...")

        collected_ids: Set[int] = {center_id}
        current_frontier: Set[int] = {center_id}

        relevant_edge_types = [
            str(EdgeType.DDG.value),
            str(EdgeType.CFG.value),
            str(EdgeType.CALL.value),
            str(EdgeType.ARGUMENT.value)
        ]

        for i in range(steps):
            if not current_frontier:
                break

            next_frontier = set()
            frontier_list = list(current_frontier)

            if direction in ["UPSTREAM", "BOTH"]:
                in_neighbors = self.store.get_neighbors_batch(
                    frontier_list, "IN", relevant_edge_types
                )
                for targets in in_neighbors.values():
                    next_frontier.update(targets)

            if direction in ["DOWNSTREAM", "BOTH"]:
                out_neighbors = self.store.get_neighbors_batch(
                    frontier_list, "OUT", relevant_edge_types
                )
                for targets in out_neighbors.values():
                    next_frontier.update(targets)

            new_nodes = next_frontier - collected_ids
            collected_ids.update(new_nodes)
            current_frontier = new_nodes

        return self.store.get_induced_subgraph(list(collected_ids))

    def extract_method_ast(self, method_name: str = None, method_id: int = None) -> CPGGraph:
        """
        [Scenario: Patch Generation / Logic Analysis]
        提取特定方法的完整 AST (抽象语法树) 结构。
        """
        target_node = None

        if method_id is not None:
            nodes = self.store.query.by_id(method_id).to_list()
            if nodes: target_node = nodes[0]
        elif method_name is not None:
            methods = self.store.query.methods(method_name).to_list()
            if methods: target_node = methods[0]

        if not target_node:
            logger.warning(f"Method not found: name={method_name}, id={method_id}")
            return CPGGraph()

        logger.info(f"Extracting AST for method: {getattr(target_node, 'name', 'unknown')} ({target_node.id})")
        return self._extract_ast_subtree(target_node.id)

    def extract_file_ast(self, filename: str) -> CPGGraph:
        """
        [Scenario: File Level Analysis]
        提取整个文件的 AST 结构。
        """
        files = self.store.query.files(filename).to_list()

        target_file = None
        for f in files:
            if getattr(f, "name", "") == filename or getattr(f, "name", "").endswith(filename):
                target_file = f
                break

        if not target_file:
            logger.warning(f"File not found: {filename}")
            return CPGGraph()

        logger.info(f"Extracting AST for file: {target_file.name}")
        return self._extract_ast_subtree(target_file.id)

    def _extract_ast_subtree(self, root_id: int) -> CPGGraph:
        """
        [Internal] 通用 AST 子树提取逻辑 (BFS)
        """
        subtree_ids = {root_id}
        queue = deque([root_id])
        ast_type = [str(EdgeType.AST.value)]

        while queue:
            curr_id = queue.popleft()
            neighbors = self.store.get_neighbors(curr_id, "OUT", ast_type)

            for child_id in neighbors:
                if child_id not in subtree_ids:
                    subtree_ids.add(child_id)
                    queue.append(child_id)

        return self.store.get_induced_subgraph(list(subtree_ids))

    def extract_call_hierarchy(self,
                               method_id: int,
                               depth: int = 3,
                               direction: CallDirection = "CALLEE") -> CPGGraph:
        """
        [Scenario: Impact Analysis]
        提取调用链层级。
        """
        logger.info(f"Extracting {direction} hierarchy for method {method_id} (depth={depth})...")

        collected_ids: Set[int] = {method_id}
        current_methods: Set[int] = {method_id}

        edge_contains = [str(EdgeType.CONTAINS.value), str(EdgeType.AST.value)]
        edge_call = [str(EdgeType.CALL.value)]

        for _ in range(depth):
            if not current_methods:
                break

            next_methods = set()
            method_list = list(current_methods)

            if direction == "CALLEE":
                call_map = self.store.get_neighbors_batch(method_list, "OUT", edge_contains)

                all_call_ids = []
                for targets in call_map.values():
                    all_call_ids.extend(targets)

                if all_call_ids:
                    callee_map = self.store.get_neighbors_batch(all_call_ids, "OUT", edge_call)

                    for src_call_id, dst_method_ids in callee_map.items():
                        if dst_method_ids:
                            collected_ids.add(src_call_id)
                            for m_id in dst_method_ids:
                                collected_ids.add(m_id)
                                next_methods.add(m_id)

            elif direction == "CALLER":
                call_map = self.store.get_neighbors_batch(method_list, "IN", edge_call)

                all_call_ids = []
                for targets in call_map.values():
                    all_call_ids.extend(targets)

                if all_call_ids:
                    caller_map = self.store.get_neighbors_batch(all_call_ids, "IN", edge_contains)

                    for src_call_id, caller_ids in caller_map.items():
                        if caller_ids:
                            collected_ids.add(src_call_id)
                            for m_id in caller_ids:
                                collected_ids.add(m_id)
                                next_methods.add(m_id)

            current_methods = next_methods

        return self.store.get_induced_subgraph(list(collected_ids))
