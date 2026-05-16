# codedmap/api/routers/federation.py
"""
Federation router — cross-graph boundary coordination endpoints.

Phase 06 activation: endpoints now delegate to FederationEngine via
SqliteFederationAdapter for real persistence. Write endpoints require
X-Agent-ID header and hold the store write lock.

Endpoints:
  POST /federation/register  — Register a graph in the federation index. (201)
  POST /federation/link      — Create a cross-boundary edge between graphs. (200)
  POST /federation/neighbors — Enumerate cross-boundary neighbors of a node. (200)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.core.schema.common import GlobalNodeRef, validate_graph_uri

router = APIRouter(prefix="/federation", tags=["federation"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class RegisterGraphRequest(BaseModel):
    """Request to register a graph URI in the federation index."""

    graph_uri: str = Field(..., description="Graph URI to register (e.g., 'sqlite://my.db')")
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional project metadata (project_name, language, version)",
    )

    @field_validator("graph_uri")
    @classmethod
    def validate_uri(cls, v: str) -> str:
        if not validate_graph_uri(v):
            raise ValueError(f"Invalid graph_uri format: {v!r}")
        return v


class LinkBoundaryRequest(BaseModel):
    """Request to create a typed cross-boundary edge between two graphs."""

    source_uri: str = Field(..., description="URI of the source graph")
    target_uri: str = Field(..., description="URI of the target graph")
    edge_type: str = Field(
        ...,
        description="Cross-boundary edge type: IPC, SYSCALL, RPC, or SHARED_DATA",
    )
    source_node_id: int = Field(..., description="Node ID in the source graph")
    target_node_id: int = Field(..., description="Node ID in the target graph")
    properties: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional edge properties (protocol, channel, etc.)",
    )

    @field_validator("source_uri", "target_uri")
    @classmethod
    def validate_uris(cls, v: str) -> str:
        if not validate_graph_uri(v):
            raise ValueError(f"Invalid graph_uri format: {v!r}")
        return v

    @field_validator("edge_type")
    @classmethod
    def validate_edge_type(cls, v: str) -> str:
        from codedmap.core.schema.federation import BoundaryEdgeType
        valid = {e.value for e in BoundaryEdgeType}
        if v not in valid:
            raise ValueError(
                f"Invalid edge_type {v!r}. Must be one of: {', '.join(sorted(valid))}"
            )
        return v


class NeighborsRequest(BaseModel):
    """Request to enumerate cross-boundary neighbors for a node."""

    graph_uri: str = Field(..., description="URI of the home graph for the given node")
    node_id: int = Field(..., description="ID of the node to query")
    depth: int = Field(default=1, ge=1, description="Traversal depth across graph boundaries")
    edge_types: Optional[List[str]] = Field(
        default=None,
        description="Filter to specific edge types (IPC, SYSCALL, RPC, SHARED_DATA)",
    )

    @field_validator("graph_uri")
    @classmethod
    def validate_uri(cls, v: str) -> str:
        if not validate_graph_uri(v):
            raise ValueError(f"Invalid graph_uri format: {v!r}")
        return v


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class RegisterGraphResponse(BaseModel):
    """Response body for POST /federation/register."""

    graph_uri: str
    physical_path: str
    metadata: Dict[str, Any]
    registered_at: str  # ISO-8601


class LinkBoundaryResponse(BaseModel):
    """Response body for POST /federation/link."""

    status: str = "linked"
    source_uri: str
    target_uri: str
    relation: str


class NeighborsResponse(BaseModel):
    """Response body for POST /federation/neighbors."""

    graph_uri: str
    node_id: int
    neighbors: List[Dict[str, Any]]  # VirtualNeighbor.model_dump() items
    count: int


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_federation_engine(store) -> "FederationEngine":
    """Instantiate FederationEngine with a SqliteFederationAdapter.

    Imports are lazy per api/CLAUDE.md convention (heavy imports inside
    endpoint body, not at module top level).

    Derives the federation.db path from the CPG store's storage URI.
    Falls back to the current directory if the store has no config URI.
    """
    from codedmap.infra.federation.adapters.sqlite_registry import SqliteFederationAdapter
    from codedmap.app.services.domain.federation import FederationEngine
    from pathlib import Path

    db_dir = (
        Path(store.config.uri).parent
        if hasattr(store, "config") and hasattr(store.config, "uri")
        else Path(".")
    )
    adapter = SqliteFederationAdapter(str(db_dir / "federation.db"))
    return FederationEngine(adapter=adapter)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=RegisterGraphResponse, status_code=201)
async def federation_register(
    body: RegisterGraphRequest,
    store=Depends(get_store),
    lock=Depends(get_store_lock),
    agent_id: str = Depends(require_agent_id),
):
    """Register a graph instance in the federation index.

    Requires X-Agent-ID header. Holds the store write lock for the duration.
    Returns HTTP 201 with a GraphManifest body on success.
    """
    async with lock:
        engine = _get_federation_engine(store)
        manifest = engine.register_graph(body.graph_uri, metadata=body.metadata)
        return RegisterGraphResponse(
            graph_uri=manifest.graph_uri,
            physical_path=manifest.physical_path,
            metadata=manifest.metadata,
            registered_at=manifest.registered_at.isoformat(),
        )


@router.post("/link", response_model=LinkBoundaryResponse, status_code=200)
async def federation_link(
    body: LinkBoundaryRequest,
    store=Depends(get_store),
    lock=Depends(get_store_lock),
    agent_id: str = Depends(require_agent_id),
):
    """Create a typed cross-boundary edge between two graph nodes.

    Requires X-Agent-ID header. Holds the store write lock for the duration.
    Returns HTTP 200 with a LinkBoundaryResponse on success.
    """
    async with lock:
        from codedmap.core.schema.federation import BoundaryEdgeType
        engine = _get_federation_engine(store)
        source_ref = GlobalNodeRef(graph_uri=body.source_uri, node_id=body.source_node_id)
        target_ref = GlobalNodeRef(graph_uri=body.target_uri, node_id=body.target_node_id)
        relation = BoundaryEdgeType(body.edge_type)
        engine.link_boundary(source_ref, target_ref, relation, attrs=body.properties or {})
        return LinkBoundaryResponse(
            source_uri=body.source_uri,
            target_uri=body.target_uri,
            relation=body.edge_type,
        )


@router.post("/neighbors", response_model=NeighborsResponse, status_code=200)
async def federation_neighbors(
    body: NeighborsRequest,
    store=Depends(get_store),
):
    """Enumerate cross-boundary neighbors of a node across federated graphs.

    Read-only endpoint — no lock or agent ID required.
    Returns HTTP 200 with a list of VirtualNeighbor items.
    """
    engine = _get_federation_engine(store)
    neighbors = engine.get_virtual_neighbors(
        body.graph_uri, body.node_id, edge_types=body.edge_types
    )
    return NeighborsResponse(
        graph_uri=body.graph_uri,
        node_id=body.node_id,
        neighbors=[n.model_dump(mode="json") for n in neighbors],
        count=len(neighbors),
    )
