# CodeDMap — LLM System Context

Copy-paste this file into any AI model to instantly onboard it to CodeDMap.
Token-efficient. No fluff. All lines are actionable.

---

## IDENTITY

- **Name:** CodeDMap (formerly CPG SDK / `cpg_schema`)
- **CLI command:** `cdm` (9 domains)
- **PyPI:** `pip install codedmap`
- **Package:** `codedmap/` (Python 3.12+, Pydantic V2)
- **Purpose:** Deterministic Code Property Graph for AI-driven security auditing
- **Tagline:** "The Deterministic Code Atlas for Agent-Driven Auditing."

---

## ARCHITECTURE

- **Two-phase pipeline:**
  - Phase 1 (Stream): Parse files one-by-one → emit nodes/edges → per-file passes (CFG, DDG, CDG, LocalRef, LocalPTS)
  - Phase 2 (Batch): Global passes after all files parsed (Linker, CallGraph, PDG, GlobalRef, GlobalPTS)
- **AI passes (optional):** Summary, type inference, security tagging (require `--enable-llm`)
- **Storage backends:** `memory` (testing), `sqlite` (default), `neo4j` (production) — same streaming reader/writer interface
- **Analysis capabilities:** CFG, DDG, CDG, call graph, PDG, points-to
- **Languages:** C, C++, Python (tree-sitter + libclang IR mode)
- **Scale target:** 10M+ line codebases

---

## 9-DOMAIN CLI

All commands support `--output json`. JSON envelope: `{schema_version, command, target, result, metadata, success}`.

```
cdm query   search | inspect | trace | entrypoints | stats | tree | sources | sinks | guards | sanitizers | roles
cdm note    add | list | show | remove
cdm tag     add | remove | list | find | bulk
cdm module  create | delete | rename | list | show | assign | remove
cdm repair  link | suggest | list | undo
cdm rules   list | categories | show | resolve | add-sink | add-source | add-safe | add-entrypoint | tombstone | validate
cdm build   <project> | enhance
cdm serve   --db <path> --port <port>
cdm assets  export | import | diff | anchor | merge
```

**Key query commands:**

- `cdm query search <pattern>` — find nodes by name
- `cdm query inspect -f <name>` — node details: source, callers, callees, tags
- `cdm query trace -f <name> --taint` — backward taint trace to controllable inputs
- `cdm query trace -f <name> --dataflow` — DDG data flow slice
- `cdm query entrypoints` — attack surface entry points (L1 + L2)
- `cdm query sources / sinks / guards / sanitizers / roles` — categorized security nodes
- `cdm query stats` — graph overview: nodes, edges, languages, top tags, modules
- `cdm discover` — full tool catalog (49 commands) as structured JSON

---

## TAG SYSTEM

**Three layers:**

- `L1 ONTOLOGY` — read-only, system-detected via rule passes
  - Prefixes: `ONTOLOGY:SOURCE:*`, `ONTOLOGY:SINK:*`, `ONTOLOGY:ENTRY_POINT:*`, `ONTOLOGY:GUARD:*`, `ONTOLOGY:SANITIZER:*`, `ONTOLOGY:ROLE:*`
  - Example: `ONTOLOGY:SINK:SQL_INJECTION`, `ONTOLOGY:SOURCE:NETWORK_DATA`
- `L2 SEMANTIC` — agent/human writable (requires `justification` for complex tags)
  - Example: `SEMANTIC:AUTH:HIGH`, `SEMANTIC:PROTOCOL:HTTP`
- `L3 STATE` — audit workflow state, agent writable
  - Example: `STATE:AUDITED`, `STATE:REVIEWED`, `STATE:DRAFT`

**Provenance model:**

- Every L2/L3 tag carries a `Provenance` record: `{justification, confidence, source, author_id, timestamp}`
- `justification` field is the unified provenance for subjective tags — string, max 255 chars
- Write tags: `cdm tag add -f <func> SEMANTIC:AUTH:HIGH --justification "..." --confidence 0.9`

**Tag format:** Always colon-separated. Flat tags (no colon) are invalid.

---

## MODULE SYSTEM

- **Macro-level logical boundaries** — file/directory granularity (not function/AST level)
- **Workflow:** `cdm module create <name> --description "..."` → `cdm module assign <name> --paths "src/auth/**"`
- **Reverse lookup:** `cdm module of -f <function>` — which module contains this function?
- **Dependency graph:** `cdm module deps` — cross-module CALL edge counts
- **Assignments carry provenance:** `--justification`, `--confidence` on `cdm module assign`
- **Scoped queries:** `cdm query entrypoints --module auth_module` — all entry points in module

---

## CRITICAL INVARIANTS

**INVARIANT 1 — Tags and Modules are strictly orthogonal:**
- Tags = micro/AST granularity (methods, call nodes, identifiers)
- Modules = macro/file granularity (files, directories)
- NEVER apply tags to `ModuleNode`. NEVER create a Module for a single vulnerable function.
- Tags describe WHAT a node is (sink, source, auth-handler). Modules describe WHERE code lives (auth subsystem, network layer).

**INVARIANT 2 — `justification` is the unified provenance field for subjective tags:**
- L2 SEMANTIC and L3 STATE tags use `justification` (not "evidence") for their provenance string
- `cdm tag add` exposes `--justification` flag
- Tag `Provenance` model has `justification: str` — never rename this to "evidence"
- This invariant is enforced at the `TagEngine` layer

**INVARIANT 3 — `EvidenceBundle` is audit proof, distinct from tag `Provenance`:**
- `EvidenceBundle` lives in `codedmap.app.audit` — it is an objective chain of CPG nodes/edges proving a vulnerability
- Tag `Provenance` is a subjective annotation explaining WHY a tag was applied
- Both terms coexist in the codebase. They mean different things. Do NOT conflate them.
- `EvidenceBundle` = "here is the graph path showing taint flows from input to memcpy"
- Tag `Provenance.justification` = "this function handles SQL queries without parameterization"

---

## REST API

- Start server: `cdm serve --db graph.db --port 8000 [--api-key <key>]`
- Discovery (always public): `GET /api/v1/tools` — full CommandDefinition catalog
- Domain routers mirror CLI: `/api/v1/query/*`, `/api/v1/tag/*`, `/api/v1/note/*`, `/api/v1/module/*`, etc.
- Auth: `X-API-Key` header or `--api-key` flag on server start
- Agent ID header: `X-Agent-ID` required for write endpoints that support agent attribution

---

## STANDALONE CLIENT (`tools/cdm_client.py`)

- No `codedmap` package dependency — pure `httpx`
- Works in any Python environment (agent containers, CI, other AI model sandboxes)
- `client.discover()` — returns full tool catalog
- `client.query(path, **params)` — execute any command via REST

```python
from tools.cdm_client import CPGClient
client = CPGClient("http://localhost:8000", api_key="secret")
catalog = client.discover()
result = client.query("query/trace", function="process_input", taint=True)
```

Pre-generated catalog: `tools/tools.json` — offline snapshot, no server required.

---

## CODING CONVENTIONS

- Pydantic V2: `model_config = ConfigDict(...)` — not `class Config`
- All graph mutations via `GraphPatch` → `store.apply_patch(patch)` — never mutate storage directly
- No raw SQL outside storage drivers (`infra/storage/`) — use Repository methods
- No raw Cypher outside Neo4j driver (`infra/storage/driver_neo4j/`)
- No shim directories — when moving modules, rewrite ALL import sites in the same commit
- Layered architecture (higher imports lower, never reverse):
  - Layer 0: `core/` — pure data models, zero deps
  - Layer 1: `infra/` — storage, AI providers
  - Layer 2: `analysis/` — passes, traversal, detection
  - Layer 3: `app/` — query DSL, business orchestration
  - Layer 4: `cli/` — argument parsing, output formatting
  - Layer 5: `pipeline/` — build orchestration

---

## JSON ENVELOPE (v1.0.0)

All `--output json` responses:

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

Exit codes: `0` success, `1` error, `130` interrupted.

---

*Source of truth: `codedmap/core/schema/catalog.py` (CommandDefinition + 49 input models)*
*CLI reference: `codedmap/cli/CLAUDE.md`*
