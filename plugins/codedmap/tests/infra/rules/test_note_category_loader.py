"""Tests for NoteCategoryLoader — cascading YAML loader for note categories."""
import sys, os
sys.path.append(os.getcwd())

import pytest
from pathlib import Path
import logging


def test_load_sdk_categories_returns_6_builtins():
    """SDK YAML has exactly 6 built-in categories."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    assert len(cats) == 6
    names = {c["name"] for c in cats}
    assert names == {
        "ARCHITECTURE", "DATA_FLOW", "CONTROL_FLOW",
        "VULNERABILITY", "COORDINATION", "SECURITY_BOUNDARY",
    }


def test_each_category_has_required_fields():
    """Each category dict has id, name, strict fields."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    for cat in cats:
        assert "id" in cat, f"Missing 'id' in {cat}"
        assert "name" in cat, f"Missing 'name' in {cat}"
        assert "strict" in cat, f"Missing 'strict' in {cat}"


def test_strict_flags_correct():
    """VULNERABILITY, COORDINATION, SECURITY_BOUNDARY are strict; others are not."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    by_name = {c["name"]: c for c in cats}
    assert by_name["VULNERABILITY"]["strict"] is True
    assert by_name["COORDINATION"]["strict"] is True
    assert by_name["SECURITY_BOUNDARY"]["strict"] is True
    assert by_name["ARCHITECTURE"]["strict"] is False
    assert by_name["DATA_FLOW"]["strict"] is False
    assert by_name["CONTROL_FLOW"]["strict"] is False


def test_project_override_adds_category(tmp_path):
    """Project-level YAML adds new categories to SDK builtins."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_perf\n    name: PERFORMANCE\n    strict: false\n"
    )
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    names = {c["name"] for c in cats}
    assert "PERFORMANCE" in names
    assert len(cats) == 7


def test_project_tombstone_removes_category(tmp_path):
    """Project tombstone removes an SDK built-in category."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        'version: 2\ntombstone:\n  - id: note_cat_control_flow\n    reason: "Not used"\n'
    )
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    names = {c["name"] for c in cats}
    assert "CONTROL_FLOW" not in names
    assert len(cats) == 5


def test_tombstone_without_reason_raises(tmp_path):
    """Tombstone entry missing 'reason' field raises ValueError."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ntombstone:\n  - id: note_cat_control_flow\n"
    )
    loader = NoteCategoryLoader()
    with pytest.raises(ValueError, match="reason"):
        loader.load(project_root=tmp_path)


def test_orphan_tombstone_warns(tmp_path, caplog):
    """Tombstone for non-existent ID logs a warning."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        'version: 2\ntombstone:\n  - id: nonexistent_id\n    reason: "gone"\n'
    )
    loader = NoteCategoryLoader()
    with caplog.at_level(logging.WARNING):
        cats = loader.load(project_root=tmp_path)
    assert len(cats) == 6
    assert "nonexistent_id" in caplog.text


def test_duplicate_category_name_raises(tmp_path):
    """Adding a category with a name that already exists raises ValueError."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_dup\n    name: ARCHITECTURE\n    strict: false\n"
    )
    loader = NoteCategoryLoader()
    with pytest.raises(ValueError, match="[Dd]uplicate"):
        loader.load(project_root=tmp_path)


def test_no_project_dir_returns_sdk_only(tmp_path):
    """When .cpg/rules/ doesn't exist, returns SDK categories only."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    assert len(cats) == 6


def test_load_with_none_project_root():
    """load(project_root=None) returns SDK categories only."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=None)
    assert len(cats) == 6
