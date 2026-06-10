import os
import sys

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.app import create_app
from codedmap.core.schema.visualize import VisEdge, VisNode, VisualizeResponse
from codedmap.app.services.visualize import VisualizeServiceError


def _make_request_payload():
    return {
        "entry_node_ids": ["101"],
        "lens": "CALL_GRAPH",
    }


class _DummyContextManager:
    def __init__(self, store):
        self._store = store

    def __enter__(self):
        return self._store

    def __exit__(self, exc_type, exc, tb):
        return False


class TestVisualizeRouter:
    def test_app_registers_visualize_route(self):
        app = create_app(db_path=":memory:", backend="memory")

        routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

        assert ("/api/v1/graph/visualize", ("POST",)) in routes

    def test_app_registers_job_visualize_route(self):
        app = create_app(db_path=":memory:", backend="memory")

        routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

        assert ("/api/v1/jobs/{job_id}/graph/visualize", ("POST",)) in routes

    def test_visualize_route_returns_bare_contract_shape(self, monkeypatch):
        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            lambda self, *, store, request: VisualizeResponse(
                nodes=[
                    VisNode(
                        id="method:101",
                        label="orders.create",
                        node_type="METHOD",
                        file_path="services/orders.py",
                        line_start=10,
                        line_end=20,
                    )
                ],
                edges=[],
            ),
        )
        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post("/api/v1/graph/visualize", json=_make_request_payload())

        assert response.status_code == 200

        payload = response.json()

        assert set(payload.keys()) == {"nodes", "edges"}
        assert "command" not in payload
        assert "result" not in payload
        assert "metadata" not in payload
        assert "success" not in payload
        assert "error" not in payload
        assert "schema_version" not in payload

    def test_visualize_route_keeps_using_primary_store(self, monkeypatch):
        captured = {}

        def _fake_build(self, *, store, request):
            captured["store"] = store
            return VisualizeResponse(nodes=[], edges=[])

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _fake_build,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post("/api/v1/graph/visualize", json=_make_request_payload())

        assert response.status_code == 200
        assert response.json() == {"nodes": [], "edges": []}
        assert captured["store"] is not None

    def test_visualize_route_delegates_to_visualize_service(self, monkeypatch):
        captured = {}

        def _fake_build(self, *, store, request):
            captured["store"] = store
            captured["request"] = request
            return VisualizeResponse(nodes=[], edges=[])

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _fake_build,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post("/api/v1/graph/visualize", json=_make_request_payload())

        assert response.status_code == 200
        assert response.json() == {"nodes": [], "edges": []}
        assert captured["store"] is not None
        assert captured["request"].lens.value == "CALL_GRAPH"
        assert captured["request"].entry_node_ids == ["101"]

    def test_visualize_route_accepts_semantic_signature_fallback(self, monkeypatch):
        captured = {}

        def _fake_build(self, *, store, request):
            captured["request"] = request
            return VisualizeResponse(nodes=[], edges=[])

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _fake_build,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/graph/visualize",
                json={
                    "entry_points": [
                        {
                            "node_label": "METHOD",
                            "name": "orders.create",
                            "file_path": "services/orders.py",
                        }
                    ],
                    "lens": "CALL_GRAPH",
                },
            )

        assert response.status_code == 200
        assert captured["request"].entry_points[0].name == "orders.create"

    def test_job_visualize_route_returns_bare_contract_shape(self, monkeypatch):
        selected_store = object()

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            lambda job_id: _DummyContextManager(selected_store),
            raising=False,
        )
        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            lambda self, *, store, request: VisualizeResponse(nodes=[], edges=[]),
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/jobs/job-123/graph/visualize",
                json=_make_request_payload(),
            )

        assert response.status_code == 200
        assert response.json() == {"nodes": [], "edges": []}

    def test_job_visualize_route_uses_selected_job_store(self, monkeypatch):
        captured = {}
        selected_store = object()

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            lambda job_id: captured.update(job_id=job_id) or _DummyContextManager(selected_store),
            raising=False,
        )

        def _fake_build(self, *, store, request):
            captured["store"] = store
            captured["request"] = request
            return VisualizeResponse(nodes=[], edges=[])

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _fake_build,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/jobs/job-123/graph/visualize",
                json=_make_request_payload(),
            )

        assert response.status_code == 200
        assert response.json() == {"nodes": [], "edges": []}
        assert captured["job_id"] == "job-123"
        assert captured["store"] is selected_store
        assert captured["request"].entry_node_ids == ["101"]
        assert captured["request"].lens.value == "CALL_GRAPH"

    def test_job_visualize_route_returns_http_exception_from_store_selection(self, monkeypatch):
        def _raise_missing_job(job_id):
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            _raise_missing_job,
            raising=False,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/jobs/missing/graph/visualize",
                json=_make_request_payload(),
            )

        assert response.status_code == 404
        assert response.json() == {"detail": "Job 'missing' not found"}

    def test_visualize_route_returns_400_when_no_entry_selector_is_provided(self, monkeypatch):
        def _raise_invalid_request(self, *, store, request):
            raise VisualizeServiceError(
                code="INVALID_REQUEST",
                message="Visualization request must provide entry_node_ids or entry_points.",
            )

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _raise_invalid_request,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/graph/visualize",
                json={"lens": "CALL_GRAPH"},
            )

        assert response.status_code == 400
        assert response.json() == {
            "detail": "Visualization request must provide entry_node_ids or entry_points."
        }

    def test_visualize_route_returns_400_for_non_decimal_string_entry_node_ids(self, monkeypatch):
        def _raise_invalid_request(self, *, store, request):
            raise VisualizeServiceError(
                code="INVALID_REQUEST",
                message="Visualization entry_node_ids must be decimal string node IDs.",
            )

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _raise_invalid_request,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/graph/visualize",
                json={"entry_node_ids": ["abc"], "lens": "CALL_GRAPH"},
            )

        assert response.status_code == 400
        assert response.json() == {
            "detail": "Visualization entry_node_ids must be decimal string node IDs."
        }

    def test_visualize_route_returns_501_for_unsupported_lens(self, monkeypatch):
        def _raise_unsupported(self, *, store, request):
            raise VisualizeServiceError(
                code="UNSUPPORTED_LENS",
                message="Visualization lens 'DATA_FLOW' is not implemented; only CALL_GRAPH is supported.",
            )

        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            _raise_unsupported,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/graph/visualize",
                json={**_make_request_payload(), "lens": "DATA_FLOW"},
            )

        assert response.status_code == 501
        assert response.json() == {
            "detail": "Visualization lens 'DATA_FLOW' is not implemented; only CALL_GRAPH is supported."
        }

    def test_visualize_route_returns_bare_visualize_response_unchanged(self, monkeypatch):
        expected = VisualizeResponse(
            nodes=[
                VisNode(
                    id="method:101",
                    label="orders.create",
                    node_type="METHOD",
                    file_path="services/orders.py",
                    line_start=10,
                    line_end=20,
                ),
                VisNode(
                    id="method:102",
                    label="orders.validate",
                    node_type="METHOD",
                    file_path="services/orders.py",
                    line_start=30,
                    line_end=40,
                ),
            ],
            edges=[
                VisEdge(
                    id="edge:101:102:CALLS",
                    source="method:101",
                    target="method:102",
                    relation="CALLS",
                )
            ],
        )
        monkeypatch.setattr(
            "codedmap.app.services.visualize.VisualizeService.build",
            lambda self, *, store, request: expected,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.post("/api/v1/graph/visualize", json=_make_request_payload())

        assert response.status_code == 200
        assert response.json() == expected.model_dump(mode="json")
