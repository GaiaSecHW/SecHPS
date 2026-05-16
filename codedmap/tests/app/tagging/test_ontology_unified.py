"""
Unified ONTOLOGY format tests for all consumers — ONTOLOGY-only.

Verifies that tracing (BackwardTracingNavigator), module metrics (ModuleNavigator),
and context assembly (_parse_entry_point_tags) all recognize ONTOLOGY:* format
and reject legacy formats.

Requirements: ONT-02, ONT-03
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock, patch
from typing import List, Dict, Optional

from codedmap.core.schema.graph.nodes import MethodNode, ModuleNode, FileNode
from codedmap.core.schema.graph.enums import Language, NodeLabel, EdgeType
from codedmap.core.schema.tags.matcher import SecurityTagMatcher
from codedmap.core.schema.tags.ontology import ONTOLOGY_CATEGORIES


# =========================================================================
# Helpers
# =========================================================================

def _make_node(id: int, name: str, tags: Optional[List[str]] = None,
               label=NodeLabel.METHOD) -> MethodNode:
    node = MethodNode(id=id, name=name, fullName=f"pkg.{name}",
                      label=label, signature=f"void {name}()")
    node.tags = tags or []
    return node


def _make_mock_store_for_tracing(nodes_by_id: dict):
    """Build a minimal mock CPGStore for BackwardTracingNavigator."""
    store = MagicMock()

    def get_node(nid):
        return nodes_by_id.get(nid)

    store.get_node.side_effect = get_node

    tag_storage = {nid: list(getattr(n, "tags", []) or [])
                   for nid, n in nodes_by_id.items()}

    def tags_get_all(node_or_id):
        nid = getattr(node_or_id, "id", node_or_id)
        return list(tag_storage.get(nid, []))

    store.tags.get_all.side_effect = tags_get_all

    # Mock query for base navigator
    store.query = MagicMock()
    return store


# =========================================================================
# Tests: BackwardTracingNavigator
# =========================================================================

class TestTracingNavigatorOntology:
    """BackwardTracingNavigator must recognize ONTOLOGY tags only."""

    def test_has_entry_point_tag_ontology_recognized(self):
        """_has_entry_point_tag recognizes ONTOLOGY:ENTRY_POINT:HTTP."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        node = _make_node(1, "handle_request", tags=["ONTOLOGY:ENTRY_POINT:HTTP"])
        store = _make_mock_store_for_tracing({1: node})
        nav = BackwardTracingNavigator(store)

        assert nav._has_entry_point_tag(node) is True

    def test_has_entry_point_tag_legacy_rejected(self):
        """_has_entry_point_tag does NOT recognize legacy security:entry_point:*."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        node = _make_node(2, "handler", tags=["security:entry_point:L1:network"])
        store = _make_mock_store_for_tracing({2: node})
        nav = BackwardTracingNavigator(store)

        assert nav._has_entry_point_tag(node) is False

    def test_check_controllable_entry_point(self):
        """_check_controllable returns 'entry_point' for ONTOLOGY:ENTRY_POINT:* tag."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        node = _make_node(3, "main", tags=["ONTOLOGY:ENTRY_POINT:CLI"])
        store = _make_mock_store_for_tracing({3: node})
        nav = BackwardTracingNavigator(store)

        result = nav._check_controllable(3)
        assert result == "entry_point"

    def test_check_controllable_source_tag(self):
        """_check_controllable returns 'source' for ONTOLOGY:SOURCE:* tag."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        node = _make_node(4, "read_input", tags=["ONTOLOGY:SOURCE:USER_INPUT"])
        store = _make_mock_store_for_tracing({4: node})
        nav = BackwardTracingNavigator(store)

        result = nav._check_controllable(4)
        assert result == "source"

    def test_check_controllable_legacy_source_not_by_tag(self):
        """Non-security layered tag does NOT trigger source termination via tag check."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        # STATE:CUSTOM:UNKNOWN_TAG — valid layered tag, not recognized by SecurityTagMatcher as source
        node = _make_node(5, "unknown_func", tags=["STATE:CUSTOM:UNKNOWN_TAG"])
        store = _make_mock_store_for_tracing({5: node})
        nav = BackwardTracingNavigator(store)

        # Should not terminate as source (STATE:CUSTOM:UNKNOWN_TAG is not a SOURCE tag)
        result = nav._check_controllable(5)
        assert result is None  # "unknown_func" is not in StaticSecurityRules


# =========================================================================
# Tests: ModuleNavigator.compute_metrics
# =========================================================================

def _make_module_store(methods):
    """Build mock store for ModuleNavigator using same MockChain pattern as test_module_navigator.py."""
    mod = ModuleNode(id=100, name="test_mod", fullName="test.mod",
                     label=NodeLabel.MODULE)
    f = FileNode(id=101, name="test.c", fullName="test.c", label=NodeLabel.FILE, language=Language.C)

    nodes = [mod, f] + methods
    id_map = {n.id: n for n in nodes}

    # Build edges: mod -> CONTAINS -> f, f -> AST -> each method
    edges = [(mod, EdgeType.CONTAINS, f)]
    for m in methods:
        edges.append((f, EdgeType.AST, m))

    store = MagicMock()

    # Build adjacency
    graph: Dict = {}
    for src, etype, dst in edges:
        etype_val = etype.value if hasattr(etype, 'value') else str(etype)
        graph.setdefault((src.id, etype_val, "OUT"), []).append(dst)
        graph.setdefault((dst.id, etype_val, "IN"), []).append(src)

    class MockChain:
        def __init__(self, items):
            self._items = list(items)
        def out(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                for n in graph.get((item.id, et, "OUT"), []):
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)
        def in_(self, edge_type, target_class=None):
            et = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
            result = []
            for item in self._items:
                for n in graph.get((item.id, et, "IN"), []):
                    if target_class is None or isinstance(n, target_class):
                        result.append(n)
            return MockChain(result)
        def descendants(self, target_label=None, max_depth=10):
            visited = set(item.id for item in self._items)
            frontier = list(self._items)
            result = []
            for _ in range(max_depth):
                nf = []
                for node in frontier:
                    for child in graph.get((node.id, EdgeType.AST.value, "OUT"), []):
                        if child.id not in visited:
                            visited.add(child.id)
                            nf.append(child)
                            lbl = getattr(child, 'label', None)
                            lbl_str = lbl.value if hasattr(lbl, 'value') else str(lbl)
                            tl = target_label.value if hasattr(target_label, 'value') else str(target_label) if target_label else None
                            if tl is None or lbl_str == tl:
                                result.append(child)
                frontier = nf
                if not frontier:
                    break
            return MockChain(result)
        def distinct(self):
            seen = set()
            result = []
            for item in self._items:
                if item.id not in seen:
                    seen.add(item.id)
                    result.append(item)
            return MockChain(result)
        def first(self):
            return self._items[0] if self._items else None
        def to_list(self):
            return list(self._items)
        def __iter__(self):
            return iter(self._items)
        def __len__(self):
            return len(self._items)

    store.query.by_id.side_effect = lambda nid: MockChain([id_map[nid]] if nid in id_map else [])
    store.get_node.side_effect = lambda nid: id_map.get(nid)
    store.apply_patch = MagicMock()

    return store, mod


class TestModuleMetricsOntology:
    """ModuleNavigator.compute_metrics must use SecurityTagMatcher."""

    def test_entry_point_ontology_counted(self):
        """Method tagged ONTOLOGY:ENTRY_POINT:CLI is counted in entry_point_count."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        m1 = _make_node(1, "main", tags=["ONTOLOGY:ENTRY_POINT:CLI"])
        m2 = _make_node(2, "helper", tags=[])
        store, mod = _make_module_store([m1, m2])
        nav = ModuleNavigator(store)

        metrics = nav.compute_metrics(mod, cache=False)
        assert metrics.entry_point_count == 1

    def test_entry_point_legacy_not_counted(self):
        """Method tagged security:entry_point:L1:network is NOT counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        m1 = _make_node(1, "handler", tags=["security:entry_point:L1:network"])
        m2 = _make_node(2, "helper", tags=[])
        store, mod = _make_module_store([m1, m2])
        nav = ModuleNavigator(store)

        metrics = nav.compute_metrics(mod, cache=False)
        assert metrics.entry_point_count == 0

    def test_sink_ontology_counted(self):
        """Method tagged ONTOLOGY:SINK:SQL_INJECTION is counted in sink_count."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        m1 = _make_node(1, "query", tags=["ONTOLOGY:SINK:SQL_INJECTION"])
        m2 = _make_node(2, "helper", tags=[])
        store, mod = _make_module_store([m1, m2])
        nav = ModuleNavigator(store)

        metrics = nav.compute_metrics(mod, cache=False)
        assert metrics.sink_count == 1

    def test_sink_legacy_not_counted(self):
        """Method tagged SINK_BUFFER_OVERFLOW is NOT counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        m1 = _make_node(1, "strcpy", tags=["SINK_BUFFER_OVERFLOW"])
        m2 = _make_node(2, "helper", tags=[])
        store, mod = _make_module_store([m1, m2])
        nav = ModuleNavigator(store)

        metrics = nav.compute_metrics(mod, cache=False)
        assert metrics.sink_count == 0


# =========================================================================
# Tests: _parse_entry_point_tags (context.py)
# =========================================================================

class TestContextParseEntryPointTags:
    """_parse_entry_point_tags must use SecurityTagMatcher."""

    def test_ontology_format_parsed(self):
        """ONTOLOGY:ENTRY_POINT:HTTP extracts category='http'."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(
            ["ONTOLOGY:ENTRY_POINT:HTTP"]
        )
        assert category == "http"

    def test_ontology_format_cli(self):
        """ONTOLOGY:ENTRY_POINT:CLI extracts category='cli'."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(
            ["ONTOLOGY:ENTRY_POINT:CLI"]
        )
        assert category == "cli"

    def test_legacy_format_rejected(self):
        """security:entry_point:L1:network returns no match."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(
            ["security:entry_point:L1:network"]
        )
        assert category == "?"

    def test_empty_tags(self):
        """Empty tag list returns defaults."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags([])
        assert level == "?"
        assert category == "?"

    def test_non_entry_point_tags_ignored(self):
        """Non-entry-point tags are skipped."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(
            ["ONTOLOGY:SOURCE:USER_INPUT", "SEMANTIC:AUTH:HIGH"]
        )
        assert category == "?"


# =========================================================================
# Tests: TagEngine duplicate detection (auto_tag_by_rules removed in Phase 38)
# =========================================================================

# TestTagEngineDuplicateDetectionOntology removed — auto_tag_by_rules() deleted in Phase 38.
# Sink/source detection is now handled by EntryPointPass + SourcePass + SinkPass.


# =========================================================================
# Tests: ONTOLOGY_CATEGORIES completeness
# =========================================================================

class TestOntologyCategoriesCompleteness:
    """Every entry in ONTOLOGY_CATEGORIES has a corresponding SecurityTagMatcher match."""

    def test_all_entry_points_recognized(self):
        for name in ONTOLOGY_CATEGORIES["ENTRY_POINT"]:
            tag = f"ONTOLOGY:ENTRY_POINT:{name}"
            assert SecurityTagMatcher.is_entry_point(tag), f"{tag} not recognized"
            assert SecurityTagMatcher.is_security_tag(tag), f"{tag} not a security tag"

    def test_all_sources_recognized(self):
        for name in ONTOLOGY_CATEGORIES["SOURCE"]:
            tag = f"ONTOLOGY:SOURCE:{name}"
            assert SecurityTagMatcher.is_source(tag), f"{tag} not recognized"
            assert SecurityTagMatcher.is_security_tag(tag), f"{tag} not a security tag"

    def test_all_sinks_recognized(self):
        for name in ONTOLOGY_CATEGORIES["SINK"]:
            tag = f"ONTOLOGY:SINK:{name}"
            assert SecurityTagMatcher.is_sink(tag), f"{tag} not recognized"
            assert SecurityTagMatcher.is_security_tag(tag), f"{tag} not a security tag"

    def test_all_sanitizers_recognized(self):
        for name in ONTOLOGY_CATEGORIES["SANITIZER"]:
            tag = f"ONTOLOGY:SANITIZER:{name}"
            assert SecurityTagMatcher.is_sanitizer(tag), f"{tag} not recognized"
            assert SecurityTagMatcher.is_security_tag(tag), f"{tag} not a security tag"

    def test_role_tags_not_security_tags(self):
        """ROLE tags are ONTOLOGY but NOT security tags (no is_role matcher)."""
        for name in ONTOLOGY_CATEGORIES["ROLE"]:
            tag = f"ONTOLOGY:ROLE:{name}"
            assert not SecurityTagMatcher.is_security_tag(tag), \
                f"{tag} should not be a security tag"

    def test_parse_entry_point_extracts_category(self):
        for name in ONTOLOGY_CATEGORIES["ENTRY_POINT"]:
            tag = f"ONTOLOGY:ENTRY_POINT:{name}"
            category, _ = SecurityTagMatcher.parse_entry_point(tag)
            assert category == name, f"parse_entry_point({tag}) returned {category}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
