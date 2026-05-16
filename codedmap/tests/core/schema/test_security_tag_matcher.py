# tests/core/schema/test_security_tag_matcher.py
"""
Tests for SecurityTagMatcher — L1 ONTOLOGY + L2 SEMANTIC security tag matching.

Covers:
- ONT-01: L1 ONTOLOGY registry matching (system rules)
- ONT-02: L2 SEMANTIC registry matching (AI inference)
- ONT-03: Legacy format rejection (no backward compatibility)
"""

import pytest
import sys
import os
import inspect

sys.path.append(os.getcwd())

from codedmap.core.schema.tags import SecurityTagMatcher, ONTOLOGY_CATEGORIES


# =========================================================================
# SecurityTagMatcher.is_entry_point()
# =========================================================================

class TestIsEntryPoint:
    """ONTOLOGY:ENTRY_POINT:* and SEMANTIC:ENTRY_POINT:* are recognized entry point prefixes."""

    def test_ontology_entry_point_http(self):
        """Test 1: ONTOLOGY:ENTRY_POINT:HTTP recognized."""
        assert SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:HTTP") is True

    def test_ontology_entry_point_cli(self):
        assert SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:CLI") is True

    def test_ontology_entry_point_data_input(self):
        assert SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:DATA_INPUT") is True

    def test_ontology_entry_point_syscall(self):
        assert SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:SYSCALL") is True

    def test_semantic_entry_point_http(self):
        """SEMANTIC:ENTRY_POINT:HTTP is also recognized (L2 AI inference)."""
        assert SecurityTagMatcher.is_entry_point("SEMANTIC:ENTRY_POINT:HTTP") is True

    def test_semantic_entry_point_cli(self):
        assert SecurityTagMatcher.is_entry_point("SEMANTIC:ENTRY_POINT:CLI") is True

    def test_legacy_security_colon_format_rejected(self):
        """Test 2: Legacy security:entry_point:L1:network is rejected."""
        assert SecurityTagMatcher.is_entry_point("security:entry_point:L1:network") is False

    def test_dead_prefix_rejected(self):
        """Test 3: SECURITY:ENTRY_POINT (v1.1 dead prefix) is rejected."""
        assert SecurityTagMatcher.is_entry_point("SECURITY:ENTRY_POINT") is False

    def test_security_entry_point_with_level(self):
        """SECURITY:ENTRY_POINT:L1:NETWORK is rejected."""
        assert SecurityTagMatcher.is_entry_point("SECURITY:ENTRY_POINT:L1:NETWORK") is False

    def test_empty_string(self):
        assert SecurityTagMatcher.is_entry_point("") is False

    def test_random_string(self):
        assert SecurityTagMatcher.is_entry_point("CUSTOM_TAG") is False


# =========================================================================
# SecurityTagMatcher.is_source()
# =========================================================================

class TestIsSource:
    """ONTOLOGY:SOURCE:* and SEMANTIC:SOURCE:* are recognized source prefixes."""

    def test_ontology_source_user_input(self):
        """Test 4: ONTOLOGY:SOURCE:USER_INPUT recognized."""
        assert SecurityTagMatcher.is_source("ONTOLOGY:SOURCE:USER_INPUT") is True

    def test_ontology_source_network_io(self):
        assert SecurityTagMatcher.is_source("ONTOLOGY:SOURCE:NETWORK_IO") is True

    def test_semantic_source_matched(self):
        """SEMANTIC:SOURCE:* is also a valid source (L2 AI inference)."""
        assert SecurityTagMatcher.is_source("SEMANTIC:SOURCE:USER_INPUT") is True

    def test_legacy_flat_source_rejected(self):
        """Test 5: SOURCE_HTTP (legacy flat) is rejected."""
        assert SecurityTagMatcher.is_source("SOURCE_HTTP") is False

    def test_legacy_source_user_input_rejected(self):
        assert SecurityTagMatcher.is_source("SOURCE_USER_INPUT") is False


# =========================================================================
# SecurityTagMatcher.is_sink()
# =========================================================================

class TestIsSink:
    """ONTOLOGY:SINK:* and SEMANTIC:SINK:* are recognized sink prefixes."""

    def test_ontology_sink_sql_injection(self):
        """Test 6: ONTOLOGY:SINK:SQL_INJECTION recognized."""
        assert SecurityTagMatcher.is_sink("ONTOLOGY:SINK:SQL_INJECTION") is True

    def test_ontology_sink_buffer_overflow(self):
        assert SecurityTagMatcher.is_sink("ONTOLOGY:SINK:BUFFER_OVERFLOW") is True

    def test_semantic_sink_matched(self):
        """SEMANTIC:SINK:* is also a valid sink (L2 AI inference)."""
        assert SecurityTagMatcher.is_sink("SEMANTIC:SINK:SQL_INJECTION") is True

    def test_legacy_flat_sink_rejected(self):
        """Test 7: SINK_BUFFER_OVERFLOW (legacy flat) is rejected."""
        assert SecurityTagMatcher.is_sink("SINK_BUFFER_OVERFLOW") is False

    def test_legacy_sink_known_rejected(self):
        assert SecurityTagMatcher.is_sink("SINK_KNOWN_SYSTEM") is False

    def test_v1_1_sink_prefix_rejected(self):
        """Test 8: SINK:SQL (v1.1 prefix) is rejected."""
        assert SecurityTagMatcher.is_sink("SINK:SQL") is False


# =========================================================================
# SecurityTagMatcher.is_sanitizer()
# =========================================================================

class TestIsSanitizer:
    """ONTOLOGY:SANITIZER:* and SEMANTIC:SANITIZER:* are recognized sanitizer prefixes."""

    def test_ontology_sanitizer_escape(self):
        """Test 9: ONTOLOGY:SANITIZER:ESCAPE recognized."""
        assert SecurityTagMatcher.is_sanitizer("ONTOLOGY:SANITIZER:ESCAPE") is True

    def test_ontology_sanitizer_bounds_check(self):
        assert SecurityTagMatcher.is_sanitizer("ONTOLOGY:SANITIZER:BOUNDS_CHECK") is True

    def test_semantic_sanitizer_escape(self):
        """SEMANTIC:SANITIZER:ESCAPE is also recognized (L2 AI inference)."""
        assert SecurityTagMatcher.is_sanitizer("SEMANTIC:SANITIZER:ESCAPE") is True

    def test_legacy_flat_sanitizer_rejected(self):
        """Test 10: SANITIZER_XSS (legacy flat) is rejected."""
        assert SecurityTagMatcher.is_sanitizer("SANITIZER_XSS") is False

    def test_legacy_sanitizer_underscored_rejected(self):
        assert SecurityTagMatcher.is_sanitizer("SANITIZER_ESCAPE") is False


# =========================================================================
# SecurityTagMatcher.is_security_tag()
# =========================================================================

class TestIsSecurityTag:
    """is_security_tag() returns True for ONTOLOGY/SEMANTIC:{SOURCE|SINK|SANITIZER|ENTRY_POINT}:*"""

    def test_ontology_variants_recognized(self):
        """Test 11a: All ONTOLOGY variants recognized."""
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:ENTRY_POINT:HTTP") is True
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:SOURCE:USER_INPUT") is True
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:SINK:SQL_INJECTION") is True
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:SANITIZER:ESCAPE") is True

    def test_semantic_variants_recognized(self):
        """Test 11b: All SEMANTIC security variants recognized (L2 AI inference)."""
        assert SecurityTagMatcher.is_security_tag("SEMANTIC:ENTRY_POINT:HTTP") is True
        assert SecurityTagMatcher.is_security_tag("SEMANTIC:SOURCE:USER_INPUT") is True
        assert SecurityTagMatcher.is_security_tag("SEMANTIC:SINK:SQL_INJECTION") is True
        assert SecurityTagMatcher.is_security_tag("SEMANTIC:SANITIZER:ESCAPE") is True

    def test_state_tag_not_security(self):
        """Test 11c: STATE:REVIEWED is not a security tag."""
        assert SecurityTagMatcher.is_security_tag("STATE:REVIEWED") is False

    def test_semantic_non_security_namespace_not_security(self):
        """Test 11d: SEMANTIC:AUTH:HIGH is not a security tag (AUTH is not a security namespace)."""
        assert SecurityTagMatcher.is_security_tag("SEMANTIC:AUTH:HIGH") is False

    def test_custom_tag_not_security(self):
        """Test 11e: CUSTOM_TAG is not a security tag."""
        assert SecurityTagMatcher.is_security_tag("CUSTOM_TAG") is False

    def test_legacy_formats_all_rejected(self):
        """Test 11e: All legacy formats rejected by is_security_tag."""
        legacy_formats = [
            "SOURCE_HTTP",
            "SINK_BUFFER_OVERFLOW",
            "SINK_KNOWN_SYSTEM",
            "SANITIZER_XSS",
            "security:entry_point:L1:network",
            "SECURITY:ENTRY_POINT:L1:NETWORK",
            "SECURITY:ENTRY_POINT",
            "SINK:SQL",
        ]
        for tag in legacy_formats:
            assert SecurityTagMatcher.is_security_tag(tag) is False, f"Legacy format should be rejected: {tag}"

    def test_ontology_role_not_security_tag(self):
        """ONTOLOGY:ROLE:CONTROLLER is not a security tag (role is non-security)."""
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:ROLE:CONTROLLER") is False

    def test_empty_string(self):
        assert SecurityTagMatcher.is_security_tag("") is False


# =========================================================================
# SecurityTagMatcher.parse_entry_point()
# =========================================================================

class TestParseEntryPoint:
    """parse_entry_point extracts category and layer from ONTOLOGY/SEMANTIC:ENTRY_POINT:{cat}."""

    def test_parse_ontology_http(self):
        """Test 12: Parse ONTOLOGY:ENTRY_POINT:HTTP -> ("HTTP", TagLayer.ONTOLOGY)."""
        from codedmap.core.schema.tags.layer import TagLayer
        category, layer = SecurityTagMatcher.parse_entry_point("ONTOLOGY:ENTRY_POINT:HTTP")
        assert category == "HTTP"
        assert layer == TagLayer.ONTOLOGY

    def test_parse_ontology_data_input(self):
        from codedmap.core.schema.tags.layer import TagLayer
        category, layer = SecurityTagMatcher.parse_entry_point("ONTOLOGY:ENTRY_POINT:DATA_INPUT")
        assert category == "DATA_INPUT"
        assert layer == TagLayer.ONTOLOGY

    def test_parse_semantic_http(self):
        """SEMANTIC:ENTRY_POINT:HTTP -> ("HTTP", TagLayer.SEMANTIC)."""
        from codedmap.core.schema.tags.layer import TagLayer
        category, layer = SecurityTagMatcher.parse_entry_point("SEMANTIC:ENTRY_POINT:HTTP")
        assert category == "HTTP"
        assert layer == TagLayer.SEMANTIC

    def test_parse_legacy_rejected(self):
        """Test 13: Legacy format returns (None, None)."""
        category, layer = SecurityTagMatcher.parse_entry_point("security:entry_point:L1:network")
        assert category is None
        assert layer is None

    def test_parse_dead_prefix_rejected(self):
        category, layer = SecurityTagMatcher.parse_entry_point("SECURITY:ENTRY_POINT:L1:NETWORK")
        assert category is None
        assert layer is None

    def test_parse_empty_string(self):
        category, layer = SecurityTagMatcher.parse_entry_point("")
        assert category is None
        assert layer is None

    def test_parse_non_entry_point(self):
        category, layer = SecurityTagMatcher.parse_entry_point("ONTOLOGY:SINK:SQL_INJECTION")
        assert category is None
        assert layer is None


# =========================================================================
# Ontology catalog: DATA_INPUT
# =========================================================================

class TestOntologyCatalogExtension:
    """V2 ENTRY_POINT categories must be in ONTOLOGY_CATEGORIES['ENTRY_POINT']."""

    def test_network_listener_in_entry_point_categories(self):
        """Test 14: NETWORK_LISTENER in ONTOLOGY_CATEGORIES['ENTRY_POINT']."""
        assert "NETWORK_LISTENER" in ONTOLOGY_CATEGORIES["ENTRY_POINT"]

    def test_v2_entry_point_categories_present(self):
        """All V2 categories must be present."""
        for cat in ["NETWORK_LISTENER", "IPC_HANDLER", "CLI_COMMAND", "PLUGIN_HOOK",
                    "SYSCALL_HANDLER", "IOCTL_HANDLER", "HARDWARE_IRQ"]:
            assert cat in ONTOLOGY_CATEGORIES["ENTRY_POINT"], f"Missing: {cat}"


# =========================================================================
# Import purity: SecurityTagMatcher must have zero infra/app/analysis deps
# =========================================================================

class TestImportPurity:
    """SecurityTagMatcher must be core-pure."""

    def test_no_forbidden_imports(self):
        """Test 15: SecurityTagMatcher has no imports from app, infra, analysis, or pipeline."""
        source_file = inspect.getfile(SecurityTagMatcher)
        with open(source_file, "r") as f:
            source = f.read()

        forbidden = [
            "codedmap.app",
            "codedmap.infra",
            "codedmap.analysis",
            "codedmap.pipeline",
        ]
        for pkg in forbidden:
            assert pkg not in source, f"SecurityTagMatcher must not import from {pkg}"

    def test_matcher_is_classmethod_based(self):
        """All public methods should be classmethods (no instance needed)."""
        public_methods = [
            m for m in dir(SecurityTagMatcher)
            if not m.startswith("_") and callable(getattr(SecurityTagMatcher, m))
        ]
        for method_name in public_methods:
            method = getattr(SecurityTagMatcher, method_name)
            assert isinstance(inspect.getattr_static(SecurityTagMatcher, method_name), classmethod), \
                f"{method_name} should be a classmethod"


# =========================================================================
# EntryPoint.full_tag ONTOLOGY format (Task 2)
# =========================================================================

class TestEntryPointFullTag:
    """EntryPoint.full_tag emits ONTOLOGY:ENTRY_POINT:{category.value} — values are UPPERCASE (Phase 31-02)."""

    def test_network_listener_category_maps_to_network_listener(self):
        """Test T2-1: NETWORK_LISTENER -> ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER (UPPERCASE value directly)."""
        from codedmap.core.schema.security.entrypoint_models import EntryPoint, EntryPointCategory, EntryPointLevel
        ep = EntryPoint(
            node_id=1, name="handle_request", file="app.py", line=10,
            level=EntryPointLevel.L1, category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_rule"
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"

    def test_cli_command_category_maps_to_cli_command(self):
        """Test T2-2: CLI_COMMAND -> ONTOLOGY:ENTRY_POINT:CLI_COMMAND."""
        from codedmap.core.schema.security.entrypoint_models import EntryPoint, EntryPointCategory, EntryPointLevel
        ep = EntryPoint(
            node_id=2, name="main", file="main.py", line=1,
            level=EntryPointLevel.L2, category=EntryPointCategory.CLI_COMMAND,
            rule_name="test_rule"
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:CLI_COMMAND"

    def test_syscall_handler_category_maps_to_syscall_handler(self):
        """Test T2-4: SYSCALL_HANDLER -> ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER."""
        from codedmap.core.schema.security.entrypoint_models import EntryPoint, EntryPointCategory, EntryPointLevel
        ep = EntryPoint(
            node_id=4, name="sys_read", file="kernel.c", line=20,
            level=EntryPointLevel.L3, category=EntryPointCategory.SYSCALL_HANDLER,
            rule_name="test_rule"
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER"

    def test_full_tag_starts_with_ontology_prefix(self):
        """All categories produce ONTOLOGY:ENTRY_POINT: prefix."""
        from codedmap.core.schema.security.entrypoint_models import EntryPoint, EntryPointCategory, EntryPointLevel
        for cat in EntryPointCategory:
            ep = EntryPoint(
                node_id=99, name="test", file="test.py", line=1,
                level=EntryPointLevel.L1, category=cat, rule_name="test"
            )
            assert ep.full_tag.startswith("ONTOLOGY:ENTRY_POINT:"), \
                f"Category {cat.value} should produce ONTOLOGY prefix, got: {ep.full_tag}"
            # suffix should equal category value (UPPERCASE)
            suffix = ep.full_tag.split("ONTOLOGY:ENTRY_POINT:")[1]
            assert suffix == cat.value, \
                f"full_tag suffix {suffix!r} should equal category.value {cat.value!r}"

    def test_to_dict_includes_ontology_full_tag(self):
        """Test T2-6: to_dict includes full_tag in ONTOLOGY format, level and category as separate fields."""
        from codedmap.core.schema.security.entrypoint_models import EntryPoint, EntryPointCategory, EntryPointLevel
        ep = EntryPoint(
            node_id=1, name="handler", file="app.py", line=10,
            level=EntryPointLevel.L1, category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_rule"
        )
        d = ep.to_dict()
        assert d["full_tag"] == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"
        assert d["level"] == "L1"
        assert d["category"] == "NETWORK_LISTENER"


# =========================================================================
# EntryPointPass._has_higher_level ONTOLOGY format (Task 2)
# =========================================================================

class TestEntryPointPassHigherLevel:
    """EntryPointPass._has_higher_level recognizes ONTOLOGY-format tags only."""

    def test_recognizes_ontology_entry_point_tags(self):
        """Test T2-5: _has_higher_level recognizes ONTOLOGY:ENTRY_POINT:* tags."""
        from codedmap.core.schema.security.entrypoint_models import EntryPointLevel
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher

        # The pass now uses SecurityTagMatcher.is_entry_point() which only
        # recognizes ONTOLOGY:ENTRY_POINT: prefix
        assert SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:HTTP") is True

    def test_rejects_legacy_entry_point_tags(self):
        """_has_higher_level should NOT recognize legacy format tags."""
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher

        # These should not be recognized
        assert SecurityTagMatcher.is_entry_point("security:entry_point:L1:network") is False
        assert SecurityTagMatcher.is_entry_point("SECURITY:ENTRY_POINT:L1:NETWORK") is False


# =========================================================================
# Task 2: is_guard / get_guard_category / get_sanitizer_category
# =========================================================================

class TestIsGuard:
    """is_guard() recognizes ONTOLOGY:GUARD:* only (L1, no SEMANTIC equivalent)."""

    def test_is_guard_prefix(self):
        """ONTOLOGY:GUARD:BOUNDS_CHECK is a guard tag."""
        assert SecurityTagMatcher.is_guard("ONTOLOGY:GUARD:BOUNDS_CHECK") is True

    def test_is_guard_all_categories(self):
        for cat in ("BOUNDS_CHECK", "NULL_CHECK", "TYPE_CHECK", "AUTH_CHECK", "STATE_CHECK"):
            assert SecurityTagMatcher.is_guard(f"ONTOLOGY:GUARD:{cat}") is True

    def test_is_guard_semantic_not_matched(self):
        """SEMANTIC:GUARD:BOUNDS_CHECK is NOT a guard tag (L1 only)."""
        assert SecurityTagMatcher.is_guard("SEMANTIC:GUARD:BOUNDS_CHECK") is False

    def test_is_guard_sink_not_matched(self):
        assert SecurityTagMatcher.is_guard("ONTOLOGY:SINK:SQL_INJECTION") is False

    def test_is_guard_empty_string(self):
        assert SecurityTagMatcher.is_guard("") is False


class TestGetGuardCategory:
    def test_get_guard_category(self):
        """get_guard_category extracts category name from guard tag."""
        assert SecurityTagMatcher.get_guard_category("ONTOLOGY:GUARD:AUTH_CHECK") == "AUTH_CHECK"

    def test_get_guard_category_bounds_check(self):
        assert SecurityTagMatcher.get_guard_category("ONTOLOGY:GUARD:BOUNDS_CHECK") == "BOUNDS_CHECK"

    def test_get_guard_category_non_guard_returns_none(self):
        assert SecurityTagMatcher.get_guard_category("ONTOLOGY:SINK:SQL_INJECTION") is None

    def test_get_guard_category_empty_returns_none(self):
        assert SecurityTagMatcher.get_guard_category("") is None


class TestGetSanitizerCategory:
    def test_get_sanitizer_category(self):
        """get_sanitizer_category extracts category name from sanitizer tag."""
        assert SecurityTagMatcher.get_sanitizer_category("ONTOLOGY:SANITIZER:ESCAPE") == "ESCAPE"

    def test_get_sanitizer_category_encode(self):
        assert SecurityTagMatcher.get_sanitizer_category("ONTOLOGY:SANITIZER:ENCODE") == "ENCODE"

    def test_get_sanitizer_category_semantic(self):
        """SEMANTIC:SANITIZER:ESCAPE also yields category."""
        assert SecurityTagMatcher.get_sanitizer_category("SEMANTIC:SANITIZER:ESCAPE") == "ESCAPE"

    def test_get_sanitizer_category_non_sanitizer_returns_none(self):
        assert SecurityTagMatcher.get_sanitizer_category("ONTOLOGY:SINK:SQL_INJECTION") is None

    def test_get_sanitizer_category_empty_returns_none(self):
        assert SecurityTagMatcher.get_sanitizer_category("") is None


class TestIsSecurityTagIncludesGuard:
    def test_is_security_tag_includes_guard(self):
        """is_security_tag() recognizes ONTOLOGY:GUARD:* tags."""
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:GUARD:BOUNDS_CHECK") is True

    def test_is_security_tag_guard_all_categories(self):
        for cat in ("BOUNDS_CHECK", "NULL_CHECK", "TYPE_CHECK", "AUTH_CHECK", "STATE_CHECK"):
            assert SecurityTagMatcher.is_security_tag(f"ONTOLOGY:GUARD:{cat}") is True


# =========================================================================
# Task 2: Provenance Pydantic model
# =========================================================================

class TestProvenance:
    def test_provenance_exists(self):
        from codedmap.core.schema.tags.provenance import Provenance
        assert Provenance is not None

    def test_provenance_defaults(self):
        from codedmap.core.schema.tags.provenance import Provenance
        p = Provenance(applied_by="system")
        assert p.source is None
        assert p.author_id is None
        assert p.justification is None

    def test_provenance_with_justification(self):
        from codedmap.core.schema.tags.provenance import Provenance
        p = Provenance(applied_by="agent", source="AGENT", author_id="claude-3-flash", justification="matched recv() call")
        assert p.justification == "matched recv() call"

    def test_provenance_timestamp_is_datetime(self):
        from datetime import datetime
        from codedmap.core.schema.tags.provenance import Provenance
        p = Provenance(applied_by="human", source="HUMAN", author_id="analyst-1")
        assert isinstance(p.timestamp, datetime)

    def test_provenance_is_pydantic(self):
        from pydantic import BaseModel
        from codedmap.core.schema.tags.provenance import Provenance
        assert isinstance(Provenance(applied_by="agent"), BaseModel)

    def test_get_provenance_records_list_shape(self):
        """get_provenance_records normalizes list-shaped provenance."""
        from codedmap.core.schema.tags.provenance import get_provenance_records
        prov = {"ONTOLOGY:GUARD:BOUNDS_CHECK": [{"source": "SYSTEM", "author_id": "rule-v1"}]}
        result = get_provenance_records(prov, "ONTOLOGY:GUARD:BOUNDS_CHECK")
        assert result == [{"source": "SYSTEM", "author_id": "rule-v1"}]

    def test_get_provenance_records_dict_shape(self):
        """get_provenance_records normalizes old dict-shaped provenance."""
        from codedmap.core.schema.tags.provenance import get_provenance_records
        prov = {"ONTOLOGY:GUARD:BOUNDS_CHECK": {"source": "SYSTEM", "author_id": "rule-v1"}}
        result = get_provenance_records(prov, "ONTOLOGY:GUARD:BOUNDS_CHECK")
        assert result == [{"source": "SYSTEM", "author_id": "rule-v1"}]

    def test_get_provenance_records_missing_key(self):
        """get_provenance_records returns [] for missing tag."""
        from codedmap.core.schema.tags.provenance import get_provenance_records
        result = get_provenance_records({}, "ONTOLOGY:GUARD:BOUNDS_CHECK")
        assert result == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
