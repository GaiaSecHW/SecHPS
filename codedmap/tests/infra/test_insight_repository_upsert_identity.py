"""
Regression tests for InsightRepository upsert identity semantics.

Invariants under test:
- host_ids are treated as an unordered set (dedupe + sort) for identity matching.
- Upsert hit performs full replacement of mutable fields (PUT-like), including confidence.
- Equivalent host_id permutations do not create duplicate InsightNode records.
"""
import sys, os
sys.path.append(os.getcwd())
import pytest

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph import CPGGraph
from codedmap.utils.id_generator import generate_id


def _make_store():
    """Create a fresh in-memory CPGStore for testing."""
    return CPGStore(StorageConfig(backend="memory"))


def _graph_with_nodes(nodes):
    graph = CPGGraph()
    for node in nodes:
        graph.add_node(node)
    return graph


def _make_method_node(node_id: int, name: str) -> MethodNode:
    return MethodNode(id=node_id, name=name, label=NodeLabel.METHOD)


class TestUpsertHostIdSetSemantics:
    """Validate that host_ids are normalized as an unordered set before identity matching."""

    def setup_method(self):
        self.store = _make_store()
        # Pre-insert 3 method nodes
        ids = [generate_id(), generate_id(), generate_id()]
        nodes = [_make_method_node(nid, f"fn_{i}") for i, nid in enumerate(ids)]
        self.store._engine.writer.save_graph(_graph_with_nodes(nodes))
        self.id1, self.id2, self.id3 = ids

    def teardown_method(self):
        self.store.close()

    def test_upsert_host_ids_order_and_duplicates_do_not_create_new_insight(self):
        """
        Upserting with host IDs [id3, id2, id2, id1] and then [id1, id2, id3] must
        resolve to the same InsightNode — no duplicate records created.
        """
        id1, id2, id3 = self.id1, self.id2, self.id3

        # First upsert with shuffled + duplicate host IDs
        insight_a = self.store.insights.upsert(
            host_ids=[id3, id2, id2, id1],
            category="ARCHITECTURE",
            source="test_agent",
            title="Multi-host note",
            content="First content",
            confidence=0.9,
        )

        # Second upsert with same IDs in sorted order (no duplicates)
        insight_b = self.store.insights.upsert(
            host_ids=[id1, id2, id3],
            category="ARCHITECTURE",
            source="test_agent",
            title="Multi-host note",
            content="Updated content",
            confidence=0.8,
        )

        # Must resolve to the SAME insight (same id)
        assert insight_a.id == insight_b.id, (
            f"Expected same insight id but got {insight_a.id} vs {insight_b.id}. "
            "Permuted host_ids created a duplicate InsightNode."
        )

        # Total INSIGHT node count must be 1
        all_insights = self.store.insights.find_all_insights()
        assert len(all_insights) == 1, (
            f"Expected 1 InsightNode, found {len(all_insights)}. "
            "Duplicate records were created for equivalent host_id sets."
        )

        # Content should reflect the update (second upsert)
        assert insight_b.content == "Updated content"


class TestUpsertFullReplacement:
    """Validate that upsert update hit performs full replacement (PUT-like) semantics."""

    def setup_method(self):
        self.store = _make_store()
        # Pre-insert 1 method node
        self.host_id = generate_id()
        node = _make_method_node(self.host_id, "target_fn")
        self.store._engine.writer.save_graph(_graph_with_nodes([node]))

    def teardown_method(self):
        self.store.close()

    def test_upsert_full_replacement_overwrites_content_status_confidence(self):
        """
        Upsert update hit must replace all mutable fields including confidence (even when None).
        This validates PUT-like (full replacement) semantics, not partial-update (PATCH) semantics.
        """
        host_id = self.host_id

        # Create initial insight with confidence set
        self.store.insights.upsert(
            host_ids=[host_id],
            category="VULNERABILITY",
            source="scanner",
            title="Auth bypass",
            content="Initial content",
            confidence=0.95,
            status="active",
        )

        # Update: clear confidence (set to None) and change content + status
        updated = self.store.insights.upsert(
            host_ids=[host_id],
            category="VULNERABILITY",
            source="scanner",
            title="Auth bypass",
            content="Revised content",
            confidence=None,
            status="reviewed",
        )

        assert updated is not None, "Upsert returned None"
        assert updated.content == "Revised content", (
            f"Expected 'Revised content', got '{updated.content}'"
        )
        assert updated.status == "reviewed", (
            f"Expected status='reviewed', got '{updated.status}'"
        )
        assert updated.confidence is None, (
            f"Expected confidence=None after full replacement, got {updated.confidence}. "
            "Upsert is not doing full replacement (PUT semantics violated)."
        )
