"""
Tests for Data entry point rules (post Phase 33 V2 enum rewrite).

After Phase 31, all data/file-read call-site rules have been MOVED to sources.yaml
as taint sources. The EntryPointCatalog no longer has DATA category rules.

After Phase 33, DATA_INPUT is removed from EntryPointCategory entirely (it is now
a Source, not an EntryPoint). This file verifies:
- DATA_INPUT category no longer exists in EntryPointCategory enum
- Catalog structure is still correct overall
"""

import pytest

from codedmap.core.schema.security import (
    EntryPointCatalog,
    EntryPointCategory,
    EntryPointRule,
    RulePattern,
)


class TestDataInputRemoved:
    """Verify DATA_INPUT is no longer a valid EntryPointCategory in V2."""

    def test_data_input_not_in_enum(self):
        """DATA_INPUT should not exist in V2 EntryPointCategory enum."""
        values = [cat.value for cat in EntryPointCategory]
        assert "DATA_INPUT" not in values, (
            "DATA_INPUT must be removed from EntryPointCategory in V2 "
            "(it is now a Source, not an EntryPoint)"
        )

    def test_data_input_construction_raises(self):
        """EntryPointCategory('DATA_INPUT') should raise ValueError in V2."""
        with pytest.raises(ValueError):
            EntryPointCategory("DATA_INPUT")

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_removed_data_rules_not_present(self, catalog: EntryPointCatalog):
        """Specific removed data rules should not be in catalog."""
        removed_names = [
            "data_file_read_python", "data_json_python", "data_yaml_python",
            "data_xml_python", "data_pickle_python", "data_csv_python",
            "data_config_python", "data_file_read_c", "data_json_c",
            "data_xml_c", "data_config_c", "data_deserialize_c",
        ]
        for name in removed_names:
            rule = catalog.by_name(name)
            assert rule is None, (
                f"Rule '{name}' should have been removed from entrypoints.yaml "
                f"(moved to sources.yaml as call-site taint source)"
            )

    def test_catalog_is_still_valid(self, catalog: EntryPointCatalog):
        """Overall catalog should still have valid structure."""
        assert len(catalog.rules) >= 15, \
            f"Catalog should have >= 15 rules total, got {len(catalog.rules)}"

        # All rules should have required fields
        for rule in catalog.rules:
            assert rule.name, f"Rule missing name"
            assert rule.category, f"Rule {rule.name} missing category"
            assert len(rule.patterns) >= 1, f"Rule {rule.name} has no patterns"


class TestCatalogSerialization:
    """Tests for catalog serialization."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_all_rules_serializable(self, catalog: EntryPointCatalog):
        """Verify all remaining rules can be serialized and deserialized."""
        for rule in catalog.rules:
            # Should be able to serialize to dict
            rule_dict = rule.to_dict()
            assert "name" in rule_dict
            assert "category" in rule_dict
            assert "patterns" in rule_dict

            # Should be able to deserialize
            restored = EntryPointRule.from_dict(rule_dict)
            assert restored.name == rule.name
            assert restored.category == rule.category
            assert len(restored.patterns) == len(rule.patterns)
