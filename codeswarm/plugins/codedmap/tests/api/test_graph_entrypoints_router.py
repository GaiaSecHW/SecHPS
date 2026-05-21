import os
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.app import create_app


class _DummyContextManager:
    def __init__(self, store):
        self._store = store

    def __enter__(self):
        return self._store

    def __exit__(self, exc_type, exc, tb):
        return False


class TestGraphEntrypointsRouter:
    def test_app_registers_graph_entrypoints_route(self):
        app = create_app(db_path=":memory:", backend="memory")

        routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

        assert ("/api/v1/graph/entrypoints", ("GET",)) in routes

    def test_app_registers_job_graph_entrypoints_route(self):
        app = create_app(db_path=":memory:", backend="memory")

        routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

        assert ("/api/v1/jobs/{job_id}/graph/entrypoints", ("GET",)) in routes

    def test_graph_entrypoints_returns_flat_bare_array(self, monkeypatch):
        def _fake_list_entrypoints(**kwargs):
            return {
                "nodes": [
                    {
                        "id": 4892,
                        "name": "main",
                        "full_name": "main<duplicate>0",
                        "label": "METHOD",
                        "file": "src/cmd/isulad-shim/main.c",
                    }
                ]
            }

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/graph/entrypoints")

        assert response.status_code == 200
        payload = response.json()

        assert isinstance(payload, list)
        assert payload == [
            {
                "id": "4892",
                "name": "main",
                "node_label": "METHOD",
                "file_path": "src/cmd/isulad-shim/main.c",
                "full_name": "main<duplicate>0",
            }
        ]

    def test_graph_entrypoints_forwards_query_params_to_shared_service(self, monkeypatch):
        captured = {}

        def _fake_list_entrypoints(**kwargs):
            captured.update(kwargs)
            return {"nodes": []}

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get(
                "/api/v1/graph/entrypoints",
                params={
                    "level": "L1",
                    "category": "HTTP",
                    "type": "route_handler",
                    "limit": 25,
                    "offset": 5,
                    "module": "gateway",
                    "module_id": 42,
                },
            )

        assert response.status_code == 200
        assert response.json() == []
        assert captured["level"] == "L1"
        assert captured["category"] == "HTTP"
        assert captured["entry_type"] == "route_handler"
        assert captured["limit"] == 25
        assert captured["offset"] == 5
        assert captured["module"] == "gateway"
        assert captured["module_id"] == 42
        assert captured["file_filter"] is None
        assert captured["show_all"] is False

    def test_graph_entrypoints_route_keeps_using_primary_store(self, monkeypatch):
        captured = {}

        def _fake_list_entrypoints(**kwargs):
            captured["store"] = kwargs["store"]
            return {"nodes": []}

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/graph/entrypoints")

        assert response.status_code == 200
        assert response.json() == []
        assert captured["store"] is not None

    def test_job_graph_entrypoints_reads_from_selected_job_store(self, monkeypatch):
        captured = {}
        selected_store = object()

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            lambda job_id: captured.update(job_id=job_id) or _DummyContextManager(selected_store),
            raising=False,
        )

        def _fake_list_entrypoints(**kwargs):
            captured["store"] = kwargs["store"]
            return {"nodes": []}

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/jobs/job-123/graph/entrypoints")

        assert response.status_code == 200
        assert response.json() == []
        assert captured["job_id"] == "job-123"
        assert captured["store"] is selected_store

    def test_job_graph_entrypoints_forwards_query_params_to_shared_service(self, monkeypatch):
        captured = {}
        selected_store = object()

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            lambda job_id: _DummyContextManager(selected_store),
            raising=False,
        )

        def _fake_list_entrypoints(**kwargs):
            captured.update(kwargs)
            return {"nodes": []}

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get(
                "/api/v1/jobs/job-123/graph/entrypoints",
                params={
                    "level": "L1",
                    "category": "HTTP",
                    "type": "route_handler",
                    "limit": 25,
                    "offset": 5,
                    "module": "gateway",
                    "module_id": 42,
                },
            )

        assert response.status_code == 200
        assert response.json() == []
        assert captured["store"] is selected_store
        assert captured["level"] == "L1"
        assert captured["category"] == "HTTP"
        assert captured["entry_type"] == "route_handler"
        assert captured["limit"] == 25
        assert captured["offset"] == 5
        assert captured["module"] == "gateway"
        assert captured["module_id"] == 42
        assert captured["file_filter"] is None
        assert captured["show_all"] is False

    def test_job_graph_entrypoints_returns_http_exception_from_store_selection(self, monkeypatch):
        def _raise_missing_job(job_id):
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

        monkeypatch.setattr(
            "codedmap.api.routers.visualize.open_job_graph_store",
            _raise_missing_job,
            raising=False,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/jobs/missing/graph/entrypoints")

        assert response.status_code == 404
        assert response.json() == {"detail": "Job 'missing' not found"}

    def test_graph_entrypoints_returns_http_500_when_service_fails(self, monkeypatch):
        def _fake_list_entrypoints(**kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr(
            "codedmap.app.services.query_services.list_entrypoints",
            _fake_list_entrypoints,
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/graph/entrypoints")

        assert response.status_code == 500
        assert response.json() == {"detail": "Failed to fetch graph entrypoints: boom"}
