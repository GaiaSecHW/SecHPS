# tests/analysis/passes/test_ontology_migration.py
"""
Tests for ONTOLOGY format migration across consumers.

Covers:
- BackwardTracingNavigator._has_entry_point_tag uses SecurityTagMatcher
- _parse_entry_point_tags in context.py handles ONTOLOGY format
- ModuleNavigator.compute_metrics uses SecurityTagMatcher for entry points and sinks
- SecurityTaggingPass._format_tag_name emits ONTOLOGY format
"""

import pytest
from unittest.mock import MagicMock

import sys
import os
sys.path.append(os.getcwd())


# =========================================================================
# BackwardTracingNavigator entry point tag recognition
# =========================================================================

class TestTracingNavigatorOntologyMigration:
    """BackwardTracingNavigator recognizes ONTOLOGY:ENTRY_POINT:* tags."""

    def test_has_entry_point_tag_ontology(self):
        """Test T3-1: ONTOLOGY:ENTRY_POINT:HTTP is recognized as entry point."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        store = MagicMock()
        nav = BackwardTracingNavigator(store)

        node = MagicMock()
        store.tags.get_all.return_value = ["ONTOLOGY:ENTRY_POINT:HTTP"]

        assert nav._has_entry_point_tag(node) is True

    def test_has_entry_point_tag_ontology_cli(self):
        """ONTOLOGY:ENTRY_POINT:CLI is recognized."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        store = MagicMock()
        nav = BackwardTracingNavigator(store)

        node = MagicMock()
        store.tags.get_all.return_value = ["ONTOLOGY:ENTRY_POINT:CLI"]

        assert nav._has_entry_point_tag(node) is True

    def test_has_entry_point_tag_legacy_rejected(self):
        """Test T3-2: Legacy security:entry_point:* is NOT recognized."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        store = MagicMock()
        nav = BackwardTracingNavigator(store)

        node = MagicMock()
        store.tags.get_all.return_value = ["security:entry_point:L1:network"]

        assert nav._has_entry_point_tag(node) is False

    def test_has_entry_point_tag_no_tags(self):
        """No tags means not an entry point."""
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        store = MagicMock()
        nav = BackwardTracingNavigator(store)

        node = MagicMock()
        store.tags.get_all.return_value = []

        assert nav._has_entry_point_tag(node) is False


# =========================================================================
# Context assembly: _parse_entry_point_tags ONTOLOGY format
# =========================================================================

class TestParseEntryPointTagsOntology:
    """_parse_entry_point_tags extracts from ONTOLOGY:ENTRY_POINT:{cat} format."""

    def test_parse_ontology_http(self):
        """Test T3-3: ONTOLOGY:ENTRY_POINT:HTTP -> ('?', 'http', 'http')."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(["ONTOLOGY:ENTRY_POINT:HTTP"])
        # Level is no longer in the tag
        assert category == "http"
        assert ep_type == "http"

    def test_parse_ontology_data_input(self):
        """ONTOLOGY:ENTRY_POINT:DATA_INPUT -> ('?', 'data_input', 'data_input')."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(["ONTOLOGY:ENTRY_POINT:DATA_INPUT"])
        assert category == "data_input"

    def test_parse_ontology_syscall(self):
        """ONTOLOGY:ENTRY_POINT:SYSCALL -> ('?', 'syscall', 'syscall')."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(["ONTOLOGY:ENTRY_POINT:SYSCALL"])
        assert category == "syscall"

    def test_parse_empty_tags(self):
        """Empty tags returns defaults."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags([])
        assert level == "?"
        assert category == "?"
        assert ep_type == "?"

    def test_parse_non_entry_point_tags(self):
        """Non entry point tags returns defaults."""
        from codedmap.app.query.context import _parse_entry_point_tags

        level, category, ep_type = _parse_entry_point_tags(["ONTOLOGY:SINK:SQL_INJECTION"])
        assert category == "?"


# =========================================================================
# ModuleNavigator.compute_metrics uses SecurityTagMatcher
# =========================================================================

class TestModuleMetricsOntologyMigration:
    """compute_metrics uses SecurityTagMatcher for entry_point_count and sink_count."""

    def test_entry_point_count_ontology_format(self):
        """Test T3-5: Methods with ONTOLOGY:ENTRY_POINT:* counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        store = MagicMock()
        nav = ModuleNavigator(store)

        # Mock methods with ONTOLOGY-format tags
        method1 = MagicMock()
        method1.tags = ["ONTOLOGY:ENTRY_POINT:HTTP"]
        method2 = MagicMock()
        method2.tags = ["ONTOLOGY:ENTRY_POINT:CLI"]
        method3 = MagicMock()
        method3.tags = ["ONTOLOGY:SINK:SQL_INJECTION"]
        method4 = MagicMock()
        method4.tags = []

        file1 = MagicMock()
        file1.id = 100

        # Patch get_methods and get_files
        nav.get_methods = MagicMock(return_value=iter([method1, method2, method3, method4]))
        nav.get_files = MagicMock(return_value=iter([file1]))
        store.apply_patch = MagicMock()

        metrics = nav.compute_metrics(1, cache=False)

        assert metrics.entry_point_count == 2
        assert metrics.method_count == 4

    def test_sink_count_ontology_format(self):
        """Test T3-6: Methods with ONTOLOGY:SINK:* counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        store = MagicMock()
        nav = ModuleNavigator(store)

        method1 = MagicMock()
        method1.tags = ["ONTOLOGY:SINK:SQL_INJECTION"]
        method2 = MagicMock()
        method2.tags = ["ONTOLOGY:SINK:BUFFER_OVERFLOW"]
        method3 = MagicMock()
        method3.tags = ["ONTOLOGY:ENTRY_POINT:HTTP"]
        method4 = MagicMock()
        method4.tags = []

        file1 = MagicMock()
        file1.id = 100

        nav.get_methods = MagicMock(return_value=iter([method1, method2, method3, method4]))
        nav.get_files = MagicMock(return_value=iter([file1]))
        store.apply_patch = MagicMock()

        metrics = nav.compute_metrics(1, cache=False)

        assert metrics.sink_count == 2

    def test_legacy_entry_point_not_counted(self):
        """Test T3-7: Legacy SECURITY:ENTRY_POINT:* NOT counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        store = MagicMock()
        nav = ModuleNavigator(store)

        method1 = MagicMock()
        method1.tags = ["SECURITY:ENTRY_POINT:L1:NETWORK"]  # Legacy format
        method2 = MagicMock()
        method2.tags = []

        file1 = MagicMock()
        file1.id = 100

        nav.get_methods = MagicMock(return_value=iter([method1, method2]))
        nav.get_files = MagicMock(return_value=iter([file1]))
        store.apply_patch = MagicMock()

        metrics = nav.compute_metrics(1, cache=False)

        # Legacy format should NOT be counted
        assert metrics.entry_point_count == 0

    def test_legacy_sink_not_counted(self):
        """Test T3-8: Legacy SINK: prefix NOT counted."""
        from codedmap.analysis.traversal.module import ModuleNavigator

        store = MagicMock()
        nav = ModuleNavigator(store)

        method1 = MagicMock()
        method1.tags = ["SINK:SQL"]  # Legacy v1.1 format
        method2 = MagicMock()
        method2.tags = ["SINK_KNOWN_SYSTEM"]  # Legacy flat format

        file1 = MagicMock()
        file1.id = 100

        nav.get_methods = MagicMock(return_value=iter([method1, method2]))
        nav.get_files = MagicMock(return_value=iter([file1]))
        store.apply_patch = MagicMock()

        metrics = nav.compute_metrics(1, cache=False)

        assert metrics.sink_count == 0


# =========================================================================
# SecurityTaggingPass._format_tag_name ONTOLOGY format
# =========================================================================

class TestFormatTagNameOntology:
    """_format_tag_name emits ONTOLOGY:{ROLE}:{CATEGORY} format."""

    def _make_pass_instance(self):
        """Helper to create SecurityTaggingPass with mocked dependencies."""
        from codedmap.analysis.passes.ai.smart_dataflow_tagging import SecurityTaggingPass
        from unittest.mock import patch

        mock_store = MagicMock()
        mock_config = MagicMock()
        mock_config.ai.enable_llm = True
        mock_config.ai.model_name = "gpt-4"
        mock_config.get_openai_api_key.return_value = "fake"
        mock_config.ai.api_base = "https://api.openai.com/v1"

        with patch("codedmap.analysis.passes.ai.base.ContextLoader"):
            pass_instance = SecurityTaggingPass(mock_store, mock_config)

        return pass_instance

    def test_format_source_tag(self):
        """Test T3-9: SOURCE + CLI -> SEMANTIC:SOURCE:CLI (LLM inference uses SEMANTIC layer)."""
        from codedmap.infra.ai.services.taint_tagger import TagDecision

        pass_instance = self._make_pass_instance()
        decision = TagDecision(role="SOURCE", category="CLI", confidence=0.9)
        tag_name = pass_instance._format_tag_name(decision)
        assert tag_name == "SEMANTIC:SOURCE:CLI"

    def test_format_sink_tag(self):
        """Test T3-10: SINK + SQL_INJECTION -> SEMANTIC:SINK:SQL_INJECTION (LLM inference uses SEMANTIC layer)."""
        from codedmap.infra.ai.services.taint_tagger import TagDecision

        pass_instance = self._make_pass_instance()
        decision = TagDecision(role="SINK", category="SQL_INJECTION", confidence=0.9)
        tag_name = pass_instance._format_tag_name(decision)
        assert tag_name == "SEMANTIC:SINK:SQL_INJECTION"

    def test_format_sanitizer_tag(self):
        """SANITIZER + ESCAPE -> SEMANTIC:SANITIZER:ESCAPE (LLM inference uses SEMANTIC layer)."""
        from codedmap.infra.ai.services.taint_tagger import TagDecision

        pass_instance = self._make_pass_instance()
        decision = TagDecision(role="SANITIZER", category="ESCAPE", confidence=0.9)
        tag_name = pass_instance._format_tag_name(decision)
        assert tag_name == "SEMANTIC:SANITIZER:ESCAPE"


# =========================================================================
# StaticSecurityRules tag format (via heuristic_filter)
# =========================================================================

class TestStaticSecurityRulesTagFormat:
    """StaticSecurityRules tags applied via SecurityTaggingPass use ONTOLOGY format."""

    def test_static_sink_tag_ontology_format(self):
        """Test T3-11: Static sink detection emits ONTOLOGY:SINK:{category}."""
        from codedmap.analysis.passes.ai.smart_dataflow_tagging import SecurityTaggingPass
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from unittest.mock import patch

        mock_store = MagicMock()
        mock_store.tags.get_all.return_value = []
        mock_config = MagicMock()
        mock_config.ai.enable_llm = True
        mock_config.ai.model_name = "gpt-4"
        mock_config.get_openai_api_key.return_value = "fake"
        mock_config.ai.api_base = "https://api.openai.com/v1"

        with patch("codedmap.analysis.passes.ai.base.ContextLoader"):
            pass_instance = SecurityTaggingPass(mock_store, mock_config)

        node = MethodNode(id=1, name="exec", is_external=False, label=NodeLabel.METHOD, fullName="os/exec.go")

        # This triggers static rule interception which should add ONTOLOGY format tag
        should_process = pass_instance.heuristic_filter(node)

        assert should_process is False
        # Check the tag added
        mock_store.tags.add.assert_called()
        actual_tag = mock_store.tags.add.call_args[0][1]
        assert actual_tag.startswith("ONTOLOGY:SINK:"), f"Expected ONTOLOGY:SINK: prefix, got: {actual_tag}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
