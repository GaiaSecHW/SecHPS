"""
tests/app/services/test_federation.py

Unit tests for FederationEngine service (Phase 06 Plan 02).

Tests use a _StubRegistryAdapter (no external mock library) following the
Phase 04 _StubAdapter pattern. All tests are storage-backend-agnostic.

Test classes:
  - TestFederationEngineRegister    — register_graph() behavior
  - TestFederationEngineLink        — link_boundary() behavior
  - TestFederationEngineNeighbors   — get_virtual_neighbors() behavior
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.getcwd())

from datetime import datetime
from typing import Any, Dict, List, Optional

import pytest

from codedmap.app.services.domain.federation import FederationEngine
from codedmap.core.schema.common import GlobalNodeRef
from codedmap.core.schema.federation import (
    BoundaryEdgeType,
    GraphManifest,
    VirtualEdge,
    VirtualNeighbor,
)


# ---------------------------------------------------------------------------
# Stub adapter (inline, no external mock library)
# ---------------------------------------------------------------------------


class _StubRegistryAdapter:
    """In-memory stub implementing FederationRegistryAdapter for unit tests."""

    def __init__(self) -> None:
        self._manifests: Dict[str, GraphManifest] = {}
        self._edges: List[VirtualEdge] = []

    def register_graph(
        self,
        graph_uri: str,
        physical_path: str,
        metadata: Dict[str, Any],
    ) -> GraphManifest:
        manifest = GraphManifest(
            graph_uri=graph_uri,
            physical_path=physical_path,
            metadata=metadata,
            registered_at=datetime.utcnow(),
        )
        self._manifests[graph_uri] = manifest
        return manifest

    def link_boundary(self, edge: VirtualEdge) -> None:
        self._edges.append(edge)

    def get_virtual_neighbors(
        self,
        graph_uri: str,
        node_id: int,
        edge_types: Optional[List[str]] = None,
    ) -> List[VirtualNeighbor]:
        """Return VirtualNeighbors from stored edges matching the query."""
        results: List[VirtualNeighbor] = []
        for edge in self._edges:
            # Bidirectional: check if node appears as source or target
            is_source = edge.source.graph_uri == graph_uri and edge.source.node_id == node_id
            is_target = edge.target.graph_uri == graph_uri and edge.target.node_id == node_id

            if not (is_source or is_target):
                continue

            # Apply optional edge_type filter
            if edge_types is not None and edge.relation.value not in edge_types:
                continue

            # Determine which end is the neighbor
            neighbor_ref = edge.target if is_source else edge.source
            neighbor_manifest = self._manifests.get(neighbor_ref.graph_uri)
            if neighbor_manifest is None:
                continue

            results.append(
                VirtualNeighbor(
                    target_node=neighbor_ref,
                    relation=edge.relation,
                    edge_attrs=edge.attrs,
                    target_manifest=neighbor_manifest,
                )
            )
        return results

    def get_manifest(self, graph_uri: str) -> Optional[GraphManifest]:
        return self._manifests.get(graph_uri)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ref(uri: str, node_id: int = 1) -> GlobalNodeRef:
    return GlobalNodeRef(graph_uri=uri, node_id=node_id)


# ---------------------------------------------------------------------------
# TestFederationEngineRegister
# ---------------------------------------------------------------------------


class TestFederationEngineRegister:
    def test_register_graph_returns_graph_manifest(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        result = engine.register_graph("sqlite://test.db")
        assert isinstance(result, GraphManifest)
        assert result.graph_uri == "sqlite://test.db"

    def test_register_graph_invalid_uri_raises_value_error(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        with pytest.raises(ValueError):
            engine.register_graph("not-a-valid-uri")

    def test_register_graph_passes_metadata_to_adapter(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        meta = {"project": "my_app", "language": "C"}
        result = engine.register_graph("sqlite://app.db", metadata=meta)
        assert result.metadata == meta

    def test_register_graph_resolves_physical_path_from_uri(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        result = engine.register_graph("sqlite://path/to/graph.db")
        # physical_path should be the part after "://"
        assert result.physical_path == "path/to/graph.db"

    def test_register_graph_accepts_explicit_physical_path(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        result = engine.register_graph(
            "sqlite://graph.db", physical_path="/data/graphs/graph.db"
        )
        assert result.physical_path == "/data/graphs/graph.db"


# ---------------------------------------------------------------------------
# TestFederationEngineLink
# ---------------------------------------------------------------------------


class TestFederationEngineLink:
    def test_link_boundary_delegates_virtual_edge_to_adapter(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        src = _make_ref("sqlite://graph_a.db", node_id=10)
        tgt = _make_ref("sqlite://graph_b.db", node_id=20)
        engine.link_boundary(src, tgt, BoundaryEdgeType.IPC)
        assert len(stub._edges) == 1
        edge = stub._edges[0]
        assert edge.source == src
        assert edge.target == tgt
        assert edge.relation == BoundaryEdgeType.IPC

    def test_link_boundary_constructs_virtual_edge_with_attrs(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        src = _make_ref("sqlite://a.db", 1)
        tgt = _make_ref("sqlite://b.db", 2)
        attrs = {"port": 8080, "protocol": "grpc"}
        engine.link_boundary(src, tgt, BoundaryEdgeType.RPC, attrs=attrs)
        assert stub._edges[0].attrs == attrs

    def test_link_boundary_with_invalid_relation_raises_value_error(self) -> None:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        src = _make_ref("sqlite://a.db", 1)
        tgt = _make_ref("sqlite://b.db", 2)
        with pytest.raises((ValueError, KeyError)):
            engine.link_boundary(src, tgt, BoundaryEdgeType("NOT_VALID"))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# TestFederationEngineNeighbors
# ---------------------------------------------------------------------------


class TestFederationEngineNeighbors:
    def _setup_with_edge(
        self,
        relation: BoundaryEdgeType = BoundaryEdgeType.IPC,
    ) -> tuple[FederationEngine, _StubRegistryAdapter]:
        stub = _StubRegistryAdapter()
        engine = FederationEngine(adapter=stub)
        # Register both graphs
        stub.register_graph("sqlite://a.db", "a.db", {})
        stub.register_graph("sqlite://b.db", "b.db", {})
        # Create edge directly in stub
        edge = VirtualEdge(
            source=GlobalNodeRef(graph_uri="sqlite://a.db", node_id=1),
            target=GlobalNodeRef(graph_uri="sqlite://b.db", node_id=2),
            relation=relation,
        )
        stub._edges.append(edge)
        return engine, stub

    def test_get_virtual_neighbors_returns_list_of_virtual_neighbor(self) -> None:
        engine, _ = self._setup_with_edge()
        neighbors = engine.get_virtual_neighbors("sqlite://a.db", 1)
        assert isinstance(neighbors, list)
        assert len(neighbors) == 1
        assert isinstance(neighbors[0], VirtualNeighbor)

    def test_get_virtual_neighbors_passes_edge_types_filter_to_adapter(self) -> None:
        engine, stub = self._setup_with_edge(relation=BoundaryEdgeType.IPC)
        # Filter for IPC — should return result
        neighbors_ipc = engine.get_virtual_neighbors(
            "sqlite://a.db", 1, edge_types=["IPC"]
        )
        assert len(neighbors_ipc) == 1
        # Filter for RPC — should return no results
        neighbors_rpc = engine.get_virtual_neighbors(
            "sqlite://a.db", 1, edge_types=["RPC"]
        )
        assert len(neighbors_rpc) == 0

    def test_get_virtual_neighbors_returns_full_routing_envelope(self) -> None:
        engine, _ = self._setup_with_edge()
        neighbors = engine.get_virtual_neighbors("sqlite://a.db", 1)
        nb = neighbors[0]
        assert nb.target_node.graph_uri == "sqlite://b.db"
        assert isinstance(nb.target_manifest, GraphManifest)
        assert nb.target_manifest.graph_uri == "sqlite://b.db"


# ---------------------------------------------------------------------------
# TestFederationEngineConstruction
# ---------------------------------------------------------------------------


class TestFederationEngineConstruction:
    def test_federation_engine_without_adapter_raises_type_error(self) -> None:
        with pytest.raises(TypeError):
            FederationEngine()  # type: ignore[call-arg]
