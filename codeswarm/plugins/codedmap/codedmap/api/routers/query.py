# codedmap/api/routers/query.py
"""
Query domain router: /query/search, /query/inspect, /query/trace,
/query/entrypoints, /query/sources, /query/sinks, /query/guards, /query/roles,
/query/stats, /query/tree

All endpoints use the injected store directly — no stdout capture, no
create_store(), no second SQLite connection.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from codedmap.api.deps import get_store
from codedmap.api.app import cli_response_to_http

router = APIRouter(prefix="/query", tags=["query"])


# ---------------------------------------------------------------------------
# Shared helper: service error -> HTTP envelope
# ---------------------------------------------------------------------------

def _query_service_error_to_http(command: str, exc):
    from codedmap.app.contracts.response import CLIResponse

    if getattr(exc, "code", "") == "AMBIGUOUS_TARGET":
        details = getattr(exc, "details", {}) or {}
        query = details.get("query", "?")
        candidates = details.get("candidates", [])
        return cli_response_to_http(CLIResponse.ambiguous_response(command, query, candidates))
    return cli_response_to_http(
        CLIResponse.error_response(
            command,
            getattr(exc, "code", "INTERNAL_ERROR"),
            str(exc),
        )
    )


# ---------------------------------------------------------------------------
# Shared helper: node resolution (replaces resolve_target without stderr)
# ---------------------------------------------------------------------------

def _resolve_node(store, command, function=None, node_id=None, file=None, line=None):
    """Resolve a target node. Returns (node, error_response) — one is always None."""
    from codedmap.app.contracts.response import CLIResponse, _node_to_dict
    from codedmap.infra.services.node_resolver import NodeResolver, LocationQuery

    if node_id is not None:
        node = store.get_node(node_id)
        if node is None:
            return None, CLIResponse.error_response(
                command, "NODE_NOT_FOUND", f"Node ID {node_id} not found.",
            )
        return node, None

    resolver = NodeResolver(store)

    if file and line is not None:
        query = LocationQuery(file_path=file, line_number=line)
        node = resolver.resolve_location(query)
        if node is None:
            return None, CLIResponse.error_response(
                command, "NODE_NOT_FOUND", f"No node found at {file}:{line}.",
            )
        return node, None

    if function:
        methods = resolver.resolve_function(function)
        if not methods:
            return None, CLIResponse.error_response(
                command, "NODE_NOT_FOUND", f"Function '{function}' not found.",
            )
        if len(methods) > 1:
            candidates = [_node_to_dict(m) for m in methods]
            return None, CLIResponse.ambiguous_response(command, function, candidates)
        return methods[0], None

    return None, CLIResponse.error_response(
        command, "NODE_NOT_FOUND",
        "No target specified. Use function, file+line, or node_id.",
    )


# ---------------------------------------------------------------------------
# /query/search — already uses store directly
# ---------------------------------------------------------------------------

@router.get("/search")
def search(
    pattern: str = Query(..., description="Name regex pattern"),
    type: str = Query("method", description="Node type: method, call, identifier"),
    limit: int = Query(20, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    module: Optional[str] = Query(None, description="Filter to module name"),
    module_id: Optional[int] = Query(None, description="Filter to module ID"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import search_nodes, QueryServiceError

    try:
        data = search_nodes(
            store=store,
            pattern=pattern,
            node_type=type,
            limit=limit,
            offset=offset,
            module=module,
            module_id=module_id,
        )
    except QueryServiceError as exc:
        return _query_service_error_to_http("search", exc)

    meta = CLIMetadata(
        total=data["total"],
        limit=data["limit"],
        offset=data["offset"],
        has_more=data["has_more"],
        truncated=data["truncated"],
    )
    if data["scope"] is not None:
        meta.module_scope = data["scope"].to_metadata_dict()
    response = CLIResponse.success_response(command="search", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/sources, /query/sinks, /query/guards, /query/sanitizers
# (Detector pattern — identical structure)
# ---------------------------------------------------------------------------

@router.get("/sources")
def sources(
    category: Optional[str] = Query(None, description="SourceCategory value (e.g., ENV_VAR)"),
    type: Optional[str] = Query(None, description="Pattern type: call or identifier"),
    function: Optional[str] = Query(None, description="Function name substring filter"),
    limit: int = Query(50, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import list_sources

    data = list_sources(
        store=store,
        category=category,
        function_filter=function,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        limit=data["limit"],
        offset=data["offset"],
        has_more=data["has_more"],
        truncated=data["truncated"],
    )
    response = CLIResponse.success_response(command="sources", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


@router.get("/sinks")
def sinks(
    category: Optional[str] = Query(None, description="SinkCategory value (e.g., MEMORY_WRITE, OS_COMMAND)"),
    limit: int = Query(50, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    module: Optional[str] = Query(None, description="Module name scope"),
    module_id: Optional[int] = Query(None, description="Module ID scope"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import list_sinks

    data = list_sinks(
        store=store,
        category=category,
        function_filter=None,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        limit=data["limit"],
        offset=data["offset"],
        has_more=data["has_more"],
        truncated=data["truncated"],
    )
    response = CLIResponse.success_response(command="sinks", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


@router.get("/guards")
def guards(
    category: Optional[str] = Query(None, description="GuardCategory value (e.g., NULL_CHECK, BOUNDS_CHECK)"),
    function: Optional[str] = Query(None, description="Function name substring filter"),
    limit: int = Query(50, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import list_guards

    data = list_guards(
        store=store,
        category=category,
        function_filter=function,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        limit=data["limit"],
        offset=data["offset"],
        has_more=data["has_more"],
        truncated=data["truncated"],
    )
    response = CLIResponse.success_response(command="guards", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


@router.get("/sanitizers")
def sanitizers(
    category: Optional[str] = Query(None, description="SanitizerCategory value (e.g., ESCAPE, ENCODE)"),
    function: Optional[str] = Query(None, description="Function name substring filter"),
    limit: int = Query(50, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import list_sanitizers

    data = list_sanitizers(
        store=store,
        category=category,
        function_filter=function,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        limit=data["limit"],
        offset=data["offset"],
        has_more=data["has_more"],
        truncated=data["truncated"],
    )
    response = CLIResponse.success_response(command="sanitizers", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/entrypoints — CPG query DSL
# ---------------------------------------------------------------------------

@router.get("/entrypoints")
def entrypoints(
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None, description="Entry point type/rule name"),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata, _node_to_dict
    from codedmap.app.services.query_services import list_entrypoints

    data = list_entrypoints(
        store=store,
        level=level,
        category=category,
        entry_type=type,
        file_filter=None,
        module=module,
        module_id=module_id,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        has_more=data["has_more"],
        limit=data["limit"],
        offset=data["offset"],
        truncated=data["truncated"],
    )
    if data["scope"] is not None:
        meta.module_scope = data["scope"].to_metadata_dict()
    response = CLIResponse.success_response(command="entrypoints", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/roles — CPG query DSL
# ---------------------------------------------------------------------------

@router.get("/roles")
def roles(
    category: Optional[str] = Query(None, description="RoleCategory value (e.g., BOUNDARY, DRIVER)"),
    limit: int = Query(50, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
    module: Optional[str] = Query(None, description="Module name scope"),
    module_id: Optional[int] = Query(None, description="Module ID scope"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata, _node_to_dict
    from codedmap.app.services.query_services import list_roles

    data = list_roles(
        store=store,
        category=category,
        function_filter=None,
        module=module,
        module_id=module_id,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    meta = CLIMetadata(
        total=data["total"],
        has_more=data["has_more"],
        limit=data["limit"],
        offset=data["offset"],
        truncated=data["truncated"],
    )
    if data["scope"] is not None:
        meta.module_scope = data["scope"].to_metadata_dict()
    response = CLIResponse.success_response(command="roles", nodes=data["nodes"], metadata=meta)
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/stats — CPG tactical_stats()
# ---------------------------------------------------------------------------

@router.get("/stats")
def stats(
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import stats_summary
    data = stats_summary(store=store, module=module, module_id=module_id)
    result_data = data["result"]
    meta = CLIMetadata(total=data["total"])
    if data["scope"] is not None:
        meta.module_scope = data["scope"].to_metadata_dict()

    response = CLIResponse(
        command="stats",
        result={"kind": "stats", "content": result_data},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _scoped_stats(store, scope):
    """Compute module-scoped tactical statistics (inlined from stats.py)."""
    from collections import Counter, defaultdict
    from codedmap.app.query.root import CPG
    from codedmap.app.query.models import (
        TacticalStats, CategoryBreakdown, AuditProgress, MethodHotSpot,
    )
    from codedmap.app.services.scope_utils import filter_by_scope

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

    def _breakdown(nodes, prefix):
        counter = Counter()
        for node in nodes:
            for tag in getattr(node, "tags", []):
                if tag.startswith(prefix):
                    counter[tag.split(":")[-1]] += 1
        top3 = [{k: v} for k, v in counter.most_common(3)]
        return CategoryBreakdown(total=len(nodes), top_categories=top3)

    def _is_audited(node):
        tags = getattr(node, "tags", [])
        if "STATE:AUDITED" in tags:
            return True
        try:
            neighbors = store.get_neighbors(node.id, "OUT", ["HAS_INSIGHT"])
            return len(neighbors) > 0
        except Exception:
            return False

    def _audit(nodes):
        total = len(nodes)
        audited = sum(1 for n in nodes if _is_audited(n))
        pct = round(audited / total * 100, 1) if total > 0 else 0.0
        return AuditProgress(total=total, audited=audited, percent=pct)

    method_sinks = defaultdict(int)
    method_sources = defaultdict(int)
    method_info = {}
    for node in sink_nodes:
        if _is_audited(node):
            continue
        methods = store.query.by_id(node.id).methods().to_list()
        if not methods:
            continue
        m = methods[0]
        method_sinks[m.id] += 1
        method_info[m.id] = (getattr(m, "name", "?"), getattr(m, "file_name", None), getattr(m, "line_number", None))
    for node in src_nodes:
        if _is_audited(node):
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
        entry_point_audit=_audit(ep_nodes),
        source_audit=_audit(src_nodes),
        sink_audit=_audit(sink_nodes),
        notes_total=notes_total,
        notes_by_category=notes_by_cat,
        repairs_total=0,
        hot_spots=scored[:5],
        hot_spots_total_methods=len(scored),
        suggested_commands=[],
    )
    return ts.model_dump(mode="json")


# ---------------------------------------------------------------------------
# /query/tree — CPG repo skeleton
# ---------------------------------------------------------------------------

@router.get("/tree")
def tree(
    limit: int = Query(100),
    depth: int = Query(5, description="Max directory depth"),
    style: str = Query("ascii", description="Output style: ascii, markdown, indent"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import tree_skeleton
    data = tree_skeleton(store=store, depth=depth, style=style)
    response = CLIResponse(
        command="tree",
        target=None,
        result={"kind": "text", "content": data["skeleton"]},
        metadata=CLIMetadata(),
        success=True,
    )
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/inspect — 4 modes
# ---------------------------------------------------------------------------

@router.get("/inspect")
def inspect(
    function: Optional[str] = Query(None),
    node_id: Optional[int] = Query(None),
    file: Optional[str] = Query(None),
    line: Optional[int] = Query(None),
    detail: bool = Query(False),
    hierarchy: bool = Query(False),
    module: Optional[str] = Query(None, description="Module name for module show mode"),
    only: Optional[str] = Query(None, description="Filter result sections (comma-separated): callers, callees, tags, source"),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import inspect_node, QueryServiceError

    try:
        data = inspect_node(
            store=store,
            function=function,
            node_id=node_id,
            file=file,
            line=line,
            detail=detail,
            hierarchy=hierarchy,
            module=module,
            only=only,
        )
    except QueryServiceError as exc:
        return _query_service_error_to_http("inspect", exc)

    response = CLIResponse(
        command="inspect",
        target=data["target"],
        result={"kind": "object", "content": data["result"]},
        metadata=CLIMetadata(total=data["total"]),
        success=True,
    )
    return cli_response_to_http(response)


# ---------------------------------------------------------------------------
# /query/trace — 4 modes
# ---------------------------------------------------------------------------

@router.get("/trace")
def trace(
    function: Optional[str] = Query(None),
    node_id: Optional[int] = Query(None),
    depth: int = Query(5),
    taint: bool = Query(False),
    dataflow: bool = Query(False),
    reachable: bool = Query(False),
    to_function: Optional[str] = Query(None),
    to_node_id: Optional[int] = Query(None),
    max_paths: int = Query(10),
    max_steps: int = Query(100),
    direction: str = Query("both", description="Data flow direction: in, out, both"),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.query_services import trace_nodes, QueryServiceError

    try:
        data = trace_nodes(
            store=store,
            function=function,
            node_id=node_id,
            depth=depth,
            taint=taint,
            dataflow=dataflow,
            reachable=reachable,
            to_function=to_function,
            to_node_id=to_node_id,
            from_function=function,
            from_node_id=node_id,
            max_paths=max_paths,
            max_steps=max_steps,
            direction=direction,
            module=module,
            module_id=module_id,
        )
    except QueryServiceError as exc:
        return _query_service_error_to_http("trace", exc)

    meta = CLIMetadata(total=data["total"], limit=depth)
    if data.get("scope") is not None:
        meta.module_scope = data["scope"].to_metadata_dict()
    trace_kind = "nodes" if isinstance(data["result"], dict) and isinstance(data["result"].get("nodes"), list) else "object"
    trace_content = data["result"].get("nodes") if trace_kind == "nodes" else data["result"]
    response = CLIResponse(
        command="trace",
        target=data["target"],
        result={"kind": trace_kind, "content": trace_content},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _trace_callers(store, function, node_id, depth, scope):
    """Recursive caller chain."""
    from codedmap.app.contracts.response import (
        CLIResponse, CLIMetadata, _node_to_dict, _node_to_witness_hop, _find_call_edge,
    )
    from codedmap.app.query import CPG

    node, err = _resolve_node(store, "trace", function=function, node_id=node_id)
    if err is not None:
        return cli_response_to_http(err)

    cpg = CPG(store)
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

    meta = CLIMetadata(total=len(chain_data), limit=depth)
    if scope is not None:
        meta.module_scope = scope.to_metadata_dict()

    response = CLIResponse(
        command="trace",
        target=_node_to_dict(node),
        result={"kind": "nodes", "content": chain_data},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _trace_taint(store, function, node_id, depth, max_paths, scope):
    """Backward taint trace."""
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata, _node_to_dict
    from codedmap.app.query import CPG

    node, err = _resolve_node(store, "trace", function=function, node_id=node_id)
    if err is not None:
        return cli_response_to_http(err)

    cpg = CPG(store)
    result = cpg.trace_back(node, max_depth=depth, max_paths=max_paths)

    meta = CLIMetadata()
    if scope is not None:
        meta.module_scope = scope.to_metadata_dict()

    response = CLIResponse(
        command="trace",
        target=_node_to_dict(node),
        result={"kind": "object", "content": {
            "sink_node_id": result.sink_node_id,
            "paths": [path.to_dict() for path in result.paths],
            "found_controllable": result.found_controllable,
            "total_paths": result.total_paths,
            "mode": "taint",
        }},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _trace_dataflow(store, function, node_id, depth, direction, scope):
    """DDG data flow slice."""
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata, _node_to_dict
    from codedmap.app.query import CPG

    node, err = _resolve_node(store, "trace", function=function, node_id=node_id)
    if err is not None:
        return cli_response_to_http(err)

    direction_map = {"in": "IN", "out": "OUT", "both": "BOTH"}
    cpg = CPG(store)
    entries = cpg.context.dataflow.get_data_slice_structured(
        node, direction=direction_map.get(direction, "BOTH"), max_depth=depth,
    )

    meta = CLIMetadata(total=len(entries))
    if scope is not None:
        meta.module_scope = scope.to_metadata_dict()

    response = CLIResponse(
        command="trace",
        target=_node_to_dict(node),
        result={"kind": "object", "content": {
            "entries": entries,
            "total": len(entries),
            "direction": direction,
            "mode": "dataflow",
        }},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _trace_reachable(store, from_function, from_node_id, to_function, to_node_id, max_steps, scope):
    """CFG reachability between two endpoints."""
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata, _node_to_dict, _node_to_witness_hop
    from codedmap.app.query import CPG
    from codedmap.infra.services.node_resolver import NodeResolver

    cpg = CPG(store)
    loader = cpg.context
    resolver = NodeResolver(store)

    # Resolve source endpoint
    src_node, src_err = _resolve_reachable_endpoint(
        store, resolver, from_function, from_node_id, "source",
    )
    if src_err is not None:
        return cli_response_to_http(src_err)

    # Resolve destination endpoint
    dst_node, dst_err = _resolve_reachable_endpoint(
        store, resolver, to_function, to_node_id, "destination",
    )
    if dst_err is not None:
        return cli_response_to_http(dst_err)

    reachable = loader.cfg.is_reachable(src_node, dst_node, max_steps=max_steps)

    path_data = []
    if reachable:
        path_nodes = loader.cfg.find_path(src_node, dst_node, max_steps=max_steps)
        for i, pn in enumerate(path_nodes):
            path_data.append(_node_to_witness_hop(pn, depth=i, edge_type="CFG", store=store, module_scope=scope))

    meta = CLIMetadata()
    if scope is not None:
        meta.module_scope = scope.to_metadata_dict()

    response = CLIResponse(
        command="trace",
        target=None,
        result={"kind": "object", "content": {
            "reachable": reachable,
            "source": _node_to_dict(src_node),
            "destination": _node_to_dict(dst_node),
            "path": path_data,
            "path_length": len(path_data),
            "mode": "reachable",
        }},
        metadata=meta,
        success=True,
    )
    return cli_response_to_http(response)


def _resolve_reachable_endpoint(store, resolver, func_name, node_id, label):
    """Resolve a reachability endpoint. Returns (node, error_response)."""
    from codedmap.app.contracts.response import CLIResponse, _node_to_dict

    if node_id is not None:
        node = store.get_node(node_id)
        if node is None:
            return None, CLIResponse.error_response(
                "trace", "NODE_NOT_FOUND", f"{label} node ID {node_id} not found.",
            )
        return node, None

    if func_name:
        methods = resolver.resolve_function(func_name)
        if not methods:
            return None, CLIResponse.error_response(
                "trace", "NODE_NOT_FOUND", f"{label} function '{func_name}' not found.",
            )
        if len(methods) > 1:
            candidates = [_node_to_dict(m) for m in methods]
            return None, CLIResponse.ambiguous_response("trace", func_name, candidates)
        return methods[0], None

    return None, CLIResponse.error_response(
        "trace", "NODE_NOT_FOUND",
        f"{label} not specified. Use from_function/to_function or from_node_id/to_node_id.",
    )


# ---------------------------------------------------------------------------
# Trace helper (imported from trace.py logic)
# ---------------------------------------------------------------------------

def _find_connecting_call_edge(store, caller, target_node, caller_list, depth):
    """Find the CALL edge connecting a caller to its callee in the chain."""
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
