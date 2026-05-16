"""Tests for CascadingRuleLoader — TDD RED phase."""
import logging
import sys
import os

sys.path.append(os.getcwd())

import pytest
from codedmap.infra.rules import CascadingRuleLoader, OntologyError


def test_load_all_c_returns_expected_keys():
    loader = CascadingRuleLoader()
    result = loader.load_all(lang="c")
    assert set(result.keys()) >= {"entry_points", "sources", "sinks", "guards", "sanitizers", "safe_functions"}


def test_load_all_c_has_rules():
    loader = CascadingRuleLoader()
    result = loader.load_all(lang="c")
    assert len(result["sinks"]) > 0


def test_load_all_cpp_uses_c_package():
    loader = CascadingRuleLoader()
    result_c = loader.load_all(lang="c")
    result_cpp = loader.load_all(lang="cpp")
    # Same data — cpp maps to c package
    assert result_c["sinks"] == result_cpp["sinks"]
    assert result_c["sources"] == result_cpp["sources"]


def test_ontology_error_on_bad_category():
    loader = CascadingRuleLoader()
    bad_rules = [
        {"rule_type": "sinks", "id": "bad_sink", "name": "bad", "category": "BUFFER_OVERFLOW", "languages": ["c"]}
    ]
    with pytest.raises(OntologyError):
        loader.load_all(lang="c", project_rules=bad_rules)


def test_tombstone_order_validates_before_removing():
    """Rule with bad category AND tombstone=True should still raise OntologyError (validate first)."""
    loader = CascadingRuleLoader()
    bad_rules = [
        {
            "rule_type": "sinks",
            "id": "bad_sink_tombstoned",
            "name": "bad",
            "category": "BUFFER_OVERFLOW",
            "languages": ["c"],
            "tombstone": True,
            "reason": "removing it anyway",
        }
    ]
    with pytest.raises(OntologyError):
        loader.load_all(lang="c", project_rules=bad_rules)


def test_tombstone_removes_rule():
    loader = CascadingRuleLoader()
    # sc_memcpy is a known rule in c/core.yaml
    tombstone_rules = [
        {"rule_type": "sinks", "id": "sc_memcpy", "tombstone": True, "reason": "not relevant for this project"}
    ]
    result = loader.load_all(lang="c", project_rules=tombstone_rules)
    ids = [r["id"] for r in result["sinks"]]
    assert "sc_memcpy" not in ids


def test_tombstone_missing_reason_raises():
    loader = CascadingRuleLoader()
    bad_tombstone = [
        {"rule_type": "sinks", "id": "sc_memcpy", "tombstone": True}
        # missing reason
    ]
    with pytest.raises(ValueError, match="reason"):
        loader.load_all(lang="c", project_rules=bad_tombstone)


def test_orphan_tombstone_logs_warning(caplog):
    loader = CascadingRuleLoader()
    orphan = [
        {"rule_type": "sinks", "id": "nonexistent_rule_xyz", "tombstone": True, "reason": "cleanup"}
    ]
    with caplog.at_level(logging.WARNING):
        result = loader.load_all(lang="c", project_rules=orphan)
    assert "nonexistent_rule_xyz" in caplog.text
    # No crash
    assert "sinks" in result


def test_project_rules_injected():
    loader = CascadingRuleLoader()
    new_rule = {
        "rule_type": "sinks",
        "id": "custom_sink_xyz",
        "name": "custom_dangerous_func",
        "category": "OS_COMMAND",
        "languages": ["c"],
    }
    result = loader.load_all(lang="c", project_rules=[new_rule])
    ids = [r["id"] for r in result["sinks"]]
    assert "custom_sink_xyz" in ids
