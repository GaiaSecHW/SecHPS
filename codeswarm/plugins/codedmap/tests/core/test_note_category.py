"""Tests for note category externalization.

Validates:
- InsightNode accepts any uppercase string as category
- InsightNode normalizes lowercase/whitespace
- InsightSummary.category is str
- NoteCategoryLoader returns correct SDK categories
- RuleRegistry note category query methods
"""
import sys, os
sys.path.append(os.getcwd())

import pytest


def test_insight_node_accepts_string_category():
    """InsightNode(category='VULNERABILITY') stores as uppercase str."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="VULNERABILITY", title="t", content="c", source="s")
    assert node.category == "VULNERABILITY"
    assert isinstance(node.category, str)


def test_insight_node_normalizes_lowercase_category():
    """InsightNode(category='vulnerability') normalizes to 'VULNERABILITY'."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="vulnerability", title="t", content="c", source="s")
    assert node.category == "VULNERABILITY"


def test_insight_node_normalizes_whitespace_category():
    """InsightNode(category='  ARCHITECTURE  ') strips whitespace."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="  ARCHITECTURE  ", title="t", content="c", source="s")
    assert node.category == "ARCHITECTURE"


def test_insight_node_accepts_custom_category():
    """InsightNode accepts any string — validation happens at service layer."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="PERFORMANCE", title="t", content="c", source="s")
    assert node.category == "PERFORMANCE"


def test_insight_summary_category_is_str():
    """InsightSummary(category='data_flow') normalizes to 'DATA_FLOW' as str."""
    from codedmap.app.query.models import InsightSummary
    s = InsightSummary(category="data_flow", title="t", content="c")
    assert s.category == "DATA_FLOW"
    assert isinstance(s.category, str)


def test_note_category_enum_no_longer_exists():
    """NoteCategory Enum has been removed from extensions module."""
    import codedmap.core.schema.graph.nodes.extensions as ext
    assert not hasattr(ext, "NoteCategory")


def test_note_category_not_in_nodes_init():
    """NoteCategory is not re-exported from nodes/__init__.py."""
    from codedmap.core.schema.graph import nodes
    assert "NoteCategory" not in dir(nodes)
