"""
Tests for CPG.tag_registry() DSL method.

Covers requirement DSL-01: Agents can discover the CPG tag vocabulary
programmatically via cpg.tag_registry().
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock

from codedmap.app.query.root import CPG
from codedmap.core.schema.tags.layer import TagLayer
from codedmap.core.schema.tags.definition import TagDefinition


@pytest.fixture
def mock_store():
    """Create a minimal mock CPGStore."""
    return MagicMock()


@pytest.fixture
def cpg(mock_store):
    """Create a CPG instance with a mock store."""
    return CPG(mock_store)


class TestTagRegistryReturnType:
    """tag_registry() returns a list of TagDefinition objects."""

    def test_returns_list(self, cpg):
        result = cpg.tag_registry()
        assert isinstance(result, list)

    def test_returns_non_empty(self, cpg):
        result = cpg.tag_registry()
        assert len(result) > 0

    def test_items_are_tag_definitions(self, cpg):
        result = cpg.tag_registry()
        for item in result:
            assert isinstance(item, TagDefinition)


class TestTagRegistryContent:
    """tag_registry() returns L1 ontology with expected structure."""

    def test_all_items_ontology_layer(self, cpg):
        """All items from list_ontology have layer == ONTOLOGY."""
        result = cpg.tag_registry()
        for item in result:
            assert item.layer == TagLayer.ONTOLOGY

    def test_includes_sink_namespace(self, cpg):
        """At least one item has namespace containing 'SINK'."""
        result = cpg.tag_registry()
        namespaces = {item.namespace for item in result}
        assert "SINK" in namespaces

    def test_includes_source_namespace(self, cpg):
        """At least one item has namespace containing 'SOURCE'."""
        result = cpg.tag_registry()
        namespaces = {item.namespace for item in result}
        assert "SOURCE" in namespaces

    def test_full_tag_starts_with_ontology(self, cpg):
        """Each item's full_tag starts with 'ONTOLOGY:'."""
        result = cpg.tag_registry()
        for item in result:
            assert item.full_tag.startswith("ONTOLOGY:")


class TestTagRegistryFields:
    """Each TagDefinition has required fields."""

    def test_has_layer_namespace_name(self, cpg):
        result = cpg.tag_registry()
        for item in result:
            assert hasattr(item, "layer")
            assert hasattr(item, "namespace")
            assert hasattr(item, "name")
            assert hasattr(item, "full_tag")
            assert hasattr(item, "description")

    def test_model_dump_succeeds(self, cpg):
        """TagDefinition is a Pydantic model with model_dump()."""
        result = cpg.tag_registry()
        dumped = result[0].model_dump()
        assert isinstance(dumped, dict)
        assert "layer" in dumped
        assert "namespace" in dumped
        assert "name" in dumped


class TestTagRegistryIdempotent:
    """Calling tag_registry() twice returns same data."""

    def test_consistent_results(self, cpg):
        result1 = cpg.tag_registry()
        result2 = cpg.tag_registry()
        # Same length
        assert len(result1) == len(result2)
        # Same full_tag values
        tags1 = {item.full_tag for item in result1}
        tags2 = {item.full_tag for item in result2}
        assert tags1 == tags2
