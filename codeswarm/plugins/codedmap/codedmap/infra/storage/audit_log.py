from __future__ import annotations

import json
from typing import Any, Dict, List

from codedmap.app.audit.models import AuditEvent
from codedmap.app.services.pagination import paginate_sequence


class AuditLogRepository:
    """Backend-aware append-only repository for audit events."""

    def __init__(self, backend: str, db: Any):
        self._backend = backend
        self._db = db

    def append(self, event: AuditEvent) -> None:
        if self._backend == "memory":
            self._db.audit_log.append(event.model_dump(mode="json"))
            return
        if self._backend == "sqlite":
            payload = event.model_dump(mode="json")
            conn = self._db.get_connection()
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute(
                    """
                    INSERT INTO audit_log (
                        event_id, timestamp, actor_id, actor_type, source, operation,
                        target_kind, target_id, target_label, field,
                        old_value, new_value, status, reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload["event_id"],
                        payload["timestamp"],
                        payload["actor_id"],
                        payload["actor_type"],
                        payload.get("source"),
                        payload["operation"],
                        payload["target_kind"],
                        payload.get("target_id"),
                        payload.get("target_label"),
                        payload.get("field"),
                        self._json_or_none(payload.get("old_value")),
                        self._json_or_none(payload.get("new_value")),
                        payload["status"],
                        payload.get("reason"),
                    ),
                )
                conn.commit()
                return
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        raise NotImplementedError(f"audit_log is not supported for backend {self._backend}")

    def list_by_target(self, target_kind: str, target_id: int, limit: int, offset: int) -> Dict[str, Any]:
        if self._backend == "memory":
            events = [
                item for item in self._db.audit_log
                if item.get("target_kind") == target_kind and item.get("target_id") == target_id
            ]
            page = paginate_sequence(events, offset=offset, limit=limit)
            return self._page_to_result(page)
        if self._backend == "sqlite":
            conn = self._db.get_connection()
            try:
                rows = conn.execute(
                    """
                    SELECT event_id, timestamp, actor_id, actor_type, source, operation,
                           target_kind, target_id, target_label, field,
                           old_value, new_value, status, reason
                    FROM audit_log
                    WHERE target_kind = ? AND target_id = ?
                    ORDER BY timestamp ASC, event_id ASC
                    """,
                    (target_kind, target_id),
                ).fetchall()
            finally:
                conn.close()
            events = [self._row_to_event(row) for row in rows]
            page = paginate_sequence(events, offset=offset, limit=limit)
            return self._page_to_result(page)
        raise NotImplementedError(f"audit_log is not supported for backend {self._backend}")

    @staticmethod
    def _json_or_none(value: Any) -> str | None:
        if value is None:
            return None
        return json.dumps(value, ensure_ascii=True, sort_keys=True)

    @staticmethod
    def _decode_json(value: str | None) -> Any:
        if value is None:
            return None
        return json.loads(value)

    def _row_to_event(self, row) -> Dict[str, Any]:
        return {
            "event_id": row["event_id"],
            "timestamp": row["timestamp"],
            "actor_id": row["actor_id"],
            "actor_type": row["actor_type"],
            "source": row["source"],
            "operation": row["operation"],
            "target_kind": row["target_kind"],
            "target_id": row["target_id"],
            "target_label": row["target_label"],
            "field": row["field"],
            "old_value": self._decode_json(row["old_value"]),
            "new_value": self._decode_json(row["new_value"]),
            "status": row["status"],
            "reason": row["reason"],
        }

    @staticmethod
    def _page_to_result(page: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "events": page["items"],
            "total": page["total"],
            "offset": page["offset"],
            "limit": page["limit"],
            "has_more": page["has_more"],
            "truncated": page["truncated"],
        }
