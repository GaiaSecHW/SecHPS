"""Ambiguous trace endpoint behavior through query service boundary."""

from unittest.mock import MagicMock

import pytest

from codedmap.app.services.query_services import _resolve_reachable_endpoint, QueryServiceError


def _make_mock_node(node_id, name="test", file_name="test.c", line_number=1, label="METHOD"):
    node = MagicMock()
    node.id = node_id
    node.name = name
    node.file_name = file_name
    node.fileName = file_name
    node.line_number = line_number
    node.lineNumber = line_number
    node.label = MagicMock(value=label)
    return node


def test_ambiguous_function_raises_query_service_error():
    store = MagicMock()
    resolver = MagicMock()
    resolver.resolve_function.return_value = [
        _make_mock_node(1, name="main", file_name="a.c"),
        _make_mock_node(2, name="main", file_name="b.c"),
    ]

    with pytest.raises(QueryServiceError) as exc:
        _resolve_reachable_endpoint(store, resolver, "main", None, "source")

    assert exc.value.code == "AMBIGUOUS_TARGET"
    assert exc.value.details["query"] == "main"
    assert len(exc.value.details["candidates"]) == 2


def test_single_match_returns_node():
    store = MagicMock()
    resolver = MagicMock()
    node = _make_mock_node(42, name="only_one")
    resolver.resolve_function.return_value = [node]

    resolved = _resolve_reachable_endpoint(store, resolver, "only_one", None, "source")
    assert resolved.id == 42


def test_missing_endpoint_raises_not_found():
    store = MagicMock()
    resolver = MagicMock()
    resolver.resolve_function.return_value = []

    with pytest.raises(QueryServiceError) as exc:
        _resolve_reachable_endpoint(store, resolver, "missing", None, "source")
    assert exc.value.code == "NODE_NOT_FOUND"
