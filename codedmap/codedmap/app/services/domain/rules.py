"""Rules domain service functions."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from codedmap.app.services.pagination import paginate_sequence

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
    function_pattern: Optional[str] = None,
    project: str = ".",
) -> Dict[str, Any]:
    """Add an entrypoint rule to project YAML."""
    function_pattern = function_pattern or name
    rule_id = f"ep_{name.replace('.', '_')}"
    entry = {
        "id": rule_id,
        "name": name,
        "category": category,
        "patterns": [{"type": pattern_type, "function": function_pattern}],
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
    """Append a tombstone entry to a project YAML file, creating if needed."""
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

    existing_ids = {e.get("id") for e in data["tombstone"]}
    if rule_id in existing_ids:
        return  # Idempotent

    data["tombstone"].append({"id": rule_id, "reason": reason})
    yaml_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))
