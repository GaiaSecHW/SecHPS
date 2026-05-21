"""
Tests for TagEngine public API backward compatibility.

Covers:
- engine.add() still works for manual tag operations
- SEMANTIC/STATE tags can be added to nodes
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Optional

from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.analysis.tagging.engine import TagEngine


# =========================================================================
# Mock Infrastructure
# =========================================================================

def make_method(id: int, name: str, tags: Optional[List[str]] = None,
                is_external: bool = False) -> MethodNode:
    node = MethodNode(
        id=id, name=name, fullName=f"pkg.{name}",
        signature=f"void {name}()", label=NodeLabel.METHOD,
        isExternal=is_external,
    )
    node.tags = tags or []
    return node


def make_mock_store(nodes: Optional[List[MethodNode]] = None) -> MagicMock:
    """Build a mock CPGStore with TagRepository and query stubs."""
    store = MagicMock()
    nodes = nodes or []
    node_map = {n.id: n for n in nodes}

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
        node = node_map.get(nid)
        if node and tag not in node.tags:
            node.tags.append(tag)

    def tags_remove(node_or_id, tag):
        nid = getattr(node_or_id, "id", node_or_id)
        if nid in tag_storage and tag in tag_storage[nid]:
            tag_storage[nid].remove(tag)

    def tags_find_nodes(tag):
        return [node_map[nid] for nid, tags in tag_storage.items() if tag in tags]

    def tags_list_all(prefix=None):
        all_tags = set()
        for tags_list in tag_storage.values():
            all_tags.update(tags_list)
        if prefix:
            return [t for t in sorted(all_tags) if t.startswith(prefix)]
        return sorted(all_tags)

    store.tags.get_all.side_effect = tags_get_all
    store.tags.add.side_effect = tags_add
    store.tags.remove.side_effect = tags_remove
    store.tags.find_nodes.side_effect = tags_find_nodes
    store.tags.list_all.side_effect = tags_list_all

    # Mock query.methods().filter()
    internal_nodes = [n for n in nodes if not getattr(n, "is_external", False)]
    mock_filter = MagicMock()
    mock_filter.__iter__ = MagicMock(return_value=iter(internal_nodes))
    mock_methods = MagicMock()
    mock_methods.filter.return_value = mock_filter
    store.query.methods.return_value = mock_methods

    return store


# =========================================================================
# Tests: API Backward Compatibility
# =========================================================================

class TestManualTagAfterAutoTag:
    """Manual add() operations work correctly."""

    def test_add_semantic_tag_still_works(self):
        node = make_method(1, "func")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "SEMANTIC:CUSTOM:TAINT")
        assert result.action == "added"
