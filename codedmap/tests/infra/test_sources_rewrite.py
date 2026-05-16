# tests/infra/test_sources_rewrite.py
"""
TDD tests for Phase 31 Plan 01 Task 2: Rewrite sources.yaml to version 2.

Behavior:
- Test 1: Top-level keys are "version" (value 2) and "rules" (not "sources")
- Test 2: Every rule has: id, name, category, languages, patterns array
- Test 3: Every pattern has a "taints" field with value "return" or /^param\[\d+\]$/
- Test 4: Specific taint semantics for known functions
- Test 5: All functions moved from entrypoints.yaml are present
- Test 6: Total rule count is 30 or more
"""

import os
import re
import sys
import yaml
from pathlib import Path

import pytest

sys.path.append(os.getcwd())

SOURCES_YAML = Path("codedmap/rules/global/sources.yaml")


class TestSourcesYAMLRewrite:
    """Tests for the rewritten sources.yaml."""

    def setup_method(self):
        with open(SOURCES_YAML) as f:
            self.data = yaml.safe_load(f)
        self.rules = self.data.get("rules", [])

    def test_version_is_2_and_uses_rules_key(self):
        """Test 1: version is 2, top-level key is 'rules' not 'sources'."""
        assert self.data["version"] == 2, f"Expected version 2, got {self.data.get('version')}"
        assert "rules" in self.data, "Expected 'rules' top-level key"
        assert "sources" not in self.data, "Old 'sources' key must not be present"

    def test_every_rule_has_required_fields(self):
        """Test 2: Every rule has id, name, category, languages, patterns."""
        for rule in self.rules:
            assert "id" in rule, f"Rule missing 'id': {rule}"
            assert "name" in rule, f"Rule {rule.get('id')} missing 'name'"
            assert "category" in rule, f"Rule {rule.get('id')} missing 'category'"
            assert "languages" in rule, f"Rule {rule.get('id')} missing 'languages'"
            assert "patterns" in rule, f"Rule {rule.get('id')} missing 'patterns'"
            assert len(rule["patterns"]) >= 1, f"Rule {rule.get('id')} has no patterns"

    def test_every_pattern_has_taints_field(self):
        """Test 3: Every pattern has 'taints' with valid value."""
        taint_pattern = re.compile(r'^param\[\d+\]$')
        for rule in self.rules:
            for pattern in rule.get("patterns", []):
                assert "taints" in pattern, (
                    f"Rule {rule['id']} pattern missing 'taints' field: {pattern}"
                )
                t = pattern["taints"]
                assert t == "return" or taint_pattern.match(t), (
                    f"Rule {rule['id']} has invalid taints value: {t!r}. "
                    f"Expected 'return' or 'param[N]'"
                )

    def test_specific_taint_semantics(self):
        """Test 4: Known functions have correct taint targets."""
        # Build a dict: function_name -> list of taints seen
        func_taints = {}
        for rule in self.rules:
            for pattern in rule.get("patterns", []):
                func = pattern.get("function") or pattern.get("name")
                if func:
                    func_taints.setdefault(func, []).append(pattern.get("taints"))

        # getenv → taints: return
        assert "getenv" in func_taints, "getenv not found in sources.yaml"
        assert "return" in func_taints["getenv"], f"getenv should taint return, got: {func_taints['getenv']}"

        # recv(sock, buf, len, flags) → buf is param[1]
        assert "recv" in func_taints, "recv not found in sources.yaml"
        assert "param[1]" in func_taints["recv"], f"recv should taint param[1] (buf), got: {func_taints['recv']}"

        # fgets(str, n, stream) → str is param[0]
        assert "fgets" in func_taints, "fgets not found in sources.yaml"
        assert "param[0]" in func_taints["fgets"], f"fgets should taint param[0] (str), got: {func_taints['fgets']}"

        # fread(buf, size, count, fp) → buf is param[0]
        assert "fread" in func_taints, "fread not found in sources.yaml"
        assert "param[0]" in func_taints["fread"], f"fread should taint param[0] (buf), got: {func_taints['fread']}"

        # scanf → taints: param[1] (variadic, first format-destination)
        assert "scanf" in func_taints, "scanf not found in sources.yaml"
        assert "param[1]" in func_taints["scanf"], f"scanf should taint param[1], got: {func_taints['scanf']}"

    def test_moved_functions_present(self):
        """Test 5: All functions moved from entrypoints.yaml are present in sources."""
        # Collect all function names and identifier names from sources.yaml
        all_func_names = set()
        for rule in self.rules:
            for pattern in rule.get("patterns", []):
                func = pattern.get("function") or pattern.get("name")
                if func:
                    all_func_names.add(func)

        # Required functions that were in old entrypoints.yaml
        required_functions = {
            # env
            "getenv", "os.getenv",
            # stdin
            "fgets", "scanf", "gets",
            # network
            "recv",
            # file
            "fread",
            # python
            "requests.get",
            "pickle.load",
        }
        for func in required_functions:
            assert func in all_func_names, (
                f"Function '{func}' expected in sources.yaml but not found"
            )

    def test_rule_count_is_30_or_more(self):
        """Test 6: Total rule count >= 30."""
        assert len(self.rules) >= 30, (
            f"Expected >= 30 source rules, got {len(self.rules)}"
        )
