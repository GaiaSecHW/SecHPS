# codedmap/analysis/algorithms/dominator.py

from typing import Dict, Set, List, Any, Optional, Tuple
from collections import defaultdict, deque
import logging

from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import MethodNode, MethodReturnNode

logger = logging.getLogger(__name__)

AUGMENTED_EXIT_ID = -99999


class PostDominatorTree:
    """
    后支配树与控制依赖计算器。

    算法: Cooper-Harvey-Kennedy (CHK) 迭代支配树 + 标准支配边界。
    Control Dependence = Dominance Frontier of Reverse CFG.

    替代了原先基于 networkx 的实现，在大函数上性能提升 5-10x。
    """

    __slots__ = (
        'cpg_graph', 'method', 'method_return',
        '_fwd_succs', '_fwd_preds',
        '_all_node_ids', '_cfg_participants',
        '_reachable_from_entry',
        'AUGMENTED_EXIT',
    )

    def __init__(self, graph: CPGGraph, method: MethodNode):
        self.cpg_graph = graph
        self.method = method
        self.method_return: Optional[MethodReturnNode] = None

        self._fwd_succs: Dict[int, List[int]] = defaultdict(list)
        self._fwd_preds: Dict[int, List[int]] = defaultdict(list)

        self._all_node_ids: Set[int] = set()
        self._cfg_participants: Set[int] = set()
        self._reachable_from_entry: Set[int] = set()

        self.AUGMENTED_EXIT = AUGMENTED_EXIT_ID

    def build_from_edges(self, nodes: List[AnyNode], cfg_edges: List[Any]):
        """
        构建内部图结构并添加 Augmented Exit。
        """
        node_ids = set()
        for n in nodes:
            node_ids.add(n.id)
            if isinstance(n, MethodReturnNode):
                self.method_return = n

        for edge in cfg_edges:
            if edge.src in node_ids and edge.dst in node_ids:
                self._fwd_succs[edge.src].append(edge.dst)
                self._fwd_preds[edge.dst].append(edge.src)
                self._cfg_participants.add(edge.src)
                self._cfg_participants.add(edge.dst)

        self._all_node_ids = node_ids

        # BFS 从 Method Entry 计算前向可达性
        if self.method.id in node_ids:
            self._reachable_from_entry = self._bfs_reachable(
                self.method.id, self._fwd_succs
            )

        # Augmented Exit 连接 (保证反向图连通性)
        # A. MethodReturn → Exit
        if self.method_return and self.method_return.id in node_ids:
            self._fwd_succs[self.method_return.id].append(self.AUGMENTED_EXIT)
            self._fwd_preds[self.AUGMENTED_EXIT].append(self.method_return.id)

        # B. 死代码/无后继节点 → Exit
        for nid in node_ids:
            if not self._fwd_succs.get(nid):
                self._fwd_succs[nid].append(self.AUGMENTED_EXIT)
                self._fwd_preds[self.AUGMENTED_EXIT].append(nid)

        self._all_node_ids.add(self.AUGMENTED_EXIT)

    @property
    def cfg_participants(self) -> Set[int]:
        """参与 CFG 边的节点集合 (有至少一条 CFG 入边或出边)。"""
        return self._cfg_participants

    def is_reachable_from_entry(self, node_id: int) -> bool:
        return node_id in self._reachable_from_entry

    def get_reachable_nodes(self) -> Set[int]:
        return self._reachable_from_entry

    def calculate_control_dependence(self) -> Dict[int, Set[int]]:
        """
        计算控制依赖。
        Returns: {Controller_ID: {Dependent_IDs}}
        """
        if len(self._all_node_ids) <= 1:
            return {}

        # 1. 构建反向图邻接表
        rev_succs: Dict[int, List[int]] = defaultdict(list)
        rev_preds: Dict[int, List[int]] = defaultdict(list)

        for nid in self._all_node_ids:
            for s in self._fwd_succs.get(nid, ()):
                if s in self._all_node_ids:
                    rev_succs[s].append(nid)
                    rev_preds[nid].append(s)

        # 2. 从 AUGMENTED_EXIT 计算反向图 RPO
        rpo_order, rpo_number = self._compute_rpo(rev_succs, self.AUGMENTED_EXIT)
        if len(rpo_order) <= 1:
            return {}

        # 3. CHK 迭代支配树算法 (在反向图上 = 后支配树)
        idom = self._compute_dominators(rpo_order, rpo_number, rev_preds)

        # 4. 支配边界 (在反向图上 = 控制依赖)
        df = self._compute_dominance_frontiers(rpo_order, idom, rev_preds)

        # 5. 转换格式: 反向图 DF 中 {dependent: {controllers}} → {controller: {dependents}}
        cdg_relations: Dict[int, Set[int]] = defaultdict(set)
        aug = self.AUGMENTED_EXIT
        for dependent, controllers in df.items():
            if dependent == aug:
                continue
            for controller in controllers:
                if controller == aug:
                    continue
                cdg_relations[controller].add(dependent)

        return cdg_relations

    # =========================================================================
    # Internal Algorithms
    # =========================================================================

    @staticmethod
    def _bfs_reachable(start: int, succs: Dict[int, List[int]]) -> Set[int]:
        visited = {start}
        queue = deque([start])
        while queue:
            n = queue.popleft()
            for s in succs.get(n, ()):
                if s not in visited:
                    visited.add(s)
                    queue.append(s)
        return visited

    @staticmethod
    def _compute_rpo(
        succs: Dict[int, List[int]], start: int
    ) -> Tuple[List[int], Dict[int, int]]:
        """
        Iterative DFS 计算 Reverse Post-Order (正确处理环)。
        Returns: (rpo_list, rpo_number_map)
        """
        visited: Set[int] = set()
        postorder: List[int] = []
        stack: List[Tuple[int, bool]] = [(start, False)]

        while stack:
            node, expanded = stack.pop()
            if expanded:
                postorder.append(node)
                continue
            if node in visited:
                continue
            visited.add(node)
            stack.append((node, True))
            for s in succs.get(node, ()):
                if s not in visited:
                    stack.append((s, False))

        postorder.reverse()
        rpo_number = {n: i for i, n in enumerate(postorder)}
        return postorder, rpo_number

    @staticmethod
    def _compute_dominators(
        rpo_order: List[int],
        rpo_number: Dict[int, int],
        preds: Dict[int, List[int]],
    ) -> Dict[int, int]:
        """
        Cooper-Harvey-Kennedy 迭代支配树算法。
        Returns: {node: immediate_dominator}
        """
        start = rpo_order[0]
        idom: Dict[int, int] = {start: start}

        def intersect(b1: int, b2: int) -> int:
            f1, f2 = b1, b2
            n1, n2 = rpo_number.get(f1, -1), rpo_number.get(f2, -1)
            while f1 != f2:
                while n1 > n2:
                    f1 = idom[f1]
                    n1 = rpo_number.get(f1, -1)
                while n2 > n1:
                    f2 = idom[f2]
                    n2 = rpo_number.get(f2, -1)
            return f1

        changed = True
        while changed:
            changed = False
            for b in rpo_order[1:]:
                preds_b = preds.get(b)
                if not preds_b:
                    continue

                new_idom = None
                for p in preds_b:
                    if p in idom:
                        new_idom = p
                        break
                if new_idom is None:
                    continue

                for p in preds_b:
                    if p == new_idom:
                        continue
                    if p in idom:
                        new_idom = intersect(p, new_idom)

                if idom.get(b) != new_idom:
                    idom[b] = new_idom
                    changed = True

        return idom

    @staticmethod
    def _compute_dominance_frontiers(
        rpo_order: List[int],
        idom: Dict[int, int],
        preds: Dict[int, List[int]],
    ) -> Dict[int, Set[int]]:
        """
        标准支配边界算法 (Cytron et al.)。
        """
        df: Dict[int, Set[int]] = defaultdict(set)
        max_steps = len(rpo_order)

        for b in rpo_order:
            preds_b = preds.get(b)
            if not preds_b or len(preds_b) < 2:
                continue

            idom_b = idom.get(b)
            for p in preds_b:
                runner = p
                steps = 0
                while runner != idom_b and runner in idom and steps < max_steps:
                    df[runner].add(b)
                    if runner == idom[runner]:
                        break
                    runner = idom[runner]
                    steps += 1

        return df
