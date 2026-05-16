import pytest
from unittest.mock import MagicMock, patch
from typing import List, Dict, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.analysis.tagging.navigator import TagNavigator, TagResult
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.infra.storage.store import CPGStore


# =========================================================================
# Mock Infrastructure
# =========================================================================

def make_method(id: int, name: str, tags: Optional[List[str]] = None) -> MethodNode:
    node = MethodNode(id=id, name=name, fullName=f"pkg.{name}", label=NodeLabel.METHOD)
    node.tags = tags or []
    return node


def make_mock_store(nodes: Optional[List[MethodNode]] = None) -> MagicMock:
    """Build a mock CPGStore with TagRepository and MethodRepository stubs."""
    store = MagicMock()
    nodes = nodes or []
    node_map = {n.id: n for n in nodes}

    # --- Mock store.tags ---
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

    # --- Mock store.methods ---
    def methods_find_by_name(pattern, exact_match=True):
        if exact_match:
            return [n for n in nodes if n.name == pattern]
        return [n for n in nodes if pattern in n.name]

    store.methods.find_by_name.side_effect = methods_find_by_name

    # --- Mock store.query.all_nodes().where_contains().to_list() ---
    mock_traversal = MagicMock()
    mock_traversal.where_contains.return_value = mock_traversal
    mock_traversal.to_list.return_value = nodes
    store.query.all_nodes.return_value = mock_traversal

    return store


# =========================================================================
# Tests: Tag Validation
# =========================================================================

class TestTagValidation:

    def test_valid_layered_tag(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("ONTOLOGY:SINK:DB_EXECUTE")
        assert tag == "ONTOLOGY:SINK:DB_EXECUTE"
        assert warning is None

    def test_auto_uppercase(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("ontology:sink:db_execute")
        assert tag == "ONTOLOGY:SINK:DB_EXECUTE"
        assert warning is None

    def test_flat_tag_rejected(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="colon-separated"):
            nav.validate_tag("SOURCE_USER_INPUT")

    def test_flat_tag_with_known_prefix_rejected(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        for prefix in ["SOURCE", "SINK", "SANITIZER", "SUPPRESSED", "REVIEWED", "CUSTOM"]:
            with pytest.raises(ValueError, match="colon-separated"):
                nav.validate_tag(f"{prefix}_SOMETHING")

    def test_invalid_tag_empty(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="empty"):
            nav.validate_tag("")

    def test_invalid_tag_special_chars(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="colon-separated"):
            nav.validate_tag("TAG-WITH-DASHES")

    def test_invalid_tag_starts_with_digit(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="colon-separated"):
            nav.validate_tag("123_TAG")

    def test_invalid_tag_spaces(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="colon-separated"):
            nav.validate_tag("TAG WITH SPACES")


# =========================================================================
# Tests: Single Node Operations (add/remove/list)
# =========================================================================

class TestSingleNodeOps:

    def test_add_tag(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        result = nav.add_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert result.action == "added"
        assert result.tag == "ONTOLOGY:SINK:MEMORY_WRITE"
        assert result.node_id == 1

    def test_add_tag_idempotent(self):
        """Adding the same tag twice should return already_exists."""
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        r1 = nav.add_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert r1.action == "added"

        r2 = nav.add_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert r2.action == "already_exists"

    def test_add_tag_auto_uppercase(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        result = nav.add_tag(node, "ontology:sink:memory_write")
        assert result.tag == "ONTOLOGY:SINK:MEMORY_WRITE"
        assert result.action == "added"

    def test_remove_tag(self):
        node = make_method(1, "memcpy", tags=["ONTOLOGY:SINK:MEMORY_WRITE"])
        store = make_mock_store([node])
        nav = TagNavigator(store)

        result = nav.remove_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert result.action == "removed"

    def test_remove_nonexistent_tag(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        result = nav.remove_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert result.action == "not_found"

    def test_list_tags_empty(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        tags = nav.list_tags(node)
        assert tags == []

    def test_list_tags_after_add(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        nav.add_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        nav.add_tag(node, "STATE:REVIEWED")

        tags = nav.list_tags(node)
        assert "ONTOLOGY:SINK:MEMORY_WRITE" in tags
        assert "STATE:REVIEWED" in tags
        assert len(tags) == 2

    def test_add_then_remove(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        nav.add_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert nav.list_tags(node) == ["ONTOLOGY:SINK:MEMORY_WRITE"]

        nav.remove_tag(node, "ONTOLOGY:SINK:MEMORY_WRITE")
        assert nav.list_tags(node) == []

    def test_add_invalid_tag_raises(self):
        node = make_method(1, "memcpy")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        with pytest.raises(ValueError):
            nav.add_tag(node, "invalid-tag!")


# =========================================================================
# Tests: find_by_tag
# =========================================================================

class TestFindByTag:

    def test_find_no_results(self):
        store = make_mock_store([make_method(1, "foo")])
        nav = TagNavigator(store)

        results = nav.find_by_tag("ONTOLOGY:SINK:MEMORY_WRITE")
        assert results == []

    def test_find_after_add(self):
        m1 = make_method(1, "memcpy")
        m2 = make_method(2, "strcpy")
        store = make_mock_store([m1, m2])
        nav = TagNavigator(store)

        nav.add_tag(m1, "ONTOLOGY:SINK:MEMORY_WRITE")
        nav.add_tag(m2, "ONTOLOGY:SINK:MEMORY_WRITE")

        results = nav.find_by_tag("ONTOLOGY:SINK:MEMORY_WRITE")
        assert len(results) == 2
        result_ids = {n.id for n in results}
        assert result_ids == {1, 2}

    def test_find_respects_limit(self):
        nodes = [make_method(i, f"func_{i}") for i in range(10)]
        store = make_mock_store(nodes)
        nav = TagNavigator(store)

        for n in nodes:
            nav.add_tag(n, "STATE:REVIEWED")

        results = nav.find_by_tag("STATE:REVIEWED", limit=3)
        assert len(results) == 3


# =========================================================================
# Tests: bulk_tag
# =========================================================================

class TestBulkTag:

    def test_bulk_tag_by_pattern(self):
        m1 = make_method(1, "memcpy")
        m2 = make_method(2, "memmove")
        m3 = make_method(3, "printf")
        store = make_mock_store([m1, m2, m3])
        nav = TagNavigator(store)

        results = nav.bulk_tag("mem", "ONTOLOGY:SINK:MEMORY_WRITE")
        assert len(results) == 2
        assert all(r.action == "added" for r in results)
        assert all(r.tag == "ONTOLOGY:SINK:MEMORY_WRITE" for r in results)
        result_names = {r.node_name for r in results}
        assert result_names == {"memcpy", "memmove"}

    def test_bulk_tag_idempotent(self):
        m1 = make_method(1, "memcpy", tags=["ONTOLOGY:SINK:MEMORY_WRITE"])
        m2 = make_method(2, "memmove")
        store = make_mock_store([m1, m2])
        nav = TagNavigator(store)

        results = nav.bulk_tag("mem", "ONTOLOGY:SINK:MEMORY_WRITE")
        assert len(results) == 2
        actions = {r.node_name: r.action for r in results}
        assert actions["memcpy"] == "already_exists"
        assert actions["memmove"] == "added"

    def test_bulk_tag_no_matches(self):
        store = make_mock_store([make_method(1, "printf")])
        nav = TagNavigator(store)

        results = nav.bulk_tag("nonexistent", "STATE:REVIEWED")
        assert results == []

    def test_bulk_tag_invalid_tag_raises(self):
        store = make_mock_store([make_method(1, "foo")])
        nav = TagNavigator(store)

        with pytest.raises(ValueError):
            nav.bulk_tag("foo", "invalid-tag!")


# =========================================================================
# Tests: Layered Tag Validation (colon-separated format)
# =========================================================================

class TestLayeredTagValidation:
    """Tests for the new colon-separated layered tag format (LAYER:NAMESPACE:NAME)."""

    def test_validate_layered_tag_ontology(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("ONTOLOGY:SINK:SQL_INJECTION")
        assert tag == "ONTOLOGY:SINK:SQL_INJECTION"
        assert warning is None

    def test_validate_layered_tag_semantic(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("SEMANTIC:AUTH:PASSWORD_HASH")
        assert tag == "SEMANTIC:AUTH:PASSWORD_HASH"
        assert warning is None

    def test_validate_layered_tag_state(self):
        """STATE layer allows 2-part format (STATE:STATUS)."""
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("STATE:REVIEWED")
        assert tag == "STATE:REVIEWED"
        assert warning is None

    def test_validate_layered_tag_state_custom(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("STATE:CUSTOM:NEEDS_REFACTOR")
        assert tag == "STATE:CUSTOM:NEEDS_REFACTOR"
        assert warning is None

    def test_validate_layered_tag_auto_uppercase(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        tag, warning = nav.validate_tag("ontology:source:user_input")
        assert tag == "ONTOLOGY:SOURCE:USER_INPUT"
        assert warning is None

    def test_validate_layered_tag_invalid_layer(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError):
            nav.validate_tag("INVALID:SINK:SQL")

    def test_validate_flat_tag_rejected(self):
        store = make_mock_store()
        nav = TagNavigator(store)

        with pytest.raises(ValueError, match="colon-separated"):
            nav.validate_tag("SOURCE_USER_INPUT")

    def test_add_tag_layered_format(self):
        node = make_method(1, "mysql_query")
        store = make_mock_store([node])
        nav = TagNavigator(store)

        result = nav.add_tag(node, "ONTOLOGY:SINK:SQL_INJECTION")
        assert result.action == "added"
        assert result.tag == "ONTOLOGY:SINK:SQL_INJECTION"

    def test_find_by_layered_tag(self):
        m1 = make_method(1, "mysql_query")
        m2 = make_method(2, "pg_exec")
        store = make_mock_store([m1, m2])
        nav = TagNavigator(store)

        nav.add_tag(m1, "ONTOLOGY:SINK:SQL_INJECTION")
        nav.add_tag(m2, "ONTOLOGY:SINK:SQL_INJECTION")

        results = nav.find_by_tag("ONTOLOGY:SINK:SQL_INJECTION")
        assert len(results) == 2

    def test_find_by_layered_prefix(self):
        m1 = make_method(1, "mysql_query")
        m2 = make_method(2, "strcpy")
        store = make_mock_store([m1, m2])
        nav = TagNavigator(store)

        nav.add_tag(m1, "ONTOLOGY:SINK:SQL_INJECTION")
        nav.add_tag(m2, "ONTOLOGY:SINK:BUFFER_OVERFLOW")

        # Prefix search should match both ONTOLOGY:SINK:* tags
        results = nav.find_by_tag("ONTOLOGY:SINK")
        assert len(results) == 2
        result_ids = {n.id for n in results}
        assert result_ids == {1, 2}
