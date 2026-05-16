"""
Tests for Module tagging through the CPG DSL.

Covers requirements:
- MTAG-01: Agents can tag modules via cpg.tag(module_id, tag)
- MTAG-03: Agents can find tagged modules via cpg.find_tag(pattern)

Plan: 11-03
"""

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.app.query import CPG
from codedmap.app.query.step import QueryStep
from codedmap.core.schema.graph.nodes import MethodNode, ModuleNode
from codedmap.core.schema.graph.enums import NodeLabel


# =========================================================================
# Mock Infrastructure
# =========================================================================

def make_method(id: int, name: str, tags: Optional[List[str]] = None) -> MethodNode:
    """Create a mock MethodNode for testing."""
    node = MethodNode(id=id, name=name, fullName=f"pkg.{name}", label=NodeLabel.METHOD)
    node.tags = tags or []
    return node


def make_module(id: int, name: str, full_name: str, tags: Optional[List[str]] = None) -> ModuleNode:
    """Create a mock ModuleNode for testing."""
    node = ModuleNode(
        id=id,
        name=name,
        fullName=full_name,
        label=NodeLabel.MODULE,
    )
    node.tags = tags or []
    return node


def make_mock_store(nodes: Optional[List] = None) -> MagicMock:
    """Build a mock CPGStore with TagRepository and get_node support."""
    store = MagicMock()
    nodes = nodes or []
    node_map = {n.id: n for n in nodes}

    # --- Mock store.get_node ---
    def get_node(node_id: int):
        return node_map.get(node_id)

    store.get_node.side_effect = get_node

    # --- Mock store.tags (TagRepository) ---
    tag_storage: Dict[int, List[str]] = {}
    for n in nodes:
        tag_storage[n.id] = list(getattr(n, "tags", []) or [])

    def tags_get_all(node_or_id):
        nid = getattr(node_or_id, "id", node_or_id)
        return list(tag_storage.get(nid, []))

    def tags_add(node_or_id, tag):
        nid = getattr(node_or_id, "id", node_or_id)
        if nid not in tag_storage:
            tag_storage[nid] = []
        if tag not in tag_storage[nid]:
            tag_storage[nid].append(tag)

    def tags_remove(node_or_id, tag):
        nid = getattr(node_or_id, "id", node_or_id)
        if nid in tag_storage and tag in tag_storage[nid]:
            tag_storage[nid].remove(tag)

    def tags_find_nodes(tag):
        return [node_map[nid] for nid, tags in tag_storage.items() if tag in tags]

    def tags_list_all(prefix=None):
        all_tags = set()
        for tags in tag_storage.values():
            all_tags.update(tags)
        if prefix:
            all_tags = {t for t in all_tags if t.startswith(prefix.upper())}
        return sorted(all_tags)

    store.tags.get_all.side_effect = tags_get_all
    store.tags.add.side_effect = tags_add
    store.tags.remove.side_effect = tags_remove
    store.tags.find_nodes.side_effect = tags_find_nodes
    store.tags.list_all.side_effect = tags_list_all

    # Store reference for tagger access
    store._tag_storage = tag_storage
    store._nodes = nodes

    # --- Mock store.query for QueryStep ---
    mock_query = MagicMock()

    def by_ids(ids):
        mock_traversal = MagicMock()
        # Return nodes matching the IDs
        mock_traversal.to_list.return_value = [node_map[i] for i in ids if i in node_map]
        mock_traversal.__iter__ = lambda self: iter(mock_traversal.to_list.return_value)
        return mock_traversal

    def by_id(node_id):
        mock_traversal = MagicMock()
        if node_id in node_map:
            mock_traversal.to_list.return_value = [node_map[node_id]]
        else:
            mock_traversal.to_list.return_value = []
        return mock_traversal

    mock_query.by_ids.side_effect = by_ids
    mock_query.by_id.side_effect = by_id
    store.query = mock_query

    return store


def make_mock_tagger(store: MagicMock) -> MagicMock:
    """Build a mock TagEngine with pattern matching support."""
    tagger = MagicMock()

    def add(node, tag):
        store.tags.add(node, tag.upper())
        result = MagicMock()
        result.action = "added"
        result.tag = tag.upper()
        result.node_id = node.id
        result.node_name = getattr(node, "name", "?")
        return result

    def remove(node, tag):
        store.tags.remove(node, tag.upper())
        result = MagicMock()
        result.action = "removed"
        result.tag = tag.upper()
        result.node_id = node.id
        result.node_name = getattr(node, "name", "?")
        return result

    def list_tags(node):
        return store.tags.get_all(node)

    def find(pattern, limit=50):
        """Find nodes matching tag pattern with wildcard support."""
        import fnmatch
        normalized_pattern = pattern.strip().upper()

        # Get all tags with matching prefix
        prefix = pattern.split("*")[0].split("?")[0].rstrip(":").rstrip("_")
        matching_tags = store.tags.list_all(prefix=prefix if prefix else None)

        # Filter by pattern
        matching_tags = [t for t in matching_tags if fnmatch.fnmatch(t.upper(), normalized_pattern)]

        # Find nodes for each tag
        results = []
        seen_ids = set()
        for tag in matching_tags:
            for nid, tags in store._tag_storage.items():
                if tag in tags and nid not in seen_ids:
                    for n in store._nodes:
                        if n.id == nid:
                            results.append(n)
                            seen_ids.add(nid)
                            break
                    if len(results) >= limit:
                        return results
        return results

    def list_all_tags(prefix=None):
        return store.tags.list_all(prefix=prefix)

    tagger.add.side_effect = add
    tagger.remove.side_effect = remove
    tagger.list_tags.side_effect = list_tags
    tagger.find.side_effect = find
    tagger.list_all_tags.side_effect = list_all_tags

    return tagger


# =========================================================================
# Tests: MTAG-01 - Tag Module via DSL
# =========================================================================

class TestTagModuleViaDSL:
    """Tests for cpg.tag() on ModuleNode instances."""

    def test_tag_module_via_dsl(self):
        """MTAG-01: cpg.tag(module_id, tag) works on ModuleNode."""
        module = make_module(1, "network", "fs.network")
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        result = cpg.tag(1, "TEST_TAG_AUTH")

        # Should return CPG for chaining
        assert result is cpg
        # Tag should be added
        assert store.tags.get_all(module) == ["TEST_TAG_AUTH"]

    def test_tag_module_appears_in_node_tags_after_reload(self):
        """Tag added via DSL should appear in node.tags after reload."""
        module = make_module(1, "network", "fs.network")
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        cpg.tag(1, "TEST_TAG_CRYPTO")

        # Verify tag is in storage
        assert "TEST_TAG_CRYPTO" in store.tags.get_all(module)

    def test_tag_module_supports_chaining(self):
        """cpg.tag() on ModuleNode should support method chaining."""
        module = make_module(1, "network", "fs.network")
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        result = cpg.tag(1, "TAG_A").tag(1, "TAG_B")

        assert result is cpg
        tags = store.tags.get_all(module)
        assert "TAG_A" in tags
        assert "TAG_B" in tags


# =========================================================================
# Tests: MTAG-03 - Find Tag Returns Modules
# =========================================================================

class TestFindTagReturnsModules:
    """Tests for cpg.find_tag() returning ModuleNode instances."""

    def test_find_tag_returns_modules(self):
        """MTAG-03: cpg.find_tag(pattern) returns ModuleNode when modules are tagged."""
        module = make_module(1, "crypto", "lib.crypto", tags=[])
        method = make_method(2, "encrypt", tags=[])
        store = make_mock_store([module, method])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        # Tag the module with a test tag
        cpg.tag(1, "TEST_TAG_CRYPTO")

        # Find nodes with TEST_TAG_* pattern
        result = cpg.find_tag("TEST_TAG_*")

        assert isinstance(result, QueryStep)
        nodes = result.to_list()

        # Module should be in results
        assert len(nodes) == 1
        assert nodes[0].id == 1
        assert nodes[0].label == NodeLabel.MODULE

    def test_find_tag_includes_modules_and_methods(self):
        """find_tag() should return both ModuleNode and MethodNode when both are tagged."""
        module = make_module(1, "auth", "lib.auth", tags=[])
        method = make_method(2, "login", tags=[])
        store = make_mock_store([module, method])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        # Tag both with same pattern
        cpg.tag(1, "TEST_TAG_AUTH")
        cpg.tag(2, "TEST_TAG_AUTH")

        result = cpg.find_tag("TEST_TAG_AUTH")
        nodes = result.to_list()

        assert len(nodes) == 2
        labels = {n.label for n in nodes}
        assert NodeLabel.MODULE in labels
        assert NodeLabel.METHOD in labels

    def test_find_tag_returns_empty_for_no_match(self):
        """find_tag() should return empty QueryStep when no nodes match."""
        module = make_module(1, "network", "lib.network")
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        result = cpg.find_tag("NONEXISTENT_TAG")

        assert isinstance(result, QueryStep)
        assert result.to_list() == []


# =========================================================================
# Tests: Task 3 - has_label() filter on QueryStep
# =========================================================================

class TestHasLabelFilter:
    """Tests for QueryStep.has_label() filter method."""

    def test_has_label_filters_by_module(self):
        """has_label(NodeLabel.MODULE) should filter to only ModuleNode instances."""
        module = make_module(1, "auth", "lib.auth", tags=[])
        method = make_method(2, "login", tags=[])
        store = make_mock_store([module, method])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        # Tag both with same pattern
        cpg.tag(1, "TEST_TAG_AUTH")
        cpg.tag(2, "TEST_TAG_AUTH")

        # Find all tagged nodes, then filter to modules only
        result = cpg.find_tag("TEST_TAG_AUTH").has_label(NodeLabel.MODULE)

        nodes = result.to_list()
        assert len(nodes) == 1
        assert nodes[0].label == NodeLabel.MODULE
        assert nodes[0].id == 1

    def test_has_label_filters_by_method(self):
        """has_label(NodeLabel.METHOD) should filter to only MethodNode instances."""
        module = make_module(1, "auth", "lib.auth", tags=[])
        method = make_method(2, "login", tags=[])
        store = make_mock_store([module, method])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        cpg.tag(1, "TEST_TAG_AUTH")
        cpg.tag(2, "TEST_TAG_AUTH")

        result = cpg.find_tag("TEST_TAG_AUTH").has_label(NodeLabel.METHOD)

        nodes = result.to_list()
        assert len(nodes) == 1
        assert nodes[0].label == NodeLabel.METHOD
        assert nodes[0].id == 2

    def test_has_label_returns_empty_when_no_match(self):
        """has_label() should return empty when no nodes match the label."""
        module = make_module(1, "auth", "lib.auth", tags=[])
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        cpg.tag(1, "TEST_TAG_AUTH")

        # Filter for METHOD when only MODULE exists
        result = cpg.find_tag("TEST_TAG_AUTH").has_label(NodeLabel.METHOD)

        assert result.to_list() == []

    def test_has_label_supports_chaining(self):
        """has_label() should return QueryStep for further chaining."""
        module = make_module(1, "auth", "lib.auth", tags=[])
        store = make_mock_store([module])
        tagger = make_mock_tagger(store)

        cpg = CPG(store)
        cpg._tagger = tagger

        cpg.tag(1, "TEST_TAG_AUTH")

        result = cpg.find_tag("TEST_TAG_AUTH").has_label(NodeLabel.MODULE)

        # Should be able to chain further
        assert isinstance(result, QueryStep)
        assert len(result.to_list()) == 1
