# Job-Scoped Graph Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit `/api/v1/jobs/{job_id}/graph/*` read routes so frontend consumers can query a completed upload job's `graph.db` without changing the API server's primary `--db`.

**Architecture:** Keep existing `/api/v1/graph/*` routes unchanged and add a separate job-scoped route family that resolves a temporary `CPGStore` from persisted `job.json` metadata. Centralize job readability checks in a small resolver/helper so both new routes share identical `404` / `409` / `503` behavior and downstream graph logic stays unchanged.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic V2, SQLite-backed `CPGStore`, pytest, fastapi.testclient

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `codedmap/api/job_graph.py` | Job-scoped graph store resolver and temporary store lifecycle helpers |
| `tests/api/test_job_graph_store_resolver.py` | Unit tests for job lookup, readability validation, and error mapping |

### Modified Files

| File | Change |
|------|--------|
| `codedmap/api/routers/visualize.py` | Add `/api/v1/jobs/{job_id}/graph/entrypoints` and `/api/v1/jobs/{job_id}/graph/visualize` using shared route logic |
| `codedmap/api/app.py` | Register any additional router object exported from `visualize.py` if needed |
| `tools/cdm_client.py` | Add direct helpers for new job-scoped graph endpoints and keep examples in sync |
| `tests/api/test_graph_entrypoints_router.py` | Preserve existing global-route coverage and add explicit regression that global reads still use primary store |
| `tests/api/test_visualize_router.py` | Preserve existing global-route coverage and add job-scoped visualize route assertions |
| `tests/api/test_build_upload_router.py` | Add client-sync assertions for new job graph helper methods |

---

### Task 1: Add failing tests for job-scoped store resolution

**Files:**
- Create: `tests/api/test_job_graph_store_resolver.py`
- Modify: `codedmap/api/job_graph.py`

- [ ] **Step 1: Write the failing resolver tests**

```python
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.append(os.getcwd())

from codedmap.app.build_jobs import create_queued_job, update_job_record
from codedmap.core.schema.build_upload import ArchiveFormat, BuildUploadStatus


def _make_completed_record(tmp_path: Path, job_id: str = "job-123"):
    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id=job_id,
    )
    record.paths.output_db.write_text("not-a-real-db", encoding="utf-8")
    return update_job_record(
        record,
        status=BuildUploadStatus.COMPLETED,
        result_db=str(record.paths.output_db),
    )


def test_resolve_job_graph_path_reads_result_db_from_job_record(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = _make_completed_record(tmp_path)

    resolved = resolve_job_graph_db_path(record.job_id, jobs_root=tmp_path)

    assert resolved == record.paths.output_db


def test_resolve_job_graph_path_raises_404_for_missing_job(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    with pytest.raises(HTTPException) as excinfo:
        resolve_job_graph_db_path("missing-job", jobs_root=tmp_path)

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Job 'missing-job' not found"


def test_resolve_job_graph_path_raises_409_for_non_completed_job(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-running",
    )
    update_job_record(record, status=BuildUploadStatus.RUNNING)

    with pytest.raises(HTTPException) as excinfo:
        resolve_job_graph_db_path("job-running", jobs_root=tmp_path)

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == "Job 'job-running' is not completed"


def test_resolve_job_graph_path_raises_409_when_result_db_missing_from_record(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-no-db",
    )
    update_job_record(record, status=BuildUploadStatus.COMPLETED, result_db=None)

    with pytest.raises(HTTPException) as excinfo:
        resolve_job_graph_db_path("job-no-db", jobs_root=tmp_path)

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == "Job 'job-no-db' has no readable result database yet"


def test_resolve_job_graph_path_raises_404_when_result_db_file_missing(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-missing-db-file",
    )
    update_job_record(
        record,
        status=BuildUploadStatus.COMPLETED,
        result_db=str(record.paths.output_db),
    )

    with pytest.raises(HTTPException) as excinfo:
        resolve_job_graph_db_path("job-missing-db-file", jobs_root=tmp_path)

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == "Result database for job 'job-missing-db-file' was not found"
```

- [ ] **Step 2: Run the resolver tests to verify they fail**

Run: `python3 -m pytest tests/api/test_job_graph_store_resolver.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'codedmap.api.job_graph'`

- [ ] **Step 3: Commit**

```bash
git add tests/api/test_job_graph_store_resolver.py
git commit -m "test: add failing job graph store resolver coverage"
```

---

### Task 2: Implement the job-scoped resolver helper

**Files:**
- Create: `codedmap/api/job_graph.py`

- [ ] **Step 1: Implement path resolution and temporary store creation**

```python
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException

from codedmap.app.build_jobs import load_job_record, resolve_jobs_root
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.build_upload import BuildUploadStatus
from codedmap.infra.storage.store import CPGStore


def _job_file_for_id(job_id: str, jobs_root: Path | None = None) -> Path:
    effective_root = resolve_jobs_root() if jobs_root is None else resolve_jobs_root(jobs_root)
    return effective_root / job_id / "job.json"


def resolve_job_graph_db_path(job_id: str, jobs_root: Path | None = None) -> Path:
    job_file = _job_file_for_id(job_id, jobs_root=jobs_root)
    if not job_file.exists():
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    record = load_job_record(job_file)
    if record.status != BuildUploadStatus.COMPLETED:
        raise HTTPException(status_code=409, detail=f"Job '{job_id}' is not completed")
    if not record.result_db:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' has no readable result database yet",
        )

    db_path = Path(record.result_db)
    if not db_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Result database for job '{job_id}' was not found",
        )
    return db_path


@contextmanager
def open_job_graph_store(job_id: str) -> Iterator[CPGStore]:
    db_path = resolve_job_graph_db_path(job_id)
    store = None
    try:
        store = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        yield store
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to open graph store for job '{job_id}': {exc}",
        ) from exc
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass
```

- [ ] **Step 2: Run resolver tests and make them pass**

Run: `python3 -m pytest tests/api/test_job_graph_store_resolver.py -v`
Expected: PASS

- [ ] **Step 3: Add a store-open failure test**

```python
def test_open_job_graph_store_raises_503_when_store_init_fails(monkeypatch, tmp_path: Path):
    from codedmap.api.job_graph import open_job_graph_store

    record = _make_completed_record(tmp_path, job_id="job-bad-store")

    def _boom(*args, **kwargs):
        raise RuntimeError("sqlite open failed")

    monkeypatch.setattr("codedmap.api.job_graph.CPGStore", _boom)

    with pytest.raises(HTTPException) as excinfo:
        with open_job_graph_store(record.job_id):
            pass

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail == "Failed to open graph store for job 'job-bad-store': sqlite open failed"
```

- [ ] **Step 4: Re-run resolver tests**

Run: `python3 -m pytest tests/api/test_job_graph_store_resolver.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add codedmap/api/job_graph.py tests/api/test_job_graph_store_resolver.py
git commit -m "feat: add job-scoped graph store resolver"
```

---

### Task 3: Add failing route coverage for job-scoped graph reads

**Files:**
- Modify: `tests/api/test_graph_entrypoints_router.py`
- Modify: `tests/api/test_visualize_router.py`

- [ ] **Step 1: Add entrypoints route registration and delegation tests**

```python
def test_app_registers_job_graph_entrypoints_route(self):
    app = create_app(db_path=":memory:", backend="memory")

    routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

    assert ("/api/v1/jobs/{job_id}/graph/entrypoints", ("GET",)) in routes


def test_job_graph_entrypoints_reads_from_selected_job_store(self, monkeypatch):
    captured = {}

    class DummyContextManager:
        def __enter__(self):
            captured["store"] = object()
            return captured["store"]

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "codedmap.api.routers.visualize.open_job_graph_store",
        lambda job_id: DummyContextManager(),
    )
    monkeypatch.setattr(
        "codedmap.app.services.query_services.list_entrypoints",
        lambda **kwargs: captured.update(kwargs) or {"nodes": []},
    )

    app = create_app(db_path=":memory:", backend="memory")

    with TestClient(app) as client:
        response = client.get("/api/v1/jobs/job-123/graph/entrypoints")

    assert response.status_code == 200
    assert response.json() == []
    assert captured["store"] is not None
```

- [ ] **Step 2: Add explicit error-mapping tests for job entrypoints**

```python
def test_job_graph_entrypoints_returns_404_for_missing_job(self, monkeypatch):
    monkeypatch.setattr(
        "codedmap.api.routers.visualize.open_job_graph_store",
        lambda job_id: (_ for _ in ()).throw(HTTPException(status_code=404, detail="Job 'missing' not found")),
    )

    app = create_app(db_path=":memory:", backend="memory")

    with TestClient(app) as client:
        response = client.get("/api/v1/jobs/missing/graph/entrypoints")

    assert response.status_code == 404
    assert response.json() == {"detail": "Job 'missing' not found"}
```

- [ ] **Step 3: Add visualize route registration and bare-response tests**

```python
def test_app_registers_job_visualize_route(self):
    app = create_app(db_path=":memory:", backend="memory")

    routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

    assert ("/api/v1/jobs/{job_id}/graph/visualize", ("POST",)) in routes


def test_job_visualize_route_returns_bare_contract_shape(self, monkeypatch):
    class DummyContextManager:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "codedmap.api.routers.visualize.open_job_graph_store",
        lambda job_id: DummyContextManager(),
    )
    monkeypatch.setattr(
        "codedmap.app.services.visualize.VisualizeService.build",
        lambda self, *, store, request: VisualizeResponse(nodes=[], edges=[]),
    )

    app = create_app(db_path=":memory:", backend="memory")

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/jobs/job-123/graph/visualize",
            json={"entry_node_ids": ["101"], "lens": "CALL_GRAPH"},
        )

    assert response.status_code == 200
    assert response.json() == {"nodes": [], "edges": []}
```

- [ ] **Step 4: Add regression assertions that global routes still use the primary store**

```python
def test_global_graph_entrypoints_route_keeps_using_primary_store(self, monkeypatch):
    captured = {}

    def _fake_list_entrypoints(**kwargs):
        captured["store"] = kwargs["store"]
        return {"nodes": []}

    monkeypatch.setattr(
        "codedmap.app.services.query_services.list_entrypoints",
        _fake_list_entrypoints,
    )

    app = create_app(db_path=":memory:", backend="memory")

    with TestClient(app) as client:
        response = client.get("/api/v1/graph/entrypoints")

    assert response.status_code == 200
    assert captured["store"] is not None
```

- [ ] **Step 5: Run route tests to verify they fail**

Run: `python3 -m pytest tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py -v`
Expected: FAIL because `/api/v1/jobs/{job_id}/graph/*` routes are not registered yet.

- [ ] **Step 6: Commit**

```bash
git add tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py
git commit -m "test: add failing job-scoped graph route coverage"
```

---

### Task 4: Implement job-scoped graph routes with shared logic

**Files:**
- Modify: `codedmap/api/routers/visualize.py`
- Modify: `codedmap/api/app.py`

- [ ] **Step 1: Extract shared entrypoint and visualize helpers**

```python
def _list_entrypoints_from_store(
    *,
    store,
    level: Optional[str],
    category: Optional[str],
    type: Optional[str],
    limit: int,
    offset: int,
    module: Optional[str],
    module_id: Optional[int],
) -> list[GraphEntrypointSignature]:
    from codedmap.app.services.query_services import list_entrypoints

    data = list_entrypoints(
        store=store,
        level=level,
        category=category,
        entry_type=type,
        file_filter=None,
        module=module,
        module_id=module_id,
        limit=limit,
        offset=offset,
        show_all=False,
    )
    return [_map_graph_entrypoint(item) for item in data["nodes"]]


def _visualize_from_store(*, store, body: VisualizeRequest) -> VisualizeResponse:
    from codedmap.app.services.visualize import VisualizeService

    return VisualizeService().build(store=store, request=body)
```

- [ ] **Step 2: Add job-scoped routes that use `open_job_graph_store()`**

```python
job_router = APIRouter(prefix="/api/v1/jobs", tags=["graph"])


@job_router.get(
    "/{job_id}/graph/entrypoints",
    response_model=list[GraphEntrypointSignature],
    status_code=200,
)
def list_job_graph_entrypoints(
    job_id: str,
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None, description="Entry point type/rule name"),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
) -> list[GraphEntrypointSignature]:
    try:
        with open_job_graph_store(job_id) as store:
            return _list_entrypoints_from_store(
                store=store,
                level=level,
                category=category,
                type=type,
                limit=limit,
                offset=offset,
                module=module,
                module_id=module_id,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch graph entrypoints: {exc}",
        ) from exc


@job_router.post(
    "/{job_id}/graph/visualize",
    response_model=VisualizeResponse,
    status_code=200,
)
async def visualize_job_graph(job_id: str, body: VisualizeRequest) -> VisualizeResponse:
    try:
        with open_job_graph_store(job_id) as store:
            return _visualize_from_store(store=store, body=body)
    except HTTPException:
        raise
    except VisualizeServiceError as exc:
        ...
```

- [ ] **Step 3: Register the job router**

```python
from codedmap.api.routers import knowledge, federation, visualize

app.include_router(visualize.router, **router_kwargs)
app.include_router(visualize.job_router, **router_kwargs)
```

- [ ] **Step 4: Run route tests and make them pass**

Run: `python3 -m pytest tests/api/test_job_graph_store_resolver.py tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add codedmap/api/app.py codedmap/api/routers/visualize.py tests/api/test_job_graph_store_resolver.py tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py
git commit -m "feat: add job-scoped graph API routes"
```

---

### Task 5: Sync `tools/cdm_client.py` and final regression coverage

**Files:**
- Modify: `tools/cdm_client.py`
- Modify: `tests/api/test_build_upload_router.py`

- [ ] **Step 1: Add direct helpers for job-scoped graph routes**

```python
class _GraphDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def entrypoints(self, **params) -> Dict[str, Any]:
        return self._t.get("/api/v1/graph/entrypoints", params or None)

    def visualize(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._t.post("/api/v1/graph/visualize", body)

    def job_entrypoints(self, job_id: str, **params) -> Dict[str, Any]:
        return self._t.get(f"/api/v1/jobs/{job_id}/graph/entrypoints", params or None)

    def job_visualize(self, job_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._t.post(f"/api/v1/jobs/{job_id}/graph/visualize", body)
```

- [ ] **Step 2: Wire the new domain into `CPGClient` and update the usage block**

```python
self.graph = _GraphDomain(self._transport)
```

```python
status = client.build.status(upload["result"]["content"]["job_id"])
graph = client.graph.job_visualize(
    status["result"]["content"]["job_id"],
    {"entry_node_ids": ["101"], "lens": "CALL_GRAPH"},
)
```

- [ ] **Step 3: Add client-sync regression assertions**

```python
def test_cdm_client_syncs_job_graph_surface(self):
    client_source = Path("tools/cdm_client.py").read_text(encoding="utf-8")

    assert "class _GraphDomain" in client_source
    assert '"/api/v1/graph/entrypoints"' in client_source
    assert '"/api/v1/graph/visualize"' in client_source
    assert '"/api/v1/jobs/{job_id}/graph/entrypoints"' in client_source
    assert '"/api/v1/jobs/{job_id}/graph/visualize"' in client_source
    assert "self.graph = _GraphDomain" in client_source
```

- [ ] **Step 4: Run the targeted API regression suite**

Run: `python3 -m pytest tests/api/test_job_graph_store_resolver.py tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py tests/api/test_build_upload_router.py -v`
Expected: PASS

- [ ] **Step 5: Run a final focused smoke suite**

Run: `python3 -m pytest tests/app/test_build_jobs.py tests/app/services/test_visualize_service.py tests/api/test_job_graph_store_resolver.py tests/api/test_graph_entrypoints_router.py tests/api/test_visualize_router.py tests/api/test_build_upload_router.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/cdm_client.py tests/api/test_build_upload_router.py
git commit -m "chore: sync client helpers for job-scoped graph routes"
```

---

## Spec Coverage Check

- Separate job-scoped routes: Task 4 adds `/api/v1/jobs/{job_id}/graph/entrypoints` and `/api/v1/jobs/{job_id}/graph/visualize` while preserving global `/api/v1/graph/*`.
- Canonical data source: Task 2 resolves `job.json` via `load_job_record()` and reads `record.result_db` without path inference fallback.
- Read eligibility rules: Task 1 and Task 2 cover missing job, non-completed job, missing `result_db`, and missing file.
- Error semantics: Task 2 maps `404`, `409`, and `503`; Task 4 preserves visualize-specific request errors while avoiding fallback to the global store.
- Thin resolver + business-logic reuse: Task 2 creates `codedmap/api/job_graph.py`; Task 4 reuses shared entrypoint and visualize logic instead of duplicating graph queries.
- Regression goals: Task 3 keeps existing global route behavior explicit; Task 5 runs the focused regression suite.
- Client synchronization requirement: Task 5 updates `tools/cdm_client.py` to match the new API-native surface.

## Self-Review

- Placeholder scan: no `TODO` / `TBD` markers remain.
- Scope check: this plan stays within one subsystem: API read routing for completed upload jobs.
- Type consistency: `job_id` is always path-only for job-scoped routes; request/response bodies remain identical to existing route contracts.

