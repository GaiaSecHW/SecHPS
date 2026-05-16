# tests/integration/test_ontology_unification.py
"""
Integration test: End-to-end ONTOLOGY tag format unification.

Verifies that no consumer emits or matches legacy tag formats.
"""

import pytest
import ast
import sys
import os

sys.path.append(os.getcwd())


class TestOntologyUnificationIntegration:
    """End-to-end integration: all security tags use ONTOLOGY:* format."""

    def test_entry_point_full_tag_is_ontology(self):
        """EntryPoint.full_tag produces ONTOLOGY format for all categories."""
        from codedmap.core.schema.security.entrypoint_models import (
            EntryPoint, EntryPointCategory, EntryPointLevel
        )

        for cat in EntryPointCategory:
            ep = EntryPoint(
                node_id=1, name="test", file="test.py", line=1,
                level=EntryPointLevel.L1, category=cat, rule_name="test"
            )
            assert ep.full_tag.startswith("ONTOLOGY:ENTRY_POINT:"), \
                f"Category {cat.value}: got {ep.full_tag}"

    def test_security_tag_matcher_rejects_all_legacy(self):
        """SecurityTagMatcher rejects every known legacy format."""
        from codedmap.core.schema.tags import SecurityTagMatcher

        legacy_tags = [
            # Flat v1.0
            "SOURCE_HTTP", "SOURCE_USER_INPUT",
            "SINK_BUFFER_OVERFLOW", "SINK_KNOWN_SYSTEM",
            "SANITIZER_XSS", "SANITIZER_ESCAPE",
            # Colon v1.1
            "SINK:SQL", "SOURCE:HTTP",
            # Old entry point
            "security:entry_point:L1:network",
            "SECURITY:ENTRY_POINT:L1:NETWORK",
            "SECURITY:ENTRY_POINT",
        ]

        for tag in legacy_tags:
            assert SecurityTagMatcher.is_security_tag(tag) is False, \
                f"Legacy tag should be rejected: {tag}"
            assert SecurityTagMatcher.is_entry_point(tag) is False, \
                f"Legacy entry point should be rejected: {tag}"
            assert SecurityTagMatcher.is_source(tag) is False, \
                f"Legacy source should be rejected: {tag}"
            assert SecurityTagMatcher.is_sink(tag) is False, \
                f"Legacy sink should be rejected: {tag}"
            assert SecurityTagMatcher.is_sanitizer(tag) is False, \
                f"Legacy sanitizer should be rejected: {tag}"

    def test_ontology_categories_complete(self):
        """All ONTOLOGY_CATEGORIES include expected entries."""
        from codedmap.core.schema.tags import ONTOLOGY_CATEGORIES

        assert "ENTRY_POINT" in ONTOLOGY_CATEGORIES
        assert "SOURCE" in ONTOLOGY_CATEGORIES
        assert "SINK" in ONTOLOGY_CATEGORIES
        assert "SANITIZER" in ONTOLOGY_CATEGORIES

        # V2 ENTRY_POINT categories
        assert "NETWORK_LISTENER" in ONTOLOGY_CATEGORIES["ENTRY_POINT"]

    def test_no_legacy_string_literals_in_source(self):
        """No production source files contain hardcoded legacy tag format strings.

        Scans for patterns like:
        - 'security:entry_point:'
        - 'SECURITY:ENTRY_POINT'
        - startswith("SINK:")
        - startswith("SOURCE_")
        """
        import re

        # Files we migrated (and should no longer have legacy patterns)
        files_to_check = [
            "codedmap/core/schema/security/entrypoint_models.py",
            "codedmap/analysis/passes/batch/entry_point_pass.py",
            "codedmap/analysis/traversal/tracing.py",
            "codedmap/app/query/context.py",
            "codedmap/analysis/traversal/module.py",
            "codedmap/analysis/passes/ai/smart_dataflow_tagging.py",
            "codedmap/app/query/root.py",
        ]

        legacy_patterns = [
            re.compile(r'"security:entry_point:', re.IGNORECASE),
            re.compile(r"'security:entry_point:", re.IGNORECASE),
            re.compile(r'"SECURITY:ENTRY_POINT'),
            re.compile(r"'SECURITY:ENTRY_POINT"),
            re.compile(r'startswith\(["\']SINK:'),
            re.compile(r'startswith\(["\']SECURITY:ENTRY_POINT'),
        ]

        violations = []
        for filepath in files_to_check:
            if not os.path.exists(filepath):
                continue
            with open(filepath) as f:
                content = f.read()
            for pattern in legacy_patterns:
                matches = pattern.findall(content)
                if matches:
                    violations.append(
                        f"{filepath}: Found legacy pattern '{matches[0]}'"
                    )

        assert not violations, \
            "Legacy tag format strings found in production code:\n" + "\n".join(violations)

    def test_matcher_module_is_core_pure(self):
        """SecurityTagMatcher module has no imports from app/infra/analysis."""
        import codedmap.core.schema.tags.matcher as mod
        import inspect

        source = inspect.getsource(mod)
        forbidden = ["codedmap.app", "codedmap.infra", "codedmap.analysis"]
        for pkg in forbidden:
            assert pkg not in source, \
                f"matcher.py must not import {pkg}"

    def test_round_trip_entry_point_to_dict_from_dict(self):
        """EntryPoint serialization round-trip preserves ONTOLOGY tag."""
        from codedmap.core.schema.security.entrypoint_models import (
            EntryPoint, EntryPointCategory, EntryPointLevel
        )

        ep = EntryPoint(
            node_id=42, name="handler", file="app.py", line=10,
            level=EntryPointLevel.L2, category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="http_handler"
        )
        d = ep.to_dict()
        assert d["full_tag"] == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"

        ep2 = EntryPoint.from_dict(d)
        assert ep2.full_tag == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"
        assert ep2.level == EntryPointLevel.L2
        assert ep2.category == EntryPointCategory.NETWORK_LISTENER


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
