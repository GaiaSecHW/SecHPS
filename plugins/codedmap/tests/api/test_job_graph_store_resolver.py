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
    custom_result_db = tmp_path / "shared-results" / f"{job_id}.db"
    custom_result_db.parent.mkdir(parents=True, exist_ok=True)
    custom_result_db.write_text("not-a-real-db", encoding="utf-8")
    return update_job_record(
        record,
        status=BuildUploadStatus.COMPLETED,
        result_db=str(custom_result_db),
    )


def test_resolve_job_graph_path_reads_result_db_from_job_record(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = _make_completed_record(tmp_path)

    resolved = resolve_job_graph_db_path(record.job_id, jobs_root=tmp_path)

    assert resolved == Path(record.result_db)
    assert resolved != record.paths.output_db


def test_resolve_job_graph_path_accepts_actual_jobs_root(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path
    from codedmap.app.build_jobs import resolve_jobs_root

    record = _make_completed_record(tmp_path, job_id="job-actual-jobs-root")
    jobs_root = resolve_jobs_root(tmp_path)

    resolved = resolve_job_graph_db_path(record.job_id, jobs_root=jobs_root)

    assert resolved == Path(record.result_db)


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


def test_resolve_job_graph_path_raises_409_when_result_db_missing_from_record(
    tmp_path: Path,
):
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


def test_resolve_job_graph_path_raises_404_when_result_db_file_missing(
    tmp_path: Path,
):
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


def test_resolve_job_graph_path_raises_503_when_job_record_is_unreadable(tmp_path: Path):
    from codedmap.api.job_graph import resolve_job_graph_db_path

    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-corrupt-record",
    )
    record.paths.job_file.write_text("{not-json", encoding="utf-8")

    with pytest.raises(HTTPException) as excinfo:
        resolve_job_graph_db_path("job-corrupt-record", jobs_root=tmp_path)

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail.startswith("Failed to read job record for job 'job-corrupt-record': ")


def test_open_job_graph_store_raises_503_when_store_open_fails(tmp_path: Path, monkeypatch):
    from codedmap.api.job_graph import open_job_graph_store
    from codedmap.app.build_jobs import resolve_jobs_root

    record = _make_completed_record(tmp_path, job_id="job-open-fails")

    class FailingStore:
        def __init__(self, *_args, **_kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr("codedmap.api.job_graph.resolve_jobs_root", lambda base_dir=None: resolve_jobs_root(tmp_path))
    monkeypatch.setattr("codedmap.api.job_graph.CPGStore", FailingStore)

    with pytest.raises(HTTPException) as excinfo:
        with open_job_graph_store(record.job_id):
            pass

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail == "Failed to open graph store for job 'job-open-fails': boom"


def test_open_job_graph_store_uses_sqlite_backend_for_persisted_result_db(
    tmp_path: Path, monkeypatch
):
    from codedmap.api.job_graph import open_job_graph_store
    from codedmap.app.build_jobs import resolve_jobs_root

    record = create_queued_job(
        archive_name="project.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="memory",
        jobs_root=tmp_path,
        job_id="job-memory-backend",
    )
    result_db = tmp_path / "shared-results" / "job-memory-backend.db"
    result_db.parent.mkdir(parents=True, exist_ok=True)
    result_db.write_text("not-a-real-db", encoding="utf-8")
    update_job_record(
        record,
        status=BuildUploadStatus.COMPLETED,
        result_db=str(result_db),
    )

    captured = {}

    class CapturingStore:
        def __init__(self, config):
            captured["backend"] = config.backend
            captured["uri"] = config.uri

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            return None

    monkeypatch.setattr(
        "codedmap.api.job_graph.resolve_jobs_root",
        lambda base_dir=None: resolve_jobs_root(tmp_path),
    )
    monkeypatch.setattr("codedmap.api.job_graph.CPGStore", CapturingStore)

    with open_job_graph_store("job-memory-backend") as store:
        assert isinstance(store, CapturingStore)

    assert captured == {"backend": "sqlite", "uri": str(result_db)}


def test_open_job_graph_store_does_not_rewrite_exceptions_from_with_body(
    tmp_path: Path, monkeypatch
):
    from codedmap.api.job_graph import open_job_graph_store
    from codedmap.app.build_jobs import resolve_jobs_root

    record = _make_completed_record(tmp_path, job_id="job-body-error")

    class PassthroughStore:
        def __init__(self, _config):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            return None

    monkeypatch.setattr(
        "codedmap.api.job_graph.resolve_jobs_root",
        lambda base_dir=None: resolve_jobs_root(tmp_path),
    )
    monkeypatch.setattr("codedmap.api.job_graph.CPGStore", PassthroughStore)

    with pytest.raises(RuntimeError, match="sentinel body failure") as excinfo:
        with open_job_graph_store(record.job_id):
            raise RuntimeError("sentinel body failure")

    assert str(excinfo.value) == "sentinel body failure"


def test_open_job_graph_store_closes_on_base_exception_from_with_body(
    tmp_path: Path, monkeypatch
):
    from codedmap.api.job_graph import open_job_graph_store
    from codedmap.app.build_jobs import resolve_jobs_root

    record = _make_completed_record(tmp_path, job_id="job-base-exception")
    observed = {}

    class SentinelBaseException(BaseException):
        pass

    class TrackingStore:
        def __init__(self, _config):
            pass

        def __enter__(self):
            observed["entered"] = True
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            observed["exit_type"] = exc_type
            observed["exit_value"] = exc_val
            return None

    monkeypatch.setattr(
        "codedmap.api.job_graph.resolve_jobs_root",
        lambda base_dir=None: resolve_jobs_root(tmp_path),
    )
    monkeypatch.setattr("codedmap.api.job_graph.CPGStore", TrackingStore)

    with pytest.raises(SentinelBaseException) as excinfo:
        with open_job_graph_store(record.job_id):
            raise SentinelBaseException("cancelled")

    assert str(excinfo.value) == "cancelled"
    assert observed["entered"] is True
    assert observed["exit_type"] is SentinelBaseException
    assert observed["exit_value"] is excinfo.value
