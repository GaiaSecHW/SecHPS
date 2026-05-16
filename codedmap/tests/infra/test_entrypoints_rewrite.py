# tests/infra/test_entrypoints_rewrite.py
"""
Tests for entry_points rules loaded via RuleRegistry.

Behavior:
- Test 1: build_entrypoint_rules() raises no ValueError (all category values valid)
- Test 2: No rule has call-site patterns for source-type functions
- Test 3: Framework registration rules remain present
- Test 4: All rules have valid ENTRY_POINT ontology categories
"""

import os
import sys

import pytest

sys.path.append(os.getcwd())

from codedmap.infra.rules import RuleRegistry


FORBIDDEN_CALL_FUNCTIONS = {
    "recv", "getenv", "fgets", "fread", "fopen", "open", "read",
    "requests.get", "os.getenv", "pickle.load",
}

EXPECTED_REMAINING_RULES = [
    "cli_main_c",
    "http_server_c",
    "rpc_grpc_cpp",
    "socket_server_c",
]

VALID_ENTRY_POINT_CATEGORIES = {
    "NETWORK_LISTENER",
    "IPC_HANDLER",
    "CLI_COMMAND",
    "PLUGIN_HOOK",
    "SYSCALL_HANDLER",
    "IOCTL_HANDLER",
    "HARDWARE_IRQ",
}


class TestEntrypointsRules:
    """Tests for entry_points rules loaded via RuleRegistry."""

    def setup_method(self):
        self.registry = RuleRegistry().load()
        self.rules = self.registry.build_entrypoint_rules()
        self.rule_ids = {r.name for r in self.rules}

    def test_build_entrypoint_rules_no_value_error(self):
        """Test 1: build_entrypoint_rules() raises no ValueError on category values."""
        rules = self.registry.build_entrypoint_rules()
        assert len(rules) > 0

    def test_no_forbidden_call_site_patterns(self):
        """Test 2: No rule has call patterns for source-type functions."""
        for rule in self.rules:
            for pattern in rule.patterns:
                if pattern.type == "call":
                    func = pattern.function or ""
                    assert func not in FORBIDDEN_CALL_FUNCTIONS, (
                        f"Rule {rule.name} has forbidden call-site pattern: {func}"
                    )

    def test_framework_registration_rules_remain(self):
        """Test 3: Framework registration rules are still present."""
        for expected_id in EXPECTED_REMAINING_RULES:
            assert expected_id in self.rule_ids, (
                f"Expected rule {expected_id} missing from entry_points rules"
            )

    def test_all_categories_are_valid_entry_point_categories(self):
        """Test 4: All rules have valid ENTRY_POINT ontology categories."""
        for rule in self.rules:
            cat = rule.category.value
            assert cat in VALID_ENTRY_POINT_CATEGORIES, (
                f"Rule {rule.name} has invalid ENTRY_POINT category: {cat!r}. "
                f"Expected one of: {VALID_ENTRY_POINT_CATEGORIES}"
            )

    def test_entrypoint_rules_loaded_from_yaml(self):
        """Test that entrypoint rules are loaded from YAML via RuleRegistry."""
        assert len(self.rules) >= 5, (
            f"Expected at least 5 entrypoint rules, got {len(self.rules)}"
        )

    def test_entrypoint_rules_have_languages(self):
        """All entrypoint rules should specify languages."""
        for rule in self.rules:
            assert rule.languages, f"Rule {rule.name} has no languages specified"

    def test_entrypoint_rules_have_patterns(self):
        """All entrypoint rules should have at least one pattern."""
        for rule in self.rules:
            assert rule.patterns, f"Rule {rule.name} has no patterns specified"
