import logging
import os
import sys
import types

from fastapi.testclient import TestClient

sys.path.append(os.getcwd())

from codedmap.api.app import create_app


def _install_fake_python_multipart():
    multipart_module = types.ModuleType("python_multipart")
    multipart_module.__version__ = "0.0.20"
    sys.modules["python_multipart"] = multipart_module


def test_failed_request_logs_validation_detail(caplog):
    _install_fake_python_multipart()
    app = create_app(db_path=":memory:", backend="memory")

    with caplog.at_level(logging.WARNING, logger="codedmap.api.app"):
        with TestClient(app) as client:
            response = client.post(
                "/note/add?source=agent-ui",
                headers={"X-Agent-ID": "agent-test"},
                json={"title": "Missing content"},
            )

    assert response.status_code == 422
    assert "HTTP request failed" in caplog.text
    assert "POST /note/add" in caplog.text
    assert "status=422" in caplog.text
    assert "detail=" in caplog.text
    assert '"loc":["body","content"]' in caplog.text
    assert '"msg":"Field required"' in caplog.text


def test_successful_request_does_not_log_failure_context(caplog):
    _install_fake_python_multipart()
    app = create_app(db_path=":memory:", backend="memory")

    with caplog.at_level(logging.WARNING, logger="codedmap.api.app"):
        with TestClient(app) as client:
            response = client.get("/")

    assert response.status_code == 200
    assert "HTTP request failed" not in caplog.text
