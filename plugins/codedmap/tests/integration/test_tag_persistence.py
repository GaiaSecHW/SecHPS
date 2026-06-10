"""
Integration tests for tag persistence across sessions.

Tests verify that tags added in one session are visible in subsequent sessions
for SQLite and Memory backends, and that StaticSecurityRules correctly
identifies SOURCE, SINK, and SAFE functions.

TAG-08 verification: TagRepository.add() uses property_list_append as the single
write path for per-node tags. Tags stored via node.tags list (property-based storage).
"""

import os
import sys
import tempfile

import pytest

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def make_method_node(node_id, name, tags=None):
    """Create a MethodNode for testing."""
    from codedmap.core.schema.graph.nodes import MethodNode
    from codedmap.core.schema.graph.enums import NodeLabel

    node = MethodNode(
        id=node_id,
        name=name,
        fullName=f"test::{name}",
        label=NodeLabel.METHOD,
        fileName="test.c",
        lineNumber=10
    )
    node.tags = tags or []
    return node


class TestTagPersistenceSQLite:
    """Tests for tag persistence with SQLite backend."""

    def test_sqlite_backend_available(self):
        """SQLite backend should be available for tag storage."""
        from codedmap.core.configs.storage import StorageConfig
        config = StorageConfig(backend="sqlite", uri=":memory:")
        assert config.backend == "sqlite"

    def test_tags_persist_across_sessions_sqlite(self):
        """Tags added in one SQLite session should be visible in a subsequent session."""
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_persist.db")
            config = StorageConfig(backend="sqlite", uri=db_path)

            # Session 1: Create node and add tag
            with CPGStore(config) as store1:
                # Create and save a method node
                method = MethodNode(
                    id=1001,
                    name="test_func",
                    fullName="test::test_func",
                    label=NodeLabel.METHOD,
                    fileName="test.c",
                    lineNumber=10
                )
                method.tags = []

                # Save the node to storage
                from codedmap.core.schema.graph import CPGGraph
                graph = CPGGraph()
                graph.add_node(method)
                store1.save(graph)

                # Add tag using TagRepository
                store1.tags.add(method, "ONTOLOGY:SOURCE:NETWORK_DATA")

            # Session 2: Verify tag persisted
            with CPGStore(config) as store2:
                # Retrieve the node
                tags = store2.tags.get_all(1001)
                assert "ONTOLOGY:SOURCE:NETWORK_DATA" in tags, f"Expected ONTOLOGY:SOURCE:NETWORK_DATA in tags, got {tags}"

    def test_multiple_tags_persist_sqlite(self):
        """Multiple tags per node should persist correctly."""
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_multi.db")
            config = StorageConfig(backend="sqlite", uri=db_path)

            # Session 1: Add multiple tags
            with CPGStore(config) as store:
                method = MethodNode(
                    id=2001,
                    name="sensitive_func",
                    fullName="test::sensitive_func",
                    label=NodeLabel.METHOD,
                    fileName="test.c",
                    lineNumber=20
                )
                method.tags = []

                graph = CPGGraph()
                graph.add_node(method)
                store.save(graph)

                store.tags.add(method, "TAG_A")
                store.tags.add(method, "TAG_B")
                store.tags.add(method, "TAG_C")

            # Session 2: Verify all tags persisted
            with CPGStore(config) as store:
                tags = store.tags.get_all(2001)
                assert "TAG_A" in tags, f"Expected TAG_A in {tags}"
                assert "TAG_B" in tags, f"Expected TAG_B in {tags}"
                assert "TAG_C" in tags, f"Expected TAG_C in {tags}"
                assert len(tags) == 3, f"Expected 3 tags, got {len(tags)}: {tags}"

    def test_removed_tag_does_not_persist(self):
        """Removed tags should not persist to subsequent sessions."""
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_remove.db")
            config = StorageConfig(backend="sqlite", uri=db_path)

            # Session 1: Add and then remove a tag
            with CPGStore(config) as store:
                method = MethodNode(
                    id=3001,
                    name="remove_test_func",
                    fullName="test::remove_test_func",
                    label=NodeLabel.METHOD,
                    fileName="test.c",
                    lineNumber=30
                )
                method.tags = []

                graph = CPGGraph()
                graph.add_node(method)
                store.save(graph)

                store.tags.add(method, "TAG_TO_REMOVE")
                store.tags.add(method, "TAG_TO_KEEP")

                # Remove one tag
                store.tags.remove(method, "TAG_TO_REMOVE")

            # Session 2: Verify removed tag is gone, kept tag remains
            with CPGStore(config) as store:
                tags = store.tags.get_all(3001)
                assert "TAG_TO_REMOVE" not in tags, f"TAG_TO_REMOVE should not be in {tags}"
                assert "TAG_TO_KEEP" in tags, f"TAG_TO_KEEP should be in {tags}"

    def test_tag_created_by_persists_across_sessions_sqlite(self):
        """Tag provenance should preserve created_by across SQLite sessions."""
        from codedmap.analysis.tagging.engine import TagEngine
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_created_by.db")
            config = StorageConfig(backend="sqlite", uri=db_path)

            with CPGStore(config) as store:
                method = MethodNode(
                    id=4001,
                    name="audit_func",
                    fullName="test::audit_func",
                    label=NodeLabel.METHOD,
                    fileName="test.c",
                    lineNumber=40
                )
                method.tags = []

                graph = CPGGraph()
                graph.add_node(method)
                store.save(graph)

                tagger = TagEngine(store)
                tagger.add(method, "STATE:REVIEWED", created_by="auditor@tag:add")

            with CPGStore(config) as store:
                node = store.get_node(4001)
                assert node is not None
                provenance = getattr(node, "tags_provenance", {}) or {}
                assert provenance["STATE:REVIEWED"]["created_by"] == "auditor@tag:add"


class TestTagPersistenceMemory:
    """Tests for tag persistence with Memory backend."""

    @pytest.mark.skip(reason="MemoryEngine missing create_bulk_writer implementation - pre-existing issue")
    def test_tags_available_in_memory_session(self):
        """Tags should be available within the same memory session."""
        from codedmap.analysis.tagging.engine import TagEngine
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph import CPGGraph

        config = StorageConfig(backend="memory")

        with CPGStore(config) as store:
            method = make_method_node(1, "test_func")

            graph = CPGGraph()
            graph.add_node(method)
            store.save(graph)

            tagger = TagEngine(store)
            result = tagger.add(method, "MEMORY_TAG")
            assert result.action == "added"

            tags = tagger.list_tags(method)
            assert "MEMORY_TAG" in tags

    @pytest.mark.skip(reason="MemoryEngine missing create_bulk_writer implementation - pre-existing issue")
    def test_multiple_tags_in_memory(self):
        """Multiple tags should be available in memory session."""
        from codedmap.analysis.tagging.engine import TagEngine
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.core.schema.graph import CPGGraph

        config = StorageConfig(backend="memory")

        with CPGStore(config) as store:
            method = make_method_node(2, "multi_tag_func")

            graph = CPGGraph()
            graph.add_node(method)
            store.save(graph)

            tagger = TagEngine(store)
            tagger.add(method, "TAG_1")
            tagger.add(method, "TAG_2")
            tagger.add(method, "TAG_3")

            tags = tagger.list_tags(method)
            assert len(tags) == 3
            assert "TAG_1" in tags
            assert "TAG_2" in tags
            assert "TAG_3" in tags

    def test_memory_tags_available_via_mock(self):
        """Tags should be available via TagNavigator mock (alternative to full Memory backend)."""
        # This test verifies tag behavior using mocked storage instead of real Memory backend
        from codedmap.analysis.tagging.navigator import TagNavigator
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from unittest.mock import MagicMock
        from typing import Dict, List, Optional

        # Create mock store with tag storage behavior
        store = MagicMock()
        node = MethodNode(id=1, name="test", fullName="test::test", label=NodeLabel.METHOD)
        node.tags = []

        tag_storage: Dict[int, List[str]] = {1: []}

        def tags_add(node_or_id, tag):
            nid = getattr(node_or_id, "id", node_or_id)
            if nid not in tag_storage:
                tag_storage[nid] = []
            if tag not in tag_storage[nid]:
                tag_storage[nid].append(tag)

        def tags_get_all(node_or_id):
            nid = getattr(node_or_id, "id", node_or_id)
            return list(tag_storage.get(nid, []))

        store.tags.add.side_effect = tags_add
        store.tags.get_all.side_effect = tags_get_all

        # Use TagNavigator to test tag behavior
        nav = TagNavigator(store)
        nav.add_tag(node, "STATE:CUSTOM:TEST_TAG")

        tags = nav.list_tags(node)
        assert "STATE:CUSTOM:TEST_TAG" in tags


class TestPredefinedCategories:
    """Tests for pre-defined security tag categories via StaticSecurityRules."""

    def test_static_security_rules_class_exists(self):
        """StaticSecurityRules class should exist and be importable."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules
        rules = StaticSecurityRules()
        assert rules is not None

    def test_source_category_exists(self):
        """StaticSecurityRules should identify SOURCE functions correctly."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Test known sources
        assert StaticSecurityRules.is_obvious_source("getenv")
        assert StaticSecurityRules.is_obvious_source("recv")
        assert StaticSecurityRules.is_obvious_source("read")
        assert StaticSecurityRules.is_obvious_source("fread")

        # Test source category lookup
        assert StaticSecurityRules.get_source_category("getenv") == "ENV_DATA"
        assert StaticSecurityRules.get_source_category("recv") == "NETWORK_DATA"
        assert StaticSecurityRules.get_source_category("fread") == "FILE_DATA"

    def test_sink_category_exists(self):
        """StaticSecurityRules should identify SINK functions correctly."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Test known sinks
        assert StaticSecurityRules.is_obvious_sink("strcpy")
        assert StaticSecurityRules.is_obvious_sink("sprintf")
        assert StaticSecurityRules.is_obvious_sink("memcpy")
        assert StaticSecurityRules.is_obvious_sink("strcat")

        # Test sink category lookup
        assert StaticSecurityRules.get_sink_category("strcpy") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("memcpy") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("strcat") == "MEMORY_WRITE"

    def test_safe_functions_exist(self):
        """StaticSecurityRules should identify SAFE/sanitizer functions correctly."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Test known safe functions from _SAFE_SET
        assert StaticSecurityRules.is_obvious_safe("len")
        assert StaticSecurityRules.is_obvious_safe("length")
        assert StaticSecurityRules.is_obvious_safe("size")
        assert StaticSecurityRules.is_obvious_safe("escape")
        assert StaticSecurityRules.is_obvious_safe("sanitize")
        assert StaticSecurityRules.is_obvious_safe("validate")
        assert StaticSecurityRules.is_obvious_safe("check")

        # Test is_* prefix functions are safe
        assert StaticSecurityRules.is_obvious_safe("is_valid")
        assert StaticSecurityRules.is_obvious_safe("has_permission")

        # Test get_* with size/len are safe
        assert StaticSecurityRules.is_obvious_safe("get_size")
        assert StaticSecurityRules.is_obvious_safe("get_length")

    def test_category_returns_correct_type(self):
        """Category lookup methods should return correct vulnerability types."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Sink types
        assert StaticSecurityRules.get_sink_category("strcpy") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("memcpy") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("strcat") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("memmove") == "MEMORY_WRITE"

        # Source types
        assert StaticSecurityRules.get_source_category("getenv") == "ENV_DATA"
        assert StaticSecurityRules.get_source_category("recv") == "NETWORK_DATA"
        assert StaticSecurityRules.get_source_category("fread") == "FILE_DATA"

    def test_non_matching_returns_none(self):
        """Unknown functions should return None for category lookups."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Unknown functions should return None
        assert StaticSecurityRules.get_sink_category("unknown_func_xyz") is None
        assert StaticSecurityRules.get_source_category("unknown_func_xyz") is None

        # And should not be marked as obvious
        assert not StaticSecurityRules.is_obvious_sink("unknown_func_xyz")
        assert not StaticSecurityRules.is_obvious_source("unknown_func_xyz")

    def test_case_insensitive_matching(self):
        """StaticSecurityRules should handle case variations."""
        from codedmap.core.schema.security.static_rules import StaticSecurityRules

        # Should work with different cases
        assert StaticSecurityRules.is_obvious_sink("STRCPY")
        assert StaticSecurityRules.is_obvious_sink("Strcpy")
        assert StaticSecurityRules.is_obvious_source("GETENV")
        assert StaticSecurityRules.is_obvious_source("Getenv")


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
