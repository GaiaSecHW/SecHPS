# tests/core/security/test_source_models.py
"""
Unit tests for Source model layer: SourceCategory, SourcePattern, SourceRule, Source.

Tests validate:
- SourceCategory enum has exactly 6 V2 UPPERCASE values
- V1 legacy values raise ValueError
- SourcePattern validates type and taints format
- SourceRule.from_dict() constructs from YAML-like dicts
- SourceRule gains origin field
- Source.full_tag produces ONTOLOGY:SOURCE:{category.value}
- Source.to_dict() produces expected JSON shape
- Source gains origin field
"""

import sys
import os
import pytest

sys.path.append(os.getcwd())

from codedmap.core.schema.security.source_models import SourceCategory, Source
from codedmap.core.schema.security.source_rules import SourcePattern, SourceRule


# =========================================================================
# SourceCategory enum — V2
# =========================================================================

class TestSourceCategory:
    """SourceCategory has exactly 7 V2 UPPERCASE values."""

    def test_has_network_data(self):
        assert SourceCategory("NETWORK_DATA") == SourceCategory.NETWORK_DATA

    def test_has_file_data(self):
        assert SourceCategory("FILE_DATA") == SourceCategory.FILE_DATA

    def test_has_env_data(self):
        assert SourceCategory("ENV_DATA") == SourceCategory.ENV_DATA

    def test_has_ipc_data(self):
        assert SourceCategory("IPC_DATA") == SourceCategory.IPC_DATA

    def test_has_hardware_state(self):
        assert SourceCategory("HARDWARE_STATE") == SourceCategory.HARDWARE_STATE

    def test_has_deserialized_object(self):
        assert SourceCategory("DESERIALIZED_OBJECT") == SourceCategory.DESERIALIZED_OBJECT

    def test_has_user_space_data(self):
        assert SourceCategory("USER_SPACE_DATA") == SourceCategory.USER_SPACE_DATA

    def test_exactly_7_values(self):
        assert len(SourceCategory) == 7, (
            f"Expected exactly 7 V2 values, got {len(SourceCategory)}: "
            f"{[c.value for c in SourceCategory]}"
        )

    def test_all_values_uppercase(self):
        for cat in SourceCategory:
            assert cat.value == cat.value.upper(), (
                f"SourceCategory.{cat.name}.value should be UPPERCASE, got {cat.value!r}"
            )

    def test_bad_value_raises(self):
        with pytest.raises(ValueError):
            SourceCategory("bad_value")

    def test_lowercase_raises(self):
        with pytest.raises(ValueError):
            SourceCategory("network_data")

    # V1 legacy values must raise ValueError
    @pytest.mark.parametrize("v1_value", [
        "HTTP_INPUT", "NETWORK_IO", "FILE_READ", "ENV_VAR", "CLI_ARGS",
        "STDIN", "DATABASE", "IPC", "DESERIALIZATION", "PROCESS_OUTPUT",
        "SHARED_MEMORY", "REGISTRY", "CRYPTO_RANDOM", "TIMING", "SENSOR",
    ])
    def test_v1_legacy_values_raise(self, v1_value):
        with pytest.raises(ValueError):
            SourceCategory(v1_value)


# =========================================================================
# SourcePattern dataclass
# =========================================================================

class TestSourcePattern:
    """SourcePattern validates type and taints at construction time."""

    def test_call_pattern_with_return_taints(self):
        p = SourcePattern(type="call", function="getenv", taints="return")
        assert p.taints == "return"
        assert p.function == "getenv"

    def test_call_pattern_with_param_taints(self):
        p = SourcePattern(type="call", function="recv", taints="param[1]")
        assert p.taints == "param[1]"

    def test_identifier_pattern(self):
        p = SourcePattern(type="identifier", name="environ", taints="return")
        assert p.type == "identifier"
        assert p.name == "environ"

    def test_default_taints_is_return(self):
        p = SourcePattern(type="call", function="getenv")
        assert p.taints == "return"

    def test_invalid_type_raises(self):
        with pytest.raises(ValueError):
            SourcePattern(type="invalid_type", function="foo")

    def test_call_without_function_raises(self):
        with pytest.raises(ValueError):
            SourcePattern(type="call")

    def test_identifier_without_name_raises(self):
        with pytest.raises(ValueError):
            SourcePattern(type="identifier")

    def test_invalid_taints_format_raises(self):
        with pytest.raises(ValueError):
            SourcePattern(type="call", function="foo", taints="bad_taints")

    def test_param_with_valid_index(self):
        p = SourcePattern(type="call", function="fgets", taints="param[0]")
        assert p.taints == "param[0]"

    @pytest.mark.parametrize("taints", ["return", "param[0]", "param[1]", "param[10]"])
    def test_valid_taints_formats(self, taints):
        p = SourcePattern(type="call", function="f", taints=taints)
        assert p.taints == taints

    @pytest.mark.parametrize("taints", ["Return", "RETURN", "param", "param[]", "param[-1]", "param[a]"])
    def test_invalid_taints_formats(self, taints):
        with pytest.raises(ValueError):
            SourcePattern(type="call", function="f", taints=taints)

    def test_from_dict_call(self):
        d = {"type": "call", "function": "getenv", "taints": "return"}
        p = SourcePattern.from_dict(d)
        assert p.type == "call"
        assert p.function == "getenv"
        assert p.taints == "return"

    def test_to_dict_round_trip(self):
        p = SourcePattern(type="call", function="recv", taints="param[1]")
        d = p.to_dict()
        restored = SourcePattern.from_dict(d)
        assert restored.type == p.type
        assert restored.function == p.function
        assert restored.taints == p.taints


# =========================================================================
# SourceRule dataclass
# =========================================================================

class TestSourceRule:
    """SourceRule constructs from YAML-like dicts with V2 category values."""

    def test_from_dict_basic(self):
        d = {
            "name": "recv",
            "category": "NETWORK_DATA",
            "patterns": [{"type": "call", "function": "recv", "taints": "param[1]"}],
            "languages": ["c"],
        }
        rule = SourceRule.from_dict(d)
        assert rule.name == "recv"
        assert rule.category == SourceCategory.NETWORK_DATA
        assert len(rule.patterns) == 1
        assert rule.patterns[0].taints == "param[1]"

    def test_from_dict_default_languages(self):
        d = {
            "name": "getenv",
            "category": "ENV_DATA",
            "patterns": [{"type": "call", "function": "getenv", "taints": "return"}],
        }
        rule = SourceRule.from_dict(d)
        assert "c" in rule.languages
        assert "cpp" in rule.languages
        assert "python" in rule.languages

    def test_from_dict_invalid_category_raises(self):
        d = {
            "name": "test",
            "category": "INVALID_CAT",
            "patterns": [{"type": "call", "function": "f", "taints": "return"}],
        }
        with pytest.raises(ValueError):
            SourceRule.from_dict(d)

    def test_from_dict_v1_category_raises(self):
        """V1 category values must be rejected."""
        d = {
            "name": "test",
            "category": "ENV_VAR",
            "patterns": [{"type": "call", "function": "f", "taints": "return"}],
        }
        with pytest.raises(ValueError):
            SourceRule.from_dict(d)

    def test_from_dict_missing_patterns_raises(self):
        d = {
            "name": "test",
            "category": "ENV_DATA",
            "patterns": [],
        }
        with pytest.raises(ValueError):
            SourceRule.from_dict(d)

    def test_origin_field_default_none(self):
        rule = SourceRule(
            name="test",
            category=SourceCategory.ENV_DATA,
            patterns=[SourcePattern(type="call", function="getenv", taints="return")],
        )
        assert rule.origin is None

    def test_origin_field_from_dict(self):
        d = {
            "name": "getenv",
            "category": "ENV_DATA",
            "patterns": [{"type": "call", "function": "getenv", "taints": "return"}],
            "origin": "posix",
        }
        rule = SourceRule.from_dict(d)
        assert rule.origin == "posix"

    def test_origin_field_in_to_dict(self):
        rule = SourceRule(
            name="test",
            category=SourceCategory.NETWORK_DATA,
            patterns=[SourcePattern(type="call", function="recv", taints="param[1]")],
            origin="bsd_socket",
        )
        d = rule.to_dict()
        assert d["origin"] == "bsd_socket"

    def test_matches_language(self):
        rule = SourceRule(
            name="test",
            category=SourceCategory.ENV_DATA,
            patterns=[SourcePattern(type="call", function="f", taints="return")],
            languages=["c", "cpp"],
        )
        assert rule.matches_language("c")
        assert rule.matches_language("cpp")
        assert not rule.matches_language("python")

    def test_to_dict_round_trip(self):
        d = {
            "name": "getenv",
            "category": "ENV_DATA",
            "patterns": [{"type": "call", "function": "getenv", "taints": "return"}],
            "languages": ["c", "cpp"],
            "description": "C getenv",
        }
        rule = SourceRule.from_dict(d)
        d2 = rule.to_dict()
        rule2 = SourceRule.from_dict(d2)
        assert rule2.name == rule.name
        assert rule2.category == rule.category
        assert rule2.languages == rule.languages


# =========================================================================
# Source dataclass
# =========================================================================

class TestSource:
    """Source has full_tag, origin field, and to_dict() matching expected output shape."""

    def _make_source(self, **kwargs):
        defaults = {
            "node_id": 90005,
            "name": "read_network_payload",
            "file": "net.c",
            "line": 42,
            "category": SourceCategory.NETWORK_DATA,
            "rule_name": "recv",
        }
        defaults.update(kwargs)
        return Source(**defaults)

    def test_full_tag_env_data(self):
        s = self._make_source(category=SourceCategory.ENV_DATA, rule_name="getenv")
        assert s.full_tag == "ONTOLOGY:SOURCE:ENV_DATA"

    def test_full_tag_network_data(self):
        s = self._make_source(category=SourceCategory.NETWORK_DATA)
        assert s.full_tag == "ONTOLOGY:SOURCE:NETWORK_DATA"

    def test_full_tag_all_categories_have_ontology_prefix(self):
        for cat in SourceCategory:
            s = self._make_source(category=cat)
            assert s.full_tag.startswith("ONTOLOGY:SOURCE:"), (
                f"Category {cat.value} produced wrong prefix: {s.full_tag}"
            )
            suffix = s.full_tag.split("ONTOLOGY:SOURCE:")[1]
            assert suffix == cat.value

    def test_to_dict_shape(self):
        """Source.to_dict() must include all expected fields."""
        triggers = [
            {"node": {"id": 30064789999, "label": "CALL", "code": "recv(sock, buf, len, 0)"}, "taint_target": "param[1]"}
        ]
        s = Source(
            node_id=90005,
            name="read_network_payload",
            file="net.c",
            line=42,
            category=SourceCategory.NETWORK_DATA,
            rule_name="recv",
            triggers=triggers,
        )
        d = s.to_dict()
        assert d["id"] == 90005
        assert d["label"] == "METHOD"
        assert d["name"] == "read_network_payload"
        assert d["category"] == "NETWORK_DATA"
        assert d["triggers"] == triggers
        assert d["full_tag"] == "ONTOLOGY:SOURCE:NETWORK_DATA"
        assert "file" in d
        assert "line" in d
        assert "origin" in d

    def test_origin_field_default_none(self):
        s = self._make_source()
        assert s.origin is None

    def test_origin_field_set(self):
        s = self._make_source(origin="bsd_socket")
        assert s.origin == "bsd_socket"

    def test_origin_in_to_dict(self):
        s = self._make_source(origin="posix")
        assert s.to_dict()["origin"] == "posix"

    def test_origin_from_dict(self):
        d = {
            "id": 1,
            "name": "foo",
            "file": "a.c",
            "line": 1,
            "category": "FILE_DATA",
            "rule_name": "fread",
            "origin": "libc",
        }
        s = Source.from_dict(d)
        assert s.origin == "libc"

    def test_default_triggers_is_empty(self):
        s = self._make_source()
        assert s.triggers == []

    def test_tags_default_empty(self):
        s = self._make_source()
        assert s.tags == []


# =========================================================================
# Import sanity
# =========================================================================

class TestImportSanity:
    """All types must be importable from codedmap.core.schema.security."""

    def test_import_source_category(self):
        from codedmap.core.schema.security import SourceCategory
        assert SourceCategory.ENV_DATA is not None

    def test_import_source(self):
        from codedmap.core.schema.security import Source
        assert Source is not None

    def test_import_source_pattern(self):
        from codedmap.core.schema.security import SourcePattern
        assert SourcePattern is not None

    def test_import_source_rule(self):
        from codedmap.core.schema.security import SourceRule
        assert SourceRule is not None
