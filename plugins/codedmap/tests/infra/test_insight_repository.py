"""Tests for InsightRepository title threading."""
import sys, os
sys.path.append(os.getcwd())
import pytest


def test_insight_node_requires_title():
    """InsightNode construction without title raises ValidationError."""
    from pydantic import ValidationError
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    with pytest.raises(ValidationError):
        InsightNode(category="VULNERABILITY", content="body", source="test")


def test_insight_node_rejects_long_title():
    """InsightNode rejects title > 120 chars."""
    from pydantic import ValidationError
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    with pytest.raises(ValidationError):
        InsightNode(category="VULNERABILITY", title="A" * 121, content="body", source="test")


def test_insight_node_accepts_valid_title():
    """InsightNode accepts title <= 120 chars."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="VULNERABILITY", title="Valid title", content="body", source="test")
    assert node.title == "Valid title"


def test_insight_summary_includes_title():
    """InsightSummary DTO includes title field."""
    from codedmap.app.query.models import InsightSummary
    s = InsightSummary(category="VULNERABILITY", title="Summary title", content="body")
    assert s.title == "Summary title"


def test_create_and_attach_has_title_no_name():
    """create_and_attach() has title param, no name param."""
    import inspect
    from codedmap.infra.storage.repository import InsightRepository
    sig = inspect.signature(InsightRepository.create_and_attach)
    assert "title" in sig.parameters, "missing title param"
    assert "name" not in sig.parameters, "name param should be removed"


def test_upsert_has_title():
    """upsert() has title param."""
    import inspect
    from codedmap.infra.storage.repository import InsightRepository
    sig = inspect.signature(InsightRepository.upsert)
    assert "title" in sig.parameters, "missing title param"


def test_set_summary_has_title():
    """CPG.set_summary() has title param."""
    import inspect
    from codedmap.app.query.root import CPG
    sig = inspect.signature(CPG.set_summary)
    assert "title" in sig.parameters, "missing title param"
