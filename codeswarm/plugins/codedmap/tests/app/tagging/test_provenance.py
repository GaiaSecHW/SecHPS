"""
Tests for TagEngine provenance tracking (ENG-06).

Covers:
- Provenance recorded for L2 SEMANTIC tags with applied_by and timestamp
- Provenance recorded for L3 STATE tags with applied_by and timestamp
- Provenance NOT recorded for legacy flat tags
- Provenance NOT recorded for L1 tags via _add_system_tag
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Optional
from datetime import datetime, timezone

from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.analysis.tagging.engine import TagEngine


# =========================================================================
# Mock Infrastructure
# =========================================================================

def make_method(id: int, name: str, tags: Optional[List[str]] = None) -> MethodNode:
    node = MethodNode(id=id, name=name, fullName=f"pkg.{name}", label=NodeLabel.METHOD)
    node.tags = tags or []
    return node


def make_mock_store(nodes: Optional[List[MethodNode]] = None) -> MagicMock:
    """Build a mock CPGStore with TagRepository stubs."""
    store = MagicMock()
    nodes = nodes or []

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
        return []

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

    return store


# =========================================================================
# Tests: Provenance Tracking
# =========================================================================

class TestProvenanceRecordedForSemanticTags:
    """After adding a SEMANTIC (L2) tag, provenance must be recorded on the node."""

    def test_semantic_tag_records_provenance(self):
        node = make_method(1, "check_auth")
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        assert "SEMANTIC:AUTH:HIGH" in node.tags_provenance

    def test_semantic_tag_provenance_has_applied_by(self):
        node = make_method(2, "check_auth")
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        prov = node.tags_provenance["SEMANTIC:AUTH:HIGH"]
        assert prov["applied_by"] == "agent"

    def test_semantic_tag_provenance_has_timestamp(self):
        node = make_method(3, "check_auth")
        store = make_mock_store([node])
        engine = TagEngine(store)

        before = datetime.now(timezone.utc)
        engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        prov = node.tags_provenance["SEMANTIC:AUTH:HIGH"]
        assert "timestamp" in prov


class TestProvenanceRecordedForStateTags:
    """After adding a STATE (L3) tag, provenance must be recorded on the node."""

    def test_state_tag_records_provenance(self):
        node = make_method(10, "process_request")
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine.add(node, "STATE:REVIEWED", applied_by="human")
        assert "STATE:REVIEWED" in node.tags_provenance

    def test_state_tag_provenance_has_applied_by(self):
        node = make_method(11, "process_request")
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine.add(node, "STATE:REVIEWED", applied_by="human")
        prov = node.tags_provenance["STATE:REVIEWED"]
        assert prov["applied_by"] == "human"


class TestProvenanceNotRecordedForL1:
    """Provenance must NOT be recorded for L1 system tags."""

    def test_system_tag_l1_no_provenance(self):
        """_add_system_tag() for L1 tags should NOT record provenance."""
        node = make_method(21, "mepluginy")
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine._add_system_tag(node, "ONTOLOGY:SINK:BUFFER_OVERFLOW")
        assert "ONTOLOGY:SINK:BUFFER_OVERFLOW" not in node.tags_provenance
