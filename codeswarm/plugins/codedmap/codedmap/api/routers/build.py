# codedmap/api/routers/build.py
"""
Build domain router: POST /build/start, GET /build/status, POST /build/enhance.

Also exposes the frontend-safe Phase 11 upload/status adapter on /api/v1/build/*.
"""

import asyncio
import hashlib
import threading
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, ConfigDict

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http
from codedmap.app.archive_uploads import detect_archive_format, safe_extract_archive
from codedmap.app.build_jobs import (
    create_queued_job,
    find_latest_job_by_archive_hash,
    launch_build_job,
    load_job_record,
    register_archive_hash,
    remove_job_artifacts,
    resolve_jobs_root,
    update_job_record,
)
from codedmap.core.schema.build_upload import BuildUploadStatus

router = APIRouter(prefix="/build", tags=["build"])
frontend_router = APIRouter(prefix="/api/v1/build", tags=["build"])

# In-memory job registry
_jobs: Dict[str, dict] = {}


class BuildStartBody(BaseModel):
    project_root: str
    languages: List[str] = ["c", "cpp"]
    db: Optional[str] = None
    workspace: Optional[str] = None
    backend: str = "sqlite"
    skip_ingestion: bool = False
    skip_analysis: bool = False
    skip_export: bool = False
    ai: bool = False


class BuildEnhanceBody(BaseModel):
    db: Optional[str] = None
    backend: str = "sqlite"
    passes: Optional[List[str]] = None


class BuildUploadForm(BaseModel):
    languages: list[str] | None = None
    backend: str = "sqlite"


class BuildUploadRequest(BuildUploadForm):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    archive: UploadFile


def parse_build_upload_form(
    archive: UploadFile = File(...),
    languages: list[str] | None = Form(None),
    backend: str = Form("sqlite"),
) -> BuildUploadRequest:
    form = BuildUploadForm(languages=languages, backend=backend)
    return BuildUploadRequest(archive=archive, languages=form.languages, backend=form.backend)


def _run_build_sync(job_id: str, body: BuildStartBody):
    """Run build in a thread. Updates _jobs[job_id] on completion."""
    try:
        from codedmap.app.build import CPGBuildEngine

        # Pass raw args to CPGBuildEngine, which handles all workspace logic
        engine = CPGBuildEngine(
            project_root=body.project_root,
            db=body.db,
            workspace=body.workspace,
            backend=body.backend,
            languages=body.languages,
        )
        if body.ai:
            engine.config.ai.enable_llm = True

        engine.build(
            skip_ingestion=body.skip_ingestion or None,
            skip_analysis=body.skip_analysis or None,
            skip_export=body.skip_export or None,
        )

        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["result"] = {
            "project_root": body.project_root,
            "workspace": str(engine.config.workspace),
            "db": engine.config.storage.uri,
        }
    except Exception as e:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


def _run_enhance_sync(job_id: str, body: BuildEnhanceBody):
    """Run enhance in a thread. Updates _jobs[job_id] on completion."""
    try:
        import os
        from codedmap.app.services.enhance_service import run_enhance

        db = body.db or os.environ.get("CPG_DB", "")
        if not db:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = "No database path provided"
            return

        result = run_enhance(db=db, backend=body.backend, passes=body.passes)
        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["result"] = result
    except Exception as e:
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


@router.post("/start")
async def build_start(body: BuildStartBody):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"job_id": job_id, "status": "running", "result": None, "error": None}

    asyncio.get_event_loop().run_in_executor(None, _run_build_sync, job_id, body)

    response = CLIResponse(
        command="build",
        result={"kind": "object", "content": {"job_id": job_id, "status": "running"}},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/status")
def build_status(job_id: str = Query(...)):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    job = _jobs.get(job_id)
    if job is None:
        response = CLIResponse.error_response("build", "NODE_NOT_FOUND", f"Job '{job_id}' not found")
        return cli_response_to_http(response)

    response = CLIResponse(
        command="build",
        result={"kind": "object", "content": job},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/enhance")
async def build_enhance(body: BuildEnhanceBody):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"job_id": job_id, "status": "running", "result": None, "error": None}

    asyncio.get_event_loop().run_in_executor(None, _run_enhance_sync, job_id, body)

    response = CLIResponse(
        command="build",
        result={"kind": "object", "content": {"job_id": job_id, "status": "running"}},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


def _job_file_for_id(job_id: str, jobs_root: Path | None = None) -> Path:
    effective_jobs_root = resolve_jobs_root() if jobs_root is None else resolve_jobs_root(jobs_root)
    return effective_jobs_root / job_id / "job.json"


def _jobs_base_dir() -> Path:
    jobs_root = resolve_jobs_root()
    if jobs_root.name == "build-jobs" and jobs_root.parent.name == ".codedmap":
        return jobs_root.parent.parent
    return jobs_root.parent


async def _write_upload_archive_with_sha256(upload_file: UploadFile, destination: Path) -> str:
    archive_hasher = hashlib.sha256()
    with destination.open("wb") as handle:
        while chunk := await upload_file.read(1024 * 1024):
            archive_hasher.update(chunk)
            handle.write(chunk)
    return archive_hasher.hexdigest()


@frontend_router.post("/upload")
async def build_upload(
    upload: BuildUploadRequest = Depends(parse_build_upload_form),
    lock=Depends(get_store_lock),
    agent_id: str = Depends(require_agent_id),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    del agent_id

    archive_name = upload.archive.filename or "upload.zip"
    languages = upload.languages or ["c", "cpp"]
    record = None

    try:
        archive_format = detect_archive_format(archive_name)
    except ValueError as exc:
        return cli_response_to_http(
            CLIResponse.error_response("build", "INVALID_ARGUMENT", str(exc))
        )

    try:
        async with lock:
            record = create_queued_job(
                archive_name=archive_name,
                archive_format=archive_format,
                languages=languages,
                backend=upload.backend,
                use_docker_joern=True,
                jobs_root=_jobs_base_dir(),
            )

            archive_sha256 = await _write_upload_archive_with_sha256(
                upload.archive, record.paths.archive_path
            )
            existing_record = find_latest_job_by_archive_hash(
                archive_sha256, jobs_root=_jobs_base_dir()
            )
            if existing_record is not None and existing_record.job_id != record.job_id:
                if existing_record.status in {
                    BuildUploadStatus.QUEUED,
                    BuildUploadStatus.RUNNING,
                    BuildUploadStatus.COMPLETED,
                }:
                    remove_job_artifacts(record)
                    response = CLIResponse(
                        command="build",
                        result={
                            "kind": "object",
                            "content": {
                                "job_id": existing_record.job_id,
                                "status": existing_record.status.value,
                            },
                        },
                        metadata=CLIMetadata(total=1),
                        success=True,
                    )
                    return cli_response_to_http(response)

            record = update_job_record(record, archive_sha256=archive_sha256)
            register_archive_hash(record, jobs_root=_jobs_base_dir())

            safe_extract_archive(
                archive_path=record.paths.archive_path,
                extracted_root=record.paths.extracted_root,
                archive_format=archive_format,
            )
            threading.Thread(target=launch_build_job, args=(record,), daemon=True).start()
    except ValueError as exc:
        return cli_response_to_http(
            CLIResponse.error_response(
                "build",
                "INVALID_ARGUMENT",
                f"Unsafe archive rejected: {exc}",
            )
        )
    finally:
        await upload.archive.close()

    response = CLIResponse(
        command="build",
        result={"kind": "object", "content": {"job_id": record.job_id, "status": "queued"}},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@frontend_router.get("/status")
def build_upload_status(job_id: str = Query(...)):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    job_file = _job_file_for_id(job_id)
    if not job_file.exists():
        return cli_response_to_http(
            CLIResponse.error_response("build", "NODE_NOT_FOUND", f"Job '{job_id}' not found")
        )

    record = load_job_record(job_file)
    response = CLIResponse(
        command="build",
        result={
            "kind": "object",
            "content": {
                "job_id": record.job_id,
                "status": record.status,
                "pid": record.pid,
                "result_db": record.result_db,
                "error_summary": record.error_summary,
                "log_excerpt": record.log_excerpt,
            },
        },
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)
