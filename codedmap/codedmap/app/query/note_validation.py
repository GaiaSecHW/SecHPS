# codedmap/app/query/note_validation.py
"""
Shared typed-note validation contract for CLI, API, and DSL write paths.

Enforces strict category-scoped JSON schemas for VULNERABILITY, COORDINATION,
and SECURITY_BOUNDARY notes. Non-strict categories pass through unchanged.

Usage:
    from codedmap.app.query.note_validation import (
        validate_and_canonicalize_note_content,
        NoteSchemaValidationError,
        STRICT_NOTE_SCHEMAS,
    )

    try:
        canonical = validate_and_canonicalize_note_content("VULNERABILITY", raw_json)
    except NoteSchemaValidationError as e:
        # e.code == "SCHEMA_VALIDATION_ERROR"
        # e.details contains category, expected_schema, validation_errors, raw_content_excerpt
        handle_error(e)
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional, Set, Type, Union

import re

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


# ---------------------------------------------------------------------------
# Schema models for strict categories
# ---------------------------------------------------------------------------

class VulnerabilityNoteContent(BaseModel):
    """Structured content schema for VULNERABILITY notes.

    Enforces strict schema with no extra fields allowed.
    All fields are required except schema_version (defaults to "1.0").
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    schema_version: Literal["1.0"] = Field(
        default="1.0",
        description="Schema version for payload compatibility",
    )
    vuln_type: str = Field(
        ...,
        description=(
            "CWE identifier with optional description, format: 'CWE-<number>' or 'CWE-<number>: <description>' "
            "(e.g., 'CWE-362', 'CWE-122: Heap-based Buffer Overflow')"
        ),
    )

    @field_validator("vuln_type")
    @classmethod
    def vuln_type_must_be_cwe(cls, v: str) -> str:
        if not re.match(r"^CWE-\d+", v):
            raise ValueError(
                f"vuln_type must start with 'CWE-<number>' (got {v!r}). "
                f"Example: 'CWE-122: Heap-based Buffer Overflow'"
            )
        return v
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    root_cause: str = Field(
        ...,
        description=(
            "The fundamental architectural, logical, or memory flaw "
            "(e.g., 'State machine transitions to AUTH on error', "
            "'Missing bounds check on payload_len')"
        ),
    )
    prerequisites: str = Field(
        ...,
        description=(
            "Required system state, configurations, or attacker capabilities prior to exploitation "
            "(e.g., 'Requires an unprivileged account', 'None - Unauthenticated network access')"
        ),
    )
    exploit_sequence: List[str] = Field(
        ...,
        description=(
            "Step-by-step sequence of events, inputs, or API calls required to trigger the flaw. "
            "Crucial for race conditions and logic bugs."
        ),
    )
    impact: str = Field(
        ...,
        description=(
            "The direct security consequence and blast radius "
            "(e.g., 'Remote Code Execution', 'Privilege Escalation to Tenant Admin')"
        ),
    )


class TargetNode(BaseModel):
    """A CPG node targeted for downstream analysis or action."""
    model_config = ConfigDict(strict=True, extra="forbid")

    node_id: int
    target_type: str = Field(
        ...,
        description="Category of the target. Standard types preferred but open for extension.",
        examples=["TRUST_BOUNDARY", "BROKEN_LINK", "UNVERIFIED_SINK", "EXPLOIT_TARGET", "DATA_SOURCE"],
    )
    reason: str = Field(
        ...,
        description="Why this node requires downstream attention or action",
    )


class CoordinationNoteContent(BaseModel):
    """Structured content schema for COORDINATION notes.

    Cross-agent coordination: task handoffs, blockers, telemetry.
    Enforces strict schema with no extra fields allowed.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    schema_version: Literal["1.0"] = Field(
        default="1.0",
        description="Schema version for payload compatibility",
    )
    status: Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]
    owner: str = Field(
        default="UNASSIGNED",
        description=(
            "The specific Agent ID, generic Role Name, or human claiming this task "
            "(e.g., 'surveyor', 'hunter-01', 'patch-agent-beta')"
        ),
    )
    target_nodes: Optional[List[TargetNode]] = Field(
        default=None,
        description=(
            "Specific CPG nodes handed off for downstream analysis, triage, or modification"
        ),
    )
    message: str = Field(
        ...,
        description="Cross-agent coordination message, instructions, or details regarding a blocker",
    )
    metrics: Optional[Dict[str, Union[int, float, str]]] = Field(
        default=None,
        description=(
            "Optional telemetry, task execution metrics, latency, or confidence scores"
        ),
    )


class SecurityBoundaryNoteContent(BaseModel):
    """Structured content schema for SECURITY_BOUNDARY notes.

    Documents trust boundaries in the code graph for multi-agent security analysis.
    Enforces strict schema with no extra fields allowed.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    schema_version: Literal["1.0"] = Field(
        default="1.0",
        description="Schema version for payload compatibility",
    )
    boundary_type: str = Field(
        ...,
        description="Type of the boundary",
        examples=["NETWORK", "IPC", "FILE_IO", "RPC", "MESSAGE_QUEUE"],
    )
    trust_transition: str = Field(
        ...,
        description=(
            "Explanation of why this is a boundary "
            "(e.g., 'Untrusted public internet -> Trusted internal VPC')"
        ),
    )
    untrusted_inputs: List[str] = Field(
        ...,
        description=(
            "Specific inputs crossing the boundary "
            "(e.g., 'HTTP Headers', 'JSON Payload', 'Deserialized stream')"
        ),
    )
    entry_node_ids: List[int] = Field(
        default_factory=list,
        description="Node IDs where the untrusted data first enters the graph",
    )
    linked_sink_ids: List[int] = Field(
        default_factory=list,
        description=(
            "Node IDs of critical internal sinks reachable directly from this boundary"
        ),
    )
    required_guards: List[str] = Field(
        ...,
        description=(
            "Security controls that SHOULD exist here based on policy "
            "(e.g., 'JWT Auth', 'Input Validation')"
        ),
    )
    observed_guards: List[str] = Field(
        ...,
        description=(
            "Security controls ACTUALLY IDENTIFIED in the code graph "
            "(e.g., 'None', 'Basic Regex Match')"
        ),
    )
    exploit_hypotheses: List[str] = Field(
        default_factory=list,
        description="Potential attack vectors for the Hunter Agent to investigate",
    )
    status: Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] = "TODO"
    owner: str = Field(
        default="UNASSIGNED",
        description="The specific Agent ID or human mapping this boundary",
    )


# ---------------------------------------------------------------------------
# Strict category registry
# ---------------------------------------------------------------------------

STRICT_NOTE_SCHEMAS: Dict[str, Type[BaseModel]] = {
    "VULNERABILITY": VulnerabilityNoteContent,
    "COORDINATION": CoordinationNoteContent,
    "SECURITY_BOUNDARY": SecurityBoundaryNoteContent,
}
"""Registry mapping strict category name strings to their Pydantic validation models."""


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------

class NoteSchemaValidationError(Exception):
    """Raised when a strict-category note fails schema validation.

    Attributes:
        code: Always "SCHEMA_VALIDATION_ERROR".
        message: Human-readable error summary.
        details: Machine-readable detail dict with keys:
            category, expected_schema, validation_errors, raw_content_excerpt
    """

    code: str = "SCHEMA_VALIDATION_ERROR"

    def __init__(self, message: str, details: Dict[str, Any]) -> None:
        super().__init__(message)
        self.code = "SCHEMA_VALIDATION_ERROR"
        self.message = message
        self.details = details


# ---------------------------------------------------------------------------
# Validation entry point
# ---------------------------------------------------------------------------

def validate_and_canonicalize_note_content(
    category: str,
    content: str,
    valid_categories: Optional[Set[str]] = None,
) -> str:
    """Validate and canonicalize note content based on category.

    For strict categories (VULNERABILITY, COORDINATION, SECURITY_BOUNDARY):
        - Parses JSON and validates against the registered Pydantic schema.
        - Returns canonical compact JSON via model_dump_json().
        - Raises NoteSchemaValidationError on validation failure or JSON parse error.

    For non-strict categories:
        - Returns content unchanged.

    Args:
        category: Note category string (case-insensitive).
        content: Raw note content string.
        valid_categories: If provided, validates category is in this set.
            Service layer passes set(registry.get_note_categories()) here.
            When None, skips membership check (useful for unit tests).

    Returns:
        Canonical JSON string for strict categories; original content for non-strict.

    Raises:
        NoteSchemaValidationError: If category is strict and content fails schema validation.
        ValueError: If category is not in valid_categories (when provided).
    """
    norm_category = category.strip().upper()

    if valid_categories is not None and norm_category not in valid_categories:
        raise ValueError(
            f"Invalid note category: {category!r}. "
            f"Valid values: {sorted(valid_categories)}"
        )

    # Check if category requires strict validation
    schema_cls = STRICT_NOTE_SCHEMAS.get(norm_category)
    if schema_cls is None:
        # Non-strict: pass through unchanged
        return content

    # Strict validation
    try:
        model = schema_cls.model_validate_json(content, strict=True)
        return model.model_dump_json()
    except ValidationError as exc:
        raw_excerpt = content[:200]
        validation_errors = [
            {
                "loc": list(err["loc"]),
                "msg": err["msg"],
                "type": err["type"],
            }
            for err in exc.errors()
        ]
        raise NoteSchemaValidationError(
            message=(
                f"Content for category {norm_category!r} failed schema validation: "
                f"{len(validation_errors)} error(s)"
            ),
            details={
                "category": norm_category,
                "expected_schema": schema_cls.model_json_schema(),
                "validation_errors": validation_errors,
                "raw_content_excerpt": raw_excerpt,
            },
        ) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raw_excerpt = content[:200]
        raise NoteSchemaValidationError(
            message=(
                f"Content for category {norm_category!r} is not valid JSON: {exc}"
            ),
            details={
                "category": norm_category,
                "expected_schema": schema_cls.model_json_schema(),
                "validation_errors": [
                    {"loc": [], "msg": str(exc), "type": "json_invalid"}
                ],
                "raw_content_excerpt": raw_excerpt,
            },
        ) from exc
