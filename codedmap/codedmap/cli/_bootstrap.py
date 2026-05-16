# codedmap/cli/_bootstrap.py
"""
Shared bootstrap infrastructure for CPG CLI commands.

Responsibilities:
1. Common CLI argument injection (--db, --backend, --function, --file, --line, --node-id)
2. Minimal read-only CPGStore construction
3. Unified target node resolution (node_id > file+line > function name)
4. Output formatting helpers
5. Exception wrapper for clean stderr output
"""

import argparse
import getpass
import logging
import sys
import os
from pathlib import Path
from typing import Optional, List
from functools import wraps

from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.services.node_resolver import NodeResolver, LocationQuery
from codedmap.app.services.scope_utils import (
    ModuleScope,
    ModuleNotFoundError,
    AmbiguousModuleError,
    resolve_module_scope as _resolve_module_scope_shared,
    filter_by_scope as _filter_by_scope_shared,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 0. Created-by identifier
# ---------------------------------------------------------------------------

def get_created_by(domain: str, action: str = "") -> str:
    """Build created_by identifier using {actor}@{domain}:{action} format.

    Format: {actor}@{domain}:{action}
    - actor: From CPG_AGENT_ID env var, or "human-{username}" if not set
    - domain: The command domain (e.g., "repair", "module", "tag")
    - action: Optional action within domain (e.g., "link", "undo", "create")

    Examples:
        get_created_by("repair", "link")       -> "hunter-02@repair:link" or "human-alice@repair:link"
        get_created_by("repair", "undo")       -> "hunter-02@repair:undo" or "human-alice@repair:undo"
        get_created_by("module", "create")     -> "hunter-02@module:create" or "human-bob@module:create"
        get_created_by("module")               -> "hunter-02@module" or "human-alice@module"

    Args:
        domain: The command domain (repair, module, tag, note, etc.)
        action: Optional action within the domain

    Returns:
        Identifier in format: "{actor}@{domain}:{action}" or "{actor}@{domain}"
    """
    actor = os.environ.get("CPG_AGENT_ID", "").strip() or f"human-{getpass.getuser()}"
    if action:
        return f"{actor}@{domain}:{action}"
    return f"{actor}@{domain}"


class NoDatabaseError(Exception):
    """Raised when --db or $CPG_DB is required but not provided."""

    pass


class AmbiguousTargetError(Exception):
    """Raised when --function matches multiple nodes and agent must disambiguate.

    Attributes:
        query: The ambiguous function name or pattern.
        candidates: List of candidate node dicts [{id, name, file, line, label}, ...].
    """

    def __init__(self, query: str, candidates: list):
        self.query = query
        self.candidates = candidates
        super().__init__(
            f"Ambiguous target: '{query}' matches {len(candidates)} nodes. "
            f"Use --node-id to disambiguate."
        )


# ---------------------------------------------------------------------------
# 1. Argument Injection
# ---------------------------------------------------------------------------

def add_common_args(parser: argparse.ArgumentParser):
    """Inject standard CPG CLI arguments into any argparse parser."""
    conn = parser.add_argument_group("connection")
    conn.add_argument(
        "--db",
        default=os.environ.get("CPG_DB", ""),
        help="Path to CPG database (SQLite file or Neo4j URI). "
             "Falls back to $CPG_DB env var.",
    )
    conn.add_argument(
        "--backend",
        choices=["sqlite", "neo4j", "memory"],
        default=os.environ.get("CPG_BACKEND", "sqlite"),
        help="Storage backend (default: sqlite).",
    )
    conn.add_argument(
        "--remote",
        default=os.environ.get("CPG_SERVER", ""),
        help="Remote CPG server URL (or set CPG_SERVER env var). "
             "When set, commands execute against the remote server instead of local DB.",
    )
    conn.add_argument(
        "--api-key",
        default=os.environ.get("CPG_API_KEY", ""),
        help="API key for remote server authentication (or set CPG_API_KEY env var).",
    )

    target = parser.add_argument_group("target")
    target.add_argument("--function", "-f", help="Target function name.")
    target.add_argument("--file", help="Target file path (used with --line).")
    target.add_argument("--line", type=int, help="Target line number (used with --file).")
    target.add_argument("--node-id", type=int, help="Exact CPG node ID.")

    output = parser.add_argument_group("output")
    output.add_argument(
        "--output",
        choices=["json", "text"],
        default="text",
        help="Output format (default: text for interactive use, json for agents)",
    )
    output.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Pagination offset (default: 0).",
    )
    output.add_argument(
        "--debug",
        action="store_true",
        default=argparse.SUPPRESS,
        help="Enable debug logging and full tracebacks on internal errors.",
    )


def add_connection_args(parser: argparse.ArgumentParser):
    """Inject connection and output args only (no target args).

    Use this for commands that define their own --function / -f
    to avoid argparse conflicts with add_common_args().
    """
    conn = parser.add_argument_group("connection")
    conn.add_argument(
        "--db",
        default=os.environ.get("CPG_DB", ""),
        help="Path to CPG database (SQLite file or Neo4j URI). "
             "Falls back to $CPG_DB env var.",
    )
    conn.add_argument(
        "--backend",
        choices=["sqlite", "neo4j", "memory"],
        default=os.environ.get("CPG_BACKEND", "sqlite"),
        help="Storage backend (default: sqlite).",
    )
    conn.add_argument(
        "--remote",
        default=os.environ.get("CPG_SERVER", ""),
        help="Remote CPG server URL (or set CPG_SERVER env var). "
             "When set, commands execute against the remote server instead of local DB.",
    )
    conn.add_argument(
        "--api-key",
        default=os.environ.get("CPG_API_KEY", ""),
        help="API key for remote server authentication (or set CPG_API_KEY env var).",
    )

    output = parser.add_argument_group("output")
    output.add_argument(
        "--output",
        choices=["json", "text"],
        default="text",
        help="Output format (default: text for interactive use, json for agents)",
    )
    output.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Pagination offset (default: 0).",
    )
    output.add_argument(
        "--debug",
        action="store_true",
        default=argparse.SUPPRESS,
        help="Enable debug logging and full tracebacks on internal errors.",
    )


def add_module_args(parser: argparse.ArgumentParser):
    """Inject --module and --module-id arguments into a parser.

    Called by commands that support module-scoped filtering (entrypoints,
    search, trace, inspect, tag).
    """
    scope = parser.add_argument_group("module scope")
    scope.add_argument(
        "--module",
        default=None,
        help="Filter results to a specific module (by name). "
             "Exact match first, then fuzzy substring match.",
    )
    scope.add_argument(
        "--module-id",
        type=int,
        default=None,
        help="Filter results to a specific module (by node ID). "
             "Takes precedence over --module.",
    )


def add_project_args(parser: argparse.ArgumentParser):
    """Inject --project argument into a parser for multi-project DB scoping."""
    scope = parser.add_argument_group("project scope")
    scope.add_argument(
        "--project",
        default=None,
        help="Filter results to a specific project (by project_name on MetaDataNode). "
             "Without this flag, queries span all projects (unified view).",
    )


# ---------------------------------------------------------------------------
# 2. Store Construction
# ---------------------------------------------------------------------------

def create_store(args: argparse.Namespace) -> CPGStore:
    """
    Construct a minimal read-only CPGStore from CLI args.

    The config skips all pipeline phases (ingestion, analysis, export)
    since CLI commands only need to query existing data.
    """
    db_path = args.db
    if not db_path:
        raise NoDatabaseError("Error: --db or $CPG_DB is required.")

    storage_config = StorageConfig(backend=args.backend, uri=db_path)
    return CPGStore(storage_config)


def _catalog_action_attr(domain: str) -> str:
    mapping = {
        "query": "query_action",
        "note": "note_action",
        "tag": "tag_action",
        "module": "module_action",
        "repair": "repair_action",
        "rules": "rules_action",
        "federation": "federation_action",
        "knowledge": "knowledge_action",
    }
    if domain not in mapping:
        raise ValueError(f"Unsupported catalog domain: {domain}")
    return mapping[domain]


def _catalog_tool_name_from_args(args: argparse.Namespace, domain: str) -> str:
    action = getattr(args, _catalog_action_attr(domain), None)
    if not action:
        raise ValueError(f"{domain} subcommand required.")
    return f"{domain}_{action.replace('-', '_')}"


def _catalog_params_from_args(tool_name: str, args: argparse.Namespace) -> dict:
    from codedmap.core.schema.catalog import get_command

    cmd_def = get_command(tool_name)
    if cmd_def is None:
        return {}

    params = {}
    for field_name in cmd_def.input_model.model_fields:
        value = getattr(args, field_name, None)
        if value is not None:
            params[field_name] = value
    return params


def _resolve_target_id_from_validated(store, validated_input) -> int:
    ns = argparse.Namespace(
        node_id=getattr(validated_input, "node_id", None),
        function=getattr(validated_input, "function", None),
        file=getattr(validated_input, "file", None),
        line=getattr(validated_input, "line", None),
    )
    node = resolve_target(store, ns)
    if node is None:
        raise ValueError("No target specified. Use --function, --file/--line, or --node-id.")
    return node.id


def _build_local_command_executor():
    from codedmap.app.services.command_executor import CommandExecutor
    from codedmap.app.services import domain_services as svc
    from codedmap.app.services import query_services as qsvc

    executor = CommandExecutor()

    # Store-backed command helpers
    def _with_store(context, fn):
        ns = argparse.Namespace(db=context.db, backend=context.backend)
        with create_store(ns) as store:
            return fn(store)

    # Query domain — now fully dispatched to app.services.query_services
    for tool_name in [
        "query_search",
        "query_inspect",
        "query_trace",
        "query_entrypoints",
        "query_stats",
        "query_tree",
        "query_sources",
        "query_sinks",
        "query_guards",
        "query_sanitizers",
        "query_roles",
    ]:
        executor.register(
            tool_name,
            lambda v, c, _tool=tool_name: _with_store(
                c,
                lambda s: qsvc.execute_query_tool(_tool, s, v.model_dump()),
            ),
        )

    # Rules domain
    executor.register("rules_list", lambda v, c: svc.rules_list(
        project=".",
        rule_type=getattr(v, "type", None),
        limit=getattr(v, "limit", 50),
        offset=getattr(v, "offset", 0),
        show_origin=getattr(v, "show_origin", False),
    ))
    executor.register("rules_categories", lambda v, c: svc.rules_categories(project="."))
    executor.register("rules_show", lambda v, c: svc.rules_show(project="."))
    executor.register("rules_resolve", lambda v, c: svc.rules_resolve(function_name=getattr(v, "name", "")))
    executor.register("rules_add_sink", lambda v, c: svc.rules_add_sink(
        name=v.name,
        category=v.category,
        project=".",
    ))
    executor.register("rules_add_source", lambda v, c: svc.rules_add_source(
        name=v.name,
        category=v.category,
        project=".",
    ))
    executor.register("rules_add_safe", lambda v, c: svc.rules_add_safe(name=v.name, project="."))
    executor.register("rules_add_entrypoint", lambda v, c: svc.rules_add_entrypoint(
        name=v.name,
        category=getattr(v, "category", "cli"),
        pattern_type="function_name",
        function_pattern=v.name,
        project=".",
    ))
    executor.register("rules_tombstone", lambda v, c: svc.rules_tombstone(
        rule_id=v.rule_id,
        reason=v.reason,
        project=".",
    ))
    executor.register("rules_validate", lambda v, c: svc.rules_validate(project="."))

    def _project_module_show_result(result: dict, verbose: bool) -> dict:
        if verbose:
            return result
        projected = dict(result)
        projected.pop("files", None)
        projected.pop("metrics", None)
        return projected

    # Module domain
    executor.register("module_list", lambda v, c: _with_store(c, lambda s: svc.module_list(
        s,
        limit=getattr(v, "limit", 50),
        offset=getattr(v, "offset", 0),
        show_all=getattr(v, "show_all", False),
    )))
    # Apply adapter-layer projection for progressive disclosure.
    # Service stays transport-agnostic and always returns full domain payload.
    executor.register("module_show", lambda v, c: _with_store(c, lambda s: _project_module_show_result(
        svc.module_show(s, name=v.name),
        verbose=getattr(v, "verbose", False),
    )))
    executor.register("module_create", lambda v, c: _with_store(c, lambda s: svc.module_create(
        s, name=v.name, description=v.description, created_by=get_created_by("module", "create")
    )))
    executor.register("module_delete", lambda v, c: _with_store(c, lambda s: svc.module_delete(
        s, name=v.name, created_by=get_created_by("module", "delete")
    )))
    executor.register("module_rename", lambda v, c: _with_store(c, lambda s: svc.module_rename(
        s, name=v.name, new_name=v.new_name, created_by=get_created_by("module", "rename")
    )))
    executor.register("module_assign", lambda v, c: _with_store(c, lambda s: svc.module_assign(
        s, name=v.name, paths=v.paths, justification=v.justification,
        confidence=getattr(v, "confidence", None), created_by=get_created_by("module", "assign")
    )))
    executor.register("module_remove", lambda v, c: _with_store(c, lambda s: svc.module_remove_files(
        s, name=v.name, paths=v.paths, created_by=get_created_by("module", "remove")
    )))
    executor.register("module_of", lambda v, c: _with_store(c, lambda s: svc.module_of(
        s, node_id=_resolve_target_id_from_validated(s, v)
    )))
    executor.register("module_deps", lambda v, c: _with_store(c, lambda s: svc.module_deps(
        s, name=getattr(v, "name", None)
    )))

    # Tag domain
    executor.register("tag_list", lambda v, c: _with_store(c, lambda s: svc.tag_list(
        s,
        node_id=(
            getattr(v, "node_id", None)
            or (
                _resolve_target_id_from_validated(s, v)
                if (
                    getattr(v, "function", None) is not None
                    or getattr(v, "file", None) is not None
                    or getattr(v, "line", None) is not None
                )
                else None
            )
        ),
        function=getattr(v, "function", None),
        limit=getattr(v, "limit", 50),
        offset=getattr(v, "offset", 0),
    )))
    executor.register("tag_find", lambda v, c: _with_store(c, lambda s: svc.tag_find(
        s,
        tag=v.tag,
        limit=getattr(v, "limit", 50),
        offset=getattr(v, "offset", 0),
        module=getattr(v, "module", None),
        module_id=getattr(v, "module_id", None),
    )))
    executor.register("tag_add", lambda v, c: _with_store(c, lambda s: svc.tag_add(
        s,
        node_id=getattr(v, "node_id", None) or _resolve_target_id_from_validated(s, v),
        tag=v.tag,
        confidence=getattr(v, "confidence", None),
        justification=getattr(v, "justification", None),
        created_by=get_created_by("tag", "add"),
    )))
    executor.register("tag_remove", lambda v, c: _with_store(c, lambda s: svc.tag_remove(
        s,
        node_id=getattr(v, "node_id", None) or _resolve_target_id_from_validated(s, v),
        tag=v.tag,
        created_by=get_created_by("tag", "remove"),
    )))
    executor.register("tag_bulk", lambda v, c: _with_store(c, lambda s: svc.tag_bulk(
        s,
        pattern=getattr(v, "pattern", ""),
        tag=getattr(v, "tag", ""),
        node_type=getattr(v, "type", "method"),
        created_by=get_created_by("tag", "bulk"),
    )))

    # Note domain
    executor.register("note_add", lambda v, c: _with_store(c, lambda s: svc.note_add(
        s,
        title=v.title,
        content=v.content,
        node_ids=getattr(v, "node_ids", None),
        category=getattr(v, "category", "COORDINATION"),
        source=getattr(v, "source", "agent"),
        scope=getattr(v, "scope", "campaign"),
        knowledge_class=getattr(v, "knowledge_class", "assessment"),
        campaign_id=getattr(v, "campaign_id", None),
        created_by=get_created_by("note", "add"),
    )))
    executor.register("note_list", lambda v, c: _with_store(c, lambda s: svc.note_list(
        s,
        node_id=getattr(v, "node_id", None),
        category=getattr(v, "category", None),
        scope=getattr(v, "scope", None),
        knowledge_class=getattr(v, "knowledge_class", None),
        campaign_id=getattr(v, "campaign_id", None),
        limit=getattr(v, "limit", 50),
        offset=getattr(v, "offset", 0),
    )))
    executor.register("note_show", lambda v, c: _with_store(c, lambda s: svc.note_show(
        s, note_id=v.note_id
    )))
    executor.register("note_promote", lambda v, c: _with_store(c, lambda s: svc.note_promote(
        s,
        note_id=int(v.note_id),
        created_by=get_created_by("note", "promote"),
    )))
    executor.register("note_confirm", lambda v, c: _with_store(c, lambda s: svc.note_confirm(
        s,
        note_id=int(v.note_id),
        created_by=get_created_by("note", "confirm"),
    )))
    executor.register("note_remove", lambda v, c: _with_store(c, lambda s: svc.note_remove(
        s,
        note_id=getattr(v, "note_id", None),
        node_ids=getattr(v, "node_ids", None),
        category=getattr(v, "category", None),
        created_by=get_created_by("note", "remove"),
    )))

    # Repair domain — METHOD→METHOD; reuse the router's resolver so CLI and HTTP
    # share one disambiguation contract (full_name / file).
    from codedmap.api.routers.repair import _resolve_method_node_id

    executor.register("repair_list", lambda v, c: _with_store(c, lambda s: svc.repair_list(s)))
    executor.register("repair_suggest", lambda v, c: _with_store(c, lambda s: svc.repair_suggest(
        s, limit=getattr(v, "limit", 100), offset=getattr(v, "offset", 0)
    )))
    executor.register("repair_link", lambda v, c: _with_store(c, lambda s: svc.repair_link(
        s,
        from_id=_resolve_method_node_id(
            s, v.from_function,
            full_name=getattr(v, "from_full_name", None),
            file=getattr(v, "from_file", None),
            role="caller",
        ),
        to_id=_resolve_method_node_id(
            s, v.to_function,
            full_name=getattr(v, "to_full_name", None),
            file=getattr(v, "to_file", None),
            role="callee",
        ),
        reason=getattr(v, "reason", "other"),
        created_by=get_created_by("repair", "link"),
    )))
    executor.register("repair_undo", lambda v, c: _with_store(c, lambda s: svc.repair_undo(
        s,
        repair_id=v.repair_id,
        created_by=get_created_by("repair", "undo"),
    )))

    # Federation domain — delegates to FederationEngine with SqliteFederationAdapter
    import json as _json

    def _get_federation_engine(context):
        from codedmap.app.services.domain.federation import FederationEngine
        from codedmap.infra.federation.adapters.sqlite_registry import SqliteFederationAdapter
        db_path = getattr(context, "db", None) or ""
        fed_db = str(Path(db_path).parent / "federation.db") if db_path else "federation.db"
        return FederationEngine(adapter=SqliteFederationAdapter(fed_db))

    def _parse_json_str(s):
        """Parse an Optional[str] JSON field into a dict or None."""
        if not s:
            return None
        return _json.loads(s)

    def _execute_federation_register(v, c):
        engine = _get_federation_engine(c)
        return engine.register_graph(
            v.graph_uri,
            metadata=_parse_json_str(getattr(v, "metadata", None)),
        ).model_dump(mode="json")

    executor.register("federation_register", _execute_federation_register)

    def _execute_federation_link(v, c):
        from codedmap.core.schema.common import GlobalNodeRef
        from codedmap.core.schema.federation import BoundaryEdgeType
        engine = _get_federation_engine(c)
        source_ref = GlobalNodeRef(graph_uri=v.source_uri, node_id=v.source_node_id)
        target_ref = GlobalNodeRef(graph_uri=v.target_uri, node_id=v.target_node_id)
        engine.link_boundary(source_ref, target_ref, BoundaryEdgeType(v.edge_type),
                             attrs=_parse_json_str(getattr(v, "properties", None)) or {})
        return {"status": "linked", "source_uri": v.source_uri, "target_uri": v.target_uri, "relation": v.edge_type}

    executor.register("federation_link", _execute_federation_link)

    def _execute_federation_neighbors(v, c):
        engine = _get_federation_engine(c)
        neighbors = engine.get_virtual_neighbors(
            v.graph_uri, v.node_id, edge_types=getattr(v, "edge_types", None)
        )
        return {
            "graph_uri": v.graph_uri,
            "node_id": v.node_id,
            "neighbors": [n.model_dump(mode="json") for n in neighbors],
            "count": len(neighbors),
        }

    executor.register("federation_neighbors", _execute_federation_neighbors)

    # Knowledge domain — delegates to dump_knowledge/project_knowledge

    def _execute_knowledge_dump(v, c):
        from codedmap.app.services.knowledge import dump_knowledge
        ns = argparse.Namespace(db=c.db, backend=c.backend)
        with create_store(ns) as store:
            arts = dump_knowledge(store=store)
            return {
                "artifacts": [a.model_dump(mode="json") for a in arts],
                "total": len(arts),
            }

    executor.register("knowledge_dump", _execute_knowledge_dump)

    def _execute_knowledge_project(v, c):
        from codedmap.app.services.knowledge import project_knowledge, KnowledgeArtifact
        from codedmap.infra.matcher.adapters.sqlite import SqliteMatcherAdapter

        ns = argparse.Namespace(db=c.db, backend=c.backend)
        with create_store(ns) as store:
            # Read JSONL file and parse each line as a knowledge artifact
            lines = Path(v.artifacts_file).read_text(encoding="utf-8").strip().splitlines()
            artifacts = [KnowledgeArtifact.model_validate(_json.loads(line)) for line in lines if line.strip()]
            adapter = SqliteMatcherAdapter(store)
            result = project_knowledge(
                artifacts=artifacts,
                allow_partial=getattr(v, "allow_partial", True),
                adapter=adapter,
                store=store,
            )
            return result.model_dump(mode="json")

    executor.register("knowledge_project", _execute_knowledge_project)

    return executor


def _normalize_local_result(_tool_name: str, payload: dict) -> dict:
    """Normalize local payload into CLI result envelope (schema-driven; no command branching)."""
    total = payload.get("total") if isinstance(payload.get("total"), int) else 1
    return {"kind": "object", "content": payload, "total": total}


def _dispatch_catalog_command_via_executor(args: argparse.Namespace, domain: str) -> None:
    from codedmap.app.contracts.service import CommandRequest, ExecutionContext
    from codedmap.cli._output import CLIResponse, CLIMetadata, OutputFormatter
    from codedmap.cli._remote import is_remote, remote_execute

    if is_remote(args):
        remote_execute(args)
        return

    tool_name = _catalog_tool_name_from_args(args, domain)
    params = _catalog_params_from_args(tool_name, args)
    context = ExecutionContext(
        db=getattr(args, "db", None),
        backend=getattr(args, "backend", "sqlite"),
        agent_id=getpass.getuser(),
        output_format=getattr(args, "output", "json"),
    )

    executor = _build_local_command_executor()
    response = executor.execute(CommandRequest(tool_name=tool_name, params=params, context=context))

    if not response.success:
        formatter = OutputFormatter()
        formatter.render(
            CLIResponse.error_response(
                command=domain,
                code=response.error_code or "INTERNAL_ERROR",
                message=response.error or "Command execution failed.",
            ),
            args,
        )
        return

    result = response.result
    if isinstance(result, dict) and result.get("__cli_envelope__") is True:
        envelope = result
        formatter = OutputFormatter()
        formatter.render(
            CLIResponse(
                command=envelope.get("command", domain),
                target=envelope.get("target"),
                result=envelope.get("result"),
                metadata=CLIMetadata(**envelope.get("metadata", {})),
                success=True,
            ),
            args,
        )
        return

    if isinstance(result, dict):
        payload = result
    elif result is None:
        payload = {}
    else:
        payload = {"value": result}

    normalized = _normalize_local_result(tool_name, payload)
    total = normalized.get("total") if isinstance(normalized.get("total"), int) else 1
    normalized_result = {
        "kind": normalized.get("kind", "object"),
        "content": normalized.get("content"),
    }
    content_obj = normalized_result["content"] if isinstance(normalized_result.get("content"), dict) else {}
    metadata_kwargs = {
        "total": total,
        "limit": content_obj.get("limit", 50),
        "offset": content_obj.get("offset", 0),
        "has_more": content_obj.get("has_more", False),
        "truncated": content_obj.get("truncated", False),
    }
    formatter = OutputFormatter()
    formatter.render(
        CLIResponse(
            command=domain,
            result=normalized_result,
            metadata=CLIMetadata(**metadata_kwargs),
            success=True,
        ),
        args,
    )


# ---------------------------------------------------------------------------
# 3. Target Resolution
# ---------------------------------------------------------------------------

def resolve_target(store: CPGStore, args: argparse.Namespace) -> Optional[CPGNode]:
    """
    Resolve a target node from CLI args.

    Priority: --node-id > --file + --line > --function
    Returns None if no target could be resolved.
    """
    # A) Explicit node ID
    if args.node_id is not None:
        node = store.get_node(args.node_id)
        if node is None:
            print(f"Error: Node ID {args.node_id} not found.", file=sys.stderr)
        return node

    resolver = NodeResolver(store)

    # B) File + Line location
    if args.file and args.line is not None:
        query = LocationQuery(file_path=args.file, line_number=args.line)
        node = resolver.resolve_location(query)
        if node is None:
            print(
                f"Error: No node found at {args.file}:{args.line}.",
                file=sys.stderr,
            )
        return node

    # C) Function name
    if args.function:
        methods = resolver.resolve_function(args.function)
        if not methods:
            print(
                f"Error: Function '{args.function}' not found.",
                file=sys.stderr,
            )
            return None
        if len(methods) > 1:
            from codedmap.cli._output import _node_to_dict
            candidates = [_node_to_dict(m) for m in methods]
            raise AmbiguousTargetError(query=args.function, candidates=candidates)
        return methods[0]

    return None


def resolve_target_or_exit(store: CPGStore, args: argparse.Namespace) -> CPGNode:
    """Like resolve_target but exits on failure."""
    node = resolve_target(store, args)
    if node is None:
        print(
            "Error: No target specified. Use --function, --file/--line, or --node-id.",
            file=sys.stderr,
        )
        sys.exit(1)
    return node


# ---------------------------------------------------------------------------
# 3b. Module Scope Resolution
# ---------------------------------------------------------------------------

def resolve_module_scope(store: CPGStore, args: argparse.Namespace) -> Optional[ModuleScope]:
    """CLI-facing wrapper over shared module-scope resolution."""
    module_id = getattr(args, "module_id", None)
    module_name = getattr(args, "module", None)
    return _resolve_module_scope_shared(
        store=store,
        module=module_name,
        module_id=module_id,
    )


def resolve_project_scope(store, args) -> Optional[str]:
    """Read --project flag from args and return the project_name string, or None.

    Simpler than resolve_module_scope — no navigator lookup needed.
    Returns the project_name string directly (for use as a filter on MetaDataNode).
    """
    return getattr(args, "project", None) or None


def filter_by_project(nodes: list, project_name: Optional[str], store) -> list:
    """Filter a node list to those belonging to the specified project.

    Args:
        nodes: List of CPGNode instances to filter.
        project_name: Project name to filter by. If None, returns nodes unchanged.
        store: CPGStore for resolving ancestry (currently pass-through).

    Returns:
        Filtered node list. For single-project DBs this is a pass-through.
        TODO: implement MetaDataNode lookup chain once multi-project DBs are populated.
    """
    if project_name is None:
        return nodes
    # TODO: traverse from node -> file -> MetaDataNode and match project_name
    # For now, pass-through (correct infrastructure for single-project DBs)
    return nodes


def filter_by_scope(nodes: list, scope: Optional[ModuleScope], store: CPGStore) -> list:
    """CLI-facing wrapper over shared module-scope filtering."""
    return _filter_by_scope_shared(nodes=nodes, scope=scope, store=store)


# ---------------------------------------------------------------------------
# 4. Output Helpers
# ---------------------------------------------------------------------------

def format_node_brief(node) -> str:
    """Single-line node summary: [LABEL] name (file:line, id=N). Accepts CPGNode or dict."""
    if isinstance(node, dict):
        return f"[{node.get('label', '?')}] {node.get('name', '?')} ({node.get('file', '?')}:{node.get('line', '?')}, id={node.get('id', '?')})"
    label = getattr(node, "label", "UNKNOWN")
    if hasattr(label, "value"):
        label = label.value
    name = getattr(node, "name", getattr(node, "fullName", "?"))
    file_name = getattr(node, "file_name", "?") or "?"
    line = getattr(node, "line_number", None) or getattr(node, "lineNumber", None) or "?"
    node_id = getattr(node, "id", "?")
    return f"[{label}] {name} ({file_name}:{line}, id={node_id})"


def format_nodes_table(nodes: List[CPGNode], limit: int = 50) -> str:
    """Format a list of nodes as a text table."""
    if not nodes:
        return "(no results)"

    lines = [f"Found {len(nodes)} result(s):\n"]
    for i, node in enumerate(nodes[:limit]):
        lines.append(f"  {i+1}. {format_node_brief(node)}")
    if len(nodes) > limit:
        lines.append(f"  ... and {len(nodes) - limit} more.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 5. Safe Main Wrapper
# ---------------------------------------------------------------------------

def safe_main(func):
    """
    Decorator that wraps a CLI command's main() with:
    - Exception handling (prints to stderr, exits 1)
    - Store context manager cleanup
    - JSON envelope output on errors when --output json
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except SystemExit:
            raise
        except KeyboardInterrupt:
            _output_error_on_crash("INTERRUPTED", "Operation cancelled", args)
            sys.exit(130)
        except AmbiguousTargetError as e:
            # Extract the argparse namespace from the wrapper's positional args
            ns = _extract_namespace(args)
            output_mode = getattr(ns, "output", "text") if ns else "text"
            if output_mode == "json":
                from codedmap.cli._output import CLIResponse, OutputFormatter
                response = CLIResponse.ambiguous_response(
                    command=func.__name__.replace("run_", ""),
                    query=e.query,
                    candidates=e.candidates,
                )
                print(response.to_json())
            else:
                print(
                    f"Error: {e.query} matches {len(e.candidates)} nodes. "
                    f"Use --node-id to disambiguate:",
                    file=sys.stderr,
                )
                for c in e.candidates:
                    print(f"  id={c.get('id')} {c.get('name')} ({c.get('file')}:{c.get('line')})", file=sys.stderr)
            sys.exit(1)
        except ModuleNotFoundError as e:
            ns = _extract_namespace(args)
            output_mode = getattr(ns, "output", "text") if ns else "text"
            if output_mode == "json":
                from codedmap.cli._output import CLIResponse
                msg = f"Module not found: '{e.name}'"
                if e.suggestions:
                    msg += f". Did you mean: {', '.join(e.suggestions)}?"
                response = CLIResponse.error_response(
                    command=func.__name__.replace("run_", ""),
                    code="MODULE_NOT_FOUND",
                    message=msg,
                )
                print(response.to_json())
            else:
                print(f"Error: Module not found: '{e.name}'", file=sys.stderr)
                if e.suggestions:
                    print(f"  Did you mean: {', '.join(e.suggestions)}?", file=sys.stderr)
            sys.exit(1)
        except AmbiguousModuleError as e:
            ns = _extract_namespace(args)
            output_mode = getattr(ns, "output", "text") if ns else "text"
            if output_mode == "json":
                from codedmap.cli._output import CLIResponse, CLIError, CLIMetadata
                response = CLIResponse(
                    command=func.__name__.replace("run_", ""),
                    target={"raw": e.name},
                    result={"kind": "object", "content": {"candidates": e.candidates, "total": len(e.candidates)}},
                    metadata=CLIMetadata(total=len(e.candidates)),
                    success=False,
                    error=CLIError(
                        code="AMBIGUOUS_MODULE",
                        message=f"Ambiguous module: '{e.name}' matches {len(e.candidates)} modules. "
                                f"Use --module-id to disambiguate.",
                    ),
                )
                print(response.to_json())
            else:
                print(
                    f"Error: '{e.name}' matches {len(e.candidates)} modules. "
                    f"Use --module-id to disambiguate:",
                    file=sys.stderr,
                )
                for c in e.candidates:
                    print(f"  id={c.get('id')} {c.get('name')}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            _output_error_on_crash("INTERNAL_ERROR", str(e), args)
            logger.debug("Full traceback:", exc_info=True)
            sys.exit(1)
    return wrapper


def _extract_namespace(args_tuple):
    """Extract argparse Namespace from safe_main's *args tuple."""
    if not args_tuple:
        return None
    # The first positional argument to run(args) is the Namespace
    candidate = args_tuple[0]
    if isinstance(candidate, argparse.Namespace):
        return candidate
    return None


def _output_error_on_crash(code: str, message: str, args_tuple) -> None:
    """Output error envelope when CLI crashes. Uses JSON if --output json, else stderr."""
    ns = _extract_namespace(args_tuple)
    output_mode = getattr(ns, "output", "text") if ns else "text"

    if output_mode == "json":
        from codedmap.cli._output import CLIResponse
        response = CLIResponse.error_response(
            command="unknown",
            code=code,
            message=message,
        )
        print(response.to_json())
    else:
        print(f"Error: {message}", file=sys.stderr)
