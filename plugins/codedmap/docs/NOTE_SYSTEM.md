# Note System Architecture

> Canonical references: `codedmap/core/schema/graph/nodes/extensions.py` (model), `codedmap/app/query/note_validation.py` (typed schema contract), `codedmap/infra/storage/repository.py` (repository), `codedmap/cli/commands/note.py` (CLI), `codedmap/api/routers/note.py` (REST API)

---

## Overview

The note system is an `InsightNode`-based annotation layer for agent/human collaboration on top of the code graph.

Notes are first-class graph nodes (`label=INSIGHT`) connected to 0..N host nodes via `HAS_INSIGHT` edges. A note can be:

- Global (attached to `MetaDataNode`)
- Local (attached to one node)
- Multi-host (attached to multiple nodes)

Compared with tags (flat string properties), notes carry richer payloads:

- `title`
- `content`
- `category`
- `source`
- `confidence`
- `status`

The system follows progressive disclosure:

- `cdm note list` returns summary rows
- `cdm note show` returns full content + host contexts

The system also uses note layers:

- `campaign`: run-scoped working notes, usually tied to one `campaign_id`
- `stable_candidate`: promoted notes under review for long-term retention
- `stable_confirmed`: confirmed notes that remain visible across campaigns

---

## Architecture Overview

| Property | Value |
|----------|-------|
| Model | `InsightNode` (`codedmap/core/schema/graph/nodes/extensions.py`) |
| DTO | `InsightSummary` (`codedmap/app/query/models.py`) |
| Typed validation | `validate_and_canonicalize_note_content()` (`codedmap/app/query/note_validation.py`) |
| Repository | `InsightRepository` (`codedmap/infra/storage/repository.py`) |
| CLI | `cdm note {add,list,show,remove}` |
| API | `/note/add`, `/note/list`, `/note/show`, `/note/remove` |
| Storage edge | `host_node --HAS_INSIGHT--> InsightNode` |
| Global anchor | `MetaDataNode --HAS_INSIGHT--> InsightNode` |

---

## InsightNode and Categories

Defined in `codedmap/core/schema/graph/nodes/extensions.py`.

Note categories are defined in YAML and loaded via `NoteCategoryLoader`:
- SDK built-in: `codedmap/rules/common/note_categories.yaml`
- Project overrides: `.cpg/rules/note_categories.yaml`

SDK built-in categories: ARCHITECTURE, DATA_FLOW, CONTROL_FLOW,
VULNERABILITY, COORDINATION, SECURITY_BOUNDARY.

Users can add custom categories (non-strict) or tombstone built-in ones
via their project's `.cpg/rules/note_categories.yaml`.

```python
class InsightNode(CPGNode):
    label: NodeLabel = NodeLabel.INSIGHT
    category: str
    title: str
    content: str
    source: str = "unknown"
    confidence: Optional[float] = None
    status: str = "active"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
```

### Strict vs Non-strict categories

Strict (JSON schema validation enforced before persistence):

- `VULNERABILITY`
- `COORDINATION`
- `SECURITY_BOUNDARY`

Non-strict (opaque string passthrough):

- `ARCHITECTURE`
- `DATA_FLOW`
- `CONTROL_FLOW`

Category input is normalized case-insensitively (`"security_boundary"` -> `SECURITY_BOUNDARY`).

---

## Typed Content Contract

All note write paths use `content` (not `text`) and pass through:

- `CPG.set_summary(...)`
- `validate_and_canonicalize_note_content(category, content)`
- `InsightRepository.upsert(...)`

Validation error contract is deterministic:

- error code: `SCHEMA_VALIDATION_ERROR`
- details keys:
  - `category`
  - `expected_schema`
  - `validation_errors` (`loc/msg/type`)
  - `raw_content_excerpt`

### Strict schema models

`codedmap/app/query/note_validation.py` defines:

- `VulnerabilityNoteContent`
- `CoordinationNoteContent`
- `SecurityBoundaryNoteContent`
- `STRICT_NOTE_SCHEMAS: Dict[str, Type[BaseModel]]`

`SecurityBoundaryNoteContent` fields:

- `schema_version: Literal["1.0"] = "1.0"`
- `boundary_type: str`
- `trust_transition: str`
- `untrusted_inputs: List[str]`
- `entry_node_ids: List[int] = []`
- `linked_sink_ids: List[int] = []`
- `required_guards: List[str]`
- `observed_guards: List[str]`
- `exploit_hypotheses: List[str] = []`
- `status: Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] = "TODO"`
- `owner: str = "UNASSIGNED"`

On strict validation success, canonical JSON is persisted via `model_dump_json()`.

---

## Upsert Identity and Semantics

Repository implementation (`InsightRepository.upsert`) uses deterministic identity:

- Key: `(sorted(set(host_ids)), category, title, source)`
- Host IDs are deduped + sorted on both incoming and existing sides

Update semantics are PUT-like full replacement for mutable fields:

- `title`
- `content`
- `status`
- `confidence` (including `None`)

`updated_at` is always refreshed on update.

---

## CLI Contract

Commands:

- `cdm note add`
- `cdm note list`
- `cdm note show`
- `cdm note remove`

### `cdm note add`

```bash
cdm note add '<content>' --title <title> [--node-ids <ids>] [--category <cat>] [--source <src>] [--confidence <f>]
```

Important:

- Positional payload is `content`
- No `text` alias
- Strict categories must provide valid JSON content string

### `cdm note list`

`cdm note list` is a collection query, so it supports layer filters and default visibility:

- no explicit filters: current campaign's `campaign` notes plus all `stable_confirmed` notes
- `--scope campaign`: all campaign-scoped notes, across campaigns unless `--campaign-id` is also provided
- `--scope stable_candidate`: only candidate notes
- `--scope stable_confirmed`: only confirmed notes
- `--scope all`: full list across all scopes

Constraint:

- `--scope all` cannot be combined with `--campaign-id`

For remote use, client-side `CPG_CAMPAIGN_ID` does not automatically become an HTTP query filter. Use `--campaign-id` when you want the remote server to filter by campaign.

JSON payload uses `result.notes` (not `result.nodes`):

```json
{
  "command": "note",
  "result": {
    "notes": [
      {
        "note_id": "123",
        "node_ids": [4892],
        "target_label": "[Target: process_input]",
        "title": "...",
        "category": "SECURITY_BOUNDARY",
        "source": "agent",
        "status": "active",
        "created_at": "..."
      }
    ],
    "total": 1
  }
}
```

### `cdm note show`

`cdm note show` is a direct lookup by `note_id`. It does not accept scope or campaign filters and does not reuse `note list`'s collection visibility policy. If you already know the note ID, `show` fetches that note directly.

JSON payload shape:

```json
{
  "result": {
    "note": {"id": 123, "category": "...", "title": "...", "content": "..."},
    "node_contexts": [{"id": 4892, "name": "...", "label": "METHOD", "file": "...", "line": 42}]
  }
}
```

### CLI error envelope

When strict validation fails, CLI JSON includes:

```json
{
  "success": false,
  "error": {
    "code": "SCHEMA_VALIDATION_ERROR",
    "message": "...",
    "details": {
      "category": "SECURITY_BOUNDARY",
      "expected_schema": "SecurityBoundaryNoteContent",
      "validation_errors": [{"loc": ["required_guards"], "msg": "Field required", "type": "missing"}],
      "raw_content_excerpt": "..."
    }
  }
}
```

---

## REST API Contract

Base: `/api/v1/note/*`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/note/add` | Create/upsert note |
| `GET` | `/note/list` | List summary rows (`result.notes`) |
| `GET` | `/note/show` | Full note + `node_contexts` |
| `POST` | `/note/remove` | Delete/unbind |

### POST `/note/add` body

```json
{
  "node_ids": [4892, 5103],
  "title": "Boundary ingress for HTTP gateway",
  "content": "{\"schema_version\":\"1.0\",\"boundary_type\":\"NETWORK\",\"trust_transition\":\"Untrusted internet -> trusted service\",\"untrusted_inputs\":[\"headers\",\"json body\"],\"required_guards\":[\"JWT Auth\",\"Input Validation\"],\"observed_guards\":[\"JWT Auth\"],\"entry_node_ids\":[4892],\"linked_sink_ids\":[9132]}",
  "category": "SECURITY_BOUNDARY",
  "source": "agent",
  "confidence": 0.9
}
```

Notes:

- Request field is `content`, not `text`
- On schema mismatch, API returns the same `SCHEMA_VALIDATION_ERROR` envelope as CLI (HTTP 400)

---

## DSL Methods

`codedmap/app/query/root.py` provides:

- `cpg.set_summary(...)`
- `cpg.get_summaries(...)`
- `cpg.delete_summary(...)`

`set_summary` validates/canonicalizes strict category content before repository write.

---

## Storage Layout

```text
host_node_1  --HAS_INSIGHT-->  InsightNode
host_node_2  --HAS_INSIGHT-->  InsightNode
MetaDataNode --HAS_INSIGHT-->  InsightNode  (global note)
```

Lookup patterns:

- notes for a host: from host traverse `OUT(HAS_INSIGHT)`
- hosts for a note: from note traverse `IN(HAS_INSIGHT)`

---

## Canonical File References

| File | Role |
|------|------|
| `codedmap/core/schema/graph/nodes/extensions.py` | `InsightNode` (category is `str`) |
| `codedmap/infra/rules/note_category_loader.py` | `NoteCategoryLoader` — cascading YAML loader |
| `codedmap/rules/common/note_categories.yaml` | SDK built-in note category definitions |
| `codedmap/app/query/note_validation.py` | strict schema models + validator + `SCHEMA_VALIDATION_ERROR` |
| `codedmap/app/query/models.py` | `InsightSummary` DTO |
| `codedmap/infra/storage/repository.py` | `InsightRepository` upsert semantics |
| `codedmap/app/query/root.py` | DSL write/read/delete entry points |
| `codedmap/cli/commands/note.py` | CLI behavior and JSON contract |
| `codedmap/api/routers/note.py` | REST note API contract |
| `codedmap/api/app.py` | error code -> HTTP mapping (`SCHEMA_VALIDATION_ERROR` -> 400) |

---

*Last updated: 2026-04-08*
