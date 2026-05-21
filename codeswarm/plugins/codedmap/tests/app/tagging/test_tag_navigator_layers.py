"""
Tests for TagNavigator._detect_layer() — layer detection for layered tags.

Covers requirement ENG-02: TagNavigator awareness of which layer a tag belongs to.
Pure prefix parsing, no TagRegistry dependency.
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock

from codedmap.analysis.tagging.navigator import TagNavigator
from codedmap.core.schema.tags.layer import TagLayer


@pytest.fixture
def navigator():
    """Create a TagNavigator with a mocked store."""
    store = MagicMock()
    return TagNavigator(store)


class TestDetectLayerOntology:
    """_detect_layer returns TagLayer.ONTOLOGY for ONTOLOGY-prefixed tags."""

    def test_ontology_sink(self, navigator):
        assert navigator._detect_layer("ONTOLOGY:SINK:SQL_INJECTION") == TagLayer.ONTOLOGY

    def test_ontology_source(self, navigator):
        assert navigator._detect_layer("ONTOLOGY:SOURCE:USER_INPUT") == TagLayer.ONTOLOGY


class TestDetectLayerSemantic:
    """_detect_layer returns TagLayer.SEMANTIC for SEMANTIC-prefixed tags."""

    def test_semantic_auth(self, navigator):
        assert navigator._detect_layer("SEMANTIC:AUTH:HIGH") == TagLayer.SEMANTIC

    def test_semantic_other(self, navigator):
        assert navigator._detect_layer("SEMANTIC:TAINT:PROPAGATED") == TagLayer.SEMANTIC


class TestDetectLayerState:
    """_detect_layer returns TagLayer.STATE for STATE-prefixed tags."""

    def test_state_reviewed(self, navigator):
        assert navigator._detect_layer("STATE:REVIEWED") == TagLayer.STATE

    def test_state_custom(self, navigator):
        assert navigator._detect_layer("STATE:CUSTOM:MY_TAG") == TagLayer.STATE


class TestDetectLayerLegacyFlat:
    """_detect_layer returns None for legacy flat tags (no valid layer prefix)."""

    def test_legacy_source(self, navigator):
        assert navigator._detect_layer("SOURCE_USER_INPUT") is None

    def test_legacy_custom(self, navigator):
        assert navigator._detect_layer("CUSTOM_TAG") is None


class TestDetectLayerEdgeCases:
    """_detect_layer returns None for invalid or empty inputs."""

    def test_invalid_layer_prefix(self, navigator):
        """Lowercase 'semantic' is not a valid layer enum value."""
        assert navigator._detect_layer("semantic_parent:foo") is None

    def test_empty_string(self, navigator):
        assert navigator._detect_layer("") is None

    def test_whitespace_handling(self, navigator):
        """Leading/trailing whitespace should be stripped before parsing."""
        assert navigator._detect_layer("  ONTOLOGY:SINK:XSS  ") == TagLayer.ONTOLOGY

    def test_colon_but_invalid_prefix(self, navigator):
        """A colon-separated tag with a non-layer prefix returns None."""
        assert navigator._detect_layer("FOOBAR:SOMETHING:ELSE") is None
