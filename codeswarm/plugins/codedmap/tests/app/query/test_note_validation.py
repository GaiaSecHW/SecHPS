"""
Tests for note_validation.py — strict category-scoped JSON schema validation.

TDD RED phase: all tests expected to fail until Task 1 implements the validator.
"""
import json
import sys
import os
import pytest

sys.path.append(os.getcwd())


# ---------------------------------------------------------------------------
# Helpers — minimal valid payloads for each strict category
# ---------------------------------------------------------------------------

VALID_VULNERABILITY = json.dumps({
    "schema_version": "1.0",
    "vuln_type": "CWE-362: Race Condition",
    "severity": "HIGH",
    "root_cause": "State machine transitions to AUTH on error path",
    "prerequisites": "Requires an unprivileged account with network access",
    "exploit_sequence": ["Send malformed packet", "Trigger error handler", "Race AUTH state"],
    "impact": "Privilege Escalation to Admin",
})

VALID_COORDINATION = json.dumps({
    "schema_version": "1.0",
    "status": "TODO",
    "owner": "hunter-01",
    "message": "Investigate taint flow from recv() to memcpy()",
    "target_nodes": [{"node_id": 42, "target_type": "TRUST_BOUNDARY", "reason": "crosses user boundary"}],
    "metrics": None,
})

VALID_SECURITY_BOUNDARY = json.dumps({
    "schema_version": "1.0",
    "boundary_type": "NETWORK",
    "trust_transition": "Untrusted public internet -> Trusted internal VPC",
    "untrusted_inputs": ["HTTP Headers", "JSON Payload"],
    "entry_node_ids": [100, 101],
    "linked_sink_ids": [200],
    "required_guards": ["JWT Auth", "Input Validation"],
    "observed_guards": ["None"],
    "exploit_hypotheses": ["SQLi via JSON payload"],
    "status": "TODO",
    "owner": "surveyor",
})


# ---------------------------------------------------------------------------
# Success tests
# ---------------------------------------------------------------------------

def test_validate_vulnerability_content_success():
    """Valid VULNERABILITY JSON is validated and returned as canonical JSON string."""
    from codedmap.app.query.note_validation import validate_and_canonicalize_note_content
    result = validate_and_canonicalize_note_content("VULNERABILITY", VALID_VULNERABILITY)
    parsed = json.loads(result)
    assert parsed["vuln_type"] == "CWE-362: Race Condition"
    assert parsed["severity"] == "HIGH"


def test_validate_coordination_content_success():
    """Valid COORDINATION JSON is validated and returned as canonical JSON string."""
    from codedmap.app.query.note_validation import validate_and_canonicalize_note_content
    result = validate_and_canonicalize_note_content("COORDINATION", VALID_COORDINATION)
    parsed = json.loads(result)
    assert parsed["status"] == "TODO"
    assert parsed["owner"] == "hunter-01"


def test_validate_security_boundary_content_success():
    """Valid SECURITY_BOUNDARY JSON is validated and returned as canonical JSON string."""
    from codedmap.app.query.note_validation import validate_and_canonicalize_note_content
    result = validate_and_canonicalize_note_content("SECURITY_BOUNDARY", VALID_SECURITY_BOUNDARY)
    parsed = json.loads(result)
    assert parsed["boundary_type"] == "NETWORK"
    assert "entry_node_ids" in parsed
    assert "linked_sink_ids" in parsed


def test_validate_non_strict_category_passthrough():
    """Non-strict categories (ARCHITECTURE, DATA_FLOW, CONTROL_FLOW) pass through unchanged."""
    from codedmap.app.query.note_validation import validate_and_canonicalize_note_content
    raw = "This is a free-form architecture note with no JSON structure."
    for category in ["ARCHITECTURE", "DATA_FLOW", "CONTROL_FLOW"]:
        result = validate_and_canonicalize_note_content(category, raw)
        assert result == raw, f"Expected passthrough for {category}, got modified content"


# ---------------------------------------------------------------------------
# Failure / error tests
# ---------------------------------------------------------------------------

def test_validate_vulnerability_missing_required_field_returns_schema_error():
    """Missing required field in VULNERABILITY content raises NoteSchemaValidationError."""
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
    )
    # Missing 'impact' field
    bad_payload = json.dumps({
        "schema_version": "1.0",
        "vuln_type": "CWE-120: Buffer Overflow",
        "severity": "CRITICAL",
        "root_cause": "no bounds check",
        "prerequisites": "none",
        "exploit_sequence": ["send large packet"],
        # 'impact' intentionally missing
    })
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("VULNERABILITY", bad_payload)
    error = exc_info.value
    assert error.code == "SCHEMA_VALIDATION_ERROR"


def test_validate_vulnerability_vuln_type_must_be_cwe():
    """vuln_type without CWE prefix raises NoteSchemaValidationError."""
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
    )
    bad_payload = json.dumps({
        "schema_version": "1.0",
        "vuln_type": "Buffer Overflow",  # missing CWE- prefix
        "severity": "HIGH",
        "root_cause": "no bounds check",
        "prerequisites": "none",
        "exploit_sequence": ["send large packet"],
        "impact": "RCE",
    })
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("VULNERABILITY", bad_payload)
    error = exc_info.value
    assert error.code == "SCHEMA_VALIDATION_ERROR"
    # Verify the error points to vuln_type field
    vuln_type_errors = [
        e for e in error.details["validation_errors"]
        if "vuln_type" in e["loc"]
    ]
    assert len(vuln_type_errors) > 0


def test_validate_coordination_extra_field_returns_schema_error():
    """Extra field in COORDINATION content raises NoteSchemaValidationError (extra=forbid)."""
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
    )
    bad_payload = json.dumps({
        "schema_version": "1.0",
        "status": "TODO",
        "owner": "agent-01",
        "message": "check sink",
        "extra_field_not_in_schema": "this should fail",  # extra field
    })
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("COORDINATION", bad_payload)
    error = exc_info.value
    assert error.code == "SCHEMA_VALIDATION_ERROR"


def test_validate_security_boundary_missing_required_field_returns_schema_error():
    """Missing required field in SECURITY_BOUNDARY content raises NoteSchemaValidationError."""
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
    )
    # Missing 'trust_transition', 'required_guards', 'observed_guards'
    bad_payload = json.dumps({
        "schema_version": "1.0",
        "boundary_type": "IPC",
        "untrusted_inputs": ["pipe data"],
    })
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("SECURITY_BOUNDARY", bad_payload)
    error = exc_info.value
    assert error.code == "SCHEMA_VALIDATION_ERROR"


def test_schema_error_contains_required_detail_keys():
    """NoteSchemaValidationError.details contains all required keys."""
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
    )
    bad_payload = json.dumps({"schema_version": "1.0"})  # missing all required fields
    with pytest.raises(NoteSchemaValidationError) as exc_info:
        validate_and_canonicalize_note_content("VULNERABILITY", bad_payload)
    error = exc_info.value
    assert error.code == "SCHEMA_VALIDATION_ERROR"
    assert set(error.details.keys()) == {"category", "expected_schema", "validation_errors", "raw_content_excerpt"}
    # validation_errors must be a list with loc/msg/type on each item
    assert isinstance(error.details["validation_errors"], list)
    assert len(error.details["validation_errors"]) > 0
    for ve in error.details["validation_errors"]:
        assert "loc" in ve
        assert "msg" in ve
        assert "type" in ve
    # raw_content_excerpt must be <=200 chars
    assert len(error.details["raw_content_excerpt"]) <= 200
    # category must match
    assert error.details["category"] == "VULNERABILITY"
