"""Module domain service functions."""

from __future__ import annotations

import fnmatch
from typing import Any, Dict, List, Optional

from codedmap.app.services.pagination import paginate_sequence
from codedmap.app.services.scope_utils import resolve_module

def module_list(
    store,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> Dict[str, Any]:
    """List all modules with file/method counts.

    Args:
        store:    CPGStore instance.
        limit:    Max modules to return (ignored if show_all=True).
        show_all: Return all modules without limit.

    Returns:
        Dict with keys: modules (list), total (int), has_more (bool)
    """
    from codedmap.analysis.traversal.module import ModuleNavigator

    modules = store.modules.find_all(limit=10000)

    nav = ModuleNavigator(store)
    entries = []
    for m in modules:
        fc = sum(1 for _ in nav.get_files(m))
        mc = sum(1 for _ in nav.get_methods(m))
        entries.append({
            "id": m.id,
            "name": getattr(m, "name", "?"),
            "full_name": getattr(m, "full_name", "?"),
            "description": getattr(m, "description", None),
            "file_count": fc,
            "method_count": mc,
        })

    if show_all:
        return {
            "modules": entries,
            "total": len(entries),
            "offset": 0,
            "limit": max(len(entries), 1),
            "has_more": False,
            "truncated": False,
        }
    page = paginate_sequence(entries, offset=offset, limit=limit)
    return {
        "modules": page["items"],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def module_show(
    store,
    name: Optional[str] = None,
    module_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Show module details including metrics.

    Args:
        store:     CPGStore instance.
        name:      Module name (exact or fuzzy match).
        module_id: Module node ID (takes precedence over name).

    Returns:
        Dict with module metadata, file_count, method_count, files, metrics.
    Raises:
        ValueError: if neither name nor module_id is provided, or not found.
    """
    from codedmap.analysis.traversal.module import ModuleNavigator

    if module_id is not None:
        node = store.get_node(module_id)
        if node is None:
            raise ValueError(f"Module ID {module_id} not found")
        module = node
    elif name is not None:
        module = resolve_module(store, name)
    else:
        raise ValueError("Provide name or module_id")

    nav = ModuleNavigator(store)
    file_assignments = nav.get_file_assignments(module)
    files = [f for f, _ in file_assignments]
    methods = list(nav.get_methods(module))
    metrics = nav.get_metrics(module, compute=True)
    fan_in = nav.get_fan_in(module)

    return {
        "id": module.id,
        "name": getattr(module, "name", "?"),
        "full_name": getattr(module, "full_name", "?"),
        "description": getattr(module, "description", None),
        "subsystem": getattr(module, "subsystem", None),
        "tags": getattr(module, "tags", []),
        "file_count": len(files),
        "method_count": len(methods),
        "fan_in": fan_in,
        "files": [
            {
                "id": f.id,
                "name": getattr(f, "name", "?"),
                "assignment": {
                    "justification": props.get("justification"),
                    "confidence": props.get("confidence"),
                },
            }
            for f, props in file_assignments
        ],
        "metrics": metrics.model_dump() if metrics else None,
    }


def module_create(
    store,
    name: str,
    description: str,
    full_name: Optional[str] = None,
    paths: Optional[List[str]] = None,
    created_by: str = "service@module:create",
) -> Dict[str, Any]:
    """Create a new module.

    Returns:
        Dict with: action, id, name, full_name, description, assigned_files
    Raises:
        ValueError: if module already exists.
    """
    from codedmap.core.schema.graph.nodes.structure import ModuleNode
    from codedmap.core.schema.graph.patch import GraphPatch

    full_name = full_name or name

    existing = store.modules.find_by_full_name(full_name)
    if existing:
        raise ValueError(f"Module '{full_name}' already exists (id: {existing[0].id})")

    module = ModuleNode(name=name, fullName=full_name, description=description)
    patch = GraphPatch(created_by=created_by).add_node(module)
    store.apply_patch(patch)

    assigned_count = 0
    if paths:
        assigned_count, _, _ = assign_files(store, module, paths, created_by=created_by)

    return {
        "action": "created",
        "id": module.id,
        "name": name,
        "full_name": full_name,
        "description": description,
        "assigned_files": assigned_count,
    }


def module_delete(
    store,
    name: str,
    created_by: str = "service@module:delete",
) -> Dict[str, Any]:
    """Delete a module.

    Returns:
        Dict with: action, id, name
    """
    module = resolve_module(store, name)
    mid, mname = module.id, getattr(module, "name", "?")
    store.delete_nodes([mid])
    return {"action": "deleted", "id": mid, "name": mname}


def module_rename(
    store,
    name: str,
    new_name: str,
    new_full_name: Optional[str] = None,
    created_by: str = "service@module:rename",
) -> Dict[str, Any]:
    """Rename a module.

    Returns:
        Dict with: action, old_name, new_name, old_id, new_id, files_preserved
    """
    from codedmap.core.schema.graph.nodes.structure import ModuleNode
    from codedmap.core.schema.graph.enums import EdgeType
    from codedmap.core.schema.graph.patch import GraphPatch
    from codedmap.analysis.traversal.module import ModuleNavigator

    module = resolve_module(store, name)
    old_name = getattr(module, "name", "?")
    old_full_name = getattr(module, "full_name", old_name)
    old_id = module.id

    if new_full_name is None:
        new_full_name = new_name if old_full_name == old_name else old_full_name

    files_preserved = 0

    if new_full_name != old_full_name:
        new_module = ModuleNode(
            name=new_name,
            fullName=new_full_name,
            description=getattr(module, "description", None),
            subsystem=getattr(module, "subsystem", None),
        )
        new_module.tags = list(getattr(module, "tags", []) or [])

        nav = ModuleNavigator(store)
        existing_files = list(nav.get_files(module))
        files_preserved = len(existing_files)

        patch = GraphPatch(created_by=created_by).add_node(new_module)
        for f in existing_files:
            patch.add_edge(new_module.id, f.id, EdgeType.CONTAINS)
        store.apply_patch(patch)
        store.delete_nodes([old_id])
        new_id = new_module.id
    else:
        patch = GraphPatch(created_by=created_by).update_node(module.id, name=new_name)
        store.apply_patch(patch)
        new_id = old_id
        nav = ModuleNavigator(store)
        files_preserved = sum(1 for _ in nav.get_files(module))

    return {
        "action": "renamed",
        "old_name": old_name,
        "new_name": new_name,
        "old_id": old_id,
        "new_id": new_id,
        "files_preserved": files_preserved,
    }


def assign_files(
    store,
    module,
    patterns: List[str],
    created_by: str = "service@module:assign",
    justification: Optional[str] = None,
    confidence: Optional[float] = None,
) -> tuple[int, int, List[dict]]:
    """Assign files matching glob patterns to a module.

    Returns:
        Tuple of (assigned, skipped, file_details)
    """
    from codedmap.core.schema.graph.enums import EdgeType
    from codedmap.core.schema.graph.patch import GraphPatch
    from codedmap.analysis.traversal.module import ModuleNavigator

    all_files = store.files.find_all(limit=100000)
    existing_ids = {f.id for f in ModuleNavigator(store).get_files(module)}

    matched = []
    for f in all_files:
        fname = getattr(f, "name", "")
        if any(fnmatch.fnmatch(fname, p) for p in patterns):
            matched.append(f)

    edge_props = {}
    if justification:
        edge_props["justification"] = justification[:255]
    if confidence is not None:
        edge_props["confidence"] = float(confidence)

    patch = GraphPatch(created_by=created_by)
    assigned = 0
    skipped = 0
    details = []
    for f in matched:
        if f.id in existing_ids:
            skipped += 1
            details.append({"id": f.id, "name": getattr(f, "name", "?"), "status": "already_assigned"})
        else:
            patch.add_edge(module.id, f.id, EdgeType.CONTAINS, **edge_props)
            assigned += 1
            details.append({"id": f.id, "name": getattr(f, "name", "?"), "status": "assigned"})

    if not patch.is_empty:
        store.apply_patch(patch)

    return assigned, skipped, details


def module_assign(
    store,
    name: str,
    paths: List[str],
    justification: str = "",
    confidence: Optional[float] = None,
    created_by: str = "service@module:assign",
) -> Dict[str, Any]:
    """Assign files to a module by glob patterns.

    Returns:
        Dict with: action, module_name, assigned, skipped, total_matched, files
    """
    module = resolve_module(store, name)
    assigned, skipped, details = assign_files(
        store, module, paths,
        created_by=created_by,
        justification=justification,
        confidence=confidence,
    )
    return {
        "action": "assigned",
        "module_name": getattr(module, "name", "?"),
        "assigned": assigned,
        "skipped": skipped,
        "total_matched": assigned + skipped,
        "files": details,
        "justification": justification,
        "confidence": confidence,
    }


def module_remove_files(
    store,
    name: str,
    paths: List[str],
    created_by: str = "service@module:remove",
) -> Dict[str, Any]:
    """Remove files from a module by glob patterns.

    Returns:
        Dict with: action, module_name, removed, remaining, files
    """
    from codedmap.core.schema.graph.enums import EdgeType
    from codedmap.core.schema.graph.patch import GraphPatch
    from codedmap.analysis.traversal.module import ModuleNavigator

    module = resolve_module(store, name)
    nav = ModuleNavigator(store)
    existing_files = list(nav.get_files(module))

    matched = [
        f for f in existing_files
        if any(fnmatch.fnmatch(getattr(f, "name", ""), p) for p in paths)
    ]

    patch = GraphPatch(created_by=created_by)
    details = []
    for f in matched:
        patch.remove_edge(module.id, f.id, EdgeType.CONTAINS)
        details.append({"id": f.id, "name": getattr(f, "name", "?"), "status": "removed"})

    if not patch.is_empty:
        store.apply_patch(patch)

    return {
        "action": "removed",
        "module_name": getattr(module, "name", "?"),
        "removed": len(matched),
        "remaining": len(existing_files) - len(matched),
        "files": details,
    }


# ---------------------------------------------------------------------------
# module helpers
# ---------------------------------------------------------------------------
