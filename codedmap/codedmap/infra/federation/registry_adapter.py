"""
codedmap/infra/federation/registry_adapter.py

Federation registry port (abstract interface / protocol).

This module defines the abstract boundary between the federation service layer
(codedmap/app/services/ — Phase 06 Plan 02) and any storage-backed registry
implementation.  The protocol ensures that SQL, Cypher, or other
backend-specific persistence logic cannot leak into the application service layer.

Design (Phase 06 D-04 / D-05):
  - FederationRegistryAdapter is the single seam the service layer depends on.
  - Implementations live under codedmap/infra/federation/adapters/ (one per backend).
  - The adapter operates on federation DTOs from codedmap.core.schema.federation.

Protocol surface:
  - register_graph(graph_uri, physical_path, metadata)  -> GraphManifest
    Idempotent upsert — registers or updates a graph's manifest.
  - link_boundary(edge)                                  -> None
    Persists a VirtualEdge between two graph nodes.
  - get_virtual_neighbors(graph_uri, node_id, edge_types) -> List[VirtualNeighbor]
    Returns all cross-graph neighbors for a node, with target_manifest populated.
  - get_manifest(graph_uri)                              -> Optional[GraphManifest]
    Returns the manifest for a registered graph, or None if not found.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from codedmap.core.schema.federation import (
    GraphManifest,
    VirtualEdge,
    VirtualNeighbor,
)


# ---------------------------------------------------------------------------
# FederationRegistryAdapter protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class FederationRegistryAdapter(Protocol):
    """Federation registry port.

    Implementations must provide the four methods below.  All persistence
    concerns (SQL, file I/O, network calls) belong exclusively in the
    implementation module under codedmap/infra/federation/adapters/.

    Implementations must NOT import from codedmap.app or codedmap.cli.
    """

    def register_graph(
        self,
        graph_uri: str,
        physical_path: str,
        metadata: Dict[str, Any],
    ) -> GraphManifest:
        """Register or update a graph manifest in the federation registry.

        Upsert semantics: if graph_uri already exists, update its record.

        Args:
            graph_uri:      URI identifying the graph (e.g., sqlite://prod.db).
            physical_path:  Filesystem path to the graph's storage file.
            metadata:       Arbitrary key-value metadata dict.

        Returns:
            The GraphManifest as persisted (with registered_at timestamp).
        """
        ...

    def link_boundary(self, edge: VirtualEdge) -> None:
        """Persist a cross-graph virtual edge in the federation registry.

        Args:
            edge: A VirtualEdge linking two GlobalNodeRef addresses.
        """
        ...

    def get_virtual_neighbors(
        self,
        graph_uri: str,
        node_id: int,
        edge_types: Optional[List[str]] = None,
    ) -> List[VirtualNeighbor]:
        """Return all cross-graph neighbors for the given node.

        Looks up virtual edges where the node appears as source OR target
        (bidirectional lookup).  Joins the target graph's manifest so that
        callers receive the full routing envelope without a second query.

        Args:
            graph_uri:   URI of the graph containing the queried node.
            node_id:     Local node ID within that graph.
            edge_types:  Optional filter; if provided, only return neighbors
                         connected via edges whose relation is in this list.

        Returns:
            List of VirtualNeighbor with target_manifest populated.
        """
        ...

    def get_manifest(self, graph_uri: str) -> Optional[GraphManifest]:
        """Return the manifest for a registered graph, or None if not found.

        Args:
            graph_uri: URI identifying the graph to look up.

        Returns:
            GraphManifest if registered, else None.
        """
        ...
