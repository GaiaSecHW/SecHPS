"""Unit tests for tag schema package (TAG-01 through TAG-06)."""

import sys
import os

sys.path.append(os.getcwd())

import pytest
from datetime import datetime


# TAG-01: Import and TagLayer enum
class TestTagImports:
    def test_import(self):
        """from codedmap.core.schema.tags import TagLayer, TagDefinition, TagRegistry succeeds."""
        from codedmap.core.schema.tags import TagLayer, TagDefinition, TagRegistry
        assert TagLayer is not None
        assert TagDefinition is not None
        assert TagRegistry is not None

    def test_tag_layer_enum(self):
        """TagLayer has exactly 3 members: ONTOLOGY, SEMANTIC, STATE; each is a str."""
        from codedmap.core.schema.tags import TagLayer
        assert len(TagLayer) == 3
        assert TagLayer.ONTOLOGY == "ONTOLOGY"
        assert TagLayer.SEMANTIC == "SEMANTIC"
        assert TagLayer.STATE == "STATE"
        # Each member is a str
        assert isinstance(TagLayer.ONTOLOGY, str)
        assert isinstance(TagLayer.SEMANTIC, str)
        assert isinstance(TagLayer.STATE, str)


# TAG-02: L1 Ontology catalog
class TestOntologyCatalog:
    def test_list_ontology(self):
        """TagRegistry().list_ontology() returns list of TagDefinition covering all namespaces."""
        from codedmap.core.schema.tags import TagRegistry, TagDefinition
        registry = TagRegistry()
        ontology = registry.list_ontology()
        assert isinstance(ontology, list)
        assert len(ontology) > 0
        assert all(isinstance(td, TagDefinition) for td in ontology)

        # Check all 5 namespace groups are represented
        namespaces = {td.namespace for td in ontology}
        assert "SOURCE" in namespaces
        assert "SINK" in namespaces
        assert "SANITIZER" in namespaces
        assert "ENTRY_POINT" in namespaces
        assert "ROLE" in namespaces

    def test_list_ontology_count(self):
        """Total ontology count matches ONTOLOGY_CATEGORIES total."""
        from codedmap.core.schema.tags import TagRegistry, ONTOLOGY_CATEGORIES
        registry = TagRegistry()
        ontology = registry.list_ontology()
        expected_count = sum(len(v) for v in ONTOLOGY_CATEGORIES.values())
        assert len(ontology) == expected_count

    def test_ontology_has_expected_tags(self):
        """Specific well-known tags exist in ontology."""
        from codedmap.core.schema.tags import TagRegistry
        registry = TagRegistry()
        ontology = registry.list_ontology()
        full_tags = {td.full_tag for td in ontology}
        assert "ONTOLOGY:SOURCE:NETWORK_DATA" in full_tags
        assert "ONTOLOGY:SINK:DB_EXECUTE" in full_tags
        assert "ONTOLOGY:SANITIZER:ESCAPE" in full_tags
        assert "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER" in full_tags
        assert "ONTOLOGY:ROLE:CONTROLLER" not in full_tags  # CONTROLLER removed in Phase 37
        assert "ONTOLOGY:ROLE:BOUNDARY" in full_tags


# TAG-03: L2 Semantic tags
class TestSemanticTags:
    def test_semantic_tag_definition(self):
        """TagDefinition with layer=SEMANTIC validates confidence in [0,1]."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        # Valid confidence
        td = TagDefinition(
            layer=TagLayer.SEMANTIC,
            namespace="AUTH",
            name="PASSWORD_HASH",
            confidence=0.85,
            applied_by="security_pass",
            source="static_analysis",
        )
        assert td.confidence == 0.85
        assert td.applied_by == "security_pass"
        assert td.source == "static_analysis"

    def test_semantic_tag_rejects_invalid_confidence(self):
        """TagDefinition rejects confidence outside [0,1]."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        with pytest.raises(Exception):  # ValidationError
            TagDefinition(
                layer=TagLayer.SEMANTIC,
                namespace="AUTH",
                name="TEST",
                confidence=-0.5,
            )
        with pytest.raises(Exception):  # ValidationError
            TagDefinition(
                layer=TagLayer.SEMANTIC,
                namespace="AUTH",
                name="TEST",
                confidence=1.5,
            )

    def test_semantic_tag_full_tag(self):
        """full_tag property produces LAYER:NAMESPACE:NAME format."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        td = TagDefinition(
            layer=TagLayer.SEMANTIC,
            namespace="AUTH",
            name="PASSWORD_HASH",
        )
        assert td.full_tag == "SEMANTIC:AUTH:PASSWORD_HASH"


# TAG-04: L3 State tags
class TestStateTags:
    def test_state_tags_predefined(self):
        """STATE_VOCABULARY contains the 4 pre-defined state values."""
        from codedmap.core.schema.tags import STATE_VOCABULARY
        assert "REVIEWED" in STATE_VOCABULARY
        assert "SUSPICIOUS" in STATE_VOCABULARY
        assert "FALSE_POSITIVE" in STATE_VOCABULARY
        assert "CONFIRMED_VULN" in STATE_VOCABULARY

    def test_state_custom_namespace(self):
        """STATE:CUSTOM:* namespace accepted."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        td = TagDefinition(
            layer=TagLayer.STATE,
            namespace="CUSTOM",
            name="NEEDS_REFACTOR",
        )
        assert td.full_tag == "STATE:CUSTOM:NEEDS_REFACTOR"


# TAG-05: Registry operations
class TestRegistryOperations:
    def test_registry_get_layer(self):
        """get_layer parses colon-separated tag strings correctly."""
        from codedmap.core.schema.tags import TagRegistry, TagLayer
        registry = TagRegistry()
        assert registry.get_layer("ONTOLOGY:SINK:SQL_INJECTION") == TagLayer.ONTOLOGY
        assert registry.get_layer("SEMANTIC:AUTH:HIGH") == TagLayer.SEMANTIC
        assert registry.get_layer("STATE:REVIEWED") == TagLayer.STATE
        # Legacy flat tags (no colon) return None
        assert registry.get_layer("SOURCE_USER_INPUT") is None

    def test_registry_is_writable(self):
        """is_writable returns False for ONTOLOGY, True for others."""
        from codedmap.core.schema.tags import TagRegistry
        registry = TagRegistry()
        assert registry.is_writable("ONTOLOGY:SINK:SQL_INJECTION") is False
        assert registry.is_writable("SEMANTIC:AUTH:HIGH") is True
        assert registry.is_writable("STATE:REVIEWED") is True
        # Legacy tags are writable
        assert registry.is_writable("SOURCE_USER_INPUT") is True

    def test_registry_register(self):
        """register() accepts SEMANTIC, rejects ONTOLOGY."""
        from codedmap.core.schema.tags import TagRegistry, TagDefinition, TagLayer
        registry = TagRegistry()
        # Semantic registration succeeds
        sem_def = TagDefinition(
            layer=TagLayer.SEMANTIC,
            namespace="AUTH",
            name="PASSWORD_HASH",
        )
        registry.register(sem_def)  # Should not raise

        # Ontology registration fails
        ont_def = TagDefinition(
            layer=TagLayer.ONTOLOGY,
            namespace="SOURCE",
            name="CUSTOM_SOURCE",
        )
        with pytest.raises(ValueError):
            registry.register(ont_def)


# TAG-06: Tag string format
class TestTagStringFormat:
    def test_tag_string_format(self):
        """TagDefinition.full_tag produces LAYER:NAMESPACE:NAME strings valid for List[str]."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        td = TagDefinition(
            layer=TagLayer.ONTOLOGY,
            namespace="SINK",
            name="SQL_INJECTION",
        )
        tag_str = td.full_tag
        assert tag_str == "ONTOLOGY:SINK:SQL_INJECTION"
        assert isinstance(tag_str, str)
        # Valid for List[str] storage
        tags_list: list[str] = [tag_str]
        assert tags_list[0] == "ONTOLOGY:SINK:SQL_INJECTION"

    def test_tag_definition_frozen(self):
        """TagDefinition instances are immutable (frozen=True)."""
        from codedmap.core.schema.tags import TagDefinition, TagLayer
        td = TagDefinition(
            layer=TagLayer.ONTOLOGY,
            namespace="SINK",
            name="SQL_INJECTION",
        )
        with pytest.raises(Exception):  # ValidationError for frozen model
            td.name = "OTHER"


class TestSecurityTagMatcherRole:
    """SecurityTagMatcher ROLE methods."""

    def test_is_role_true(self):
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher
        assert SecurityTagMatcher.is_role("ONTOLOGY:ROLE:BOUNDARY") is True
        assert SecurityTagMatcher.is_role("ONTOLOGY:ROLE:KERNEL_CORE") is True

    def test_is_role_false(self):
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher
        assert SecurityTagMatcher.is_role("ONTOLOGY:SINK:MEMORY_WRITE") is False
        assert SecurityTagMatcher.is_role("SEMANTIC:ROLE:BOUNDARY") is False

    def test_get_role_category(self):
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher
        assert SecurityTagMatcher.get_role_category("ONTOLOGY:ROLE:BOUNDARY") == "BOUNDARY"
        assert SecurityTagMatcher.get_role_category("ONTOLOGY:ROLE:KERNEL_CORE") == "KERNEL_CORE"
        assert SecurityTagMatcher.get_role_category("ONTOLOGY:SINK:MEMORY_WRITE") is None

    def test_is_security_tag_excludes_role(self):
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:ROLE:BOUNDARY") is False
        assert SecurityTagMatcher.is_security_tag("ONTOLOGY:SINK:MEMORY_WRITE") is True
