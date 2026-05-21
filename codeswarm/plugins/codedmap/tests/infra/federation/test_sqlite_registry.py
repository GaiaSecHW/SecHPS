"""
tests/infra/federation/test_sqlite_registry.py

Integration tests for SqliteFederationAdapter.

Each test uses tmp_path for an isolated federation.db so tests never share
state.  Tests cover the full adapter surface:
  - register_graph (new + upsert update)
  - get_manifest (None for unknown, populated for known)
  - link_boundary
  - get_virtual_neighbors (empty, populated, bidirectional, edge_type filter)
"""

import sys
import os

sys.path.insert(0, os.getcwd())

import pytest

from codedmap.core.schema.common import GlobalNodeRef
from codedmap.core.schema.federation import BoundaryEdgeType, VirtualEdge
from codedmap.infra.federation.adapters.sqlite_registry import SqliteFederationAdapter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_adapter(tmp_path) -> SqliteFederationAdapter:
    return SqliteFederationAdapter(str(tmp_path / "federation.db"))


# ---------------------------------------------------------------------------
# register_graph tests
# ---------------------------------------------------------------------------

def test_register_graph_returns_graph_manifest(tmp_path):
    """register_graph should return a GraphManifest with matching fields."""
    adapter = make_adapter(tmp_path)
    manifest = adapter.register_graph(
        graph_uri="sqlite://proj_a",
        physical_path="/data/proj_a.db",
        metadata={"language": "C"},
    )
    assert manifest.graph_uri == "sqlite://proj_a"
    assert manifest.physical_path == "/data/proj_a.db"
    assert manifest.metadata == {"language": "C"}
    assert manifest.registered_at is not None
    adapter.close()


def test_register_graph_upsert_updates_existing(tmp_path):
    """register_graph with duplicate graph_uri should update the existing entry."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph(
        graph_uri="sqlite://proj_a",
        physical_path="/old/path.db",
        metadata={"version": "1"},
    )
    updated = adapter.register_graph(
        graph_uri="sqlite://proj_a",
        physical_path="/new/path.db",
        metadata={"version": "2"},
    )
    assert updated.physical_path == "/new/path.db"
    assert updated.metadata["version"] == "2"

    # get_manifest should reflect the updated entry
    fetched = adapter.get_manifest("sqlite://proj_a")
    assert fetched is not None
    assert fetched.physical_path == "/new/path.db"
    adapter.close()


# ---------------------------------------------------------------------------
# get_manifest tests
# ---------------------------------------------------------------------------

def test_get_manifest_returns_none_for_unknown(tmp_path):
    """get_manifest should return None for a graph_uri that was never registered."""
    adapter = make_adapter(tmp_path)
    result = adapter.get_manifest("sqlite://nonexistent")
    assert result is None
    adapter.close()


def test_get_manifest_returns_manifest_for_registered(tmp_path):
    """get_manifest should return a matching GraphManifest for a registered graph."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph(
        graph_uri="sqlite://proj_b",
        physical_path="/data/proj_b.db",
        metadata={"owner": "team_a"},
    )
    manifest = adapter.get_manifest("sqlite://proj_b")
    assert manifest is not None
    assert manifest.graph_uri == "sqlite://proj_b"
    assert manifest.metadata["owner"] == "team_a"
    adapter.close()


# ---------------------------------------------------------------------------
# link_boundary tests
# ---------------------------------------------------------------------------

def test_link_boundary_stores_virtual_edge(tmp_path):
    """link_boundary should persist the edge so subsequent queries can find it."""
    adapter = make_adapter(tmp_path)

    # Both graphs must be registered for the JOIN in get_virtual_neighbors to work.
    adapter.register_graph("sqlite://graph_a", "/a.db", {})
    adapter.register_graph("sqlite://graph_b", "/b.db", {})

    edge = VirtualEdge(
        source=GlobalNodeRef(graph_uri="sqlite://graph_a", node_id=100),
        target=GlobalNodeRef(graph_uri="sqlite://graph_b", node_id=200),
        relation=BoundaryEdgeType.IPC,
        attrs={"channel": "pipe"},
    )
    adapter.link_boundary(edge)

    neighbors = adapter.get_virtual_neighbors("sqlite://graph_a", 100)
    assert len(neighbors) == 1
    assert neighbors[0].relation == BoundaryEdgeType.IPC
    adapter.close()


# ---------------------------------------------------------------------------
# get_virtual_neighbors tests
# ---------------------------------------------------------------------------

def test_get_virtual_neighbors_empty_when_no_edges(tmp_path):
    """get_virtual_neighbors should return an empty list when no edges exist."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph("sqlite://graph_x", "/x.db", {})
    result = adapter.get_virtual_neighbors("sqlite://graph_x", 999)
    assert result == []
    adapter.close()


def test_get_virtual_neighbors_returns_neighbor_with_target_manifest(tmp_path):
    """get_virtual_neighbors should return VirtualNeighbor with target_manifest populated."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph("sqlite://src_graph", "/src.db", {"role": "source"})
    adapter.register_graph("sqlite://dst_graph", "/dst.db", {"role": "destination"})

    edge = VirtualEdge(
        source=GlobalNodeRef(graph_uri="sqlite://src_graph", node_id=1),
        target=GlobalNodeRef(graph_uri="sqlite://dst_graph", node_id=2),
        relation=BoundaryEdgeType.RPC,
        attrs={"protocol": "gRPC"},
    )
    adapter.link_boundary(edge)

    neighbors = adapter.get_virtual_neighbors("sqlite://src_graph", 1)
    assert len(neighbors) == 1
    neighbor = neighbors[0]
    assert neighbor.target_node.graph_uri == "sqlite://dst_graph"
    assert neighbor.target_node.node_id == 2
    assert neighbor.relation == BoundaryEdgeType.RPC
    assert neighbor.edge_attrs == {"protocol": "gRPC"}
    # target_manifest must be fully populated (JOIN path)
    assert neighbor.target_manifest is not None
    assert neighbor.target_manifest.graph_uri == "sqlite://dst_graph"
    assert neighbor.target_manifest.metadata["role"] == "destination"
    adapter.close()


def test_get_virtual_neighbors_filters_by_edge_types(tmp_path):
    """get_virtual_neighbors should only return edges matching the given edge_types."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph("sqlite://alpha", "/alpha.db", {})
    adapter.register_graph("sqlite://beta", "/beta.db", {})
    adapter.register_graph("sqlite://gamma", "/gamma.db", {})

    adapter.link_boundary(VirtualEdge(
        source=GlobalNodeRef(graph_uri="sqlite://alpha", node_id=10),
        target=GlobalNodeRef(graph_uri="sqlite://beta", node_id=20),
        relation=BoundaryEdgeType.IPC,
    ))
    adapter.link_boundary(VirtualEdge(
        source=GlobalNodeRef(graph_uri="sqlite://alpha", node_id=10),
        target=GlobalNodeRef(graph_uri="sqlite://gamma", node_id=30),
        relation=BoundaryEdgeType.SYSCALL,
    ))

    # Filter to IPC only
    neighbors = adapter.get_virtual_neighbors("sqlite://alpha", 10, edge_types=["IPC"])
    assert len(neighbors) == 1
    assert neighbors[0].relation == BoundaryEdgeType.IPC
    assert neighbors[0].target_node.graph_uri == "sqlite://beta"
    adapter.close()


def test_get_virtual_neighbors_bidirectional(tmp_path):
    """get_virtual_neighbors should return neighbors where the node is source OR target."""
    adapter = make_adapter(tmp_path)
    adapter.register_graph("sqlite://left", "/left.db", {})
    adapter.register_graph("sqlite://right", "/right.db", {})

    # Edge goes left->right
    adapter.link_boundary(VirtualEdge(
        source=GlobalNodeRef(graph_uri="sqlite://left", node_id=1),
        target=GlobalNodeRef(graph_uri="sqlite://right", node_id=2),
        relation=BoundaryEdgeType.SHARED_DATA,
    ))

    # Querying from the target (right) side should also find the neighbor
    neighbors = adapter.get_virtual_neighbors("sqlite://right", 2)
    assert len(neighbors) == 1
    assert neighbors[0].target_node.graph_uri == "sqlite://left"
    assert neighbors[0].target_node.node_id == 1
    assert neighbors[0].relation == BoundaryEdgeType.SHARED_DATA
    # target_manifest should reference the left graph
    assert neighbors[0].target_manifest.graph_uri == "sqlite://left"
    adapter.close()


def test_register_graph_metadata_roundtrip(tmp_path):
    """Metadata dict should survive a register->get_manifest roundtrip."""
    adapter = make_adapter(tmp_path)
    meta = {"language": "Python", "version": "3.12", "tags": ["audit", "prod"]}
    adapter.register_graph("sqlite://meta_test", "/meta.db", meta)
    manifest = adapter.get_manifest("sqlite://meta_test")
    assert manifest is not None
    assert manifest.metadata == meta
    adapter.close()
