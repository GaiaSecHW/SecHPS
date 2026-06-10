# codedmap/infra/storage/base/writer.py

import logging
from abc import abstractmethod
from typing import Any, List

from codedmap.infra.storage.interfaces import GraphWriter
from codedmap.core.schema.graph.patch import GraphPatch, PruneRequest

logger = logging.getLogger(__name__)

class BaseGraphWriter(GraphWriter):
    """
    [Abstract] 写操作基类。
    """

    def apply_patch(self, patch: GraphPatch):
        if patch.is_empty:
            return

        with self._transaction_context() as tx:
            try:
                # 按照严格顺序执行图修改
                
                # Step 0: 盲写修剪 (New Priority)
                # 先把旧的子树/附属节点清理掉，这通常是幂等操作的前置步骤
                if patch.prune_actions:
                    self._prune_neighbors_atomic(tx, patch.prune_actions)

                # Step A: 显式删边
                if patch.edges_to_remove:
                    self._remove_edges_atomic(tx, patch.edges_to_remove)
                
                # Step B: 显式删点
                if patch.nodes_to_remove:
                    self._remove_nodes_atomic(tx, patch.nodes_to_remove)

                # Step C: 加点
                if patch.nodes_to_add:
                    self._add_nodes_atomic(tx, patch.nodes_to_add, patch.strategy)

                # Step D1: 属性更新
                if patch.node_property_updates:
                    self._update_nodes_atomic(tx, patch.node_property_updates)

                # Step D2: 列表更新
                if patch.node_list_updates:
                    self._update_node_lists_atomic(tx, patch.node_list_updates)

                # Step E: 加边
                if patch.edges_to_add:
                    self._add_edges_atomic(tx, patch.edges_to_add, patch.strategy)

                logger.debug(f"Patch applied. Prunes: {len(patch.prune_actions)}")

            except Exception as e:
                logger.error(f"Patch application failed: {e}")
                raise e

    # --- Abstract Atomic Operations ---

    @abstractmethod
    def _transaction_context(self): pass

    @abstractmethod
    def _remove_edges_atomic(self, tx: Any, edges: list): pass

    @abstractmethod
    def _remove_nodes_atomic(self, tx: Any, node_ids: set): pass

    @abstractmethod
    def _add_nodes_atomic(self, tx: Any, nodes: list, strategy: str): pass

    @abstractmethod
    def _add_edges_atomic(self, tx: Any, edges: list, strategy: str): pass

    @abstractmethod
    def _update_nodes_atomic(self, tx: Any, updates: list): pass

    @abstractmethod
    def _update_node_lists_atomic(self, tx: Any, updates: list): pass
    
    # [New] 新增抽象方法
    @abstractmethod
    def _prune_neighbors_atomic(self, tx: Any, prunes: List[PruneRequest]):
        """
        [Optimization] 批量执行盲删指令。
        实现类应利用 UNWIND 等批量操作。
        """
        pass