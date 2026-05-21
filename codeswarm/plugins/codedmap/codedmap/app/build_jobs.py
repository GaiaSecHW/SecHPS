from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from datetime import datetime, UTC
from pathlib import Path

from codedmap.core.schema.build_upload import (
    ArchiveFormat,
    BuildJobPaths,
    BuildJobRecord,
    BuildUploadStatus,
)


def resolve_jobs_root(base_dir: Path | None = None) -> Path:
    if base_dir is None:
        base_dir = Path(__file__).resolve().parents[2]
    return (base_dir / ".codedmap" / "build-jobs").resolve()


def create_job_paths(job_id: str, jobs_root: Path) -> BuildJobPaths:
    job_root = jobs_root / job_id
    archive_dir = job_root / "archive"
    extracted_root = job_root / "extracted"
    workspace_root = job_root / "workspace"
    output_root = job_root / "output"
    logs_dir = job_root / "logs"

    for path in (archive_dir, extracted_root, workspace_root, output_root, logs_dir):
        path.mkdir(parents=True, exist_ok=True)

    return BuildJobPaths(
        job_root=job_root,
        archive_dir=archive_dir,
        archive_path=archive_dir / "source",
        extracted_root=extracted_root,
        workspace_root=workspace_root,
        output_root=output_root,
        output_db=output_root / "graph.db",
        logs_dir=logs_dir,
        stdout_log=logs_dir / "stdout.log",
        stderr_log=logs_dir / "stderr.log",
        job_file=job_root / "job.json",
    )


def _archive_hash_index_dir(jobs_root: Path) -> Path:
    return jobs_root / "_archive-sha256"


def _archive_hash_index_file(archive_sha256: str, jobs_root: Path) -> Path:
    return _archive_hash_index_dir(jobs_root) / f"{archive_sha256}.txt"


def save_job_record(record: BuildJobRecord) -> None:
    record.paths.job_file.parent.mkdir(parents=True, exist_ok=True)
    record.paths.job_file.write_text(record.model_dump_json(indent=2), encoding="utf-8")


def load_job_record(job_file: Path) -> BuildJobRecord:
    return BuildJobRecord.model_validate_json(job_file.read_text(encoding="utf-8"))


def load_job_record_by_id(job_id: str, jobs_root: Path | None = None) -> BuildJobRecord:
    effective_jobs_root = resolve_jobs_root(jobs_root)
    return load_job_record(effective_jobs_root / job_id / "job.json")


def update_job_record(record: BuildJobRecord, **changes: object) -> BuildJobRecord:
    updated_record = record.model_copy(update={**changes, "updated_at": datetime.now(UTC)})
    save_job_record(updated_record)
    return updated_record


def register_archive_hash(record: BuildJobRecord, jobs_root: Path | None = None) -> None:
    if not record.archive_sha256:
        return

    effective_jobs_root = resolve_jobs_root(jobs_root)
    index_file = _archive_hash_index_file(record.archive_sha256, effective_jobs_root)
    index_file.parent.mkdir(parents=True, exist_ok=True)

    existing_job_ids: list[str] = []
    if index_file.exists():
        existing_job_ids = [
            line.strip() for line in index_file.read_text(encoding="utf-8").splitlines() if line.strip()
        ]
        if record.job_id in existing_job_ids:
            return

    existing_job_ids.append(record.job_id)
    index_file.write_text("\n".join(existing_job_ids) + "\n", encoding="utf-8")


def find_latest_job_by_archive_hash(
    archive_sha256: str, jobs_root: Path | None = None
) -> BuildJobRecord | None:
    effective_jobs_root = resolve_jobs_root(jobs_root)
    index_file = _archive_hash_index_file(archive_sha256, effective_jobs_root)
    if index_file.exists():
        job_ids = [
            line.strip() for line in index_file.read_text(encoding="utf-8").splitlines() if line.strip()
        ]
        for job_id in reversed(job_ids):
            job_file = effective_jobs_root / job_id / "job.json"
            if not job_file.exists():
                continue
            return load_job_record(job_file)

    matched_records: list[BuildJobRecord] = []
    for job_file in effective_jobs_root.glob("*/job.json"):
        record = load_job_record(job_file)
        if record.archive_sha256 == archive_sha256:
            matched_records.append(record)

    if matched_records:
        matched_records.sort(key=lambda record: record.created_at)
        return matched_records[-1]
    return None


def remove_job_artifacts(record: BuildJobRecord) -> None:
    if record.paths.job_root.exists():
        shutil.rmtree(record.paths.job_root)


def mark_job_running(record: BuildJobRecord, project_root: str) -> BuildJobRecord:
    return update_job_record(
        record,
        status=BuildUploadStatus.RUNNING,
        project_root=project_root,
        error_summary=None,
        log_excerpt=None,
    )


def mark_job_completed(record: BuildJobRecord, project_root: str) -> BuildJobRecord:
    return update_job_record(
        record,
        status=BuildUploadStatus.COMPLETED,
        project_root=project_root,
        result_db=str(record.paths.output_db),
        error_summary=None,
        log_excerpt=None,
    )


def _read_log_excerpt(stderr_log: Path, fallback: str) -> str:
    if not stderr_log.exists():
        return fallback

    non_empty_lines = [
        line.strip()
        for line in stderr_log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not non_empty_lines:
        return fallback
    return "\n".join(non_empty_lines[-50:])


def mark_job_failed(record: BuildJobRecord, project_root: str, exc: Exception) -> BuildJobRecord:
    return update_job_record(
        record,
        status=BuildUploadStatus.FAILED,
        project_root=project_root,
        result_db=None,
        error_summary=str(exc)[:500],
        log_excerpt=_read_log_excerpt(record.paths.stderr_log, str(exc)),
    )


def launch_build_job(record: BuildJobRecord) -> subprocess.Popen:
    record.paths.stdout_log.parent.mkdir(parents=True, exist_ok=True)
    record.paths.stderr_log.parent.mkdir(parents=True, exist_ok=True)
    repo_root = Path(__file__).resolve().parents[2]

    with record.paths.stdout_log.open("ab") as stdout_handle, record.paths.stderr_log.open(
        "ab"
    ) as stderr_handle:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "codedmap.app.build_worker",
                "--job-file",
                str(record.paths.job_file),
            ],
            stdout=stdout_handle,
            stderr=stderr_handle,
            cwd=str(repo_root),
        )

    update_job_record(record, pid=process.pid)
    return process


def create_queued_job(
    archive_name: str,
    archive_format: ArchiveFormat,
    languages: list[str],
    backend: str,
    archive_sha256: str | None = None,
    use_docker_joern: bool = False,
    jobs_root: Path | None = None,
    job_id: str | None = None,
) -> BuildJobRecord:
    effective_job_id = job_id or str(uuid.uuid4())
    effective_jobs_root = resolve_jobs_root(jobs_root)
    paths = create_job_paths(effective_job_id, effective_jobs_root)
    timestamp = datetime.now(UTC)
    record = BuildJobRecord(
        job_id=effective_job_id,
        status=BuildUploadStatus.QUEUED,
        archive_name=archive_name,
        archive_format=archive_format,
        archive_sha256=archive_sha256,
        use_docker_joern=use_docker_joern,
        languages=languages,
        backend=backend,
        created_at=timestamp,
        updated_at=timestamp,
        pid=None,
        project_root=None,
        result_db=None,
        error_summary=None,
        log_excerpt=None,
        paths=paths,
    )
    save_job_record(record)
    return record
