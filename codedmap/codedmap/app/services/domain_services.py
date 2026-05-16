"""
codedmap.app.services.domain_services — Shared business logic for all domains.

This module is the SINGLE business implementation layer for all migrated domains.
Both API routers and CLI local adapters call these functions — no domain logic
belongs in the adapters (CLI commands or API routers).

Domain migration status (Plan 03-02):
  rules   - COMPLETE
  module  - COMPLETE
  repair  - COMPLETE
  query   - COMPLETE

Architecture contract:
  - Functions here receive plain Python values (str, int, list, dict, Optional[*])
  - Functions here return plain Python dicts/lists (no CLIResponse, no argparse.Namespace)
  - Storage access is through CPGStore or RuleRegistry — never raw SQL/Cypher
  - Agent provenance (created_by) is passed in explicitly — no env var reads here
"""

from __future__ import annotations

import fnmatch
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

from pydantic import BaseModel, Field
from codedmap.app.services.pagination import paginate_sequence
from codedmap.app.services.domain.note_visibility import (
    has_explicit_layer_filters,
    is_all_scope,
    note_matches_read_policy,
)
from codedmap.core.schema.catalog import RepairReason

logger = logging.getLogger(__name__)


@dataclass
class _ServiceModuleScope:
    name: str
    file_ids: set[int] = field(default_factory=set)


class _RepairEndpoint(BaseModel):
    node_id: int
    label: str
    name: str = "?"
    file: Optional[str] = None
    line: Optional[int] = None


class _RepairRecord(BaseModel):
    repair_id: str
    src: _RepairEndpoint
    dst: _RepairEndpoint
    reason: RepairReason = RepairReason.OTHER
    note: Optional[str] = None
    call_node_id: Optional[int] = None
    timestamp: float = Field(default_factory=time.time)


class _RepairRegistry:
    def __init__(self) -> None:
        self._repairs: Dict[str, _RepairRecord] = {}
        self._counter = 0

    def next_id(self) -> str:
        self._counter += 1
        return f"R{self._counter:03d}"

    def add(self, record: _RepairRecord) -> None:
        self._repairs[record.repair_id] = record

    def all(self) -> List[_RepairRecord]:
        return list(self._repairs.values())

    def get(self, repair_id: str) -> Optional[_RepairRecord]:
        return self._repairs.get(repair_id)

    def remove(self, repair_id: str) -> Optional[_RepairRecord]:
        return self._repairs.pop(repair_id, None)

    def clear(self) -> int:
        count = len(self._repairs)
        self._repairs.clear()
        self._counter = 0
        return count


_repair_registry = _RepairRegistry()


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
    unique_values: List[str] = []
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


def _resolve_module_scope(store, module: Optional[str], module_id: Optional[int]) -> Optional[_ServiceModuleScope]:
    from codedmap.analysis.traversal.module import ModuleNavigator
    from codedmap.core.schema.graph.enums import NodeLabel

    if module is None and module_id is None:
        return None

    nav = ModuleNavigator(store)
    if module_id is not None:
        node = store.get_node(module_id)
        label = getattr(node, "label", None)
        if hasattr(label, "value"):
            label = label.value
        if node is None or label != NodeLabel.MODULE.value:
            raise ValueError(f"Module not found: '{module_id}'")
        files = list(nav.get_files(node))
        return _ServiceModuleScope(
            name=getattr(node, "name", "?"),
            file_ids={f.id for f in files if getattr(f, "id", None) is not None},
        )

    matches = store.modules.find_by_name(module, exact_match=True)
    if not matches:
        matches = store.modules.find_by_name(module, exact_match=False)
    if not matches:
        raise ValueError(f"Module not found: '{module}'")
    if len(matches) > 1:
        raise ValueError(
            f"Ambiguous module: '{module}' matches {len(matches)} modules."
        )
    files = list(nav.get_files(matches[0]))
    return _ServiceModuleScope(
        name=getattr(matches[0], "name", "?"),
        file_ids={f.id for f in files if getattr(f, "id", None) is not None},
    )


def _filter_by_scope(nodes: list, scope: Optional[_ServiceModuleScope], store) -> list:
    if scope is None:
        return nodes
    result = []
    for node in nodes:
        node_id = getattr(node, "id", None)
        if node_id is None:
            continue
        file_node = store.ast.get_enclosing_file(node_id)
        if file_node is not None and file_node.id in scope.file_ids:
            result.append(node)
    return result


# ===========================================================================
# rules domain
# ===========================================================================

def rules_list(
    project: str = ".",
    rule_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    show_origin: bool = False,
) -> Dict[str, Any]:
    """List all active rules, optionally filtered by type.

    Args:
        project:     Project root directory path (for project-local YAML rules).
        rule_type:   Optional filter: one of sinks/sources/safe_functions/etc.
        show_origin: Include SDK_CORE vs LOCAL_OVERRIDE origin in each rule.

    Returns:
        Dict with keys: rules (list), total (int)
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()

    all_types = [
        "sinks", "sources", "safe_functions", "ontology",
        "sink_catalog", "entrypoints", "guards", "sanitizers",
    ]
    types_to_show = [rule_type] if rule_type else all_types

    nodes: List[dict] = []
    if show_origin:
        ruleset_map = {
            "sinks": registry.sinks,
            "sources": registry.sources,
            "safe_functions": registry.safe_functions,
            "ontology": registry.ontology,
            "sink_catalog": registry.sink_catalog,
            "entrypoints": registry.entrypoints,
            "guards": registry.guards,
            "sanitizers": registry.sanitizers,
        }
        for rt in types_to_show:
            ruleset = ruleset_map.get(rt)
            if ruleset is None:
                continue
            for mr in ruleset.active_rules():
                nodes.append({"rule_type": rt, "origin": mr.origin, "id": mr.id, **mr.data})
    else:
        for rt in types_to_show:
            active = registry.get_active_rules(rt)
            for r in active:
                nodes.append({"rule_type": rt, **r})

    page = paginate_sequence(nodes, offset=offset, limit=limit)
    return {
        "rules": page["items"],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def rules_categories(project: str = ".") -> Dict[str, Any]:
    """List valid L1 ontology categories per namespace.

    Returns:
        Dict with keys: namespaces (list of {namespace, categories, count}), total (int)
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()
    cats = registry.ontology_categories

    namespaces = [
        {"namespace": ns, "categories": sorted(entries), "count": len(entries)}
        for ns, entries in sorted(cats.items())
    ]
    return {
        "namespaces": namespaces,
        "total": sum(len(e) for e in cats.values()),
    }


def rules_show(project: str = ".") -> Dict[str, Any]:
    """Show full merged ruleset with origin and active/tombstoned status.

    Returns:
        Dict with keys: rules (list with id/origin/active/tombstone_reason), total (int)
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()

    all_types = {
        "sinks": registry.sinks,
        "sources": registry.sources,
        "safe_functions": registry.safe_functions,
        "ontology": registry.ontology,
        "sink_catalog": registry.sink_catalog,
        "entrypoints": registry.entrypoints,
        "guards": registry.guards,
        "sanitizers": registry.sanitizers,
    }

    nodes: List[dict] = []
    for rt, ruleset in all_types.items():
        for mr in ruleset.rules:
            entry = {
                "rule_type": rt,
                "id": mr.id,
                "origin": mr.origin,
                "active": mr.active,
                **mr.data,
            }
            if mr.tombstone_reason:
                entry["tombstone_reason"] = mr.tombstone_reason
            nodes.append(entry)

    return {"rules": nodes, "total": len(nodes)}


def rules_resolve(function_name: str, project: str = ".") -> Dict[str, Any]:
    """Resolve a function name against all rule types.

    Returns:
        Dict with keys: function (str), matches (list)
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()
    fn = function_name

    matches: List[dict] = []

    for mr in registry.sinks.rules:
        if mr.data.get("name") == fn:
            match = {
                "rule_type": "sinks",
                "id": mr.id,
                "origin": mr.origin,
                "active": mr.active,
                "category": mr.data.get("category"),
            }
            if mr.tombstone_reason:
                match["tombstone_reason"] = mr.tombstone_reason
            matches.append(match)

    for mr in registry.sources.rules:
        if mr.data.get("name") == fn:
            match = {
                "rule_type": "sources",
                "id": mr.id,
                "origin": mr.origin,
                "active": mr.active,
                "category": mr.data.get("category"),
            }
            if mr.tombstone_reason:
                match["tombstone_reason"] = mr.tombstone_reason
            matches.append(match)

    for mr in registry.safe_functions.rules:
        if mr.data.get("name") == fn:
            match = {
                "rule_type": "safe_functions",
                "id": mr.id,
                "origin": mr.origin,
                "active": mr.active,
            }
            if mr.tombstone_reason:
                match["tombstone_reason"] = mr.tombstone_reason
            matches.append(match)

    return {"function": fn, "matches": matches}


def rules_add_sink(
    name: str,
    category: str,
    project: str = ".",
) -> Dict[str, Any]:
    """Add a sink rule to project YAML.

    Returns:
        Dict with: action, rule_id, name, category
    Raises:
        ValueError: if category is not valid
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()
    category = category.upper()

    valid = registry.ontology_categories.get("SINK", [])
    if category not in valid:
        raise ValueError(
            f"Invalid SINK category '{category}'. Valid: {sorted(valid)}"
        )

    rule_id = f"sink_{name.replace('.', '_')}"
    _write_project_yaml(project_root, "sinks.yaml", "sinks", {
        "id": rule_id, "name": name, "category": category,
    })
    return {"action": "add-sink", "rule_id": rule_id, "name": name, "category": category}


def rules_add_source(
    name: str,
    category: str,
    project: str = ".",
) -> Dict[str, Any]:
    """Add a source rule to project YAML.

    Returns:
        Dict with: action, rule_id, name, category
    Raises:
        ValueError: if category is not valid
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()
    category = category.upper()

    valid = registry.ontology_categories.get("SOURCE", [])
    if category not in valid:
        raise ValueError(
            f"Invalid SOURCE category '{category}'. Valid: {sorted(valid)}"
        )

    rule_id = f"source_{name.replace('.', '_')}"
    _write_project_yaml(project_root, "sources.yaml", "sources", {
        "id": rule_id, "name": name, "category": category,
    })
    return {"action": "add-source", "rule_id": rule_id, "name": name, "category": category}


def rules_add_safe(name: str, project: str = ".") -> Dict[str, Any]:
    """Add a safe function to project YAML."""
    rule_id = f"safe_{name.replace('.', '_')}"
    project_root = Path(project).resolve()
    _write_project_yaml(project_root, "safe_functions.yaml", "safe_functions", {
        "id": rule_id, "name": name,
    })
    return {"action": "add-safe", "rule_id": rule_id, "name": name}


def rules_add_entrypoint(
    name: str,
    category: str = "cli",
    pattern_type: str = "function_name",
    func_pattern: Optional[str] = None,
    project: str = ".",
) -> Dict[str, Any]:
    """Add an entrypoint rule to project YAML."""
    func_pattern = func_pattern or name
    rule_id = f"ep_{name.replace('.', '_')}"
    entry = {
        "id": rule_id,
        "name": name,
        "category": category,
        "patterns": [{"type": pattern_type, "function": func_pattern}],
    }
    project_root = Path(project).resolve()
    _write_project_yaml(project_root, "entrypoints.yaml", "rules", entry)
    return {"action": "add-entrypoint", "rule_id": rule_id, **entry}


def rules_tombstone(
    rule_id: str,
    reason: str,
    project: str = ".",
) -> Dict[str, Any]:
    """Tombstone a global rule by ID.

    Returns:
        Dict with: rule_id, rule_type, reason, action
    Raises:
        ValueError: if rule_id is not found in any rule type
    """
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    registry = RuleRegistry(project_root=project_root).load()

    type_map = {
        "sinks": registry.sinks,
        "sources": registry.sources,
        "safe_functions": registry.safe_functions,
        "ontology": registry.ontology,
        "sink_catalog": registry.sink_catalog,
        "entrypoints": registry.entrypoints,
    }
    file_map = {
        "sinks": "sinks.yaml",
        "sources": "sources.yaml",
        "safe_functions": "safe_functions.yaml",
        "ontology": "ontology.yaml",
        "sink_catalog": "sink_catalog.yaml",
        "entrypoints": "entrypoints.yaml",
    }

    found_type = None
    for rt, ruleset in type_map.items():
        mr = ruleset.by_id(rule_id)
        if mr is not None:
            found_type = rt
            break

    if found_type is None:
        raise ValueError(f"Rule ID '{rule_id}' not found in any rule type.")

    _write_tombstone_yaml(project_root, file_map[found_type], rule_id, reason)
    return {"rule_id": rule_id, "rule_type": found_type, "reason": reason, "action": "tombstoned"}


def rules_validate(project: str = ".") -> Dict[str, Any]:
    """Validate all project YAML rule files.

    Returns:
        Dict with: valid (bool), issues (list), total_issues (int)
    """
    import yaml
    from codedmap.infra.rules import RuleRegistry

    project_root = Path(project).resolve()
    rules_dir = project_root / ".cpg" / "rules"

    issues: List[dict] = []

    if not rules_dir.is_dir():
        return {
            "valid": True,
            "issues": [],
            "message": "No project rules directory (.cpg/rules/) found.",
            "total_issues": 0,
        }

    valid_stems = {"sinks", "sources", "safe_functions", "ontology", "sink_catalog", "entrypoints"}
    for yaml_path in sorted(rules_dir.glob("*.yaml")):
        try:
            data = yaml.safe_load(yaml_path.read_text())
        except yaml.YAMLError as e:
            issues.append({
                "file": str(yaml_path.name),
                "severity": "error",
                "message": f"YAML parse error: {e}",
            })
            continue

        if not data:
            issues.append({
                "file": str(yaml_path.name),
                "severity": "warning",
                "message": "Empty YAML file",
            })
            continue

        if yaml_path.stem not in valid_stems:
            issues.append({
                "file": str(yaml_path.name),
                "severity": "warning",
                "message": f"Unknown rule file (expected one of: {', '.join(sorted(valid_stems))})",
            })

        if data.get("version") is None:
            issues.append({
                "file": str(yaml_path.name),
                "severity": "warning",
                "message": "Missing 'version' field",
            })

    registry = None
    try:
        registry = RuleRegistry(project_root=project_root).load()
    except (ValueError, KeyError) as e:
        issues.append({
            "file": ".cpg/rules/",
            "severity": "error",
            "message": f"Registry load error: {e}",
        })

    if registry is not None:
        cats = registry.ontology_categories
        all_sink_cats = set(cats.get("SINK", []))
        all_source_cats = set(cats.get("SOURCE", []))

        for mr in registry.sinks.rules:
            if mr.origin == "LOCAL_OVERRIDE" and mr.active:
                cat = mr.data.get("category", "")
                if cat and cat not in all_sink_cats:
                    issues.append({
                        "file": "sinks.yaml",
                        "severity": "error",
                        "message": f"Invalid sink category '{cat}' for rule '{mr.id}'. "
                                   f"Valid: {sorted(all_sink_cats)}",
                    })

        for mr in registry.sources.rules:
            if mr.origin == "LOCAL_OVERRIDE" and mr.active:
                cat = mr.data.get("category", "")
                if cat and cat not in all_source_cats:
                    issues.append({
                        "file": "sources.yaml",
                        "severity": "error",
                        "message": f"Invalid source category '{cat}' for rule '{mr.id}'. "
                                   f"Valid: {sorted(all_source_cats)}",
                    })

        global_registry = RuleRegistry().load()
        global_type_map = {
            "sinks": global_registry.sinks,
            "sources": global_registry.sources,
            "safe_functions": global_registry.safe_functions,
            "ontology": global_registry.ontology,
            "sink_catalog": global_registry.sink_catalog,
            "entrypoints": global_registry.entrypoints,
        }
        for yaml_path in sorted(rules_dir.glob("*.yaml")):
            try:
                data = yaml.safe_load(yaml_path.read_text())
            except yaml.YAMLError:
                continue
            if not data:
                continue
            tombstones = data.get("tombstone", [])
            stem = yaml_path.stem
            global_ruleset = global_type_map.get(stem)
            for ts in tombstones:
                ts_id = ts.get("id", "?")
                if global_ruleset and global_ruleset.by_id(ts_id) is None:
                    issues.append({
                        "file": yaml_path.name,
                        "severity": "warning",
                        "message": f"Orphaned tombstone: '{ts_id}' not found in global rules",
                    })

    valid = not any(i["severity"] == "error" for i in issues)
    return {"valid": valid, "issues": issues, "total_issues": len(issues)}


# ---------------------------------------------------------------------------
# rules YAML write helpers
# ---------------------------------------------------------------------------

def _write_project_yaml(project_root: Path, filename: str, list_key: str, entry: dict) -> None:
    """Append a rule entry to a project YAML file, creating if needed."""
    import yaml

    rules_dir = project_root / ".cpg" / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    yaml_path = rules_dir / filename

    if yaml_path.exists():
        data = yaml.safe_load(yaml_path.read_text()) or {}
    else:
        data = {"version": 1}

    if "version" not in data:
        data["version"] = 1
    if list_key not in data:
        data[list_key] = []

    existing_ids = {e.get("id") for e in data[list_key]}
    if entry.get("id") in existing_ids:
        return  # Idempotent

    data[list_key].append(entry)
    yaml_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))


def _write_tombstone_yaml(project_root: Path, filename: str, rule_id: str, reason: str) -> None:
    """Append a tombstone entry to a project YAML file."""
    import yaml

    rules_dir = project_root / ".cpg" / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    yaml_path = rules_dir / filename

    if yaml_path.exists():
        data = yaml.safe_load(yaml_path.read_text()) or {}
    else:
        data = {"version": 1}

    if "version" not in data:
        data["version"] = 1
    if "tombstone" not in data:
        data["tombstone"] = []

    existing_ids = {t.get("id") for t in data["tombstone"]}
    if rule_id in existing_ids:
        return  # Idempotent

    data["tombstone"].append({"id": rule_id, "reason": reason})
    yaml_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))


# ===========================================================================
# module domain
# ===========================================================================

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
        module = _resolve_module(store, name)
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
    module = _resolve_module(store, name)
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

    module = _resolve_module(store, name)
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
    module = _resolve_module(store, name)
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

    module = _resolve_module(store, name)
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

def _resolve_module(store, name: str):
    """Resolve a module by name: exact match, then fuzzy.

    Raises:
        ValueError: if not found or ambiguous (with structured info)
    """
    matches = store.modules.find_by_name(name, exact_match=True)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        matches = store.modules.find_by_name(name, exact_match=False)
    if not matches:
        raise ValueError(f"Module not found: '{name}'")
    if len(matches) > 1:
        raise ValueError(f"Ambiguous module: '{name}' matches {len(matches)} modules.")
    return matches[0]


# ===========================================================================
# repair domain
# ===========================================================================

def _scan_repair_records(store) -> List[_RepairRecord]:
    """Reconstruct repair records by scanning persisted edges.

    Each repair_link writes two edges sharing a `repair_id` property:
      METHOD --[AST {repair_id}]--> CallNode --[CALL {repair_id, reason}]--> METHOD
    The synthetic CallNode id is the unique identity for a repair (repair_id
    can collide if older builds reused R### counters across processes), so we
    group by call_node_id and surface repair_id as a display field. This is the
    source of truth for cross-process list/undo — the in-memory _repair_registry
    singleton is no longer load-bearing.
    """
    from codedmap.core.schema.graph.enums import EdgeType

    grouped: Dict[int, Dict[str, Any]] = {}
    for edge in store.edges.all():
        rid = edge.properties.get("repair_id")
        if not rid:
            continue
        etype = edge.type.value if hasattr(edge.type, "value") else edge.type
        if etype == EdgeType.AST.value:
            bucket = grouped.setdefault(edge.dst, {})
            bucket["ast"] = edge
            bucket["repair_id"] = rid
        elif etype == EdgeType.CALL.value:
            bucket = grouped.setdefault(edge.src, {})
            bucket["call"] = edge
            bucket["repair_id"] = rid

    records: List[_RepairRecord] = []
    for call_node_id, bucket in grouped.items():
        ast_edge = bucket.get("ast")
        call_edge = bucket.get("call")
        rid = bucket.get("repair_id")
        if ast_edge is None or call_edge is None or rid is None:
            continue  # half-applied, skip
        src_node = store.get_node(ast_edge.src)
        dst_node = store.get_node(call_edge.dst)
        if src_node is None or dst_node is None:
            continue

        def _label_str(node):
            lbl = getattr(node, "label", "UNKNOWN")
            return lbl.value if hasattr(lbl, "value") else str(lbl)

        try:
            reason_enum = RepairReason(call_edge.properties.get("reason", "other"))
        except ValueError:
            reason_enum = RepairReason.OTHER

        records.append(_RepairRecord(
            repair_id=rid,
            src=_RepairEndpoint(
                node_id=ast_edge.src,
                label=_label_str(src_node),
                name=getattr(src_node, "name", "?"),
                file=getattr(src_node, "file_name", None),
                line=getattr(src_node, "line_number", None),
            ),
            dst=_RepairEndpoint(
                node_id=call_edge.dst,
                label=_label_str(dst_node),
                name=getattr(dst_node, "name", "?"),
                file=getattr(dst_node, "file_name", None),
                line=getattr(dst_node, "line_number", None),
            ),
            reason=reason_enum,
            note=ast_edge.properties.get("note") or call_edge.properties.get("note"),
            call_node_id=call_node_id,
        ))
    return records


def _next_repair_id(store) -> str:
    """Allocate next repair_id by scanning DB for max R### already in use."""
    max_n = 0
    for record in _scan_repair_records(store):
        rid = record.repair_id
        if isinstance(rid, str) and rid.startswith("R"):
            try:
                max_n = max(max_n, int(rid[1:]))
            except ValueError:
                continue
    return f"R{max_n + 1:03d}"


def repair_list(store) -> Dict[str, Any]:
    """List all active repairs (persisted; reconstructed from edge scan).

    Returns:
        Dict with: action, repairs (list), total (int)
    """
    records = _scan_repair_records(store)
    records.sort(key=lambda r: (r.repair_id, r.call_node_id or 0))
    repair_dicts = [r.model_dump(mode="json") for r in records]
    return {"action": "list", "repairs": repair_dicts, "total": len(repair_dicts)}


def repair_suggest(
    store,
    limit: int = 100,
    offset: int = 0,
    max_candidates: int = 3,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Find unresolved CALL nodes with repair candidates.

    Implements suggest logic directly (no stdout capture).

    Returns:
        Dict with keys: action, unresolved (list), total (int)
    """
    from difflib import SequenceMatcher
    from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

    all_calls = store.query.all_nodes(NodeLabel.CALL).to_list()

    # Filter to unresolved (no outgoing CALL edge) and non-operator
    unresolved = []
    for node in all_calls:
        name = getattr(node, "name", "")
        if name.startswith("<operator>."):
            continue
        neighbors = store.get_neighbors(node.id, "OUT", [EdgeType.CALL.value])
        if not neighbors:
            unresolved.append(node)

    # Module scope filtering
    if module or module_id:
        scope = _resolve_module_scope(store, module=module, module_id=module_id)
        if scope:
            unresolved = _filter_by_scope(unresolved, scope, store)

    # Find candidate METHOD nodes for each unresolved call
    all_methods = store.query.all_nodes(NodeLabel.METHOD).to_list()

    entries = []
    for call_node in unresolved:
        call_name = (
            getattr(call_node, "method_full_name", "") or
            getattr(call_node, "name", "")
        )

        candidates = []
        for method in all_methods:
            method_name = (
                getattr(method, "full_name", "") or
                getattr(method, "name", "")
            )
            score = SequenceMatcher(None, call_name, method_name).ratio()
            if score > 0.3:
                candidates.append({
                    "node_id": method.id,
                    "name": getattr(method, "name", "?"),
                    "full_name": getattr(method, "full_name", "?"),
                    "file": getattr(method, "file_name", None),
                    "line": getattr(method, "line_number", None),
                    "score": round(score, 3),
                })

        candidates.sort(key=lambda c: c["score"], reverse=True)
        candidates = candidates[:max_candidates]

        entries.append({
            "call_site": {
                "node_id": call_node.id,
                "name": getattr(call_node, "name", "?"),
                "method_full_name": getattr(call_node, "method_full_name", "?"),
                "file": getattr(call_node, "file_name", None),
                "line": getattr(call_node, "line_number", None),
            },
            "candidates": candidates,
        })

    page = paginate_sequence(entries, offset=offset, limit=limit)
    return {
        "action": "suggest",
        "unresolved": page["items"],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def repair_link(
    store,
    from_id: int,
    to_id: int,
    reason: "RepairReason | str" = RepairReason.OTHER,
    note: Optional[str] = None,
    created_by: str = "service@repair:link",
) -> Dict[str, Any]:
    """Create a missing CALL edge between two functions.

    Creates a synthetic CallNode as AST child of the caller METHOD, then
    connects it to the callee METHOD via a CALL edge.  This matches the
    standard CPG structure: METHOD -[:AST]-> CALL -[:CALL]-> METHOD,
    which get_callees/get_callers traversals expect.

    Returns:
        Dict with link result (status, repair_id, from, to, reason).
    Raises:
        ValueError: if either node is not found, or if `reason` is not a
            valid `RepairReason`. Validation runs before any graph mutation
            so a bad reason cannot leave a dangling CALL edge behind.
    """
    try:
        reason_enum = reason if isinstance(reason, RepairReason) else RepairReason(reason)
    except ValueError as exc:
        valid = ", ".join(r.value for r in RepairReason)
        raise ValueError(
            f"Invalid repair reason '{reason}'. Valid values: {valid}"
        ) from exc

    from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, DispatchType
    from codedmap.core.schema.graph.patch import GraphPatch
    from codedmap.core.schema.graph.nodes.expressions import CallNode

    src_node = store.get_node(from_id)
    dst_node = store.get_node(to_id)

    if src_node is None or dst_node is None:
        missing = []
        if src_node is None:
            missing.append(f"src={from_id}")
        if dst_node is None:
            missing.append(f"dst={to_id}")
        raise ValueError(f"Node not found: {', '.join(missing)}")

    # Check for existing call relationship (CallNode child of src with CALL edge to dst)
    call_nodes = store.get_neighbors(from_id, "OUT", [EdgeType.AST.value])
    for cid in call_nodes:
        cnode = store.get_node(cid)
        if cnode and getattr(cnode, "label", None) == NodeLabel.CALL:
            callee_neighbors = store.get_neighbors(cid, "OUT", [EdgeType.CALL.value])
            if to_id in callee_neighbors:
                return {
                    "status": "already_linked",
                    "repair_id": None,
                    "from": getattr(src_node, "name", "?"),
                    "to": getattr(dst_node, "name", "?"),
                    "reason": reason_enum.value,
                }

    repair_id = _next_repair_id(store)

    callee_name = getattr(dst_node, "name", "?")
    callee_full_name = getattr(dst_node, "full_name", None) or callee_name
    caller_file = getattr(src_node, "file_name", None)

    call_node = CallNode(
        name=callee_name,
        methodFullName=callee_full_name,
        dispatchType=DispatchType.STATIC_DISPATCH,
        file_name=caller_file,
        code=f"{callee_name}()",
    )

    def _label_str(node):
        lbl = getattr(node, "label", "UNKNOWN")
        return lbl.value if hasattr(lbl, "value") else str(lbl)

    record = _RepairRecord(
        repair_id=repair_id,
        src=_RepairEndpoint(
            node_id=getattr(src_node, "id", 0),
            label=_label_str(src_node),
            name=getattr(src_node, "name", "?"),
            file=getattr(src_node, "file_name", None),
            line=getattr(src_node, "line_number", None),
        ),
        dst=_RepairEndpoint(
            node_id=getattr(dst_node, "id", 0),
            label=_label_str(dst_node),
            name=getattr(dst_node, "name", "?"),
            file=getattr(dst_node, "file_name", None),
            line=getattr(dst_node, "line_number", None),
        ),
        reason=reason_enum,
        note=note,
        call_node_id=call_node.id,
    )

    patch = GraphPatch(created_by=created_by)
    patch.add_node(call_node)
    ast_props: Dict[str, Any] = {"repair_id": repair_id}
    call_props: Dict[str, Any] = {"repair_id": repair_id, "reason": reason_enum.value}
    if note:
        ast_props["note"] = note
        call_props["note"] = note
    patch.add_edge(from_id, call_node.id, EdgeType.AST, **ast_props)
    patch.add_edge(call_node.id, to_id, EdgeType.CALL, **call_props)
    store.apply_patch(patch)

    _repair_registry.add(record)

    return {
        "status": "linked",
        "repair_id": repair_id,
        "from": record.src.model_dump(mode="json"),
        "to": record.dst.model_dump(mode="json"),
        "reason": reason_enum.value,
    }


def repair_undo(
    store,
    repair_id: Optional[str] = None,
    undo_all: bool = False,
    created_by: str = "service@repair:undo",
) -> Dict[str, Any]:
    """Undo a repair (or all repairs).

    Reads repair records from the persisted graph (edge `repair_id` property)
    so this works across CLI processes, not just within the in-memory registry.

    Returns:
        Dict with: action, undone
    Raises:
        ValueError: if neither repair_id nor undo_all is specified.
    """
    from codedmap.core.schema.graph.enums import EdgeType
    from codedmap.core.schema.graph.patch import GraphPatch

    if not repair_id and not undo_all:
        raise ValueError("Specify repair_id or set undo_all=True")

    records = _scan_repair_records(store)

    if undo_all:
        if not records:
            return {"action": "undo_all", "undone": 0}
        patch = GraphPatch(created_by=created_by)
        for r in records:
            if r.call_node_id is not None:
                patch.remove_edge(r.call_node_id, r.dst.node_id, EdgeType.CALL)
                patch.remove_edge(r.src.node_id, r.call_node_id, EdgeType.AST)
                patch.remove_node(r.call_node_id)
            else:
                patch.remove_edge(r.src.node_id, r.dst.node_id, EdgeType.CALL)
        store.apply_patch(patch)
        for r in records:
            _repair_registry.remove(r.repair_id)
        return {"action": "undo_all", "undone": len(records)}
    else:
        matches = [r for r in records if r.repair_id == repair_id]
        if not matches:
            mem = _repair_registry.get(repair_id)
            if mem is None:
                raise ValueError(f"Repair '{repair_id}' not found")
            matches = [mem]
        if len(matches) > 1:
            raise ValueError(
                f"Repair id '{repair_id}' is ambiguous ({len(matches)} edges share it). "
                f"Use undo_all=True or rebuild the graph to clean legacy duplicates."
            )
        record = matches[0]
        patch = GraphPatch(created_by=created_by)
        if record.call_node_id is not None:
            patch.remove_edge(record.call_node_id, record.dst.node_id, EdgeType.CALL)
            patch.remove_edge(record.src.node_id, record.call_node_id, EdgeType.AST)
            patch.remove_node(record.call_node_id)
        else:
            patch.remove_edge(record.src.node_id, record.dst.node_id, EdgeType.CALL)
        store.apply_patch(patch)
        _repair_registry.remove(repair_id)
        return {"action": "undo", "undone": 1, "repair_id": repair_id}


# ===========================================================================
# query domain — note: query already largely accesses store directly.
# These service functions extract any remaining cli.commands.* dependencies.
# ===========================================================================

def query_entrypoints_parse_tags(tags: List[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Parse entry-point level/category/rule from tag list.

    Extracted from cli.commands.entrypoints._parse_tags so API router
    does not need to import from cli.commands.*.
    """
    ep_level = None
    ep_category = None
    rule = None
    for tag in tags:
        if tag.startswith("ONTOLOGY:ENTRY_POINT:"):
            parts = tag.split(":")
            if len(parts) >= 4:
                ep_level = "L1"
                ep_category = parts[2]
                rule = parts[3]
        elif tag.startswith("SEMANTIC:ENTRY_POINT:"):
            parts = tag.split(":")
            if len(parts) >= 4:
                ep_level = "L2"
                ep_category = parts[2]
                rule = parts[3]
    return ep_level, ep_category, rule


def query_roles_parse_tags(tags: List[str]) -> Optional[str]:
    """Parse role category from tag list.

    Extracted from cli.commands.roles._parse_role_tags.
    """
    for tag in tags:
        if tag.startswith("ONTOLOGY:ROLE:") or tag.startswith("SEMANTIC:ROLE:"):
            parts = tag.split(":")
            if len(parts) >= 3:
                return parts[2]
    return None


# ===========================================================================
# tag domain
# ===========================================================================

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
        scope = _resolve_module_scope(store, module=module, module_id=module_id)
        if scope:
            results = _filter_by_scope(results, scope, store)

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


# ===========================================================================
# note domain
# ===========================================================================

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
        note
        for note in insights
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
        "metadata": {
            "scope": getattr(node, "scope", "campaign"),
            "knowledge_class": getattr(node, "knowledge_class", "assessment"),
            "campaign_id": getattr(node, "campaign_id", None),
            "review_state": getattr(node, "review_state", "unreviewed"),
            "visibility": getattr(node, "visibility", "default"),
            "evidence_bundle": getattr(node, "evidence_bundle", {}) or {},
            "promoted_from": getattr(node, "promoted_from", None),
        },
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
    node = store.insights.get_by_id(note_id)
    if node is None:
        raise ValueError(f"Note {note_id} not found")

    metadata = {
        "scope": getattr(node, "scope", "campaign"),
        "knowledge_class": getattr(node, "knowledge_class", "assessment"),
        "campaign_id": getattr(node, "campaign_id", None),
        "promoted_from": getattr(node, "promoted_from", None),
    }
    if metadata["scope"] != "campaign":
        raise ValueError("Only campaign notes can be promoted")
    if metadata["knowledge_class"] != "fact":
        raise ValueError("Only fact notes can be promoted")

    store.insights.update(
        note_id,
        scope="stable_candidate",
        review_state="ai_supported",
        campaign_id=None,
        promoted_from=metadata["campaign_id"] or metadata["promoted_from"],
    )
    return note_show(store, note_id)


def note_confirm(
    store,
    note_id: int,
    created_by: str = "service@note:confirm",
) -> Dict[str, Any]:
    del created_by
    node = store.insights.get_by_id(note_id)
    if node is None:
        raise ValueError(f"Note {note_id} not found")
    if getattr(node, "scope", "campaign") != "stable_candidate":
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
    from codedmap.app.audit.service import append_event, summarize_note

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
