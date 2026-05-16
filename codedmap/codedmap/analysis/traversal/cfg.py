# codedmap/analysis/traversal/cfg.py

from typing import Iterator, List, Optional, Union
from collections import deque
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from .base import BaseGraphNavigator, TraversalDirection


class ControlFlowNavigator(BaseGraphNavigator):
    """
    [Lazy Refactor] Control flow navigator.

    Queries statement execution order (Predecessors / Successors).
    Supports both intra-procedural (CFG) and inter-procedural (Call Graph)
    reachability analysis.
    """

    def get_predecessors(self, node: Union[CPGNode, int]) -> Iterator[CPGNode]:
        """
        [Lazy] Get predecessors of the current statement.
        Query: Node <-[CFG]- Predecessor
        """
        return self._get_neighbors(node, EdgeType.CFG, TraversalDirection.IN)

    def get_successors(self, node: Union[CPGNode, int]) -> Iterator[CPGNode]:
        """
        [Lazy] Get successors of the current statement.
        Query: Node -[CFG]-> Successor
        """
        return self._get_neighbors(node, EdgeType.CFG, TraversalDirection.OUT)

    # =========================================================================
    # Interprocedural helpers
    # =========================================================================

    def _find_enclosing_method_id(self, node_id: int) -> Optional[int]:
        """Find the METHOD node that encloses the given node via AST-IN traversal."""
        # Check if node itself is a METHOD
        node = self.store.query.by_id(node_id).first()
        if node:
            lbl = getattr(node, 'label', None)
            lbl_val = lbl.value if hasattr(lbl, 'value') else str(lbl)
            if lbl_val == 'METHOD':
                return node_id
        # Walk up AST to find enclosing METHOD
        method = (self.store.query.by_id(node_id)
                  .repeat(EdgeType.AST, direction="IN", min_depth=1, max_depth=20,
                          target_label=NodeLabel.METHOD)
                  .limit(1)
                  .first())
        return method.id if method else None

    def _get_callees_of_method(self, method_id: int) -> Iterator[int]:
        """Get IDs of methods called by the given method."""
        from codedmap.core.schema.graph.nodes import MethodNode
        callees = (self.store.query.by_id(method_id)
                   .descendants(target_label=NodeLabel.CALL, max_depth=100)
                   .out(EdgeType.CALL, target_class=MethodNode)
                   .distinct())
        for callee in callees:
            yield callee.id

    def _is_reachable_interprocedural(self, start_id: int, end_id: int, max_steps: int) -> bool:
        """Method-level reachability via call graph BFS."""
        src_method_id = self._find_enclosing_method_id(start_id)
        dst_method_id = self._find_enclosing_method_id(end_id)

        if src_method_id is None or dst_method_id is None:
            return False
        if src_method_id == dst_method_id:
            return True  # Same method = reachable (CFG might just be incomplete)

        # BFS on call graph
        visited = {src_method_id}
        queue = deque([(src_method_id, 0)])

        while queue:
            curr_id, depth = queue.popleft()
            if depth >= max_steps:
                continue
            for callee_id in self._get_callees_of_method(curr_id):
                if callee_id == dst_method_id:
                    return True
                if callee_id not in visited:
                    visited.add(callee_id)
                    queue.append((callee_id, depth + 1))

        return False

    def _find_path_interprocedural(self, start_id: int, end_id: int, max_steps: int) -> List[CPGNode]:
        """Find method-level path via call graph BFS with parent tracking."""
        src_method_id = self._find_enclosing_method_id(start_id)
        dst_method_id = self._find_enclosing_method_id(end_id)

        if src_method_id is None or dst_method_id is None:
            return []
        if src_method_id == dst_method_id:
            node = self.store.query.by_id(src_method_id).first()
            return [node] if node else []

        # BFS with parent tracking on call graph
        visited = {src_method_id}
        parent = {}  # child_method_id -> parent_method_id
        queue = deque([(src_method_id, 0)])
        found = False

        while queue and not found:
            curr_id, depth = queue.popleft()
            if depth >= max_steps:
                continue
            for callee_id in self._get_callees_of_method(curr_id):
                if callee_id not in visited:
                    visited.add(callee_id)
                    parent[callee_id] = curr_id
                    if callee_id == dst_method_id:
                        found = True
                        break
                    queue.append((callee_id, depth + 1))

        if not found:
            return []

        # Reconstruct path from dst_method to src_method
        path_ids = []
        curr = dst_method_id
        while curr in parent:
            path_ids.append(curr)
            curr = parent[curr]
        path_ids.append(src_method_id)
        path_ids.reverse()

        # Hydrate IDs to CPGNode objects
        path = []
        for mid in path_ids:
            node = self.store.query.by_id(mid).first()
            if node:
                path.append(node)
        return path

    # =========================================================================
    # Public API: Interprocedural reachability
    # =========================================================================

    def is_reachable_interprocedural(
        self, start: Union[CPGNode, int], end: Union[CPGNode, int], max_steps: int = 100
    ) -> bool:
        """
        Check interprocedural reachability at method level via call graph BFS.

        Finds the enclosing METHOD of start and end, then checks if
        the source method can reach the destination method through CALL edges.
        """
        start_id = self._ensure_node_id(start)
        end_id = self._ensure_node_id(end)
        if start_id == end_id:
            return True
        return self._is_reachable_interprocedural(start_id, end_id, max_steps)

    def find_path_interprocedural(
        self, start: Union[CPGNode, int], end: Union[CPGNode, int], max_steps: int = 100
    ) -> List[CPGNode]:
        """
        Find a method-level path via call graph BFS.

        Returns list of METHOD CPGNode objects forming the call path,
        or empty list if not reachable.
        """
        start_id = self._ensure_node_id(start)
        end_id = self._ensure_node_id(end)
        if start_id == end_id:
            node = self.store.query.by_id(start_id).first()
            return [node] if node else []
        return self._find_path_interprocedural(start_id, end_id, max_steps)

    # =========================================================================
    # Public API: Unified reachability (intra + inter procedural)
    # =========================================================================

    def is_reachable(self, start: Union[CPGNode, int], end: Union[CPGNode, int], max_steps: int = 100) -> bool:
        """
        [Structural Reachability] Check reachability (intra + inter procedural).

        Strategy:
        1. Try intra-procedural CFG reachability first (repeat on CFG edges).
        2. If not reachable, fallback to inter-procedural call graph reachability.
        """
        start_id = self._ensure_node_id(start)
        end_id = self._ensure_node_id(end)

        # 1. Self-reachability
        if start_id == end_id:
            return True

        # 2. Intra-procedural CFG reachability
        query = (self.store.query.by_id(start_id)
                 .repeat(EdgeType.CFG, direction="OUT", min_depth=1, max_depth=max_steps)
                 .filter(id=end_id)
                 .limit(1))

        if query.first() is not None:
            return True

        # 3. Fallback: inter-procedural call graph reachability
        return self._is_reachable_interprocedural(start_id, end_id, max_steps)

    def find_path(
        self,
        start: Union[CPGNode, int],
        end: Union[CPGNode, int],
        max_steps: int = 100,
    ) -> List[CPGNode]:
        """
        Find a path from start to end. Tries intra-procedural CFG first,
        falls back to interprocedural call graph path.

        Returns list of CPGNode objects forming the path (start -> ... -> end),
        or empty list if not reachable.
        """
        start_id = self._ensure_node_id(start)
        end_id = self._ensure_node_id(end)

        if start_id == end_id:
            node = self.store.query.by_id(start_id).first()
            return [node] if node else []

        # 1. Try intra-procedural CFG path via BFS
        cfg_path = self._find_path_cfg(start_id, end_id, max_steps)
        if cfg_path:
            return cfg_path

        # 2. Fallback: interprocedural call graph path
        return self._find_path_interprocedural(start_id, end_id, max_steps)

    def _find_path_cfg(self, start_id: int, end_id: int, max_steps: int) -> List[CPGNode]:
        """Find intra-procedural CFG path using BFS with parent tracking."""
        # BFS with parent tracking
        visited = {start_id}
        parent = {}  # child_id -> parent_id
        queue = deque([(start_id, 0)])
        node_cache = {}  # id -> CPGNode

        start_node = self.store.query.by_id(start_id).first()
        if start_node:
            node_cache[start_id] = start_node

        found = False
        while queue and not found:
            curr_id, depth = queue.popleft()
            if depth >= max_steps:
                continue

            for succ in self.get_successors(curr_id):
                if succ.id not in visited:
                    visited.add(succ.id)
                    parent[succ.id] = curr_id
                    node_cache[succ.id] = succ

                    if succ.id == end_id:
                        found = True
                        break

                    queue.append((succ.id, depth + 1))

        if not found:
            return []

        # Reconstruct path from end to start
        path = []
        curr = end_id
        while curr in parent:
            if curr in node_cache:
                path.append(node_cache[curr])
            curr = parent[curr]
        if start_id in node_cache:
            path.append(node_cache[start_id])

        path.reverse()
        return path
