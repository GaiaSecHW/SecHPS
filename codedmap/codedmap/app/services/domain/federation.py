"""
codedmap.app.services.domain.federation — Federation domain.

Cross-graph federation engine — metadata router with adapter delegation.

Phase 06: Fully functional. Delegates all persistence to a
FederationRegistryAdapter (Ports & Adapters pattern, same as matcher).

Design:
  - FederationEngine is the service-layer entry point for federation operations.
  - All storage is delegated to a FederationRegistryAdapter (infra port).
  - The adapter accepts the protocol from codedmap.infra.federation.registry_adapter.
  - No raw SQL, no concrete adapter imports here — domain code only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from codedmap.core.schema.common import GlobalNodeRef, validate_graph_uri
from codedmap.core.schema.federation import (
    BoundaryEdgeType,
    GraphManifest,
    VirtualEdge,
    VirtualNeighbor,
)

if TYPE_CHECKING:
    from codedmap.infra.federation.registry_adapter import FederationRegistryAdapter


class FederationEngine:
    """Cross-graph federation engine — metadata router with adapter delegation.

    Phase 06: Fully functional. Delegates all persistence to a
    FederationRegistryAdapter (Ports & Adapters pattern, same as matcher).

    Args:
        adapter: A FederationRegistryAdapter implementation. Required — the engine
                 cannot operate without a backing registry.
    """

    def __init__(self, adapter: "FederationRegistryAdapter") -> None:
        self._adapter = adapter

    def register_graph(
        self,
        graph_uri: str,
        *,
        physical_path: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> GraphManifest:
        """Register a graph in the federation index. Returns GraphManifest.

        Validates the graph URI before delegating to the adapter. If
        physical_path is not provided, it is resolved from the URI by taking
        the portion after the scheme separator (e.g., "sqlite://my.db" -> "my.db").

        Args:
            graph_uri:      URI in the form scheme://path (e.g., sqlite://prod.db).
            physical_path:  Filesystem path to the graph storage. Defaults to the
                            path component of graph_uri if not provided.
            metadata:       Arbitrary key-value metadata for this graph.

        Returns:
            GraphManifest as stored in the registry.

        Raises:
            ValueError: If graph_uri does not match the required URI format.
        """
        if not validate_graph_uri(graph_uri):
            raise ValueError(f"Invalid graph_uri format: {graph_uri!r}")
        resolved_path = physical_path or graph_uri.split("://", 1)[1]
        return self._adapter.register_graph(graph_uri, resolved_path, metadata or {})

    def link_boundary(
        self,
        source_ref: GlobalNodeRef,
        target_ref: GlobalNodeRef,
        relation: BoundaryEdgeType,
        *,
        attrs: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Create a typed cross-boundary virtual edge between two graph nodes.

        Constructs a VirtualEdge from the supplied references and edge type,
        then delegates persistence to the adapter.

        Args:
            source_ref: GlobalNodeRef for the source node (graph_uri + node_id).
            target_ref: GlobalNodeRef for the target node (graph_uri + node_id).
            relation:   BoundaryEdgeType describing the cross-graph relationship.
            attrs:      Optional edge attributes (e.g., protocol, port number).
        """
        edge = VirtualEdge(
            source=source_ref,
            target=target_ref,
            relation=relation,
            attrs=attrs or {},
        )
        self._adapter.link_boundary(edge)

    def get_virtual_neighbors(
        self,
        graph_uri: str,
        node_id: int,
        *,
        edge_types: Optional[List[str]] = None,
    ) -> List[VirtualNeighbor]:
        """Return single-hop virtual neighbors with full routing envelopes.

        Delegates the bidirectional neighbor lookup to the adapter, optionally
        filtered by edge type names.

        Args:
            graph_uri:   URI of the graph containing the queried node.
            node_id:     Local node ID within that graph.
            edge_types:  Optional list of BoundaryEdgeType value strings to
                         filter results (e.g., ["IPC", "RPC"]).

        Returns:
            List of VirtualNeighbor, each carrying the neighbor's address,
            edge type, edge attributes, and the target graph's full manifest.
        """
        return self._adapter.get_virtual_neighbors(graph_uri, node_id, edge_types)
