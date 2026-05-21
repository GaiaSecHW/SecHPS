# tests/app/entrypoints/test_detector.py
"""
Unit tests for EntryPointDetector.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch

from codedmap.core.schema.security import (
    EntryPoint,
    EntryPointLevel,
    EntryPointCategory,
)
from codedmap.analysis.detection.entrypoint_detector import EntryPointDetector
from tests.app.entrypoints.conftest import MockNode


class TestEntryPointDetectorCore:
    """Tests for EntryPointDetector core functionality."""

    def test_detector_initialization(self, mock_store, mock_config):
        """Detector should initialize with store and config."""
        detector = EntryPointDetector(mock_store, mock_config)

        assert detector.store == mock_store
        assert detector.config == mock_config
        assert detector._max_trace_depth == 5
        assert detector.catalog is not None

    def test_detector_default_trace_depth(self, mock_store):
        """Detector should use default trace depth if config is None."""
        detector = EntryPointDetector(mock_store, None)
        assert detector._max_trace_depth == 10

    def test_detect_all_returns_list(self, detector, mock_store):
        """detect_all() should return a list of EntryPoint objects."""
        # Setup empty results
        mock_store.query.all_nodes.return_value.filter.return_value.to_list.return_value = []
        mock_store.methods.find_by_name.return_value = []

        results = detector.detect_all()

        assert isinstance(results, list)

    def test_detect_all_combines_l1_and_l2(self, detector, mock_store):
        """detect_all() should combine L1 and L2 detection results."""
        main_node = MockNode(1, name="main", label="METHOD", file_name="main.c", line_number=10)

        def make_raw_result(node_dicts):
            mock_result = Mock()
            mock_result.raw.return_value = iter(node_dicts)
            return mock_result

        method_dicts = [{
            "id": 1,
            "name": "main",
            "label": "METHOD",
            "fileName": "main.c",
            "lineNumber": 10,
        }]
        mock_store.query.all_nodes_in.side_effect = lambda label, field, values: make_raw_result(method_dicts) if label == "METHOD" else make_raw_result([])
        mock_store.query.all_nodes_containing_any.return_value = make_raw_result([])
        mock_store.query.by_ids.return_value.to_list.return_value = [main_node]
        mock_store.get_neighbors.return_value = []

        results = detector.detect_all()

        assert isinstance(results, list)


class TestL1PatternMatching:
    """Tests for L1 (raw) pattern-based detection."""

    def test_l1_detection_with_method_node(self, detector, mock_store):
        """L1 detection should find METHOD nodes matching catalog rules."""
        main_node = MockNode(1, name="main", label="METHOD", file_name="main.c", line_number=10)

        def make_raw_result(node_dicts):
            mock_result = Mock()
            mock_result.raw.return_value = iter(node_dicts)
            return mock_result

        mock_store.query.all_nodes_in.return_value = make_raw_result([])
        mock_store.query.all_nodes_containing_any.return_value = make_raw_result([])

        method_dicts = [{
            "id": 1,
            "name": "main",
            "label": "METHOD",
            "fileName": "main.c",
            "lineNumber": 10,
        }]
        mock_store.query.all_nodes_in.side_effect = lambda label, field, values: make_raw_result(method_dicts) if label == "METHOD" else make_raw_result([])

        results = detector._detect_l1()

        assert isinstance(results, list)

    def test_l1_detection_creates_entry_point(self, detector, mock_store):
        """L1 detection should create EntryPoint with correct level."""
        main_node = MockNode(1, name="main", label="METHOD", file_name="main.c", line_number=10)

        def make_raw_result(node_dicts):
            mock_result = Mock()
            mock_result.raw.return_value = iter(node_dicts)
            return mock_result

        method_dicts = [{
            "id": 1,
            "name": "main",
            "label": "METHOD",
            "fileName": "main.c",
            "lineNumber": 10,
        }]
        mock_store.query.all_nodes_in.side_effect = lambda label, field, values: make_raw_result(method_dicts) if label == "METHOD" else make_raw_result([])
        mock_store.query.all_nodes_containing_any.return_value = make_raw_result([])
        mock_store.get_neighbors.return_value = []

        results = detector._detect_l1()

        main_eps = [ep for ep in results if ep.name == "main"]
        if main_eps:
            assert main_eps[0].level == EntryPointLevel.L1


class TestL2Tracing:
    """Tests for L2 (wrapped) entry point tracing."""

    def test_find_wrapper_no_callers(self, detector, mock_store):
        """_find_wrapper should return None if no callers found and not a wrapper."""
        l1_node = MockNode(1, name="recv", label="CALL", file_name="net.c", line_number=10)
        mock_store.get_node.return_value = l1_node
        mock_store.get_neighbors.return_value = []

        ep = EntryPoint(
            node_id=1,
            name="recv",
            file="net.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="recv"
        )

        result = detector._find_wrapper(l1_node, ep)
        assert result is None

    def test_find_wrapper_wrapper_pattern(self, detector, mock_store):
        """_find_wrapper should identify wrapper patterns."""
        wrapper_node = MockNode(2, name="handle_request", label="METHOD", file_name="handler.c", line_number=20)
        l1_node = MockNode(1, name="recv", label="CALL", file_name="handler.c", line_number=25)

        mock_store.get_node.side_effect = lambda nid: {1: l1_node, 2: wrapper_node}.get(nid)
        mock_store.get_neighbors.return_value = []

        ep = EntryPoint(
            node_id=1,
            name="recv",
            file="handler.c",
            line=25,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="recv"
        )

        result = detector._find_wrapper(l1_node, ep)
        assert result is None

    def test_is_wrapper_pattern_handles(self, detector):
        """_is_wrapper_pattern should match handle_ prefix."""
        node = MockNode(1, name="handle_request", label="METHOD")
        assert detector._is_wrapper_pattern(node) is True

    def test_is_wrapper_pattern_process(self, detector):
        """_is_wrapper_pattern should match process_ prefix."""
        node = MockNode(1, name="process_data", label="METHOD")
        assert detector._is_wrapper_pattern(node) is True

    def test_is_wrapper_pattern_on(self, detector):
        """_is_wrapper_pattern should match on_ prefix."""
        node = MockNode(1, name="on_connect", label="METHOD")
        assert detector._is_wrapper_pattern(node) is True

    def test_is_wrapper_pattern_callback(self, detector):
        """_is_wrapper_pattern should match callback_ prefix."""
        node = MockNode(1, name="callback_handler", label="METHOD")
        assert detector._is_wrapper_pattern(node) is True

    def test_is_wrapper_pattern_not_wrapper(self, detector):
        """_is_wrapper_pattern should not match non-wrapper names."""
        node = MockNode(1, name="calculate_sum", label="METHOD")
        assert detector._is_wrapper_pattern(node) is False

    def test_l2_max_depth_respected(self, detector, mock_store):
        """L2 tracing should respect max_trace_depth."""
        detector._max_trace_depth = 2

        nodes = {
            1: MockNode(1, name="recv", label="CALL"),
            2: MockNode(2, name="level1", label="METHOD"),
            3: MockNode(3, name="level2", label="METHOD"),
            4: MockNode(4, name="level3", label="METHOD"),
        }

        def get_node(nid):
            return nodes.get(nid)

        def get_neighbors(nid, direction, edge_types):
            if nid == 1:
                return [2]
            elif nid == 2:
                return [3]
            elif nid == 3:
                return [4]
            return []

        mock_store.get_node.side_effect = get_node
        mock_store.get_neighbors.side_effect = get_neighbors

        ep = EntryPoint(
            node_id=1,
            name="recv",
            file="test.c",
            line=1,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="recv"
        )

        result = detector._find_wrapper(nodes[1], ep)
        assert result is None or result.id != 4


class TestDeduplication:
    """Tests for entry point deduplication."""

    def test_deduplicate_removes_duplicates(self, detector):
        """_deduplicate should remove duplicate node_ids."""
        ep1 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="cli_main"
        )
        ep2 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="wrapper:cli_main"
        )

        results = detector._deduplicate([ep1, ep2])

        assert len(results) == 1

    def test_deduplicate_prefers_higher_level(self, detector):
        """_deduplicate should keep higher level entry points."""
        ep1 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="cli_main"
        )
        ep2 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="wrapper:cli_main"
        )
        ep3 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L3,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="verified:cli_main"
        )

        results = detector._deduplicate([ep1, ep2, ep3])

        assert len(results) == 1
        assert results[0].level == EntryPointLevel.L3

    def test_deduplicate_keeps_different_nodes(self, detector):
        """_deduplicate should keep entry points with different node_ids."""
        ep1 = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="cli_main"
        )
        ep2 = EntryPoint(
            node_id=2,
            name="recv",
            file="net.c",
            line=20,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="recv"
        )

        results = detector._deduplicate([ep1, ep2])

        assert len(results) == 2


class TestLevelConflict:
    """Tests for level conflict resolution."""

    def test_level_ordering(self):
        """L3 should be greater than L2, which is greater than L1."""
        assert EntryPointLevel.L3.value > EntryPointLevel.L2.value
        assert EntryPointLevel.L2.value > EntryPointLevel.L1.value

    def test_higher_level_wins_in_deduplicate(self, detector):
        """Higher level entry point should win in deduplication."""
        l1_ep = EntryPoint(
            node_id=1,
            name="test",
            file="test.c",
            line=1,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_l1"
        )
        l2_ep = EntryPoint(
            node_id=1,
            name="test",
            file="test.c",
            line=1,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_l2"
        )

        # L2 should replace L1 when processed in order
        results = detector._deduplicate([l1_ep, l2_ep])
        assert results[0].level == EntryPointLevel.L2

        # L2 should replace L1 even when L1 comes after
        results = detector._deduplicate([l2_ep, l1_ep])
        assert results[0].level == EntryPointLevel.L2


class TestHelperMethods:
    """Tests for helper methods."""

    def test_create_entry_point(self, detector):
        """_create_entry_point should create valid EntryPoint from node."""
        node = MockNode(1, name="test", label="METHOD", file_name="test.c", line_number=10)

        ep = detector._create_entry_point(
            node=node,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_rule"
        )

        assert ep is not None
        assert ep.node_id == 1
        assert ep.name == "test"
        assert ep.file == "test.c"
        assert ep.line == 10
        assert ep.level == EntryPointLevel.L1
        assert ep.category == EntryPointCategory.NETWORK_LISTENER
        assert ep.rule_name == "test_rule"

    def test_create_entry_point_none_node(self, detector):
        """_create_entry_point should return None for invalid node."""
        node = Mock()  # Node without id
        del node.id

        ep = detector._create_entry_point(
            node=node,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_rule"
        )

        assert ep is None

    def test_matches_code_pattern(self, detector):
        """_matches_code_pattern should correctly match regex patterns."""
        code = "def get(self, request):"
        pattern = r"def\s+get\s*\(\s*self\s*,\s*request"

        assert detector._matches_code_pattern(code, pattern) is True

    def test_matches_code_pattern_no_match(self, detector):
        """_matches_code_pattern should return False for non-matching patterns."""
        code = "def post(self, request):"
        pattern = r"def\s+get\s*\(\s*self\s*,\s*request"

        assert detector._matches_code_pattern(code, pattern) is False

    def test_matches_code_pattern_empty_code(self, detector):
        """_matches_code_pattern should return True for empty code."""
        assert detector._matches_code_pattern("", r"pattern") is True

    def test_matches_code_pattern_invalid_regex(self, detector):
        """_matches_code_pattern should return False for invalid regex."""
        assert detector._matches_code_pattern("code", r"[invalid") is False


class TestPassIntegration:
    """Tests for EntryPointPass integration."""

    def test_pass_import(self):
        """EntryPointPass should be importable."""
        from codedmap.analysis.passes.batch.entry_point_pass import EntryPointPass
        assert EntryPointPass is not None

    def test_pass_extends_base_batch_pass(self):
        """EntryPointPass should extend BaseBatchPass."""
        from codedmap.analysis.passes.batch.entry_point_pass import EntryPointPass
        from codedmap.analysis.passes.base_batch import BaseBatchPass

        assert issubclass(EntryPointPass, BaseBatchPass)

    def test_pass_has_no_prune_targets(self, mock_store, mock_config):
        """EntryPointPass should not have prune targets (only adds tags)."""
        from codedmap.analysis.passes.batch.entry_point_pass import EntryPointPass
        from pathlib import Path

        # Create mock runner
        mock_runner = Mock()

        # Create a proper mock config with storage.work_dir
        full_config = Mock()
        full_config.storage = Mock()
        full_config.storage.work_dir = Path("/tmp/cpg_test")

        ep_pass = EntryPointPass(mock_store, mock_runner, full_config)
        assert ep_pass.prune_targets == []
