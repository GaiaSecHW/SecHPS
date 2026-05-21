"""
codedmap/core/schema/federation.py

Federation DTO contracts for the Graph Federation Engine (Phase 06).

Centralizes all federation data types:
  - BoundaryEdgeType: Enum constraining inter-graph relation types
  - GraphManifest:    Registration record for a graph (URI, path, metadata, timestamp)
  - VirtualEdge:      A cross-graph edge linking two GlobalNodeRef addresses
  - VirtualNeighbor:  Query result combining a neighbor address with its full routing envelope

Design constraints:
  - Pure data models — zero FastAPI, CLI, storage, or IO imports allowed here (Layer 0).
  - Uses Pydantic V2 with frozen models.
  - Imports GlobalNodeRef and validate_graph_uri from codedmap.core.schema.common.
  - BoundaryEdgeType members must match EdgeType enum strings in core/schema/graph/enums.py
    (IPC, SYSCALL, RPC, SHARED_DATA) for interoperability.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict

from pydantic import BaseModel, ConfigDict, Field, field_validator

from codedmap.core.schema.common import GlobalNodeRef, validate_graph_uri


# ---------------------------------------------------------------------------
# BoundaryEdgeType
# ---------------------------------------------------------------------------

class BoundaryEdgeType(str, Enum):
    """Relation types allowed on cross-graph virtual edges.

    Members must match the corresponding EdgeType names used in the CPG schema
    for cross-boundary edges (IPC, SYSCALL, RPC, SHARED_DATA).
    """

    IPC = "IPC"
    SYSCALL = "SYSCALL"
    RPC = "RPC"
    SHARED_DATA = "SHARED_DATA"


# ---------------------------------------------------------------------------
# GraphManifest
# ---------------------------------------------------------------------------

class GraphManifest(BaseModel):
    """Registration record for a single CPG graph in the federation registry.

    Each registered graph has a unique URI (addressing scheme), a physical
    storage path, an arbitrary metadata blob, and a registration timestamp.

    Fields:
      graph_uri:      Validated URI identifying this graph (e.g., sqlite://prod.db).
      physical_path:  Filesystem path to the graph's storage file or directory.
      metadata:       Arbitrary key-value metadata (e.g., project name, language).
      registered_at:  UTC timestamp of when this graph was registered.
    """

    model_config = ConfigDict(frozen=True)

    graph_uri: str = Field(
        ...,
        description="URI identifying the graph: scheme://path (e.g., sqlite://prod.db)",
    )
    physical_path: str = Field(
        ...,
        description="Filesystem path to the graph storage file or directory",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary key-value metadata blob for this graph",
    )
    registered_at: datetime = Field(
        ...,
        description="UTC timestamp of when this graph was registered",
    )

    @field_validator("graph_uri", mode="before")
    @classmethod
    def _validate_graph_uri(cls, v: str) -> str:
        if not isinstance(v, str) or not validate_graph_uri(v):
            raise ValueError(
                f"graph_uri must match pattern [a-zA-Z0-9]+://<non-empty>; got: {v!r}"
            )
        return v


# ---------------------------------------------------------------------------
# VirtualEdge
# ---------------------------------------------------------------------------

class VirtualEdge(BaseModel):
    """A cross-graph directed edge linking two GlobalNodeRef addresses.

    VirtualEdge represents an inter-graph relationship stored in the federation
    registry. It does not live in any single CPG graph — it exists exclusively
    in the federation registry (federation.db).

    Fields:
      source:   The source node address (graph_uri + node_id).
      target:   The target node address (graph_uri + node_id).
      relation: The type of cross-graph relationship (BoundaryEdgeType).
      attrs:    Arbitrary edge attributes (e.g., protocol version, port number).
    """

    model_config = ConfigDict(frozen=True)

    source: GlobalNodeRef = Field(
        ...,
        description="Source node address: graph_uri + local node_id",
    )
    target: GlobalNodeRef = Field(
        ...,
        description="Target node address: graph_uri + local node_id",
    )
    relation: BoundaryEdgeType = Field(
        ...,
        description="The type of cross-graph relationship",
    )
    attrs: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary edge attributes (e.g., protocol, port, direction)",
    )


# ---------------------------------------------------------------------------
# VirtualNeighbor
# ---------------------------------------------------------------------------

class VirtualNeighbor(BaseModel):
    """Query result from the federation registry for a node's cross-graph neighbors.

    VirtualNeighbor is the full routing envelope returned when looking up a
    node's virtual neighbors.  It combines the neighbor's address with its
    graph's manifest so callers can immediately route to the correct backend.

    Fields:
      target_node:      The destination node address (GlobalNodeRef).
      relation:         The edge type connecting the queried node to this neighbor.
      edge_attrs:       Attributes from the underlying VirtualEdge.
      target_manifest:  The full GraphManifest of the destination graph — provides
                        physical_path and metadata needed to open the target graph.
    """

    model_config = ConfigDict(frozen=True)

    target_node: GlobalNodeRef = Field(
        ...,
        description="Destination node address: graph_uri + local node_id",
    )
    relation: BoundaryEdgeType = Field(
        ...,
        description="Edge type connecting the queried node to this neighbor",
    )
    edge_attrs: Dict[str, Any] = Field(
        default_factory=dict,
        description="Attributes from the underlying VirtualEdge",
    )
    target_manifest: GraphManifest = Field(
        ...,
        description="Full manifest of the destination graph (routing envelope)",
    )
