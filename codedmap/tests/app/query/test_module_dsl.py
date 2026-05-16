"""
Tests for module DSL methods: cpg.modules(), sort_by(), in_module(), module_files(), module_methods().

Structure tested:
  ModuleNode(1, "network")
    -[CONTAINS]-> FileNode(2, "tcp.c")
      -[AST]-> MethodNode(3, "tcp_send", tagged: SECURITY:ENTRY_POINT)
      -[AST]-> MethodNode(4, "tcp_recv", tagged: SINK:SQL)
    -[CONTAINS]-> FileNode(5, "udp.c")
      -[AST]-> MethodNode(6, "udp_send")
  ModuleNode(10, "driver")
    -[CONTAINS]-> FileNode(11, "main.c")
      -[AST]-> MethodNode(12, "main", tagged: SECURITY:ENTRY_POINT)
      -[AST]-> CallNode(13, "tcp_send")  # calls network module
"""

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Any, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.core.schema.graph.nodes import ModuleNode, FileNode, MethodNode, CallNode
from codedmap.core.schema.graph.enums import Language, NodeLabel, EdgeType
from codedmap.app.query.root import CPG
from codedmap.app.query.step import QueryStep


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


def make_call(id: int, name: str) -> CallNode:
    return CallNode(id=id, name=name, label=NodeLabel.CALL, code=f"{name}()")


def make_mock_store_for_dsl(nodes, edges, file_parent_map=None, modules_repo=None):
    """
    Build a mock CPGStore with full DSL support.

    Args:
        nodes: List of all nodes
        edges: List of (src, edge_type, dst) tuples
        file_parent_map: Dict mapping node_id -> FileNode (for .file() traversal)
        modules_repo: Mock modules repository with find_by_name
    """
    store = MagicMock()
    id_map = {n.id: n for n in nodes}
    file_parent_map = file_parent_map or {}

    # Build adjacency table
    graph: Dict = {}
    for src, etype, dst in edges:
        etype_val = etype.value if hasattr(etype, 'value') else str(etype)
        k_out = (src.id, etype_val, "OUT")
        k_in = (dst.id, etype_val, "IN")
        graph.setdefault(k_out, []).append(dst)
        graph.setdefault(k_in, []).append(src)

    class MockChain:
        """Fluent DSL mock supporting all needed operations."""

        def __init__(self, items):
            self._items = list(items) if items else []

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
            visited = set(item.id for item in self._items if item)
            frontier = [item for item in self._items if item]
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
                if item and item.id not in seen:
                    seen.add(item.id)
                    unique.append(item)
            return MockChain(unique)

        def filter(self, **kwargs):
            result = []
            for item in self._items:
                match = True
                for k, v in kwargs.items():
                    if getattr(item, k, None) != v:
                        match = False
                        break
                if match:
                    result.append(item)
            return MockChain(result)

        def limit(self, n):
            return MockChain(self._items[:n])

        def first(self):
            return self._items[0] if self._items else None

        def to_list(self):
            return self._items

        def count(self):
            return len(self._items)

        def __iter__(self):
            return iter(self._items)

        def __len__(self):
            return len(self._items)

    def by_id(nid):
        node = id_map.get(nid)
        return MockChain([node] if node else [])

    def by_ids(ids):
        items = [id_map.get(i) for i in ids if id_map.get(i)]
        return MockChain(items)

    def all_nodes(label=None):
        if label is None:
            return MockChain(nodes)
        label_val = label.value if hasattr(label, 'value') else str(label)
        filtered = [n for n in nodes if n.label.value == label_val or str(n.label) == label_val]
        return MockChain(filtered)

    def methods(name=None):
        filtered = [n for n in nodes if n.label == NodeLabel.METHOD]
        if name:
            filtered = [n for n in filtered if getattr(n, 'name', None) == name]
        return MockChain(filtered)

    def files(name=None):
        filtered = [n for n in nodes if n.label == NodeLabel.FILE]
        if name:
            filtered = [n for n in filtered if getattr(n, 'name', None) == name]
        return MockChain(filtered)

    # Setup store.query mock
    store.query.by_id.side_effect = by_id
    store.query.by_ids.side_effect = by_ids
    store.query.all_nodes.side_effect = all_nodes
    store.query.methods.side_effect = methods
    store.query.files.side_effect = files

    # Setup store.modules mock
    if modules_repo is None:
        modules_repo = MagicMock()

        def find_by_name(name, exact_match=True):
            filtered = [n for n in nodes if isinstance(n, ModuleNode) and n.name == name]
            return filtered

        modules_repo.find_by_name.side_effect = find_by_name

    store.modules = modules_repo

    # Setup get_node
    def get_node(nid):
        return id_map.get(nid)

    store.get_node.side_effect = get_node

    return store


# =========================================================================
# Test: cpg.modules() returns QueryStep
# =========================================================================

class TestCpgModules:
    """Tests for CPG.modules() method."""

    def test_cpg_modules_returns_querystep(self):
        """cpg.modules() should return a QueryStep."""
        mod1 = make_module(1, "network", "pkg.network")
        mod2 = make_module(2, "driver", "pkg.driver")
        nodes = [mod1, mod2]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules()
        assert isinstance(result, QueryStep)

    def test_cpg_modules_returns_all_modules(self):
        """cpg.modules() should return all ModuleNode instances."""
        mod1 = make_module(1, "network", "pkg.network")
        mod2 = make_module(2, "driver", "pkg.driver")
        nodes = [mod1, mod2]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules().to_list()
        assert len(result) == 2
        names = {m.name for m in result}
        assert "network" in names
        assert "driver" in names

    def test_cpg_modules_name_filter(self):
        """cpg.modules(name='x') should filter by name."""
        mod1 = make_module(1, "network", "pkg.network")
        mod2 = make_module(2, "driver", "pkg.driver")
        nodes = [mod1, mod2]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules(name="network").to_list()
        assert len(result) == 1
        assert result[0].name == "network"


# =========================================================================
# Test: sort_by() attack_surface
# =========================================================================

class TestSortBy:
    """Tests for QueryStep.sort_by() method."""

    def test_sort_by_attack_surface(self):
        """sort_by('attack_surface') should compute composite score and sort."""
        # Module A: high density, high ep, low sink
        mod_a = make_module(
            1, "mod_a", "pkg.a",
            density=0.8,
            entry_point_count=10,
            sink_count=2,
            method_count=20,
        )
        # Module B: low density, low ep, high sink
        mod_b = make_module(
            2, "mod_b", "pkg.b",
            density=0.2,
            entry_point_count=2,
            sink_count=10,
            method_count=10,
        )
        # Module C: medium all
        mod_c = make_module(
            3, "mod_c", "pkg.c",
            density=0.5,
            entry_point_count=5,
            sink_count=5,
            method_count=10,
        )
        nodes = [mod_a, mod_b, mod_c]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules().sort_by('attack_surface', reverse=True).to_list()

        # mod_a should be first (high density + high normalized ep)
        assert result[0].name == "mod_a"

    def test_sort_by_attribute(self):
        """sort_by('name') should sort by simple attribute."""
        mod_c = make_module(1, "charlie", "pkg.c")
        mod_a = make_module(2, "alpha", "pkg.a")
        mod_b = make_module(3, "bravo", "pkg.b")
        nodes = [mod_c, mod_a, mod_b]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules().sort_by('name', reverse=False).to_list()
        names = [m.name for m in result]
        assert names == ["alpha", "bravo", "charlie"]

    def test_sort_by_zero_metrics(self):
        """sort_by('attack_surface') should handle all-zero metrics without crash."""
        mod1 = make_module(1, "empty1", "pkg.e1", density=0.0, entry_point_count=0, sink_count=0)
        mod2 = make_module(2, "empty2", "pkg.e2", density=0.0, entry_point_count=0, sink_count=0)
        nodes = [mod1, mod2]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        # Should not crash
        result = cpg.modules().sort_by('attack_surface').to_list()
        assert len(result) == 2


# =========================================================================
# Test: in_module() filter
# =========================================================================

class TestInModule:
    """Tests for QueryStep.in_module() method."""

    def test_in_module_filters_nodes(self):
        """in_module() should filter methods by module membership."""
        # Setup: network module with tcp.c containing tcp_send
        mod_net = make_module(1, "network", "pkg.network")
        file_tcp = make_file(2, "tcp.c")
        m_tcp_send = make_method(3, "tcp_send", ["SECURITY:ENTRY_POINT:L1:NETWORK"])

        # driver module with main.c containing main
        mod_drv = make_module(10, "driver", "pkg.driver")
        file_main = make_file(11, "main.c")
        m_main = make_method(12, "main", ["SECURITY:ENTRY_POINT:L1:CLI"])

        nodes = [mod_net, file_tcp, m_tcp_send, mod_drv, file_main, m_main]
        edges = [
            (mod_net, EdgeType.CONTAINS, file_tcp),
            (file_tcp, EdgeType.AST, m_tcp_send),
            (mod_drv, EdgeType.CONTAINS, file_main),
            (file_main, EdgeType.AST, m_main),
        ]
        file_parent_map = {
            m_tcp_send.id: file_tcp,
            m_main.id: file_main,
        }

        store = make_mock_store_for_dsl(nodes, edges, file_parent_map)
        cpg = CPG(store)

        # Filter methods to network module only
        result = cpg.method().in_module("network").to_list()
        assert len(result) == 1
        assert result[0].name == "tcp_send"

    def test_in_module_not_found(self):
        """in_module() with non-existent module should return empty step."""
        mod = make_module(1, "network", "pkg.network")
        nodes = [mod]
        store = make_mock_store_for_dsl(nodes, [])
        cpg = CPG(store)

        result = cpg.modules().in_module("nonexistent").to_list()
        assert result == []


# =========================================================================
# Test: module_files() and module_methods()
# =========================================================================

class TestModuleConvenienceMethods:
    """Tests for CPG.module_files() and CPG.module_methods()."""

    def test_module_files(self):
        """module_files() should return correct FileNode instances."""
        mod = make_module(1, "network", "pkg.network")
        file_tcp = make_file(2, "tcp.c")
        file_udp = make_file(3, "udp.c")

        nodes = [mod, file_tcp, file_udp]
        edges = [
            (mod, EdgeType.CONTAINS, file_tcp),
            (mod, EdgeType.CONTAINS, file_udp),
        ]

        store = make_mock_store_for_dsl(nodes, edges)
        cpg = CPG(store)

        result = cpg.module_files("network").to_list()
        assert len(result) == 2
        names = {f.name for f in result}
        assert "tcp.c" in names
        assert "udp.c" in names

    def test_module_files_not_found(self):
        """module_files() with non-existent module should return empty step."""
        store = make_mock_store_for_dsl([], [])
        cpg = CPG(store)

        result = cpg.module_files("nonexistent").to_list()
        assert result == []

    def test_module_methods(self):
        """module_methods() should return correct MethodNode instances."""
        mod = make_module(1, "network", "pkg.network")
        file_tcp = make_file(2, "tcp.c")
        m_send = make_method(3, "tcp_send")
        m_recv = make_method(4, "tcp_recv")

        nodes = [mod, file_tcp, m_send, m_recv]
        edges = [
            (mod, EdgeType.CONTAINS, file_tcp),
            (file_tcp, EdgeType.AST, m_send),
            (file_tcp, EdgeType.AST, m_recv),
        ]

        store = make_mock_store_for_dsl(nodes, edges)
        cpg = CPG(store)

        result = cpg.module_methods("network").to_list()
        assert len(result) == 2
        names = {m.name for m in result}
        assert "tcp_send" in names
        assert "tcp_recv" in names

    def test_module_methods_not_found(self):
        """module_methods() with non-existent module should return empty step."""
        store = make_mock_store_for_dsl([], [])
        cpg = CPG(store)

        result = cpg.module_methods("nonexistent").to_list()
        assert result == []


# =========================================================================
# Test: module_nav property
# =========================================================================

class TestModuleNavProperty:
    """Tests for CPG.module_nav property."""

    def test_module_nav_lazy_init(self):
        """module_nav should be lazily initialized."""
        store = make_mock_store_for_dsl([], [])
        cpg = CPG(store)

        # Access should not raise
        nav = cpg.module_nav
        assert nav is not None

    def test_module_nav_caches_instance(self):
        """module_nav should cache the ModuleNavigator instance."""
        store = make_mock_store_for_dsl([], [])
        cpg = CPG(store)

        nav1 = cpg.module_nav
        nav2 = cpg.module_nav
        assert nav1 is nav2
