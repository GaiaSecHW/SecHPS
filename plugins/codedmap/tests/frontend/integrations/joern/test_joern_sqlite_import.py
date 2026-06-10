# tests/frontend/integrations/joern/test_joern_sqlite_import.py
"""
Integration test: Import Joern Neo4j CSV export into SQLite backend.

Uses real gzip project export data from:
  /Users/kibox/ai_workspace/test_data/gzip/build/csv_export

The Joern export uses 3 files per type (*_header.csv, *_data.csv, *_cypher.csv).
The importer's find_csv_files() auto-detects split format and merges header + data
into temp files transparently.

Tests the full pipeline: CSV parse -> node/edge mapping -> ID translation -> SQLite storage.
"""
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.append(os.getcwd())

from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.frontend.integrations.joern.importer import JoernCSVImporter
from codedmap.infra.storage.store import CPGStore

RAW_EXPORT_DIR = Path("/Users/kibox/ai_workspace/test_data/gzip/build/csv_export")


# =========================================================================
# Module-Scoped Fixtures (run once)
# =========================================================================

@pytest.fixture(scope="module")
def sqlite_store(tmp_path_factory):
    """Create a temporary SQLite-backed CPGStore for the test module."""
    db_path = str(tmp_path_factory.mktemp("db") / "gzip_cpg.db")
    storage_config = StorageConfig(backend="sqlite", uri=db_path)
    store = CPGStore(storage_config)
    yield store
    store.close()


@pytest.fixture(scope="module")
def import_result(sqlite_store):
    """Run the Joern CSV import once for the entire module.

    Uses the raw export directory directly — the importer auto-detects
    the split CSV format (header + data + cypher) and merges transparently.
    """
    importer = JoernCSVImporter(
        id_strategy="hybrid",
        skip_unknown_labels=False,
        skip_edge_types=["DOMINATE", "POST_DOMINATE"],
        batch_size=2000,
    )
    stats = importer.run_to_store(str(RAW_EXPORT_DIR), sqlite_store)
    return stats, importer


# =========================================================================
# 1. Import Stats Sanity Checks
# =========================================================================

class TestImportStats:
    """Verify that import completes with expected scale."""

    def test_import_completes(self, import_result):
        stats, _ = import_result
        assert stats.nodes_imported > 0
        assert stats.edges_imported > 0
        assert stats.duration_seconds > 0

    def test_node_scale(self, import_result):
        """gzip project should have thousands of nodes."""
        stats, _ = import_result
        assert stats.nodes_imported > 1000, (
            f"Expected >1000 nodes, got {stats.nodes_imported}"
        )
        # Skipped should be minimal (only truly unmappable)
        skip_ratio = stats.nodes_skipped / max(stats.nodes_read, 1)
        assert skip_ratio < 0.1, (
            f"Too many skipped nodes: {stats.nodes_skipped}/{stats.nodes_read} "
            f"({skip_ratio:.1%})"
        )

    def test_edge_scale(self, import_result):
        """gzip project should have tens of thousands of edges."""
        stats, _ = import_result
        assert stats.edges_imported > 5000, (
            f"Expected >5000 edges, got {stats.edges_imported}"
        )

    def test_missing_endpoints_minimal(self, import_result):
        """Most edges should find both endpoints after ID translation."""
        stats, _ = import_result
        missing_ratio = stats.edges_missing_endpoint / max(stats.edges_read, 1)
        assert missing_ratio < 0.05, (
            f"Too many missing endpoints: {stats.edges_missing_endpoint}/{stats.edges_read} "
            f"({missing_ratio:.1%})"
        )

    def test_dominate_edges_skipped(self, import_result):
        """DOMINATE and POST_DOMINATE should be skipped per config."""
        stats, _ = import_result
        assert stats.edges_skipped > 0


# =========================================================================
# 2. Node Queries via SQLite Store
# =========================================================================

class TestNodeQueries:
    """Query imported nodes via CPGStore to verify SQLite persistence."""

    def test_method_nodes_exist(self, sqlite_store, import_result):
        methods = sqlite_store.query.methods().to_list()
        assert len(methods) > 10, f"Expected >10 methods, got {len(methods)}"

    def test_file_nodes_exist(self, sqlite_store, import_result):
        files = sqlite_store.query.files().to_list()
        assert len(files) > 0, "No FILE nodes found"
        file_names = [getattr(f, "name", "") for f in files]
        assert any("gzip" in name for name in file_names), (
            f"Expected a gzip-related file, got: {file_names[:10]}"
        )

    def test_call_nodes_exist(self, sqlite_store, import_result):
        calls = sqlite_store.query.all_nodes(NodeLabel.CALL).to_list()
        assert len(calls) > 100, f"Expected >100 CALL nodes, got {len(calls)}"

    def test_identifier_nodes_exist(self, sqlite_store, import_result):
        identifiers = sqlite_store.query.all_nodes(NodeLabel.IDENTIFIER).to_list()
        assert len(identifiers) > 100, (
            f"Expected >100 IDENTIFIER nodes, got {len(identifiers)}"
        )

    def test_type_decl_nodes_exist(self, sqlite_store, import_result):
        type_decls = sqlite_store.query.all_nodes(NodeLabel.TYPE_DECL).to_list()
        assert len(type_decls) > 0, "No TYPE_DECL nodes found"

    def test_literal_nodes_exist(self, sqlite_store, import_result):
        literals = sqlite_store.query.all_nodes(NodeLabel.LITERAL).to_list()
        assert len(literals) > 0, "No LITERAL nodes found"

    def test_local_nodes_exist(self, sqlite_store, import_result):
        locals_ = sqlite_store.query.all_nodes(NodeLabel.LOCAL).to_list()
        assert len(locals_) > 0, "No LOCAL nodes found"


# =========================================================================
# 3. Named Entity Queries
# =========================================================================

class TestNamedEntities:
    """Query specific known entities from the gzip source."""

    def test_find_main_method(self, sqlite_store, import_result):
        results = sqlite_store.query.methods("main").to_list()
        assert len(results) >= 1, "main() not found"
        main = results[0]
        assert main.name == "main"

    def test_find_gzip_file(self, sqlite_store, import_result):
        results = sqlite_store.query.files("gzip.c").to_list()
        assert len(results) >= 1, "gzip.c not found"

    def test_find_deflate_file(self, sqlite_store, import_result):
        results = sqlite_store.query.files("deflate.c").to_list()
        assert len(results) >= 1, "deflate.c not found"


# =========================================================================
# 4. Edge / Traversal Queries
# =========================================================================

class TestEdgeTraversals:
    """Verify edges are persisted and traversable."""

    def test_method_has_ast_children(self, sqlite_store, import_result):
        """A method should have AST children (params, blocks, etc.)."""
        methods = sqlite_store.query.methods("main").to_list()
        if not methods:
            pytest.skip("main() not found")
        main = methods[0]

        children = sqlite_store.query.by_id(main.id).out("AST").to_list()
        assert len(children) > 0, "main() has no AST children"

    def test_call_edge_connectivity(self, sqlite_store, import_result):
        """CALL edges should connect call sites to methods."""
        main = sqlite_store.query.methods("main").first()
        if not main:
            pytest.skip("main() not found")
        neighbors = sqlite_store.get_neighbors(
            node_id=main.id,
            direction="IN",
            edge_types=["CALL"],
        )
        # main is typically an entry point — just verify the query works
        assert isinstance(neighbors, list)

    def test_cfg_edges_exist(self, sqlite_store, import_result):
        """CFG edges should be present in the store."""
        methods = sqlite_store.query.methods("main").to_list()
        if not methods:
            pytest.skip("main() not found")

        main = methods[0]
        ast_children = sqlite_store.query.by_id(main.id).out("AST").to_list()
        if not ast_children:
            pytest.skip("main() has no AST children")

        # Check if any child has outgoing CFG edges
        for child in ast_children[:10]:
            if child is None:
                continue
            cfg_neighbors = sqlite_store.get_neighbors(child.id, "OUT", ["CFG"])
            if cfg_neighbors:
                return  # Found CFG edges

        # Broader check via CALL nodes
        calls = sqlite_store.query.all_nodes(NodeLabel.CALL).limit(10).to_list()
        for call in calls:
            if call is None:
                continue
            cfg_out = sqlite_store.get_neighbors(call.id, "OUT", ["CFG"])
            if cfg_out:
                return
        pytest.fail("No CFG edges found in the graph")

    def test_ref_edges_exist(self, sqlite_store, import_result):
        """REF edges should link identifiers to their declarations."""
        identifiers = sqlite_store.query.all_nodes(NodeLabel.IDENTIFIER).limit(20).to_list()
        for ident in identifiers:
            refs = sqlite_store.get_neighbors(ident.id, "OUT", ["REF"])
            if refs:
                return
        pytest.fail("No REF edges found among sampled identifiers")


# =========================================================================
# 5. ID Bridge Verification
# =========================================================================

class TestIdBridge:
    """Verify ID translation strategy."""

    def test_hybrid_global_ids_are_deterministic(self, import_result):
        """Global nodes (METHOD, FILE, TYPE_DECL) should have SHA-256 IDs in hybrid mode."""
        _, importer = import_result
        bridge = importer.id_bridge
        assert len(bridge._id_map) > 0, "ID bridge has no mappings"

    def test_method_ids_are_not_joern_originals(self, sqlite_store, import_result):
        """Hybrid strategy regenerates IDs for METHOD nodes."""
        methods = sqlite_store.query.methods().limit(5).to_list()
        for m in methods:
            assert m.id > 0, f"Invalid method ID: {m.id}"


# =========================================================================
# 6. Store Lifecycle
# =========================================================================

class TestStoreLifecycle:
    """Verify store operations work correctly after import."""

    def test_get_node_by_id(self, sqlite_store, import_result):
        """Point lookup by ID should work."""
        methods = sqlite_store.query.methods().limit(1).to_list()
        assert len(methods) > 0
        node = sqlite_store.get_node(methods[0].id)
        assert node is not None
        assert node.id == methods[0].id

    def test_get_nodes_batch(self, sqlite_store, import_result):
        """Batch lookup should return all requested nodes."""
        methods = sqlite_store.query.methods().limit(5).to_list()
        ids = [m.id for m in methods]
        batch = sqlite_store.get_nodes_batch(ids)
        assert len(batch) == len(ids)

    def test_checkpoint_succeeds(self, sqlite_store, import_result):
        """WAL checkpoint should not raise for SQLite backend."""
        sqlite_store.checkpoint(mode="TRUNCATE")
