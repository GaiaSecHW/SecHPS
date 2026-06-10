# Knowledge System Architecture

> Canonical references: `codedmap/app/services/knowledge.py` (domain + models), `codedmap/app/services/matcher.py` (semantic matcher), `codedmap/core/schema/common.py` (SemanticSignature), `codedmap/cli/_bootstrap.py` (CLI execution), `codedmap/api/routers/knowledge.py` (REST API)

---

## Overview

The knowledge system is a projection layer that maps typed knowledge artifacts
(NOTE / TAG) onto CPG nodes using semantic matching. It enables knowledge
transfer across graph rebuilds without relying on storage-level node IDs.

The two core operations are:

- Dump knowledge artifacts from a graph (`cdm knowledge dump`)
- Project artifacts onto a graph via semantic matching (`cdm knowledge project`)

---

## Architecture Overview

| Property | Value |
|----------|-------|
| Domain module | `codedmap/app/services/knowledge.py` |
| Semantic identity | `SemanticSignature` (node_label, name, file_path, content_hash) |
| Matcher | `run_matcher()` (deterministic tiers) |
| CLI | `cdm knowledge {dump,project}` |
| API | `POST /knowledge/dump`, `POST /knowledge/project` |
| Persistence | NOTE -> `store.insights.upsert`, TAG -> `store.tags.add` |
| Storage coupling | None (semantic projection; no node_id in artifacts) |

---

## Knowledge Artifacts

Defined as a discriminated union keyed by `artifact_type`:

- `NoteArtifact` (NOTE)
- `TagArtifact` (TAG)

### NoteArtifact

Required fields:

- `artifact_type: "NOTE"`
- `schema_version: "1.0"`
- `target_signature: SemanticSignature`
- `title`, `content`, `category`, `source`

Optional fields: `confidence`, `status`

### TagArtifact

Required fields:

- `artifact_type: "TAG"`
- `schema_version: "1.0"`
- `target_signature: SemanticSignature`
- `tag`, `source`

Optional fields: `confidence`, `reason`

---

## SemanticSignature

SemanticSignature is a cross-domain identity that excludes `node_id`. It uses:

- `node_label` (e.g., METHOD, CALL, FILE)
- `name` (semantic name of the node)
- `file_path` (POSIX-relative path, no leading slash)
- `content_hash` (optional; enables exact Tier-1 matching)

File paths are normalized to POSIX and stripped of leading slashes.

---

## Matching Semantics

`run_matcher()` uses deterministic tiers:

- **TIER_1**: hash + name + path match (confidence 1.0)
- **TIER_1B**: name + path match, no hash (confidence 0.9)
- **TIER_2**: name + path match, hash mismatch (confidence 0.8, evolved node)
- **TIER_3**: no match (ORPHANED)

Ambiguity handling is strict:

- Multiple hits in any tier -> **AMBIGUOUS** (no auto-pick)
- No hits -> **ORPHANED**

---

## CLI Contract

### Dump

```bash
cdm knowledge dump --db /path/to/graph.db
```

Returns `{ "artifacts": [...], "total": N }`.

### Project

```bash
cdm knowledge project /path/to/artifacts.jsonl --db /path/to/graph.db
```

The input file is JSONL, one artifact per line. Example:

```jsonl
{"artifact_type":"NOTE","schema_version":"1.0","target_signature":{"node_label":"METHOD","name":"login","file_path":"src/auth.py"},"title":"SQL injection via login","content":"Unparameterized query in login handler.","category":"VULNERABILITY","source":"manual"}
{"artifact_type":"TAG","schema_version":"1.0","target_signature":{"node_label":"METHOD","name":"exec_sql","file_path":"src/db.py"},"tag":"SINK:SQL_INJECT","source":"manual"}
```

#### allow_partial behavior (CLI)

The catalog model defaults `allow_partial` to `True`, and the CLI uses the
catalog-driven bool flag behavior:

- Default: `allow_partial=True`
- Passing `--allow-partial` toggles it to `False`

This is a current behavior of the generic catalog CLI adapter and is not an
intentional semantic choice. Use care when relying on default vs flag.

---

## REST API Contract

Endpoints:

- `POST /knowledge/dump` -> `{ artifacts: [...], total: N }` (always 200)
- `POST /knowledge/project` -> ProjectionResponse (200/207/422)

Status codes for `/knowledge/project`:

- **200**: all artifacts projected successfully
- **207**: partial success when `allow_partial=True`
- **422**: strict mode failure when `allow_partial=False`

---

## Projection Response

`ProjectionResponse` includes:

- `projected`, `failed`, `allow_partial`, `errors`
- Tier counters: `exact_matches`, `evolved_matches`, `orphaned`, `ambiguous`

Strict mode (`allow_partial=False`) is all-or-nothing. Any failure rolls back
written notes/tags and returns `projected=0, failed=len(artifacts)`.

---

## Dump Semantics

`dump_knowledge()` emits NOTE and TAG artifacts from storage:

- Notes: derived from `InsightNode` host relations (skips orphan global notes)
- Tags: emitted with `source="dump"` and `confidence/reason=None` because tag
  storage is string-only (by design)

---

## When To Use

Use `knowledge` when you want to:

- Persist agent/human findings as typed NOTE/TAG artifacts
- Migrate knowledge across graph rebuilds
- Round-trip knowledge: dump -> modify -> project

Do NOT use `knowledge` for cross-graph system boundary links. Use `federation`
for cross-graph relationships.

