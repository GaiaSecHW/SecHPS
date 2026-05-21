# Storage Correctness Contract

> Phase 19 — Cross-backend graph semantics for `memory`, `sqlite`, `neo4j`

## Overview

The CPG SDK supports three storage backends: **memory**, **sqlite**, and **neo4j**.
All three must preserve the same graph semantics for security-relevant traversals.
This document specifies the contract that all backends guarantee, with emphasis on
edge identity and deduplication behavior.

## Edge Semantic Identity

### Problem

Many CPG edge types carry semantically meaningful properties:

| Edge Type | Semantic Property | Example |
|-----------|-------------------|---------|
| `DDG`     | `variable`        | Data dependency on variable `x` vs. `y` |
| `CFG`     | `label`           | Branch taken: `"true"` vs. `"false"` |
| `CDG`     | *(none)*          | Control dependency — no property distinction |
| `AST`     | *(none)*          | Parent-child — no property distinction |
| `CALL`    | *(none)*          | Call site to method — no property distinction |

Two DDG edges between the same `(src, dst)` with different `variable` values are
**semantically distinct** — they represent different data flows. A backend that
collapses them by endpoint-only deduplication destroys audit evidence.

### Semantic Identity Tuple

Every edge's identity is the 4-tuple:

```
(src, dst, type, semantic_value)
```

Where `semantic_value` is:
- **DDG**: `properties["variable"]` (or `""` if absent)
- **CFG**: `properties["label"]` (or `""` if absent)
- **All other types**: `""` (no semantic property → single slot per endpoint pair)

The canonical helper is `edge_semantic_identity(type_str, properties)` in
`cpg_schema/infra/storage/base/edge_identity.py`.

## Backend Contracts

### COR-01: Parallel Edge Preservation

**Invariant**: `save(graph)` and `add_edges_batch()` preserve all edges whose
semantic identity tuples differ, even if `(src, dst, type)` is the same.

| Backend | Mechanism |
|---------|-----------|
| Memory  | `CPGGraph._compute_edge_hash()` includes semantic property in dedup hash |
| SQLite  | `UNIQUE(src, dst, type, semantic_value)` constraint; `semantic_slot` + `semantic_value` columns |
| Neo4j   | `MERGE (a)-[r:TYPE {__semantic_value: val}]->(b)` pattern in Cypher |

### COR-02: Read Fidelity

**Invariant**: Reading edges back from any backend returns the same `CPGEdge.properties`
that were written, without backend-internal metadata leaking into the public API.

| Backend | Read Path |
|---------|-----------|
| Memory  | Direct edge list — no transformation needed |
| SQLite  | `SqliteSerializer.row_to_edge()` reconstructs `properties` from JSON column + `semantic_slot`/`semantic_value` |
| Neo4j   | `DataConverter.to_cpg_edge()` strips reserved `__semantic_slot`/`__semantic_value` keys |

### COR-03: Coarse Deletion (Phase 19 Behavior)

**Current behavior**: `remove_edge(src, dst, type)` removes **all** semantic variants
for that `(src, dst, type)` triple.

This is intentional Phase 19 behavior. Future phases may widen the deletion API to
support semantic discrimination (e.g., remove only the DDG edge for variable `x`).

## SQLite Schema

The `cpg_edges` table schema (post-Phase 19):

```sql
CREATE TABLE IF NOT EXISTS cpg_edges (
    src        INTEGER NOT NULL,
    dst        INTEGER NOT NULL,
    type       TEXT NOT NULL,
    properties TEXT,           -- JSON blob of all edge properties
    created_by TEXT DEFAULT 'static',
    semantic_slot  TEXT DEFAULT '',  -- e.g., 'variable', 'label', or ''
    semantic_value TEXT DEFAULT '',  -- e.g., 'x', 'true', or ''
    UNIQUE(src, dst, type, semantic_value)
);
```

Key design decisions:
- Non-semantic edges use `""` (empty string) instead of `NULL` for `semantic_value`
  to ensure the `UNIQUE` constraint works correctly (SQL `NULL != NULL`)
- `semantic_slot` is informational only; the `UNIQUE` constraint uses `semantic_value`
- The `properties` JSON blob stores **all** properties including the semantic property
  (redundant but simpler for deserialization)

## Neo4j Schema

Neo4j relationships carry properties directly. Phase 19 adds two reserved property keys:

| Key | Purpose | Example |
|-----|---------|---------|
| `__semantic_slot` | Informational: which property is the semantic key | `"variable"` |
| `__semantic_value` | Merge discriminator: the semantic property value | `"x"` |

The `MERGE` pattern includes `__semantic_value` so Neo4j treats edges with different
semantic values as distinct relationships:

```cypher
MATCH (a:CPGNode {id: row.s})
MATCH (b:CPGNode {id: row.d})
MERGE (a)-[r:DDG {__semantic_value: row.p.__semantic_value}]->(b)
SET r += row.p
```

**Read-side**: `DataConverter.to_cpg_edge()` strips `__semantic_*` keys before
returning edges through the public API. Export paths also strip these keys.

## Test Matrix

| Test Suite | Count | What It Verifies |
|-----------|-------|------------------|
| `test_storage_semantics_contract.py` — Memory | 5 | DDG/CFG parallel preservation, batch semantics, PDG shape, coarse delete |
| `test_storage_semantics_contract.py` — SQLite | 6 | Same as memory + SQLite uniqueness constraint |
| `test_storage_semantics_contract.py` — Cross-backend | 6 | Parametrized memory/sqlite equivalence |
| `test_storage_semantics_contract.py` — Edge Identity | 8 | Canonical helper, hash correctness |
| `test_storage_semantics_contract.py` — Neo4j | 6 | Cypher payloads, merge template, read stripping |
| `test_agent_cli_e2e.py` — Regression | 3 | SQLite → CLI round-trip for DDG evidence |
| **Total** | **34** | |

## Adding a New Semantic Edge Type

To add semantic awareness for a new edge type (e.g., `TAINT` with `source` property):

1. **`edge_identity.py`**: Add `"TAINT": "source"` to `_SEMANTIC_SLOT_MAP`
2. **`CPGGraph._compute_edge_hash()`**: Add `"TAINT": "source"` to the inline map
3. **Contract tests**: Add parametrized test for the new type
4. No schema changes needed — the `semantic_slot`/`semantic_value` columns and
   `__semantic_*` Neo4j properties handle any slot/value pair generically.
