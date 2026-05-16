from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from codedmap.app.audit.models import AuditEvent


def infer_actor(created_by: Optional[str]) -> tuple[str, str]:
    value = (created_by or "system").strip() or "system"
    actor_id = value.split("@", 1)[0] if "@" in value else value
    lowered = actor_id.lower()
    if lowered in {"service", "system"}:
        return actor_id, "system"
    if "pass" in lowered:
        return actor_id, "pass"
    if any(token in lowered for token in ("agent", "bot", "ai")):
        return actor_id, "agent"
    return actor_id, "human"


def infer_source(created_by: Optional[str], fallback: str) -> str:
    value = (created_by or "").strip()
    if "@" in value:
        return value.split("@", 1)[1].replace(":", ".")
    return fallback


def note_metadata(note) -> Dict[str, Any]:
    explicit = getattr(note, "metadata", None)
    if isinstance(explicit, dict) and explicit:
        return explicit
    return {
        "scope": getattr(note, "scope", "campaign"),
        "knowledge_class": getattr(note, "knowledge_class", "assessment"),
        "campaign_id": getattr(note, "campaign_id", None),
        "review_state": getattr(note, "review_state", "unreviewed"),
        "visibility": getattr(note, "visibility", "default"),
        "evidence_bundle": getattr(note, "evidence_bundle", {}) or {},
        "promoted_from": getattr(note, "promoted_from", None),
    }


def summarize_note(note, *, host_ids: Optional[Iterable[int]] = None) -> Dict[str, Any]:
    summary = {
        "title": getattr(note, "title", ""),
        "category": getattr(note, "category", ""),
        "source": getattr(note, "source", "unknown"),
        "metadata": note_metadata(note),
    }
    if host_ids is not None:
        summary["node_ids"] = list(host_ids)
    return summary


def append_event(
    store,
    *,
    created_by: Optional[str],
    operation: str,
    target_kind: str,
    target_id: Optional[int],
    target_label: Optional[str],
    field: Optional[str],
    old_value: Any,
    new_value: Any,
    reason: Optional[str] = None,
    source: Optional[str] = None,
) -> None:
    audit_log = getattr(store, "audit_log", None)
    if audit_log is None:
        return
    actor_id, actor_type = infer_actor(created_by)
    event = AuditEvent(
        actor_id=actor_id,
        actor_type=actor_type,
        source=source or infer_source(created_by, operation),
        operation=operation,
        target_kind=target_kind,
        target_id=target_id,
        target_label=target_label,
        field=field,
        old_value=old_value,
        new_value=new_value,
        status="applied",
        reason=reason,
    )
    audit_log.append(event)
