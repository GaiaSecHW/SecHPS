# codedmap/app/taint/core/engine.py

import logging
from collections import deque
from typing import List, Deque, Set, Tuple, Dict


from .context import CallStackManager

from codedmap.app.taint.models import TaintFlow, TaintStep
from codedmap.app.taint.models.state import AnalysisState
from codedmap.app.taint.rules.config import TaintConfiguration

from codedmap.core.schema.graph.enums import EdgeType
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

class TaintEngine:
    """
    [Core] 工业级污点分析引擎。
    已启用 Layer-wise Batch Optimization (向量化扩展)。
    """
    def __init__(self, store: CPGStore, max_call_depth: int = 5):
        self.store = store
        self.context_manager = CallStackManager(max_depth=max_call_depth)

    def scan(self, config: TaintConfiguration) -> List[TaintFlow]:
        results = []
        found_pairs: Set[Tuple[int, int]] = set()

        if not config.sources: # 属性访问会触发 property 检查
            return results

        logger.info("Starting Batch Taint Analysis...")

        for src_node in config.sources_iter:
            # 这里的 src_node 可能是从 Traversal 来的，确保它是完整的 Node 对象
            # 如果是 ID，需要 fetch；如果是对象，直接用。
            flows = self._bfs_layer_search(src_node, config)

            for flow in flows:
                # 保护性编程：确保节点非空
                if flow.source.node and flow.sink.node:
                    pair = (flow.source.node.id, flow.sink.node.id)
                    if pair not in found_pairs:
                        results.append(flow)
                        found_pairs.add(pair)

        logger.info(f"Analysis finished. Found {len(results)} flows.")
        return results

    def _bfs_layer_search(self, start_node, config: TaintConfiguration) -> List[TaintFlow]:
        """
        层级 BFS (Layer-wise BFS) 实现。
        """
        flows = []

        initial_state = AnalysisState(
            node=start_node,
            path_ids=(start_node.id,),
            call_stack=tuple()
        )

        current_layer: Set[AnalysisState] = {initial_state}
        visited: Set[AnalysisState] = {initial_state}

        depth = 0
        MAX_DEPTH = 50

        edge_types = [
            str(EdgeType.DDG.value),
            str(EdgeType.PARAMETER_LINK.value)
        ]

        while current_layer:
            if depth > MAX_DEPTH:
                logger.warning(f"Max depth {MAX_DEPTH} reached for source {start_node.id}")
                break
            depth += 1

            # --- 步骤 1: 批量 IO (获取拓扑) ---
            current_node_ids = list({state.node.id for state in current_layer})

            # [Refactor] 使用 Store 的 Facade 接口
            adj_map = self.store.get_neighbors_batch(current_node_ids, "OUT", edge_types)

            # --- 步骤 2: 批量 IO (获取节点数据) ---
            next_node_ids_all = set()
            for targets in adj_map.values():
                next_node_ids_all.update(targets)

            next_nodes_subgraph = None
            if next_node_ids_all:
                # [Refactor] 使用 get_subgraph (自动包含节点)
                next_nodes_subgraph = self.store.get_subgraph(list(next_node_ids_all))

            # --- 步骤 3: 内存计算 ---
            next_layer = set()

            for state in current_layer:
                curr_node = state.node

                # A. Sink / Sanitizer Check (跳过 Source 自身)
                if curr_node.id != start_node.id:
                    if config.is_sink(curr_node):
                        flows.append(self._reconstruct_flow(state.path_ids))
                        continue

                    if config.is_sanitizer(curr_node):
                        continue

                # B. Expansion
                neighbor_ids = adj_map.get(curr_node.id, [])
                if not neighbor_ids or not next_nodes_subgraph:
                    continue

                for next_id in neighbor_ids:
                    # 使用 get_node_by_id 安全获取 (CPGGraph 接口)
                    next_node = next_nodes_subgraph.get_node_by_id(next_id)
                    if not next_node:
                        continue

                    # C. Context Update
                    new_stack = self.context_manager.update_context(curr_node, next_node, state.call_stack)

                    if new_stack is not None:
                        new_path = state.path_ids + (next_id,)
                        new_state = AnalysisState(next_node, new_path, new_stack)

                        if new_state not in visited:
                            visited.add(new_state)
                            next_layer.add(new_state)

            current_layer = next_layer

        return flows

    def _reconstruct_flow(self, path_ids: Tuple[int, ...]) -> TaintFlow:
        """从 ID 列表重建完整的 Flow 对象"""
        steps = []
        path_list = list(path_ids)
        # [Refactor] 批量拉取路径上的所有节点
        subgraph = self.store.get_subgraph(path_list)

        for nid in path_list:
            node = subgraph.get_node_by_id(nid)
            if node:
                steps.append(TaintStep(node=node))
            else:
                # Fallback: 单个查询 (通过 Store Query DSL)
                fallback_nodes = self.store.query.by_id(nid).to_list()
                if fallback_nodes:
                    steps.append(TaintStep(node=fallback_nodes[0]))
                else:
                    logger.warning(f"Missing node {nid} in flow reconstruction")

        if not steps:
            return TaintFlow(source=TaintStep(node=None), sink=TaintStep(node=None))

        return TaintFlow(source=steps[0], sink=steps[-1], path=steps)
