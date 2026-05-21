# Module System Architecture

> Canonical references: `codedmap/core/schema/graph/nodes/structure.py` (model), `codedmap/analysis/traversal/module.py` (navigator), `codedmap/cli/commands/module.py` (CLI), `codedmap/api/routers/module.py` (REST API)

---

## CRITICAL INVARIANT: Tags and Modules are strictly orthogonal

> Modules (`cdm module`) define **MACRO** business boundaries (Directory/File granularity).
> Tags (`cdm tag`) define **MICRO** architectural roles and semantics (Method/AST granularity).
>
> **NEVER** apply tags to a `ModuleNode`.
> **NEVER** create a Module for a single vulnerability function.
>
> If you want to express that `src/auth/` belongs to the authentication subsystem, use `cdm module assign`.
> If you want to express that `handle_login()` is the boundary function of that subsystem, tag it with `ONTOLOGY:ROLE:BOUNDARY`.

---

## Overview

The module system provides logical code organization at the **file/directory granularity** for large codebases. A `ModuleNode` is a named, described subsystem that contains `FileNode` instances via directed `CONTAINS` edges. Modules enable agents to filter analysis results to a specific subsystem scope (`--module <name>`), understand inter-module dependencies (`cdm module deps`), and navigate from a function back to its containing module (`cdm module of`).

Modules are **macro-level** organizational units — they answer "which subsystem does this file belong to?" Tags are **micro-level** semantic annotations — they answer "what role does this function play?". The two systems are complementary, not redundant.

---

## Architecture Overview

| Property | Value |
|----------|-------|
| Model | `ModuleNode` (Pydantic V2, `codedmap/core/schema/graph/nodes/structure.py`) |
| Metrics | `ModuleMetrics` (Pydantic V2 BaseModel, in same file) |
| Navigator | `ModuleNavigator` (`codedmap/analysis/traversal/module.py`) |
| CLI Domain | `cdm module {create,delete,rename,list,show,assign,remove,of,deps}` |
| API Routes | `/module/create`, `/module/delete`, `/module/rename`, `/module/list`, `/module/show`, `/module/assign`, `/module/remove` |
| Edges | `CONTAINS`: `ModuleNode` → `FileNode` (with optional justification + confidence metadata) |
| Scope Filtering | `--module <name>` / `--module-id <int>` on query commands |
| Graph Node Label | `NodeLabel.MODULE` |

---

## ModuleNode Model

Defined in `codedmap/core/schema/graph/nodes/structure.py`.

```python
class ModuleNode(CPGNode):
    label:     NodeLabel = NodeLabel.MODULE
    name:      str                   # Short name (e.g. "network_core")
    full_name: str                   # Qualified name (e.g. "fs.ext4"); alias: fullName
    description: Optional[str]       # Module purpose and responsibility (required at CLI create)

    # Optional organizational fields
    subsystem:      Optional[str]    # Parent subsystem label
    maintainers:    List[str] = []
    config_options: List[str] = []
    entry_points:   List[str] = []   # Key entry point full names

    # Cached metrics (populated by ModuleNavigator.compute_metrics)
    entry_point_count: Optional[int]
    method_count:      Optional[int]
    sink_count:        Optional[int]
    density:           Optional[float]
    file_count:        Optional[int]

    @model_validator(mode="after")
    def auto_generate_id(self):
        self.id = generate_deterministic_id("MODULE", self.full_name)
```

### ModuleMetrics

```python
class ModuleMetrics(BaseModel):
    entry_point_count: int    # Methods tagged ONTOLOGY:ENTRY_POINT:*
    method_count:      int    # Total methods across all files in module
    sink_count:        int    # Methods tagged ONTOLOGY:SINK:*
    density:           float  # entry_point_count / method_count (0.0 if no methods)
    file_count:        int    # Files directly contained in module
```

### ID Generation

`ModuleNode` IDs are **deterministic**: `generate_deterministic_id("MODULE", full_name)`. The same module name always produces the same integer ID across rebuilds, enabling stable cross-run references.

---

## CONTAINS Edge with Provenance

Files are assigned to modules via `CONTAINS` edges. Each edge carries optional provenance metadata stored as edge properties:

```
ModuleNode --[CONTAINS]--> FileNode
               properties:
                 justification: "All authentication layer files" (max 255 chars)
                 confidence:    0.95
```

**Justification and confidence** are stored on the `CONTAINS` edge, not on the `ModuleNode` or `FileNode`. This means different modules can have different justifications for the same file (if a file belongs to multiple modules), and agents can trace the reasoning behind every assignment.

The `_assign_files()` helper in `cli/commands/module.py` writes these edge properties through `GraphPatch.add_edge(..., justification=..., confidence=...)`.

---

## Module CRUD Operations

### Create

```
cdm module create <name> --description <desc> [--paths <patterns>]

Required:
  name                    Module name (also used as full_name if --full-name omitted)
  --description <desc>    Purpose and responsibility of the module

Optional:
  --full-name <fn>        Qualified name (e.g. "fs.ext4")
  --paths <patterns>      Glob patterns for immediate file assignment
```

`description` is required at the CLI level. The `ModuleNode.description` field is technically optional in the model to support programmatic construction, but `cdm module create` enforces it via `required=True`.

### Delete

```
cdm module delete <name>
```

Deletes the `ModuleNode` and cascades to remove all outgoing `CONTAINS` edges. The `FileNode` instances are not deleted — only the logical module membership is removed.

### Rename

```
cdm module rename <name> --new-name <new> [--new-full-name <fn>]
```

If `full_name == name` (simple case), renames in-place via `GraphPatch.update_node()` — all `CONTAINS` edges are preserved. If `full_name != name`, a new `ModuleNode` is created with the new name, `CONTAINS` edges are copied, and the old node is deleted.

### List

```
cdm module list [--limit N] [--all]
```

Returns: `id`, `name`, `full_name`, `file_count`, `method_count` for each module. Default limit: 50. Use `--all` to skip pagination.

### Show

```
cdm module show <name> [--verbose, -v]
```

Returns: full module details including `files` list with per-file assignment metadata.

In `--verbose` mode, each file entry shows the `Justification` and `Confidence` block from the `CONTAINS` edge. In compact mode (default), `(confidence)` is shown inline per file. JSON output always includes `files[].assignment.{justification, confidence}` regardless of verbose flag.

### Assign

```
cdm module assign <name> --paths <patterns> --justification <text> [--confidence <float>]

Required:
  name                    Module name
  --paths <patterns>      One or more glob patterns matching file names
  --justification <text>  Why these files belong in this module (max 255 chars)

Optional:
  --confidence <float>    Confidence score 0.0–1.0
```

Pattern matching uses `fnmatch` against file names (not full paths). Example: `--paths "*.c" "net_*.c"` matches all C files and files starting with `net_`. Already-assigned files are skipped (idempotent).

### Remove

```
cdm module remove <name> --paths <patterns>
```

Removes `CONTAINS` edges for files matching the patterns. Files not currently assigned are silently skipped.

---

## Reverse Lookup: `cdm module of`

Find which module(s) contain a given node. This is the inverse of `assign`.

```
cdm module of [--function, -f <name>] [--file <path>] [--node-id <id>]
```

**Resolution logic:**
1. If `--function` or `--node-id` matches a `MethodNode`: walk AST upward to find the enclosing `FileNode`, then find all modules containing that file.
2. If `--file` is provided: find all modules with a `CONTAINS` edge to that file.
3. If the target is an AST node (not a file): perform the same file-ancestry walk.

**Orphan nodes** (no enclosing file found, no containing module) return an empty list — graceful degradation.

The response includes each containing module's `justification` and `confidence` from the `CONTAINS` edge, enabling agents to understand why a file was assigned.

```bash
# Find the module containing the process_packet function
cdm module of -f process_packet

# JSON output example
{
  "result": {
    "modules": [
      {
        "id": 48291,
        "name": "network_core",
        "description": "TCP/IP network processing layer",
        "assignment": {
          "justification": "Core packet processing files",
          "confidence": 0.9
        }
      }
    ],
    "total": 1
  }
}
```

---

## Dependency Graph: `cdm module deps`

Aggregate inter-module `CALL` edges to understand cross-boundary dependencies.

```
cdm module deps [<name>]
```

**Global mode** (no `<name>`): Returns all inter-module dependency edges across the entire graph. Each entry shows `from`, `to`, and `call_count`.

**Focused mode** (`<name>` provided): Returns dependencies specific to one module — which modules it calls and which modules call it.

The implementation builds a `method_id → module_name` index from all `CONTAINS` edges, then counts `CALL` edges that cross module boundaries in a single pass.

```bash
# Global dependency graph
cdm module deps

# Output:
#   auth_core --[12 calls]--> crypto_utils
#   network_core --[45 calls]--> auth_core
#   network_core --[8 calls]--> io_helpers

# Focused on one module
cdm module deps network_core
```

---

## Module-Scoped Analysis

Five query commands accept `--module <name>` to filter results to a specific module's scope:

| Command | Scope behavior |
|---------|---------------|
| `cdm query entrypoints --module <name>` | Returns only entry points in module's files |
| `cdm query search <pattern> --module <name>` | Returns only matching nodes in module's files |
| `cdm query trace -f <fn> --module <name>` | Annotates trace hops with `in_module`/`module_name`; adds scope header |
| `cdm tag find <tag> --module <name>` | Returns only tagged nodes in module's files |
| `cdm query stats --module <name>` | Computes module-specific counts (files, methods, entry points) |

### Resolution

`--module-id <int>` takes precedence over `--module <name>`. For name-based lookup: exact match first, then fuzzy substring match. Errors produce structured JSON envelopes: `MODULE_NOT_FOUND`, `AMBIGUOUS_MODULE`.

### ModuleScope (Eager Resolution)

```python
scope = resolve_module_scope(store, args)   # Returns ModuleScope or None
nodes = filter_by_scope(nodes, scope, store)  # O(1) membership check per node
```

`ModuleScope` resolves `file_ids` and `method_ids` eagerly at creation time. `filter_by_scope()` checks file ancestry membership for each node — orphan nodes (no enclosing file) are excluded.

### JSON Scope Metadata

When `--module` is active, a `module_scope` block is injected into `metadata`:

```json
{
  "metadata": {
    "module_scope": {
      "name": "network_core",
      "file_count": 7,
      "method_count": 52
    }
  }
}
```

### Text Scope Header

```
Scope: module network_core (7 files, 52 methods)
```

---

## CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `cdm module create <name>` | Create a module (description required) |
| `cdm module delete <name>` | Delete module + cascade CONTAINS edges |
| `cdm module rename <name> --new-name <new>` | Rename module, preserve files |
| `cdm module list [--limit N] [--all]` | List all modules with counts |
| `cdm module show <name> [-v]` | Module details + file assignments |
| `cdm module assign <name> --paths <p> --justification <j>` | Assign files by glob pattern |
| `cdm module remove <name> --paths <p>` | Remove files by glob pattern |
| `cdm module of [-f <fn>] [--file <path>] [--node-id <id>]` | Reverse lookup: find containing module |
| `cdm module deps [<name>]` | Inter-module CALL edge aggregation |

All subcommands accept `--db <path>`, `--backend`, `--output json`, `--remote`, `--api-key`.

---

## REST API Routes

Base prefix: `/module` (registered under router_kwargs with API key if configured)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/module/create` | `X-Agent-ID` required | Create a module |
| `POST` | `/module/delete` | `X-Agent-ID` required | Delete a module |
| `POST` | `/module/rename` | `X-Agent-ID` required | Rename a module |
| `GET` | `/module/list` | None | List all modules |
| `GET` | `/module/show` | None | Show module details |
| `POST` | `/module/assign` | `X-Agent-ID` required | Assign files by pattern |
| `POST` | `/module/remove` | `X-Agent-ID` required | Remove files by pattern |

Note: `of` and `deps` subcommands are CLI-only in the current implementation. Use `GET /module/show` for detailed file assignments.

### POST /module/create

```json
{
  "name": "network_core",
  "paths": ["net_*.c", "sock_*.c"]
}
```

### POST /module/assign

```json
{
  "name": "network_core",
  "paths": ["net_*.c", "sock_*.c"]
}
```

Note: The REST API `assign` endpoint does not currently expose `justification`/`confidence` — those are CLI-only parameters. The `created_by` string is derived from `X-Agent-ID`.

### GET /module/show

Query parameters: `name` (string) or `module_id` (int). One is required.

Returns: `id`, `name`, `full_name`, `file_count`, `method_count`, `fan_in`, `files` list, and `metrics` object.

---

## Agent Usage Patterns

### Organize a codebase into modules

```bash
# Create the module
cdm module create network_core \
    --description "TCP/IP packet processing and socket management" \
    --db graph.db

# Assign files by glob pattern with justification
cdm module assign network_core \
    --paths "net_*.c" "sock_*.c" "tcp_*.c" \
    --justification "All files in the TCP/IP stack processing path" \
    --confidence 0.95 \
    --db graph.db

# Verify
cdm module show network_core --db graph.db
```

### Focus analysis on a module

```bash
# Find entry points only in network_core
cdm query entrypoints --module network_core --db graph.db

# Find functions with SINK tags in network_core
cdm tag find "ONTOLOGY:SINK:*" --module network_core --db graph.db

# Get per-module stats
cdm query stats --module network_core --db graph.db
```

### Navigate module membership

```bash
# Find which module contains process_packet
cdm module of -f process_packet --db graph.db

# View the inter-module dependency graph
cdm module deps --db graph.db
```

---

## Canonical File References

| File | Role |
|------|------|
| `codedmap/core/schema/graph/nodes/structure.py` | `ModuleNode` model + `ModuleMetrics` |
| `codedmap/analysis/traversal/module.py` | `ModuleNavigator` (files, methods, metrics, deps, reverse lookup) |
| `codedmap/cli/commands/module.py` | `cdm module` CLI (all 9 subcommands) |
| `codedmap/api/routers/module.py` | REST API routes `/module/*` |
| `codedmap/cli/_bootstrap.py` | `resolve_module_scope()`, `filter_by_scope()`, `ModuleScope` |

---

*Last updated: 2026-03-20*
