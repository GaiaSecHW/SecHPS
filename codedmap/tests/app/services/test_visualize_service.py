import os
import sys

import pytest

sys.path.append(os.getcwd())

from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.common import SemanticSignature
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType, Language
from codedmap.core.schema.graph.nodes import CallNode, FileNode, MethodNode
from codedmap.core.schema.matcher import MatchCandidate, MatchResult
from codedmap.core.schema.visualize import GraphLens, VisualizeRequest
from codedmap.infra.storage.store import CPGStore

from codedmap.app.services.visualize import VisualizeService, VisualizeServiceError


def _signature(name: str, file_path: str = "services/orders.py") -> SemanticSignature:
    return SemanticSignature(
        node_label="METHOD",
        name=name,
        file_path=file_path,
        content_hash=None,
    )


def _method(*, node_id: int, name: str, full_name: str, file_name: str, line_start: int, line_end: int) -> MethodNode:
    return MethodNode(
        id=node_id,
        name=name,
        fullName=full_name,
        fileName=file_name,
        lineNumber=line_start,
        lineNumberEnd=line_end,
        signature="()",
    )


def _build_call_graph_store(*, include_shared_entrypoint: bool = False) -> CPGStore:
    graph = CPGGraph()

    file_node = FileNode(
        id=10,
        name="services/orders.py",
        fullName="services/orders.py",
        language=Language.PYTHON,
    )
    entry = _method(
        node_id=101,
        name="orders.create",
        full_name="orders.create",
        file_name="services/orders.py",
        line_start=10,
        line_end=20,
    )
    validate = _method(
        node_id=102,
        name="orders.validate",
        full_name="orders.validate",
        file_name="services/orders.py",
        line_start=30,
        line_end=40,
    )
    risk = _method(
        node_id=103,
        name="risk.score",
        full_name="risk.score",
        file_name="services/risk.py",
        line_start=50,
        line_end=60,
    )

    graph.add_node(file_node)
    graph.add_node(entry)
    graph.add_node(validate)
    graph.add_node(risk)
    graph.add_edge(file_node, entry, EdgeType.CONTAINS)
    graph.add_edge(file_node, validate, EdgeType.CONTAINS)

    if include_shared_entrypoint:
        submit = _method(
            node_id=104,
            name="orders.submit",
            full_name="orders.submit",
            file_name="services/orders.py",
            line_start=70,
            line_end=80,
        )
        graph.add_node(submit)
        graph.add_edge(file_node, submit, EdgeType.CONTAINS)

    call_entry_validate = CallNode(
        id=201,
        name="orders.validate",
        methodFullName="orders.validate",
        fileName="services/orders.py",
        lineNumber=12,
        lineNumberEnd=12,
        order=1,
    )
    call_validate_risk = CallNode(
        id=202,
        name="risk.score",
        methodFullName="risk.score",
        fileName="services/orders.py",
        lineNumber=35,
        lineNumberEnd=35,
        order=1,
    )
    graph.add_node(call_entry_validate)
    graph.add_node(call_validate_risk)
    graph.add_edge(entry, call_entry_validate, EdgeType.AST)
    graph.add_edge(validate, call_validate_risk, EdgeType.AST)
    graph.add_call_edge(call_entry_validate, validate)
    graph.add_call_edge(call_validate_risk, risk)

    if include_shared_entrypoint:
        call_submit_validate = CallNode(
            id=203,
            name="orders.validate",
            methodFullName="orders.validate",
            fileName="services/orders.py",
            lineNumber=72,
            lineNumberEnd=72,
            order=1,
        )
        graph.add_node(call_submit_validate)
        submit = graph.get_node_by_id(104)
        graph.add_edge(submit, call_submit_validate, EdgeType.AST)
        graph.add_call_edge(call_submit_validate, validate)

    store = CPGStore(StorageConfig(backend="memory"))
    store.save(graph)
    return store


@pytest.fixture
def call_graph_store() -> CPGStore:
    return _build_call_graph_store()


class TestVisualizeService:
    def test_build_returns_call_graph_topology_for_physical_entry_node_ids(self, call_graph_store: CPGStore, monkeypatch):
        def _unexpected_matcher(**kwargs):
            raise AssertionError("run_matcher should not be called when entry_node_ids are provided")

        monkeypatch.setattr("codedmap.app.services.visualize.run_matcher", _unexpected_matcher)

        response = VisualizeService().build(
            store=call_graph_store,
            request=VisualizeRequest(
                entry_node_ids=["101"],
                depth=2,
                lens=GraphLens.CALL_GRAPH,
            ),
        )

        assert [node.id for node in response.nodes] == [
            "method:101",
            "method:102",
            "method:103",
        ]
        assert [edge.id for edge in response.edges] == [
            "edge:101:102:CALLS",
            "edge:102:103:CALLS",
        ]

    def test_build_accepts_large_string_entry_node_ids(self, call_graph_store: CPGStore, monkeypatch):
        original_get_node = call_graph_store.get_node

        def _fake_get_node(node_id: int):
            if node_id == 618303449376616600:
                return original_get_node(101)
            return original_get_node(node_id)

        monkeypatch.setattr(call_graph_store, "get_node", _fake_get_node)

        response = VisualizeService().build(
            store=call_graph_store,
            request=VisualizeRequest(
                entry_node_ids=["618303449376616600"],
                depth=1,
                lens=GraphLens.CALL_GRAPH,
            ),
        )

        assert [node.id for node in response.nodes] == ["method:101", "method:102"]

    def test_build_rejects_non_decimal_string_entry_node_ids(self, call_graph_store: CPGStore):
        with pytest.raises(VisualizeServiceError) as exc_info:
            VisualizeService().build(
                store=call_graph_store,
                request=VisualizeRequest(
                    entry_node_ids=["abc"],
                    depth=1,
                    lens=GraphLens.CALL_GRAPH,
                ),
            )

        assert exc_info.value.code == "INVALID_REQUEST"

    def test_build_returns_call_graph_topology_for_requested_entrypoints(self, call_graph_store: CPGStore):
        response = VisualizeService().build(
            store=call_graph_store,
            request=VisualizeRequest(
                entry_points=[_signature("orders.create")],
                depth=2,
                lens=GraphLens.CALL_GRAPH,
            ),
        )

        assert [node.id for node in response.nodes] == [
            "method:101",
            "method:102",
            "method:103",
        ]
        assert [edge.id for edge in response.edges] == [
            "edge:101:102:CALLS",
            "edge:102:103:CALLS",
        ]
        assert [edge.relation for edge in response.edges] == ["CALLS", "CALLS"]
        assert [(node.label, node.node_type) for node in response.nodes] == [
            ("orders.create", "METHOD"),
            ("orders.validate", "METHOD"),
            ("risk.score", "METHOD"),
        ]
        for node in response.nodes:
            assert node.tags == []
            assert node.notes_summary == []
            assert node.is_federation_gateway is False

    def test_build_limits_expansion_by_depth(self, call_graph_store: CPGStore):
        response = VisualizeService().build(
            store=call_graph_store,
            request=VisualizeRequest(
                entry_points=[_signature("orders.create")],
                depth=1,
                lens=GraphLens.CALL_GRAPH,
            ),
        )

        assert [node.id for node in response.nodes] == ["method:101", "method:102"]
        assert [edge.id for edge in response.edges] == ["edge:101:102:CALLS"]
        assert "method:103" not in [node.id for node in response.nodes]
        assert "edge:102:103:CALLS" not in [edge.id for edge in response.edges]

    def test_build_deduplicates_shared_nodes_and_edges(self):
        store = _build_call_graph_store(include_shared_entrypoint=True)

        response = VisualizeService().build(
            store=store,
            request=VisualizeRequest(
                entry_points=[_signature("orders.create"), _signature("orders.submit")],
                depth=2,
                lens=GraphLens.CALL_GRAPH,
            ),
        )

        node_ids = [node.id for node in response.nodes]
        edge_ids = [edge.id for edge in response.edges]

        assert node_ids.count("method:102") == 1
        assert edge_ids.count("edge:102:103:CALLS") == 1
        assert len(node_ids) == len(set(node_ids))
        assert len(edge_ids) == len(set(edge_ids))

    def test_build_rejects_unsupported_lens(self, call_graph_store: CPGStore):
        with pytest.raises(VisualizeServiceError) as exc_info:
            VisualizeService().build(
                store=call_graph_store,
                request=VisualizeRequest(
                    entry_points=[_signature("orders.create")],
                    depth=1,
                    lens=GraphLens.DATA_FLOW,
                ),
            )

        assert exc_info.value.code == "UNSUPPORTED_LENS"

    def test_build_rejects_requests_without_entry_selectors(self, call_graph_store: CPGStore):
        with pytest.raises(VisualizeServiceError) as exc_info:
            VisualizeService().build(
                store=call_graph_store,
                request=VisualizeRequest(
                    lens=GraphLens.CALL_GRAPH,
                ),
            )

        assert exc_info.value.code == "INVALID_REQUEST"

    @pytest.mark.parametrize(
        ("entry_points", "expected_status"),
        [
            ([_signature("orders.create"), _signature("orders.create")], "AMBIGUOUS"),
            ([_signature("orders.missing")], "ORPHANED"),
        ],
    )
    def test_build_rejects_ambiguous_or_missing_entrypoints(
        self,
        call_graph_store: CPGStore,
        entry_points: list[SemanticSignature],
        expected_status: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        if expected_status == "AMBIGUOUS":
            def _ambiguous_matcher(**kwargs):
                return MatchResult(
                    artifact_index=kwargs["artifact_index"],
                    tier="TIER_1B",
                    status="AMBIGUOUS",
                    matched_node_id=None,
                    confidence=0.9,
                    candidates=[
                        MatchCandidate(node_id=101, score=0.9, reason="name+path match"),
                        MatchCandidate(node_id=105, score=0.9, reason="name+path match"),
                    ],
                    diagnostics=["TIER_1B (name+path, no hash): 2 hits"],
                )

            monkeypatch.setattr("codedmap.app.services.visualize.run_matcher", _ambiguous_matcher)

        with pytest.raises(VisualizeServiceError) as exc_info:
            VisualizeService().build(
                store=call_graph_store,
                request=VisualizeRequest(
                    entry_points=entry_points,
                    depth=1,
                    lens=GraphLens.CALL_GRAPH,
                ),
            )

        assert exc_info.value.code == "ENTRYPOINT_RESOLUTION_FAILED"
        assert exc_info.value.details["status"] == expected_status
