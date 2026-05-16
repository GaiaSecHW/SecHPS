# Unified Audit Log Design

**Date:** 2026-04-08

**Goal**

Introduce a single audit event model and persistence layer for graph mutations so `tag` and `note` operations are recorded consistently now, while leaving a clean extension path for future `node`, `edge`, and property-level mutations.

## Problem

The current codebase records mutation provenance in several incompatible ways:

- `tag` history is partly embedded in `node.tags_provenance`
- `note` authorship is exposed via note `source`
- some graph edges and patches use `created_by`

These mechanisms are local to their domains. They do not produce a single searchable audit trail, they do not expose uniform fields, and they do not scale well to future mutation types.

## Scope

This phase introduces a minimal but extensible `audit_log` foundation.

Included:

- persistent audit events for `tag add`
- persistent audit events for `tag remove`
- persistent audit events for `tag bulk`
- persistent audit events for `note add`
- persistent audit events for `note remove`
- a read path to list audit events by target

Not included:

- historical backfill of existing databases
- auditing arbitrary node property changes
- auditing edge creation/deletion outside the above domain operations
- broad actor/request correlation across all command paths

## Approaches Considered

### 1. Keep provenance on domain objects only

Store more metadata directly on nodes/notes, similar to `tags_provenance`.

Pros:

- minimal implementation effort
- low immediate migration cost

Cons:

- continues fragmented provenance design
- poor fit for cross-domain queries
- weak foundation for future `node` and `edge` auditing
- history remains coupled to current object state instead of a durable event trail

### 2. Add a dedicated audit log table and repository

Store one append-only audit event per mutation in dedicated storage and keep domain-local provenance as optional read-model data.

Pros:

- clean separation between business state and audit history
- uniform query surface across domains
- naturally extensible to future mutation categories
- durable event history instead of only current-state attribution

Cons:

- requires new schema, repository, service, and query wiring

### 3. Model audit events as graph nodes/edges

Represent audit history directly inside the CPG graph.

Pros:

- graph-native representation
- expressive traversal possibilities later

Cons:

- significantly larger first-phase scope
- no existing project conventions for this pattern
- higher complexity than needed for initial tag/note adoption

## Decision

Use approach 2.

Create an append-only `audit_log` persistence layer backed by a dedicated repository and exposed through a small audit service. Existing domain-specific provenance fields remain in place where useful, but the new audit log becomes the canonical cross-domain audit history.

## Architecture

### Audit Event Model

Add a new Pydantic model, `AuditEvent`, with stable fields:

- `event_id`
- `timestamp`
- `actor_id`
- `actor_type`
- `source`
- `operation`
- `target_kind`
- `target_id`
- `target_label`
- `field`
- `old_value`
- `new_value`
- `status`
- `reason`

Field semantics:

- `actor_id`: the human, agent, or pass identifier, usually derived from existing `created_by`-style inputs
- `actor_type`: one of `human`, `agent`, `system`, `pass`
- `source`: adapter or subsystem origin such as `cli.tag.add`, `api.note.remove`
- `operation`: domain action such as `tag_add`, `tag_remove`, `tag_bulk_add`, `note_add`, `note_remove`
- `target_kind`: first-phase values are `node_tag` and `note`
- `field`: changed field or collection, such as `tags`, `note`, `bindings`
- `old_value` and `new_value`: JSON-compatible payloads
- `status`: first-phase default is `applied`

### Persistence

Add a dedicated `audit_log` table for SQLite and an in-memory equivalent for the memory backend. The repository API should be append-focused:

- `append(event: AuditEvent) -> None`
- `list_by_target(target_kind: str, target_id: int, limit: int, offset: int) -> dict`

The table should be append-only for this phase. No update or delete API is needed.

### Service Boundary

Add `AuditService` or a focused domain service helper that constructs normalized `AuditEvent` objects from business operations.

Rules:

- CLI and API adapters do not write audit events directly
- domain services emit audit events after successful state mutation
- audit failures should fail the command, because silent loss of audit history breaks the feature contract

### Domain Integration

#### Tag

- `tag_add`: emit one `tag_add` event per applied tag
- `tag_remove`: emit one `tag_remove` event
- `tag_bulk`: emit one `tag_bulk_add` event per successfully tagged node

Payload shape:

- `target_kind = "node_tag"`
- `target_id = <node id>`
- `target_label = <node label if available>`
- `field = "tags"`
- `old_value = null` for add, or `{"tag": "<TAG>"}` for remove if a previous value is needed
- `new_value = {"tag": "<TAG>"}` for add, or `null` for remove

`tags_provenance` remains temporarily supported for current CLI display and backward compatibility, but it is no longer the system-of-record for cross-domain audit history.

#### Note

- `note_add`: emit one `note_add` event for the created note
- `note_remove`: emit one `note_remove` event for the deleted note or detached note operation

Payload shape:

- `target_kind = "note"`
- `target_id = <note id>` when available
- `field = "note"`
- `new_value` contains a compact summary, not the full raw note payload unless needed
- detach/remove-by-filter paths should preserve enough metadata to understand what was removed

### Query Surface

First-phase read support is intentionally narrow:

- list audit events by `target_kind + target_id`

This is enough to verify the storage model and unblock future CLI/API exposure without overbuilding query capabilities.

## Data Model Details

SQLite table:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  source TEXT,
  operation TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id INTEGER,
  target_label TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  status TEXT NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_target
ON audit_log(target_kind, target_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
ON audit_log(actor_id, timestamp);
```

JSON fields are stored as serialized JSON strings in SQLite. In memory, the same fields remain Python dictionaries or `None` until serialization boundaries require conversion.

## Error Handling

- if a domain mutation succeeds but audit event append fails, return an error instead of silently succeeding
- repository list calls return empty results when no events exist
- malformed JSON should never be persisted; serialization happens before repository append

## Testing Strategy

Required coverage:

- repository persistence for SQLite
- repository behavior for memory backend
- domain service tests proving `tag` and `note` mutations append audit events
- target-query tests proving events can be fetched by `target_kind` and `target_id`
- one integration path per domain to verify mutation + audit append end to end

## File Plan

Expected new or modified areas:

- new audit model module under `codedmap/app/audit/`
- storage repository wiring under `codedmap/infra/storage/`
- backend-specific support in SQLite and memory drivers/store façade
- domain service integration in `codedmap/app/services/domain/tag.py` and `codedmap/app/services/domain/note.py`
- mirrored integration in `codedmap/app/services/domain_services.py`
- tests in `tests/app/audit/`, `tests/infra/storage/`, and targeted integration suites

## Future Extension Path

Once this first phase is stable, the same event schema can support:

- `target_kind = "node_property"`
- `target_kind = "edge"`
- generic node mutation auditing
- request correlation IDs
- job-scoped audit views
- adapter-level audit inspection commands

The important design boundary is that future mutation types extend the event vocabulary, not the storage model.
