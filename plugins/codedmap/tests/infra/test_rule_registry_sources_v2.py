# tests/infra/test_rule_registry_sources_v2.py
"""
TDD tests for Phase 31 Plan 01 Task 3: Update RuleRegistry list-key for sources.yaml.

Behavior:
- Test 1: get_source_db() returns dict with >= 30 entries
- Test 2: "getenv" is in get_source_db() (backward compat)
- Test 3: Each entry maps function name to category string
- Test 4: test_rule_registry.py still passes
"""

import os
import sys

import pytest

sys.path.append(os.getcwd())

from codedmap.infra.rules import RuleRegistry


class TestRuleRegistrySourcesV2:
    """Tests for RuleRegistry with sources.yaml v2 schema."""

    def setup_method(self):
        self.registry = RuleRegistry().load()

    def test_get_source_db_has_30_or_more_entries(self):
        """Test 1: get_source_db() returns >= 30 entries."""
        source_db = self.registry.get_source_db()
        assert len(source_db) >= 30, (
            f"Expected >= 30 source rules, got {len(source_db)}: {list(source_db.keys())}"
        )

    def test_getenv_still_in_source_db(self):
        """Test 2: 'getenv' is in get_source_db() for backward compat."""
        source_db = self.registry.get_source_db()
        assert "getenv" in source_db, (
            f"'getenv' not found in source_db. Available keys: {sorted(source_db.keys())}"
        )
        assert source_db["getenv"] == "ENV_DATA", (
            f"Expected getenv -> ENV_DATA, got: {source_db['getenv']}"
        )

    def test_source_db_maps_name_to_category(self):
        """Test 3: Each entry in get_source_db() maps function name to category string."""
        source_db = self.registry.get_source_db()
        for name, category in source_db.items():
            assert isinstance(name, str), f"Source name {name!r} is not a string"
            assert isinstance(category, str), f"Category for {name!r} is not a string"
            assert len(category) > 0, f"Empty category for {name!r}"

    def test_source_db_has_expected_entries(self):
        """Test specific expected source mappings (keyed by rule 'name' field)."""
        source_db = self.registry.get_source_db()

        # Network sources (rule names)
        assert "recv" in source_db
        assert source_db["recv"] == "NETWORK_DATA"

        # Stdin/env sources (rule names from sources.yaml)
        assert "scanf" in source_db
        assert source_db["scanf"] == "ENV_DATA"

        assert "fgets" in source_db
        assert source_db["fgets"] == "ENV_DATA"

        assert "gets" in source_db
        assert source_db["gets"] == "ENV_DATA"

        # File read sources (rule names)
        assert "fopen" in source_db
        assert source_db["fopen"] == "FILE_DATA"

        assert "fread" in source_db
        assert source_db["fread"] == "FILE_DATA"

        # Deserialization
        assert "protobuf_decode" in source_db
        assert source_db["protobuf_decode"] == "DESERIALIZED_OBJECT"

        # ENV_DATA
        assert "getenv" in source_db
        assert source_db["getenv"] == "ENV_DATA"

    def test_sources_property_loads_rules(self):
        """sources property (RuleSet) has active rules."""
        sources = self.registry.sources
        active = sources.active_rules()
        assert len(active) >= 10, (
            f"Expected >= 10 active source rules, got {len(active)}"
        )
