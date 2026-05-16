"""
Storage Semantics Contract Tests

Tests for COR-01 and COR-02: Cross-backend storage semantics contract for memory/sqlite backends.

These tests verify that:
1. save(graph) preserves parallel DDG edges with distinct variable values
2. save(graph) preserves parallel CFG edges with distinct label values
3. add_edges_batch() preserves semantic variants
4. PDG evidence (DDG + CDG) round-trips correctly
5. Endpoint-only edge removal is coarse by design (removes all semantic variants)
"""

import pytest
import tempfile
from pathlib import Path

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode, BlockNode
from codedmap.core.schema.graph.edges import CPGEdge, EdgeType
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore


# =============================================================================
# Test Fixtures
# =============================================================================

def create_method_with_two_blocks():
    """
    Create a minimal graph with:
    - One method
    - Two block nodes
    - Two DDG edges between same blocks with different variables
    - Two CFG edges between same blocks with different labels
    """
    graph = CPGGraph()

    # Create method
    method = MethodNode(
        id=1001,
        name="test_method",
        full_name="test_file.c::test_method",
        code="void test_method() {}"
    )
    graph.add_node(method)

    # Create two block nodes
    block1 = BlockNode(id=2001, order=0)
    block2 = BlockNode(id=2002, order=1)
    graph.add_node(block1)
    graph.add_node(block2)

    # Add AST edges
    graph.add_edge(method, block1, EdgeType.AST)
    graph.add_edge(method, block2, EdgeType.AST)

    # Add two DDG edges with DIFFERENT variables between same nodes
    # This is the key scenario: same (src, dst, type) but different semantic property
    graph.add_ddg_edge(block1, block2, variable="x")
    graph.add_ddg_edge(block1, block2, variable="y")

    # Add two CFG edges with DIFFERENT labels between same nodes
    # Another key scenario: same (src, dst, type) but different semantic property
    graph.add_cfg_edge(block1, block2, label="true")
    graph.add_cfg_edge(block1, block2, label="false")

    return graph, method, block1, block2


def create_pdg_fixture():
    """
    Create a representative PDG fixture combining DDG and CDG edges.
    This simulates real audit-relevant evidence shapes.
    """
    graph = CPGGraph()

    # Create a simple control structure scenario
    method = MethodNode(
        id=3001,
        name="pdg_test_method",
        full_name="test.c::pdg_test",
        code="void pdg_test() { if (x) { y = a; } else { y = b; } }"
    )
    graph.add_node(method)

    # Blocks
    entry_block = BlockNode(id=3002, order=0)
    true_block = BlockNode(id=3003, order=1)
    false_block = BlockNode(id=3004, order=2)
    merge_block = BlockNode(id=3005, order=3)

    for b in [entry_block, true_block, false_block, merge_block]:
        graph.add_node(b)
        graph.add_edge(method, b, EdgeType.AST)

    # CFG edges (control flow)
    graph.add_cfg_edge(entry_block, true_block, label="true")
    graph.add_cfg_edge(entry_block, false_block, label="false")
    graph.add_cfg_edge(true_block, merge_block, label=None)
    graph.add_cfg_edge(false_block, merge_block, label=None)

    # CDG edges (control dependency)
    graph.add_edge(entry_block, true_block, EdgeType.CDG)
    graph.add_edge(entry_block, false_block, EdgeType.CDG)

    # DDG edges (data dependency) - multiple edges with different variables
    graph.add_ddg_edge(true_block, merge_block, variable="y")
    graph.add_ddg_edge(false_block, merge_block, variable="y")

    return graph, method


# =============================================================================
# Memory Backend Contract Tests
# =============================================================================

class TestMemoryStorageSemantics:
    """Contract tests for memory backend."""

    def test_memory_ddg_parallel_edges_preserved_by_save_graph(self):
        """
        Test 1: save(graph) on memory preserves two DDG edges between
        the same (src, dst) when properties.variable differs.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        # Create memory store and save
        store = CPGStore(StorageConfig(backend="memory"))
        store.save(graph)

        # Retrieve the subgraph containing our blocks
        subgraph = store.get_subgraph([block1.id, block2.id])

        # Get DDG edges between block1 and block2
        ddg_edges = [
            e for e in subgraph.edges
            if e.src == block1.id and e.dst == block2.id and e.type == EdgeType.DDG
        ]

        # Assert both edges are preserved
        assert len(ddg_edges) == 2, f"Expected 2 DDG edges, got {len(ddg_edges)}"

        # Verify variables are distinct
        variables = {e.properties.get("variable") for e in ddg_edges}
        assert variables == {"x", "y"}, f"Expected variables x and y, got {variables}"

    def test_memory_cfg_parallel_edges_preserved_by_save_graph(self):
        """
        Test 2: save(graph) on memory preserves two CFG edges between
        the same (src, dst) when properties.label differs.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        store = CPGStore(StorageConfig(backend="memory"))
        store.save(graph)

        subgraph = store.get_subgraph([block1.id, block2.id])

        # Get CFG edges between block1 and block2
        cfg_edges = [
            e for e in subgraph.edges
            if e.src == block1.id and e.dst == block2.id and e.type == EdgeType.CFG
        ]

        # Assert both edges are preserved
        assert len(cfg_edges) == 2, f"Expected 2 CFG edges, got {len(cfg_edges)}"

        # Verify labels are distinct
        labels = {e.properties.get("label") for e in cfg_edges}
        assert labels == {"true", "false"}, f"Expected labels true and false, got {labels}"

    def test_memory_add_edges_batch_preserves_semantic_variants(self):
        """
        Test 3: store.add_edges_batch() on memory preserves the same DDG/CFG
        semantic variants instead of collapsing by endpoint and type only.
        """
        # Create a minimal graph with just nodes
        graph = CPGGraph()
        method = MethodNode(id=4001, name="m", full_name="test::m")
        block1 = BlockNode(id=4002, order=0)
        block2 = BlockNode(id=4003, order=1)
        for n in [method, block1, block2]:
            graph.add_node(n)

        store = CPGStore(StorageConfig(backend="memory"))
        store.save(graph)

        # Now use add_edges_batch to add parallel edges
        edges_to_add = [
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "x"}},
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "y"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "true"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "false"}},
        ]
        store.add_edges_batch(edges_to_add)

        subgraph = store.get_subgraph([block1.id, block2.id])

        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]

        assert len(ddg_edges) == 2, f"Expected 2 DDG edges after batch, got {len(ddg_edges)}"
        assert len(cfg_edges) == 2, f"Expected 2 CFG edges after batch, got {len(cfg_edges)}"

        variables = {e.properties.get("variable") for e in ddg_edges}
        labels = {e.properties.get("label") for e in cfg_edges}

        assert variables == {"x", "y"}, f"Expected variables x and y, got {variables}"
        assert labels == {"true", "false"}, f"Expected labels true and false, got {labels}"

    def test_memory_pdg_contract_preserves_evidence_shape(self):
        """
        Test 4: A representative PDG fixture combining DDG and CDG edges
        round-trips on memory and keeps the evidence shape expected by
        later PDG-style traversals.
        """
        graph, method = create_pdg_fixture()

        store = CPGStore(StorageConfig(backend="memory"))
        store.save(graph)

        # Retrieve full subgraph for method
        subgraph = store.get_subgraph([n.id for n in graph.nodes.values()])

        # Verify CDG edges exist
        cdg_edges = [e for e in subgraph.edges if e.type == EdgeType.CDG]
        assert len(cdg_edges) == 2, f"Expected 2 CDG edges, got {len(cdg_edges)}"

        # Verify DDG edges exist with correct variables
        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        assert len(ddg_edges) == 2, f"Expected 2 DDG edges, got {len(ddg_edges)}"

        # Verify CFG edges exist with correct labels
        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]
        assert len(cfg_edges) == 4, f"Expected 4 CFG edges, got {len(cfg_edges)}"

        # Verify branching labels are distinct
        branch_labels = {e.properties.get("label") for e in cfg_edges if e.properties.get("label")}
        assert "true" in branch_labels, "Missing 'true' branch label"
        assert "false" in branch_labels, "Missing 'false' branch label"

    def test_memory_coarse_delete_removes_all_semantic_variants(self):
        """
        Test 5: Endpoint-only edge removal remains coarse by design.
        Removing (src, dst, type) removes all semantic variants for that triple,
        and the test names/comments state that this is intentional Phase 19 behavior.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        store = CPGStore(StorageConfig(backend="memory"))
        store.save(graph)

        # Verify edges exist before removal
        subgraph_before = store.get_subgraph([block1.id, block2.id])
        ddg_before = [e for e in subgraph_before.edges if e.type == EdgeType.DDG]
        assert len(ddg_before) == 2, "Expected 2 DDG edges before removal"

        # Remove edge by endpoint only (coarse delete)
        # This should remove BOTH DDG edges with variables x and y
        store._engine.db.graph.remove_edge(block1.id, block2.id, EdgeType.DDG)

        # Verify both variants were removed
        subgraph_after = store.get_subgraph([block1.id, block2.id])
        ddg_after = [e for e in subgraph_after.edges if e.type == EdgeType.DDG]
        assert len(ddg_after) == 0, f"Expected 0 DDG edges after coarse delete, got {len(ddg_after)}"

        # Document: This is intentional Phase 19 behavior.
        # Endpoint-based removal deletes ALL semantic variants for that triple.
        # Future phases may widen the deletion API to support semantic discrimination.


# =============================================================================
# SQLite Backend Contract Tests
# =============================================================================

class TestSQLiteStorageSemantics:
    """Contract tests for SQLite backend."""

    def test_sqlite_ddg_parallel_edges_preserved_by_save_graph(self, tmp_path):
        """
        Test 1: store.save(graph) on SQLite preserves same-endpoint DDG edges
        with distinct variable values.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        db_path = tmp_path / "test_ddg.db"
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store.save(graph)

        subgraph = store.get_subgraph([block1.id, block2.id])

        ddg_edges = [
            e for e in subgraph.edges
            if e.src == block1.id and e.dst == block2.id and e.type == EdgeType.DDG
        ]

        assert len(ddg_edges) == 2, f"Expected 2 DDG edges in SQLite, got {len(ddg_edges)}"

        variables = {e.properties.get("variable") for e in ddg_edges}
        assert variables == {"x", "y"}, f"Expected variables x and y in SQLite, got {variables}"

    def test_sqlite_cfg_parallel_edges_preserved_by_save_graph(self, tmp_path):
        """
        Test 2: store.save(graph) on SQLite preserves same-endpoint CFG edges
        with distinct label values.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        db_path = tmp_path / "test_cfg.db"
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store.save(graph)

        subgraph = store.get_subgraph([block1.id, block2.id])

        cfg_edges = [
            e for e in subgraph.edges
            if e.src == block1.id and e.dst == block2.id and e.type == EdgeType.CFG
        ]

        assert len(cfg_edges) == 2, f"Expected 2 CFG edges in SQLite, got {len(cfg_edges)}"

        labels = {e.properties.get("label") for e in cfg_edges}
        assert labels == {"true", "false"}, f"Expected labels true and false in SQLite, got {labels}"

    def test_sqlite_add_edges_batch_preserves_semantic_variants(self, tmp_path):
        """
        Test 3: store.add_edges_batch() on SQLite preserves DDG/CFG semantic variants
        and round-trips them through the reader without dropping properties.
        """
        graph = CPGGraph()
        method = MethodNode(id=5001, name="m", full_name="test::m")
        block1 = BlockNode(id=5002, order=0)
        block2 = BlockNode(id=5003, order=1)
        for n in [method, block1, block2]:
            graph.add_node(n)

        db_path = tmp_path / "test_batch.db"
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store.save(graph)

        edges_to_add = [
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "x"}},
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "y"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "true"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "false"}},
        ]
        store.add_edges_batch(edges_to_add)

        subgraph = store.get_subgraph([block1.id, block2.id])

        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]

        assert len(ddg_edges) == 2, f"Expected 2 DDG edges after batch in SQLite, got {len(ddg_edges)}"
        assert len(cfg_edges) == 2, f"Expected 2 CFG edges after batch in SQLite, got {len(cfg_edges)}"

        # Verify properties are preserved (not dropped)
        variables = {e.properties.get("variable") for e in ddg_edges}
        labels = {e.properties.get("label") for e in cfg_edges}

        assert variables == {"x", "y"}, f"SQLite dropped DDG variable properties: {variables}"
        assert labels == {"true", "false"}, f"SQLite dropped CFG label properties: {labels}"

    def test_sqlite_pdg_contract_matches_memory_behavior(self, tmp_path):
        """
        Test 4: SQLite contract behavior matches memory for a representative PDG
        scenario that combines CDG and DDG evidence.
        """
        graph, method = create_pdg_fixture()

        db_path = tmp_path / "test_pdg.db"
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store.save(graph)

        subgraph = store.get_subgraph([n.id for n in graph.nodes.values()])

        # Verify CDG edges exist
        cdg_edges = [e for e in subgraph.edges if e.type == EdgeType.CDG]
        assert len(cdg_edges) == 2, f"Expected 2 CDG edges in SQLite, got {len(cdg_edges)}"

        # Verify DDG edges exist with correct variables
        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        assert len(ddg_edges) == 2, f"Expected 2 DDG edges in SQLite, got {len(ddg_edges)}"

        # Verify CFG edges exist with correct labels
        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]
        assert len(cfg_edges) == 4, f"Expected 4 CFG edges in SQLite, got {len(cfg_edges)}"

    def test_sqlite_semantic_uniqueness_ddg_different_variables(self, tmp_path):
        """
        Additional test: Verify SQLite allows inserting DDG edges with same endpoints
        but different variables after schema migration.
        """
        graph = CPGGraph()
        block1 = BlockNode(id=6001, order=0)
        block2 = BlockNode(id=6002, order=1)
        graph.add_node(block1)
        graph.add_node(block2)

        db_path = tmp_path / "test_uniqueness.db"
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store.save(graph)

        # Add first DDG edge
        store.add_edges_batch([
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "first"}}
        ])

        # Add second DDG edge with different variable - should NOT be ignored
        store.add_edges_batch([
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "second"}}
        ])

        subgraph = store.get_subgraph([block1.id, block2.id])
        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]

        assert len(ddg_edges) == 2, f"Expected 2 DDG edges (both variables), got {len(ddg_edges)}"

        variables = {e.properties.get("variable") for e in ddg_edges}
        assert variables == {"first", "second"}, f"Expected both variables, got {variables}"


# =============================================================================
# Cross-Backend Contract Tests
# =============================================================================

class TestCrossBackendSemanticsContract:
    """Tests verifying memory and SQLite produce equivalent semantic behavior."""

    @pytest.mark.parametrize("backend", ["memory", "sqlite"])
    def test_cross_backend_ddg_preservation(self, tmp_path, backend):
        """
        COR-01: save(graph) preserves parallel DDG edges with different variable values
        on both memory and sqlite backends.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        if backend == "sqlite":
            db_path = tmp_path / f"cross_ddg_{backend}.db"
            store = CPGStore(StorageConfig(backend=backend, uri=str(db_path)))
        else:
            store = CPGStore(StorageConfig(backend=backend))

        store.save(graph)
        subgraph = store.get_subgraph([block1.id, block2.id])

        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        assert len(ddg_edges) == 2

        variables = {e.properties.get("variable") for e in ddg_edges}
        assert variables == {"x", "y"}

    @pytest.mark.parametrize("backend", ["memory", "sqlite"])
    def test_cross_backend_cfg_preservation(self, tmp_path, backend):
        """
        COR-01: save(graph) preserves parallel CFG edges with different label values
        on both memory and sqlite backends.
        """
        graph, method, block1, block2 = create_method_with_two_blocks()

        if backend == "sqlite":
            db_path = tmp_path / f"cross_cfg_{backend}.db"
            store = CPGStore(StorageConfig(backend=backend, uri=str(db_path)))
        else:
            store = CPGStore(StorageConfig(backend=backend))

        store.save(graph)
        subgraph = store.get_subgraph([block1.id, block2.id])

        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]
        assert len(cfg_edges) == 2

        labels = {e.properties.get("label") for e in cfg_edges}
        assert labels == {"true", "false"}

    @pytest.mark.parametrize("backend", ["memory", "sqlite"])
    def test_cross_backend_add_edges_batch_semantic_preservation(self, tmp_path, backend):
        """
        COR-01: add_edges_batch() preserves DDG/CFG semantic variants on both backends.
        """
        graph = CPGGraph()
        method = MethodNode(id=7001, name="m", full_name="test::m")
        block1 = BlockNode(id=7002, order=0)
        block2 = BlockNode(id=7003, order=1)
        for n in [method, block1, block2]:
            graph.add_node(n)

        if backend == "sqlite":
            db_path = tmp_path / f"cross_batch_{backend}.db"
            store = CPGStore(StorageConfig(backend=backend, uri=str(db_path)))
        else:
            store = CPGStore(StorageConfig(backend=backend))

        store.save(graph)

        edges_to_add = [
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "x"}},
            {"src": block1.id, "dst": block2.id, "type": "DDG", "properties": {"variable": "y"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "true"}},
            {"src": block1.id, "dst": block2.id, "type": "CFG", "properties": {"label": "false"}},
        ]
        store.add_edges_batch(edges_to_add)

        subgraph = store.get_subgraph([block1.id, block2.id])

        ddg_edges = [e for e in subgraph.edges if e.type == EdgeType.DDG]
        cfg_edges = [e for e in subgraph.edges if e.type == EdgeType.CFG]

        assert len(ddg_edges) == 2
        assert len(cfg_edges) == 2


# =============================================================================
# Edge Identity Helper Tests
# =============================================================================

class TestEdgeSemanticIdentity:
    """Tests for the canonical edge_semantic_identity helper."""

    def test_ddg_semantic_identity_variable(self):
        """DDG edges use 'variable' as semantic slot."""
        from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

        slot, value = edge_semantic_identity("DDG", {"variable": "x"})
        assert slot == "variable"
        assert value == "x"

    def test_ddg_semantic_identity_none_properties(self):
        """DDG with None properties returns variable slot with empty string value."""
        from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

        slot, value = edge_semantic_identity("DDG", None)
        assert slot == "variable"
        assert value == ""

    def test_cfg_semantic_identity_label(self):
        """CFG edges use 'label' as semantic slot."""
        from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

        slot, value = edge_semantic_identity("CFG", {"label": "true"})
        assert slot == "label"
        assert value == "true"

    def test_cfg_semantic_identity_none_properties(self):
        """CFG with None properties returns label slot with empty string value."""
        from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

        slot, value = edge_semantic_identity("CFG", None)
        assert slot == "label"
        assert value == ""

    def test_non_semantic_edge_returns_none_empty_string(self):
        """Non-semantic edge types (AST, CALL, etc.) return (None, "")."""
        from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

        for edge_type in ["AST", "CALL", "REF", "CDG", "CONTAINS"]:
            slot, value = edge_semantic_identity(edge_type, {"some": "property"})
            assert slot is None, f"{edge_type} should have no semantic slot"
            assert value == "", f"{edge_type} should have empty string semantic value"

    def test_semantic_hash_includes_variable(self):
        """Hash for DDG edges with different variables differ."""
        from codedmap.infra.storage.base.edge_identity import compute_semantic_edge_hash

        hash_x = compute_semantic_edge_hash(1, 2, "DDG", {"variable": "x"})
        hash_y = compute_semantic_edge_hash(1, 2, "DDG", {"variable": "y"})

        assert hash_x != hash_y, "DDG edges with different variables should have different hashes"

    def test_semantic_hash_includes_label(self):
        """Hash for CFG edges with different labels differ."""
        from codedmap.infra.storage.base.edge_identity import compute_semantic_edge_hash

        hash_true = compute_semantic_edge_hash(1, 2, "CFG", {"label": "true"})
        hash_false = compute_semantic_edge_hash(1, 2, "CFG", {"label": "false"})

        assert hash_true != hash_false, "CFG edges with different labels should have different hashes"

    def test_semantic_hash_non_semantic_edges(self):
        """Hash for non-semantic edges does not include properties."""
        from codedmap.infra.storage.base.edge_identity import compute_semantic_edge_hash

        hash1 = compute_semantic_edge_hash(1, 2, "AST", {"order": 0})
        hash2 = compute_semantic_edge_hash(1, 2, "AST", {"order": 1})

        # For non-semantic edges, the properties don't affect the hash
        assert hash1 == hash2, "Non-semantic edges should hash the same regardless of properties"


# =============================================================================
# Neo4j Backend Contract Tests (Fake-Client, No Live Neo4j)
# =============================================================================

class TestNeo4jWriterSemanticContract:
    """
    Contract tests verifying Neo4j write paths produce semantic-aware
    Cypher payloads. Uses a fake Neo4j client to capture generated queries
    without requiring a live database.

    Phase 19 note: These tests validate that the *generated* Cypher merge
    patterns include semantic identity fields (__semantic_slot, __semantic_value)
    so that same-endpoint DDG/CFG edges are not collapsed by endpoint-only merge.
    """

    def test_neo4j_ddg_batch_write_produces_distinct_semantic_payloads(self):
        """
        Test 1: Neo4j batch writes for same-endpoint DDG edges with different
        variables produce distinct semantic-aware relationship merge payloads.
        """
        from codedmap.infra.storage.driver_neo4j.cypher import DataPrep
        from codedmap.core.schema.graph.edges import CPGEdge, EdgeType

        edge_x = CPGEdge(src=100, dst=200, type=EdgeType.DDG, properties={"variable": "x"})
        edge_y = CPGEdge(src=100, dst=200, type=EdgeType.DDG, properties={"variable": "y"})

        data_x, type_x = DataPrep.edge_to_dict(edge_x)
        data_y, type_y = DataPrep.edge_to_dict(edge_y)

        assert type_x == "DDG"
        assert type_y == "DDG"

        # Both payloads should carry semantic identity fields
        assert "__semantic_slot" in data_x["p"], "DDG payload missing __semantic_slot"
        assert "__semantic_value" in data_x["p"], "DDG payload missing __semantic_value"
        assert data_x["p"]["__semantic_slot"] == "variable"
        assert data_x["p"]["__semantic_value"] == "x"

        assert data_y["p"]["__semantic_slot"] == "variable"
        assert data_y["p"]["__semantic_value"] == "y"

        # The semantic values must differ so Neo4j MERGE treats them as distinct
        assert data_x["p"]["__semantic_value"] != data_y["p"]["__semantic_value"]

    def test_neo4j_cfg_patch_write_includes_semantic_identity(self):
        """
        Test 2: Neo4j transactional patch writes for same-endpoint CFG edges
        with different labels also include semantic identity instead of
        endpoint-only merge behavior.
        """
        from codedmap.infra.storage.driver_neo4j.cypher import DataPrep
        from codedmap.core.schema.graph.edges import CPGEdge, EdgeType

        edge_true = CPGEdge(src=100, dst=200, type=EdgeType.CFG, properties={"label": "true"})
        edge_false = CPGEdge(src=100, dst=200, type=EdgeType.CFG, properties={"label": "false"})

        data_true, _ = DataPrep.edge_to_dict(edge_true)
        data_false, _ = DataPrep.edge_to_dict(edge_false)

        assert data_true["p"]["__semantic_slot"] == "label"
        assert data_true["p"]["__semantic_value"] == "true"

        assert data_false["p"]["__semantic_slot"] == "label"
        assert data_false["p"]["__semantic_value"] == "false"

    def test_neo4j_pdg_fixture_preserves_evidence_shape(self):
        """
        Test 3: A representative PDG fixture preserves the combined CDG + DDG
        evidence shape through the Neo4j writer/read contract. All semantic-
        aware edges carry identity fields; non-semantic edges carry empty
        semantic values.
        """
        from codedmap.infra.storage.driver_neo4j.cypher import DataPrep
        from codedmap.core.schema.graph.edges import CPGEdge, EdgeType

        # CDG edges (non-semantic)
        cdg_edge = CPGEdge(src=300, dst=301, type=EdgeType.CDG, properties={})
        data_cdg, type_cdg = DataPrep.edge_to_dict(cdg_edge)
        assert type_cdg == "CDG"
        # Non-semantic edges should carry empty semantic identity
        assert data_cdg["p"]["__semantic_value"] == ""

        # DDG edges with different variables (semantic)
        ddg_y = CPGEdge(src=301, dst=305, type=EdgeType.DDG, properties={"variable": "y"})
        data_ddg, type_ddg = DataPrep.edge_to_dict(ddg_y)
        assert type_ddg == "DDG"
        assert data_ddg["p"]["__semantic_slot"] == "variable"
        assert data_ddg["p"]["__semantic_value"] == "y"

        # CFG branching edges (semantic)
        cfg_true = CPGEdge(src=302, dst=303, type=EdgeType.CFG, properties={"label": "true"})
        cfg_false = CPGEdge(src=302, dst=304, type=EdgeType.CFG, properties={"label": "false"})

        data_t, _ = DataPrep.edge_to_dict(cfg_true)
        data_f, _ = DataPrep.edge_to_dict(cfg_false)

        assert data_t["p"]["__semantic_value"] == "true"
        assert data_f["p"]["__semantic_value"] == "false"

    def test_neo4j_read_strips_reserved_semantic_keys(self):
        """
        Test 4: Reading back Neo4j relationships strips reserved internal
        semantic identity keys so public CPGEdge.properties only contain
        graph-semantic fields.
        """
        from codedmap.infra.storage.base.converter import DataConverter

        # Simulate a Neo4j record dict that includes internal semantic fields
        fake_record = {
            "src": 100,
            "dst": 200,
            "type": "DDG",
            "props": {
                "variable": "x",
                "__semantic_slot": "variable",
                "__semantic_value": "x",
            }
        }

        edge = DataConverter.to_cpg_edge(fake_record)
        assert edge is not None
        assert edge.properties.get("variable") == "x"

        # Internal fields must NOT leak into public properties
        assert "__semantic_slot" not in edge.properties, \
            "__semantic_slot leaked into public CPGEdge.properties"
        assert "__semantic_value" not in edge.properties, \
            "__semantic_value leaked into public CPGEdge.properties"

    def test_neo4j_merge_template_includes_semantic_fields(self):
        """
        Test 5: The EDGE_MERGE template includes semantic identity fields
        in the MERGE pattern so Neo4j does not collapse same-endpoint edges.
        """
        from codedmap.infra.storage.driver_neo4j.cypher import CypherTemplates

        merge_template = CypherTemplates.EDGE_MERGE
        assert "__semantic_value" in merge_template, \
            "EDGE_MERGE template must include __semantic_value in merge pattern"

    def test_neo4j_non_semantic_edge_carries_empty_identity(self):
        """
        Test 6: Non-semantic edge types (AST, CALL, etc.) carry empty string
        semantic identity, ensuring they still match the merge template.
        """
        from codedmap.infra.storage.driver_neo4j.cypher import DataPrep
        from codedmap.core.schema.graph.edges import CPGEdge, EdgeType

        ast_edge = CPGEdge(src=100, dst=200, type=EdgeType.AST, properties={"order": 0})
        data, _ = DataPrep.edge_to_dict(ast_edge)

        # Non-semantic edges should use empty string for merge compat
        assert data["p"]["__semantic_value"] == ""
        # Slot is None for non-semantic, stored as "" for consistency
        assert data["p"]["__semantic_slot"] == ""
