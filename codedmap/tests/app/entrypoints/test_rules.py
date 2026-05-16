# tests/app/entrypoints/test_rules.py
"""
Unit tests for entry point rules and catalog.
"""

import pytest
import tempfile
from pathlib import Path

from codedmap.core.schema.security import (
    EntryPointCategory,
    EntryPointRule,
    RulePattern,
    EntryPointCatalog,
)
from codedmap.infra.rules import CascadingRuleLoader


# =============================================================================
# RulePattern Tests
# =============================================================================

class TestRulePattern:
    """Tests for RulePattern dataclass."""

    def test_rule_pattern_creation_call(self):
        """RulePattern should be creatable for call type."""
        pattern = RulePattern(type="call", function="recv")
        assert pattern.type == "call"
        assert pattern.function == "recv"
        assert pattern.is_entry is False

    def test_rule_pattern_creation_method(self):
        """RulePattern should be creatable for method type."""
        pattern = RulePattern(type="method", name="main", is_entry=True)
        assert pattern.type == "method"
        assert pattern.name == "main"
        assert pattern.is_entry is True

    def test_rule_pattern_creation_identifier(self):
        """RulePattern should be creatable for identifier type."""
        pattern = RulePattern(type="identifier", name="__name__")
        assert pattern.type == "identifier"
        assert pattern.name == "__name__"

    def test_rule_pattern_invalid_type(self):
        """RulePattern should reject invalid types."""
        with pytest.raises(ValueError, match="Invalid pattern type"):
            RulePattern(type="invalid", function="test")

    def test_rule_pattern_call_requires_function(self):
        """Call pattern requires function field."""
        with pytest.raises(ValueError, match="requires 'function'"):
            RulePattern(type="call")

    def test_rule_pattern_method_requires_name(self):
        """Method pattern requires name field."""
        with pytest.raises(ValueError, match="requires 'name'"):
            RulePattern(type="method")

    def test_rule_pattern_identifier_requires_name(self):
        """Identifier pattern requires name field."""
        with pytest.raises(ValueError, match="requires 'name'"):
            RulePattern(type="identifier")

    def test_rule_pattern_code_pattern_matching(self):
        """RulePattern should match code patterns."""
        pattern = RulePattern(type="identifier", name="__name__", code_pattern=r"==\s*['\"]__main__['\"]")
        assert pattern.matches_code('if __name__ == "__main__":')
        assert not pattern.matches_code('print("hello")')

    def test_rule_pattern_no_code_pattern(self):
        """RulePattern without code_pattern should match any code."""
        pattern = RulePattern(type="call", function="recv")
        assert pattern.matches_code("any code")
        assert pattern.matches_code("")

    def test_rule_pattern_invalid_regex(self):
        """RulePattern should handle invalid regex gracefully."""
        pattern = RulePattern(type="call", function="test", code_pattern="[invalid")
        # Should return False for invalid regex
        assert pattern.matches_code("some code") is False

    def test_rule_pattern_from_dict(self):
        """RulePattern should deserialize from dict."""
        data = {"type": "call", "function": "recv", "is_entry": True}
        pattern = RulePattern.from_dict(data)
        assert pattern.type == "call"
        assert pattern.function == "recv"
        assert pattern.is_entry is True

    def test_rule_pattern_to_dict(self):
        """RulePattern should serialize to dict."""
        pattern = RulePattern(type="call", function="recv", code_pattern=r"recv\(")
        data = pattern.to_dict()
        assert data["type"] == "call"
        assert data["function"] == "recv"
        assert data["code_pattern"] == r"recv\("
        # is_entry should not be in dict if False (default)
        assert "is_entry" not in data


# =============================================================================
# EntryPointRule Tests
# =============================================================================

class TestEntryPointRule:
    """Tests for EntryPointRule dataclass."""

    def test_entry_point_rule_creation(self):
        """EntryPointRule should be creatable with required fields."""
        patterns = [RulePattern(type="call", function="recv")]
        rule = EntryPointRule(
            name="recv",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=patterns,
        )
        assert rule.name == "recv"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER
        assert len(rule.patterns) == 1

    def test_entry_point_rule_default_languages(self):
        """EntryPointRule should default to c, cpp, python."""
        patterns = [RulePattern(type="call", function="recv")]
        rule = EntryPointRule(
            name="test",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=patterns,
        )
        assert "c" in rule.languages
        assert "cpp" in rule.languages
        assert "python" in rule.languages

    def test_entry_point_rule_custom_languages(self):
        """EntryPointRule should accept custom languages."""
        patterns = [RulePattern(type="call", function="recv")]
        rule = EntryPointRule(
            name="test",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=patterns,
            languages=["python"],
        )
        assert rule.languages == ["python"]

    def test_entry_point_rule_from_dict(self):
        """EntryPointRule should deserialize from dict."""
        data = {
            "name": "http_request",
            "category": "NETWORK_LISTENER",
            "patterns": [
                {"type": "call", "function": "requests.get"},
                {"type": "call", "function": "requests.post"},
            ],
            "languages": ["python"],
            "description": "HTTP client requests",
        }
        rule = EntryPointRule.from_dict(data)
        assert rule.name == "http_request"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER
        assert len(rule.patterns) == 2
        assert rule.languages == ["python"]
        assert rule.description == "HTTP client requests"

    def test_entry_point_rule_invalid_category(self):
        """EntryPointRule should reject invalid categories."""
        data = {
            "name": "test",
            "category": "invalid",
            "patterns": [{"type": "call", "function": "test"}],
        }
        with pytest.raises(ValueError, match="Invalid category"):
            EntryPointRule.from_dict(data)

    def test_entry_point_rule_no_patterns(self):
        """EntryPointRule should require at least one pattern."""
        data = {
            "name": "test",
            "category": "NETWORK_LISTENER",
            "patterns": [],
        }
        with pytest.raises(ValueError, match="at least one pattern"):
            EntryPointRule.from_dict(data)

    def test_entry_point_rule_matches_language(self):
        """EntryPointRule.matches_language should work case-insensitively."""
        patterns = [RulePattern(type="call", function="recv")]
        rule = EntryPointRule(
            name="test",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=patterns,
            languages=["Python", "C"],
        )
        assert rule.matches_language("python")
        assert rule.matches_language("PYTHON")
        assert rule.matches_language("c")
        assert not rule.matches_language("cpp")

    def test_entry_point_rule_to_dict(self):
        """EntryPointRule should serialize to dict."""
        patterns = [RulePattern(type="call", function="recv")]
        rule = EntryPointRule(
            name="recv",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=patterns,
            languages=["c"],
            description="Socket receive",
        )
        data = rule.to_dict()
        assert data["name"] == "recv"
        assert data["category"] == "NETWORK_LISTENER"
        assert len(data["patterns"]) == 1
        assert data["languages"] == ["c"]
        assert data["description"] == "Socket receive"


# =============================================================================
# CascadingRuleLoader Tests (replaces deleted RuleLoader)
# =============================================================================

class TestCascadingRuleLoader:
    """Tests for CascadingRuleLoader replacing the deleted RuleLoader."""

    def test_load_all_c_returns_entry_points(self):
        """CascadingRuleLoader.load_all() returns entry_points for lang=c."""
        loader = CascadingRuleLoader()
        raw = loader.load_all(lang="c")
        assert len(raw["entry_points"]) >= 1
        assert all("id" in r for r in raw["entry_points"])

    def test_load_all_c_returns_sinks(self):
        """CascadingRuleLoader.load_all() returns sinks for lang=c."""
        loader = CascadingRuleLoader()
        raw = loader.load_all(lang="c")
        assert len(raw["sinks"]) >= 1
        names = [r["name"] for r in raw["sinks"]]
        assert "strcpy" in names

    def test_load_all_unsupported_lang_raises(self):
        """CascadingRuleLoader raises ValueError for unsupported language."""
        loader = CascadingRuleLoader()
        with pytest.raises(ValueError, match="Unsupported language"):
            loader.load_all(lang="cobol")

    def test_load_all_returns_all_keys(self):
        """CascadingRuleLoader.load_all() returns all expected keys."""
        loader = CascadingRuleLoader()
        raw = loader.load_all(lang="c")
        for key in ("entry_points", "sources", "sinks", "guards", "sanitizers", "safe_functions"):
            assert key in raw


# =============================================================================
# EntryPointCatalog Tests
# =============================================================================

class TestEntryPointCatalog:
    """Tests for EntryPointCatalog class."""

    def test_catalog_defaults(self):
        """EntryPointCatalog.load_default() should return catalog with rules."""
        catalog = EntryPointCatalog.load_default()
        assert len(catalog.rules) >= 10, f"Expected >= 10 rules, got {len(catalog.rules)}"

    def test_catalog_filter_by_category(self):
        """Catalog.by_category() should filter correctly."""
        catalog = EntryPointCatalog.load_default()

        network_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        assert len(network_rules) >= 1
        for rule in network_rules:
            assert rule.category == EntryPointCategory.NETWORK_LISTENER

        cli_rules = catalog.by_category(EntryPointCategory.CLI_COMMAND)
        assert len(cli_rules) >= 1
        for rule in cli_rules:
            assert rule.category == EntryPointCategory.CLI_COMMAND

    def test_catalog_filter_by_language(self):
        """Catalog.by_language() should filter correctly."""
        catalog = EntryPointCatalog.load_default()

        c_rules = catalog.by_language("c")
        assert len(c_rules) >= 1
        for rule in c_rules:
            assert rule.matches_language("c")

    def test_catalog_categories_covered(self):
        """Catalog should cover V2 categories."""
        catalog = EntryPointCatalog.load_default()
        categories = catalog.get_all_categories()

        assert EntryPointCategory.CLI_COMMAND in categories
        assert EntryPointCategory.NETWORK_LISTENER in categories
        assert EntryPointCategory.SYSCALL_HANDLER in categories
        assert EntryPointCategory.IOCTL_HANDLER in categories

    def test_catalog_add_rule(self):
        """Catalog.add_rule should add rule."""
        catalog = EntryPointCatalog()
        rule = EntryPointRule(
            name="test",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=[RulePattern(type="call", function="test")],
        )
        catalog.add_rule(rule)
        assert len(catalog.rules) == 1
        assert catalog.rules[0].name == "test"

    def test_catalog_add_rules(self):
        """Catalog.add_rules should add multiple rules."""
        catalog = EntryPointCatalog()
        rules = [
            EntryPointRule(
                name="test1",
                category=EntryPointCategory.NETWORK_LISTENER,
                patterns=[RulePattern(type="call", function="test1")],
            ),
            EntryPointRule(
                name="test2",
                category=EntryPointCategory.CLI_COMMAND,
                patterns=[RulePattern(type="method", name="main")],
            ),
        ]
        catalog.add_rules(rules)
        assert len(catalog.rules) == 2

    def test_catalog_by_name(self):
        """Catalog.by_name should find rule by name."""
        catalog = EntryPointCatalog.load_default()
        rule = catalog.by_name("cli_main_c")
        assert rule is not None
        assert rule.name == "cli_main_c"

        # Non-existent rule
        assert catalog.by_name("nonexistent") is None

    def test_catalog_get_all_languages(self):
        """Catalog.get_all_languages should return all covered languages."""
        catalog = EntryPointCatalog.load_default()
        languages = catalog.get_all_languages()

        assert "c" in languages
        assert "cpp" in languages

    def test_catalog_rules_specify_language_filters(self):
        """All rules should specify language filters."""
        catalog = EntryPointCatalog.load_default()
        for rule in catalog.rules:
            assert len(rule.languages) >= 1, f"Rule {rule.name} has no language filter"

    def test_catalog_to_dict(self):
        """Catalog should serialize to dict."""
        catalog = EntryPointCatalog()
        catalog.add_rule(EntryPointRule(
            name="test",
            category=EntryPointCategory.NETWORK_LISTENER,
            patterns=[RulePattern(type="call", function="test")],
        ))
        data = catalog.to_dict()
        assert data["version"] == 1
        assert len(data["rules"]) == 1
