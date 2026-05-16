"""Shared query-domain service helpers for CLI/API adapters."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Optional

from codedmap.app.services.domain_services import (
    query_entrypoints_parse_tags,
    query_roles_parse_tags,
)
from codedmap.app.services.scope_utils import resolve_module_scope, filter_by_scope
from codedmap.app.services.pagination import paginate_sequence


class QueryServiceError(Exception):
    """Transport-agnostic query service error."""

    def __init__(self, code: str, message: str, details: Optional[dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def list_sources(
    store,
    category: Optional[str] = None,
    function_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.analysis.detection.source_detector import SourceDetector

    all_sources = SourceDetector(store).detect_all()
    if category:
        all_sources = [s for s in all_sources if s.category.value == category]
    if function_filter:
        fn = function_filter.lower()
        all_sources = [s for s in all_sources if fn in s.name.lower()]

    page = paginate_sequence(all_sources if not show_all else all_sources, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_sources)
        page["offset"] = 0
        page["limit"] = max(len(all_sources), 1)
        page["has_more"] = False
        page["truncated"] = False
    return {
        "nodes": [s.to_dict() for s in page["items"]],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def list_sinks(
    store,
    category: Optional[str] = None,
    function_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.analysis.detection.sink_detector import SinkDetector

    all_sinks = SinkDetector(store).detect_all()
    if category:
        all_sinks = [s for s in all_sinks if s.category.value == category]
    if function_filter:
        fn = function_filter.lower()
        all_sinks = [s for s in all_sinks if fn in s.name.lower()]

    page = paginate_sequence(all_sinks if not show_all else all_sinks, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_sinks)
        page["offset"] = 0
        page["limit"] = max(len(all_sinks), 1)
        page["has_more"] = False
        page["truncated"] = False
    return {
        "nodes": [s.to_dict() for s in page["items"]],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def list_guards(
    store,
    category: Optional[str] = None,
    function_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.analysis.detection.guard_detector import GuardDetector

    all_guards = GuardDetector(store).detect_all()
    if category:
        all_guards = [g for g in all_guards if g.category.value == category]
    if function_filter:
        fn = function_filter.lower()
        all_guards = [g for g in all_guards if fn in g.name.lower()]

    page = paginate_sequence(all_guards if not show_all else all_guards, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_guards)
        page["offset"] = 0
        page["limit"] = max(len(all_guards), 1)
        page["has_more"] = False
        page["truncated"] = False
    return {
        "nodes": [g.to_dict() for g in page["items"]],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def list_sanitizers(
    store,
    category: Optional[str] = None,
    function_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.analysis.detection.sanitizer_detector import SanitizerDetector

    all_sanitizers = SanitizerDetector(store).detect_all()
    if category:
        all_sanitizers = [s for s in all_sanitizers if s.category.value == category]
    if function_filter:
        fn = function_filter.lower()
        all_sanitizers = [s for s in all_sanitizers if fn in s.name.lower()]

    page = paginate_sequence(all_sanitizers if not show_all else all_sanitizers, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_sanitizers)
        page["offset"] = 0
        page["limit"] = max(len(all_sanitizers), 1)
        page["has_more"] = False
        page["truncated"] = False
    return {
        "nodes": [s.to_dict() for s in page["items"]],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
    }


def query_entrypoints_nodes(
    store,
    level: Optional[str] = None,
    category: Optional[str] = None,
    entry_type: Optional[str] = None,
    file_filter: Optional[str] = None,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.app.query.root import CPG

    cpg = CPG(store)
    scope = resolve_module_scope(store, module=module, module_id=module_id) if (module or module_id) else None

    query = cpg.entry_points(level=level, category=category, type=entry_type)
    if file_filter:
        query = query.file(file_filter)

    all_nodes = query.to_list()

    if scope is not None:
        all_nodes = filter_by_scope(all_nodes, scope, store)
    page = paginate_sequence(all_nodes if not show_all else all_nodes, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_nodes)
        page["offset"] = 0
        page["limit"] = max(len(all_nodes), 1)
        page["has_more"] = False
        page["truncated"] = False

    return {
        "display_nodes": page["items"],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
        "scope": scope,
    }


def list_entrypoints(
    store,
    level: Optional[str] = None,
    category: Optional[str] = None,
    entry_type: Optional[str] = None,
    file_filter: Optional[str] = None,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.app.contracts.response import _node_to_dict

    query_data = query_entrypoints_nodes(
        store=store,
        level=level,
        category=category,
        entry_type=entry_type,
        file_filter=file_filter,
        module=module,
        module_id=module_id,
        limit=limit,
        offset=offset,
        show_all=show_all,
    )
    display_nodes = query_data["display_nodes"]
    scope = query_data["scope"]

    nodes = []
    for node in display_nodes:
        tags = getattr(node, "tags", [])
        ep_level, ep_category, rule = query_entrypoints_parse_tags(tags)
        nodes.append(
            {
                **_node_to_dict(node, store=store),
                "level": ep_level,
                "category": ep_category,
                "type": rule,
                "tags": tags,
                "full_name": getattr(node, "fullName", None) or getattr(node, "full_name", None),
            }
        )

    return {
        "nodes": nodes,
        "total": query_data["total"],
        "offset": query_data["offset"],
        "limit": query_data["limit"],
        "has_more": query_data["has_more"],
        "truncated": query_data["truncated"],
        "scope": scope,
        "display_nodes": display_nodes,
    }


def list_roles(
    store,
    category: Optional[str] = None,
    function_filter: Optional[str] = None,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    show_all: bool = False,
) -> dict:
    from codedmap.app.contracts.response import _node_to_dict
    from codedmap.app.query.root import CPG

    cpg = CPG(store)
    scope = resolve_module_scope(store, module=module, module_id=module_id) if (module or module_id) else None

    query = cpg.roles(category=category)
    if function_filter:
        query = query.name(function_filter)

    all_nodes = query.to_list()

    if scope is not None:
        all_nodes = filter_by_scope(all_nodes, scope, store)
    page = paginate_sequence(all_nodes if not show_all else all_nodes, offset=offset, limit=limit)
    if show_all:
        page["items"] = list(all_nodes)
        page["offset"] = 0
        page["limit"] = max(len(all_nodes), 1)
        page["has_more"] = False
        page["truncated"] = False
    display_nodes = page["items"]

    nodes = []
    for node in display_nodes:
        tags = getattr(node, "tags", [])
        role_cat = query_roles_parse_tags(tags)
        nodes.append(
            {
                **_node_to_dict(node, store=store),
                "category": role_cat,
                "justification": "",
                "tags": tags,
                "full_name": getattr(node, "fullName", None) or getattr(node, "full_name", None),
            }
        )

    return {
        "nodes": nodes,
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
        "scope": scope,
    }


def search_nodes(
    store,
    pattern: str,
    node_type: str = "method",
    limit: int = 20,
    offset: int = 0,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
) -> dict:
    from codedmap.app.contracts.response import _node_to_dict
    from codedmap.app.query.root import CPG

    if not pattern:
        raise QueryServiceError("INVALID_ARGUMENT", "Pattern is required")

    cpg = CPG(store)
    scope = resolve_module_scope(store, module=module, module_id=module_id) if (module or module_id) else None

    type_map = {"method": cpg.method, "call": cpg.call, "identifier": cpg.identifier}
    resolved_type = node_type if node_type in type_map else "method"
    results = type_map[resolved_type]().name_matches(pattern).run()

    if scope is not None:
        results = filter_by_scope(results, scope, store)

    page = paginate_sequence(results, offset=offset, limit=limit)
    return {
        "nodes": [_node_to_dict(n, store=store) for n in page["items"]],
        "total": page["total"],
        "offset": page["offset"],
        "limit": page["limit"],
        "has_more": page["has_more"],
        "truncated": page["truncated"],
        "scope": scope,
    }


def _is_audited(store, node) -> bool:
    tags = getattr(node, "tags", [])
    if "STATE:AUDITED" in tags:
        return True
    try:
        neighbors = store.get_neighbors(node.id, "OUT", ["HAS_INSIGHT"])
        return len(neighbors) > 0
    except Exception:
        return False


def _breakdown(nodes, prefix):
    from codedmap.app.query.models import CategoryBreakdown

    counter = Counter()
    for node in nodes:
        for tag in getattr(node, "tags", []):
            if tag.startswith(prefix):
                counter[tag.split(":")[-1]] += 1
    top3 = [{k: v} for k, v in counter.most_common(3)]
    return CategoryBreakdown(total=len(nodes), top_categories=top3)


def _audit_progress(store, nodes):
    from codedmap.app.query.models import AuditProgress

    total = len(nodes)
    audited = sum(1 for n in nodes if _is_audited(store, n))
    pct = round(audited / total * 100, 1) if total > 0 else 0.0
    return AuditProgress(total=total, audited=audited, percent=pct)


def _scoped_stats(store, scope):
    from codedmap.app.query.root import CPG
    from codedmap.app.query.models import TacticalStats, MethodHotSpot

    cpg = CPG(store)

    ep_nodes = filter_by_scope(cpg.tagger.find("ONTOLOGY:ENTRY_POINT:*"), scope, store)
    src_nodes = filter_by_scope(cpg.tagger.find("ONTOLOGY:SOURCE:*"), scope, store)
    sink_nodes = filter_by_scope(cpg.tagger.find("ONTOLOGY:SINK:*"), scope, store)
    guard_nodes = filter_by_scope(cpg.tagger.find("ONTOLOGY:GUARD:*"), scope, store)
    san_nodes_o = filter_by_scope(cpg.tagger.find("ONTOLOGY:SANITIZER:*"), scope, store)
    san_nodes_s = filter_by_scope(cpg.tagger.find("SEMANTIC:SANITIZER:*"), scope, store)
    sanitizer_ids = (
        {getattr(n, "id", None) for n in san_nodes_o}
        | {getattr(n, "id", None) for n in san_nodes_s}
    )

    method_sinks = defaultdict(int)
    method_sources = defaultdict(int)
    method_info = {}
    for node in sink_nodes:
        if _is_audited(store, node):
            continue
        methods = store.query.by_id(node.id).methods().to_list()
        if not methods:
            continue
        m = methods[0]
        method_sinks[m.id] += 1
        method_info[m.id] = (getattr(m, "name", "?"), getattr(m, "file_name", None), getattr(m, "line_number", None))
    for node in src_nodes:
        if _is_audited(store, node):
            continue
        methods = store.query.by_id(node.id).methods().to_list()
        if not methods:
            continue
        m = methods[0]
        method_sources[m.id] += 1
        method_info[m.id] = (getattr(m, "name", "?"), getattr(m, "file_name", None), getattr(m, "line_number", None))

    all_mids = set(method_sinks) | set(method_sources)
    scored = []
    for mid in all_mids:
        s, r = method_sinks[mid], method_sources[mid]
        name, file, line = method_info[mid]
        scored.append(MethodHotSpot(
            node_id=mid, name=name, file=file, line=line,
            score=(s * 2) + r, unaudited_sinks=s, unaudited_sources=r,
        ))
    scored.sort(key=lambda x: x.score, reverse=True)

    try:
        all_insights = store.insights.find_all_insights(limit=500)
        scoped_insights = filter_by_scope(all_insights, scope, store)
        notes_total = len(scoped_insights)
        cat_counter = Counter()
        for ins in scoped_insights:
            cat = getattr(ins, "category", "UNKNOWN")
            cat_counter[cat.value if hasattr(cat, "value") else str(cat)] += 1
        notes_by_cat = dict(cat_counter)
    except Exception:
        notes_total = 0
        notes_by_cat = {}

    ts = TacticalStats(
        total_nodes=scope.file_count + scope.method_count,
        total_edges=-1,
        files=scope.file_count,
        methods=scope.method_count,
        modules=1,
        languages=[],
        entry_points=_breakdown(ep_nodes, "ONTOLOGY:ENTRY_POINT:"),
        sources=_breakdown(src_nodes, "ONTOLOGY:SOURCE:"),
        sinks=_breakdown(sink_nodes, "ONTOLOGY:SINK:"),
        guards=len(guard_nodes),
        sanitizers=len(sanitizer_ids - {None}),
        entry_point_audit=_audit_progress(store, ep_nodes),
        source_audit=_audit_progress(store, src_nodes),
        sink_audit=_audit_progress(store, sink_nodes),
        notes_total=notes_total,
        notes_by_category=notes_by_cat,
        repairs_total=0,
        hot_spots=scored[:5],
        hot_spots_total_methods=len(scored),
        suggested_commands=[],
    )
    return ts.model_dump(mode="json")


def stats_summary(
    store,
    module: Optional[str] = None,
    module_id: Optional[int] = None,
) -> dict:
    from codedmap.app.query.root import CPG

    scope = resolve_module_scope(store, module=module, module_id=module_id) if (module or module_id) else None
    if scope is not None:
        return {
            "result": _scoped_stats(store, scope),
            "total": scope.file_count + scope.method_count,
            "scope": scope,
        }

    cpg = CPG(store)
    ts = cpg.tactical_stats()
    return {
        "result": ts.model_dump(mode="json"),
        "total": ts.total_nodes,
        "scope": None,
    }


def tree_skeleton(store, depth: int = 5, style: str = "ascii") -> dict:
    from codedmap.app.query.root import CPG

    cpg = CPG(store)
    skeleton = cpg.context.structure.generate_repo_skeleton(
        max_depth=depth,
        style=style,
    )
    return {"skeleton": skeleton or "(empty project)"}


def _resolve_node(store, command, function=None, node_id=None, file=None, line=None):
    from codedmap.app.contracts.response import _node_to_dict
    from codedmap.infra.services.node_resolver import NodeResolver, LocationQuery

    if node_id is not None:
        node = store.get_node(node_id)
        if node is None:
            raise QueryServiceError("NODE_NOT_FOUND", f"Node ID {node_id} not found.")
        return node

    resolver = NodeResolver(store)

    if file and line is not None:
        query = LocationQuery(file_path=file, line_number=line)
        node = resolver.resolve_location(query)
        if node is None:
            raise QueryServiceError("NODE_NOT_FOUND", f"No node found at {file}:{line}.")
        return node

    if function:
        methods = resolver.resolve_function(function)
        if not methods:
            raise QueryServiceError("NODE_NOT_FOUND", f"Function '{function}' not found.")
        if len(methods) > 1:
            candidates = [_node_to_dict(m) for m in methods]
            raise QueryServiceError(
                "AMBIGUOUS_TARGET",
                f"Ambiguous target: '{function}' matches {len(candidates)} nodes. Use --node-id to disambiguate.",
                details={"query": function, "candidates": candidates},
            )
        return methods[0]

    raise QueryServiceError(
        "NODE_NOT_FOUND",
        "No target specified. Use function, file+line, or node_id.",
    )


def inspect_node(
    store,
    function: Optional[str] = None,
    node_id: Optional[int] = None,
    file: Optional[str] = None,
    line: Optional[int] = None,
    detail: bool = False,
    hierarchy: bool = False,
    module: Optional[str] = None,
    only: Optional[str] = None,
) -> dict:
    from codedmap.app.contracts.response import _find_call_edge, _node_to_dict
    from codedmap.app.query.root import CPG
    from codedmap.analysis.tagging.engine import TagEngine
    from codedmap.analysis.traversal.context import ContextStrategy
    from codedmap.analysis.traversal.context_slice import SliceOptions
    from codedmap.analysis.traversal.module import ModuleNavigator

    if module:
        matches = store.modules.find_by_name(module, exact_match=True)
        if not matches:
            matches = store.modules.find_by_name(module, exact_match=False)
        if not matches:
            raise QueryServiceError("NODE_NOT_FOUND", f"Module '{module}' not found.")
        module_node = matches[0]

        nav = ModuleNavigator(store)
        files = list(nav.get_files(module_node))
        methods = list(nav.get_methods(module_node))
        metrics = nav.get_metrics(module_node, compute=False)
        tags = getattr(module_node, "tags", []) or []
        fan_in = nav.get_fan_in(module_node)

        result = {
            "id": module_node.id,
            "name": module_node.name,
            "full_name": module_node.full_name,
            "subsystem": getattr(module_node, "subsystem", None),
            "description": getattr(module_node, "description", None),
            "tags": tags,
            "file_count": len(files),
            "method_count": len(methods),
            "fan_in": fan_in,
            "files": [{"id": f.id, "name": f.name} for f in files[:20]],
            "metrics": None,
        }
        if metrics:
            result["metrics"] = {
                "entry_point_count": metrics.entry_point_count,
                "method_count": metrics.method_count,
                "sink_count": metrics.sink_count,
                "density": round(metrics.density, 4),
                "file_count": metrics.file_count,
            }
        return {"target": None, "result": result, "total": 0}

    node = _resolve_node(store, "inspect", function=function, node_id=node_id, file=file, line=line)
    cpg = CPG(store)

    if hierarchy:
        data = cpg.context.get_context_data(node, ContextStrategy.HIERARCHY)
        return {
            "target": _node_to_dict(node),
            "result": {"target": _node_to_dict(node), "hierarchy": data},
            "total": 0,
        }

    if detail:
        opts = SliceOptions(
            ddg_depth=3,
            include_source=True,
            include_callees=True,
            include_ddg=True,
            max_source_lines=600,
            truncate_source=True,
        )
        slice_obj = cpg.context.get_context_slice(node, opts)
        return {
            "target": _node_to_dict(node),
            "result": {"slice": slice_obj.model_dump(mode="json")},
            "total": 0,
        }

    loader = cpg.context
    source = cpg.source(node.id)

    callers = []
    for caller_node in loader.call.get_callers(node):
        d = _node_to_dict(caller_node, store=store)
        edge = _find_call_edge(store, getattr(caller_node, "id", 0), getattr(node, "id", 0))
        if edge is not None and getattr(edge, "created_by", "") == "agent:repair":
            d["repaired"] = True
            d["repair_id"] = edge.properties.get("repair_id", "?")
        callers.append(d)

    callees = [_node_to_dict(n, store=store) for n in loader.call.get_callees(node)]
    tags = TagEngine(store).list_tags(node)

    try:
        insights = cpg.insights.get_attached_insights(node.id)
        notes_count = len(insights)
    except Exception:
        notes_count = 0

    result = {
        "target": _node_to_dict(node),
        "source": source,
        "callers": callers,
        "callees": callees,
        "tags": tags,
        "notes_count": notes_count,
    }
    if only:
        allowed = {s.strip() for s in only.split(",")}
        valid = {"callers", "callees", "tags", "source"}
        invalid = allowed - valid
        if invalid:
            raise QueryServiceError("INVALID_ARGUMENT", f"Invalid --only values: {', '.join(sorted(invalid))}. Valid: callers, callees, tags, source")
        result = {k: v for k, v in result.items() if k in allowed or k == "target"}
    return {"target": _node_to_dict(node), "result": result, "total": len(callers) + len(callees)}


def _resolve_reachable_endpoint(store, resolver, func_name, node_id, label):
    from codedmap.app.contracts.response import _node_to_dict

    if node_id is not None:
        node = store.get_node(node_id)
        if node is None:
            raise QueryServiceError("NODE_NOT_FOUND", f"{label} node ID {node_id} not found.")
        return node

    if func_name:
        methods = resolver.resolve_function(func_name)
        if not methods:
            raise QueryServiceError("NODE_NOT_FOUND", f"{label} function '{func_name}' not found.")
        if len(methods) > 1:
            candidates = [_node_to_dict(m) for m in methods]
            raise QueryServiceError(
                "AMBIGUOUS_TARGET",
                f"Ambiguous target: '{func_name}' matches {len(candidates)} nodes. Use --node-id to disambiguate.",
                details={"query": func_name, "candidates": candidates},
            )
        return methods[0]

    raise QueryServiceError(
        "NODE_NOT_FOUND",
        f"{label} not specified. Use from_function/to_function or from_node_id/to_node_id.",
    )


def _find_connecting_call_edge(store, caller, target_node, caller_list, depth):
    try:
        from codedmap.core.schema.graph.enums import EdgeType
        from codedmap.app.contracts.response import _find_call_edge

        caller_id = getattr(caller, "id", None)
        if caller_id is None:
            return None

        callee_id = target_node.id
        if depth > 1:
            for other_caller, other_depth in caller_list:
                if other_depth == depth - 1:
                    callee_id = other_caller.id
                    break

        contained_ids = set(store.get_neighbors(caller_id, "OUT", [EdgeType.CONTAINS.value]))
        contained_ids.update(store.get_neighbors(caller_id, "OUT", [EdgeType.AST.value]))

        for cs_id in contained_ids:
            edge = _find_call_edge(store, cs_id, callee_id)
            if edge is not None:
                return edge
    except Exception:
        pass
    return None


def trace_nodes(
    store,
    function: Optional[str] = None,
    node_id: Optional[int] = None,
    depth: int = 5,
    taint: bool = False,
    dataflow: bool = False,
    reachable: bool = False,
    to_function: Optional[str] = None,
    to_node_id: Optional[int] = None,
    from_function: Optional[str] = None,
    from_node_id: Optional[int] = None,
    max_paths: int = 10,
    max_steps: int = 100,
    direction: str = "both",
    module: Optional[str] = None,
    module_id: Optional[int] = None,
) -> dict:
    from codedmap.app.contracts.response import _node_to_dict, _node_to_witness_hop
    from codedmap.app.query.root import CPG
    from codedmap.infra.services.node_resolver import NodeResolver

    scope = resolve_module_scope(store, module=module, module_id=module_id) if (module or module_id) else None

    if reachable:
        cpg = CPG(store)
        loader = cpg.context
        resolver = NodeResolver(store)

        src_node = _resolve_reachable_endpoint(
            store, resolver, from_function or function, from_node_id or node_id, "source",
        )
        dst_node = _resolve_reachable_endpoint(
            store, resolver, to_function, to_node_id, "destination",
        )
        is_reachable = loader.cfg.is_reachable(src_node, dst_node, max_steps=max_steps)
        path_data = []
        if is_reachable:
            path_nodes = loader.cfg.find_path(src_node, dst_node, max_steps=max_steps)
            for i, pn in enumerate(path_nodes):
                path_data.append(_node_to_witness_hop(pn, depth=i, edge_type="CFG", store=store, module_scope=scope))
        return {
            "target": None,
            "result": {
                "reachable": is_reachable,
                "source": _node_to_dict(src_node),
                "destination": _node_to_dict(dst_node),
                "path": path_data,
                "path_length": len(path_data),
                "mode": "reachable",
            },
            "total": len(path_data),
            "scope": scope,
        }

    node = _resolve_node(store, "trace", function=function, node_id=node_id)
    cpg = CPG(store)

    if taint:
        result = cpg.trace_back(node, max_depth=depth, max_paths=max_paths)
        return {
            "target": _node_to_dict(node),
            "result": {
                "sink_node_id": result.sink_node_id,
                "paths": [path.to_dict() for path in result.paths],
                "found_controllable": result.found_controllable,
                "total_paths": result.total_paths,
                "mode": "taint",
            },
            "total": result.total_paths,
            "scope": scope,
        }

    if dataflow:
        direction_map = {"in": "IN", "out": "OUT", "both": "BOTH"}
        entries = cpg.context.dataflow.get_data_slice_structured(
            node, direction=direction_map.get(direction, "BOTH"), max_depth=depth,
        )
        return {
            "target": _node_to_dict(node),
            "result": {
                "entries": entries,
                "total": len(entries),
                "direction": direction,
                "mode": "dataflow",
            },
            "total": len(entries),
            "scope": scope,
        }

    loader = cpg.context
    caller_list = list(loader.call.get_recursive_callers_with_depth(node, max_depth=depth))
    chain_data = []
    for caller, d in caller_list:
        edge = _find_connecting_call_edge(store, caller, node, caller_list, d)
        chain_data.append(_node_to_witness_hop(
            caller, depth=d, edge_type="CALL", store=store, module_scope=scope, edge=edge,
        ))
    chain_data.reverse()
    chain_data.append(_node_to_witness_hop(node, depth=0, edge_type="", store=store, module_scope=scope))
    return {
        "target": _node_to_dict(node),
        "result": {"nodes": chain_data, "total": len(chain_data), "chain": chain_data, "mode": "callers"},
        "total": len(chain_data),
        "scope": scope,
    }


def execute_query_tool(tool_name: str, store, params: dict) -> dict:
    """Run query command via shared services and return CLI envelope payload."""
    def _envelope(command: str, kind: str, content: Any, metadata: dict, target: Optional[dict] = None) -> dict:
        return {
            "__cli_envelope__": True,
            "command": command,
            "target": target,
            "result": {"kind": kind, "content": content},
            "metadata": metadata,
        }

    if tool_name == "query_search":
        data = search_nodes(
            store=store,
            pattern=params.get("pattern", ""),
            node_type=params.get("type", "method"),
            limit=params.get("limit", 20),
            offset=params.get("offset", 0),
            module=params.get("module"),
            module_id=params.get("module_id"),
        )
        metadata = {
            "total": data["total"],
            "offset": data["offset"],
            "limit": data["limit"],
            "has_more": data["has_more"],
            "truncated": data["truncated"],
        }
        if data["scope"] is not None:
            metadata["module_scope"] = data["scope"].to_metadata_dict()
        return _envelope(command="search", kind="nodes", content=data["nodes"], metadata=metadata)

    if tool_name == "query_sources":
        data = list_sources(
            store=store,
            category=params.get("category"),
            function_filter=params.get("function"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=False,
        )
        return _envelope(
            command="sources",
            kind="nodes",
            content=data["nodes"],
            metadata={
                "total": data["total"],
                "offset": data["offset"],
                "limit": data["limit"],
                "has_more": data["has_more"],
                "truncated": data["truncated"],
            },
        )

    if tool_name == "query_sinks":
        data = list_sinks(
            store=store,
            category=params.get("category"),
            function_filter=params.get("function"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=False,
        )
        return _envelope(
            command="sinks",
            kind="nodes",
            content=data["nodes"],
            metadata={
                "total": data["total"],
                "offset": data["offset"],
                "limit": data["limit"],
                "has_more": data["has_more"],
                "truncated": data["truncated"],
            },
        )

    if tool_name == "query_guards":
        data = list_guards(
            store=store,
            category=params.get("category"),
            function_filter=params.get("function"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=False,
        )
        return _envelope(
            command="guards",
            kind="nodes",
            content=data["nodes"],
            metadata={
                "total": data["total"],
                "offset": data["offset"],
                "limit": data["limit"],
                "has_more": data["has_more"],
                "truncated": data["truncated"],
            },
        )

    if tool_name == "query_sanitizers":
        data = list_sanitizers(
            store=store,
            category=params.get("category"),
            function_filter=params.get("function"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=False,
        )
        return _envelope(
            command="sanitizers",
            kind="nodes",
            content=data["nodes"],
            metadata={
                "total": data["total"],
                "offset": data["offset"],
                "limit": data["limit"],
                "has_more": data["has_more"],
                "truncated": data["truncated"],
            },
        )

    if tool_name == "query_entrypoints":
        data = list_entrypoints(
            store=store,
            level=params.get("level"),
            category=params.get("category"),
            entry_type=params.get("type"),
            file_filter=params.get("filter_file"),
            module=params.get("module"),
            module_id=params.get("module_id"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=params.get("show_all", False),
        )
        metadata = {
            "total": data["total"],
            "offset": data["offset"],
            "limit": data["limit"],
            "has_more": data["has_more"],
            "truncated": data["truncated"],
        }
        if data["scope"] is not None:
            metadata["module_scope"] = data["scope"].to_metadata_dict()
        return _envelope(command="entrypoints", kind="nodes", content=data["nodes"], metadata=metadata)

    if tool_name == "query_roles":
        data = list_roles(
            store=store,
            category=params.get("category"),
            function_filter=params.get("function"),
            module=params.get("module"),
            module_id=params.get("module_id"),
            limit=params.get("limit", 50),
            offset=params.get("offset", 0),
            show_all=False,
        )
        metadata = {
            "total": data["total"],
            "offset": data["offset"],
            "limit": data["limit"],
            "has_more": data["has_more"],
            "truncated": data["truncated"],
        }
        if data["scope"] is not None:
            metadata["module_scope"] = data["scope"].to_metadata_dict()
        return _envelope(command="roles", kind="nodes", content=data["nodes"], metadata=metadata)

    if tool_name == "query_stats":
        data = stats_summary(store=store, module=params.get("module"), module_id=params.get("module_id"))
        metadata = {"total": data["total"]}
        if data["scope"] is not None:
            metadata["module_scope"] = data["scope"].to_metadata_dict()
        return _envelope(command="stats", kind="stats", content=data["result"], metadata=metadata)

    if tool_name == "query_tree":
        data = tree_skeleton(store=store, depth=5, style="ascii")
        return _envelope(command="tree", kind="text", content=data["skeleton"], metadata={"total": 0})

    if tool_name == "query_inspect":
        data = inspect_node(
            store=store,
            function=params.get("function"),
            node_id=params.get("node_id"),
            file=params.get("file"),
            line=params.get("line"),
            detail=params.get("detail", False),
            hierarchy=params.get("hierarchy", False),
            module=params.get("module"),
            only=params.get("only"),
        )
        return _envelope(
            command="inspect",
            kind="object",
            content=data["result"],
            metadata={"total": data["total"]},
            target=data["target"],
        )

    if tool_name == "query_trace":
        data = trace_nodes(
            store=store,
            function=params.get("function"),
            node_id=params.get("node_id"),
            depth=params.get("depth", 5),
            taint=params.get("taint", False),
            dataflow=params.get("dataflow", False),
            reachable=params.get("reachable", False),
            from_function=params.get("from_function"),
            from_node_id=params.get("from_node_id"),
            to_function=params.get("to_function"),
            to_node_id=params.get("to_node_id"),
            max_paths=10,
            max_steps=100,
            direction="both",
            module=params.get("module"),
            module_id=params.get("module_id"),
        )
        metadata = {"total": data["total"], "limit": params.get("depth", 5)}
        if data["scope"] is not None:
            metadata["module_scope"] = data["scope"].to_metadata_dict()
        trace_kind = "nodes" if isinstance(data["result"], dict) and isinstance(data["result"].get("nodes"), list) else "object"
        trace_content = data["result"].get("nodes") if trace_kind == "nodes" else data["result"]
        return _envelope(
            command="trace",
            kind=trace_kind,
            content=trace_content,
            metadata=metadata,
            target=data["target"],
        )

    raise QueryServiceError("INVALID_ARGUMENT", f"Unsupported query tool: {tool_name}")
