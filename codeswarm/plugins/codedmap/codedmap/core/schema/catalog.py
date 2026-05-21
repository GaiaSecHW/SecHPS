# codedmap/core/schema/catalog.py
"""
Structured tool catalog — single source of truth for all CPG commands.

Defines CommandDefinition + ~49 Pydantic input models that drive:
- CLI help strings
- API OpenAPI descriptions
- /api/v1/tools manifest
- LLM function-calling schemas

All input models are pure Pydantic with zero heavy dependencies.
Connection/output params (--db, --backend, --remote, --api-key, --output, --offset)
are intentionally excluded — they are injected by the CLI layer.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, ConfigDict, Field


class RepairReason(str, Enum):
    """Valid justifications for a `repair link` operation.

    Kept here so the REST router, CLI argparse, and service layer share one
    source of truth. Enum membership is checked at the boundary (request
    parsing) before any graph mutation runs.
    """

    FUNCTION_POINTER = "function_pointer"
    CALLBACK = "callback"
    VTABLE = "vtable"
    DLSYM = "dlsym"
    IOCTL = "ioctl"
    SIGNAL_HANDLER = "signal_handler"
    OTHER = "other"
    IPC = "ipc"
    SYSCALL = "syscall"
    RPC = "rpc"
    SHARED_DATA = "shared_data"


def _inline_refs(schema: Any) -> Any:
    """Inline `$defs` references inside a Pydantic-emitted JSON schema.

    Pydantic lifts named sub-schemas (enums, nested models) into a top-level
    `$defs` block and points to them with `$ref`. Our catalog consumers treat
    each property dict as self-describing, so references are resolved eagerly
    into their target schema and the `$defs` block is dropped.
    """
    if not isinstance(schema, dict):
        return schema

    defs = schema.pop("$defs", None) if "$defs" in schema else None

    def _resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node and defs is not None:
                ref = node["$ref"]
                if ref.startswith("#/$defs/"):
                    target = defs.get(ref.split("/", 2)[-1])
                    if target is not None:
                        merged = _resolve({k: v for k, v in target.items()})
                        for k, v in node.items():
                            if k != "$ref":
                                merged[k] = v
                        return merged
            return {k: _resolve(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_resolve(item) for item in node]
        return node

    return _resolve(schema)


# ---------------------------------------------------------------------------
# CommandDefinition
# ---------------------------------------------------------------------------

class CommandDefinition(BaseModel):
    """Describes one CPG command for use by CLI, API, and LLM tool-calling.

    Attributes:
        name:             Underscore format, e.g. "module_assign".
        domain:           One of the 9 top-level domains.
        subcommand:       The subcommand within the domain.
        description:      Agent-friendly single sentence describing what the command does.
        input_model:      Pydantic model class for business-logic parameters.
        read_write:       "read" for queries, "write" for mutations.
        requires_agent_id: True for write API endpoints requiring X-Agent-ID header.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    domain: str
    subcommand: str
    description: str
    input_model: Type[BaseModel]
    read_write: str = "read"
    requires_agent_id: bool = False
    pagination_enabled: bool = False
    default_limit: Optional[int] = None
    max_limit: Optional[int] = None

    def schema(self) -> dict:
        """Return JSON schema for the input model with `$ref` inlined.

        Consumers (cdm_client.py, LLM tool-call runners) read properties
        directly and do not resolve `$ref`. Inlining the `$defs` block lets
        those consumers pick up enum constraints and descriptions in place.
        """
        raw = self.input_model.model_json_schema()
        return _inline_refs(raw)

    def to_tool_dict(self) -> dict:
        """Return tool dict for LLM function-calling and cpg_client.py consumption."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.schema(),
            "domain": self.domain,
            "subcommand": self.subcommand,
            "read_write": self.read_write,
            "requires_agent_id": self.requires_agent_id,
            "pagination": {
                "enabled": self.pagination_enabled,
                "default_limit": self.default_limit,
                "max_limit": self.max_limit,
            },
        }


# ---------------------------------------------------------------------------
# Query domain input models (11 subcommands)
# ---------------------------------------------------------------------------

class QuerySearchInput(BaseModel):
    """Find CPG nodes by name pattern across all node types."""
    pattern: str
    type: str = "method"
    limit: int = 20
    offset: int = 0
    module: Optional[str] = None
    module_id: Optional[int] = None


class QueryInspectInput(BaseModel):
    """Inspect a CPG node in detail: source, callers, callees, tags."""
    function: Optional[str] = None
    file: Optional[str] = None
    line: Optional[int] = None
    node_id: Optional[int] = None
    detail: bool = False
    hierarchy: bool = False
    module: Optional[str] = None
    module_id: Optional[int] = None
    only: Optional[str] = Field(None, description="Filter result sections (comma-separated): callers, callees, tags, source")


class QueryTraceInput(BaseModel):
    """Trace caller chains, data flow, or CFG reachability from a target node."""
    function: Optional[str] = None
    node_id: Optional[int] = None
    depth: int = 5
    taint: bool = False
    dataflow: bool = False
    reachable: bool = False
    from_function: Optional[str] = None
    to_function: Optional[str] = None
    from_node_id: Optional[int] = None
    to_node_id: Optional[int] = None
    module: Optional[str] = None


class QueryEntrypointsInput(BaseModel):
    """List attack surface entry points (network listeners, syscall handlers, IPC endpoints)."""
    level: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    filter_file: Optional[str] = None
    limit: int = 50
    offset: int = 0
    show_all: bool = False
    with_context: bool = False
    lines: int = 25
    call_depth: int = 1
    include_trace: bool = True
    module: Optional[str] = None


class QueryStatsInput(BaseModel):
    """Show tactical graph statistics: node counts, tag coverage, hot spots."""
    module: Optional[str] = None
    module_id: Optional[int] = None


class QueryTreeInput(BaseModel):
    """Show project structure as file/class/function tree."""
    pass


class QuerySourcesInput(BaseModel):
    """List detected source nodes (untrusted inputs entering the program)."""
    category: Optional[str] = None
    function: Optional[str] = None
    type: Optional[str] = None
    limit: int = 50
    offset: int = 0
    module: Optional[str] = None


class QuerySinksInput(BaseModel):
    """List detected sink nodes (dangerous operations that consume tainted data)."""
    category: Optional[str] = None
    function: Optional[str] = None
    type: Optional[str] = None
    limit: int = 50
    offset: int = 0
    module: Optional[str] = None


class QueryGuardsInput(BaseModel):
    """List detected guard nodes (validation checks that sanitize or block bad inputs)."""
    category: Optional[str] = None
    function: Optional[str] = None
    type: Optional[str] = None
    limit: int = 50
    offset: int = 0
    module: Optional[str] = None


class QuerySanitizersInput(BaseModel):
    """List detected sanitizer nodes (transformations that neutralize taint)."""
    category: Optional[str] = None
    function: Optional[str] = None
    type: Optional[str] = None
    limit: int = 50
    offset: int = 0
    module: Optional[str] = None


class QueryRolesInput(BaseModel):
    """List nodes tagged with ROLE: security role annotations."""
    category: Optional[str] = None
    function: Optional[str] = None
    limit: int = 50
    offset: int = 0
    module: Optional[str] = None


# ---------------------------------------------------------------------------
# Note domain input models (4 subcommands)
# ---------------------------------------------------------------------------

class NoteAddInput(BaseModel):
    """Create an audit note attached to 0..N CPG nodes.

    Strict categories (JSON schema validated):
        VULNERABILITY, COORDINATION, SECURITY_BOUNDARY

    Non-strict categories (opaque string content):
        ARCHITECTURE, DATA_FLOW, CONTROL_FLOW
    """
    title: str = Field(..., description="Short title for the note (summary line).")
    content: str = Field(
        ...,
        description=(
            "Note body. For strict categories (VULNERABILITY, COORDINATION, "
            "SECURITY_BOUNDARY), provide a valid JSON string."
        ),
    )
    category: str = Field(
        default="COORDINATION",
        description=(
            "Note category. Allowed: ARCHITECTURE, DATA_FLOW, CONTROL_FLOW, "
            "VULNERABILITY, COORDINATION, SECURITY_BOUNDARY."
        ),
    )
    node_ids: Optional[List[int]] = None
    source: Optional[str] = None
    scope: str = Field(default="campaign", description="Knowledge layer scope for this note.")
    knowledge_class: str = Field(default="assessment", description="Knowledge semantic class for this note.")
    campaign_id: Optional[str] = Field(default=None, description="Campaign identifier for run-scoped notes.")


class NoteListInput(BaseModel):
    """List audit notes. Default visibility is current campaign + stable_confirmed."""
    node_id: Optional[int] = Field(default=None, description="Only list notes attached to this node.")
    category: Optional[str] = Field(default=None, description="Filter by note category.")
    scope: Optional[str] = Field(
        default=None,
        description="Filter by scope: campaign, stable_candidate, stable_confirmed, or all.",
    )
    knowledge_class: Optional[str] = Field(default=None, description="Filter by knowledge class.")
    campaign_id: Optional[str] = Field(
        default=None,
        description="Filter campaign-scoped notes by campaign ID. Cannot be used with --scope all.",
    )
    limit: int = 50
    offset: int = 0


class NoteShowInput(BaseModel):
    """Show full content of a single audit note by ID."""
    note_id: str


class NotePromoteInput(BaseModel):
    """Promote a campaign fact note into stable_candidate."""
    note_id: str


class NoteConfirmInput(BaseModel):
    """Confirm a stable_candidate note into stable_confirmed."""
    note_id: str


class NoteRemoveInput(BaseModel):
    """Remove an audit note by ID or unbind it from specific nodes."""
    note_id: Optional[str] = None
    node_ids: Optional[List[int]] = None
    category: Optional[str] = None


# ---------------------------------------------------------------------------
# Tag domain input models (5 subcommands)
# ---------------------------------------------------------------------------

class TagAddInput(BaseModel):
    """Attach a security tag to a CPG node with optional justification and confidence."""
    tag: str = Field(
        ...,
        description=(
            "Tag value. Formats: L1 ONTOLOGY:{ENTRY_POINT|SOURCE|SINK|GUARD|SANITIZER|ROLE}:{NAME}; "
            "L2 SEMANTIC:{NAMESPACE}:{NAME}; "
            "L3 STATE:{REVIEWED|SUSPICIOUS|FALSE_POSITIVE|CONFIRMED_VULN|CUSTOM:{NAME}}. "
            "Write policy: ONTOLOGY ENTRY_POINT/SOURCE/SINK are system-only read-only; "
            "ONTOLOGY GUARD/SANITIZER/ROLE require --justification for agent writes."
        ),
    )
    function: Optional[str] = None
    node_id: Optional[int] = None
    file: Optional[str] = None
    line: Optional[int] = None
    justification: Optional[str] = None
    confidence: Optional[float] = None


class TagRemoveInput(BaseModel):
    """Remove a security tag from a CPG node."""
    tag: str
    function: Optional[str] = None
    node_id: Optional[int] = None
    file: Optional[str] = None
    line: Optional[int] = None


class TagListInput(BaseModel):
    """List all tags on a CPG node."""
    function: Optional[str] = None
    node_id: Optional[int] = None
    file: Optional[str] = None
    line: Optional[int] = None
    limit: int = 50
    offset: int = 0
    verbose: bool = False


class TagFindInput(BaseModel):
    """Find all nodes tagged with a given tag pattern across the graph."""
    tag: str
    module: Optional[str] = None
    module_id: Optional[int] = None
    limit: int = 50
    offset: int = 0
    verbose: bool = False


class TagBulkInput(BaseModel):
    """Apply bulk security tags from a JSONL file."""
    file_path: str


# ---------------------------------------------------------------------------
# Module domain input models (9 subcommands)
# ---------------------------------------------------------------------------

class ModuleCreateInput(BaseModel):
    """Create a new MACRO-architecture logical module."""
    name: str
    description: Optional[str] = None


class ModuleDeleteInput(BaseModel):
    """Delete a module and all its CONTAINS edges."""
    name: str


class ModuleRenameInput(BaseModel):
    """Rename a module while preserving all file assignments."""
    name: str
    new_name: str


class ModuleListInput(BaseModel):
    """List all modules with file and method counts."""
    limit: int = 50
    offset: int = 0
    show_all: bool = False


class ModuleShowInput(BaseModel):
    """Show module details: description, assigned files, and metrics."""
    name: str
    verbose: bool = False


class ModuleAssignInput(BaseModel):
    """Assign source files to a MACRO-architecture logical module by glob pattern."""
    name: str
    paths: List[str]
    justification: str
    confidence: Optional[float] = None


class ModuleRemoveInput(BaseModel):
    """Remove source files from a module by glob pattern."""
    name: str
    paths: List[str]


class ModuleOfInput(BaseModel):
    """Find which module(s) contain a given node."""
    function: Optional[str] = None
    node_id: Optional[int] = None
    file: Optional[str] = None
    line: Optional[int] = None


class ModuleDepsInput(BaseModel):
    """Show inter-module dependency graph based on cross-module call edges."""
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# Repair domain input models (4 subcommands)
# ---------------------------------------------------------------------------

class RepairLinkInput(BaseModel):
    """Create a missing CALL edge between two functions to repair the call graph."""
    from_function: str
    from_full_name: Optional[str] = None
    from_file: Optional[str] = None
    to_function: str
    to_full_name: Optional[str] = None
    to_file: Optional[str] = None
    reason: RepairReason


class RepairSuggestInput(BaseModel):
    """Suggest missing call edges based on unresolved CALL nodes."""
    function: Optional[str] = None
    limit: int = 20
    offset: int = 0


class RepairListInput(BaseModel):
    """List all active call-graph repairs in the current session."""
    pass


class RepairUndoInput(BaseModel):
    """Remove a previously applied call-graph repair by repair ID."""
    repair_id: str


# ---------------------------------------------------------------------------
# Rules domain input models (10 subcommands)
# ---------------------------------------------------------------------------

class RulesListInput(BaseModel):
    """List all active security rules by type."""
    type: Optional[str] = None
    limit: int = 50
    offset: int = 0
    show_origin: bool = False


class RulesCategoriesInput(BaseModel):
    """Show valid L1 ontology category values for sinks, sources, guards, and entrypoints."""
    pass


class RulesShowInput(BaseModel):
    """Show the merged ruleset including origin and tombstone status."""
    name: Optional[str] = None
    merged: bool = False
    show_origin: bool = False


class RulesResolveInput(BaseModel):
    """Resolve which rules apply to a specific function name."""
    name: str


class RulesAddSinkInput(BaseModel):
    """Add a sink rule to the project-local rule YAML."""
    name: str
    category: str
    languages: Optional[List[str]] = None


class RulesAddSourceInput(BaseModel):
    """Add a source rule to the project-local rule YAML."""
    name: str
    category: str
    languages: Optional[List[str]] = None


class RulesAddSafeInput(BaseModel):
    """Add a safe function rule to suppress false positives."""
    name: str


class RulesAddEntrypointInput(BaseModel):
    """Add an entrypoint rule to the project-local rule YAML."""
    name: str
    category: Optional[str] = None


class RulesTombstoneInput(BaseModel):
    """Suppress a global rule by adding a tombstone entry."""
    rule_id: str
    reason: str


class RulesValidateInput(BaseModel):
    """Validate all project-local rule YAML files for schema correctness."""
    pass


# ---------------------------------------------------------------------------
# Federation domain input models (3 subcommands)
# ---------------------------------------------------------------------------

class FederationRegisterInput(BaseModel):
    """Register a graph URI in the federation index."""
    graph_uri: str = Field(..., description="Graph URI to register (e.g., 'sqlite:///path/to/graph.db')")
    metadata: Optional[str] = Field(
        default=None,
        description="Optional JSON metadata string (e.g., '{\"project\":\"myapp\"}')",
    )


class FederationLinkInput(BaseModel):
    """Create a typed cross-boundary edge between two graph nodes."""
    source_uri: str = Field(..., description="URI of the source graph")
    target_uri: str = Field(..., description="URI of the target graph")
    edge_type: str = Field(..., description="Cross-boundary edge type: IPC, SYSCALL, RPC, or SHARED_DATA")
    source_node_id: int = Field(..., description="Node ID in the source graph")
    target_node_id: int = Field(..., description="Node ID in the target graph")
    properties: Optional[str] = Field(
        default=None,
        description="Optional JSON edge properties string (e.g., '{\"protocol\":\"grpc\"}')",
    )


class FederationNeighborsInput(BaseModel):
    """Enumerate cross-boundary neighbors of a node across federated graphs."""
    graph_uri: str = Field(..., description="URI of the graph containing the node")
    node_id: int = Field(..., description="ID of the node to query")
    depth: int = Field(default=1, description="Traversal depth (default: 1)")
    edge_types: Optional[List[str]] = Field(
        default=None,
        description="Filter by edge types (IPC, SYSCALL, RPC, SHARED_DATA)",
    )


# ---------------------------------------------------------------------------
# Knowledge domain input models (2 subcommands)
# ---------------------------------------------------------------------------

class KnowledgeDumpInput(BaseModel):
    """Dump all knowledge artifacts (notes and tags) from the active graph."""
    pass  # No parameters — dump reads everything


class KnowledgeProjectInput(BaseModel):
    """Project knowledge artifacts onto the active graph via semantic matching."""
    artifacts_file: str = Field(..., description="Path to JSONL file containing knowledge artifacts")
    allow_partial: bool = Field(default=True, description="Allow partial success (default: true)")


# ---------------------------------------------------------------------------
# Build domain input models (3 subcommands)
# ---------------------------------------------------------------------------

class BuildInput(BaseModel):
    """Build a CPG database from source code at the given path."""
    path: str
    config: Optional[str] = None


class BuildStatusInput(BaseModel):
    """Check the status of a running or completed build job."""
    job_id: str


class BuildEnhanceInput(BaseModel):
    """Run analysis passes on an existing CPG database."""
    passes: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Serve domain input model (1 subcommand)
# ---------------------------------------------------------------------------

class ServeInput(BaseModel):
    """Start the CPG REST API server on the specified host and port."""
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1


# ---------------------------------------------------------------------------
# Domain descriptions — SSOT for CLI, API, and cpg_client help text
# ---------------------------------------------------------------------------

DOMAIN_DESCRIPTIONS: Dict[str, str] = {
    "query": "Read-only graph traversal & dataflow analysis (search, inspect, trace, entrypoints, sources, sinks, guards, sanitizers, roles, stats, tree)",
    "module": "Manage MACRO-architecture logical views (group files/dirs, analyze deps)",
    "tag": (
        "Apply MICRO-level semantic/state tags to AST nodes. Layer formats: "
        "L1 ONTOLOGY:{NAMESPACE}:{NAME}, L2 SEMANTIC:{NAMESPACE}:{NAME}, "
        "L3 STATE:{NAME|CUSTOM:{NAME}}. L1 write policy: ENTRY_POINT/SOURCE/SINK "
        "are system-only; GUARD/SANITIZER/ROLE are collaborative with justification. "
        "See docs/TAG_SYSTEM.md"
    ),
    "note": (
        "Attach audit insight notes to nodes. Categories: ARCHITECTURE, DATA_FLOW, "
        "CONTROL_FLOW, VULNERABILITY, COORDINATION, SECURITY_BOUNDARY. "
        "See docs/NOTE_SYSTEM.md"
    ),
    "repair": "Manually patch broken CALL edges to fix dataflow traces",
    "rules": "Manage project-specific analysis rules (define custom sources, sinks, safe functions)",
    "knowledge": "Project typed knowledge artifacts (NOTE, TAG) onto CPG nodes via semantic matching",
    "federation": "Cross-graph federation coordination — register graphs, link boundaries, query virtual neighbors",
    "build": "Build CPG graph from source code or Joern CSV export",
    "serve": "Start the CPG REST API server",
}


# ---------------------------------------------------------------------------
# CATALOG
# ---------------------------------------------------------------------------

CATALOG: List[CommandDefinition] = [
    # --- Query domain ---
    CommandDefinition(
        name="query_search",
        domain="query",
        subcommand="search",
        description="Find CPG nodes by name pattern across all node types",
        input_model=QuerySearchInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=20,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_inspect",
        domain="query",
        subcommand="inspect",
        description="Show full details for a node: source code, callers, callees, tags, and DDG slices",
        input_model=QueryInspectInput,
        read_write="read",
    ),
    CommandDefinition(
        name="query_trace",
        domain="query",
        subcommand="trace",
        description="Trace caller chains, data flow, taint paths, or CFG reachability from a target node",
        input_model=QueryTraceInput,
        read_write="read",
    ),
    CommandDefinition(
        name="query_entrypoints",
        domain="query",
        subcommand="entrypoints",
        description="List attack surface entry points (network listeners, syscall handlers, IPC endpoints)",
        input_model=QueryEntrypointsInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_stats",
        domain="query",
        subcommand="stats",
        description="Show tactical audit statistics: node counts, tag coverage, unaudited sink hot spots",
        input_model=QueryStatsInput,
        read_write="read",
    ),
    CommandDefinition(
        name="query_tree",
        domain="query",
        subcommand="tree",
        description="Show project structure as file/class/function hierarchy tree",
        input_model=QueryTreeInput,
        read_write="read",
    ),
    CommandDefinition(
        name="query_sources",
        domain="query",
        subcommand="sources",
        description="List detected source nodes where untrusted data enters the program",
        input_model=QuerySourcesInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_sinks",
        domain="query",
        subcommand="sinks",
        description="List detected sink nodes where tainted data reaches dangerous operations",
        input_model=QuerySinksInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_guards",
        domain="query",
        subcommand="guards",
        description="List detected guard nodes that validate or check inputs before dangerous operations",
        input_model=QueryGuardsInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_sanitizers",
        domain="query",
        subcommand="sanitizers",
        description="List detected sanitizer nodes that neutralize or transform tainted data",
        input_model=QuerySanitizersInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="query_roles",
        domain="query",
        subcommand="roles",
        description="List nodes tagged with ROLE security annotations (e.g., ROLE:HANDLER, ROLE:AUTH)",
        input_model=QueryRolesInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    # --- Note domain ---
    CommandDefinition(
        name="note_add",
        domain="note",
        subcommand="add",
        description="Create an audit note attached to 0..N CPG nodes",
        input_model=NoteAddInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="note_list",
        domain="note",
        subcommand="list",
        description="List audit notes globally or filtered to a specific node",
        input_model=NoteListInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="note_show",
        domain="note",
        subcommand="show",
        description="Show full content of a single audit note by UUID",
        input_model=NoteShowInput,
        read_write="read",
    ),
    CommandDefinition(
        name="note_promote",
        domain="note",
        subcommand="promote",
        description="Promote a campaign fact note into stable candidate knowledge",
        input_model=NotePromoteInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="note_confirm",
        domain="note",
        subcommand="confirm",
        description="Confirm a stable candidate note into stable confirmed knowledge",
        input_model=NoteConfirmInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="note_remove",
        domain="note",
        subcommand="remove",
        description="Remove an audit note by UUID or unbind it from specific nodes",
        input_model=NoteRemoveInput,
        read_write="write",
        requires_agent_id=True,
    ),
    # --- Tag domain ---
    CommandDefinition(
        name="tag_add",
        domain="tag",
        subcommand="add",
        description="Attach a security tag to a CPG node with optional justification and confidence",
        input_model=TagAddInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="tag_remove",
        domain="tag",
        subcommand="remove",
        description="Remove a security tag from a CPG node",
        input_model=TagRemoveInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="tag_list",
        domain="tag",
        subcommand="list",
        description="List all security tags on a specific CPG node",
        input_model=TagListInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="tag_find",
        domain="tag",
        subcommand="find",
        description="Find all nodes in the graph tagged with a given tag pattern",
        input_model=TagFindInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="tag_bulk",
        domain="tag",
        subcommand="bulk",
        description="Apply bulk security tags from a JSONL file in one transaction",
        input_model=TagBulkInput,
        read_write="write",
        requires_agent_id=True,
    ),
    # --- Module domain ---
    CommandDefinition(
        name="module_create",
        domain="module",
        subcommand="create",
        description="Create a new MACRO-architecture logical module node",
        input_model=ModuleCreateInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="module_delete",
        domain="module",
        subcommand="delete",
        description="Delete a module and cascade-remove all CONTAINS edges",
        input_model=ModuleDeleteInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="module_rename",
        domain="module",
        subcommand="rename",
        description="Rename a module while preserving all file assignments",
        input_model=ModuleRenameInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="module_list",
        domain="module",
        subcommand="list",
        description="List all modules with file and method counts",
        input_model=ModuleListInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=500,
    ),
    CommandDefinition(
        name="module_show",
        domain="module",
        subcommand="show",
        description="Show module details: description, assigned files, and coverage metrics",
        input_model=ModuleShowInput,
        read_write="read",
    ),
    CommandDefinition(
        name="module_assign",
        domain="module",
        subcommand="assign",
        description="Assign source files to a MACRO-architecture logical module by glob pattern",
        input_model=ModuleAssignInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="module_remove",
        domain="module",
        subcommand="remove",
        description="Remove source files from a module by glob pattern",
        input_model=ModuleRemoveInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="module_of",
        domain="module",
        subcommand="of",
        description="Find which module(s) contain a given node, file, or function",
        input_model=ModuleOfInput,
        read_write="read",
    ),
    CommandDefinition(
        name="module_deps",
        domain="module",
        subcommand="deps",
        description="Show the inter-module dependency graph based on cross-module call edges",
        input_model=ModuleDepsInput,
        read_write="read",
    ),
    # --- Repair domain ---
    CommandDefinition(
        name="repair_link",
        domain="repair",
        subcommand="link",
        description="Create a missing CALL edge between two functions to repair an incomplete call graph",
        input_model=RepairLinkInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="repair_suggest",
        domain="repair",
        subcommand="suggest",
        description="Suggest missing call edges by finding unresolved CALL nodes with matching candidates",
        input_model=RepairSuggestInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=20,
        max_limit=500,
    ),
    CommandDefinition(
        name="repair_list",
        domain="repair",
        subcommand="list",
        description="List all active call-graph repairs applied in the current session",
        input_model=RepairListInput,
        read_write="read",
    ),
    CommandDefinition(
        name="repair_undo",
        domain="repair",
        subcommand="undo",
        description="Remove a previously applied call-graph repair by repair ID",
        input_model=RepairUndoInput,
        read_write="write",
        requires_agent_id=True,
    ),
    # --- Rules domain ---
    CommandDefinition(
        name="rules_list",
        domain="rules",
        subcommand="list",
        description="List all active security rules (sinks, sources, guards, entrypoints) by type",
        input_model=RulesListInput,
        read_write="read",
        pagination_enabled=True,
        default_limit=50,
        max_limit=1000,
    ),
    CommandDefinition(
        name="rules_categories",
        domain="rules",
        subcommand="categories",
        description="Show valid L1 ontology category values for sinks, sources, guards, and entrypoints",
        input_model=RulesCategoriesInput,
        read_write="read",
    ),
    CommandDefinition(
        name="rules_show",
        domain="rules",
        subcommand="show",
        description="Show the merged ruleset with origin (SDK_CORE vs LOCAL_OVERRIDE) and tombstone status",
        input_model=RulesShowInput,
        read_write="read",
    ),
    CommandDefinition(
        name="rules_resolve",
        domain="rules",
        subcommand="resolve",
        description="Resolve which security rules apply to a specific function name",
        input_model=RulesResolveInput,
        read_write="read",
    ),
    CommandDefinition(
        name="rules_add_sink",
        domain="rules",
        subcommand="add_sink",
        description="Add a sink rule to the project-local rule YAML for a dangerous function",
        input_model=RulesAddSinkInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="rules_add_source",
        domain="rules",
        subcommand="add_source",
        description="Add a source rule to the project-local rule YAML for an untrusted input function",
        input_model=RulesAddSourceInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="rules_add_safe",
        domain="rules",
        subcommand="add_safe",
        description="Add a safe function rule to the project-local YAML to suppress false positives",
        input_model=RulesAddSafeInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="rules_add_entrypoint",
        domain="rules",
        subcommand="add_entrypoint",
        description="Add an entrypoint rule to the project-local rule YAML for a custom entry point",
        input_model=RulesAddEntrypointInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="rules_tombstone",
        domain="rules",
        subcommand="tombstone",
        description="Suppress a global SDK rule by adding a tombstone entry with a mandatory reason",
        input_model=RulesTombstoneInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="rules_validate",
        domain="rules",
        subcommand="validate",
        description="Validate all project-local rule YAML files for schema correctness",
        input_model=RulesValidateInput,
        read_write="read",
    ),
    # --- Build domain ---
    CommandDefinition(
        name="build_start",
        domain="build",
        subcommand="start",
        description="Build a CPG database from source code at the given path",
        input_model=BuildInput,
        read_write="write",
    ),
    CommandDefinition(
        name="build_status",
        domain="build",
        subcommand="status",
        description="Check the status of a running or completed build job",
        input_model=BuildStatusInput,
        read_write="read",
    ),
    CommandDefinition(
        name="build_enhance",
        domain="build",
        subcommand="enhance",
        description="Run analysis passes (CFG, DDG, call graph, security tagging) on an existing CPG database",
        input_model=BuildEnhanceInput,
        read_write="write",
    ),
    # --- Serve domain ---
    CommandDefinition(
        name="serve",
        domain="serve",
        subcommand="serve",
        description="Start the CPG REST API server exposing all commands as HTTP endpoints",
        input_model=ServeInput,
        read_write="read",
    ),
    # --- Federation domain ---
    CommandDefinition(
        name="federation_register",
        domain="federation",
        subcommand="register",
        description="Register a graph URI in the federation index",
        input_model=FederationRegisterInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="federation_link",
        domain="federation",
        subcommand="link",
        description="Create a typed cross-boundary edge between two graph nodes",
        input_model=FederationLinkInput,
        read_write="write",
        requires_agent_id=True,
    ),
    CommandDefinition(
        name="federation_neighbors",
        domain="federation",
        subcommand="neighbors",
        description="Enumerate cross-boundary neighbors of a node across federated graphs",
        input_model=FederationNeighborsInput,
        read_write="read",
    ),
    # --- Knowledge domain ---
    CommandDefinition(
        name="knowledge_dump",
        domain="knowledge",
        subcommand="dump",
        description="Dump all knowledge artifacts (notes and tags) from the active graph",
        input_model=KnowledgeDumpInput,
        read_write="read",
    ),
    CommandDefinition(
        name="knowledge_project",
        domain="knowledge",
        subcommand="project",
        description="Project knowledge artifacts onto the active graph via semantic matching",
        input_model=KnowledgeProjectInput,
        read_write="write",
        requires_agent_id=True,
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_catalog() -> List[CommandDefinition]:
    """Return the full command catalog."""
    return CATALOG


def get_command(name: str) -> Optional[CommandDefinition]:
    """Look up a command by name. Returns None if not found."""
    for cmd in CATALOG:
        if cmd.name == name:
            return cmd
    return None
