from __future__ import annotations

import tempfile

from codedmap.app.audit.models import AuditEvent
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore


def _make_event(target_id: int, operation: str = "tag_add") -> AuditEvent:
    return AuditEvent(
        actor_id="service",
        actor_type="system",
        source="service.tag.add",
        operation=operation,
        target_kind="node_tag",
        target_id=target_id,
        target_label="demo",
        field="tags",
        old_value=None,
        new_value={"tag": "STATE:AUDITED"},
        status="applied",
    )


def test_memory_audit_log_append_and_list():
    with CPGStore(StorageConfig(backend="memory")) as store:
        store.audit_log.append(_make_event(target_id=11))
        store.audit_log.append(_make_event(target_id=11, operation="tag_remove"))
        store.audit_log.append(_make_event(target_id=12))

        result = store.audit_log.list_by_target("node_tag", 11, limit=10, offset=0)

    assert result["total"] == 2
    assert [item["operation"] for item in result["events"]] == ["tag_add", "tag_remove"]


def test_sqlite_audit_log_persists_across_sessions():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = f"{tmpdir}/audit-log.db"
        config = StorageConfig(backend="sqlite", uri=db_path)

        with CPGStore(config) as store:
            store.audit_log.append(_make_event(target_id=21))

        with CPGStore(config) as store:
            result = store.audit_log.list_by_target("node_tag", 21, limit=10, offset=0)

    assert result["total"] == 1
    assert result["events"][0]["target_id"] == 21
    assert result["events"][0]["operation"] == "tag_add"
