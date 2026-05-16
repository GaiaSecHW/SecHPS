"""
codedmap/core/schema/visualize.py

Visualization DTO contract for Phase 08.

This module freezes the frontend/backend visualization API contract and does
not implement traversal semantics. It is a pure schema-layer module with zero
FastAPI, storage, service, or CLI imports.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from codedmap.core.schema.common import SemanticSignature


class GraphLens(str, Enum):
    """Supported visualization expansion lenses."""

    CALL_GRAPH = "CALL_GRAPH"
    DATA_FLOW = "DATA_FLOW"
    CONTROL_FLOW = "CONTROL_FLOW"
    ARCHITECTURE = "ARCHITECTURE"


class GraphEntrypointSignature(BaseModel):
    """Frontend-facing flat entrypoint identity for graph UI bootstrapping."""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    node_label: str
    file_path: str
    full_name: Optional[str] = None


class VisTag(BaseModel):
    """Structured tag overlay for visualization nodes."""

    model_config = ConfigDict(frozen=True)

    name: str
    source: str
    reason: str
    severity: Optional[str] = None


class VisNoteSummary(BaseModel):
    """Lightweight note summary for visualization tooltips and overlays."""

    model_config = ConfigDict(frozen=True)

    type: str
    status: str
    message: str


class VisNode(BaseModel):
    """Visualization node contract."""

    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    node_type: str
    file_path: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    tags: list[VisTag] = Field(default_factory=list)
    notes_summary: list[VisNoteSummary] = Field(default_factory=list)
    is_federation_gateway: bool = False


class VisEdge(BaseModel):
    """Visualization edge contract."""

    model_config = ConfigDict(frozen=True)

    id: str
    source: str
    target: str
    relation: str


class VisualizeRequest(BaseModel):
    """Visualization request contract."""

    model_config = ConfigDict(frozen=True)

    entry_node_ids: list[str] | None = None
    entry_points: list[SemanticSignature] | None = None
    depth: int = Field(default=1, ge=1, le=3)
    lens: GraphLens


class VisualizeResponse(BaseModel):
    """Visualization response contract."""

    model_config = ConfigDict(frozen=True)

    nodes: list[VisNode] = Field(default_factory=list)
    edges: list[VisEdge] = Field(default_factory=list)
