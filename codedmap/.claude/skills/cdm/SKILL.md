---
name: cdm
description: >
  CodeDMap (CDM) Remote Client — operate a remote CPG (Code Property Graph) server for LLM/Agent-driven
  code auditing and vulnerability hunting. Use this skill whenever the user wants to: search CPG nodes,
  inspect functions, trace call chains or taint paths, tag nodes with security annotations, add audit notes,
  manage logical modules, repair call graphs, manage security rules, and run build/start/status jobs via
  a remote CPG REST API server. Also use when the user mentions "cdm", "cdm_client", "CPG server",
  "code property graph", security auditing workflows, or asks about sources/sinks/guards/sanitizers/roles.
---

# CDM — CodeDMap Remote Client

Standalone CLI for operating a remote CPG (Code Property Graph) REST API server.

## Execution

Use the skill-bundled script:

```bash
# Skill-local client + catalog
CDM=./scripts/cdm_client.py

python3 "$CDM" <domain> <subcommand> [options]
```

Dependencies: `httpx` (install with `pip install httpx` if missing).

Environment variables (avoid repeating `--remote` / `--api-key` on every call):

```bash
export CPG_SERVER=http://localhost:8000
export CPG_API_KEY=your-key        # optional
export CPG_AGENT_ID=my-agent       # optional, required for write operations
```

## Architecture

`scripts/cdm_client.py` auto-generates domain/subcommands from `scripts/tools.json`.
`scripts/tools.json` is exported from the catalog (`python3 tools/export_catalog.py`).
When catalog changes, re-export then sync the latest files into `scripts/`.

## Command Domains (current tools)

| Domain | Purpose | Operations |
|--------|---------|------------|
| `query` | Graph traversal | search, inspect, trace, entrypoints, sources, sinks, guards, sanitizers, roles, stats, tree |
| `tag` | Security tagging | add, remove, list, find, bulk |
| `note` | Audit notes | add, list, show, remove |
| `module` | Module management | create, delete, rename, list, show, assign, remove, of, deps |
| `repair` | Call-chain repair | link, suggest, list, undo |
| `rules` | Rule registry | list, categories, show, resolve, add_sink, add_source, add_safe, add_entrypoint, tombstone, validate |
| `build` | Build/enhance | start, status, enhance |
| `federation` | Cross-graph federation | register, link, neighbors |
| `knowledge` | Knowledge projection | dump, project |

Notes:
- `discover` is a top-level helper command: `python3 "$CDM" discover ...` (not a domain).
- `assets` is not in current `tools.json`; do not use `assets *` examples.
- `query search --pattern` uses **Python regex** (`re.match`), not glob or substring. E.g., `"memcpy"` matches names starting with "memcpy"; use `".*memcpy.*"` for substring match.
- `query search --type` accepts **lowercase only**: `method`, `call`, `identifier`. Uppercase silently defaults to `method`.

## Schema-First Discipline

When operating a remote server, prefer `cdm_client.py` or `discover`/`tools.json` schema as the source of truth for request shape. Do not handcraft raw REST JSON bodies unless you have first verified the exact field names and types.

Rules that prevent common agent mistakes:

- Prefer `python3 "$CDM" <domain> <subcommand> ...` over direct `curl` or handwritten POST bodies.
- If you must construct a JSON body yourself, copy the field names and types from `discover` or `scripts/tools.json` first.
- Array fields must be real arrays, not strings. Example: `node_ids: [42, 43]`, never `"node_ids": "[42,43]"` or `"node_ids": "42"`.
- `note add` uses `node_ids` as `int[]` when binding notes to nodes.
- `repair link` uses the function-level contract `from_function` / `to_function`.
- If `repair link` is ambiguous, disambiguate with `from_full_name` / `to_full_name` or `from_file` / `to_file`.

## Tag / Note Types

### Tag type (layer format)

`tag add/remove/find` uses free-form tag strings, but recommended/validated conventions are:

- `ONTOLOGY:{ENTRY_POINT|SOURCE|SINK|GUARD|SANITIZER|ROLE}:{NAME}` (L1)
- `SEMANTIC:{NAMESPACE}:{NAME}` (L2)
- `STATE:{REVIEWED|SUSPICIOUS|FALSE_POSITIVE|CONFIRMED_VULN|CUSTOM:{NAME}}` (L3)

Write policy:

- `ONTOLOGY:ENTRY_POINT:*`, `ONTOLOGY:SOURCE:*`, `ONTOLOGY:SINK:*` are system-only; agent writes should not add them directly.
- `ONTOLOGY:GUARD:*`, `ONTOLOGY:SANITIZER:*`, `ONTOLOGY:ROLE:*` are collaborative and require `--justification`.
- Subjective tags like `STATE:*` should include `--justification`.

### Note category/type

`note add --category` allowed values:

- Non-strict: `ARCHITECTURE`, `DATA_FLOW`, `CONTROL_FLOW` (content can be plain text)
- Strict: `VULNERABILITY`, `COORDINATION`, `SECURITY_BOUNDARY` (content must be valid JSON string)

Category is case-insensitive and normalized to uppercase.

## Common Examples

```bash
CDM=./scripts/cdm_client.py

# Search nodes (type is lowercase: method, call, identifier)
python3 "$CDM" query search --pattern "memcpy" --type method --limit 20

# Inspect node details
python3 "$CDM" query inspect --function "main"

# Trace call chains
python3 "$CDM" query trace --function "process_input" --depth 15

# Reverse taint trace (from sink back to sources)
python3 "$CDM" query trace --function "memcpy" --taint

# Add a collaborative L1 tag (requires justification)
python3 "$CDM" tag add --node-id 42 --tag "ONTOLOGY:ROLE:BOUNDARY" \
  --justification "HTTP route callback boundary"

# Add a state tag
python3 "$CDM" tag add --node-id 42 --tag "STATE:SUSPICIOUS" \
  --justification "tainted input reaches sink without guard"

# Add a non-strict note (plain text)
python3 "$CDM" note add --title "Dataflow hypothesis" --category DATA_FLOW \
  --content "user input reaches parser via shared buffer" --node-ids 42 43

# Add a strict note (JSON content required)
python3 "$CDM" note add --title "Boundary ingress" --category SECURITY_BOUNDARY \
  --content '{"schema_version":"1.0","boundary_type":"NETWORK","trust_transition":"internet->service","untrusted_inputs":["body"],"required_guards":["auth"],"observed_guards":[]}' \
  --node-ids 42

# Repair a missing call edge using function-level contract
python3 "$CDM" repair link \
  --from-function "read_file" \
  --to-function "png_image_begin_read_from_memory" \
  --reason "pngstest.c shows read_file directly calling png_image_begin_read_from_memory"

# Disambiguate same-name functions with file/full_name filters
python3 "$CDM" repair link \
  --from-function "read_file" \
  --from-file "tests/pngstest.c" \
  --to-function "parse_png" \
  --to-full-name "libpng::parse_png" \
  --reason "read_file in tests/pngstest.c dispatches into the library parser"

# Assign files to a module (--justification is required)
python3 "$CDM" module assign --name "network" --paths "src/net/*" \
  --justification "all networking source files"

# Add a rule (underscore style)
python3 "$CDM" rules add_sink --name "custom_exec" --category "COMMAND_INJECTION"

# Get callees of a function (outgoing call chain)
python3 "$CDM" query inspect --function "process_input" --only callees

# Get callers of a function (incoming call chain)
python3 "$CDM" query inspect --function "memcpy" --only callers

# Check build status
python3 "$CDM" build status --job-id <uuid>

# Discover available tools
python3 "$CDM" discover
```

## Call Chain Discovery

Use `query inspect --only` to extract call relationships for a function in a single command:

```bash
# Direct callees (functions called BY target)
python3 "$CDM" query inspect --function "target_func" --only callees

# Direct callers (functions that CALL target)
python3 "$CDM" query inspect --function "target_func" --only callers
```

`--only` accepts a comma-separated list: `callers`, `callees`, `tags`, `source`. Combine as needed:

```bash
# Both directions at once
python3 "$CDM" query inspect --function "target_func" --only callers,callees
```

For deeper transitive call chains (multi-hop), use `query trace`:

```bash
# Forward trace: all reachable callees up to depth
python3 "$CDM" query trace --function "target_func" --depth 10

# Reverse taint trace: trace back from sink to sources
python3 "$CDM" query trace --function "dangerous_sink" --taint
```

## Response Format

All API calls return a unified `CLIResponse` envelope:

```json
{
  "schema_version": "1.0.0",
  "command": "search",
  "result": { "nodes": [...] },
  "metadata": {"total": 1, "has_more": false, "limit": 50},
  "success": true,
  "error": null
}
```

## Source Code Access

The CPG database contains only code metadata (AST, call graphs, types, etc.), not the actual source code. During auditing, you **must** read the real source to verify vulnerabilities, understand context, and confirm findings. Use `Read` and `Grep` tools for this.

- By default, assume the current working directory is the source root of the project being audited.
- If the user specifies a different source path, use that path instead.

## Important Notes

1. Output defaults to `json` (structured output); use `--output text` for human-readable format
2. Write operations require `CPG_AGENT_ID` or `X-Agent-ID` header
3. When `AMBIGUOUS_TARGET` error is returned, pick the correct `node_id` from `result.candidates` and retry
4. Rules domain subcommands use underscore style: `add_sink`, `add_source`, `add_safe`, `add_entrypoint`
5. `build status` uses `--job-id` and maps to `/build/status?job_id=<uuid>`
6. Catalog changes require re-running `python3 tools/export_catalog.py`, then syncing updated `cdm_client.py`/`tools.json` into `scripts/`
