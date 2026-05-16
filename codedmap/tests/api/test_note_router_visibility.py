import os
import sys
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.routers import note as note_router


def _make_note(
    note_id: int,
    title: str,
    *,
    scope: str,
    knowledge_class: str = "assessment",
    campaign_id: str | None = None,
):
    return SimpleNamespace(
        id=note_id,
        title=title,
        category="COORDINATION",
        source="agent",
        status="active",
        created_at=None,
        metadata={
            "scope": scope,
            "campaign_id": campaign_id,
            "knowledge_class": knowledge_class,
        },
    )


class _FakeInsights:
    def __init__(self, notes):
        self._notes = notes
        self.kwargs = None

    def find_all_insights(self, **kwargs):
        self.kwargs = kwargs
        return list(self._notes)


class _FakeQuery:
    def by_id(self, node_id):
        return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))


def _build_note_app(fake_store):
    app = FastAPI()
    app.include_router(note_router.router, prefix="/api/v1")
    app.dependency_overrides[note_router.get_store] = lambda: fake_store
    return app


def test_note_list_api_defaults_to_stable_confirmed_plus_current_campaign(monkeypatch):
    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    insights = _FakeInsights([
        _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now"),
        _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old"),
        _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact"),
        _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact"),
    ])
    fake_store = SimpleNamespace(insights=insights, query=_FakeQuery())

    app = _build_note_app(fake_store)

    with TestClient(app) as client:
        response = client.get("/api/v1/note/list")

    assert response.status_code == 200
    payload = response.json()
    notes = payload["result"]["content"]["notes"]
    assert [note["title"] for note in notes] == ["Current run", "Confirmed"]
    assert insights.kwargs["scope"] is None
    assert insights.kwargs["campaign_id"] is None
    assert insights.kwargs["knowledge_class"] is None


def test_note_list_api_preserves_explicit_filters(monkeypatch):
    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    insights = _FakeInsights([
        _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now"),
        _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old"),
    ])
    fake_store = SimpleNamespace(insights=insights, query=_FakeQuery())

    app = _build_note_app(fake_store)

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/note/list",
            params={
                "scope": "campaign",
                "campaign_id": "cmp_old",
                "knowledge_class": "assessment",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    notes = payload["result"]["content"]["notes"]
    assert [note["title"] for note in notes] == ["Old run"]
    assert insights.kwargs["scope"] == "campaign"
    assert insights.kwargs["campaign_id"] == "cmp_old"
    assert insights.kwargs["knowledge_class"] == "assessment"


def test_note_list_api_scope_all_returns_all_scopes(monkeypatch):
    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    insights = _FakeInsights([
        _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now"),
        _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old"),
        _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact"),
        _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact"),
    ])
    fake_store = SimpleNamespace(insights=insights, query=_FakeQuery())

    app = _build_note_app(fake_store)

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/note/list",
            params={"scope": "all"},
        )

    assert response.status_code == 200
    payload = response.json()
    notes = payload["result"]["content"]["notes"]
    assert [note["title"] for note in notes] == [
        "Current run",
        "Old run",
        "Candidate",
        "Confirmed",
    ]
    assert insights.kwargs["scope"] is None
    assert insights.kwargs["campaign_id"] is None
    assert insights.kwargs["knowledge_class"] is None
