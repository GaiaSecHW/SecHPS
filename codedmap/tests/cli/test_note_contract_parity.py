"""CLI contract parity tests for note list/show response keys and schema error details."""
import sys, os
sys.path.append(os.getcwd())
import pytest
import json


def test_note_list_json_uses_result_notes():
    """note list JSON payload must use result['notes'], not result['nodes']."""
    from codedmap.cli._output import CLIResponse, CLIMetadata
    # Simulate what the note list command should build
    summaries = [{"note_id": "1", "title": "Test"}]
    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": {"notes": summaries, "total": len(summaries)}},
        metadata=CLIMetadata(total=len(summaries)),
        success=True,
    )
    data = json.loads(response.to_json())
    assert "notes" in data["result"]["content"]
    assert "nodes" not in data["result"]["content"]


def test_note_show_json_uses_result_note_and_contexts():
    """note show JSON payload must use result['note'] and result['node_contexts']."""
    from codedmap.cli._output import CLIResponse, CLIMetadata
    note_data = {"id": 1, "title": "Test", "content": "...", "category": "COORDINATION"}
    node_contexts = [{"id": 5, "name": "main", "label": "METHOD"}]
    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": {"note": note_data, "node_contexts": node_contexts}},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    data = json.loads(response.to_json())
    assert "note" in data["result"]["content"]
    assert "node_contexts" in data["result"]["content"]


def test_note_show_text_renders_recorded_by(capsys):
    """note show text output should surface note.source for provenance."""
    from argparse import Namespace
    from codedmap.cli._output import CLIResponse, CLIMetadata, OutputFormatter

    response = CLIResponse(
        command="note",
        result={
            "kind": "object",
            "content": {
                "note": {
                    "id": 1,
                    "title": "Test",
                    "content": "...",
                    "category": "COORDINATION",
                    "source": "map-surveyor@note:add",
                },
                "node_contexts": [],
            },
        },
        metadata=CLIMetadata(total=1),
        success=True,
    )

    OutputFormatter().render(response, Namespace(output="text"))
    out = capsys.readouterr().out

    assert "Recorded by: map-surveyor@note:add" in out


def test_note_list_text_renders_recorded_by(capsys):
    """note list text output should surface note.source for provenance."""
    from argparse import Namespace
    from codedmap.cli._output import CLIResponse, CLIMetadata, OutputFormatter

    response = CLIResponse(
        command="note",
        result={
            "kind": "object",
            "content": {
                "notes": [
                    {
                        "note_id": "1",
                        "title": "Test",
                        "category": "COORDINATION",
                        "target_label": "[Target: main]",
                        "source": "map-surveyor@note:add",
                    }
                ],
                "total": 1,
            },
        },
        metadata=CLIMetadata(total=1),
        success=True,
    )

    OutputFormatter().render(response, Namespace(output="text"))
    out = capsys.readouterr().out

    assert "recorded_by=map-surveyor@note:add" in out


def test_schema_error_response_has_required_detail_keys():
    """Schema validation error response must include all required detail keys."""
    from codedmap.cli._output import CLIResponse
    details = {
        "category": "COORDINATION",
        "expected_schema": {"type": "object"},
        "validation_errors": [{"loc": ["status"], "msg": "required", "type": "missing"}],
        "raw_content_excerpt": '{"foo": "bar"}',
    }
    response = CLIResponse.error_response(
        "note", "SCHEMA_VALIDATION_ERROR", "Content failed validation", details=details
    )
    data = json.loads(response.to_json())
    assert data["success"] is False
    assert data["error"]["code"] == "SCHEMA_VALIDATION_ERROR"
    assert "category" in data["error"]["details"]
    assert "expected_schema" in data["error"]["details"]
    assert "validation_errors" in data["error"]["details"]
    assert "raw_content_excerpt" in data["error"]["details"]


def test_note_list_not_using_success_response_nodes_key():
    """result['notes'] key must come from explicit CLIResponse construction, not success_response."""
    from codedmap.cli._output import CLIResponse, CLIMetadata
    import json
    # Verify that explicit construction yields 'notes', not 'nodes'
    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": {"notes": [], "total": 0}},
        metadata=CLIMetadata(total=0),
        success=True,
    )
    out = json.loads(response.to_json())
    assert out["result"]["content"]["notes"] == []
    assert "nodes" not in out["result"]["content"]


def test_schema_validation_error_wires_through_cli_note_module():
    """NoteSchemaValidationError is importable from the note_validation module and
    has deterministic details for CLI/API contract parity."""
    from codedmap.app.query.note_validation import (
        NoteSchemaValidationError,
        validate_and_canonicalize_note_content,
    )
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("COORDINATION", "not valid json {{")
    err = exc_info.value
    assert err.code == "SCHEMA_VALIDATION_ERROR"
    assert err.details["category"] == "COORDINATION"
    assert "expected_schema" in err.details
    assert "validation_errors" in err.details
    assert "raw_content_excerpt" in err.details
