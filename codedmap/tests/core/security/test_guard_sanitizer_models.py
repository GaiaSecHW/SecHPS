# tests/core/security/test_guard_sanitizer_models.py
"""
Tests for Guard/Sanitizer domain models.

Covers:
- GuardCategory: exactly 5 values, str,Enum pattern
- Guard dataclass: full_tag, to_dict, from_dict
- GuardRule: from_dict validates category
- SanitizerCategory: exactly 5 values, str,Enum pattern
- Sanitizer dataclass: full_tag, to_dict, from_dict
- SanitizerRule: from_dict validates category
"""

import pytest
import sys
import os

sys.path.append(os.getcwd())

from codedmap.core.schema.security.guard_models import (
    GuardCategory, Guard, GuardRule,
)
from codedmap.core.schema.security.sanitizer_models import (
    SanitizerCategory, Sanitizer, SanitizerRule,
)


# =========================================================================
# GuardCategory
# =========================================================================

class TestGuardCategory:
    def test_guard_category_values(self):
        """GuardCategory has exactly 5 values, all UPPERCASE."""
        values = [c.value for c in GuardCategory]
        assert len(values) == 5
        for v in values:
            assert v == v.upper(), f"Expected uppercase, got: {v}"

    def test_guard_category_expected_members(self):
        expected = {"BOUNDS_CHECK", "NULL_CHECK", "TYPE_CHECK", "AUTH_CHECK", "STATE_CHECK"}
        assert {c.value for c in GuardCategory} == expected

    def test_guard_category_str_enum_pattern(self):
        """GuardCategory('BOUNDS_CHECK') == GuardCategory.BOUNDS_CHECK"""
        assert GuardCategory("BOUNDS_CHECK") == GuardCategory.BOUNDS_CHECK

    def test_guard_category_invalid_raises(self):
        with pytest.raises(ValueError):
            GuardCategory("NONEXISTENT")


# =========================================================================
# Guard dataclass
# =========================================================================

class TestGuard:
    def _make_guard(self, **kwargs):
        defaults = dict(
            node_id=1,
            name="check_size",
            file="a.c",
            line=10,
            category=GuardCategory.BOUNDS_CHECK,
            rule_id="guard_bounds_c",
        )
        defaults.update(kwargs)
        return Guard(**defaults)

    def test_guard_full_tag(self):
        """Guard.full_tag == 'ONTOLOGY:GUARD:BOUNDS_CHECK'"""
        g = self._make_guard()
        assert g.full_tag == "ONTOLOGY:GUARD:BOUNDS_CHECK"

    def test_guard_full_tag_all_categories(self):
        for cat in GuardCategory:
            g = self._make_guard(category=cat)
            assert g.full_tag == f"ONTOLOGY:GUARD:{cat.value}"

    def test_guard_to_dict_includes_condition(self):
        """condition field appears in to_dict() output."""
        g = self._make_guard(condition="x < MAX_SIZE")
        d = g.to_dict()
        assert "condition" in d
        assert d["condition"] == "x < MAX_SIZE"

    def test_guard_to_dict_keys(self):
        g = self._make_guard()
        d = g.to_dict()
        for key in ("id", "label", "name", "file", "line", "category", "rule_id", "tags", "full_tag", "condition"):
            assert key in d, f"Missing key: {key}"

    def test_guard_to_dict_label(self):
        g = self._make_guard()
        assert g.to_dict()["label"] == "METHOD"

    def test_guard_from_dict_roundtrip(self):
        """to_dict() -> from_dict() produces equal Guard."""
        g = self._make_guard(condition="ptr != NULL", tags=["extra"])
        g2 = Guard.from_dict(g.to_dict())
        assert g2.node_id == g.node_id
        assert g2.name == g.name
        assert g2.file == g.file
        assert g2.line == g.line
        assert g2.category == g.category
        assert g2.rule_id == g.rule_id
        assert g2.tags == g.tags
        assert g2.condition == g.condition

    def test_guard_default_tags_empty(self):
        g = self._make_guard()
        assert g.tags == []

    def test_guard_default_condition_none(self):
        g = self._make_guard()
        assert g.condition is None


# =========================================================================
# GuardRule dataclass
# =========================================================================

class TestGuardRule:
    def test_guard_rule_from_dict_validates_category(self):
        """Invalid category raises ValueError."""
        with pytest.raises(ValueError):
            GuardRule.from_dict({
                "name": "bad_rule",
                "category": "INVALID_CAT",
                "patterns": [],
            })

    def test_guard_rule_from_dict_valid(self):
        rule = GuardRule.from_dict({
            "name": "bounds_check_c",
            "category": "BOUNDS_CHECK",
            "patterns": [{"match": "check_bounds"}],
            "description": "Checks array bounds",
        })
        assert rule.category == GuardCategory.BOUNDS_CHECK
        assert rule.name == "bounds_check_c"

    def test_guard_rule_default_languages(self):
        rule = GuardRule.from_dict({
            "name": "r",
            "category": "NULL_CHECK",
            "patterns": [],
        })
        assert rule.languages == ["c", "cpp", "python"]


# =========================================================================
# SanitizerCategory
# =========================================================================

class TestSanitizerCategory:
    def test_sanitizer_category_values(self):
        """SanitizerCategory has exactly 5 values, all UPPERCASE."""
        values = [c.value for c in SanitizerCategory]
        assert len(values) == 5
        for v in values:
            assert v == v.upper(), f"Expected uppercase, got: {v}"

    def test_sanitizer_category_expected_members(self):
        expected = {"ESCAPE", "ENCODE", "TYPE_CAST", "TRUNCATE", "NORMALIZE"}
        assert {c.value for c in SanitizerCategory} == expected

    def test_sanitizer_category_str_enum_pattern(self):
        assert SanitizerCategory("ESCAPE") == SanitizerCategory.ESCAPE

    def test_sanitizer_category_invalid_raises(self):
        with pytest.raises(ValueError):
            SanitizerCategory("NONEXISTENT")


# =========================================================================
# Sanitizer dataclass
# =========================================================================

class TestSanitizer:
    def _make_sanitizer(self, **kwargs):
        defaults = dict(
            node_id=2,
            name="html_escape",
            file="utils.py",
            line=42,
            category=SanitizerCategory.ESCAPE,
            rule_id="sanitizer_escape_py",
        )
        defaults.update(kwargs)
        return Sanitizer(**defaults)

    def test_sanitizer_full_tag(self):
        """Sanitizer.full_tag == 'ONTOLOGY:SANITIZER:ESCAPE'"""
        s = self._make_sanitizer()
        assert s.full_tag == "ONTOLOGY:SANITIZER:ESCAPE"

    def test_sanitizer_full_tag_all_categories(self):
        for cat in SanitizerCategory:
            s = self._make_sanitizer(category=cat)
            assert s.full_tag == f"ONTOLOGY:SANITIZER:{cat.value}"

    def test_sanitizer_transform_field(self):
        """transform field appears in to_dict() output."""
        s = self._make_sanitizer(transform="html_entities")
        d = s.to_dict()
        assert "transform" in d
        assert d["transform"] == "html_entities"

    def test_sanitizer_to_dict_keys(self):
        s = self._make_sanitizer()
        d = s.to_dict()
        for key in ("id", "label", "name", "file", "line", "category", "rule_id", "tags", "full_tag", "transform"):
            assert key in d, f"Missing key: {key}"

    def test_sanitizer_to_dict_label(self):
        s = self._make_sanitizer()
        assert s.to_dict()["label"] == "METHOD"

    def test_sanitizer_from_dict_roundtrip(self):
        s = self._make_sanitizer(transform="urlencode", tags=["web"])
        s2 = Sanitizer.from_dict(s.to_dict())
        assert s2.node_id == s.node_id
        assert s2.name == s.name
        assert s2.file == s.file
        assert s2.line == s.line
        assert s2.category == s.category
        assert s2.rule_id == s.rule_id
        assert s2.tags == s.tags
        assert s2.transform == s.transform

    def test_sanitizer_default_tags_empty(self):
        s = self._make_sanitizer()
        assert s.tags == []

    def test_sanitizer_default_transform_none(self):
        s = self._make_sanitizer()
        assert s.transform is None


# =========================================================================
# SanitizerRule dataclass
# =========================================================================

class TestSanitizerRule:
    def test_sanitizer_rule_from_dict_validates_category(self):
        with pytest.raises(ValueError):
            SanitizerRule.from_dict({
                "name": "bad_rule",
                "category": "INVALID_CAT",
                "patterns": [],
            })

    def test_sanitizer_rule_from_dict_valid(self):
        rule = SanitizerRule.from_dict({
            "name": "html_escape_py",
            "category": "ESCAPE",
            "patterns": [{"match": "html.escape"}],
        })
        assert rule.category == SanitizerCategory.ESCAPE

    def test_sanitizer_rule_default_languages(self):
        rule = SanitizerRule.from_dict({
            "name": "r",
            "category": "ENCODE",
            "patterns": [],
        })
        assert rule.languages == ["c", "cpp", "python"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
