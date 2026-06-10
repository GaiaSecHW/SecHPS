"""
Tests for list_tags push-down (TAG-04) and DSL routing through TagEngine (TAG-05).

Covers:
- Empty store returns empty list
- All tags returned sorted
- Prefix filtering
- Case-insensitive prefix matching
- CPG.list_tags() routes through TagEngine.list_all_tags()
"""

import pytest
from unittest.mock import patch

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph import CPGGraph


def _make_store():
    return CPGStore(StorageConfig(backend="memory"))


def _graph_with_nodes(nodes):
    graph = CPGGraph()
    for node in nodes:
        graph.add_node(node)
    return graph


class TestListTagsMemoryDriver:

    def setup_method(self):
        self.store = _make_store()

    def teardown_method(self):
        self.store.close()

    def test_list_tags_empty_returns_empty(self):
        assert self.store.tags.list_all() == []

    def test_list_tags_returns_all_tags_sorted(self):
        n1 = MethodNode(
            id=100, name="handler", fullName="app.handler",
            signature="def handler()", label=NodeLabel.METHOD,
            isExternal=False, tags=["SINK", "HTTP_HANDLER"],
        )
        n2 = MethodNode(
            id=101, name="reader", fullName="app.reader",
            signature="def reader()", label=NodeLabel.METHOD,
            isExternal=False, tags=["SOURCE", "SINK"],
        )
        self.store._engine.writer.save_graph(_graph_with_nodes([n1, n2]))
        result = self.store.tags.list_all()
        assert result == sorted({"SINK", "HTTP_HANDLER", "SOURCE"})

    def test_list_tags_with_prefix_filters(self):
        n1 = MethodNode(
            id=200, name="check", fullName="app.check",
            signature="def check()", label=NodeLabel.METHOD,
            isExternal=False,
            tags=["SECURITY_SINK", "HTTP_HANDLER", "SECURITY_SOURCE"],
        )
        self.store._engine.writer.save_graph(_graph_with_nodes([n1]))
        result = self.store.tags.list_all(prefix="SECURITY")
        assert "SECURITY_SINK" in result
        assert "SECURITY_SOURCE" in result
        assert "HTTP_HANDLER" not in result

    def test_list_tags_prefix_case_insensitive(self):
        n1 = MethodNode(
            id=300, name="validate", fullName="app.validate",
            signature="def validate()", label=NodeLabel.METHOD,
            isExternal=False,
            tags=["SECURITY_SINK", "HTTP_HANDLER", "SECURITY_SOURCE"],
        )
        self.store._engine.writer.save_graph(_graph_with_nodes([n1]))
        upper_result = self.store.tags.list_all(prefix="SECURITY")
        lower_result = self.store.tags.list_all(prefix="security")
        assert upper_result == lower_result


class TestCPGListTagsRoutesThroughTagEngine:

    def setup_method(self):
        self.store = _make_store()

    def teardown_method(self):
        self.store.close()

    def test_cpg_list_tags_calls_tagger_list_all_tags(self):
        from codedmap.app.query.root import CPG
        cpg = CPG(self.store)
        with patch.object(cpg.tagger, "list_all_tags", return_value=["FOO"]) as mock:
            result = cpg.list_tags(prefix="F")
            mock.assert_called_once_with(prefix="F")
            assert result == ["FOO"]

    def test_cpg_list_tags_no_prefix(self):
        from codedmap.app.query.root import CPG
        cpg = CPG(self.store)
        with patch.object(cpg.tagger, "list_all_tags", return_value=["A", "B"]) as mock:
            result = cpg.list_tags()
            mock.assert_called_once_with(prefix=None)
            assert result == ["A", "B"]