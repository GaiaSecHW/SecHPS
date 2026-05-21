"""
codedmap/core/schema/build_upload.py

Schema contracts for Phase 11 frontend build uploads.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict


class BuildUploadStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ArchiveFormat(str, Enum):
    ZIP = "zip"
    TAR = "tar"
    TAR_GZ = "tar.gz"
    TAR_BZ2 = "tar.bz2"
    TAR_XZ = "tar.xz"


class BuildJobPaths(BaseModel):
    model_config = ConfigDict(frozen=True)

    job_root: Path
    archive_dir: Path
    archive_path: Path
    extracted_root: Path
    workspace_root: Path
    output_root: Path
    output_db: Path
    logs_dir: Path
    stdout_log: Path
    stderr_log: Path
    job_file: Path


class BuildJobRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    job_id: str
    status: BuildUploadStatus
    archive_name: str
    archive_format: ArchiveFormat
    archive_sha256: str | None = None
    use_docker_joern: bool = False
    languages: list[str]
    backend: str
    created_at: datetime
    updated_at: datetime
    pid: int | None = None
    project_root: str | None = None
    result_db: str | None = None
    error_summary: str | None = None
    log_excerpt: str | None = None
    paths: BuildJobPaths
