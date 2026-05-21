from __future__ import annotations

from types import SimpleNamespace


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


def test_note_add_returns_metadata_scope_fields(monkeypatch):
    from codedmap.app.services.domain import note as note_domain

    captured: dict = {}

    class DummySummary:
        def model_dump(self, mode="json"):
            assert mode == "json"
            return {"id": 1, "metadata": captured["kwargs"]["metadata"]}

    class DummyCPG:
        def __init__(self, store):
            self.store = store

        def set_summary(self, **kwargs):
            captured["kwargs"] = kwargs
            return DummySummary()

    monkeypatch.setattr("codedmap.app.query.root.CPG", DummyCPG)

    result = note_domain.note_add(
        store=object(),
        title="Boundary finding",
        content="{}",
        scope="campaign",
        knowledge_class="assessment",
        campaign_id="cmp_123",
    )

    assert result["metadata"]["scope"] == "campaign"
    assert result["metadata"]["knowledge_class"] == "assessment"
    assert result["metadata"]["campaign_id"] == "cmp_123"


def test_note_list_filters_by_scope_and_campaign_id():
    from codedmap.app.services.domain import note as note_domain

    campaign_note = SimpleNamespace(
        id=1,
        title="Current run",
        category="COORDINATION",
        source="agent",
        status="active",
        created_at=None,
        metadata={"scope": "campaign", "campaign_id": "cmp_now", "knowledge_class": "assessment"},
    )
    old_campaign_note = SimpleNamespace(
        id=2,
        title="Old run",
        category="COORDINATION",
        source="agent",
        status="active",
        created_at=None,
        metadata={"scope": "campaign", "campaign_id": "cmp_old", "knowledge_class": "assessment"},
    )
    stable_note = SimpleNamespace(
        id=3,
        title="Stable note",
        category="ARCHITECTURE",
        source="agent",
        status="active",
        created_at=None,
        metadata={"scope": "stable_confirmed", "knowledge_class": "fact"},
    )

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [campaign_note, old_campaign_note, stable_note]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = note_domain.note_list(
        fake_store,
        scope="campaign",
        campaign_id="cmp_now",
        knowledge_class="assessment",
    )

    assert [note["title"] for note in result["notes"]] == ["Current run"]
    assert fake_store.insights.kwargs["scope"] == "campaign"
    assert fake_store.insights.kwargs["campaign_id"] == "cmp_now"
    assert fake_store.insights.kwargs["knowledge_class"] == "assessment"


def test_note_list_defaults_to_stable_confirmed_plus_current_campaign(monkeypatch):
    from codedmap.app.services.domain import note as note_domain

    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    current_campaign_note = _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now")
    old_campaign_note = _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old")
    stable_candidate_note = _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact")
    stable_confirmed_note = _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact")

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [
                current_campaign_note,
                old_campaign_note,
                stable_candidate_note,
                stable_confirmed_note,
            ]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = note_domain.note_list(fake_store)

    assert [note["title"] for note in result["notes"]] == ["Current run", "Confirmed"]
    assert fake_store.insights.kwargs["scope"] is None
    assert fake_store.insights.kwargs["campaign_id"] is None
    assert fake_store.insights.kwargs["knowledge_class"] is None


def test_note_list_scope_all_returns_all_scopes(monkeypatch):
    from codedmap.app.services.domain import note as note_domain

    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    current_campaign_note = _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now")
    old_campaign_note = _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old")
    stable_candidate_note = _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact")
    stable_confirmed_note = _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact")

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [
                current_campaign_note,
                old_campaign_note,
                stable_candidate_note,
                stable_confirmed_note,
            ]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = note_domain.note_list(fake_store, scope="all")

    assert [note["title"] for note in result["notes"]] == [
        "Current run",
        "Old run",
        "Candidate",
        "Confirmed",
    ]
    assert fake_store.insights.kwargs["scope"] is None
    assert fake_store.insights.kwargs["campaign_id"] is None
    assert fake_store.insights.kwargs["knowledge_class"] is None


def test_domain_services_note_list_defaults_to_stable_confirmed_plus_current_campaign(monkeypatch):
    from codedmap.app.services import domain_services

    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    current_campaign_note = _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now")
    old_campaign_note = _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old")
    stable_candidate_note = _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact")
    stable_confirmed_note = _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact")

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [
                current_campaign_note,
                old_campaign_note,
                stable_candidate_note,
                stable_confirmed_note,
            ]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = domain_services.note_list(fake_store)

    assert [note["title"] for note in result["notes"]] == ["Current run", "Confirmed"]
    assert fake_store.insights.kwargs["scope"] is None
    assert fake_store.insights.kwargs["campaign_id"] is None
    assert fake_store.insights.kwargs["knowledge_class"] is None


def test_domain_services_note_list_scope_all_returns_all_scopes(monkeypatch):
    from codedmap.app.services import domain_services

    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    current_campaign_note = _make_note(1, "Current run", scope="campaign", campaign_id="cmp_now")
    old_campaign_note = _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old")
    stable_candidate_note = _make_note(3, "Candidate", scope="stable_candidate", knowledge_class="fact")
    stable_confirmed_note = _make_note(4, "Confirmed", scope="stable_confirmed", knowledge_class="fact")

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [
                current_campaign_note,
                old_campaign_note,
                stable_candidate_note,
                stable_confirmed_note,
            ]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = domain_services.note_list(fake_store, scope="all")

    assert [note["title"] for note in result["notes"]] == [
        "Current run",
        "Old run",
        "Candidate",
        "Confirmed",
    ]
    assert fake_store.insights.kwargs["scope"] is None
    assert fake_store.insights.kwargs["campaign_id"] is None
    assert fake_store.insights.kwargs["knowledge_class"] is None


def test_domain_services_note_list_preserves_explicit_filters(monkeypatch):
    from codedmap.app.services import domain_services

    monkeypatch.setenv("CPG_CAMPAIGN_ID", "cmp_now")

    old_campaign_note = _make_note(2, "Old run", scope="campaign", campaign_id="cmp_old")

    class FakeInsights:
        def find_all_insights(self, **kwargs):
            self.kwargs = kwargs
            return [old_campaign_note]

    class FakeQuery:
        def by_id(self, node_id):
            return SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))

    fake_store = SimpleNamespace(insights=FakeInsights(), query=FakeQuery())

    result = domain_services.note_list(
        fake_store,
        scope="campaign",
        campaign_id="cmp_old",
        knowledge_class="assessment",
    )

    assert [note["title"] for note in result["notes"]] == ["Old run"]
    assert fake_store.insights.kwargs["scope"] == "campaign"
    assert fake_store.insights.kwargs["campaign_id"] == "cmp_old"
    assert fake_store.insights.kwargs["knowledge_class"] == "assessment"


def test_note_show_returns_metadata():
    from codedmap.app.services.domain import note as note_domain
    from codedmap.core.schema.graph.enums import NodeLabel

    node = SimpleNamespace(
        id=11,
        label=NodeLabel.INSIGHT,
        category="ARCHITECTURE",
        title="System",
        content="body",
        source="agent",
        confidence=None,
        status="active",
        created_at=None,
        updated_at=None,
        metadata={"scope": "stable_confirmed", "knowledge_class": "fact"},
    )

    fake_store = SimpleNamespace(
        get_node=lambda _: node,
        query=SimpleNamespace(by_id=lambda node_id: SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))),
    )

    result = note_domain.note_show(fake_store, 11)

    assert result["note"]["metadata"]["scope"] == "stable_confirmed"
    assert result["note"]["metadata"]["knowledge_class"] == "fact"


def test_note_promote_transitions_campaign_to_stable_candidate():
    from codedmap.app.services.domain import note as note_domain
    from codedmap.core.schema.graph.enums import NodeLabel

    note_node = SimpleNamespace(
        id=21,
        label=NodeLabel.INSIGHT,
        metadata={"scope": "campaign", "knowledge_class": "fact", "campaign_id": "cmp_123"},
        scope="campaign",
        knowledge_class="fact",
        campaign_id="cmp_123",
    )
    updated = SimpleNamespace(
        id=21,
        label=NodeLabel.INSIGHT,
        category="ARCHITECTURE",
        title="Boundary",
        content="{}",
        source="agent",
        confidence=None,
        status="active",
        created_at=None,
        updated_at=None,
        metadata={},
        scope="stable_candidate",
        knowledge_class="fact",
        campaign_id=None,
        review_state="ai_supported",
        visibility="default",
        evidence_bundle={},
        promoted_from="cmp_123",
    )

    class FakeInsights:
        def __init__(self):
            self.updated_kwargs = None

        def get_by_id(self, note_id):
            assert note_id == 21
            return note_node

        def update(self, note_id, **kwargs):
            self.updated_kwargs = kwargs
            return updated

    fake_store = SimpleNamespace(
        insights=FakeInsights(),
        get_node=lambda _: updated,
        query=SimpleNamespace(by_id=lambda node_id: SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))),
    )

    result = note_domain.note_promote(fake_store, 21)

    assert result["note"]["metadata"]["scope"] == "stable_candidate"
    assert result["note"]["metadata"]["promoted_from"] == "cmp_123"
    assert fake_store.insights.updated_kwargs["campaign_id"] is None
    assert fake_store.insights.updated_kwargs["review_state"] == "ai_supported"


def test_note_confirm_transitions_candidate_to_confirmed():
    from codedmap.app.services.domain import note as note_domain
    from codedmap.core.schema.graph.enums import NodeLabel

    note_node = SimpleNamespace(
        id=22,
        label=NodeLabel.INSIGHT,
        metadata={"scope": "stable_candidate", "knowledge_class": "fact", "promoted_from": "cmp_123"},
        scope="stable_candidate",
        knowledge_class="fact",
        campaign_id=None,
        promoted_from="cmp_123",
    )
    updated = SimpleNamespace(
        id=22,
        label=NodeLabel.INSIGHT,
        category="ARCHITECTURE",
        title="Boundary",
        content="{}",
        source="agent",
        confidence=None,
        status="active",
        created_at=None,
        updated_at=None,
        metadata={},
        scope="stable_confirmed",
        knowledge_class="fact",
        campaign_id=None,
        review_state="human_confirmed",
        visibility="default",
        evidence_bundle={},
        promoted_from="cmp_123",
    )

    class FakeInsights:
        def __init__(self):
            self.updated_kwargs = None

        def get_by_id(self, note_id):
            assert note_id == 22
            return note_node

        def update(self, note_id, **kwargs):
            self.updated_kwargs = kwargs
            return updated

    fake_store = SimpleNamespace(
        insights=FakeInsights(),
        get_node=lambda _: updated,
        query=SimpleNamespace(by_id=lambda node_id: SimpleNamespace(in_=lambda edge: SimpleNamespace(to_list=lambda: []))),
    )

    result = note_domain.note_confirm(fake_store, 22)

    assert result["note"]["metadata"]["scope"] == "stable_confirmed"
    assert fake_store.insights.updated_kwargs["scope"] == "stable_confirmed"
    assert fake_store.insights.updated_kwargs["review_state"] == "human_confirmed"
