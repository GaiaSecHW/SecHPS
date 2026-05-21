"""
Tests for ModuleNavigator traversal and metric computation.

Structure tested:
  ModuleNode(1)
    -[CONTAINS]-> FileNode(2)
      -[AST]-> MethodNode(3)  (tagged: ONTOLOGY:ENTRY_POINT:HTTP)
      -[AST]-> MethodNode(4)  (tagged: ONTOLOGY:SINK:SQL_INJECTION)
      -[AST]-> MethodNode(5)  (no tags)
    -[CONTAINS]-> ModuleNode(6)  (sub-module)
"""

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Any, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.core.schema.graph.nodes import ModuleMetrics, ModuleNode, FileNode, MethodNode
from codedmap.core.schema.graph.enums import Language, NodeLabel, EdgeType


# =========================================================================
# Helpers
# =========================================================================

def make_module(id: int, name: str, full_name: str, **kwargs) -> ModuleNode:
    return ModuleNode(id=id, name=name, fullName=full_name, **kwargs)


def make_file(id: int, name: str) -> FileNode:
    return FileNode(id=id, name=name, fullName=name, language=Language.C)


def make_method(id: int, name: str, tags: Optional[List[str]] = None) -> MethodNode:
    node = MethodNode(id=id, name=name, fullName=f"module.{name}")
    node.tags = tags or []
    return node


def make_mock_store(nodes, edges):
    """
    Build a mock CPGStore.
    edges: list of (src_node, edge_type, dst_node)
    """
    store = MagicMock()
    id_map = {n.id: n for n in nodes}

    # Build adjacency table: (node_id, edge_type_value, direction) -> [nodes]
    graph: Dict = {}
    for src, etype, dst in edges:
        etype_val = etype.value if hasattr(etype, 'value') else str(etype)
        k_out = (src.id, etype_val, "OUT")
        k_in = (dst.id, etype_val, "IN")
        graph.setdefault(k_out, []).append(dst)
        graph.setdefault(k_in, []).append(src)

    class MockChain:
        """Fluent DSL mock. Supports by_id -> out/in_ -> filter -> first/list."""

        def __init__(self, items):
            self._items = list(items)

        # --- Traversal ---

        def out(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                neighbors = graph.get((item.id, et, "OUT"), [])
                for n in neighbors:
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)

        def in_(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                neighbors = graph.get((item.id, et, "IN"), [])
                for n in neighbors:
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)

        def descendants(self, target_label=None, max_depth=10):
            """BFS over AST edges."""
            visited = set(item.id for item in self._items)
            frontier = list(self._items)
            result = []
            for _ in range(max_depth):
                next_frontier = []
                for node in frontier:
                    et = EdgeType.AST.value
                    for child in graph.get((node.id, et, "OUT"), []):
                        if child.id not in visited:
                            visited.add(child.id)
                            next_frontier.append(child)
                            label_val = child.label.value if hasattr(child.label, 'value') else str(child.label)
                            tl_val = target_label.value if hasattr(target_label, 'value') else str(target_label) if target_label else None
                            if tl_val is None or label_val == tl_val:
                                result.append(child)
                frontier = next_frontier
                if not frontier:
                    break
            return MockChain(result)

        def distinct(self):
            seen = set()
            unique = []
            for item in self._items:
                if item.id not in seen:
                    seen.add(item.id)
                    unique.append(item)
            return MockChain(unique)

        def first(self):
            return self._items[0] if self._items else None

        def __iter__(self):
            return iter(self._items)

        def __len__(self):
            return len(self._items)

    def by_id(nid):
        node = id_map.get(nid)
        items = [node] if node else []
        return MockChain(items)

    store.query.by_id.side_effect = by_id
    return store


# =========================================================================
# Task 1 Tests: ModuleMetrics model
# =========================================================================

class TestModuleMetrics:
    """Tests for the ModuleMetrics Pydantic model."""

    def test_default_instantiation(self):
        m = ModuleMetrics()
        assert m.entry_point_count == 0
        assert m.method_count == 0
        assert m.sink_count == 0
        assert m.density == 0.0
        assert m.file_count == 0

    def test_custom_instantiation(self):
        m = ModuleMetrics(
            entry_point_count=3,
            method_count=10,
            sink_count=2,
            density=0.3,
            file_count=5,
        )
        assert m.entry_point_count == 3
        assert m.method_count == 10
        assert m.sink_count == 2
        assert m.density == 0.3
        assert m.file_count == 5

    def test_frozen(self):
        """ModuleMetrics must be frozen (immutable)."""
        m = ModuleMetrics(entry_point_count=1)
        with pytest.raises(Exception):  # ValidationError or AttributeError
            m.entry_point_count = 99  # type: ignore


class TestModuleNodeMetricFields:
    """Tests for optional cached metric fields on ModuleNode."""

    def test_metric_fields_default_none(self):
        node = ModuleNode(id=1, name="test", fullName="test.mod")
        assert node.entry_point_count is None
        assert node.method_count is None
        assert node.sink_count is None
        assert node.density is None
        assert node.file_count is None

    def test_metric_fields_can_be_set(self):
        node = ModuleNode(
            id=1,
            name="test",
            fullName="test.mod",
            entry_point_count=2,
            method_count=8,
            sink_count=1,
            density=0.25,
            file_count=3,
        )
        assert node.entry_point_count == 2
        assert node.method_count == 8
        assert node.sink_count == 1
        assert node.density == 0.25
        assert node.file_count == 3


# =========================================================================
# Task 2 Tests: ModuleNavigator traversal and metrics
# =========================================================================

class TestModuleNavigatorTraversal:
    """Tests for ModuleNavigator traversal methods."""

    def setup_method(self):
        from codedmap.analysis.traversal.module import ModuleNavigator

        self.mod = make_module(1, "net", "kernel.net")
        self.file1 = make_file(2, "tcp.c")
        self.file2 = make_file(3, "udp.c")
        self.submod = make_module(6, "ipv4", "kernel.net.ipv4")

        self.m1 = make_method(4, "tcp_send", ["ONTOLOGY:ENTRY_POINT:HTTP"])
        self.m2 = make_method(5, "tcp_recv", ["ONTOLOGY:SINK:SQL_INJECTION"])
        self.m3 = make_method(7, "udp_send", [])

        nodes = [self.mod, self.file1, self.file2, self.submod, self.m1, self.m2, self.m3]
        edges = [
            (self.mod, EdgeType.CONTAINS, self.file1),
            (self.mod, EdgeType.CONTAINS, self.file2),
            (self.mod, EdgeType.CONTAINS, self.submod),
            (self.file1, EdgeType.AST, self.m1),
            (self.file1, EdgeType.AST, self.m2),
            (self.file2, EdgeType.AST, self.m3),
        ]
        self.store = make_mock_store(nodes, edges)
        self.nav = ModuleNavigator(self.store)

    def test_get_files(self):
        files = list(self.nav.get_files(self.mod))
        assert len(files) == 2
        file_ids = {f.id for f in files}
        assert 2 in file_ids
        assert 3 in file_ids

    def test_get_files_by_id(self):
        """get_files should accept int node ID."""
        files = list(self.nav.get_files(1))
        assert len(files) == 2

    def test_get_methods(self):
        methods = list(self.nav.get_methods(self.mod))
        method_ids = {m.id for m in methods}
        assert 4 in method_ids  # tcp_send
        assert 5 in method_ids  # tcp_recv
        assert 7 in method_ids  # udp_send

    def test_get_methods_no_duplicates(self):
        """Methods must be deduplicated (distinct)."""
        methods = list(self.nav.get_methods(self.mod))
        ids = [m.id for m in methods]
        assert len(ids) == len(set(ids))

    def test_get_submodules(self):
        submods = list(self.nav.get_submodules(self.mod))
        assert len(submods) == 1
        assert submods[0].id == 6

    def test_get_submodules_excludes_files(self):
        """get_submodules should only return ModuleNode children, not FileNodes."""
        submods = list(self.nav.get_submodules(self.mod))
        for s in submods:
            assert isinstance(s, ModuleNode)


class TestModuleNavigatorMetrics:
    """Tests for ModuleNavigator.get_metrics()."""

    def setup_method(self):
        from codedmap.analysis.traversal.module import ModuleNavigator

        self.mod = make_module(1, "net", "kernel.net")
        self.file1 = make_file(2, "tcp.c")

        # 2 entry points (SECURITY:ENTRY_POINT prefix), 1 sink (SINK: prefix), 1 untagged
        self.m1 = make_method(3, "tcp_send", ["ONTOLOGY:ENTRY_POINT:HTTP"])
        self.m2 = make_method(4, "tcp_connect", ["ONTOLOGY:ENTRY_POINT:CLI"])
        self.m3 = make_method(5, "tcp_write_buf", ["ONTOLOGY:SINK:MEMORY_CORRUPTION"])
        self.m4 = make_method(6, "tcp_init", [])

        nodes = [self.mod, self.file1, self.m1, self.m2, self.m3, self.m4]
        edges = [
            (self.mod, EdgeType.CONTAINS, self.file1),
            (self.file1, EdgeType.AST, self.m1),
            (self.file1, EdgeType.AST, self.m2),
            (self.file1, EdgeType.AST, self.m3),
            (self.file1, EdgeType.AST, self.m4),
        ]
        self.store = make_mock_store(nodes, edges)
        self.nav = ModuleNavigator(self.store)

    def test_get_metrics_compute_true(self):
        metrics = self.nav.get_metrics(self.mod, compute=True)
        assert metrics is not None
        assert metrics.method_count == 4
        assert metrics.file_count == 1
        assert metrics.entry_point_count == 2  # m1 and m2
        assert metrics.sink_count == 1  # m3

    def test_density_calculation(self):
        metrics = self.nav.get_metrics(self.mod, compute=True)
        expected_density = 2 / 4  # entry_points / methods
        assert abs(metrics.density - expected_density) < 1e-9

    def test_density_zero_when_no_methods(self):
        """Density should be 0.0 when there are no methods (avoid division by zero)."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod = make_module(99, "empty", "empty.mod")
        file_empty = make_file(100, "empty.c")
        nodes = [mod, file_empty]
        edges = [(mod, EdgeType.CONTAINS, file_empty)]
        store = make_mock_store(nodes, edges)
        nav = ModuleNavigator(store)

        metrics = nav.get_metrics(mod, compute=True)
        assert metrics.density == 0.0

    def test_get_metrics_compute_false_no_cache(self):
        """Returns None when compute=False and no cached metrics exist."""
        metrics = self.nav.get_metrics(self.mod, compute=False)
        assert metrics is None

    def test_get_metrics_compute_false_with_cached(self):
        """Returns cached ModuleMetrics when cached fields exist on node."""
        cached_mod = make_module(
            10, "cached", "cached.mod",
            entry_point_count=5,
            method_count=20,
            sink_count=3,
            density=0.25,
            file_count=4,
        )
        nodes = [cached_mod]
        edges = []
        store = make_mock_store(nodes, edges)
        from codedmap.analysis.traversal.module import ModuleNavigator
        nav = ModuleNavigator(store)

        metrics = nav.get_metrics(cached_mod, compute=False)
        assert metrics is not None
        assert metrics.entry_point_count == 5
        assert metrics.method_count == 20
        assert metrics.sink_count == 3
        assert metrics.density == 0.25
        assert metrics.file_count == 4

    def test_has_cached_metrics_false(self):
        from codedmap.analysis.traversal.module import ModuleNavigator
        nav = ModuleNavigator(self.store)
        assert nav.has_cached_metrics(self.mod) is False

    def test_has_cached_metrics_true(self):
        from codedmap.analysis.traversal.module import ModuleNavigator

        cached_mod = make_module(11, "cached2", "cached2.mod", entry_point_count=1, method_count=5)
        nodes = [cached_mod]
        store = make_mock_store(nodes, [])
        nav = ModuleNavigator(store)
        assert nav.has_cached_metrics(cached_mod) is True

    def test_entry_point_tag_prefix_matching(self):
        """ONTOLOGY:ENTRY_POINT: prefix should match. Legacy formats rejected."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod = make_module(20, "mod", "test.mod")
        f = make_file(21, "f.c")
        # Two ONTOLOGY entry points, one ONTOLOGY sink, one unrelated
        m_qualified = make_method(22, "m1", ["ONTOLOGY:ENTRY_POINT:HTTP"])
        m_exact = make_method(23, "m2", ["ONTOLOGY:ENTRY_POINT:CLI"])
        m_sink = make_method(24, "m3", ["ONTOLOGY:SINK:SQL_INJECTION"])
        m_unrelated = make_method(25, "m4", ["SEMANTIC:TAINT_SOURCE"])  # should NOT count

        nodes = [mod, f, m_qualified, m_exact, m_sink, m_unrelated]
        edges = [
            (mod, EdgeType.CONTAINS, f),
            (f, EdgeType.AST, m_qualified),
            (f, EdgeType.AST, m_exact),
            (f, EdgeType.AST, m_sink),
            (f, EdgeType.AST, m_unrelated),
        ]
        store = make_mock_store(nodes, edges)
        nav = ModuleNavigator(store)

        metrics = nav.get_metrics(mod, compute=True)
        assert metrics.entry_point_count == 2  # m_qualified and m_exact
        assert metrics.sink_count == 1  # m_sink


# =========================================================================
# Task 2 Tests: ContextLoader integration and __init__ exports
# =========================================================================

class TestContextLoaderIntegration:
    """ModuleNavigator should be registered in ContextLoader."""

    def test_context_loader_has_module_attr(self):
        from codedmap.analysis.traversal.context import ContextLoader
        from codedmap.analysis.traversal.module import ModuleNavigator

        store = MagicMock()
        loader = ContextLoader(store)
        assert hasattr(loader, "module")
        assert isinstance(loader.module, ModuleNavigator)


class TestTraversalExports:
    """ModuleNavigator must be importable from the traversal package."""

    def test_import_from_package(self):
        from codedmap.analysis.traversal import ModuleNavigator
        assert ModuleNavigator is not None

    def test_in_all(self):
        import codedmap.analysis.traversal as traversal
        assert "ModuleNavigator" in traversal.__all__


# =========================================================================
# Plan 10-02 Task 1 Tests: compute_metrics with GraphPatch caching
# =========================================================================

class TestComputeMetrics:
    """Tests for ModuleNavigator.compute_metrics() with GraphPatch caching."""

    def setup_method(self):
        from codedmap.analysis.traversal.module import ModuleNavigator

        self.mod = make_module(1, "net", "kernel.net")
        self.file1 = make_file(2, "tcp.c")
        self.m1 = make_method(3, "tcp_send", ["ONTOLOGY:ENTRY_POINT:HTTP"])
        self.m2 = make_method(4, "tcp_recv", ["ONTOLOGY:SINK:SQL_INJECTION"])
        self.m3 = make_method(5, "tcp_init", [])

        nodes = [self.mod, self.file1, self.m1, self.m2, self.m3]
        edges = [
            (self.mod, EdgeType.CONTAINS, self.file1),
            (self.file1, EdgeType.AST, self.m1),
            (self.file1, EdgeType.AST, self.m2),
            (self.file1, EdgeType.AST, self.m3),
        ]
        self.store = make_mock_store(nodes, edges)
        self.nav = ModuleNavigator(self.store)

    def test_compute_metrics_returns_correct_values(self):
        metrics = self.nav.compute_metrics(self.mod, cache=False)
        assert metrics.method_count == 3
        assert metrics.file_count == 1
        assert metrics.entry_point_count == 1
        assert metrics.sink_count == 1
        assert abs(metrics.density - 1 / 3) < 1e-9

    def test_compute_metrics_cache_true_calls_apply_patch(self):
        self.nav.compute_metrics(self.mod, cache=True)
        self.store.apply_patch.assert_called_once()
        patch = self.store.apply_patch.call_args[0][0]
        assert len(patch.node_property_updates) == 1
        update = patch.node_property_updates[0]
        assert update.id == 1
        assert update.properties["entry_point_count"] == 1
        assert update.properties["method_count"] == 3
        assert update.properties["sink_count"] == 1
        assert update.properties["file_count"] == 1
        assert abs(update.properties["density"] - 1 / 3) < 1e-9

    def test_compute_metrics_cache_false_no_patch(self):
        self.nav.compute_metrics(self.mod, cache=False)
        self.store.apply_patch.assert_not_called()

    def test_get_metrics_compute_true_delegates(self):
        """get_metrics(compute=True) should delegate to compute_metrics and call apply_patch."""
        metrics = self.nav.get_metrics(self.mod, compute=True)
        assert metrics is not None
        assert metrics.method_count == 3
        self.store.apply_patch.assert_called_once()


# =========================================================================
# Plan 10-02 Task 2 Tests: get_fan_in
# =========================================================================

def make_mock_store_with_file_lookup(nodes, edges, file_parent_map):
    """
    Build a mock CPGStore with .file() support.
    file_parent_map: dict mapping node_id -> FileNode
    """
    store = MagicMock()
    id_map = {n.id: n for n in nodes}

    graph: Dict = {}
    for src, etype, dst in edges:
        etype_val = etype.value if hasattr(etype, 'value') else str(etype)
        k_out = (src.id, etype_val, "OUT")
        k_in = (dst.id, etype_val, "IN")
        graph.setdefault(k_out, []).append(dst)
        graph.setdefault(k_in, []).append(src)

    class MockChain:
        def __init__(self, items):
            self._items = list(items)

        def out(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                neighbors = graph.get((item.id, et, "OUT"), [])
                for n in neighbors:
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)

        def in_(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                neighbors = graph.get((item.id, et, "IN"), [])
                for n in neighbors:
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)

        def descendants(self, target_label=None, max_depth=10):
            visited = set(item.id for item in self._items)
            frontier = list(self._items)
            result = []
            for _ in range(max_depth):
                next_frontier = []
                for node in frontier:
                    et = EdgeType.AST.value
                    for child in graph.get((node.id, et, "OUT"), []):
                        if child.id not in visited:
                            visited.add(child.id)
                            next_frontier.append(child)
                            label_val = child.label.value if hasattr(child.label, 'value') else str(child.label)
                            tl_val = target_label.value if hasattr(target_label, 'value') else str(target_label) if target_label else None
                            if tl_val is None or label_val == tl_val:
                                result.append(child)
                frontier = next_frontier
                if not frontier:
                    break
            return MockChain(result)

        def file(self):
            """Resolve each item to its enclosing FileNode via file_parent_map."""
            result = []
            for item in self._items:
                f = file_parent_map.get(item.id)
                if f is not None:
                    result.append(f)
            return MockChain(result)

        def distinct(self):
            seen = set()
            unique = []
            for item in self._items:
                if item.id not in seen:
                    seen.add(item.id)
                    unique.append(item)
            return MockChain(unique)

        def first(self):
            return self._items[0] if self._items else None

        def __iter__(self):
            return iter(self._items)

        def __len__(self):
            return len(self._items)

    def by_id(nid):
        node = id_map.get(nid)
        items = [node] if node else []
        return MockChain(items)

    store.query.by_id.side_effect = by_id
    return store


class TestFanIn:
    """Tests for ModuleNavigator.get_fan_in()."""

    def test_fan_in_counts_external_callers(self):
        """External files calling module methods should be counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod_a = make_module(1, "mod_a", "pkg.mod_a")
        file1 = make_file(2, "file1.c")
        m1 = make_method(3, "m1", [])
        m2 = make_method(4, "m2", [])

        ext_file3 = make_file(10, "ext3.c")
        ext_file4 = make_file(11, "ext4.c")
        ext_m4 = make_method(12, "ext_m4", [])
        ext_m5 = make_method(13, "ext_m5", [])

        nodes = [mod_a, file1, m1, m2, ext_file3, ext_file4, ext_m4, ext_m5]
        edges = [
            (mod_a, EdgeType.CONTAINS, file1),
            (file1, EdgeType.AST, m1),
            (file1, EdgeType.AST, m2),
            (ext_file3, EdgeType.AST, ext_m4),
            (ext_file4, EdgeType.AST, ext_m5),
            (ext_m4, EdgeType.CALL, m1),
            (ext_m5, EdgeType.CALL, m2),
        ]
        file_parent_map = {
            ext_m4.id: ext_file3,
            ext_m5.id: ext_file4,
        }
        store = make_mock_store_with_file_lookup(nodes, edges, file_parent_map)
        nav = ModuleNavigator(store)

        assert nav.get_fan_in(mod_a) == 2

    def test_fan_in_excludes_internal_callers(self):
        """Calls from within the module own files should NOT be counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod = make_module(1, "mod", "pkg.mod")
        file1 = make_file(2, "f1.c")
        file2 = make_file(3, "f2.c")
        m1 = make_method(4, "m1", [])
        m2 = make_method(5, "m2", [])

        ext_file = make_file(10, "ext.c")
        ext_m = make_method(11, "ext_m", [])

        nodes = [mod, file1, file2, m1, m2, ext_file, ext_m]
        edges = [
            (mod, EdgeType.CONTAINS, file1),
            (mod, EdgeType.CONTAINS, file2),
            (file1, EdgeType.AST, m1),
            (file2, EdgeType.AST, m2),
            (ext_file, EdgeType.AST, ext_m),
            (m2, EdgeType.CALL, m1),
            (ext_m, EdgeType.CALL, m1),
        ]
        file_parent_map = {
            m2.id: file2,
            ext_m.id: ext_file,
        }
        store = make_mock_store_with_file_lookup(nodes, edges, file_parent_map)
        nav = ModuleNavigator(store)

        assert nav.get_fan_in(mod) == 1

    def test_fan_in_empty_module(self):
        """Module with no methods should return 0."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod = make_module(1, "empty", "pkg.empty")
        file1 = make_file(2, "empty.c")

        nodes = [mod, file1]
        edges = [(mod, EdgeType.CONTAINS, file1)]
        store = make_mock_store_with_file_lookup(nodes, edges, {})
        nav = ModuleNavigator(store)

        assert nav.get_fan_in(mod) == 0

    def test_fan_in_no_external_callers(self):
        """Module with methods but only internal calls returns 0."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        mod = make_module(1, "mod", "pkg.mod")
        file1 = make_file(2, "f1.c")
        m1 = make_method(3, "m1", [])
        m2 = make_method(4, "m2", [])

        nodes = [mod, file1, m1, m2]
        edges = [
            (mod, EdgeType.CONTAINS, file1),
            (file1, EdgeType.AST, m1),
            (file1, EdgeType.AST, m2),
            (m2, EdgeType.CALL, m1),
        ]
        file_parent_map = {m2.id: file1}
        store = make_mock_store_with_file_lookup(nodes, edges, file_parent_map)
        nav = ModuleNavigator(store)

        assert nav.get_fan_in(mod) == 0
