# codedmap/cli — CodeDMap Command-Line Interface

CLI for building, querying, and annotating CPG databases. Exposes traversal module capabilities as 11 domain-grouped top-level commands, consumed by agents or direct terminal usage. Query commands are read-only except `tag` (writes via `TagNavigator`), `note` (writes insights), `module` (writes via `GraphPatch`), `build` (runs full pipeline), `build enhance` (runs analysis passes on existing DB), `federation` (register/link mutate the federation index), and `knowledge` (project mutates the graph via semantic matching).

## Design Principle

**Thin CLI, zero core modifications.** Every command is a ~40-80 line composition of existing Navigator/ContextLoader APIs. The CLI owns argument parsing and output formatting only — all graph logic lives in `analysis/traversal/`.

Command descriptions and parameter schemas are the single source of truth in `core/schema/catalog.py` — the same catalog that powers the `/api/v1/tools` discovery endpoint.

## 11-Domain Architecture

```
cdm query {search,inspect,trace,entrypoints,stats,tree,sources,sinks,guards,sanitizers,roles}  # read-only graph traversal
cdm note {add,list,show,remove}                                    # note/insight CRUD [write]
cdm tag {add,remove,list,find,bulk}                                # tag CRUD [write]
cdm module {create,delete,rename,list,show,assign,remove}          # module CRUD [write]
cdm repair {link,suggest,list,undo}                                # call-chain repair [write]
cdm rules {list,categories,show,resolve,add-sink,...}              # rule registry [write]
cdm federation {register,link,neighbors}                           # cross-graph federation [write]
cdm knowledge {dump,project}                                       # knowledge projection [read/write]
cdm build [enhance]                                                # build + enhance [write]
cdm serve --db <path> --port <port>                                # REST API server
```

## Module Map (11 Domains)

```
cli/
  __main__.py              # Entry point: 11-domain registry
  _bootstrap.py            # Shared: Store init, arg injection, node resolution, output helpers
  _output.py               # JSON envelope, OutputFormatter, WitnessHop model
  _remote.py               # Remote HTTP transport layer for CLI (--remote / CDM_SERVER)
  commands/
    __init__.py
    query.py               # cdm query — domain dispatcher (search/inspect/trace/entrypoints/stats/tree/sources/sinks/guards/sanitizers/roles)
    note.py                # cdm note — note/insight CRUD [write]
    tag.py                 # cdm tag — tag CRUD [write]
    serve.py               # cdm serve — REST API server stub
    build.py               # cdm build [enhance] — build CPG graph + enhance subcommand [write]
    enhance.py             # enhance logic (delegated from build enhance) [write]
    stats.py               # cdm query stats — graph overview + modules list
    tree.py                # cdm query tree — file/class/function structure tree
    search.py              # cdm query search — find nodes by name pattern
    inspect.py             # cdm query inspect — everything about one node
    trace.py               # cdm query trace — caller chains, dataflow, taint paths
    entrypoints.py         # cdm query entrypoints — attack surface entry points
    sources.py             # cdm query sources — list detected taint sources
    sinks.py               # cdm query sinks — list detected sinks
    guards.py              # cdm query guards — list detected guards
    sanitizers.py          # cdm query sanitizers — list detected sanitizers
    roles.py               # cdm query roles — list detected roles
    rules.py               # cdm rules — rule registry management [write]
    module.py              # cdm module — module CRUD operations [write]
    repair.py              # cdm repair — call-chain repair [write]
    # federation and knowledge domains: catalog-dispatched via _catalog_dispatch.py (no per-domain command file)
```

## Command Reference

### Query Domain (`cdm query`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm query stats` | Graph overview: nodes, edges, languages, top tags, modules list | No |
| `cdm query tree` | Project structure tree (files, classes, functions) | No |
| `cdm query search <pattern>` | Find nodes by name pattern | No |
| `cdm query entrypoints` | Attack surface entry points (L1 ONTOLOGY + L2 SEMANTIC) | No |
| `cdm query entrypoints --level L1` | System-detected entry points only | No |
| `cdm query entrypoints --level L2` | Agent-discovered entry points only | No |
| `cdm query inspect -f <name>` | Node details: source, callers, callees, tags | Yes |
| `cdm query inspect --detail` | Full slice: DDG in/out, scope chain | Yes |
| `cdm query inspect --hierarchy` | Class hierarchy view | Yes |
| `cdm query inspect --module <name>` | Module details + metrics | No (module name) |
| `cdm query trace -f <name>` | Recursive caller chain (default mode) | Yes |
| `cdm query trace --taint` | Backward trace to controllable input | Yes |
| `cdm query trace --dataflow` | Data flow slice (DDG) | Yes |
| `cdm query trace --reachable` | CFG reachability between two points | Dual endpoints |
| `cdm query sources` | List detected taint sources | No |
| `cdm query sinks` | List detected sinks | No |
| `cdm query guards` | List detected guards | No |
| `cdm query sanitizers` | List detected sanitizers | No |
| `cdm query roles` | List detected roles | No |

### Note Domain (`cdm note`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm note add` | Create a note/insight (global or attached to nodes) | Optional |
| `cdm note list` | List notes (global mode) or notes on a target node | Optional |
| `cdm note show --note-id <uuid>` | Show full note content + node contexts | No |
| `cdm note remove` | Cascade-delete by --note-id or unbind by --node-ids + category | Varies |

### Tag Domain (`cdm tag`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm tag add` | Add a security tag to a node | Yes |
| `cdm tag remove` | Remove a tag from a node | Yes |
| `cdm tag list` | List tags on a node or in the graph | Varies |
| `cdm tag find <tag>` | Find all nodes with a given tag | No |
| `cdm tag bulk` | Bulk-apply tags from a file | No |

### Build Domain (`cdm build`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm build <project>` | Build CPG from source code | No |
| `cdm build enhance` | Run analysis passes on existing DB | No |

### Rule Management (`cdm rules`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm rules list` | List all active rules by type | No |
| `cdm rules categories` | Valid L1 ontology categories | No |
| `cdm rules show --merged` | Full merged ruleset with origin/status | No |
| `cdm rules resolve <name>` | Per-function rule lookup | No |
| `cdm rules add-sink <name> <cat>` | Add sink rule to project YAML | No |
| `cdm rules add-source <name> <cat>` | Add source rule to project YAML | No |
| `cdm rules add-safe <name>` | Add safe function to project YAML | No |
| `cdm rules add-entrypoint <name>` | Add entrypoint rule to project YAML | No |
| `cdm rules tombstone <id> --reason` | Suppress a global rule | No |
| `cdm rules validate` | Validate project rule YAML files | No |

### Module Management (`cdm module`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm module create <name>` | Create a new module | No |
| `cdm module delete <name>` | Delete module + cascade edges | No |
| `cdm module rename <name> --new-name <new>` | Rename module (preserves files) | No |
| `cdm module list` | List all modules with counts | No |
| `cdm module show <name>` | Module details + metrics | No |
| `cdm module assign <name> --paths <patterns>` | Assign files by glob pattern | No |
| `cdm module remove <name> --paths <patterns>` | Remove files by glob pattern | No |

### Repair Domain (`cdm repair`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm repair link` | Create a missing CALL edge | No |
| `cdm repair suggest` | Find unresolved CALL nodes with candidates | No |
| `cdm repair list` | Show active repairs | No |
| `cdm repair undo` | Remove a repair | No |

### Serve Domain (`cdm serve`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm serve --db <path> --port <port>` | Start REST API server | No |

### Federation Domain (`cdm federation`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm federation register <graph_uri>` | Register a graph in the federation index | No |
| `cdm federation link <source_uri> <target_uri> <edge_type> <source_node_id> <target_node_id>` | Create cross-boundary edge | No |
| `cdm federation neighbors <graph_uri> <node_id>` | List virtual neighbors across graphs | No |

### Knowledge Domain (`cdm knowledge`)

| Command | Purpose | Target? |
|---------|---------|---------|
| `cdm knowledge dump` | Dump all knowledge artifacts from the graph | No |
| `cdm knowledge project <artifacts_file>` | Project artifacts onto graph via semantic matching | No |

## Architecture

```
User / Agent
  │
  │  python -m codedmap.cli trace --db graph.db -f mepluginy --depth 5
  │
  ▼
__main__.py  (argparse subcommand dispatch)
  │
  ▼
commands/trace.py  (register + run)
  │
  ├── _bootstrap.create_store(args)     → StorageConfig → CPGStore
  ├── _bootstrap.resolve_target(store)  → NodeResolver → CPGNode
  │
  ▼
analysis/traversal/ContextLoader
  ├── .call.get_recursive_callers()     → Iterator[MethodNode]
  └── .formatter.format_call_chain()    → str
  │
  ▼
stdout (JSON envelope or text)
```

## _bootstrap.py — Shared Infrastructure

### Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `add_common_args(parser)` | `(ArgumentParser) -> None` | Inject `--db`, `--backend`, `--function`, `--file`, `--line`, `--node-id`, `--output`, `--offset` |
| `add_connection_args(parser)` | `(ArgumentParser) -> None` | Inject `--db`, `--backend`, `--output`, `--offset` only (for commands with `-f` conflicts) |
| `create_store(args)` | `(Namespace) -> CPGStore` | Minimal read-only Store: `StorageConfig` directly (no `CPGConfig` needed) |
| `resolve_target(store, args)` | `(CPGStore, Namespace) -> Optional[CPGNode]` | Unified input resolution: `node_id > file+line > function name` |
| `format_node_brief(node)` | `(CPGNode) -> str` | Single-line: `[METHOD] name (file:line, id=N)` |
| `safe_main(func)` | Decorator | Exception → stderr + exit(1), KeyboardInterrupt → exit(130) |

### Target Resolution Priority

```
1. --node-id N          → store.get_node(N)
2. --file F --line L    → NodeResolver.resolve_location(F, L)
3. --function name      → NodeResolver.resolve_function(name)
```

## _remote.py — Remote HTTP Transport

Enables CLI-to-REST API communication when `--remote <url>` or `CDM_SERVER` env var is set. All 11 domain dispatchers check `is_remote(args)` before local execution.

### Public API

| Function | Signature | Purpose |
|----------|-----------|---------|
| `is_remote(args)` | `(Namespace) -> bool` | Returns True if `--remote` flag or `CDM_SERVER` env var is set |
| `get_remote_url(args)` | `(Namespace) -> str` | Returns remote server URL (trailing slash stripped) |
| `remote_execute(args)` | `(Namespace) -> None` | Translates CLI args to HTTP request, prints result, exits on error |

### Request Translation

Each domain has a dedicated builder function that maps argparse `Namespace` to `(method, path, query_params, json_body)`:

| Domain | Builder Function | HTTP Methods |
|--------|------------------|--------------|
| `query` | `_build_query_request()` | GET |
| `note` | `_build_note_request()` | GET/POST |
| `tag` | `_build_tag_request()` | GET/POST |
| `module` | `_build_module_request()` | GET/POST |
| `repair` | `_build_repair_request()` | GET/POST |
| `rules` | `_build_rules_request()` | GET/POST |
| `build` | `_build_build_request()` | GET/POST |
| `federation` | `_build_federation_request()` | POST |
| `knowledge` | `_build_knowledge_request()` | POST |

### Authentication

- `--api-key` or `CDM_API_KEY` env var → `X-API-Key` header
- `CDM_AGENT_ID` env var → `X-Agent-ID` header (must match `[a-zA-Z0-9_-]+`)

### Error Handling

- Connection error → stderr message + exit(1)
- HTTP error → parse `CLIResponse` error envelope if possible, else raw status
- JSON output mode → passes server response body through as-is

## Agent Contract (Phase 22)

### JSON Envelope Schema (v1.0.0)

Every `--output json` response follows this schema:

```json
{
  "schema_version": "1.0.0",
  "command": "trace",
  "target": {"id": 123, "name": "main", "file": "main.c", "line": 10, "label": "METHOD"},
  "result": {"nodes": [...], "total": N},
  "metadata": {"total": N, "has_more": false, "limit": 50},
  "success": true,
  "error": null
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (any kind) |
| 130 | Interrupted (Ctrl+C) |

### Ambiguous Target Resolution

When `--function <name>` matches multiple nodes:

```json
{
  "success": false,
  "error": {"code": "AMBIGUOUS_TARGET", "message": "...use --node-id to disambiguate."},
  "result": {"candidates": [{"id": 1, ...}, {"id": 2, ...}], "total": 2}
}
```

### Structured Witness Paths

| Mode | JSON `result` shape |
|------|-------------------|
| `trace` (callers) | `{"chain": [{node_id, name, file, line, label, depth, edge_type}, ...], "mode": "callers"}` |
| `trace --dataflow` | `{"entries": [{node_id, file, line, code, is_origin, label}, ...], "mode": "dataflow"}` |
| `trace --reachable` | `{"reachable": bool, "path": [...], "path_length": N, "mode": "reachable"}` |
| `trace --taint` | `{"sink_node_id": N, "paths": [...], "found_controllable": bool, "mode": "taint"}` |
| `inspect` (default) | `{"target": {...}, "source": "...", "callers": [...], "callees": [...], "tags": [...]}` |
| `inspect --detail` | `{"slice": {ddg_in, ddg_out, scope, source, ...}}` |
| `inspect --module` | `{"name": "...", "file_count": N, "method_count": N, "metrics": {...}}` |

## Key Dependencies

| Dependency | From | Used By |
|------------|------|---------|
| `ContextLoader` | `analysis/traversal/context` | inspect, trace |
| `NodeResolver` | `infra/services/node_resolver` | `_bootstrap.resolve_target()` |
| `CPGStore` | `infra/storage/store` | `_bootstrap.create_store()` |
| `CPGBuildEngine` | `app/build` | build, enhance |
| `CPG` (query DSL) | `app/query/root` | search, inspect, trace |
| `ModuleNavigator` | `analysis/traversal/module` | inspect --module |
| `TagNavigator` | `analysis/tagging/navigator` | tag |

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `CDM_DB` | Default database path (fallback for `--db`) | Yes (unless `--db` is provided) |
| `CDM_BACKEND` | Default backend type (fallback for `--backend`) | No (defaults to `sqlite`) |
| `CDM_SERVER` | Remote CodeDMap server URL (enables remote mode) | No |
| `CDM_API_KEY` | API key for remote server authentication | No |
| `CDM_AGENT_ID` | Agent identifier header for remote requests | No |

## Module Scope Filtering (Phase 26)

Five commands support `--module <name>` / `--module-id <int>` flags for module-scoped analysis:

| Command | Flag Location | Behavior |
|---------|--------------|----------|
| `cdm entrypoints --module <name>` | `register()` | Returns only entry points in module's files |
| `cdm search <pattern> --module <name>` | `register()` | Returns only matching nodes in module's files |
| `cdm trace --module <name>` | `register()` | Annotates hops with `in_module`/`module_name`; scope header |
| `cdm tag find <tag> --module <name>` | `find` subparser only | Returns only tagged nodes in module's files |
| `cdm stats --module <name>` | `register()` | Computes module-specific file/method/entry_point counts |

**Resolution:** `--module-id` takes precedence over `--module`. Name match: exact first, then fuzzy substring. Errors: `MODULE_NOT_FOUND`, `AMBIGUOUS_MODULE` (structured JSON envelopes via `safe_main`).

**Filtering:** Module scope is resolved eagerly via `resolve_module_scope()` → `ModuleScope` (file_ids, method_ids). Results are filtered via `filter_by_scope()` which checks file ancestry membership. This is **pre-scoping** (results are filtered to module), not post-filtering.

**JSON `module_scope` metadata:** When `--module` is active, `metadata.module_scope` is injected:
```json
{"metadata": {"module_scope": {"name": "network", "file_count": 2, "method_count": 5}}}
```

**Text scope header:** `Scope: module <name> (<N> files, <M> methods)` printed before results.

## Agent Rules

- **Commands are thin wrappers.** Each command file should stay under ~80 lines for simple modes. Graph logic belongs in `analysis/traversal/`, not here.
- **Adding a new command:** Determine which domain it belongs to (query/note/tag/module/repair/rules/federation/knowledge/build/serve). Create `commands/<name>.py` with `register(subparsers)` and `run(args)`. Add it to the appropriate domain dispatcher (e.g., `query.py`, `note.py`, or `tag.py`). Do NOT add it to `__main__.py` directly — only the 11 domain dispatchers are registered there.
- **Adding a new domain:** Create `commands/<domain>.py` dispatcher, import in `__main__.py`, add to the `commands` dict.
- **Common args via `add_common_args()`.** All commands that need a target node should call this. Commands with `-f` conflicts (sources, sinks, guards, sanitizers, roles) use `add_connection_args()` instead.
- **Output to stdout, errors to stderr.** Commands print human-readable text to stdout. Errors go to stderr.
- **Store is always used as context manager.** Use `with create_store(args) as store:` to ensure cleanup.
- **Read-only by default.** Only `build`, `build enhance`, `tag`, `note`, `module`, `federation` (register/link), and `knowledge` (project) mutate storage.
- **`cdm module` is a write command.** create/delete/rename/assign/remove mutate the graph via GraphPatch.
- **`cdm federation` is a write command.** register and link mutate the federation index. neighbors is read-only.
- **`cdm knowledge` has mixed access.** dump is read-only; project mutates the graph via semantic matching.
- **Keep imports lazy in commands.** Heavy imports happen inside `run()`, not at module top level.
- **Remote mode support.** All domain dispatchers should check `is_remote(args)` before local execution.
- **catalog.py is the single source of truth.** Command descriptions and input schemas are defined in `core/schema/catalog.py`. When adding or modifying commands, update the catalog entry first.
