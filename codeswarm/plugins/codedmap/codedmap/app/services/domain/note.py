"""Note domain service functions."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from codedmap.app.services.pagination import paginate_sequence
from codedmap.app.services.domain.note_visibility import (
    has_explicit_layer_filters,
    is_all_scope,
    note_matches_read_policy,
)


def _note_metadata(note) -> Dict[str, Any]:
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


def _matches_layer_filters(
    note,
    scope: Optional[str] = None,
    campaign_id: Optional[str] = None,
    knowledge_class: Optional[str] = None,
) -> bool:
    metadata = _note_metadata(note)
    if scope is not None and metadata.get("scope") != scope:
        return False
    if campaign_id is not None and metadata.get("campaign_id") != campaign_id:
        return False
    if knowledge_class is not None and metadata.get("knowledge_class") != knowledge_class:
        return False
    return True


def _get_note_or_raise(store, note_id: int):
    from codedmap.core.schema.graph.enums import NodeLabel

    node = store.insights.get_by_id(note_id)
    if node is None or getattr(node, "label", None) != NodeLabel.INSIGHT:
        raise ValueError(f"Note {note_id} not found")
    return node

def note_add(
    store,
    title: str,
    content: str,
    node_ids: Optional[List[int]] = None,
    category: str = "COORDINATION",
    source: str = "agent",
    confidence: Optional[float] = None,
    created_by: str = "service@note:add",
    scope: str = "campaign",
    knowledge_class: str = "assessment",
    campaign_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an audit note, optionally attached to specific nodes.

    Args:
        store:      CPGStore instance.
        title:      Short title (max 120 chars).
        content:    Note body (Markdown).
        node_ids:   0..N node IDs to attach to (omit for global note).
        category:   Note category string (e.g., 'COORDINATION').
        source:     Origin of the note (default: 'agent').
        confidence: Optional float in [0.0, 1.0].
        created_by: Audit provenance string.

    Returns:
        Dict (serialized InsightNode).
    Raises:
        ValueError: if arguments are invalid.
        NoteSchemaValidationError: if category/content fails schema validation.
    """
    from codedmap.app.query.root import CPG

    cat_value = category.upper() if isinstance(category, str) else str(category).upper()

    cpg = CPG(store)
    summary = cpg.set_summary(
        node_ids=node_ids,
        title=title,
        content=content,
        category=cat_value,
        source=source,
        confidence=confidence,
        created_by=created_by,
        scope=scope,
        knowledge_class=knowledge_class,
        campaign_id=campaign_id,
        metadata=metadata or {
            "scope": scope,
            "knowledge_class": knowledge_class,
            "campaign_id": campaign_id,
        },
    )
    payload = summary.model_dump(mode="json")

    from codedmap.app.audit.service import append_event

    append_event(
        store,
        created_by=created_by,
        operation="note_add",
        target_kind="note",
        target_id=payload.get("id"),
        target_label=payload.get("title"),
        field="note",
        old_value=None,
        new_value={
            "title": payload.get("title"),
            "category": payload.get("category"),
            "source": payload.get("source"),
            "metadata": payload.get("metadata", {}),
            "node_ids": payload.get("node_ids", []),
        },
    )
    return payload


def note_list(
    store,
    node_id: Optional[int] = None,
    category: Optional[str] = None,
    scope: Optional[str] = None,
    campaign_id: Optional[str] = None,
    knowledge_class: Optional[str] = None,
    current_campaign_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """List audit notes, optionally filtered by node or category.

    Args:
        store:    CPGStore instance.
        node_id:  Return only notes attached to this node.
        category: Filter by note category string.
        limit:    Max results.

    Returns:
        Dict with: notes (list), total (int)
    """
    from codedmap.core.schema.graph.enums import NodeLabel

    explicit_layer_filters = has_explicit_layer_filters(
        scope=scope,
        campaign_id=campaign_id,
        knowledge_class=knowledge_class,
    )

    query_scope = None if not explicit_layer_filters or is_all_scope(scope) else scope
    query_campaign_id = campaign_id if explicit_layer_filters else None
    query_knowledge_class = knowledge_class if explicit_layer_filters else None

    if node_id is not None:
        insights = store.insights.get_attached_insights(
            node_id,
            category=category,
            scope=query_scope,
            campaign_id=query_campaign_id,
            knowledge_class=query_knowledge_class,
        )
    else:
        insights = store.insights.find_all_insights(
            category=category,
            scope=query_scope,
            campaign_id=query_campaign_id,
            knowledge_class=query_knowledge_class,
        )

    insights = [
        note for note in insights
        if note_matches_read_policy(
            note,
            metadata_resolver=_note_metadata,
            scope=scope,
            campaign_id=campaign_id,
            knowledge_class=knowledge_class,
            current_campaign_id=current_campaign_id,
        )
    ]

    page = paginate_sequence(insights, offset=offset, limit=limit)

    notes = []
    for n in page["items"]:
        try:
            hosts = store.query.by_id(n.id).in_("HAS_INSIGHT").to_list()
        except Exception:
            hosts = []

        host_ids = [h.id for h in hosts]
        is_global = any(getattr(h, "label", None) == NodeLabel.META_DATA for h in hosts)

        if is_global or len(hosts) == 0:
            target_label = "[GLOBAL]"
        elif len(hosts) == 1:
            name = getattr(hosts[0], "name", None) or str(hosts[0].id)
            target_label = f"[Target: {name}]"
        else:
            names = [getattr(h, "name", None) or str(h.id) for h in hosts]
            if len(names) <= 2:
                target_label = f"[Targets: {', '.join(names)}]"
            else:
                target_label = f"[Targets: {names[0]}, {names[1]}, +{len(names)-2} more]"

        notes.append({
            "note_id": str(n.id),
            "node_ids": host_ids,
            "target_label": target_label,
            "title": getattr(n, "title", ""),
            "category": getattr(n, "category", "?"),
            "source": getattr(n, "source", "unknown"),
            "status": getattr(n, "status", "active"),
            "metadata": _note_metadata(n),
            "created_at": getattr(n, "created_at", None),
        })

    return {
        "notes": notes,
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def note_show(store, note_id: int) -> Dict[str, Any]:
    """Show full content of a single note.

    Args:
        store:    CPGStore instance.
        note_id:  Note node ID (integer).

    Returns:
        Dict with: note (dict), node_contexts (list)
    Raises:
        ValueError: if note_id is not found or is not an INSIGHT node.
    """
    from codedmap.core.schema.graph.enums import NodeLabel

    node = store.get_node(note_id)
    if node is None or getattr(node, "label", None) != NodeLabel.INSIGHT:
        raise ValueError(f"Note {note_id} not found")

    try:
        hosts = store.query.by_id(node.id).in_("HAS_INSIGHT").to_list()
    except Exception:
        hosts = []

    node_contexts = []
    for host in hosts:
        if getattr(host, "label", None) == NodeLabel.META_DATA:
            continue
        node_contexts.append({
            "id": host.id,
            "name": getattr(host, "name", None),
            "label": str(host.label),
            "file": getattr(host, "file_name", None),
            "line": getattr(host, "line_number", None),
        })

    note_data = {
        "id": node.id,
        "category": getattr(node, "category", "?"),
        "title": getattr(node, "title", ""),
        "content": getattr(node, "content", ""),
        "source": getattr(node, "source", "unknown"),
        "confidence": getattr(node, "confidence", None),
        "status": getattr(node, "status", "active"),
        "metadata": _note_metadata(node),
        "created_at": getattr(node, "created_at", None),
        "updated_at": getattr(node, "updated_at", None),
    }

    return {"note": note_data, "node_contexts": node_contexts}


def note_promote(
    store,
    note_id: int,
    created_by: str = "service@note:promote",
) -> Dict[str, Any]:
    del created_by
    node = _get_note_or_raise(store, note_id)
    metadata = _note_metadata(node)
    if metadata.get("scope") != "campaign":
        raise ValueError("Only campaign notes can be promoted")
    if metadata.get("knowledge_class") != "fact":
        raise ValueError("Only fact notes can be promoted")

    promoted_from = metadata.get("campaign_id") or metadata.get("promoted_from")
    store.insights.update(
        note_id,
        scope="stable_candidate",
        review_state="ai_supported",
        campaign_id=None,
        promoted_from=promoted_from,
    )
    return note_show(store, note_id)


def note_confirm(
    store,
    note_id: int,
    created_by: str = "service@note:confirm",
) -> Dict[str, Any]:
    del created_by
    node = _get_note_or_raise(store, note_id)
    metadata = _note_metadata(node)
    if metadata.get("scope") != "stable_candidate":
        raise ValueError("Only stable_candidate notes can be confirmed")

    store.insights.update(
        note_id,
        scope="stable_confirmed",
        review_state="human_confirmed",
        campaign_id=None,
    )
    return note_show(store, note_id)


def note_remove(
    store,
    note_id: Optional[int] = None,
    node_ids: Optional[List[int]] = None,
    category: Optional[str] = None,
    created_by: str = "service@note:remove",
) -> Dict[str, Any]:
    """Remove a note by ID or unbind it from specific nodes.

    Args:
        store:    CPGStore instance.
        note_id:  Cascade-delete the entire note.
        node_ids: Unbind the note from these nodes (with orphan cleanup).
        category: Used with node_ids for category-filtered unbind.
        created_by: Audit provenance string.

    Returns:
        Dict with: action, note_id (optional), node_ids (optional)
    Raises:
        ValueError: if neither note_id nor node_ids is specified.
    """
    from codedmap.app.query.root import CPG
    from codedmap.app.audit.service import append_event

    if note_id is None and not node_ids:
        raise ValueError("Specify note_id or node_ids to remove")

    cpg = CPG(store)
    if note_id is not None:
        note_before = note_show(store, note_id)
        note_payload = note_before["note"]
        old_value = {
            "title": note_payload.get("title"),
            "category": note_payload.get("category"),
            "source": note_payload.get("source"),
            "metadata": note_payload.get("metadata", {}),
            "node_ids": [ctx["id"] for ctx in note_before.get("node_contexts", [])],
        }
    else:
        impacted = note_list(store, category=category, limit=5000, offset=0)
        matching = [
            note for note in impacted["notes"]
            if any(node_id in (note.get("node_ids") or []) for node_id in (node_ids or []))
        ]

    cpg.delete_summary(
        insight_id=note_id,
        node_ids=node_ids,
        category=category,
    )
    if note_id is not None:
        append_event(
            store,
            created_by=created_by,
            operation="note_remove",
            target_kind="note",
            target_id=note_id,
            target_label=old_value.get("title"),
            field="note",
            old_value=old_value,
            new_value=None,
        )
    else:
        for note in matching:
            remaining_node_ids = [
                current_id for current_id in (note.get("node_ids") or [])
                if current_id not in (node_ids or [])
            ]
            append_event(
                store,
                created_by=created_by,
                operation="note_remove",
                target_kind="note",
                target_id=int(note["note_id"]),
                target_label=note.get("title"),
                field="bindings",
                old_value={
                    "title": note.get("title"),
                    "category": note.get("category"),
                    "source": note.get("source"),
                    "metadata": note.get("metadata", {}),
                    "node_ids": note.get("node_ids", []),
                },
                new_value={"node_ids": remaining_node_ids},
                reason="detached",
            )

    return {
        "action": "removed",
        "note_id": note_id,
        "node_ids": node_ids,
    }
