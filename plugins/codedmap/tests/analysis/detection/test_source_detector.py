# tests/analysis/detection/test_source_detector.py
"""
Unit tests for SourceDetector — Smart Wrapper grouping pattern.

Key behavior:
- detect_all() returns Source objects grouped by enclosing METHOD node
- Multiple CALL matches in the same METHOD → one Source with multiple triggers
- CALL nodes with no enclosing METHOD are skipped gracefully
- Each trigger has 'node' and 'taint_target' keys
- detect_by_category() filters by SourceCategory
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import Mock, MagicMock, patch, call
from typing import List, Dict, Any, Optional

from codedmap.core.schema.security.source_models import Source, SourceCategory
from codedmap.core.schema.security.source_catalog import SourceCatalog
from codedmap.core.schema.security.source_rules import SourceRule, SourcePattern
from codedmap.core.schema.graph.enums import Language


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MockNode:
    """Minimal mock CPGNode for testing."""

    def __init__(
        self,
        node_id: int,
        name: str = "",
        label: str = "CALL",
        file_name: str = "",
        line_number: int = 0,
        code: str = "",
        methodFullName: str = "",
        language: str = "c",
        **kwargs,
    ):
        self.id = node_id
        self.name = name
        self.label = label
        self.fileName = file_name
        self.lineNumber = line_number
        self.code = code
        self.methodFullName = methodFullName
        self.language = language
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __repr__(self):
        return f"MockNode(id={self.id}, name={self.name}, label={self.label})"


class MockFileNode:
    """Mock FileNode with language attribute."""
    def __init__(self, name: str, language: str = "c"):
        self.name = name
        self.language = Language.C if language.lower() == "c" else Language.PYTHON


def make_store(
    call_nodes: Optional[List[MockNode]] = None,
    method_for_call: Optional[Dict[int, Optional[MockNode]]] = None,
    file_for_node: Optional[Dict[int, MockFileNode]] = None,
):
    """Build a mock CPGStore.

    call_nodes        — returned by query.all_nodes_in() and all_nodes_containing_any()
    method_for_call   — maps call_node_id → the METHOD ancestor (or None if orphan)
    file_for_node     — maps node_id → MockFileNode for language lookup
    """
    store = Mock()
    store.query = Mock()
    store.methods = Mock()

    call_nodes = call_nodes or []
    method_for_call = method_for_call or {}
    file_for_node = file_for_node or {}
    method_nodes = [m for m in method_for_call.values() if m is not None]
    method_node_ids = {m.id for m in method_nodes}

    call_node_dicts = [
        {
            "id": n.id,
            "name": n.name,
            "label": n.label,
            "code": getattr(n, "code", "") or "",
            "fileName": getattr(n, "fileName", "") or "",
            "lineNumber": getattr(n, "lineNumber", 0) or 0,
            "methodFullName": getattr(n, "methodFullName", "") or "",
        }
        for n in call_nodes
    ]

    def _make_raw_result(node_dicts):
        mock_result = Mock()
        mock_result.raw.return_value = iter(node_dicts)
        return mock_result

    store.query.all_nodes_in.return_value = _make_raw_result(call_node_dicts)
    store.query.all_nodes_containing_any.return_value = _make_raw_result(call_node_dicts)

    all_nodes = call_nodes + method_nodes

    def _by_ids(ids):
        nodes = [n for n in all_nodes if n.id in ids]
        mock_result = Mock()
        mock_result.to_list.return_value = nodes
        return mock_result

    store.query.by_ids.side_effect = _by_ids

    store.get_node.return_value = None

    def _get_neighbors(node_id, direction, edge_types):
        mapped = method_for_call.get(node_id)
        if mapped is not None:
            return [mapped.id]
        return []

    def _get_node(node_id):
        for node in all_nodes:
            if node.id == node_id:
                return node
        return None

    def _get_neighbors_batch(node_ids, direction, edge_types):
        result = {}
        for nid in node_ids:
            mapped = method_for_call.get(nid)
            if mapped is not None:
                result[nid] = [mapped.id]
            else:
                result[nid] = []
        return result

    def _by_id(node_id):
        mock_query = Mock()
        file_node = file_for_node.get(node_id, MockFileNode("default.c", language="c"))
        mock_file_result = Mock()
        mock_file_result.first.return_value = file_node
        mock_query.file.return_value = mock_file_result
        return mock_query

    store.get_neighbors.side_effect = _get_neighbors
    store.get_node.side_effect = _get_node
    store.get_neighbors_batch.side_effect = _get_neighbors_batch
    store.query.by_id.side_effect = _by_id

    return store


def make_catalog_with_rule(
    name: str = "test_recv",
    category: SourceCategory = SourceCategory.NETWORK_DATA,
    function: str = "recv",
    taints: str = "return",
) -> SourceCatalog:
    """Build a SourceCatalog with a single synthetic rule."""
    pattern = SourcePattern(type="call", function=function, taints=taints)
    rule = SourceRule(name=name, category=category, patterns=[pattern])
    catalog = SourceCatalog(rules=[rule])
    return catalog


# ---------------------------------------------------------------------------
# Test 1: Same METHOD — grouped into one Source with two triggers
# ---------------------------------------------------------------------------

class TestGroupingBySameMethod:
    """Two CALL nodes in the same METHOD → one Source with two triggers."""

    def test_two_calls_same_method_returns_one_source(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="read_data", label="METHOD", file_name="net.c", line_number=5)
        call1 = MockNode(101, name="recv", label="CALL", file_name="net.c", line_number=10, code="recv(fd, buf, 64, 0)")
        call2 = MockNode(102, name="recv", label="CALL", file_name="net.c", line_number=20, code="recv(fd, buf2, 32, 0)")
        file_node = MockFileNode("net.c", language="c")

        store = make_store(
            call_nodes=[call1, call2],
            method_for_call={101: method, 102: method},
            file_for_node={101: file_node, 102: file_node},
        )
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()

        assert len(results) == 1, f"Expected 1 Source, got {len(results)}"
        source = results[0]
        assert source.node_id == method.id
        assert len(source.triggers) == 2

    def test_two_calls_same_method_trigger_count(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="read_data", label="METHOD")
        call1 = MockNode(101, name="recv", label="CALL")
        call2 = MockNode(102, name="recv", label="CALL")
        file_node = MockFileNode("net.c", language="c")

        store = make_store(
            call_nodes=[call1, call2],
            method_for_call={101: method, 102: method},
            file_for_node={101: file_node, 102: file_node},
        )
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        sources = detector.detect_all()
        assert sources[0].triggers[0]["taint_target"] == "return"
        assert sources[0].triggers[1]["taint_target"] == "return"


# ---------------------------------------------------------------------------
# Test 2: Different METHODs — two separate Source objects
# ---------------------------------------------------------------------------

class TestGroupingByDifferentMethods:
    """Two CALL nodes in different METHODs → two Sources."""

    def test_two_calls_different_methods_returns_two_sources(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method_a = MockNode(10, name="func_a", label="METHOD", file_name="a.c", line_number=1)
        method_b = MockNode(20, name="func_b", label="METHOD", file_name="b.c", line_number=1)
        call1 = MockNode(101, name="recv", label="CALL")
        call2 = MockNode(102, name="recv", label="CALL")

        store = make_store(
            call_nodes=[call1, call2],
            method_for_call={101: method_a, 102: method_b},
        )
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()

        assert len(results) == 2
        node_ids = {s.node_id for s in results}
        assert node_ids == {method_a.id, method_b.id}


# ---------------------------------------------------------------------------
# Test 3: Trigger dict shape — keys 'node' and 'taint_target'
# ---------------------------------------------------------------------------

class TestTriggerShape:
    """Each trigger dict must have 'node' (with id/label/code) and 'taint_target'."""

    def test_trigger_has_required_keys(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="proc", label="METHOD")
        call = MockNode(101, name="recv", label="CALL", code="recv(s, buf, 128, 0)")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        sources = detector.detect_all()
        trigger = sources[0].triggers[0]

        assert "node" in trigger
        assert "taint_target" in trigger

    def test_trigger_node_has_id_label_code(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="proc", label="METHOD")
        call = MockNode(101, name="recv", label="CALL", code="recv(s, buf, 128, 0)")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        sources = detector.detect_all()
        node_dict = sources[0].triggers[0]["node"]

        assert "id" in node_dict
        assert "label" in node_dict
        assert "code" in node_dict
        assert node_dict["id"] == call.id
        assert node_dict["code"] == call.code


# ---------------------------------------------------------------------------
# Test 4: taint_target matches SourcePattern.taints
# ---------------------------------------------------------------------------

class TestTaintTargetPropagation:
    """taint_target in trigger must come from the SourcePattern.taints field."""

    def test_taint_target_is_return(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="f", label="METHOD")
        call = MockNode(101, name="getenv", label="CALL")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(function="getenv", taints="return")
        detector = SourceDetector(store, catalog=catalog)

        sources = detector.detect_all()
        assert sources[0].triggers[0]["taint_target"] == "return"

    def test_taint_target_is_param(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="f", label="METHOD")
        call = MockNode(101, name="recv", label="CALL")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(function="recv", taints="param[1]")
        detector = SourceDetector(store, catalog=catalog)

        sources = detector.detect_all()
        assert sources[0].triggers[0]["taint_target"] == "param[1]"


# ---------------------------------------------------------------------------
# Test 5: detect_by_category filters by SourceCategory
# ---------------------------------------------------------------------------

class TestDetectByCategory:
    """detect_by_category returns only matching category Sources."""

    def test_detect_by_category_env_var(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="f", label="METHOD")
        call = MockNode(101, name="getenv", label="CALL")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(category=SourceCategory.ENV_DATA, function="getenv")
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_by_category(SourceCategory.ENV_DATA)
        assert len(results) == 1
        assert results[0].category == SourceCategory.ENV_DATA

    def test_detect_by_category_excludes_others(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="f", label="METHOD")
        call = MockNode(101, name="getenv", label="CALL")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(category=SourceCategory.ENV_DATA, function="getenv")
        detector = SourceDetector(store, catalog=catalog)

        # Asking for NETWORK_DATA when only ENV_DATA rule exists → empty
        results = detector.detect_by_category(SourceCategory.NETWORK_DATA)
        assert len(results) == 0


# ---------------------------------------------------------------------------
# Test 6: CALL node with no enclosing METHOD — skipped gracefully
# ---------------------------------------------------------------------------

class TestOrphanCallNodes:
    """CALL nodes that have no enclosing METHOD are silently skipped."""

    def test_orphan_call_no_crash(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        call = MockNode(101, name="recv", label="CALL")

        # No parent method mapping — store.get_neighbors always returns []
        store = make_store(call_nodes=[call], method_for_call={})
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        # Must not crash
        results = detector.detect_all()
        assert results == []

    def test_orphan_mixed_with_valid(self):
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="f", label="METHOD")
        call_valid = MockNode(101, name="recv", label="CALL")
        call_orphan = MockNode(102, name="recv", label="CALL")

        # Only call_valid has a parent method
        store = make_store(
            call_nodes=[call_valid, call_orphan],
            method_for_call={101: method},
        )
        catalog = make_catalog_with_rule()
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        # Only the valid call contributes a Source
        assert len(results) == 1
        assert results[0].node_id == method.id
        assert len(results[0].triggers) == 1


# ---------------------------------------------------------------------------
# Test 7: Exact match on function name — no substring false positives
# ---------------------------------------------------------------------------

class TestExactFunctionNameMatch:
    """Function name matching must be exact, not substring-based."""

    def test_read_option_arg_not_matched_by_read_rule(self):
        """read_option_arg should NOT match a rule for 'read' function."""
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="parse_options", label="METHOD")
        call = MockNode(101, name="read_option_arg", label="CALL", code="read_option_arg(opt)")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(function="read", taints="return")
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        assert len(results) == 0, "read_option_arg should NOT match 'read' rule"

    def test_fopen_exact_match(self):
        """fopen should match 'fopen' rule exactly."""
        from codedmap.analysis.detection.source_detector import SourceDetector

        method = MockNode(10, name="load_file", label="METHOD")
        call = MockNode(101, name="fopen", label="CALL", code="fopen(path, \"r\")")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        catalog = make_catalog_with_rule(function="fopen", taints="return")
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        assert len(results) == 1
        assert results[0].triggers[0]["taint_target"] == "return"


# ---------------------------------------------------------------------------
# Test 8: Two-phase matching with fullname regex
# ---------------------------------------------------------------------------

class TestTwoPhaseMatching:
    """Two-phase matching: Fast Path (exact name) + Precision Path (fullname regex)."""

    def test_name_match_without_fullname_passes(self):
        """Without fullname constraint, exact name match should pass."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="handler", label="METHOD")
        call = MockNode(101, name="open", label="CALL", code="open(path)", methodFullName="std::fstream::open")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        pattern = SourcePattern(type="call", function="open", taints="return")
        rule = SourceRule(name="fstream_open", category=SourceCategory.FILE_DATA, patterns=[pattern])
        catalog = SourceCatalog(rules=[rule])
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        assert len(results) == 1

    def test_name_match_with_fullname_regex_passes(self):
        """With matching fullname regex, should pass Precision Path."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="handler", label="METHOD")
        call = MockNode(101, name="open", label="CALL", code="open(path)", methodFullName="std::fstream::open")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        pattern = SourcePattern(type="call", function="open", taints="return", fullname=".*fstream::open.*")
        rule = SourceRule(name="fstream_open", category=SourceCategory.FILE_DATA, patterns=[pattern])
        catalog = SourceCatalog(rules=[rule])
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        assert len(results) == 1

    def test_name_match_with_fullname_regex_fails(self):
        """With non-matching fullname regex, should fail Precision Path."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="handler", label="METHOD")
        call = MockNode(101, name="open", label="CALL", code="open(path)", methodFullName="::open")

        store = make_store(call_nodes=[call], method_for_call={101: method})
        pattern = SourcePattern(type="call", function="open", taints="return", fullname=".*fstream::open.*")
        rule = SourceRule(name="fstream_open", category=SourceCategory.FILE_DATA, patterns=[pattern])
        catalog = SourceCatalog(rules=[rule])
        detector = SourceDetector(store, catalog=catalog)

        results = detector.detect_all()
        assert len(results) == 0, "Should not match when fullname regex fails"


# ---------------------------------------------------------------------------
# Test 9: Language filtering
# ---------------------------------------------------------------------------

class TestLanguageFiltering:
    """Rules should be filtered by target languages from config."""

    def test_python_rule_not_matched_for_c_project(self):
        """Python rule should not match when config specifies C language."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="main", label="METHOD", file_name="main.c")
        ident = MockNode(101, name="argv", label="IDENTIFIER", code="argv")

        store = make_store(call_nodes=[], method_for_call={})
        ident_store = make_store(call_nodes=[], method_for_call={101: method})
        ident_store.query.all_nodes_in.return_value.raw.return_value = iter([{
            "id": 101,
            "name": "argv",
            "label": "IDENTIFIER",
            "code": "argv",
        }])

        python_pattern = SourcePattern(type="identifier", name="argv", taints="return")
        python_rule = SourceRule(
            name="sys.argv",
            category=SourceCategory.ENV_DATA,
            patterns=[python_pattern],
            languages=["python"]
        )
        catalog = SourceCatalog(rules=[python_rule])

        config = Mock()
        config.languages = ["c"]

        detector = SourceDetector(store, config=config, catalog=catalog)
        detector._ast.batch_get_enclosing_methods = lambda ids: {101: method}

        results = detector.detect_all()
        assert len(results) == 0, "Python rule should not match C project"

    def test_c_rule_matched_for_c_project(self):
        """C rule should match when config specifies C language."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="main", label="METHOD", file_name="main.c")

        store = make_store(call_nodes=[], method_for_call={})
        store.query.all_nodes_in.return_value.raw.return_value = iter([{
            "id": 101,
            "name": "argv",
            "label": "IDENTIFIER",
            "code": "argv",
        }])

        c_pattern = SourcePattern(type="identifier", name="argv", taints="return")
        c_rule = SourceRule(
            name="argv",
            category=SourceCategory.ENV_DATA,
            patterns=[c_pattern],
            languages=["c", "cpp"]
        )
        catalog = SourceCatalog(rules=[c_rule])

        config = Mock()
        config.languages = ["c"]

        detector = SourceDetector(store, config=config, catalog=catalog)
        detector._ast.batch_get_enclosing_methods = lambda ids: {101: method}

        results = detector.detect_all()
        assert len(results) == 1


# ---------------------------------------------------------------------------
# Test 10: Trigger deduplication
# ---------------------------------------------------------------------------

class TestTriggerDeduplication:
    """Triggers should be deduplicated by (node_id, taint_target)."""

    def test_same_node_different_rules_single_trigger(self):
        """Same node matching multiple rules should produce single trigger."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="main", label="METHOD")
        ident = MockNode(101, name="argv", label="IDENTIFIER", code="argv")

        store = make_store(call_nodes=[], method_for_call={})
        store.query.all_nodes_in.return_value.raw.return_value = iter([{
            "id": 101,
            "name": "argv",
            "label": "IDENTIFIER",
            "code": "argv",
        }])

        pattern1 = SourcePattern(type="identifier", name="argv", taints="return")
        pattern2 = SourcePattern(type="identifier", name="argv", taints="return")
        rule1 = SourceRule(name="rule1", category=SourceCategory.ENV_DATA, patterns=[pattern1])
        rule2 = SourceRule(name="rule2", category=SourceCategory.ENV_DATA, patterns=[pattern2])
        catalog = SourceCatalog(rules=[rule1, rule2])

        detector = SourceDetector(store, catalog=catalog)
        detector._ast.batch_get_enclosing_methods = lambda ids: {101: method}

        results = detector.detect_all()
        assert len(results) == 1
        assert len(results[0].triggers) == 1, "Should deduplicate triggers"

    def test_same_node_different_taints_multiple_triggers(self):
        """Same node with different taint targets should produce multiple triggers."""
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule

        method = MockNode(10, name="handler", label="METHOD")
        call = MockNode(101, name="recv", label="CALL", code="recv(fd, buf, len, 0)")

        store = make_store(call_nodes=[], method_for_call={})
        store.query.all_nodes_in.return_value.raw.return_value = iter([{
            "id": 101,
            "name": "recv",
            "label": "CALL",
            "code": "recv(fd, buf, len, 0)",
        }])

        pattern1 = SourcePattern(type="call", function="recv", taints="return")
        pattern2 = SourcePattern(type="call", function="recv", taints="param[1]")
        rule = SourceRule(name="recv", category=SourceCategory.NETWORK_DATA, patterns=[pattern1, pattern2])
        catalog = SourceCatalog(rules=[rule])

        detector = SourceDetector(store, catalog=catalog)
        detector._ast.batch_get_enclosing_methods = lambda ids: {101: method}

        results = detector.detect_all()
        assert len(results) == 1
        assert len(results[0].triggers) == 2, "Different taint targets should produce separate triggers"


# ---------------------------------------------------------------------------
# Task 2 Tests: SourcePass
# ---------------------------------------------------------------------------

class TestSourcePassBasic:
    """SourcePass importable and extends BaseBatchPass."""

    def test_source_pass_importable(self):
        from codedmap.analysis.passes.batch.source_pass import SourcePass
        assert SourcePass is not None

    def test_source_pass_extends_base_batch_pass(self):
        from codedmap.analysis.passes.batch.source_pass import SourcePass
        from codedmap.analysis.passes.base_batch import BaseBatchPass
        assert issubclass(SourcePass, BaseBatchPass)

    def test_source_pass_has_no_prune_targets(self):
        from codedmap.analysis.passes.batch.source_pass import SourcePass
        from pathlib import Path

        mock_store = Mock()
        mock_store.query = Mock()
        mock_runner = Mock()

        full_config = Mock()
        full_config.storage = Mock()
        full_config.storage.work_dir = Path("/tmp/cpg_test")

        sp = SourcePass(mock_store, mock_runner, full_config)
        assert sp.prune_targets == []


class TestSourcePassRun:
    """SourcePass.run() tags METHOD nodes for detected sources."""

    def test_run_empty_store_no_crash(self):
        """SourcePass.run() on empty store completes without raising."""
        from codedmap.analysis.passes.batch.source_pass import SourcePass
        from pathlib import Path

        store = Mock()
        store.query = Mock()

        mock_query_result = Mock()
        mock_query_result.filter.return_value = mock_query_result
        mock_query_result.where_contains.return_value = mock_query_result
        mock_query_result.to_list.return_value = []
        store.query.all_nodes.return_value = mock_query_result
        store.get_neighbors.return_value = []
        store.get_node.return_value = None

        runner = Mock()
        full_config = Mock()
        full_config.storage = Mock()
        full_config.storage.work_dir = Path("/tmp/cpg_test")

        sp = SourcePass(store, runner, full_config)
        # Must not raise
        sp.run()

    def test_run_tags_method_node_for_detected_source(self):
        """SourcePass tags the METHOD node with source.full_tag for each detected source."""
        from codedmap.analysis.passes.batch.source_pass import SourcePass
        from codedmap.core.schema.security.source_models import Source, SourceCategory
        from pathlib import Path

        store = Mock()
        runner = Mock()
        full_config = Mock()
        full_config.storage = Mock()
        full_config.storage.work_dir = Path("/tmp/cpg_test")

        method_node = MockNode(10, name="read_data", label="METHOD")
        store.get_node.return_value = method_node

        # Mock SourceDetector to return a synthetic source
        mock_source = Source(
            node_id=10,
            name="read_data",
            file="net.c",
            line=5,
            category=SourceCategory.NETWORK_DATA,
            rule_name="recv",
            triggers=[],
        )

        # Patch SourceDetector and TagEngine at their canonical module locations
        # (both are lazy-imported inside run())
        with patch("codedmap.analysis.detection.source_detector.SourceDetector") as MockDetector, \
             patch("codedmap.analysis.tagging.TagEngine") as MockTagEngine:
            mock_detector_instance = Mock()
            mock_detector_instance.detect_all.return_value = [mock_source]
            MockDetector.return_value = mock_detector_instance

            mock_tagger = Mock()
            MockTagEngine.return_value = mock_tagger

            sp = SourcePass(store, runner, full_config)
            sp.run()

            # TagEngine.add_system_tag should be called once with the method node and full_tag
            mock_tagger.add_system_tag.assert_called_once_with(method_node, mock_source.full_tag)
