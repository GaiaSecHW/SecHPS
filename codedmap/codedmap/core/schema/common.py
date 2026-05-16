"""
codedmap/core/schema/common.py

Shared cross-domain address and semantic primitives for the API-first assets replacement.

Centralizes:
  - SemanticSignature: cross-domain node identity without storage-layer IDs
  - GlobalNodeRef: cross-graph federation address
  - validate_graph_uri: strict URI format validation
  - normalize_file_path: consistent POSIX path normalization
  - resolve_semantic_name: FULL_NAME -> NAME -> CODE(truncated) resolution order

These are zero-transport primitives — no FastAPI or CLI imports allowed here.
"""

from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GRAPH_URI_PATTERN = re.compile(r"^[a-zA-Z0-9]+://.+$")
_CODE_TRUNCATE_LENGTH = 64


# ---------------------------------------------------------------------------
# File path normalization
# ---------------------------------------------------------------------------

def normalize_file_path(path: str) -> str:
    """Normalize a file path to POSIX relative form.

    Transformations applied:
    1. Replace backslashes with forward slashes (Windows paths).
    2. Strip any leading slash (absolute -> relative).

    Note: This implementation intentionally does NOT strip workspace-specific
    prefixes (e.g., /home/user/project/) because the normalization is
    path-component-only and must be workspace-agnostic. Callers that know the
    workspace root should strip it before calling this function.
    """
    # Normalize separator
    normalized = path.replace("\\", "/")
    # Drop leading slash to make relative
    normalized = normalized.lstrip("/")
    return normalized


# ---------------------------------------------------------------------------
# Graph URI validation
# ---------------------------------------------------------------------------

def validate_graph_uri(uri: str) -> bool:
    """Validate graph URI format: scheme must be [a-zA-Z0-9]+ followed by ://<non-empty>.

    Valid examples:
      - sqlite://my_graph
      - neo4j://prod-cluster/main
      - memory://test

    Invalid examples:
      - just_a_string          (no scheme separator)
      - sqlite://               (empty path after scheme)
      - my-scheme://graph       (hyphen in scheme name)
    """
    return bool(_GRAPH_URI_PATTERN.match(uri))


# ---------------------------------------------------------------------------
# Semantic name resolution helper
# ---------------------------------------------------------------------------

def resolve_semantic_name(
    *,
    full_name: Optional[str],
    name: Optional[str],
    code: Optional[str],
) -> str:
    """Resolve the canonical name for a node using priority order.

    Resolution order:
      1. FULL_NAME — if present and non-empty
      2. NAME — if present and non-empty
      3. CODE — truncated to _CODE_TRUNCATE_LENGTH characters

    Raises ValueError if all inputs are None or empty strings.
    """
    if full_name:
        return full_name
    if name:
        return name
    if code:
        return code[:_CODE_TRUNCATE_LENGTH]
    raise ValueError(
        "resolve_semantic_name: at least one of full_name, name, or code must be provided"
    )


# ---------------------------------------------------------------------------
# SemanticSignature
# ---------------------------------------------------------------------------

class SemanticSignature(BaseModel):
    """Cross-domain node identity using semantic coordinates only.

    Intentionally excludes node_id to remain decoupled from storage backends.
    Used by matcher, knowledge projection, and federation domains.

    Fields:
      node_label:    CPG node label (e.g., "METHOD", "CALL", "FILE")
      name:          Semantic name (resolved via resolve_semantic_name order)
      file_path:     POSIX-normalized relative file path (no leading slash)
      content_hash:  Optional SHA-256 or similar hash for Tier-1 exact matching
    """

    model_config = ConfigDict(frozen=True)

    node_label: str = Field(..., description="CPG node label, e.g. METHOD, CALL, FILE")
    name: str = Field(..., description="Semantic name of the node")
    file_path: str = Field(..., description="POSIX-relative path to the source file")
    content_hash: Optional[str] = Field(
        default=None, description="Optional content hash for exact-match disambiguation"
    )

    @field_validator("file_path", mode="before")
    @classmethod
    def _normalize_file_path(cls, v: str) -> str:
        if not isinstance(v, str):
            raise ValueError("file_path must be a string")
        return normalize_file_path(v)


# ---------------------------------------------------------------------------
# GlobalNodeRef
# ---------------------------------------------------------------------------

class GlobalNodeRef(BaseModel):
    """Cross-graph federation address combining a graph URI and a local node ID.

    Used by FederationEngine to address nodes across multiple graph backends.

    Fields:
      graph_uri:  Validated URI in the form  scheme://path  (e.g., sqlite://prod.db)
      node_id:    Local integer node ID within that graph
    """

    model_config = ConfigDict(frozen=True)

    graph_uri: str = Field(
        ...,
        description="URI identifying the target graph: scheme://path",
    )
    node_id: int = Field(..., description="Local node ID within the target graph")

    @field_validator("graph_uri", mode="before")
    @classmethod
    def _validate_graph_uri(cls, v: str) -> str:
        if not isinstance(v, str) or not validate_graph_uri(v):
            raise ValueError(
                f"graph_uri must match pattern [a-zA-Z0-9]+://<non-empty>; got: {v!r}"
            )
        return v
