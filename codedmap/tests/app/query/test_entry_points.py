# tests/app/query/test_entry_points.py
"""
Tests for CPG DSL entry_points() and list_tags() methods.

Covers requirements:
- ENTRY-04: Agent can query entry points by level/category
- ENTRY-04: Agent can list available tags
- ONT-01: Tags use ONTOLOGY:ENTRY_POINT:* format
"""

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.app.query import CPG
from codedmap.app.query.step import QueryStep
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import Language, NodeLabel


# =========================================================================
# Mock Infrastructure
# =========================================================================

class MockFileNode:
    """Mock FileNode with language attribute."""
    def __init__(self, name: str, language: Language = Language.C):
        self.name = name
        self.language = language


def make_method(id: int, name: str, full_name: str = None, tags: Optional[List[str]] = None) -> MethodNode:
    node = MethodNode(id=id, name=name, fullName=full_name or f"pkg.{name}", label=NodeLabel.METHOD)
    node.tags = tags or []
    return node


def make_mock_store_for_entry_points() -> MagicMock:
    """Build a mock CPGStore with entry point nodes (both L1 and L2)."""
    store = MagicMock()

    # L1 ONTOLOGY entry points (system-detected)
    http_handler = make_method(1001, "handle_http_request", "app.handlers.handle_http_request",
                               tags=["ONTOLOGY:ENTRY_POINT:HTTP"])
    socket_recv = make_method(1002, "socket_recv", "network.socket_recv",
                              tags=["ONTOLOGY:ENTRY_POINT:HTTP"])
    main_func = make_method(1003, "main", "main",
                            tags=["ONTOLOGY:ENTRY_POINT:CLI"])
    argparse_handler = make_method(1004, "parse_args", "cli.parse_args",
                                   tags=["ONTOLOGY:ENTRY_POINT:CLI"])
    syscall_handler = make_method(1005, "sys_read", "kernel.sys_read",
                                  tags=["ONTOLOGY:ENTRY_POINT:SYSCALL"])
    ioctl_handler = make_method(1006, "sys_ioctl", "kernel.sys_ioctl",
                                tags=["ONTOLOGY:ENTRY_POINT:SYSCALL"])
    file_parser = make_method(1007, "parse_config", "config.parse_config",
                              tags=["ONTOLOGY:ENTRY_POINT:DATA_INPUT"])

    # L2 SEMANTIC entry points (agent-discovered)
    agent_http = make_method(2001, "custom_http_handler", "app.custom.http_handler",
                             tags=["SEMANTIC:ENTRY_POINT:HTTP"])
    agent_cli = make_method(2002, "undocumented_entry", "hidden.entry",
                            tags=["SEMANTIC:ENTRY_POINT:CLI"])
    agent_custom = make_method(2003, "rpc_handler", "rpc.handler",
                               tags=["SEMANTIC:ENTRY_POINT:RPC"])

    helper = make_method(1008, "helper_function", "utils.helper_function",
                         tags=["INTERNAL"])
    plain = make_method(1009, "plain_method", "misc.plain_method", tags=None)

    nodes = [http_handler, socket_recv, main_func, argparse_handler,
             syscall_handler, ioctl_handler, file_parser,
             agent_http, agent_cli, agent_custom,
             helper, plain]
    node_map = {n.id: n for n in nodes}

    # Mock store.get_node
    def get_node(node_id: int):
        return node_map.get(node_id)
    store.get_node.side_effect = get_node

    # Mock store.tags (TagRepository)
    tag_storage: Dict[int, List[str]] = {}
    for n in nodes:
        tag_storage[n.id] = list(getattr(n, "tags", []) or [])

    def tags_get_all(node_or_id):
        nid = getattr(node_or_id, "id", node_or_id)
        return list(tag_storage.get(nid, []))

    def tags_list_all(prefix: str = None):
        all_tags = set()
        for tags in tag_storage.values():
            for tag in tags:
                if tag:
                    if prefix is None or tag.upper().startswith(prefix.upper()):
                        all_tags.add(tag)
        return sorted(all_tags)

    def tags_find_nodes(tag: str):
        results = []
        tag_upper = tag.upper()
        for nid, tags in tag_storage.items():
            for t in tags:
                # Support wildcard matching
                if "*" in tag_upper or "?" in tag_upper:
                    import fnmatch
                    if fnmatch.fnmatch(t.upper(), tag_upper):
                        results.append(node_map[nid])
                        break
                elif t.upper() == tag_upper:
                    results.append(node_map[nid])
                    break
        return results

    store.tags.get_all.side_effect = tags_get_all
    store.tags.list_all.side_effect = tags_list_all
    store.tags.find_nodes.side_effect = tags_find_nodes

    # Mock store.query (TraversalSource)
    mock_query = MagicMock()

    def mock_by_ids(ids):
        mock_traversal = MagicMock()
        matching_nodes = [node_map[i] for i in ids if i in node_map]
        mock_traversal.to_list.return_value = matching_nodes
        return mock_traversal

    def mock_by_id(node_id):
        mock_traversal = MagicMock()
        mock_file_result = MagicMock()
        mock_file_result.first.return_value = MockFileNode("mock.c", Language.C)
        mock_traversal.file.return_value = mock_file_result
        return mock_traversal

    mock_query.by_ids.side_effect = mock_by_ids
    mock_query.by_id.side_effect = mock_by_id
    store.query = mock_query

    return store, nodes


# =========================================================================
# Tests for entry_points() DSL Method
# =========================================================================

class TestEntryPointsDSL:
    """Tests for CPG.entry_points() DSL method."""

    def test_entry_points_basic(self):
        """Basic query returns all entry points (L1 + L2)."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points().to_list()

        # Should return all nodes with entry point tags (7 L1 + 3 L2 = 10 nodes)
        assert len(results) == 10

    def test_entry_points_level_L1_filter(self):
        """Level L1 filter returns only ONTOLOGY entry points."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(level='L1').to_list()

        # Should return only L1 ONTOLOGY entry points (7 nodes)
        assert len(results) == 7
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any(t.startswith('ONTOLOGY:ENTRY_POINT:') for t in tags)

    def test_entry_points_level_L2_filter(self):
        """Level L2 filter returns only SEMANTIC entry points."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(level='L2').to_list()

        # Should return only L2 SEMANTIC entry points (3 nodes)
        assert len(results) == 3
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any(t.startswith('SEMANTIC:ENTRY_POINT:') for t in tags)

    def test_entry_points_level_ONTOLOGY_alias(self):
        """Level 'ONTOLOGY' is an alias for 'L1'."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results_l1 = cpg.entry_points(level='L1').to_list()
        results_ontology = cpg.entry_points(level='ONTOLOGY').to_list()

        assert len(results_l1) == len(results_ontology)

    def test_entry_points_level_SEMANTIC_alias(self):
        """Level 'SEMANTIC' is an alias for 'L2'."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results_l2 = cpg.entry_points(level='L2').to_list()
        results_semantic = cpg.entry_points(level='SEMANTIC').to_list()

        assert len(results_l2) == len(results_semantic)

    def test_entry_points_category_filter_network(self):
        """Network category filter returns only network entry points (L1 + L2)."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(category='network').to_list()

        # 2 L1 HTTP + 1 L2 HTTP = 3 network entry points
        assert len(results) == 3
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any('HTTP' in tag.upper() for tag in tags)

    def test_entry_points_category_filter_cli(self):
        """CLI category filter returns only CLI entry points (L1 + L2)."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(category='cli').to_list()

        # 2 L1 CLI + 1 L2 CLI = 3 CLI entry points
        assert len(results) == 3

    def test_entry_points_category_filter_kernel(self):
        """Kernel category filter returns only kernel entry points."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(category='kernel').to_list()

        assert len(results) == 2

    def test_entry_points_category_filter_data(self):
        """Data category filter returns only data entry points."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.entry_points(category='data').to_list()

        assert len(results) == 1

    def test_entry_points_level_and_category_combined(self):
        """Level and category filters can be combined."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # L1 + network = 2 HTTP entry points
        results = cpg.entry_points(level='L1', category='network').to_list()
        assert len(results) == 2

        # L2 + network = 1 HTTP entry point
        results = cpg.entry_points(level='L2', category='network').to_list()
        assert len(results) == 1

    def test_entry_points_case_insensitive_category(self):
        """Category filter is case-insensitive."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results_lower = cpg.entry_points(category='network').to_list()
        results_upper = cpg.entry_points(category='NETWORK').to_list()

        # 2 L1 HTTP + 1 L2 HTTP = 3 network entry points
        assert len(results_lower) == len(results_upper) == 3

    def test_entry_points_empty_result(self):
        """Non-matching filter returns empty list."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Non-existent category
        results = cpg.entry_points(category='nonexistent').to_list()
        assert len(results) == 0


class TestListTagsDSL:
    """Tests for CPG.list_tags() DSL method."""

    def test_list_tags_all(self):
        """list_tags() returns all unique tags."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        tags = cpg.list_tags()

        # Should have all unique tags (4 entry point types + INTERNAL = 5)
        assert len(tags) >= 5

        # Check some expected tags are present
        tag_set = set(tags)
        assert 'ONTOLOGY:ENTRY_POINT:HTTP' in tag_set
        assert 'ONTOLOGY:ENTRY_POINT:CLI' in tag_set
        assert 'ONTOLOGY:ENTRY_POINT:SYSCALL' in tag_set
        assert 'INTERNAL' in tag_set

    def test_list_tags_prefix_filter(self):
        """list_tags(prefix=) filters by prefix."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Filter for entry point tags (4 unique entry point tag types)
        tags = cpg.list_tags(prefix='ONTOLOGY:ENTRY_POINT')
        assert len(tags) == 4
        for tag in tags:
            assert tag.upper().startswith('ONTOLOGY:ENTRY_POINT')

    def test_list_tags_prefix_case_insensitive(self):
        """Prefix filter is case-insensitive."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        tags_lower = cpg.list_tags(prefix='ontology:entry_point')
        tags_upper = cpg.list_tags(prefix='ONTOLOGY:ENTRY_POINT')

        assert set(tags_lower) == set(tags_upper)

    def test_list_tags_no_match(self):
        """Prefix with no matches returns empty list."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        tags = cpg.list_tags(prefix='nonexistent:prefix')
        assert len(tags) == 0

    def test_list_tags_sorted(self):
        """Tags are returned in sorted order."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        tags = cpg.list_tags()
        assert tags == sorted(tags)


class TestEntryPointsEmptyStore:
    """Tests for entry_points() on empty store."""

    def test_entry_points_empty_store(self):
        """entry_points() on empty store returns empty list."""
        store = MagicMock()
        store.tags.find_nodes.return_value = []
        store.query.by_ids.return_value.to_list.return_value = []

        cpg = CPG(store)
        results = cpg.entry_points().to_list()

        assert len(results) == 0

    def test_list_tags_empty_store(self):
        """list_tags() on empty store returns empty list."""
        store = MagicMock()
        store.tags.list_all.return_value = []

        cpg = CPG(store)
        tags = cpg.list_tags()

        assert len(tags) == 0


class TestEntryPointsTypeFilter:
    """Tests for CPG.entry_points(type=) filter parameter."""

    def test_entry_points_type_filter_http(self):
        """Filter by type='http' returns nodes with http in tags."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Create a node with HTTP in tags
        http_flask = make_method(1010, "flask_handler", "app.flask_handler",
                                 tags=["ONTOLOGY:ENTRY_POINT:HTTP"])
        nodes.append(http_flask)
        node_map = {n.id: n for n in nodes}

        # Update mock to include new node
        def tags_find_nodes(tag):
            results = []
            tag_upper = tag.upper()
            for n in nodes:
                for t in getattr(n, 'tags', []):
                    if "*" in tag_upper or "?" in tag_upper:
                        import fnmatch
                        if fnmatch.fnmatch(t.upper(), tag_upper):
                            results.append(n)
                            break
                    elif t.upper() == tag_upper:
                        results.append(n)
                        break
            return results

        store.tags.find_nodes.side_effect = tags_find_nodes

        def mock_by_ids(ids):
            mock_traversal = MagicMock()
            matching_nodes = [node_map.get(i) for i in ids if i in node_map]
            # Filter out None values
            matching_nodes = [n for n in matching_nodes if n is not None]
            mock_traversal.to_list.return_value = matching_nodes
            mock_traversal.__iter__ = lambda self: iter(matching_nodes)
            return mock_traversal

        store.query.by_ids.side_effect = mock_by_ids

        # Filter by 'http' type
        results = cpg.entry_points(type='http').to_list()

        # Should only return nodes with 'http' in their tags
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any('http' in t.lower() for t in tags)

    def test_entry_points_type_filter_cli(self):
        """Filter by type='cli' returns nodes with cli in tags."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Filter by 'cli' type - should match CLI entry points
        results = cpg.entry_points(type='cli').to_list()

        # All results should have 'cli' in tags
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any('cli' in t.lower() for t in tags)

    def test_entry_points_type_filter_case_insensitive(self):
        """Type filter is case-insensitive."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results_lower = cpg.entry_points(type='cli').to_list()
        results_upper = cpg.entry_points(type='CLI').to_list()

        assert len(results_lower) == len(results_upper)


class TestFluentTagsQuery:
    """Tests for CPG.tags() fluent query method."""

    def test_fluent_tags_all(self):
        """tags() returns all tagged nodes."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.tags().to_list()

        # Should return all nodes with any tag (8 nodes with tags)
        assert len(results) >= 7  # At least the entry point nodes

    def test_fluent_tags_with_prefix(self):
        """tags(prefix=) filters by tag prefix pattern."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.tags(prefix='ONTOLOGY:ENTRY_POINT:*').limit(10).to_list()

        # All results should have entry point tags
        for node in results:
            tags = getattr(node, 'tags', [])
            assert any('ENTRY_POINT' in t.upper() for t in tags)

    def test_fluent_tags_chaining(self):
        """tags() supports method chaining with limit()."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        results = cpg.tags().limit(3).to_list()

        assert len(results) <= 3


class TestNodeTagsBackwardCompat:
    """Tests for CPG.node_tags() backward compatibility method."""

    def test_node_tags_returns_list(self):
        """node_tags(node_id) returns list of tags."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Get tags for a specific node
        tags = cpg.node_tags(1001)

        assert isinstance(tags, list)
        assert 'ONTOLOGY:ENTRY_POINT:HTTP' in tags

    def test_node_tags_nonexistent_node(self):
        """node_tags() raises ValueError for nonexistent node."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        with pytest.raises(ValueError, match="Node not found"):
            cpg.node_tags(9999)

    def test_node_tags_empty_tags(self):
        """node_tags() returns empty list for node without tags."""
        store, nodes = make_mock_store_for_entry_points()
        cpg = CPG(store)

        # Node 1009 has no tags
        tags = cpg.node_tags(1009)

        assert isinstance(tags, list)
        assert len(tags) == 0


class TestEntryPointsResult:
    """Tests for EntryPointsResult wrapper class."""

    def test_entry_points_result_basic(self):
        """EntryPointsResult can be created with required fields."""
        from codedmap.app.query.results import EntryPointsResult

        result = EntryPointsResult(
            results=[{'id': 1, 'name': 'test'}],
            total=1,
            has_more=False,
            limit=10
        )

        assert len(result.results) == 1
        assert result.total == 1
        assert result.has_more is False
        assert result.limit == 10

    def test_entry_points_result_to_json(self):
        """EntryPointsResult.to_json() returns valid JSON."""
        from codedmap.app.query.results import EntryPointsResult

        result = EntryPointsResult(
            results=[{'id': 1, 'name': 'test'}],
            total=1,
            has_more=False,
            limit=10
        )

        json_str = result.to_json()

        assert '"results"' in json_str
        assert '"total"' in json_str
        assert '"has_more"' in json_str

    def test_entry_points_result_from_nodes(self):
        """EntryPointsResult.from_nodes() creates result from CPGNode list."""
        from codedmap.app.query.results import EntryPointsResult

        store, nodes = make_mock_store_for_entry_points()

        # Use entry point nodes
        entry_nodes = [n for n in nodes if any('ENTRY_POINT' in t.upper() for t in getattr(n, 'tags', []))]

        result = EntryPointsResult.from_nodes(entry_nodes, limit=5)

        assert len(result.results) <= 5
        assert result.total == len(entry_nodes)
        assert result.has_more == (len(entry_nodes) > 5)

    def test_entry_points_result_from_nodes_metadata(self):
        """EntryPointsResult.from_nodes() extracts metadata correctly."""
        from codedmap.app.query.results import EntryPointsResult

        store, nodes = make_mock_store_for_entry_points()
        entry_nodes = [n for n in nodes if any('ENTRY_POINT' in t.upper() for t in getattr(n, 'tags', []))]

        result = EntryPointsResult.from_nodes(entry_nodes, limit=10)

        # Check that each result has required fields
        for entry in result.results:
            assert 'id' in entry
            assert 'name' in entry
            assert 'file' in entry
            assert 'line' in entry
            assert 'level' in entry
            assert 'category' in entry
            assert 'type' in entry


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
