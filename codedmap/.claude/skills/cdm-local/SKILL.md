---
name: cdm-local
description: >
  CodeDMap (CDM) Local CLI — operate a local CPG database directly.
  No remote server required; reads/writes a local SQLite or Neo4j database.
  Use this skill whenever the user wants to: search CPG nodes, inspect functions, trace call chains
  or taint paths, tag nodes with security annotations, add audit notes, manage logical modules,
  repair call graphs, manage security rules, build CPG databases, or export/import audit assets
  — all against a local database file. Also use when the user mentions "cdm", "cdm local",
  "CPG database", "code property graph", security auditing workflows, or asks about
  sources/sinks/guards/sanitizers and there is no remote server involved.
---

# CDM Local — CodeDMap CLI (Direct Database Access)

Run CodeDMap commands directly against a local CPG database. No remote server needed.

## Execution

```bash
$CDM_CMD <domain> <command> [options] --output json
```

The `$CDM_CMD` variable handles your specific environment setup. Unlike the remote client (which defaults to json), the local CLI **defaults to text output** — always pass `--output json` for structured output.

## Environment Variables

You **must** set the `CDM_CMD` variable before executing commands, along with your database configuration.

| Variable | Purpose | Required |
|----------|---------|----------|
| `CDM_CMD` | The command to invoke the CLI | **Yes** |
| `CDM_DB` | Database path (SQLite file or Neo4j URI) | Yes (unless `--db` flag is used) |
| `CDM_BACKEND` | Backend: `sqlite`, `neo4j`, `memory` | No (default: `sqlite`) |
| `CDM_AGENT_ID` | Agent ID for write provenance | No (default: `human-{username}`) |

### Example Setups

If installed in the active virtual environment (`[project.scripts]` is available):
```bash
export CDM_CMD="cdm"
```

If using a package manager like UV:
```bash
export CDM_CMD="uv run cdm"
```

Common database setup:
```bash
export CDM_DB=/path/to/graph.db
export CDM_BACKEND=sqlite
export CDM_AGENT_ID=hunter-01    # optional
```

## Command Domains (11 domains)

| Domain | Purpose | Operations |
|--------|---------|------------|
| `query` | Graph traversal (read-only) | search, inspect, trace, entrypoints, stats, tree, sources, sinks, guards, sanitizers, roles |
| `tag` | Security tagging | add, remove, list, find, bulk |
| `note` | Audit notes | add, list, show, remove |
| `module` | Module management | create, delete, rename, list, show, assign, remove |
| `repair` | Call-chain repair | link, suggest, list, undo |
| `rules` | Rule registry | list, categories, show, resolve, add-sink, add-source, add-safe, add-entrypoint, tombstone, validate |
| `build` | Build CPG / enhance | `build <project>`, `build enhance` |
| `serve` | Start REST API server | `serve --db <path> --port <port>` |
| `assets` | Asset migration | export, import, diff, anchor, merge |
| `federation` | Cross-graph federation | register, link, neighbors |
| `knowledge` | Knowledge projection | dump, project |

## Differences from Remote Client (cdm skill)

The local CLI and remote client share the same catalog schema, but differ in surface syntax:

| Aspect | Local CLI (`cdm`) | Remote Client (`cdm_client.py`) |
|--------|---|---|
| Output default | `text` (must pass `--output json`) | `json` (no flag needed) |
| Rules subcommands | **hyphen style**: `add-sink` | **underscore style**: `add_sink` |
| Target shorthand | `-f <name>` shorthand available | `--function <name>` only |
| search pattern | positional: `cdm query search <pattern>` | flag: `--pattern <pattern>` |
| Build | `cdm build <project_path>` runs locally | `build start` submits to server |

For command parameters, tag/note types, write policies, and response format — refer to the **cdm skill** which documents the canonical catalog schema.

## Target Resolution

Commands that operate on a node accept 3 resolution methods (in priority order):

```text
1. --node-id <int>             # Explicit CPG node ID (highest priority)
2. --file <path> --line <int>  # File + line location
3. -f <name> / --function <name>  # Function name (pattern match)
```

When `--function` matches multiple nodes, it returns an `AMBIGUOUS_TARGET` error with a candidates list — retry with `--node-id`.

## Response Format

All `--output json` responses return a unified envelope:

```json
{
  "schema_version": "1.0.0",
  "command": "trace",
  "target": {"id": 123, "name": "main", "file": "main.c", "line": 10, "label": "METHOD"},
  "result": { ... },
  "metadata": {"total": 1, "has_more": false, "limit": 50},
  "success": true,
  "error": null
}
```

Exit codes: `0` = success, `1` = error, `130` = interrupted.

## Source Code Access

The CPG database contains code metadata (AST, call graphs, types), not source code. During auditing, **read the actual source** to verify findings. Use `Read` and `Grep` tools.

- By default, assume the current working directory is the source root.
- If the user specifies a different source path, use that instead.

## Important Notes

1. Always use `--output json` for structured, parseable output (local CLI defaults to text)
2. Write operations are tagged with provenance via `CDM_AGENT_ID`
3. `AMBIGUOUS_TARGET` error: pick the correct `node_id` from `result.candidates` and retry
4. Module scope filtering: 5 commands support `--module <name>` for scoped analysis (search, entrypoints, trace, tag find, stats)
5. Store is always used as context manager — the CLI handles cleanup automatically
