from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from codedmap.app.archive_uploads import resolve_extracted_project_root
from codedmap.app.build_jobs import (
    load_job_record,
    mark_job_completed,
    mark_job_failed,
    mark_job_running,
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _build_map_script() -> Path:
    return _repo_root() / "tools" / "build_map.py"


def _build_map_command(project_root: str, workspace: str, db: str, backend: str) -> list[str]:
    return [
        "python3",
        str(_build_map_script()),
        project_root,
        "--workspace",
        workspace,
        "--db",
        db,
        "--backend",
        backend,
    ]


def _job_build_command(record, project_root: str) -> list[str]:
    cmd = _build_map_command(
        project_root=project_root,
        workspace=str(record.paths.workspace_root),
        db=str(record.paths.output_db),
        backend=record.backend,
    )
    if record.use_docker_joern:
        cmd.append("--docker")
    return cmd


def run_job_file(job_file: Path) -> None:
    record = load_job_record(job_file)
    project_root = resolve_extracted_project_root(record.paths.extracted_root)
    project_root_str = str(project_root)
    running_record = mark_job_running(record, project_root=project_root_str)

    try:
        subprocess.run(
            _job_build_command(running_record, project_root=project_root_str),
            check=True,
            cwd=str(_repo_root()),
        )
    except Exception as exc:
        mark_job_failed(running_record, project_root=project_root_str, exc=exc)
        raise

    mark_job_completed(running_record, project_root=project_root_str)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one persisted CodeDMap build job.")
    parser.add_argument("--job-file", required=True, type=Path)
    args = parser.parse_args(argv)

    try:
        run_job_file(args.job_file)
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
