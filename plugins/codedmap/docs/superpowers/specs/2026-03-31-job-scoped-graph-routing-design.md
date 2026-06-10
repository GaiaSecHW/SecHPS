# Design: Job-Scoped Graph Routing for Frontend Build Results

> Add explicit job-scoped graph read routes so frontend consumers can read a
> completed upload job's `graph.db` without replacing the API server's primary
> `--db` store.

---

## Motivation

Phase 11 introduced asynchronous upload-and-build jobs whose outputs land in:

` .codedmap/build-jobs/<job_id>/output/graph.db `

That job output is not the same database as the API server's startup `--db`.
Today, frontend upload succeeds, but follow-up graph reads still hit the server's
global store unless the operator manually restarts the service against the job
database. That is the wrong boundary:

- upload jobs are isolated, per-job artifacts
- the API server's primary store should remain stable
- frontend graph reads should explicitly target one completed job

The design goal is to add that explicit routing without changing the meaning of
existing global graph endpoints.

## Approach: Separate Job-Scoped Routes (Recommended)

Add new routes under `/api/v1/jobs/{job_id}/graph/...` and keep existing
`/api/v1/graph/...` routes unchanged.

This is preferred over adding an optional `job_id` parameter to existing routes:

- URL semantics stay unambiguous: global graph vs job graph
- no hidden "sometimes global, sometimes job-local" branching in one handler
- frontend code can choose one route family intentionally
- future job-scoped graph routes can extend naturally under the same prefix

---

## 1. API Surface

### Keep Existing Global Routes Unchanged

- `GET /api/v1/graph/entrypoints`
- `POST /api/v1/graph/visualize`

These continue to read from the API server's primary store initialized from
`serve --db`.

### Add Job-Scoped Routes

- `GET /api/v1/jobs/{job_id}/graph/entrypoints`
- `POST /api/v1/jobs/{job_id}/graph/visualize`

These routes resolve the graph database from the completed build job rather than
from the process-global store.

### Request / Response Contracts

#### Job-Scoped Entrypoints

- request shape: same query parameters as the existing entrypoints route
- response shape: same bare JSON array as the existing entrypoints route

#### Job-Scoped Visualize

- request shape: same `VisualizeRequest` body as the existing visualize route
- response shape: same bare `VisualizeResponse`
- `job_id` comes from the path only; it is not duplicated in the body

No response envelope changes are introduced in this design.

---

## 2. Data Source Resolution

### Source of Truth

For a given `job_id`, the server resolves:

1. job file: `.codedmap/build-jobs/<job_id>/job.json`
2. job record: `BuildJobRecord`
3. output DB path: `record.result_db`

The job-scoped routes must not infer a database path from naming conventions
once `job.json` is present. `job.json` is the canonical source of truth.

### Read Eligibility Rules

Job-scoped graph reads are allowed only when all of the following are true:

- the job exists
- the job status is `completed`
- `result_db` is present
- the `result_db` file exists on disk

If any of those checks fail, the route returns an explicit error and does not
fall back to the global store.

---

## 3. Error Semantics

### `404 Not Found`

Use `404` when:

- the `job_id` does not exist
- `result_db` is recorded but the file is missing

### `409 Conflict`

Use `409` when:

- the job exists but is not yet in `completed` state
- the job completed logically but `result_db` is still absent in the record

This signals that the resource exists but is not in a readable graph state yet.

### `503 Service Unavailable`

Use `503` when:

- the job database path exists but the server cannot open it as a store
- storage initialization fails for operational reasons

This stays aligned with the existing API error-family behavior for store access.

### No Implicit Fallback

The new routes must never:

- silently read from the primary `serve --db`
- silently wait for a running job to finish
- mutate job state

They are read-only graph views over completed job artifacts.

---

## 4. Implementation Architecture

### Thin Job Store Resolver

Add a small resolver layer responsible for:

- locating `job.json` from `job_id`
- validating completed-state readability
- creating a temporary `CPGStore` bound to `record.result_db`
- closing that store after request completion

This should be an isolated helper/dependency, not embedded directly in each
route body.

### Reuse Existing Business Logic

The new job-scoped routes should reuse the same downstream logic already used by:

- the current graph entrypoints route
- the current visualize route / `VisualizeService`

The only difference should be the store source.

The design explicitly avoids copying graph query or visualization logic into a
parallel "job-specific" implementation.

### Existing Global Dependencies Stay Intact

- `get_store()` remains the global-store dependency for existing routes
- job-scoped routes use a separate dependency/helper

This preserves current behavior and minimizes blast radius.

---

## 5. File-Level Plan

### New / Modified API Router Behavior

Primary expected touch points:

| File | Change |
|------|--------|
| `codedmap/api/routers/visualize.py` | Add job-scoped `entrypoints` and `visualize` routes or shared helpers |
| `codedmap/api/routers/build.py` or API helper module | Reuse job path resolution utilities if appropriate |
| `codedmap/api/deps.py` or new helper module | Add temporary job-store resolver dependency/helper |

### Reuse Existing Job Model

The design assumes continued reuse of:

- `codedmap.app.build_jobs.load_job_record`
- `codedmap.app.build_jobs.resolve_jobs_root`
- `codedmap.core.schema.build_upload.BuildUploadStatus`

No new job registry format is introduced.

---

## 6. Testing Strategy

### Additive Tests Only

Do not rewrite existing global graph route tests. Add new tests for the new
route family while preserving current coverage.

### New API Coverage

#### Job-Scoped Entrypoints

Add tests that verify:

- route registration exists
- completed job reads use the job output database, not the global store
- nonexistent `job_id` returns `404`
- incomplete job returns `409`
- missing `result_db` file returns `404`

#### Job-Scoped Visualize

Add tests that verify:

- route registration exists
- completed job visualize uses the job output database
- response shape remains bare `VisualizeResponse`
- existing visualize service behavior is preserved under job-scoped routing

### Regression Goal

The tests should prove two independent behaviors:

1. existing `/api/v1/graph/*` routes still read the primary server store
2. new `/api/v1/jobs/{job_id}/graph/*` routes read only the selected job store

---

## 7. Non-Goals

This design does not include:

- automatic switching of the server's primary `--db`
- an "activate this job as current project" mutation endpoint
- job-scoped support for the entire query API surface
- waiting/polling behavior inside graph read routes
- backward compatibility aliases that blur global vs job-scoped semantics

Only the frontend-needed minimum is in scope:

- entrypoints
- visualize

---

## 8. Rollout Notes

This is intentionally a minimal, low-risk extension:

- no schema change
- no job model change
- no change to upload/status contracts
- no change to the meaning of the existing global graph routes

If the pattern works well, future job-scoped graph read routes can be added
under the same `/api/v1/jobs/{job_id}/graph/...` prefix.
