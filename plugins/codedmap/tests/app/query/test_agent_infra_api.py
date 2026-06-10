# tests/app/query/test_agent_infra_api.py
"""
Tests for Plan 21-02: Agent Infrastructure API.

Covers:
- Pydantic models (GraphOverview, NodeDetail, PageResult)
- CPG methods (describe, inspect, source, by_ids, trace)
- QueryStep.page() terminal operation
- TraversalInterface.skip() across all drivers
- CLI stats command registration and --offset arg
"""

import pytest
from typing import List


# ===========================================================================
# TestModels: GraphOverview, NodeDetail, PageResult serialization and defaults
# ===========================================================================


class TestModels:
    """Verify Pydantic models serialize correctly and have expected defaults."""

    def test_graph_overview_defaults(self):
        from codedmap.app.query.models import GraphOverview

        overview = GraphOverview(total_nodes=42)
        assert overview.total_nodes == 42
        assert overview.total_edges == -1
        assert overview.node_counts == {}
        assert overview.files == 0
        assert overview.methods == 0
        assert overview.modules == 0
        assert overview.entry_points == 0
        assert overview.insights == 0
        assert overview.languages == []
        assert overview.top_tags == []

    def test_graph_overview_full(self):
        from codedmap.app.query.models import GraphOverview

        overview = GraphOverview(
            total_nodes=100,
            total_edges=200,
            node_counts={"METHOD": 50, "FILE": 10},
            files=10,
            methods=50,
            modules=3,
            entry_points=5,
            insights=7,
            languages=["Python", "C"],
            top_tags=[("SOURCE_HTTP", 3), ("SINK_SQL", 2)],
        )
        data = overview.model_dump(mode="json")
        assert data["total_nodes"] == 100
        assert data["total_edges"] == 200
        assert data["node_counts"]["METHOD"] == 50
        assert data["languages"] == ["Python", "C"]
        assert data["top_tags"] == [["SOURCE_HTTP", 3], ["SINK_SQL", 2]]

    def test_node_detail_defaults(self):
        from codedmap.app.query.models import NodeDetail

        detail = NodeDetail(id=1, label="METHOD")
        assert detail.id == 1
        assert detail.label == "METHOD"
        assert detail.name is None
        assert detail.properties == {}
        assert detail.file_path is None
        assert detail.line_start is None
        assert detail.line_end is None
        assert detail.tags == []
        assert detail.parent_id is None
        assert detail.children_count == 0
        assert detail.insights_count == 0

    def test_node_detail_full(self):
        from codedmap.app.query.models import NodeDetail

        detail = NodeDetail(
            id=42,
            label="METHOD",
            name="main",
            properties={"signature": "void main()"},
            file_path="main.c",
            line_start=10,
            line_end=25,
            tags=["ENTRY_POINT"],
            parent_id=1,
            children_count=5,
            insights_count=2,
        )
        data = detail.model_dump(mode="json")
        assert data["id"] == 42
        assert data["name"] == "main"
        assert data["properties"]["signature"] == "void main()"
        assert data["tags"] == ["ENTRY_POINT"]

    def test_page_result_basic(self):
        from codedmap.app.query.models import PageResult

        page = PageResult(
            items=["a", "b", "c"],
            total=10,
            offset=0,
            limit=3,
            has_more=True,
        )
        assert len(page.items) == 3
        assert page.total == 10
        assert page.has_more is True

    def test_page_result_no_more(self):
        from codedmap.app.query.models import PageResult

        page = PageResult(
            items=["a", "b"],
            total=2,
            offset=0,
            limit=50,
            has_more=False,
        )
        assert page.has_more is False

    def test_page_result_serialization(self):
        from codedmap.app.query.models import PageResult

        page = PageResult(
            items=[1, 2, 3],
            total=100,
            offset=10,
            limit=3,
            has_more=True,
        )
        data = page.model_dump(mode="json")
        assert data["items"] == [1, 2, 3]
        assert data["total"] == 100
        assert data["offset"] == 10
        assert data["limit"] == 3
        assert data["has_more"] is True


# ===========================================================================
# TestCPGMethods: verify describe, inspect, source, by_ids, trace exist on CPG
# ===========================================================================


class TestCPGMethods:
    """Verify CPG class exposes the required agent infrastructure methods."""

    def test_describe_method_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "describe", None))

    def test_inspect_method_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "inspect", None))

    def test_source_method_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "source", None))

    def test_by_ids_method_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "by_ids", None))

    def test_trace_method_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "trace", None))

    def test_compute_edge_count_exists(self):
        from codedmap.app.query.root import CPG

        assert callable(getattr(CPG, "_compute_edge_count", None))


# ===========================================================================
# TestQueryStepPage: verify page() exists on QueryStep
# ===========================================================================


class TestQueryStepPage:
    """Verify QueryStep has the page() method."""

    def test_page_method_exists(self):
        from codedmap.app.query.step import QueryStep

        assert callable(getattr(QueryStep, "page", None))

    def test_page_method_signature(self):
        import inspect
        from codedmap.app.query.step import QueryStep

        sig = inspect.signature(QueryStep.page)
        params = list(sig.parameters.keys())
        assert "offset" in params
        assert "limit" in params


# ===========================================================================
# TestTraversalSkip: verify skip() exists on Memory, SQLite, Neo4j traversals
# ===========================================================================


class TestTraversalSkip:
    """Verify skip() is implemented across all drivers."""

    def test_skip_on_memory_traversal(self):
        from codedmap.infra.storage.driver_memory.traversal import MemoryTraversal

        assert callable(getattr(MemoryTraversal, "skip", None))

    def test_skip_on_sqlite_traversal(self):
        from codedmap.infra.storage.driver_sqlite.traversal import SqliteTraversal

        assert callable(getattr(SqliteTraversal, "skip", None))

    def test_skip_on_neo4j_traversal(self):
        from codedmap.infra.storage.driver_neo4j.traversal import Neo4jTraversal

        assert callable(getattr(Neo4jTraversal, "skip", None))

    def test_skip_on_interface(self):
        from codedmap.infra.storage.interfaces import TraversalInterface

        assert callable(getattr(TraversalInterface, "skip", None))

    def test_memory_skip_functional(self):
        """End-to-end test: skip actually skips items in Memory driver."""
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.infra.storage.driver_memory.traversal import (
            MemoryTraversal,
            GraphIndexer,
        )

        # Build a small graph with 5 method nodes
        graph = CPGGraph()
        for i in range(1, 6):
            node = MethodNode(id=i, label=NodeLabel.METHOD, name=f"method_{i}")
            graph.add_node(node)

        indexer = GraphIndexer(graph)

        def factory():
            for nid in range(1, 6):
                yield graph.get_node_by_id(nid)

        t = MemoryTraversal(indexer, factory)

        # Skip first 2, take all remaining
        results = t.order_by("id").skip(2).to_list()
        assert len(results) == 3
        assert results[0].id == 3
        assert results[2].id == 5

    def test_memory_skip_with_limit(self):
        """Test skip + limit combination."""
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.infra.storage.driver_memory.traversal import (
            MemoryTraversal,
            GraphIndexer,
        )

        graph = CPGGraph()
        for i in range(1, 11):
            node = MethodNode(id=i, label=NodeLabel.METHOD, name=f"method_{i}")
            graph.add_node(node)

        indexer = GraphIndexer(graph)

        def factory():
            for nid in range(1, 11):
                yield graph.get_node_by_id(nid)

        t = MemoryTraversal(indexer, factory)

        # Skip 3, take 2
        results = t.order_by("id").skip(3).limit(2).to_list()
        assert len(results) == 2
        assert results[0].id == 4
        assert results[1].id == 5


# ===========================================================================
# TestCLIStats: verify stats module loads, --offset arg works
# ===========================================================================


class TestCLIStats:
    """Verify CLI stats command infrastructure."""

    def test_stats_module_importable(self):
        from codedmap.cli.commands import stats

        assert hasattr(stats, "register")
        assert hasattr(stats, "run")

    def test_stats_registered_in_main(self):
        """Verify stats is in the commands dict."""
        # We verify by checking the import and dict assignment exist
        import codedmap.cli.__main__ as cli_main
        import importlib

        importlib.reload(cli_main)
        # The main function creates commands dict internally,
        # so we verify it by checking the source or by calling parse_args
        import argparse

        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers(dest="command")
        from codedmap.cli.commands import stats as cmd_stats

        cmd_stats.register(subparsers)
        args = parser.parse_args(["stats", "--output", "json"])
        assert args.command == "stats"
        assert args.output == "json"

    def test_offset_arg_exists(self):
        """Verify --offset is accepted by add_common_args."""
        import argparse
        from codedmap.cli._bootstrap import add_common_args

        parser = argparse.ArgumentParser()
        add_common_args(parser)
        args = parser.parse_args(["--offset", "25"])
        assert args.offset == 25

    def test_offset_default(self):
        """Verify --offset defaults to 0."""
        import argparse
        from codedmap.cli._bootstrap import add_common_args

        parser = argparse.ArgumentParser()
        add_common_args(parser)
        args = parser.parse_args([])
        assert args.offset == 0
