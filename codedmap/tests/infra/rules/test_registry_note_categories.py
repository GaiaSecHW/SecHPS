"""Tests for RuleRegistry note category integration."""
import sys, os
sys.path.append(os.getcwd())

import pytest


def test_registry_loads_note_categories():
    """RuleRegistry.get_note_categories() returns 6 SDK categories after load()."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    cats = reg.get_note_categories()
    assert len(cats) == 6
    assert "VULNERABILITY" in cats
    assert "ARCHITECTURE" in cats


def test_registry_is_valid_note_category():
    """is_valid_note_category returns True for SDK categories, False for unknown."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    assert reg.is_valid_note_category("VULNERABILITY") is True
    assert reg.is_valid_note_category("NONEXISTENT") is False


def test_registry_is_strict_note_category():
    """is_strict_note_category returns True for VULNERABILITY, False for ARCHITECTURE."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    assert reg.is_strict_note_category("VULNERABILITY") is True
    assert reg.is_strict_note_category("ARCHITECTURE") is False
    assert reg.is_strict_note_category("NONEXISTENT") is False


def test_registry_note_categories_with_project_root(tmp_path):
    """RuleRegistry with project_root loads project overrides."""
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_perf\n    name: PERFORMANCE\n    strict: false\n"
    )
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry(project_root=tmp_path)
    reg.load()
    assert reg.is_valid_note_category("PERFORMANCE") is True
    assert len(reg.get_note_categories()) == 7
