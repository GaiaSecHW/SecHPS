# codedmap/api — CodeDMap REST API

FastAPI REST server exposing the same capabilities as the CLI, designed for agent consumption over HTTP. The API reuses CLI internals (`CLIResponse`, `_node_to_dict`, `CPG` query DSL) but returns proper HTTP status codes instead of exit codes.

## Design Principle

**Thin HTTP layer over CLI/traversal logic.** Routers compose existing `CPG` query DSL, `ContextLoader`, `TagNavigator`, and `GraphPatch` APIs. No graph logic lives here — only HTTP parameter parsing, response conversion, and write serialization.

## Module Map

```
api/
  app.py              # App factory: create_app(db_path, backend, api_key)
  deps.py             # Shared deps: store singleton, API key auth, agent ID validation, write lock
  routers/
    tools.py          # /api/v1/tools — agent discovery endpoint (tool catalog manifest)
    query.py          # /query/* — read-only graph queries (search, inspect, trace, entrypoints, stats, tree)
    tag.py            # /tag/* — security tag mutations
    note.py           # /note/* — note/insight CRUD (multi-node association)
    module.py         # /module/* — module CRUD
    repair.py         # /repair/* — call graph repair
    rules.py          # /rules/* — rule registry management
    build.py          # /build/* — async build/enhance jobs
    assets.py         # /assets/* — asset export/import/diff/anchor/merge
```

## 9-Router Architecture

Mirrors the CLI's 9-domain structure (note and tag are separate top-level domains, plus a discovery router). Each router is a separate file with its own `APIRouter` instance, registered in `app.py` via `app.include_router()`.

| Router | Prefix | Read/Write | Agent ID Required |
|--------|--------|------------|-------------------|
| tools | `/api/v1` | Read-only | No |
| query | `/query` | Read-only | No |
| tag | `/tag` | Mixed (add/remove/bulk = write) | Write endpoints only |
| note | `/note` | Mixed (add/remove = write) | Write endpoints only |
| module | `/module` | Mixed (create/delete/rename/assign/remove = write) | Write endpoints only |
| repair | `/repair` | Mixed (link/undo = write) | Write endpoints only |
| rules | `/rules` | Mixed (add-*/tombstone = write) | Write endpoints only |
| build | `/build` + `/api/v1/build` | Write (async jobs + frontend upload/status) | `/build`: No, `/api/v1/build/upload`: Yes |
| assets | `/assets` | Mixed (import/anchor/merge = write) | Write endpoints only |

## Tools Discovery Endpoint

`GET /api/v1/tools` — Public (no API key required). Returns the full tool manifest for agent discovery:

```json
[
  {
    "name": "query_search",
    "description": "Find nodes by name pattern across the code property graph.",
    "input_schema": { ... }
  }
]
```

- `name`: Underscore-format command identifier (e.g. `module_assign`, not `module-assign`)
- `description`: Agent-friendly single sentence suitable for LLM tool-calling
- `input_schema`: JSON Schema derived from catalog Pydantic input models

Source of truth: `core/schema/catalog.py`. The `tools.py` router is registered before router_kwargs so the endpoint remains public regardless of `api_key` configuration.

## Note Domain — Multi-Node Association

The `/note` router supports 0..N node association per note (Phase 36):

- `POST /note/add`: `node_ids: Optional[List[int]]` — omit for global (MetaDataNode-mounted) note, provide list for multi-node association. Requires `title` field.
- `GET /note/list`: Returns Smart Folding display format (`[GLOBAL]`, `[Target: name]`, `[Targets: name1, name2, +N more]`)
- `GET /note/show`: Returns `node_contexts` array (each element: `{id, name, label, file, line}`)
- `POST /note/remove`: By `note_id` (cascade delete) or by `node_ids` + `category` (unbind semantics with orphan cleanup)

## Repair Domain — Function-Level Public Contract

The public contract for `POST /repair/link` is function-to-function, matching the CLI/catalog surface:

- `from_function: str` — caller function / call-site name
- `from_full_name: Optional[str]` — optional exact caller full-name disambiguator
- `from_file: Optional[str]` — optional caller file-path disambiguator
- `to_function: str` — callee function / method name
- `to_full_name: Optional[str]` — optional exact callee full-name disambiguator
- `to_file: Optional[str]` — optional callee file-path disambiguator
- `reason: str` — required repair justification from source evidence
- `note: Optional[str]` — optional extra annotation

The router resolves these names to internal node IDs before delegating to the service layer. Use the optional `*_full_name` or `*_file` fields only when plain function names are ambiguous. Do not document or expose node-ID request fields as the primary API contract for this endpoint.

## Key Patterns

### Response Conversion

All routers build `CLIResponse` objects (same as CLI `--output json`) and convert them via `cli_response_to_http()`, which maps error codes to HTTP status:

- `NODE_NOT_FOUND` / `MODULE_NOT_FOUND` → 404
- `AMBIGUOUS_TARGET` / `AMBIGUOUS_MODULE` → 422
- `INVALID_ARGUMENT` → 400
- `DB_CONNECTION_ERROR` → 503
- Success → 200 (including `NO_RESULTS`)

### Visualization Exception

`POST /api/v1/graph/visualize` is the explicit local exception to the normal envelope rule. It returns a bare `VisualizeResponse` with top-level `nodes` and `edges` so frontend graph clients can consume the payload directly without a `CLIResponse` adapter layer.

### Agent Provenance (X-Agent-ID)

All write endpoints require `X-Agent-ID` header via `Depends(require_agent_id)`. The header value:
- Must match `^[a-zA-Z0-9_-]+$` (no `@` or `:`)
- Is composed into `created_by` strings as `"{agent_id}@{domain}:{action}"` (e.g. `"auditor@tag:add"`)
- Propagated to `GraphPatch`, `TagNavigator`, and `InsightNode` for full audit trail

### Write Serialization

All write endpoints acquire `get_store_lock()` (an `asyncio.Lock`) to serialize mutations. Pattern:

```python
async def some_write_endpoint(
    body: SomeBody,
    store=Depends(get_store),
    lock=Depends(get_store_lock),
    agent_id: str = Depends(require_agent_id),
):
    async with lock:
        # ... mutation logic ...
```

### Optional API Key Auth

When `api_key` is passed to `create_app()`, all routers get a global `Depends(verify_api_key)` dependency that checks `X-API-Key` header. When not configured, all requests pass through. The `tools` router is registered before this dependency and remains always-public.

### Store Lifecycle

`deps.py` manages a module-level `CPGStore` singleton:
- `init_store()` called during FastAPI lifespan startup
- `close_store()` called during shutdown
- `get_store()` dependency returns the singleton or raises 503

### Async Build Jobs

`build.py` is unique — it uses `run_in_executor` for background threads and tracks job state in a module-level `_jobs` dict. Jobs are not persistent across restarts.

### Phase 11 Build Upload Exception

Phase 11 adds an API-native frontend workflow under `POST /api/v1/build/upload` and
`GET /api/v1/build/status?job_id=...`.

- This flow stays inside the existing `build` operational domain.
- It does **not** create new catalog/CLI parity commands such as `build_upload`.
- The router must use a top-level multipart parsing adapter (`BuildUploadForm` +
  `parse_build_upload_form`) instead of endpoint-local form parsing.
- `POST /api/v1/build/upload` requires `X-Agent-ID`, persists the job record on disk,
  and returns immediately with `status="queued"`.
- `GET /api/v1/build/status` rebuilds the response from persisted `job.json` state so
  polling survives API restarts.
- `tools/cdm_client.py` must stay synchronized through direct helper methods/examples
  for this API-native surface even though it is not promoted into catalog parity.

## Adding a New Router

1. Create `routers/<domain>.py` with `router = APIRouter(prefix="/<domain>", tags=["<domain>"])`
2. Import `get_store`, `cli_response_to_http` for read endpoints
3. Import `get_store_lock`, `require_agent_id` additionally for write endpoints
4. Build `CLIResponse` objects and return via `cli_response_to_http(response)`
5. Register in `app.py`: `from codedmap.api.routers import <domain>` + `app.include_router(<domain>.router, **router_kwargs)`

Note: If the new router should be public (no API key required), register it before `router_kwargs` is applied (as done for `tools.py`).

## Adding a New Endpoint to Existing Router

1. Read endpoints: `@router.get(...)` with `store=Depends(get_store)`
2. Write endpoints: `@router.post(...)` with `store=Depends(get_store)`, `lock=Depends(get_store_lock)`, `agent_id=Depends(require_agent_id)`, wrap mutation in `async with lock:`
3. Define Pydantic `BaseModel` for POST request bodies at the top of the router file
4. Compose `created_by` as `f"{agent_id}@{domain}:{action}"`

## Agent Rules

- **Routers are thin wrappers.** Graph logic belongs in `analysis/traversal/`, `app/query/`, or `analysis/tagging/`. Routers only handle HTTP concerns.
- **All routers except visualization use `CLIResponse` for responses.** Do not return raw dicts — go through `cli_response_to_http()` for consistent error code mapping unless a phase context explicitly defines a bare-response exception.
- **`POST /api/v1/graph/visualize` returns bare `VisualizeResponse`.** This route is intentionally frontend-oriented and must not be normalized back into a `CLIResponse` envelope.
- **Write endpoints must require `X-Agent-ID`.** No exceptions. This is the audit trail contract.
- **Write endpoints must hold the store lock.** Use `async with lock:` around all mutations.
- **Keep imports lazy in endpoint functions.** Heavy imports (CLI modules, traversal, query DSL) happen inside the endpoint body, not at module top level.
- **Request bodies are Pydantic models.** Define them at the top of the router file, not inline.
- **OpenAPI is the endpoint reference.** This document covers architecture and conventions only. For endpoint parameters and response shapes, use `/docs` or `/openapi.json`.
- **Any API change must be synchronized to `tools/cdm_client.py`.** The standalone client (`tools/cdm_client.py`) is a single-file SDK + CLI that mirrors the REST API surface. When adding, removing, or modifying endpoints, URL paths, request bodies, or response shapes in any router, you MUST apply the corresponding change to `tools/cdm_client.py` (domain classes, CLI registration, and docstring examples). Failure to keep them in sync will cause the standalone client to break silently.
- **`/api/v1/tools` is always public.** The tools discovery endpoint must never require auth — agents need to discover capabilities before authenticating.
