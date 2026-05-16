# tests/cli/test_rules_command.py
"""
Tests for `cpg rules` CLI command.

Tests:
1. cpg rules list — text and JSON output format
2. cpg rules categories — valid ontology namespaces
3. cpg rules add-sink — writes to project YAML correctly
4. cpg rules add-sink — invalid category produces structured error
5. cpg rules tombstone — requires --reason
6. cpg rules validate — detects orphaned tombstones
7. cpg rules resolve — returns matched rule with origin
8. --no-retag flag skips re-tagging
"""

import json
import os
import sys
import tempfile
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
import importlib.util

if importlib.util.find_spec("codedmap.cli.commands.rules") is None:
    pytest.skip(
        "Legacy rules CLI wrapper tests are obsolete after catalog/service convergence.",
        allow_module_level=True,
    )

sys.path.append(os.getcwd())

from codedmap.cli.commands.rules import (
    register,
    run,
    _get_registry,
    _write_project_yaml,
    _write_tombstone_yaml,
)
from codedmap.infra.rules import RuleRegistry


# =========================================================================
# Fixtures
# =========================================================================


@pytest.fixture
def tmp_project(tmp_path):
    """Create a temporary project directory."""
    return tmp_path


@pytest.fixture
def tmp_project_with_rules(tmp_path):
    """Create a temporary project with .cpg/rules/ directory."""
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    return tmp_path


def _make_args(**kwargs):
    """Build a Namespace with defaults for rules command."""
    defaults = {
        "output": "text",
        "project": ".",
        "rules_action": None,
        "no_retag": True,  # Default to no-retag in tests
    }
    defaults.update(kwargs)
    return Namespace(**defaults)


# =========================================================================
# Test 1: cpg rules list output format (text and JSON)
# =========================================================================


class TestRulesList:
    """Test rules list subcommand."""

    def test_list_returns_rules_text(self, capsys):
        """rules list outputs text listing of active rules."""
        args = _make_args(rules_action="list", type=None)
        run(args)
        out = capsys.readouterr().out
        # Should contain rule type headers
        assert "SINKS" in out or "sinks" in out.lower()

    def test_list_returns_rules_json(self, capsys):
        """rules list --output json returns JSON envelope with rules."""
        args = _make_args(rules_action="list", type=None, output="json")
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        assert data["command"] == "rules"
        assert "rules" in data["result"]
        assert isinstance(data["result"]["rules"], list)
        assert data["result"]["total"] > 0

    def test_list_filter_by_type(self, capsys):
        """rules list --type sinks returns only sink rules."""
        args = _make_args(rules_action="list", type="sinks", output="json")
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        rules = data["result"]["rules"]
        assert all(r["rule_type"] == "sinks" for r in rules)
        assert len(rules) > 0


# =========================================================================
# Test 2: cpg rules categories returns valid ontology namespaces
# =========================================================================


class TestRulesCategories:
    """Test rules categories subcommand."""

    def test_categories_json(self, capsys):
        """rules categories --output json returns namespace→categories mapping."""
        args = _make_args(rules_action="categories", output="json")
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        namespaces = data["result"]["namespaces"]
        ns_names = {n["namespace"] for n in namespaces}
        # Must include the 5 standard namespaces
        assert "SOURCE" in ns_names
        assert "SINK" in ns_names
        assert "SANITIZER" in ns_names
        assert "ENTRY_POINT" in ns_names
        assert "ROLE" in ns_names

    def test_categories_text(self, capsys):
        """rules categories outputs readable text."""
        args = _make_args(rules_action="categories")
        run(args)
        out = capsys.readouterr().out
        assert "SINK" in out
        assert "SOURCE" in out


# =========================================================================
# Test 3: cpg rules add-sink writes to project YAML correctly
# =========================================================================


class TestRulesAddSink:
    """Test rules add-sink subcommand."""

    def test_add_sink_creates_yaml(self, tmp_project, capsys):
        """add-sink creates .cpg/rules/sinks.yaml with new entry."""
        args = _make_args(
            rules_action="add-sink",
            name="my_dangerous_func",
            category="OS_COMMAND",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        assert data["result"]["rule_id"] == "sink_my_dangerous_func"

        # Verify YAML was written
        yaml_path = tmp_project / ".cpg" / "rules" / "sinks.yaml"
        assert yaml_path.exists()
        content = yaml.safe_load(yaml_path.read_text())
        assert content["version"] == 1
        sinks = content["sinks"]
        assert len(sinks) == 1
        assert sinks[0]["name"] == "my_dangerous_func"
        assert sinks[0]["category"] == "OS_COMMAND"

    def test_add_sink_idempotent(self, tmp_project):
        """add-sink with same ID is idempotent."""
        args = _make_args(
            rules_action="add-sink",
            name="my_func",
            category="MEMORY_WRITE",
            project=str(tmp_project),
        )
        run(args)
        run(args)  # Second call

        yaml_path = tmp_project / ".cpg" / "rules" / "sinks.yaml"
        content = yaml.safe_load(yaml_path.read_text())
        assert len(content["sinks"]) == 1  # Not duplicated

    def test_add_sink_appears_in_registry(self, tmp_project):
        """add-sink rule appears in merged registry."""
        args = _make_args(
            rules_action="add-sink",
            name="custom_sink",
            category="DB_EXECUTE",
            project=str(tmp_project),
        )
        run(args)

        registry = RuleRegistry(project_root=tmp_project).load()
        sink_db = registry.sink_db
        assert "custom_sink" in sink_db
        assert sink_db["custom_sink"] == "DB_EXECUTE"


# =========================================================================
# Test 4: cpg rules add-sink invalid category produces structured error
# =========================================================================


class TestRulesAddSinkInvalidCategory:
    """Test add-sink with invalid category."""

    def test_invalid_category_json(self, tmp_project, capsys):
        """add-sink with invalid category returns error with valid options."""
        args = _make_args(
            rules_action="add-sink",
            name="foo",
            category="INVALID_CATEGORY",
            project=str(tmp_project),
            output="json",
        )
        with pytest.raises(SystemExit):
            run(args)

        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is False
        assert "INVALID_ARGUMENT" in data["error"]["code"]
        assert "valid_categories" in data["result"]
        assert "OS_COMMAND" in data["result"]["valid_categories"]

    def test_invalid_category_text(self, tmp_project, capsys):
        """add-sink with invalid category prints error to stderr."""
        args = _make_args(
            rules_action="add-sink",
            name="foo",
            category="BOGUS",
            project=str(tmp_project),
            output="text",
        )
        with pytest.raises(SystemExit):
            run(args)

        err = capsys.readouterr().err
        assert "Invalid SINK category" in err


# =========================================================================
# Test 5: cpg rules tombstone requires --reason
# =========================================================================


class TestRulesTombstone:
    """Test rules tombstone subcommand."""

    def test_tombstone_writes_yaml(self, tmp_project, capsys):
        """tombstone creates tombstone entry in project YAML."""
        args = _make_args(
            rules_action="tombstone",
            rule_id="sc_strcpy",
            reason="not relevant to Python project",
            project=str(tmp_project),
            output="json",
        )
        run(args)

        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        assert data["result"]["action"] == "tombstoned"
        assert data["result"]["rule_id"] == "sc_strcpy"

        # Verify YAML
        yaml_path = tmp_project / ".cpg" / "rules" / "sinks.yaml"
        assert yaml_path.exists()
        content = yaml.safe_load(yaml_path.read_text())
        tombstones = content["tombstone"]
        assert len(tombstones) == 1
        assert tombstones[0]["id"] == "sc_strcpy"
        assert tombstones[0]["reason"] == "not relevant to Python project"

    def test_tombstone_unknown_rule_id(self, tmp_project, capsys):
        """tombstone with unknown rule ID produces error."""
        args = _make_args(
            rules_action="tombstone",
            rule_id="nonexistent_rule_xyz",
            reason="test",
            project=str(tmp_project),
            output="json",
        )
        with pytest.raises(SystemExit):
            run(args)

        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is False
        assert "not found" in data["error"]["message"]

    def test_tombstone_suppresses_in_registry(self, tmp_project):
        """Tombstoned rule is inactive in merged registry."""
        args = _make_args(
            rules_action="tombstone",
            rule_id="sc_strcpy",
            reason="C-only project",
            project=str(tmp_project),
        )
        run(args)

        registry = RuleRegistry(project_root=tmp_project).load()
        mr = registry.sinks.by_id("sc_strcpy")
        assert mr is not None
        assert mr.active is False
        assert mr.tombstone_reason == "C-only project"


# =========================================================================
# Test 6: cpg rules validate detects orphaned tombstones
# =========================================================================


class TestRulesValidate:
    """Test rules validate subcommand."""

    def test_validate_no_rules_dir(self, tmp_project, capsys):
        """validate with no .cpg/rules/ reports clean."""
        args = _make_args(
            rules_action="validate",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        assert data["result"]["valid"] is True

    def test_validate_detects_orphaned_tombstone(self, tmp_project, capsys):
        """validate detects tombstone referencing non-existent global rule."""
        rules_dir = tmp_project / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)

        # Write a tombstone referencing a rule that doesn't exist globally
        sinks_yaml = rules_dir / "sinks.yaml"
        sinks_yaml.write_text(yaml.dump({
            "version": 1,
            "tombstone": [{"id": "sink_nonexistent_xyz", "reason": "test"}],
        }))

        args = _make_args(
            rules_action="validate",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        issues = data["result"]["issues"]
        orphan_issues = [i for i in issues if "Orphaned tombstone" in i["message"]]
        assert len(orphan_issues) >= 1

    def test_validate_detects_yaml_error(self, tmp_project, capsys):
        """validate detects malformed YAML."""
        rules_dir = tmp_project / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)

        bad_yaml = rules_dir / "sinks.yaml"
        bad_yaml.write_text("version: 1\nsinks:\n  - invalid: [unterminated")

        args = _make_args(
            rules_action="validate",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        issues = data["result"]["issues"]
        error_issues = [i for i in issues if i["severity"] == "error"]
        assert len(error_issues) >= 1


# =========================================================================
# Test 7: cpg rules resolve returns matched rule with origin
# =========================================================================


class TestRulesResolve:
    """Test rules resolve subcommand."""

    def test_resolve_known_sink(self, capsys):
        """resolve strcpy returns sink match."""
        args = _make_args(
            rules_action="resolve",
            function_name="strcpy",
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        matches = data["result"]["matches"]
        assert len(matches) >= 1
        assert matches[0]["rule_type"] == "sinks"
        assert matches[0]["origin"] == "SDK_CORE"
        assert matches[0]["active"] is True

    def test_resolve_tombstoned_rule(self, tmp_project, capsys):
        """resolve shows tombstoned status after tombstoning."""
        # First tombstone strcpy
        tomb_args = _make_args(
            rules_action="tombstone",
            rule_id="sc_strcpy",
            reason="not relevant",
            project=str(tmp_project),
        )
        run(tomb_args)
        capsys.readouterr()  # Clear tombstone output

        # Then resolve
        args = _make_args(
            rules_action="resolve",
            function_name="strcpy",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        matches = data["result"]["matches"]
        assert len(matches) >= 1
        sink_match = [m for m in matches if m["rule_type"] == "sinks"][0]
        assert sink_match["active"] is False
        assert sink_match["tombstone_reason"] == "not relevant"

    def test_resolve_unknown_function(self, capsys):
        """resolve with unknown function returns empty matches."""
        args = _make_args(
            rules_action="resolve",
            function_name="totally_unknown_function_xyz",
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        assert len(data["result"]["matches"]) == 0


# =========================================================================
# Test 8: --no-retag flag skips re-tagging
# =========================================================================


class TestNoRetag:
    """Test --no-retag flag."""

    @patch("codedmap.cli.commands.rules._trigger_retag")
    def test_no_retag_skips(self, mock_retag, tmp_project):
        """--no-retag prevents _trigger_retag from being called."""
        args = _make_args(
            rules_action="add-sink",
            name="test_func",
            category="MEMORY_WRITE",
            project=str(tmp_project),
            no_retag=True,
        )
        run(args)
        mock_retag.assert_not_called()

    @patch("codedmap.cli.commands.rules._trigger_retag")
    def test_without_no_retag_calls_retag(self, mock_retag, tmp_project):
        """Without --no-retag, _trigger_retag is called."""
        args = _make_args(
            rules_action="add-sink",
            name="test_func2",
            category="MEMORY_WRITE",
            project=str(tmp_project),
            no_retag=False,
        )
        run(args)
        mock_retag.assert_called_once_with(args, "sinks")


# =========================================================================
# Additional: show --merged
# =========================================================================


class TestRulesShow:
    """Test rules show subcommand."""

    def test_show_merged_json(self, capsys):
        """show --merged returns all rules with origin."""
        args = _make_args(rules_action="show", merged=True, output="json")
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True
        rules = data["result"]["rules"]
        assert len(rules) > 0
        # Every rule should have origin and active fields
        for r in rules:
            assert "origin" in r
            assert "active" in r
            assert "id" in r

    def test_show_text(self, capsys):
        """show --merged produces readable text."""
        args = _make_args(rules_action="show", merged=True)
        run(args)
        out = capsys.readouterr().out
        assert "SDK_CORE" in out


# =========================================================================
# Additional: add-source, add-safe, add-entrypoint
# =========================================================================


class TestRulesAddSource:
    """Test rules add-source subcommand."""

    def test_add_source_creates_yaml(self, tmp_project, capsys):
        """add-source creates sources.yaml with new entry."""
        args = _make_args(
            rules_action="add-source",
            name="my_source",
            category="NETWORK_DATA",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True

        yaml_path = tmp_project / ".cpg" / "rules" / "sources.yaml"
        assert yaml_path.exists()
        content = yaml.safe_load(yaml_path.read_text())
        assert content["sources"][0]["name"] == "my_source"
        assert content["sources"][0]["category"] == "NETWORK_DATA"

    def test_add_source_invalid_category(self, tmp_project, capsys):
        """add-source with invalid category fails."""
        args = _make_args(
            rules_action="add-source",
            name="x",
            category="INVALID",
            project=str(tmp_project),
            output="json",
        )
        with pytest.raises(SystemExit):
            run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is False


class TestRulesAddSafe:
    """Test rules add-safe subcommand."""

    def test_add_safe_creates_yaml(self, tmp_project, capsys):
        """add-safe creates safe_functions.yaml with new entry."""
        args = _make_args(
            rules_action="add-safe",
            name="my_safe_func",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True

        yaml_path = tmp_project / ".cpg" / "rules" / "safe_functions.yaml"
        assert yaml_path.exists()
        content = yaml.safe_load(yaml_path.read_text())
        assert content["safe_functions"][0]["name"] == "my_safe_func"


class TestRulesAddEntrypoint:
    """Test rules add-entrypoint subcommand."""

    def test_add_entrypoint_creates_yaml(self, tmp_project, capsys):
        """add-entrypoint creates entrypoints.yaml with new entry."""
        args = _make_args(
            rules_action="add-entrypoint",
            name="my_handler",
            category="cli",
            pattern_type="function_name",
            func_pattern="my_handler",
            project=str(tmp_project),
            output="json",
        )
        run(args)
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["success"] is True

        yaml_path = tmp_project / ".cpg" / "rules" / "entrypoints.yaml"
        assert yaml_path.exists()
        content = yaml.safe_load(yaml_path.read_text())
        rules = content["rules"]
        assert len(rules) == 1
        assert rules[0]["name"] == "my_handler"
        assert rules[0]["category"] == "cli"
