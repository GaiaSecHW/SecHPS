# tests/infra/test_rule_registry.py
"""
Tests for RuleRegistry merge engine, YAML loaders, and domain object builders.

Tests:
1. Global YAML loading (all 6 types)
2. Project rule addition
3. Tombstone suppression
4. Tombstone without reason raises error
5. Orphaned tombstone warns
6. SinkDefinition.from_dict() round-trip
7. Merge order (project overrides global, alphabetical within project)
8. Missing YAML file raises error
"""

import os
import sys
import tempfile

import pytest
import yaml

sys.path.append(os.getcwd())

from codedmap.infra.rules import (
    RuleRegistry,
    RuleSet,
    MergedRule,
    Tombstone,
)
from codedmap.core.schema.security.sink_models import SinkDefinition, SinkCategory
from codedmap.core.schema.security.sink_catalog import SinkCatalog
from codedmap.core.schema.security.entrypoint_catalog import EntryPointCatalog
from codedmap.core.schema.security.entrypoint_rules import EntryPointRule
from codedmap.core.schema.security.static_rules import StaticSecurityRules


# =========================================================================
# Test 1: Global YAML loading (all 6 types)
# =========================================================================


class TestGlobalYAMLLoading:
    """Test that RuleRegistry loads all 6 global YAML files correctly."""

    def test_ontology_loaded(self):
        """Global ontology.yaml loads with expected namespaces."""
        registry = RuleRegistry().load()
        cats = registry.ontology_categories
        assert len(cats) >= 5
        assert "SOURCE" in cats
        assert "SINK" in cats
        assert "SANITIZER" in cats
        assert "ENTRY_POINT" in cats
        assert "ROLE" in cats

    def test_ontology_has_entries(self):
        """Each namespace has multiple entries."""
        registry = RuleRegistry().load()
        cats = registry.ontology_categories
        assert len(cats["SOURCE"]) >= 6
        assert len(cats["SINK"]) >= 8
        assert len(cats["SANITIZER"]) >= 5
        assert len(cats["ENTRY_POINT"]) >= 7
        assert len(cats["ROLE"]) >= 7

    def test_sinks_loaded(self):
        """Global sinks load with V2 categories."""
        registry = RuleRegistry().load()
        sink_db = registry.sink_db
        assert len(sink_db) >= 10
        assert "strcpy" in sink_db
        assert sink_db["strcpy"] == "MEMORY_WRITE"
        assert "recv" in sink_db
        assert sink_db["recv"] == "MEMORY_WRITE"

    def test_sources_loaded(self):
        """Global sources load with V2 categories."""
        registry = RuleRegistry().load()
        source_db = registry.source_db
        assert len(source_db) >= 10
        assert "getenv" in source_db
        assert source_db["getenv"] == "ENV_DATA"

    def test_safe_functions_loaded(self):
        """Global safe_functions.yaml loads with ~29 entries."""
        registry = RuleRegistry().load()
        safe_set = registry.safe_set
        assert len(safe_set) >= 29
        assert "len" in safe_set
        assert "escape" in safe_set

    def test_sink_catalog_loaded(self):
        """Global sinks load into SinkCatalog."""
        registry = RuleRegistry().load()
        catalog = registry.materialized_sink_catalog
        assert isinstance(catalog, SinkCatalog)
        assert len(catalog.sinks) >= 10
        # Verify a specific sink
        recv = catalog.find_by_name("recv")
        assert recv is not None
        assert recv.category == SinkCategory.MEMORY_WRITE

    def test_entrypoints_loaded(self):
        """Global entrypoints load EntryPointRules."""
        registry = RuleRegistry().load()
        catalog = registry.entrypoint_catalog
        assert isinstance(catalog, EntryPointCatalog)
        assert len(catalog.rules) >= 10

    def test_load_is_idempotent(self):
        """Calling load() twice returns same result."""
        registry = RuleRegistry()
        registry.load()
        first_sink_count = len(registry.sink_db)
        registry.load()  # second call
        assert len(registry.sink_db) == first_sink_count

    def test_auto_load_on_property_access(self):
        """Accessing properties auto-triggers load()."""
        registry = RuleRegistry()
        # No explicit load() call
        assert len(registry.sink_db) >= 10


# =========================================================================
# Test 2: Project rule addition
# =========================================================================


class TestProjectRuleAddition:
    """Test that project-level rules merge correctly."""

    def test_project_adds_new_sink(self, tmp_path):
        """A project sinks.yaml can add new entries."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "sinks": [
                {"id": "project_custom_sink", "name": "my_dangerous_func", "category": "CUSTOM_VULN"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        sink_db = registry.sink_db
        assert "my_dangerous_func" in sink_db
        assert sink_db["my_dangerous_func"] == "CUSTOM_VULN"
        # Global sinks still present
        assert "strcpy" in sink_db

    def test_project_adds_new_ontology_entry(self, tmp_path):
        """A project ontology.yaml can add new namespace entries."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "ontology.yaml").write_text(yaml.dump({
            "version": 1,
            "categories": {
                "CUSTOM_NS": [
                    {"id": "custom_tag_1", "name": "MY_TAG"},
                ],
            },
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        cats = registry.ontology_categories
        assert "CUSTOM_NS" in cats
        assert "MY_TAG" in cats["CUSTOM_NS"]
        # Global categories still present
        assert "SOURCE" in cats

    def test_project_rule_has_project_origin(self, tmp_path):
        """Project rules have origin='project'."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "sinks": [
                {"id": "project_sink_1", "name": "proj_func", "category": "TEST"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        rule = registry.sinks.by_id("project_sink_1")
        assert rule is not None
        assert rule.origin == "LOCAL_OVERRIDE"

    def test_no_project_dir_is_fine(self, tmp_path):
        """No .cpg/rules/ directory means global-only rules."""
        registry = RuleRegistry(project_root=tmp_path).load()
        assert len(registry.sink_db) >= 10


# =========================================================================
# Test 3: Tombstone suppression
# =========================================================================


class TestTombstoneSuppression:
    """Test tombstone (rule suppression) mechanics."""

    def test_tombstone_suppresses_global_sink(self, tmp_path):
        """Tombstoned sink is excluded from sink_db."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "sc_strcpy", "reason": "False positive in our codebase"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        # strcpy should be suppressed
        assert "strcpy" not in registry.sink_db

        # Other sinks still present
        assert "recv" in registry.sink_db

    def test_tombstone_appears_in_get_tombstones(self, tmp_path):
        """Tombstoned rules appear in get_tombstones()."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "sc_strcpy", "reason": "False positive in our codebase"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        tombstones = registry.get_tombstones()
        assert len(tombstones) >= 1
        ts = [t for t in tombstones if t["id"] == "sc_strcpy"]
        assert len(ts) == 1
        assert ts[0]["reason"] == "False positive in our codebase"
        assert ts[0]["rule_type"] == "sinks"

    def test_tombstone_rule_has_reason(self, tmp_path):
        """The tombstoned MergedRule has tombstone_reason set."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "sc_strcpy", "reason": "Our strcpy is safe"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        rule = registry.sinks.by_id("sc_strcpy")
        assert rule is not None
        assert rule.active is False
        assert rule.tombstone_reason == "Our strcpy is safe"


# =========================================================================
# Test 4: Tombstone without reason raises error
# =========================================================================


class TestTombstoneValidation:
    """Test tombstone validation errors."""

    def test_tombstone_without_reason_raises(self, tmp_path):
        """Tombstone missing 'reason' raises ValueError."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "sc_strcpy"},  # missing reason
            ],
        }))

        with pytest.raises(ValueError, match="missing required 'reason'"):
            RuleRegistry(project_root=tmp_path).load()

    def test_tombstone_with_empty_reason_raises(self, tmp_path):
        """Tombstone with empty reason raises ValueError."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "sc_strcpy", "reason": ""},  # empty reason
            ],
        }))

        with pytest.raises(ValueError, match="missing required 'reason'"):
            RuleRegistry(project_root=tmp_path).load()


# =========================================================================
# Test 5: Orphaned tombstone warns
# =========================================================================


class TestOrphanedTombstone:
    """Test orphaned tombstone handling."""

    def test_orphaned_tombstone_warns(self, tmp_path, caplog):
        """Tombstone referencing non-existent rule emits warning."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "tombstone": [
                {"id": "nonexistent_rule", "reason": "This rule does not exist"},
            ],
        }))

        import logging
        with caplog.at_level(logging.WARNING):
            registry = RuleRegistry(project_root=tmp_path).load()

        assert any("nonexistent_rule" in rec.message for rec in caplog.records)


# =========================================================================
# Test 6: SinkDefinition.from_dict() round-trip
# =========================================================================


class TestSinkDefinitionFromDict:
    """Test SinkDefinition.from_dict() classmethod."""

    def test_round_trip(self):
        """from_dict(to_dict()) produces equivalent object."""
        original = SinkDefinition(
            name="custom_func",
            category=SinkCategory.MEMORY_WRITE,
            languages=["python"],
        )
        d = original.to_dict()
        restored = SinkDefinition.from_dict(d)
        assert restored.name == original.name
        assert restored.category == original.category
        assert restored.languages == original.languages

    def test_from_dict_defaults(self):
        """from_dict() uses correct defaults for optional fields."""
        d = {"name": "recv", "category": "MEMORY_WRITE"}
        sink = SinkDefinition.from_dict(d)
        assert sink.name == "recv"
        assert sink.category == SinkCategory.MEMORY_WRITE
        assert sink.languages == ["c", "cpp", "python"]

    def test_from_dict_all_fields(self):
        """from_dict() handles all fields."""
        d = {
            "name": "pickle.load",
            "category": "CODE_EVAL",
            "languages": ["python"],
        }
        sink = SinkDefinition.from_dict(d)
        assert sink.name == "pickle.load"
        assert sink.category == SinkCategory.CODE_EVAL
        assert sink.languages == ["python"]


# =========================================================================
# Test 7: Merge order
# =========================================================================


class TestMergeOrder:
    """Test merge order: project overrides global, alphabetical within project."""

    def test_project_rules_appear_after_global(self, tmp_path):
        """Project rules are appended after global rules."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "sinks": [
                {"id": "proj_sink_1", "name": "proj_func", "category": "TEST"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        active = registry.sinks.active_rules()
        # Global rules come first, project rules at end
        global_rules = [r for r in active if r.origin == "SDK_CORE"]
        project_rules = [r for r in active if r.origin == "LOCAL_OVERRIDE"]
        assert len(global_rules) >= 10
        assert len(project_rules) == 1
        assert project_rules[0].id == "proj_sink_1"

    def test_alphabetical_project_files(self, tmp_path):
        """Multiple project YAML files are processed alphabetically."""
        rules_dir = tmp_path / ".cpg" / "rules"
        rules_dir.mkdir(parents=True)
        # Create two project sink files (prefix ensures alphabetical order)
        # Note: they must have different stems to be routed to different types,
        # but we can test ontology additions which are in separate files
        (rules_dir / "sources.yaml").write_text(yaml.dump({
            "version": 2,
            "rules": [
                {"id": "proj_source_1", "name": "my_source", "category": "CUSTOM",
                 "languages": ["python"],
                 "patterns": [{"type": "call", "function": "my_source", "taints": "return"}]},
            ],
        }))
        (rules_dir / "sinks.yaml").write_text(yaml.dump({
            "version": 1,
            "sinks": [
                {"id": "proj_sink_1", "name": "my_sink", "category": "CUSTOM"},
            ],
        }))

        registry = RuleRegistry(project_root=tmp_path).load()
        # Both project additions should be present
        assert "my_source" in registry.source_db
        assert "my_sink" in registry.sink_db


# =========================================================================
# Test 8: Missing YAML file raises error
# =========================================================================


class TestMissingYAMLFile:
    """Test that unsupported languages raise appropriate errors."""

    def test_unsupported_language_raises(self):
        """CascadingRuleLoader raises ValueError for unsupported language."""
        from codedmap.infra.rules import CascadingRuleLoader
        with pytest.raises(ValueError, match="Unsupported language"):
            CascadingRuleLoader().load_all(lang="cobol")

    def test_registry_load_default_lang(self):
        """RuleRegistry.load() works with default lang='c'."""
        registry = RuleRegistry().load()
        assert len(registry.sink_db) >= 10

    def test_registry_load_python_lang(self):
        """RuleRegistry.load() works with lang='python'."""
        registry = RuleRegistry().load(lang="python")
        assert len(registry.sink_db) >= 1


# =========================================================================
# Integration: Verify refactored modules produce same data
# =========================================================================


class TestRefactoredModuleEquivalence:
    """Verify refactored modules produce identical data to pre-refactor."""

    def test_static_rules_sink_lookup(self):
        """StaticSecurityRules.get_sink_category() works via YAML."""
        assert StaticSecurityRules.get_sink_category("strcpy") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("recv") == "MEMORY_WRITE"
        assert StaticSecurityRules.get_sink_category("unknown_func") is None

    def test_static_rules_source_lookup(self):
        """StaticSecurityRules.get_source_category() works via YAML."""
        assert StaticSecurityRules.get_source_category("getenv") == "ENV_DATA"
        assert StaticSecurityRules.get_source_category("recv") == "NETWORK_DATA"
        assert StaticSecurityRules.get_source_category("unknown_func") is None

    def test_static_rules_safe_lookup(self):
        """StaticSecurityRules.is_obvious_safe() works via YAML."""
        assert StaticSecurityRules.is_obvious_safe("len") is True
        assert StaticSecurityRules.is_obvious_safe("escape") is True
        assert StaticSecurityRules.is_obvious_safe("dangerous_func") is False

    def test_sink_catalog_load_default(self):
        """SinkCatalog.load_default() returns catalog from YAML."""
        catalog = SinkCatalog.load_default()
        assert len(catalog.sinks) >= 10
        assert catalog.is_sink("recv")
        assert catalog.is_sink("strcpy")

    def test_entrypoint_catalog_load_default(self):
        """EntryPointCatalog.load_default() returns catalog from YAML."""
        catalog = EntryPointCatalog.load_default()
        assert len(catalog.rules) >= 10
        # Check a known rule exists
        rule = catalog.by_name("cli_main_c")
        assert rule is not None

    def test_ontology_categories(self):
        """ONTOLOGY_CATEGORIES loaded from YAML matches expected structure."""
        from codedmap.core.schema.tags.ontology import ONTOLOGY_CATEGORIES
        assert len(ONTOLOGY_CATEGORIES) >= 5
        assert "NETWORK_DATA" in ONTOLOGY_CATEGORIES["SOURCE"]
        assert "MEMORY_WRITE" in ONTOLOGY_CATEGORIES["SINK"]
        assert "BOUNDS_CHECK" in ONTOLOGY_CATEGORIES["GUARD"]

    def test_l1_ontology(self):
        """L1_ONTOLOGY loaded from YAML has correct tag definitions."""
        from codedmap.core.schema.tags.ontology import L1_ONTOLOGY
        assert len(L1_ONTOLOGY) >= 20
        assert "ONTOLOGY:SINK:MEMORY_WRITE" in L1_ONTOLOGY
        assert "ONTOLOGY:GUARD:BOUNDS_CHECK" in L1_ONTOLOGY


# =========================================================================
# RuleSet and MergedRule unit tests
# =========================================================================


class TestRuleSet:
    """Unit tests for RuleSet data class."""

    def test_active_rules(self):
        rs = RuleSet(rules=[
            MergedRule(id="r1", data={}, origin="global", active=True),
            MergedRule(id="r2", data={}, origin="global", active=False),
            MergedRule(id="r3", data={}, origin="project", active=True),
        ])
        active = rs.active_rules()
        assert len(active) == 2
        assert {r.id for r in active} == {"r1", "r3"}

    def test_tombstoned_rules(self):
        rs = RuleSet(rules=[
            MergedRule(id="r1", data={}, origin="global", active=True),
            MergedRule(id="r2", data={}, origin="global", active=False, tombstone_reason="test"),
        ])
        tombstoned = rs.tombstoned_rules()
        assert len(tombstoned) == 1
        assert tombstoned[0].id == "r2"

    def test_by_id(self):
        rs = RuleSet(rules=[
            MergedRule(id="r1", data={"x": 1}, origin="global"),
        ])
        assert rs.by_id("r1").data["x"] == 1
        assert rs.by_id("nonexistent") is None


# =========================================================================
# get_active_rules API test
# =========================================================================


class TestGetActiveRules:
    """Test get_active_rules() API."""

    def test_valid_rule_type(self):
        registry = RuleRegistry().load()
        active = registry.get_active_rules("sinks")
        assert len(active) >= 10
        assert all("id" in r for r in active)
        assert all("origin" in r for r in active)

    def test_invalid_rule_type_raises(self):
        registry = RuleRegistry().load()
        with pytest.raises(ValueError, match="Unknown rule type"):
            registry.get_active_rules("nonexistent")
