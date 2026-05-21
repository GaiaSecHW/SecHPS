"""
codedmap/infra/federation/adapters/sqlite_registry.py

SQLite-backed implementation of the FederationRegistryAdapter port.

This module is the exclusive home for all SQL strings and SQLite-specific
persistence logic for the federation registry.  No SQL may appear in any
other module (per CLAUDE.md "No raw SQL outside storage drivers" rule).

Design (Phase 06 D-06):
  - SqliteFederationAdapter maintains a standalone federation.db file that is
    independent of any CPG graph storage.  This allows it to span multiple
    graph backends and remain the single routing authority.
  - Schema: two tables (graph_manifests, virtual_edges) with covering indexes
    on the source and target columns for bidirectional neighbor lookup.
  - All metadata/attrs are JSON-serialized as TEXT for portability.
  - register_graph uses INSERT OR REPLACE (upsert semantics).
  - get_virtual_neighbors performs a bidirectional lookup via UNION ALL,
    JOINing graph_manifests to populate the full target_manifest routing
    envelope in a single query per direction.

Usage:
    adapter = SqliteFederationAdapter("/path/to/federation.db")
    manifest = adapter.register_graph("sqlite://prod", "/prod.db", {"env": "prod"})
    adapter.link_boundary(VirtualEdge(...))
    neighbors = adapter.get_virtual_neighbors("sqlite://prod", node_id=42)
    adapter.close()
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

from codedmap.core.schema.common import GlobalNodeRef
from codedmap.core.schema.federation import (
    BoundaryEdgeType,
    GraphManifest,
    VirtualEdge,
    VirtualNeighbor,
)


class SqliteFederationAdapter:
    """SQLite-backed federation registry.

    Persists graph manifests and virtual edges in a standalone federation.db
    file.  All cross-graph edge lookups join the manifest table so that callers
    receive the full routing envelope (VirtualNeighbor.target_manifest) without
    requiring a second query.

    Thread safety: This adapter opens a single sqlite3 connection.  For
    concurrent access, callers must synchronize externally or use separate
    adapter instances.
    """

    def __init__(self, db_path: str) -> None:
        """Open the federation registry at db_path.

        Creates the file if it does not exist.  Calls _ensure_schema() to
        create tables and indexes on first open.

        Args:
            db_path: Filesystem path to the federation.db file.
        """
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Schema setup
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        """Create tables and indexes if they do not already exist."""
        with self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS graph_manifests (
                    graph_uri     TEXT PRIMARY KEY,
                    physical_path TEXT NOT NULL,
                    metadata      TEXT NOT NULL DEFAULT '{}',
                    registered_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS virtual_edges (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_uri     TEXT NOT NULL,
                    source_node_id INTEGER NOT NULL,
                    target_uri     TEXT NOT NULL,
                    target_node_id INTEGER NOT NULL,
                    relation       TEXT NOT NULL,
                    attrs          TEXT NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_ve_source
                    ON virtual_edges (source_uri, source_node_id);

                CREATE INDEX IF NOT EXISTS idx_ve_target
                    ON virtual_edges (target_uri, target_node_id);
                """
            )

    # ------------------------------------------------------------------
    # FederationRegistryAdapter implementation
    # ------------------------------------------------------------------

    def register_graph(
        self,
        graph_uri: str,
        physical_path: str,
        metadata: Dict[str, Any],
    ) -> GraphManifest:
        """Register or update a graph manifest (upsert semantics).

        Uses INSERT OR REPLACE so that duplicate graph_uri updates the
        existing row.  The registered_at timestamp is always set to
        the current UTC time on insert/replace.

        Args:
            graph_uri:      Validated graph URI (e.g., sqlite://prod.db).
            physical_path:  Filesystem path to the graph storage file.
            metadata:       Arbitrary key-value metadata dict.

        Returns:
            The GraphManifest as persisted.
        """
        registered_at = datetime.utcnow().isoformat()
        serialized_metadata = json.dumps(metadata)

        with self._conn:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO graph_manifests
                    (graph_uri, physical_path, metadata, registered_at)
                VALUES (?, ?, ?, ?)
                """,
                (graph_uri, physical_path, serialized_metadata, registered_at),
            )

        return GraphManifest(
            graph_uri=graph_uri,
            physical_path=physical_path,
            metadata=metadata,
            registered_at=datetime.fromisoformat(registered_at),
        )

    def get_manifest(self, graph_uri: str) -> Optional[GraphManifest]:
        """Return the manifest for a registered graph, or None if not found.

        Args:
            graph_uri: URI identifying the graph to look up.

        Returns:
            GraphManifest if registered, else None.
        """
        cursor = self._conn.execute(
            """
            SELECT graph_uri, physical_path, metadata, registered_at
            FROM graph_manifests
            WHERE graph_uri = ?
            """,
            (graph_uri,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return self._row_to_manifest(row)

    def link_boundary(self, edge: VirtualEdge) -> None:
        """Persist a cross-graph virtual edge.

        Args:
            edge: A VirtualEdge with source, target, relation, and attrs.
        """
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO virtual_edges
                    (source_uri, source_node_id, target_uri, target_node_id, relation, attrs)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    edge.source.graph_uri,
                    edge.source.node_id,
                    edge.target.graph_uri,
                    edge.target.node_id,
                    edge.relation.value,
                    json.dumps(edge.attrs),
                ),
            )

    def get_virtual_neighbors(
        self,
        graph_uri: str,
        node_id: int,
        edge_types: Optional[List[str]] = None,
    ) -> List[VirtualNeighbor]:
        """Return all cross-graph neighbors for a node (bidirectional).

        Queries virtual_edges where the node appears as source OR target.
        JOINs graph_manifests on the *other* side of each edge so that
        target_manifest is fully populated in the result.

        The two directions are combined via UNION ALL:
          1. Node is source  → neighbor is target; JOIN on target_uri
          2. Node is target  → neighbor is source; JOIN on source_uri

        Args:
            graph_uri:  URI of the graph containing the queried node.
            node_id:    Local node ID within that graph.
            edge_types: Optional relation filter (e.g., ["IPC", "RPC"]).

        Returns:
            List of VirtualNeighbor with target_manifest populated.
        """
        params_fwd: list = [graph_uri, node_id]
        params_rev: list = [graph_uri, node_id]

        edge_filter = ""
        if edge_types:
            placeholders = ", ".join("?" for _ in edge_types)
            edge_filter = f"AND ve.relation IN ({placeholders})"
            params_fwd.extend(edge_types)
            params_rev.extend(edge_types)

        # Direction 1: queried node is the SOURCE → neighbor is the TARGET
        fwd_query = f"""
            SELECT
                ve.target_uri    AS neighbor_uri,
                ve.target_node_id AS neighbor_node_id,
                ve.relation,
                ve.attrs,
                gm.graph_uri     AS manifest_graph_uri,
                gm.physical_path,
                gm.metadata,
                gm.registered_at
            FROM virtual_edges ve
            JOIN graph_manifests gm ON gm.graph_uri = ve.target_uri
            WHERE ve.source_uri = ? AND ve.source_node_id = ?
            {edge_filter}
        """

        # Direction 2: queried node is the TARGET → neighbor is the SOURCE
        rev_query = f"""
            SELECT
                ve.source_uri    AS neighbor_uri,
                ve.source_node_id AS neighbor_node_id,
                ve.relation,
                ve.attrs,
                gm.graph_uri     AS manifest_graph_uri,
                gm.physical_path,
                gm.metadata,
                gm.registered_at
            FROM virtual_edges ve
            JOIN graph_manifests gm ON gm.graph_uri = ve.source_uri
            WHERE ve.target_uri = ? AND ve.target_node_id = ?
            {edge_filter}
        """

        combined_query = f"{fwd_query} UNION ALL {rev_query}"
        all_params = params_fwd + params_rev

        cursor = self._conn.execute(combined_query, all_params)
        rows = cursor.fetchall()

        results: List[VirtualNeighbor] = []
        for row in rows:
            target_node = GlobalNodeRef(
                graph_uri=row["neighbor_uri"],
                node_id=row["neighbor_node_id"],
            )
            target_manifest = GraphManifest(
                graph_uri=row["manifest_graph_uri"],
                physical_path=row["physical_path"],
                metadata=json.loads(row["metadata"]),
                registered_at=datetime.fromisoformat(row["registered_at"]),
            )
            results.append(
                VirtualNeighbor(
                    target_node=target_node,
                    relation=BoundaryEdgeType(row["relation"]),
                    edge_attrs=json.loads(row["attrs"]),
                    target_manifest=target_manifest,
                )
            )

        return results

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying sqlite3 connection."""
        self._conn.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _row_to_manifest(self, row: sqlite3.Row) -> GraphManifest:
        """Convert a graph_manifests row to a GraphManifest instance."""
        return GraphManifest(
            graph_uri=row["graph_uri"],
            physical_path=row["physical_path"],
            metadata=json.loads(row["metadata"]),
            registered_at=datetime.fromisoformat(row["registered_at"]),
        )


# Verify that SqliteFederationAdapter is a proper class (mirrors SqliteMatcherAdapter pattern).
assert isinstance(SqliteFederationAdapter, type)
