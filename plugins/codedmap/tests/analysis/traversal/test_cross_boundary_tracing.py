"""
Tests for cross-boundary backward traversal in BackwardTracingNavigator.

Verifies that edges of types IPC/SYSCALL/RPC/SHARED_DATA are followed backward
during trace_to_controllable(), and that resulting TraceHop entries have
hop_type == "cross_boundary".
"""

import sys
import os
import pytest
from typing import Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.nodes.declarations import MethodNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.analysis.traversal.tracing import BackwardTracingNavigator


# ---------------------------------------------------------------------------
# Minimal Mock Infrastructure
# ---------------------------------------------------------------------------

class _MockTags:
    """Stub for store.tags — returns empty tag list for all nodes."""

    def get_all(self, node) -> List[str]:
        return []


class _MockQueryChain:
    """Minimal query chain supporting in_() and out() for the tracing tests."""

    def __init__(self, db: "_MockGraphDB", node_ids: List[int]):
        self._db = db
        self._ids = list(node_ids)

    def by_id(self, nid: int) -> "_MockQueryChain":
        return _MockQueryChain(self._db, [nid])

    def in_(self, edge_type, target_class=None) -> "_MockQueryChain":
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        result_ids = []
        for nid in self._ids:
            for src, dst, etype in self._db.edges:
                if dst == nid and etype == et:
                    result_ids.append(src)
        return _MockQueryChain(self._db, result_ids)

    def out(self, edge_type, target_class=None) -> "_MockQueryChain":
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        result_ids = []
        for nid in self._ids:
            for src, dst, etype in self._db.edges:
                if src == nid and etype == et:
                    result_ids.append(dst)
        return _MockQueryChain(self._db, result_ids)

    def repeat(self, edge_type=None, direction="OUT", min_depth=0, max_depth=10,
               target_label=None) -> "_MockQueryChain":
        return _MockQueryChain(self._db, [])

    def limit(self, n: int) -> "_MockQueryChain":
        return _MockQueryChain(self._db, self._ids[:n])

    def first(self):
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node:
                return node
        return None

    def to_list(self) -> list:
        return [self._db.nodes[nid] for nid in self._ids if nid in self._db.nodes]

    def __iter__(self):
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node:
                yield node


class _MockGraphDB:
    def __init__(self):
        self.nodes: Dict[int, CPGNode] = {}
        self.edges: List[tuple] = []  # (src_id, dst_id, edge_type_value)

    def add_node(self, node: CPGNode):
        self.nodes[node.id] = node

    def add_edge(self, src_id: int, dst_id: int, edge_type):
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        self.edges.append((src_id, dst_id, et))


class _MockStore:
    """Minimal CPGStore stand-in for BackwardTracingNavigator unit tests."""

    def __init__(self, db: _MockGraphDB):
        self._db = db
        self.query = _MockQueryChain(db, [])
        self.tags = _MockTags()

    def get_node(self, node_id: int):
        return self._db.nodes.get(node_id)


def _make_method(node_id: int, name: str) -> MethodNode:
    return MethodNode(
        id=node_id,
        name=name,
        full_name=f"pkg.{name}",
        label=NodeLabel.METHOD,
        signature="void()",
    )


def _build_store(*items) -> _MockStore:
    """Build a mock store from (node | (src, dst, EdgeType)) items."""
    db = _MockGraphDB()
    for item in items:
        if isinstance(item, CPGNode):
            db.add_node(item)
        elif isinstance(item, tuple) and len(item) == 3:
            db.add_edge(*item)
    return _MockStore(db)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCrossBoundaryIpcTraversal:
    """test_cross_boundary_ipc_traversal: IPC edge A->B is followed backward from B."""

    def test_cross_boundary_ipc_traversal(self):
        node_a = _make_method(1001, "process_A")
        node_b = _make_method(1002, "process_B")
        # IPC edge A -> B (A communicates to B)
        store = _build_store(node_a, node_b, (node_a.id, node_b.id, EdgeType.IPC))

        nav = BackwardTracingNavigator(store)
        result = nav.trace_to_controllable(node_b, max_depth=5)

        # All node IDs seen in all paths
        all_node_ids = {hop.node_id for path in result.paths for hop in path.hops}
        assert node_a.id in all_node_ids, (
            f"Expected node_a ({node_a.id}) in trace paths; got ids: {all_node_ids}"
        )


class TestCrossBoundarySyscallTraversal:
    """test_cross_boundary_syscall_traversal: SYSCALL edge A->B is followed backward."""

    def test_cross_boundary_syscall_traversal(self):
        node_a = _make_method(2001, "kernel_handler")
        node_b = _make_method(2002, "userspace_caller")
        # SYSCALL edge: userspace_caller -> kernel_handler
        store = _build_store(node_a, node_b, (node_b.id, node_a.id, EdgeType.SYSCALL))

        nav = BackwardTracingNavigator(store)
        result = nav.trace_to_controllable(node_a, max_depth=5)

        all_node_ids = {hop.node_id for path in result.paths for hop in path.hops}
        assert node_b.id in all_node_ids, (
            f"Expected node_b ({node_b.id}) in trace paths via SYSCALL; got ids: {all_node_ids}"
        )


class TestCrossBoundaryNoFalseTraversal:
    """test_cross_boundary_no_false_traversal: AST edge A->B does NOT appear via cross-boundary."""

    def test_cross_boundary_no_false_traversal(self):
        node_a = _make_method(3001, "ast_parent")
        node_b = _make_method(3002, "ast_child")
        # AST edge only — should NOT be followed as cross-boundary
        store = _build_store(node_a, node_b, (node_a.id, node_b.id, EdgeType.AST))

        nav = BackwardTracingNavigator(store)
        result = nav.trace_to_controllable(node_b, max_depth=5)

        # Collect all cross_boundary hops
        cross_hops = [
            hop
            for path in result.paths
            for hop in path.hops
            if hop.hop_type == "cross_boundary"
        ]
        assert len(cross_hops) == 0, (
            f"Expected no cross_boundary hops for AST-only graph; got: {cross_hops}"
        )
        # node_a should NOT appear via cross-boundary
        cross_boundary_ids = {hop.node_id for hop in cross_hops}
        assert node_a.id not in cross_boundary_ids


class TestCrossBoundaryHopTypeLabel:
    """test_cross_boundary_hop_type_label: TraceHop.hop_type is 'cross_boundary' for IPC hops."""

    def test_cross_boundary_hop_type_label(self):
        node_a = _make_method(4001, "rpc_server")
        node_b = _make_method(4002, "rpc_client")
        # RPC edge: rpc_client -> rpc_server
        store = _build_store(node_a, node_b, (node_b.id, node_a.id, EdgeType.RPC))

        nav = BackwardTracingNavigator(store)
        result = nav.trace_to_controllable(node_a, max_depth=5)

        cross_hops = [
            hop
            for path in result.paths
            for hop in path.hops
            if hop.node_id == node_b.id
        ]
        assert len(cross_hops) >= 1, (
            f"Expected at least one hop with node_b ({node_b.id}); paths: {result.paths}"
        )
        for hop in cross_hops:
            assert hop.hop_type == "cross_boundary", (
                f"Expected hop_type='cross_boundary', got '{hop.hop_type}'"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
