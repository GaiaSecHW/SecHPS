import io
import os
import sys
import time
import zipfile
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.app import create_app
from codedmap.app.build_jobs import create_queued_job, update_job_record
from codedmap.core.schema.build_upload import ArchiveFormat, BuildUploadStatus


def _make_zip_bytes(members: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return buffer.getvalue()


class TestBuildUploadRouter:
    def test_app_registers_build_upload_and_status_routes(self):
        app = create_app(db_path=":memory:", backend="memory")

        routes = {(route.path, tuple(route.methods)) for route in app.router.routes}

        assert ("/api/v1/build/upload", ("POST",)) in routes
        assert ("/api/v1/build/status", ("GET",)) in routes

    def test_upload_returns_job_id(self, monkeypatch, tmp_path: Path):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"

        def _fake_launch(record):
            time.sleep(0.2)
            return object()

        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)
        monkeypatch.setattr("codedmap.api.routers.build.launch_build_job", _fake_launch)

        app = create_app(db_path=":memory:", backend="memory")
        archive_bytes = _make_zip_bytes({"project/main.py": "print('ok')\n"})

        started_at = time.monotonic()
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("project.zip", archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )
        elapsed = time.monotonic() - started_at

        assert elapsed < 0.15
        assert response.status_code == 200
        payload = response.json()

        assert payload["success"] is True
        assert payload["command"] == "build"
        assert payload["result"]["kind"] == "object"
        content = payload["result"]["content"]
        assert content["job_id"]
        assert content["status"] == "queued"
        job_file = jobs_root / content["job_id"] / "job.json"
        assert '"use_docker_joern": true' in job_file.read_text(encoding="utf-8")

    def test_upload_rejects_path_traversal_archive(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(
            "codedmap.api.routers.build.resolve_jobs_root",
            lambda: tmp_path / ".codedmap" / "build-jobs",
        )

        app = create_app(db_path=":memory:", backend="memory")
        archive_bytes = _make_zip_bytes({"../escape.py": "print('bad')\n"})

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("unsafe.zip", archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )

        assert response.status_code == 400
        payload = response.json()
        assert payload["success"] is False
        assert payload["error"]["code"] == "INVALID_ARGUMENT"
        assert "unsafe archive" in payload["error"]["message"].lower()

    def test_status_reads_persisted_job_record(self, monkeypatch, tmp_path: Path):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"
        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)

        record = create_queued_job(
            archive_name="project.zip",
            archive_format=ArchiveFormat.ZIP,
            languages=["python"],
            backend="sqlite",
            jobs_root=tmp_path,
            job_id="job-123",
        )
        update_job_record(
            record,
            status=BuildUploadStatus.COMPLETED,
            pid=4321,
            result_db=str(record.paths.output_db),
            error_summary="trimmed error summary",
            log_excerpt="line 1\nline 2",
        )

        app = create_app(db_path=":memory:", backend="memory")

        with TestClient(app) as client:
            response = client.get("/api/v1/build/status", params={"job_id": "job-123"})

        assert response.status_code == 200
        payload = response.json()

        assert payload["success"] is True
        assert payload["command"] == "build"
        assert payload["result"]["kind"] == "object"
        content = payload["result"]["content"]
        assert content["job_id"] == "job-123"
        assert content["status"] == "completed"
        assert content["pid"] == 4321
        assert content["result_db"] == str(record.paths.output_db)
        assert content["error_summary"] == "trimmed error summary"
        assert content["log_excerpt"] == "line 1\nline 2"

    def test_upload_reuses_existing_completed_job_for_identical_archive(
        self, monkeypatch, tmp_path: Path
    ):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"
        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)

        archive_bytes = _make_zip_bytes({"project/main.py": "print('ok')\n"})
        archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
        record = create_queued_job(
            archive_name="project.zip",
            archive_format=ArchiveFormat.ZIP,
            languages=["python"],
            backend="sqlite",
            jobs_root=tmp_path,
            job_id="job-existing",
            archive_sha256=archive_sha256,
        )
        update_job_record(
            record,
            status=BuildUploadStatus.COMPLETED,
            result_db=str(record.paths.output_db),
        )

        monkeypatch.setattr(
            "codedmap.api.routers.build.safe_extract_archive",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("extract should not run")),
        )
        monkeypatch.setattr(
            "codedmap.api.routers.build.launch_build_job",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("launch should not run")),
        )

        app = create_app(db_path=":memory:", backend="memory")
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("project.zip", archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )

        assert response.status_code == 200
        payload = response.json()
        content = payload["result"]["content"]
        assert content["job_id"] == "job-existing"
        assert content["status"] == "completed"

    def test_upload_does_not_reuse_same_filename_with_different_content(
        self, monkeypatch, tmp_path: Path
    ):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"
        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)

        first_archive_bytes = _make_zip_bytes({"project/main.py": "print('old')\n"})
        record = create_queued_job(
            archive_name="project.zip",
            archive_format=ArchiveFormat.ZIP,
            languages=["python"],
            backend="sqlite",
            jobs_root=tmp_path,
            job_id="job-existing",
            archive_sha256=hashlib.sha256(first_archive_bytes).hexdigest(),
        )
        update_job_record(record, status=BuildUploadStatus.COMPLETED)

        launches: list[str] = []

        def _fake_launch(new_record):
            launches.append(new_record.job_id)
            return object()

        monkeypatch.setattr("codedmap.api.routers.build.launch_build_job", _fake_launch)

        app = create_app(db_path=":memory:", backend="memory")
        second_archive_bytes = _make_zip_bytes({"project/main.py": "print('new')\n"})
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("project.zip", second_archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )

        assert response.status_code == 200
        payload = response.json()
        content = payload["result"]["content"]
        assert content["job_id"] != "job-existing"
        assert content["status"] == "queued"
        assert launches == [content["job_id"]]

    def test_upload_reuses_existing_running_job_for_identical_archive(
        self, monkeypatch, tmp_path: Path
    ):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"
        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)

        archive_bytes = _make_zip_bytes({"project/main.py": "print('ok')\n"})
        record = create_queued_job(
            archive_name="project.zip",
            archive_format=ArchiveFormat.ZIP,
            languages=["python"],
            backend="sqlite",
            jobs_root=tmp_path,
            job_id="job-running",
            archive_sha256=hashlib.sha256(archive_bytes).hexdigest(),
        )
        update_job_record(record, status=BuildUploadStatus.RUNNING, pid=4321)

        monkeypatch.setattr(
            "codedmap.api.routers.build.safe_extract_archive",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("extract should not run")),
        )
        monkeypatch.setattr(
            "codedmap.api.routers.build.launch_build_job",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("launch should not run")),
        )

        app = create_app(db_path=":memory:", backend="memory")
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("project.zip", archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )

        assert response.status_code == 200
        content = response.json()["result"]["content"]
        assert content["job_id"] == "job-running"
        assert content["status"] == "running"

    def test_upload_creates_new_job_when_matching_archive_only_failed_before(
        self, monkeypatch, tmp_path: Path
    ):
        jobs_root = tmp_path / ".codedmap" / "build-jobs"
        monkeypatch.setattr("codedmap.api.routers.build.resolve_jobs_root", lambda: jobs_root)

        archive_bytes = _make_zip_bytes({"project/main.py": "print('ok')\n"})
        record = create_queued_job(
            archive_name="project.zip",
            archive_format=ArchiveFormat.ZIP,
            languages=["python"],
            backend="sqlite",
            jobs_root=tmp_path,
            job_id="job-failed",
            archive_sha256=hashlib.sha256(archive_bytes).hexdigest(),
        )
        update_job_record(record, status=BuildUploadStatus.FAILED, error_summary="boom")

        launches: list[str] = []

        def _fake_launch(new_record):
            launches.append(new_record.job_id)
            return object()

        monkeypatch.setattr("codedmap.api.routers.build.launch_build_job", _fake_launch)

        app = create_app(db_path=":memory:", backend="memory")
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/build/upload",
                headers={"X-Agent-ID": "frontend-test"},
                files={"archive": ("project.zip", archive_bytes, "application/zip")},
                data={"languages": ["python"], "backend": "sqlite"},
            )

        assert response.status_code == 200
        content = response.json()["result"]["content"]
        assert content["job_id"] != "job-failed"
        assert content["status"] == "queued"
        assert launches == [content["job_id"]]

    def test_router_uses_top_level_multipart_adapter(self):
        router_source = Path("codedmap/api/routers/build.py").read_text(encoding="utf-8")

        assert "class BuildUploadForm" in router_source
        assert "def parse_build_upload_form(" in router_source
        assert "Depends(parse_build_upload_form)" in router_source

    def test_cdm_client_syncs_build_upload_surface(self):
        client_source = Path("tools/cdm_client.py").read_text(encoding="utf-8")

        assert "def upload(" in client_source
        assert '"/api/v1/build/upload"' in client_source
        assert "def status(" in client_source
        assert '"/api/v1/build/status"' in client_source

    def test_cdm_client_syncs_graph_helper_surface(self):
        client_source = Path("tools/cdm_client.py").read_text(encoding="utf-8")

        assert "class _GraphDomain" in client_source
        assert "self.graph = _GraphDomain(self._transport)" in client_source
        assert "def entrypoints(" in client_source
        assert 'return self._t.get("/api/v1/graph/entrypoints", params or None)' in client_source
        assert "def visualize(" in client_source
        assert '"/api/v1/graph/visualize"' in client_source
        assert "def job_entrypoints(" in client_source
        assert 'return self._t.get(f"/api/v1/jobs/{job_id}/graph/entrypoints", params or None)' in client_source
        assert "def job_visualize(" in client_source
        assert 'f"/api/v1/jobs/{job_id}/graph/visualize"' in client_source
