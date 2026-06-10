# tests/infra/storage/test_module_repository.py
# Tests for ModuleRepository and modules() traversal entry point.

import pytest

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.nodes import ModuleNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph import CPGGraph


def _make_store():
    return CPGStore(StorageConfig(backend="memory"))


def _graph_with_nodes(nodes):
    graph = CPGGraph()
    for node in nodes:
        graph.add_node(node)
    return graph


def _make_module(node_id: int, name: str, full_name: str) -> ModuleNode:
    return ModuleNode(
        id=node_id,
        name=name,
        full_name=full_name,
        label=NodeLabel.MODULE,
    )


class TestModuleRepositoryMemoryDriver:

    def setup_method(self):
        self.store = _make_store()

    def teardown_method(self):
        self.store.close()

    # -------------------------------------------------------------------------
    # MOD-01: Repository wiring
    # -------------------------------------------------------------------------

    def test_modules_property_returns_module_repository(self):
        from codedmap.infra.storage.repository import ModuleRepository
        assert isinstance(self.store.modules, ModuleRepository)

    # -------------------------------------------------------------------------
    # MOD-01: find_by_name -- exact match
    # -------------------------------------------------------------------------

    def test_find_by_name_exact(self):
        module = _make_module(1, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.modules.find_by_name("ext4")
        assert len(result) == 1
        assert result[0].name == "ext4"

    def test_find_by_name_exact_no_match(self):
        module = _make_module(2, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.modules.find_by_name("bpf")
        assert len(result) == 0

    def test_find_by_name_exact_multiple_modules_returns_only_match(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "bpf", "kernel.bpf")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2]))
        result = self.store.modules.find_by_name("ext4")
        assert len(result) == 1
        assert result[0].name == "ext4"

    # -------------------------------------------------------------------------
    # MOD-01: find_by_name -- fuzzy (where_contains)
    # -------------------------------------------------------------------------

    def test_find_by_name_fuzzy(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "ext3", "fs.ext3")
        m3 = _make_module(3, "bpf", "kernel.bpf")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2, m3]))
        result = self.store.modules.find_by_name("ext", exact_match=False)
        assert len(result) == 2
        names = {r.name for r in result}
        assert names == {"ext4", "ext3"}

    def test_find_by_name_fuzzy_no_match(self):
        module = _make_module(1, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.modules.find_by_name("xfs", exact_match=False)
        assert len(result) == 0

    # -------------------------------------------------------------------------
    # MOD-01: find_by_full_name
    # -------------------------------------------------------------------------

    def test_find_by_full_name(self):
        module = _make_module(1, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.modules.find_by_full_name("fs.ext4")
        assert len(result) == 1
        assert result[0].full_name == "fs.ext4"

    def test_find_by_full_name_no_match(self):
        module = _make_module(1, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.modules.find_by_full_name("fs.xfs")
        assert len(result) == 0

    # -------------------------------------------------------------------------
    # MOD-02: Traversal source entry point
    # -------------------------------------------------------------------------

    def test_traversal_source_modules(self):
        module = _make_module(1, "bpf", "kernel.bpf")
        self.store._engine.writer.save_graph(_graph_with_nodes([module]))
        result = self.store.query.modules().to_list()
        assert len(result) == 1
        assert result[0].name == "bpf"

    def test_traversal_source_modules_with_name_filter(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "bpf", "kernel.bpf")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2]))
        result = self.store.query.modules("ext4").to_list()
        assert len(result) == 1
        assert result[0].name == "ext4"

    def test_traversal_source_modules_name_filter_no_match(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1]))
        result = self.store.query.modules("xfs").to_list()
        assert len(result) == 0

    def test_traversal_source_modules_no_filter_returns_all(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "bpf", "kernel.bpf")
        m3 = _make_module(3, "tcp", "net.ipv4.tcp")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2, m3]))
        result = self.store.query.modules().to_list()
        assert len(result) == 3

    # -------------------------------------------------------------------------
    # Edge cases: empty store
    # -------------------------------------------------------------------------

    def test_modules_empty_store(self):
        assert self.store.modules.find_all() == []
        assert self.store.query.modules().to_list() == []
        assert self.store.modules.find_by_name("ext4") == []
        assert self.store.modules.find_by_full_name("fs.ext4") == []

    # -------------------------------------------------------------------------
    # GenericRepository base methods
    # -------------------------------------------------------------------------

    def test_find_all(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "bpf", "kernel.bpf")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2]))
        result = self.store.modules.find_all()
        assert len(result) == 2
        labels = {r.label for r in result}
        assert labels == {NodeLabel.MODULE}

    def test_count(self):
        m1 = _make_module(1, "ext4", "fs.ext4")
        m2 = _make_module(2, "bpf", "kernel.bpf")
        m3 = _make_module(3, "tcp", "net.ipv4.tcp")
        self.store._engine.writer.save_graph(_graph_with_nodes([m1, m2, m3]))
        assert self.store.modules.count() == 3

    def test_count_empty_store(self):
        assert self.store.modules.count() == 0

    def test_find_all_respects_limit(self):
        nodes = [_make_module(i, f"mod{i}", f"sys.mod{i}") for i in range(1, 6)]
        self.store._engine.writer.save_graph(_graph_with_nodes(nodes))
        result = self.store.modules.find_all(limit=3)
        assert len(result) == 3
