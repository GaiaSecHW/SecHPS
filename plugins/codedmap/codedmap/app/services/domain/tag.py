"""Tag domain service functions."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from codedmap.app.services.pagination import paginate_sequence
from codedmap.app.services.scope_utils import resolve_module_scope, filter_by_scope


def _tag_created_by(node, tag: str) -> str:
    provenance = getattr(node, "tags_provenance", {}) or {}
    entry = provenance.get(tag)
    if isinstance(entry, list) and entry:
        entry = entry[-1]
    if isinstance(entry, dict):
        created_by = entry.get("created_by")
        if isinstance(created_by, str) and created_by:
            return created_by
    return "unknown"


def _serialize_tag_entry(tag: str, created_by: str) -> Dict[str, str]:
    return {"tag": tag, "created_by": created_by}


def _aggregate_created_by(values: List[str]) -> str:
    unique_values = []
    for value in values:
        if not value or value in unique_values:
            continue
        unique_values.append(value)
    if not unique_values:
        return "unknown"
    if len(unique_values) == 1:
        return unique_values[0]
    if len(unique_values) == 2:
        return ", ".join(unique_values)
    return f"{unique_values[0]}, {unique_values[1]}, +{len(unique_values)-2} more"

def tag_add(
    store,
    node_id: int,
    tag: str,
    confidence: Optional[float] = None,
    justification: Optional[str] = None,
    created_by: str = "service@tag:add",
) -> Dict[str, Any]:
    """Add a security tag to a node.

    Args:
        store:         CPGStore instance.
        node_id:       ID of the node to tag.
        tag:           Tag string (e.g., 'ONTOLOGY:SINK:MEMORY_WRITE').
        confidence:    Optional float in [0.0, 1.0].
        justification: Optional free-text justification (max 255 chars).
        created_by:    Audit provenance string.

    Returns:
        Dict with: node_id, name, tag, action, warning (optional)
    Raises:
        ValueError: if node_id is not found, justification too long, or
                    subjective tag is missing required justification.
    """
    from codedmap.analysis.tagging.engine import TagEngine

    _SUBJECTIVE_PREFIXES = ("ONTOLOGY:ROLE:", "STATE:", "DRAFT")

    node = store.get_node(node_id)
    if node is None:
        raise ValueError(f"Node {node_id} not found")

    if justification is not None and len(justification) > 255:
        raise ValueError(
            f"Justification exceeds 255 character limit (got {len(justification)})."
        )

    normalized = tag.strip().upper()
    requires_just = any(normalized.startswith(p) for p in _SUBJECTIVE_PREFIXES)
    if requires_just and not justification:
        raise ValueError(
            "--justification is required for subjective tags (ROLE/STATE/DRAFT). "
            "Provide a reason for this tag."
        )

    tagger = TagEngine(store)
    result = tagger.add(
        node, tag,
        confidence=confidence,
        justification=justification,
        created_by=created_by,
    )
    if result.action == "added":
        from codedmap.app.audit.service import append_event

        append_event(
            store,
            created_by=created_by,
            operation="tag_add",
            target_kind="node_tag",
            target_id=result.node_id,
            target_label=result.node_name,
            field="tags",
            old_value=None,
            new_value={"tag": result.tag},
            reason=justification,
        )

    entry: Dict[str, Any] = {
        "node_id": result.node_id,
        "name": result.node_name,
        "tag": result.tag,
        "action": result.action,
    }
    if result.warning:
        entry["warning"] = result.warning
    return entry


def tag_remove(
    store,
    node_id: int,
    tag: str,
    created_by: str = "service@tag:remove",
) -> Dict[str, Any]:
    """Remove a security tag from a node.

    Args:
        store:    CPGStore instance.
        node_id:  ID of the node to untag.
        tag:      Tag string to remove.
        created_by: Audit provenance string.

    Returns:
        Dict with: node_id, name, tag, action
    Raises:
        ValueError: if node_id is not found.
    """
    from codedmap.analysis.tagging.engine import TagEngine

    node = store.get_node(node_id)
    if node is None:
        raise ValueError(f"Node {node_id} not found")

    tagger = TagEngine(store)
    result = tagger.remove(node, tag, created_by=created_by)
    if result.action == "removed":
        from codedmap.app.audit.service import append_event

        append_event(
            store,
            created_by=created_by,
            operation="tag_remove",
            target_kind="node_tag",
            target_id=result.node_id,
            target_label=result.node_name,
            field="tags",
            old_value={"tag": result.tag},
            new_value=None,
        )
    return {
        "node_id": result.node_id,
        "name": result.node_name,
        "tag": result.tag,
        "action": result.action,
    }


def tag_list(
    store,
    node_id: Optional[int] = None,
    function: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """List tags on a node or all tags in the graph.

    Args:
        store:     CPGStore instance.
        node_id:   List tags for this specific node.
        function:  List tags for the first METHOD matching this name.

    Returns:
        If node_id or function is specified:
            Dict with: node_id, name, tags (list of tag strings)
        If neither is specified (list-all mode):
            Dict with: tags (list of all unique tag strings), total (int)
    Raises:
        ValueError: if node_id or function does not resolve.
    """
    from codedmap.analysis.tagging.engine import TagEngine

    tagger = TagEngine(store)

    if node_id is not None:
        node = store.get_node(node_id)
        if node is None:
            raise ValueError(f"Node {node_id} not found")
        tags = [
            _serialize_tag_entry(tag, _tag_created_by(node, tag))
            for tag in tagger.list_tags(node)
        ]
        page = paginate_sequence(tags, offset=offset, limit=limit)
        return {
            "node_id": node_id,
            "name": getattr(node, "name", "?"),
            "tags": page["items"],
            "total": page["total"],
            "offset": page["offset"],
            "limit": page["limit"],
            "has_more": page["has_more"],
            "truncated": page["truncated"],
        }

    if function is not None:
        from codedmap.infra.services.node_resolver import NodeResolver
        resolver = NodeResolver(store)
        methods = resolver.resolve_function(function)
        if not methods:
            raise ValueError(f"Function '{function}' not found")
        node = methods[0]
        tags = [
            _serialize_tag_entry(tag, _tag_created_by(node, tag))
            for tag in tagger.list_tags(node)
        ]
        page = paginate_sequence(tags, offset=offset, limit=limit)
        return {
            "node_id": node.id,
            "name": getattr(node, "name", "?"),
            "tags": page["items"],
            "total": page["total"],
            "offset": page["offset"],
            "limit": page["limit"],
            "has_more": page["has_more"],
            "truncated": page["truncated"],
        }

    # List all
    all_tags = tagger.list_all_tags()
    tag_rows = []
    for tag in all_tags:
        nodes = tagger.find(tag, limit=None)
        created_by_values = [_tag_created_by(node, tag) for node in nodes]
        tag_rows.append(_serialize_tag_entry(tag, _aggregate_created_by(created_by_values)))
    page = paginate_sequence(tag_rows, offset=offset, limit=limit)
    return {
        "tags": page["items"],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def tag_find(
    store,
    tag: str,
    limit: int = 50,
    offset: int = 0,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Find all nodes tagged with a given tag pattern.

    Args:
        store:     CPGStore instance.
        tag:       Tag pattern to search for.
        limit:     Max results to return.
        module:    Optional module name for scope filtering.
        module_id: Optional module ID (takes precedence over module name).

    Returns:
        Dict with: tag, nodes (list), total (int)
    """
    from codedmap.analysis.tagging.engine import TagEngine

    tagger = TagEngine(store)
    results = tagger.find(tag, limit=None)

    if module or module_id:
        scope = resolve_module_scope(store, module=module, module_id=module_id)
        if scope:
            results = filter_by_scope(results, scope, store)

    page = paginate_sequence(results, offset=offset, limit=limit)
    nodes = []
    for n in page["items"]:
        label = getattr(n, "label", "UNKNOWN")
        if hasattr(label, "value"):
            label = label.value
        nodes.append({
            "node_id": getattr(n, "id", None),
            "name": getattr(n, "name", "?"),
            "label": str(label),
            "file": getattr(n, "file_name", None),
            "line": getattr(n, "line_number", None),
            "tags": tagger.list_tags(n),
        })
    return {
        "tag": tag,
        "nodes": nodes,
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def tag_bulk(
    store,
    pattern: str,
    tag: str,
    node_type: str = "method",
    created_by: str = "service@tag:bulk",
) -> Dict[str, Any]:
    """Bulk-apply a tag to all nodes matching a name pattern.

    Args:
        store:      CPGStore instance.
        pattern:    Name substring pattern to match.
        tag:        Tag to apply to matching nodes.
        node_type:  One of 'method', 'module', 'any'.
        created_by: Audit provenance string.

    Returns:
        Dict with: pattern, tag, nodes (list), total (int)
    """
    from codedmap.analysis.tagging.engine import TagEngine

    tagger = TagEngine(store)
    results = tagger.bulk_tag(pattern, tag, node_type=node_type, created_by=created_by)
    from codedmap.app.audit.service import append_event

    for r in results:
        if r.action != "added":
            continue
        append_event(
            store,
            created_by=created_by,
            operation="tag_bulk_add",
            target_kind="node_tag",
            target_id=r.node_id,
            target_label=r.node_name,
            field="tags",
            old_value=None,
            new_value={"tag": r.tag},
            reason=f"pattern={pattern};node_type={node_type}",
        )
    nodes = [
        {"node_id": r.node_id, "name": r.node_name, "tag": r.tag, "action": r.action}
        for r in results
    ]
    return {"pattern": pattern, "tag": tag, "nodes": nodes, "total": len(nodes)}
