from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from codedmap.app.build_jobs import load_job_record, resolve_jobs_root
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.build_upload import BuildJobRecord, BuildUploadStatus
from codedmap.infra.storage.store import CPGStore


def _job_file_for_id(job_id: str, jobs_root: Path | None = None) -> Path:
    if jobs_root is None:
        effective_jobs_root = resolve_jobs_root()
    else:
        candidate_jobs_root = Path(jobs_root)
        effective_jobs_root = (
            candidate_jobs_root
            if candidate_jobs_root.name == "build-jobs"
            else resolve_jobs_root(candidate_jobs_root)
        )
    return effective_jobs_root / job_id / "job.json"


def _load_job_record_for_graph(job_id: str, jobs_root: Path | None = None) -> BuildJobRecord:
    job_file = _job_file_for_id(job_id, jobs_root=jobs_root)
    if not job_file.exists():
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    try:
        return load_job_record(job_file)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to read job record for job '{job_id}': {exc}",
        ) from exc


def resolve_job_graph_db_path(job_id: str, jobs_root: Path | None = None) -> Path:
    record = _load_job_record_for_graph(job_id, jobs_root=jobs_root)

    if record.status != BuildUploadStatus.COMPLETED:
        raise HTTPException(status_code=409, detail=f"Job '{job_id}' is not completed")

    if not record.result_db:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' has no readable result database yet",
        )

    result_db_path = Path(record.result_db)
    if not result_db_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Result database for job '{job_id}' was not found",
        )

    return result_db_path


@contextmanager
def open_job_graph_store(job_id: str):
    db_path = resolve_job_graph_db_path(job_id)

    try:
        store_context = CPGStore(StorageConfig(backend="sqlite", uri=str(db_path)))
        store = store_context.__enter__()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to open graph store for job '{job_id}': {exc}",
        ) from exc

    try:
        yield store
    except BaseException as exc:
        suppress_exception = store_context.__exit__(type(exc), exc, exc.__traceback__)
        if not suppress_exception:
            raise
    else:
        store_context.__exit__(None, None, None)
