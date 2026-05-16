import os
import sys
from pathlib import Path

sys.path.append(os.getcwd())

from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.core.schema.graph.nodes import (
    MethodNode, CallNode, FileNode, IdentifierNode, LiteralNode,
    BlockNode, LocalNode, TypeDeclNode, NamespaceBlockNode,
)
from codedmap.frontend.integrations.joern.importer import JoernCSVImporter

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestJoernCSVImporter:
    """Integration tests: import fixture CSV and verify resulting CPGGraph."""

    def _import_graph(self, strategy="passthrough"):
        importer = JoernCSVImporter(id_strategy=strategy)
        stats = importer.run(str(FIXTURES_DIR))
        graph = importer.get_graph()
        return graph, stats, importer

    def test_import_completes(self):
        graph, stats, _ = self._import_graph()
        assert stats.nodes_imported > 0
        assert stats.edges_imported > 0
        assert stats.duration_seconds >= 0

    def test_node_count(self):
        graph, stats, _ = self._import_graph()
        # We have 21 nodes in the fixture
        assert stats.nodes_imported == 21
        assert stats.nodes_skipped == 0

    def test_edge_count(self):
        graph, stats, _ = self._import_graph()
        # We have 23 edges in the fixture
        assert stats.edges_imported == 23
        assert stats.edges_missing_endpoint == 0

    def test_method_node_present(self):
        graph, _, _ = self._import_graph()
        methods = [n for n in graph.nodes.values()
                   if hasattr(n, 'label') and
                   (n.label == NodeLabel.METHOD or n.label == "METHOD")]
        assert len(methods) >= 1
        main_method = methods[0]
        assert hasattr(main_method, 'name')
        assert main_method.name == "main"

    def test_file_node_present(self):
        graph, _, _ = self._import_graph()
        files = [n for n in graph.nodes.values()
                 if hasattr(n, 'label') and
                 (n.label == NodeLabel.FILE or n.label == "FILE")]
        assert len(files) >= 1

    def test_call_nodes_present(self):
        graph, _, _ = self._import_graph()
        calls = [n for n in graph.nodes.values()
                 if hasattr(n, 'label') and
                 (n.label == NodeLabel.CALL or n.label == "CALL")]
        assert len(calls) >= 2  # printf + <operator>.assignment

    def test_type_decl_with_inherits(self):
        graph, _, _ = self._import_graph()
        type_decls = [n for n in graph.nodes.values()
                      if hasattr(n, 'label') and
                      (n.label == NodeLabel.TYPE_DECL or n.label == "TYPE_DECL")]
        assert len(type_decls) >= 1
        td = type_decls[0]
        assert hasattr(td, 'inherits_from_type_full_name')
        assert "int" in td.inherits_from_type_full_name
        assert "float" in td.inherits_from_type_full_name

    def test_ast_edges_present(self):
        graph, _, _ = self._import_graph()
        ast_edges = [e for e in graph.edges if e.type == EdgeType.AST or e.type == "AST"]
        assert len(ast_edges) >= 10

    def test_cfg_edges_present(self):
        graph, _, _ = self._import_graph()
        cfg_edges = [e for e in graph.edges if e.type == EdgeType.CFG or e.type == "CFG"]
        assert len(cfg_edges) >= 4

    def test_ddg_edge_has_variable(self):
        graph, _, _ = self._import_graph()
        ddg_edges = [e for e in graph.edges if e.type == EdgeType.DDG or e.type == "DDG"]
        assert len(ddg_edges) >= 1
        assert ddg_edges[0].properties.get("variable") == "x"

    def test_call_edge_present(self):
        graph, _, _ = self._import_graph()
        call_edges = [e for e in graph.edges if e.type == EdgeType.CALL or e.type == "CALL"]
        assert len(call_edges) >= 1


class TestImporterHybridStrategy:
    """Test hybrid ID strategy produces correct IDs for global nodes."""

    def test_hybrid_global_nodes_have_deterministic_ids(self):
        importer = JoernCSVImporter(id_strategy="hybrid")
        importer.run(str(FIXTURES_DIR))
        graph = importer.get_graph()

        # Global nodes should have regenerated IDs (not the original Joern IDs)
        methods = [n for n in graph.nodes.values()
                   if hasattr(n, 'label') and
                   (n.label == NodeLabel.METHOD or n.label == "METHOD")]
        assert len(methods) >= 1
        # The ID should NOT be 1 (the original Joern ID)
        assert methods[0].id != 1

    def test_hybrid_ast_nodes_have_passthrough_ids(self):
        importer = JoernCSVImporter(id_strategy="hybrid")
        importer.run(str(FIXTURES_DIR))
        graph = importer.get_graph()

        # AST nodes (non-global) should have passthrough IDs
        blocks = [n for n in graph.nodes.values()
                  if hasattr(n, 'label') and
                  (n.label == NodeLabel.BLOCK or n.label == "BLOCK")]
        if blocks:
            # Block node had joern_id=4, should keep it in hybrid mode
            assert blocks[0].id == 4


class TestImporterSkipUnknown:
    def test_skip_unknown_labels(self):
        importer = JoernCSVImporter(
            id_strategy="passthrough",
            skip_unknown_labels=True,
        )
        stats = importer.run(str(FIXTURES_DIR))
        # All fixture labels are known, so nothing should be skipped
        assert stats.nodes_skipped == 0

    def test_skip_edge_types(self):
        importer = JoernCSVImporter(
            id_strategy="passthrough",
            skip_edge_types=["EVAL_TYPE"],
        )
        stats = importer.run(str(FIXTURES_DIR))
        graph = importer.get_graph()

        eval_edges = [e for e in graph.edges if e.type == "EVAL_TYPE"]
        assert len(eval_edges) == 0
        assert stats.edges_skipped >= 1
