"""
Tests for TagEngine permission enforcement (ENG-01).

Covers:
- TagEngine.add() raises TagPermissionError for L1 ONTOLOGY tags
- TagEngine.add() succeeds for L2 SEMANTIC and L3 STATE tags
- Error messages contain descriptive information
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock
from typing import List, Dict, Optional

from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.analysis.tagging.engine import TagEngine, TagPermissionError
from codedmap.analysis.tagging.navigator import TagResult


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

    return store


# =========================================================================
# Tests: Permission Enforcement
# =========================================================================

class TestTagPermissionEnforcement:
    """TagEngine.add() must reject L1 ONTOLOGY tags with TagPermissionError."""

    def test_add_ontology_sink_raises_permission_error(self):
        node = make_method(1, "mysql_query")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError):
            engine.add(node, "ONTOLOGY:SINK:SQL_INJECTION")

    def test_add_ontology_source_raises_permission_error(self):
        node = make_method(2, "getenv")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError):
            engine.add(node, "ONTOLOGY:SOURCE:USER_INPUT")

    def test_permission_error_message_contains_read_only(self):
        node = make_method(3, "func")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="read-only"):
            engine.add(node, "ONTOLOGY:SINK:SQL_INJECTION")

    def test_permission_error_message_mentions_ontology(self):
        node = make_method(4, "func")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="ONTOLOGY"):
            engine.add(node, "ONTOLOGY:SINK:BUFFER_OVERFLOW")

    def test_permission_error_is_subclass_of_permission_error(self):
        """TagPermissionError should be catchable as PermissionError."""
        assert issubclass(TagPermissionError, PermissionError)


class TestTagPermissionAllowed:
    """TagEngine.add() must succeed for L2 SEMANTIC and L3 STATE tags."""

    def test_add_semantic_tag_succeeds(self):
        node = make_method(10, "check_auth")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        assert result.action == "added"
        assert result.tag == "SEMANTIC:AUTH:HIGH"

    def test_add_state_tag_succeeds(self):
        node = make_method(11, "process_request")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "STATE:REVIEWED", applied_by="human")
        assert result.action == "added"
        assert result.tag == "STATE:REVIEWED"

    def test_add_semantic_returns_tag_result(self):
        node = make_method(12, "handler")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        assert isinstance(result, TagResult)
        assert result.node_id == 12

    def test_add_state_returns_tag_result(self):
        node = make_method(13, "handler")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "STATE:REVIEWED", applied_by="human")
        assert isinstance(result, TagResult)
        assert result.node_id == 13


# =========================================================================
# Tests: Justification Gate for collaborative L1 namespaces (GUARD/SANITIZER/ROLE)
# =========================================================================

class TestJustificationGate:
    """TagEngine Justification Gate: AGENT writes to GUARD/SANITIZER/ROLE require justification."""

    def test_agent_guard_without_justification_raises(self):
        """AGENT adding ONTOLOGY:GUARD:* without justification raises TagPermissionError."""
        node = make_method(20, "check_bounds")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="justification"):
            engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent")

    def test_agent_guard_with_empty_justification_raises(self):
        """AGENT adding ONTOLOGY:GUARD:* with empty justification raises TagPermissionError."""
        node = make_method(21, "check_bounds")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="justification"):
            engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent", justification="")

    def test_agent_guard_with_whitespace_justification_raises(self):
        """AGENT adding ONTOLOGY:GUARD:* with whitespace-only justification raises TagPermissionError."""
        node = make_method(22, "check_bounds")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="justification"):
            engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent", justification="   ")

    def test_agent_guard_with_justification_succeeds(self):
        """AGENT adding ONTOLOGY:GUARD:* with non-empty justification succeeds."""
        node = make_method(23, "check_bounds")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent", justification="size < buf_size")
        assert result.action == "added"

    def test_agent_sanitizer_with_justification_succeeds(self):
        """AGENT adding ONTOLOGY:SANITIZER:* with justification succeeds."""
        node = make_method(24, "html_escape")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "ONTOLOGY:SANITIZER:ESCAPE", applied_by="agent", justification="html_escape")
        assert result.action == "added"

    def test_agent_sanitizer_without_justification_raises(self):
        """AGENT adding ONTOLOGY:SANITIZER:* without justification raises TagPermissionError."""
        node = make_method(25, "html_escape")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="justification"):
            engine.add(node, "ONTOLOGY:SANITIZER:ESCAPE", applied_by="agent")

    def test_agent_role_with_justification_succeeds(self):
        """AGENT adding ONTOLOGY:ROLE:* with justification succeeds."""
        node = make_method(26, "handle_request")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "ONTOLOGY:ROLE:BOUNDARY", applied_by="agent", justification="orchestrates HTTP requests")
        assert result.action == "added"

    def test_agent_role_without_justification_raises(self):
        """AGENT adding ONTOLOGY:ROLE:* without justification raises TagPermissionError."""
        node = make_method(27, "handle_request")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError, match="justification"):
            engine.add(node, "ONTOLOGY:ROLE:BOUNDARY", applied_by="agent")

    def test_system_guard_no_justification_required(self):
        """System bypass via add_system_tag does not require justification."""
        node = make_method(28, "check_bounds")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add_system_tag(node, "ONTOLOGY:GUARD:BOUNDS_CHECK")
        assert result.action == "added"

    def test_entry_point_still_system_only(self):
        """ONTOLOGY:ENTRY_POINT:* is still System-Only (not collaborative)."""
        node = make_method(29, "main")
        store = make_mock_store([node])
        engine = TagEngine(store)

        with pytest.raises(TagPermissionError):
            engine.add(node, "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER", applied_by="agent")

    def test_l2_semantic_unaffected(self):
        """L2 SEMANTIC tags still succeed without justification (unchanged behavior)."""
        node = make_method(30, "check_auth")
        store = make_mock_store([node])
        engine = TagEngine(store)

        result = engine.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
        assert result.action == "added"

    def test_collaborative_tag_provenance_stored(self):
        """Provenance is stored for collaborative L1 tags written by agent."""
        node = make_method(31, "check_bounds")
        node.tags_provenance = {}
        store = make_mock_store([node])
        engine = TagEngine(store)

        engine.add(node, "ONTOLOGY:GUARD:BOUNDS_CHECK", applied_by="agent", justification="size < 1024")
        assert "ONTOLOGY:GUARD:BOUNDS_CHECK" in node.tags_provenance
        prov = node.tags_provenance["ONTOLOGY:GUARD:BOUNDS_CHECK"]
        # Provenance stored as list of records
        assert isinstance(prov, list)
        assert len(prov) >= 1
        assert prov[0]["justification"] == "size < 1024"
