from __future__ import annotations

import subprocess
from types import SimpleNamespace
from pathlib import Path

import pytest

from codedmap.core.schema.build_upload import ArchiveFormat, BuildUploadStatus


def test_create_job_paths_uses_isolated_per_job_tree(tmp_path: Path):
    from codedmap.app.build_jobs import create_job_paths

    jobs_root = tmp_path / "jobs"

    first = create_job_paths("job-1", jobs_root)
    second = create_job_paths("job-2", jobs_root)

    assert first.job_root == jobs_root / "job-1"
    assert first.archive_dir == jobs_root / "job-1" / "archive"
    assert first.archive_path == jobs_root / "job-1" / "archive" / "source"
    assert first.extracted_root == jobs_root / "job-1" / "extracted"
    assert first.workspace_root == jobs_root / "job-1" / "workspace"
    assert first.output_root == jobs_root / "job-1" / "output"
    assert first.output_db == jobs_root / "job-1" / "output" / "graph.db"
    assert first.logs_dir == jobs_root / "job-1" / "logs"
    assert first.stdout_log == jobs_root / "job-1" / "logs" / "stdout.log"
    assert first.stderr_log == jobs_root / "job-1" / "logs" / "stderr.log"
    assert first.job_file == jobs_root / "job-1" / "job.json"
    assert first.job_root != second.job_root
    assert first.archive_dir != second.archive_dir


def test_resolve_jobs_root_uses_server_owned_default():
    from codedmap.app.build_jobs import resolve_jobs_root

    jobs_root = resolve_jobs_root()

    assert jobs_root.name == "build-jobs"
    assert jobs_root.parent.name == ".codedmap"
    assert jobs_root.is_absolute()


def test_create_queued_job_writes_reloadable_job_record(tmp_path: Path):
    from codedmap.app.build_jobs import create_queued_job, load_job_record

    record = create_queued_job(
        archive_name="source.tar.gz",
        archive_format=ArchiveFormat.TAR_GZ,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-queued",
    )

    reloaded = load_job_record(record.paths.job_file)

    assert reloaded.job_id == "job-queued"
    assert reloaded.status == BuildUploadStatus.QUEUED
    assert reloaded.archive_name == "source.tar.gz"
    assert reloaded.archive_format == ArchiveFormat.TAR_GZ
    assert reloaded.use_docker_joern is False
    assert reloaded.paths.output_db == tmp_path / ".codedmap" / "build-jobs" / "job-queued" / "output" / "graph.db"


def test_launch_persists_running_job_metadata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from codedmap.app.build_jobs import create_queued_job, launch_build_job, load_job_record

    record = create_queued_job(
        archive_name="source.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-launch",
    )

    captured: dict[str, object] = {}

    class DummyProcess:
        pid = 43210

    def fake_popen(args, stdout, stderr, cwd):
        captured["args"] = args
        captured["cwd"] = cwd
        captured["stdout_name"] = Path(stdout.name)
        captured["stderr_name"] = Path(stderr.name)
        return DummyProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    launched = launch_build_job(record)
    reloaded = load_job_record(record.paths.job_file)

    assert captured["args"][1] == "-m"
    assert captured["args"][2] == "codedmap.app.build_worker"
    assert captured["args"][3] == "--job-file"
    assert Path(captured["args"][4]) == record.paths.job_file
    assert Path(captured["cwd"]).resolve() == Path.cwd().resolve()
    assert captured["stdout_name"] == record.paths.stdout_log
    assert captured["stderr_name"] == record.paths.stderr_log
    assert launched.pid == 43210
    assert reloaded.pid == 43210
    assert reloaded.status == BuildUploadStatus.QUEUED


def test_job_record_can_be_reloaded_from_disk(tmp_path: Path):
    from codedmap.app.build_jobs import create_queued_job, load_job_record

    record = create_queued_job(
        archive_name="source.tar",
        archive_format=ArchiveFormat.TAR,
        languages=["python", "c"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-reload",
    )

    job_file = record.paths.job_file
    del record

    reloaded = load_job_record(job_file)

    assert reloaded.job_id == "job-reload"
    assert reloaded.status == BuildUploadStatus.QUEUED
    assert reloaded.languages == ["python", "c"]
    assert reloaded.paths.job_file == job_file


def test_run_job_file_marks_completed_and_persists_result_db(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from codedmap.app.build_jobs import create_queued_job, load_job_record
    from codedmap.app import build_worker

    record = create_queued_job(
        archive_name="source.tar.gz",
        archive_format=ArchiveFormat.TAR_GZ,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-success",
    )
    source_root = record.paths.extracted_root / "repo"
    source_root.mkdir(parents=True)

    build_calls: dict[str, object] = {}

    def fake_run(cmd, check, cwd):
        build_calls["cmd"] = cmd
        build_calls["check"] = check
        build_calls["cwd"] = cwd

    monkeypatch.setattr(
        "codedmap.app.build_worker.resolve_extracted_project_root",
        lambda extracted_root: source_root,
    )
    monkeypatch.setattr(build_worker, "subprocess", SimpleNamespace(run=fake_run), raising=False)

    build_worker.run_job_file(record.paths.job_file)
    reloaded = load_job_record(record.paths.job_file)

    cmd = build_calls["cmd"]
    assert cmd[0] == "python3"
    assert Path(cmd[1]).name == "build_map.py"
    assert Path(cmd[1]).parent.name == "tools"
    assert cmd[2] == str(source_root)
    assert "--workspace" in cmd
    assert cmd[cmd.index("--workspace") + 1] == str(record.paths.workspace_root)
    assert "--db" in cmd
    assert cmd[cmd.index("--db") + 1] == str(record.paths.output_db)
    assert "--backend" in cmd
    assert cmd[cmd.index("--backend") + 1] == record.backend
    assert "--docker" not in cmd
    assert "--mode" not in cmd
    assert build_calls["check"] is True
    assert Path(build_calls["cwd"]).resolve() == Path.cwd().resolve()
    assert reloaded.status == BuildUploadStatus.COMPLETED
    assert reloaded.result_db == str(record.paths.output_db)
    assert reloaded.project_root == str(source_root)
    assert reloaded.error_summary is None
    assert reloaded.log_excerpt is None


def test_run_job_file_marks_failed_and_persists_bounded_diagnostics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from codedmap.app.build_jobs import create_queued_job, load_job_record
    from codedmap.app import build_worker

    record = create_queued_job(
        archive_name="source.tar.xz",
        archive_format=ArchiveFormat.TAR_XZ,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-failure",
    )
    source_root = record.paths.extracted_root / "repo"
    source_root.mkdir(parents=True)
    stderr_lines = [f"stderr line {idx}" for idx in range(60)]
    record.paths.stderr_log.write_text("\n".join(stderr_lines), encoding="utf-8")

    monkeypatch.setattr(
        "codedmap.app.build_worker.resolve_extracted_project_root",
        lambda extracted_root: source_root,
    )
    def fake_run(cmd, check, cwd):
        raise RuntimeError("boom-" + ("x" * 600))

    monkeypatch.setattr(build_worker, "subprocess", SimpleNamespace(run=fake_run), raising=False)

    with pytest.raises(RuntimeError):
        build_worker.run_job_file(record.paths.job_file)

    reloaded = load_job_record(record.paths.job_file)

    assert reloaded.status == BuildUploadStatus.FAILED
    assert reloaded.project_root == str(source_root)
    assert reloaded.result_db is None
    assert reloaded.error_summary is not None
    assert len(reloaded.error_summary) == 500
    assert reloaded.error_summary.startswith("boom-")
    assert reloaded.log_excerpt is not None
    excerpt_lines = reloaded.log_excerpt.splitlines()
    assert len(excerpt_lines) == 50
    assert excerpt_lines[0] == "stderr line 10"
    assert excerpt_lines[-1] == "stderr line 59"


def test_run_job_file_uses_docker_joern_when_job_requests_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from codedmap.app.build_jobs import create_queued_job
    from codedmap.app import build_worker

    record = create_queued_job(
        archive_name="source.zip",
        archive_format=ArchiveFormat.ZIP,
        languages=["python"],
        backend="sqlite",
        jobs_root=tmp_path,
        job_id="job-docker-joern",
        use_docker_joern=True,
    )
    source_root = record.paths.extracted_root / "repo"
    source_root.mkdir(parents=True)

    build_calls: dict[str, object] = {}

    def fake_run(cmd, check, cwd):
        build_calls["cmd"] = cmd
        build_calls["check"] = check
        build_calls["cwd"] = cwd

    monkeypatch.setattr(
        "codedmap.app.build_worker.resolve_extracted_project_root",
        lambda extracted_root: source_root,
    )
    monkeypatch.setattr(build_worker, "subprocess", SimpleNamespace(run=fake_run), raising=False)

    build_worker.run_job_file(record.paths.job_file)

    cmd = build_calls["cmd"]
    assert "--docker" in cmd
