from __future__ import annotations

import json

from codedmap.app.services import domain_services
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import Language, NodeLabel
from codedmap.core.schema.graph.nodes import MetaDataNode, MethodNode
from codedmap.infra.storage.store import CPGStore


def _make_store() -> CPGStore:
    return CPGStore(StorageConfig(backend="memory"))


def _seed_graph(store: CPGStore) -> tuple[int, int]:
    graph = CPGGraph()
    meta = MetaDataNode(language=Language.PYTHON, root_path="/tmp/project", projectName="demo")
    method_one = MethodNode(
        id=1001,
        name="alpha",
        fullName="demo::alpha",
        label=NodeLabel.METHOD,
        fileName="demo.py",
        lineNumber=10,
    )
    method_two = MethodNode(
        id=1002,
        name="alpha_helper",
        fullName="demo::alpha_helper",
        label=NodeLabel.METHOD,
        fileName="demo.py",
        lineNumber=20,
    )
    method_one.tags = []
    method_two.tags = []
    graph.add_node(meta)
    graph.add_node(method_one)
    graph.add_node(method_two)
    store.save(graph)
    return method_one.id, method_two.id


def test_tag_add_and_remove_append_audit_events():
    with _make_store() as store:
        method_id, _ = _seed_graph(store)

        domain_services.tag_add(store, method_id, "STATE:AUDITED", justification="coverage", created_by="auditor@tag:add")
        domain_services.tag_remove(store, method_id, "STATE:AUDITED", created_by="auditor@tag:remove")

        result = store.audit_log.list_by_target("node_tag", method_id, limit=10, offset=0)

    assert [item["operation"] for item in result["events"]] == ["tag_add", "tag_remove"]
    assert result["events"][0]["actor_type"] == "human"
    assert result["events"][1]["new_value"] is None


def test_tag_bulk_appends_one_event_per_tagged_node():
    with _make_store() as store:
        method_one_id, method_two_id = _seed_graph(store)

        domain_services.tag_bulk(store, "alpha", "ONTOLOGY:SOURCE:USER_INPUT", created_by="service@tag:bulk")

        first = store.audit_log.list_by_target("node_tag", method_one_id, limit=10, offset=0)
        second = store.audit_log.list_by_target("node_tag", method_two_id, limit=10, offset=0)

    assert first["total"] == 1
    assert second["total"] == 1
    assert first["events"][0]["operation"] == "tag_bulk_add"
    assert second["events"][0]["operation"] == "tag_bulk_add"


def test_note_add_and_remove_append_audit_events():
    with _make_store() as store:
        method_id, _ = _seed_graph(store)

        created = domain_services.note_add(
            store,
            title="Audit note",
            content=json.dumps({
                "schema_version": "1.0",
                "status": "TODO",
                "owner": "audit-agent",
                "message": "Track this note",
                "target_nodes": None,
                "metrics": None,
            }),
            node_ids=[method_id],
            category="COORDINATION",
            created_by="agent@note:add",
            scope="campaign",
            knowledge_class="assessment",
            campaign_id="cmp_now",
        )
        domain_services.note_remove(store, note_id=created["id"], created_by="agent@note:remove")

        result = store.audit_log.list_by_target("note", created["id"], limit=10, offset=0)

    assert [item["operation"] for item in result["events"]] == ["note_add", "note_remove"]
    assert result["events"][0]["new_value"]["metadata"]["campaign_id"] == "cmp_now"
    assert result["events"][1]["old_value"]["title"] == "Audit note"
