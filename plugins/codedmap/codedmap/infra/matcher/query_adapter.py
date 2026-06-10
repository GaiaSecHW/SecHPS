"""
codedmap/infra/matcher/query_adapter.py

Matcher-specific query port (abstract interface / protocol).

This module defines the abstract boundary between the matcher service layer
(codedmap/app/services/matcher.py) and any storage-backed lookup implementation.
The protocol ensures that SQL, Cypher, or other backend-specific query logic
cannot leak into the application service layer.

Design (Phase 04 D-02 / D-03):
  - MatcherQueryAdapter is the single seam the service layer depends on.
  - Implementations live under codedmap/infra/matcher/adapters/ (one per backend).
  - The adapter accepts a SemanticSignature and returns typed RawCandidateRow dicts
    that the matcher engine can consume without knowing how they were fetched.

Protocol surface:
  - lookup_candidates(signature) -> List[RawCandidateRow]
    Returns all candidate rows that match the given node_label filter.
    Callers receive raw typed dicts; the matcher engine performs tier scoring.

RawCandidateRow contract:
  - node_id:      int      — local graph integer ID
  - node_label:   str      — CPG node label (e.g. "METHOD", "CALL")
  - name:         str      — semantic name field
  - file_path:    str      — POSIX-relative file path
  - content_hash: str|None — optional content hash for Tier-1 matching
"""

from __future__ import annotations

from typing import Dict, List, Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# RawCandidateRow type alias
# ---------------------------------------------------------------------------

RawCandidateRow = Dict[str, object]
"""Typed-dict-style alias for candidate rows returned by lookup_candidates().

Required keys:
  node_id       int        Local graph node integer ID
  node_label    str        CPG node label
  name          str        Semantic name
  file_path     str        POSIX-relative path
  content_hash  str|None   Optional content hash
"""


# ---------------------------------------------------------------------------
# MatcherQueryAdapter protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class MatcherQueryAdapter(Protocol):
    """Matcher-specific query port.

    Implementations must provide ``lookup_candidates`` which returns all
    candidate rows pre-filtered by ``node_label`` from the underlying storage.

    The signature is passed in full so implementations may choose to apply
    additional pre-filters (e.g. name prefix index scan) as optimisations,
    but the matcher engine applies the definitive tier scoring logic.

    Implementations must NOT import from codedmap.app or codedmap.cli.
    Storage-specific query strings (SQL / Cypher) belong exclusively in
    the implementation module under codedmap/infra/matcher/adapters/.
    """

    def lookup_candidates(
        self,
        signature: object,  # SemanticSignature — typed at runtime, avoids circular import
    ) -> List[RawCandidateRow]:
        """Return all candidate rows for the given SemanticSignature.

        The implementation must at minimum filter candidates by
        ``signature.node_label``. It may apply further pre-filters as
        performance optimisations but must not skip any true positive.

        Args:
            signature: A SemanticSignature instance (node_label, name,
                       file_path, content_hash).

        Returns:
            List of RawCandidateRow dicts, each with keys:
            ``node_id``, ``node_label``, ``name``, ``file_path``,
            ``content_hash``.
        """
        ...
