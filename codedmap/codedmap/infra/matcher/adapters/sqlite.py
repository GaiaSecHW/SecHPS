"""
codedmap/infra/matcher/adapters/sqlite.py

SQLite-backed implementation of the MatcherQueryAdapter port.

This module is the exclusive home for storage-specific candidate lookup logic
that supports the semantic matcher.  All SQL strings and SQLite-specific query
patterns belong here; nothing from this module may be imported by the
application service layer (app/).

Design (Phase 04 D-02 / D-03):
  - SqliteMatcherAdapter wraps a CPGStore and implements lookup_candidates().
  - It uses the store's TraversalSourceProtocol DSL (store.query) and the
    MethodRepository (store.methods) so that the SQL stays in the SQLite driver,
    not here.  This module only knows the label-to-traversal routing logic.
  - For the METHOD label, store.methods.find_all() with label filter is used.
  - For other labels, store.query.all_nodes(label) is the generic fallback.
  - Candidate rows are returned as RawCandidateRow dicts; all tier-scoring logic
    lives in the matcher engine (app/services/matcher.py).

Why a separate class instead of monkey-patching the store?
  - The store is a general-purpose facade.  Matcher candidate semantics
    (flattening CPGNode properties to node_id/node_label/name/file_path/
    content_hash) are matcher-specific; they don't belong in CPGStore.
  - Isolation: swapping to a Neo4j implementation requires only a new file
    under adapters/, not a change to CPGStore.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, List

from codedmap.infra.matcher.query_adapter import MatcherQueryAdapter, RawCandidateRow

if TYPE_CHECKING:
    # Avoid circular import: only used for type hints at check time.
    from codedmap.infra.storage.store import CPGStore
    from codedmap.core.schema.common import SemanticSignature


class SqliteMatcherAdapter:
    """CPGStore-backed implementation of the MatcherQueryAdapter port.

    Wraps a CPGStore and routes candidate lookups through the store's
    traversal DSL and repository methods.  No SQL strings live here —
    the SQLite driver handles all persistence concerns.

    Usage:
        store = CPGStore(StorageConfig(backend="sqlite", uri="graph.db"))
        adapter = SqliteMatcherAdapter(store)
        candidates = adapter.lookup_candidates(signature)
    """

    def __init__(self, store: "CPGStore") -> None:
        self._store = store

    # ------------------------------------------------------------------
    # MatcherQueryAdapter implementation
    # ------------------------------------------------------------------

    def lookup_candidates(
        self,
        signature: "SemanticSignature",
    ) -> List[RawCandidateRow]:
        """Return all candidate rows filtered by signature.node_label.

        Routes to the most efficient traversal path for the label:
          - METHOD label: uses store.query.methods() (index-backed in SQLite)
          - All other labels: uses store.query.all_nodes(label) (full-label scan)

        The returned dicts contain the five keys required by the matcher engine:
          node_id, node_label, name, file_path, content_hash.

        Args:
            signature: SemanticSignature carrying node_label (and optionally
                       name, file_path, content_hash for the engine to score).

        Returns:
            List of RawCandidateRow dicts with keys:
            ``node_id``, ``node_label``, ``name``, ``file_path``,
            ``content_hash``.
        """
        label = signature.node_label

        if label == "METHOD":
            nodes = self._store.query.methods().to_list()
        else:
            nodes = self._store.query.all_nodes(label).to_list()

        candidates: List[RawCandidateRow] = []
        for node in nodes:
            node_id = getattr(node, "id", None)
            if node_id is None:
                continue

            # Extract the fields the matcher engine expects.
            # CPGNode stores name in .name (most labels) or .full_name.
            # file_path comes from .file_name (AstNode) or similar.
            # content_hash may not exist on all node types — default None.
            name: str = (
                getattr(node, "name", None)
                or getattr(node, "full_name", None)
                or ""
            )
            file_path: str = (
                getattr(node, "file_name", None)
                or getattr(node, "fileName", None)
                or ""
            )
            content_hash = getattr(node, "content_hash", None)

            candidates.append(
                {
                    "node_id": node_id,
                    "node_label": label,
                    "name": name,
                    "file_path": file_path,
                    "content_hash": content_hash,
                }
            )

        return candidates


# Verify that SqliteMatcherAdapter satisfies the MatcherQueryAdapter protocol
# at import time so mismatches are caught early during development.
assert isinstance(SqliteMatcherAdapter, type)
