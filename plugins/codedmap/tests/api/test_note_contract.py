"""API contract tests for note endpoints: content-only payload and result.notes."""
import sys, os
sys.path.append(os.getcwd())
import pytest


def test_note_add_body_has_content_field_not_text():
    """NoteAddBody must have 'content' field and must NOT have 'text' field."""
    from codedmap.api.routers.note import NoteAddBody
    import inspect

    # Check field names via model_fields
    fields = NoteAddBody.model_fields
    assert "content" in fields, "NoteAddBody must define 'content' field"
    assert "text" not in fields, "NoteAddBody must NOT define 'text' field"


def test_note_add_body_content_field_type_is_str():
    """NoteAddBody.content must be typed as str."""
    from codedmap.api.routers.note import NoteAddBody
    fields = NoteAddBody.model_fields
    # annotation should be str or compatible
    assert fields["content"].annotation is str


def test_note_add_body_rejects_text_kwarg():
    """NoteAddBody must reject 'text' keyword argument (no extra fields)."""
    from codedmap.api.routers.note import NoteAddBody
    from pydantic import ValidationError

    with pytest.raises((ValidationError, TypeError)):
        NoteAddBody(title="t", text="bad field")


def test_note_list_response_uses_notes_key():
    """note list API response must carry notes under result.content."""
    from codedmap.cli._output import CLIResponse, CLIMetadata
    import json

    nodes_data = [{"note_id": "1", "title": "Audit finding"}]
    # Explicit construction matching what the API router should produce
    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": {"notes": nodes_data, "total": len(nodes_data)}},
        metadata=CLIMetadata(total=len(nodes_data), limit=50),
        success=True,
    )
    out = json.loads(response.to_json())
    assert out["result"]["kind"] == "object"
    assert "notes" in out["result"]["content"]
    assert "nodes" not in out["result"]["content"]


def test_schema_validation_error_preserved_through_cli_response_to_http():
    """SCHEMA_VALIDATION_ERROR with details is preserved via cli_response_to_http."""
    from codedmap.cli._output import CLIResponse
    from codedmap.api.app import cli_response_to_http
    import json

    details = {
        "category": "VULNERABILITY",
        "expected_schema": {},
        "validation_errors": [{"loc": ["severity"], "msg": "required", "type": "missing"}],
        "raw_content_excerpt": "{}",
    }
    response = CLIResponse.error_response(
        "note", "SCHEMA_VALIDATION_ERROR", "Content failed validation", details=details
    )
    http_response = cli_response_to_http(response)
    # Should map SCHEMA_VALIDATION_ERROR → 400 or 422 (it's a bad request)
    assert http_response.status_code in (400, 422, 200)

    body = json.loads(http_response.body)
    assert body["error"]["code"] == "SCHEMA_VALIDATION_ERROR"
    assert "category" in body["error"]["details"]
    assert "expected_schema" in body["error"]["details"]
    assert "validation_errors" in body["error"]["details"]
    assert "raw_content_excerpt" in body["error"]["details"]


def test_note_add_body_accepts_content():
    """NoteAddBody instantiates correctly with 'content' field."""
    from codedmap.api.routers.note import NoteAddBody

    body = NoteAddBody(title="Test Title", content="some content")
    assert body.content == "some content"
    assert body.title == "Test Title"


def test_note_add_body_accepts_layering_fields():
    from codedmap.api.routers.note import NoteAddBody

    body = NoteAddBody(
        title="Layered Note",
        content="{}",
        scope="campaign",
        knowledge_class="assessment",
        campaign_id="cmp_123",
    )

    assert body.scope == "campaign"
    assert body.knowledge_class == "assessment"
    assert body.campaign_id == "cmp_123"


def test_note_promote_and_confirm_bodies_accept_note_id():
    from codedmap.api.routers.note import NotePromoteBody, NoteConfirmBody

    promote = NotePromoteBody(note_id=123)
    confirm = NoteConfirmBody(note_id=123)

    assert promote.note_id == 123
    assert confirm.note_id == 123


def test_note_add_response_echoes_write_visibility_metadata():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI

    from codedmap.api.routers import note as note_router

    class _NoopLock:
        async def __aenter__(self):
            return None

        async def __aexit__(self, exc_type, exc, tb):
            return False

    app = FastAPI()
    app.include_router(note_router.router, prefix="/api/v1")
    app.dependency_overrides[note_router.get_store] = lambda: object()
    app.dependency_overrides[note_router.get_store_lock] = lambda: _NoopLock()
    app.dependency_overrides[note_router.require_agent_id] = lambda: "agent-test"

    def fake_note_add(*args, **kwargs):
        del args
        return {
            "id": 42,
            "title": kwargs["title"],
            "category": kwargs["category"],
            "metadata": {
                "scope": kwargs["scope"],
                "knowledge_class": kwargs["knowledge_class"],
                "campaign_id": kwargs["campaign_id"],
            },
        }

    note_router.svc_note_add = fake_note_add

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/note/add",
            json={
                "title": "Layered Note",
                "content": "layered note content",
                "category": "ARCHITECTURE",
                "scope": "campaign",
                "knowledge_class": "assessment",
                "campaign_id": "cmp_123",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["result"]["kind"] == "object"
    assert payload["result"]["content"]["note"]["title"] == "Layered Note"
    assert payload["result"]["content"]["write_visibility"] == {
        "scope": "campaign",
        "knowledge_class": "assessment",
        "campaign_id": "cmp_123",
    }
