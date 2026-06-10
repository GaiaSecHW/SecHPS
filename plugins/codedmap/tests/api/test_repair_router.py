import asyncio
import os
import sys
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.routers import repair as repair_router
from codedmap.core.schema.graph.enums import NodeLabel


class _FakeTraversal:
    def __init__(self, nodes):
        self._nodes = nodes

    def to_list(self):
        return list(self._nodes)


class _FakeQuery:
    def __init__(self, method_nodes, call_nodes=None):
        self._method_nodes = method_nodes
        # call_nodes kept for backward compat but no longer used by router
        self._call_nodes = call_nodes or []

    def all_nodes(self, label):
        value = getattr(label, "value", label)
        if value == NodeLabel.METHOD.value:
            return _FakeTraversal(self._method_nodes)
        if value == NodeLabel.CALL.value:
            return _FakeTraversal(self._call_nodes)
        return _FakeTraversal([])


def _build_app(fake_store):
    app = FastAPI()
    app.include_router(repair_router.router)
    app.dependency_overrides[repair_router.get_store] = lambda: fake_store
    app.dependency_overrides[repair_router.get_store_lock] = lambda: asyncio.Lock()
    return app


def test_repair_link_accepts_function_names_and_resolves_to_ids(monkeypatch):
    captured = {}

    def _fake_repair_link(*, store, from_id, to_id, reason, note, created_by):
        captured.update(
            store=store,
            from_id=from_id,
            to_id=to_id,
            reason=reason,
            note=note,
            created_by=created_by,
        )
        return {"from": from_id, "to": to_id, "repair_id": "R001"}

    monkeypatch.setattr("codedmap.app.services.domain_services.repair_link", _fake_repair_link)

    fake_store = SimpleNamespace(
        query=_FakeQuery(
            method_nodes=[
                SimpleNamespace(id=101, name="read_file", full_name="read_file"),
                SimpleNamespace(id=202, name="png_image_begin_read_from_memory", full_name="png_image_begin_read_from_memory"),
            ],
        )
    )
    app = _build_app(fake_store)

    with TestClient(app) as client:
        response = client.post(
            "/repair/link",
            headers={"X-Agent-ID": "repair-test"},
            json={
                "from_function": "read_file",
                "to_function": "png_image_begin_read_from_memory",
                "reason": "callback",
            },
        )

    assert response.status_code == 200
    assert captured["store"] is fake_store
    assert captured["from_id"] == 101
    assert captured["to_id"] == 202
    assert captured["reason"] == "callback"
    assert captured["note"] is None
    assert captured["created_by"] == "repair-test@repair:link"


def test_repair_link_rejects_legacy_id_contract():
    fake_store = SimpleNamespace(query=_FakeQuery(method_nodes=[]))
    app = _build_app(fake_store)

    with TestClient(app) as client:
        response = client.post(
            "/repair/link",
            headers={"X-Agent-ID": "repair-test"},
            json={
                "from_id": 301,
                "to_id": 302,
                "reason": "other",
            },
        )

    assert response.status_code == 422


def test_repair_link_uses_full_name_to_disambiguate(monkeypatch):
    captured = {}

    def _fake_repair_link(*, store, from_id, to_id, reason, note, created_by):
        captured.update(from_id=from_id, to_id=to_id)
        return {"from": from_id, "to": to_id, "repair_id": "R003"}

    monkeypatch.setattr("codedmap.app.services.domain_services.repair_link", _fake_repair_link)

    fake_store = SimpleNamespace(
        query=_FakeQuery(
            method_nodes=[
                SimpleNamespace(id=101, name="read_file", full_name="read_file", file_name="tests/a.c"),
                SimpleNamespace(id=102, name="read_file", full_name="read_file", file_name="tests/b.c"),
                SimpleNamespace(id=201, name="parse_png", full_name="libpng::parse_png", file_name="png.c"),
                SimpleNamespace(id=202, name="parse_png", full_name="demo::parse_png", file_name="demo.c"),
            ],
        )
    )
    app = _build_app(fake_store)

    with TestClient(app) as client:
        response = client.post(
            "/repair/link",
            headers={"X-Agent-ID": "repair-test"},
            json={
                "from_function": "read_file",
                "from_file": "tests/b.c",
                "to_function": "parse_png",
                "to_full_name": "libpng::parse_png",
                "reason": "vtable",
            },
        )

    assert response.status_code == 200
    assert captured["from_id"] == 102
    assert captured["to_id"] == 201


def test_repair_link_reports_ambiguous_function_without_disambiguators():
    fake_store = SimpleNamespace(
        query=_FakeQuery(
            method_nodes=[
                SimpleNamespace(id=101, name="read_file", full_name="read_file", file_name="tests/a.c"),
                SimpleNamespace(id=102, name="read_file", full_name="read_file", file_name="tests/b.c"),
                SimpleNamespace(id=201, name="parse_png", full_name="libpng::parse_png", file_name="png.c"),
            ],
        )
    )
    app = _build_app(fake_store)

    with TestClient(app) as client:
        response = client.post(
            "/repair/link",
            headers={"X-Agent-ID": "repair-test"},
            json={
                "from_function": "read_file",
                "to_function": "parse_png",
                "reason": "function_pointer",
            },
        )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "INVALID_ARGUMENT"
    assert "Ambiguous METHOD node for caller" in payload["error"]["message"]


def test_repair_link_rejects_invalid_reason_before_calling_service(monkeypatch):
    """Invalid `reason` values must fail at the FastAPI boundary so the
    service (and therefore the graph) never sees the request.

    Previously the service accepted an arbitrary string, constructed the
    CALL edge via `store.apply_patch`, and only then failed pydantic
    validation while building the repair record — leaving a dangling
    unremovable edge behind. This test guards that invariant.
    """

    calls = {"count": 0}

    def _should_not_run(**_kwargs):
        calls["count"] += 1
        raise AssertionError("service must not be invoked for invalid reason")

    monkeypatch.setattr(
        "codedmap.app.services.domain_services.repair_link", _should_not_run
    )

    fake_store = SimpleNamespace(
        query=_FakeQuery(
            method_nodes=[
                SimpleNamespace(id=101, name="read_file", full_name="read_file"),
                SimpleNamespace(id=202, name="parse", full_name="parse"),
            ],
        )
    )
    app = _build_app(fake_store)

    with TestClient(app) as client:
        response = client.post(
            "/repair/link",
            headers={"X-Agent-ID": "repair-test"},
            json={
                "from_function": "read_file",
                "to_function": "parse",
                "reason": "totally-made-up-reason",
            },
        )

    assert response.status_code == 422
    assert calls["count"] == 0


def test_repair_link_service_raises_on_invalid_reason_without_mutating_store():
    """Direct service-level guard: even if a caller bypasses the router,
    `repair_link` refuses to touch the store for an invalid reason.
    """
    from codedmap.app.services.domain_services import repair_link

    patches = []

    class _RecordingStore:
        def get_node(self, node_id):
            return SimpleNamespace(
                id=node_id,
                name=f"n{node_id}",
                full_name=f"n{node_id}",
                file_name="x.c",
                line_number=1,
                label=NodeLabel.METHOD,
            )

        def get_neighbors(self, *args, **kwargs):
            return []

        def apply_patch(self, patch):
            patches.append(patch)

    store = _RecordingStore()
    try:
        repair_link(store=store, from_id=1, to_id=2, reason="nonsense")
    except ValueError as exc:
        assert "Invalid repair reason" in str(exc)
    else:
        raise AssertionError("expected ValueError for invalid reason")

    assert patches == []
