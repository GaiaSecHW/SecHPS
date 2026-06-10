"""
codedmap/app/services/matcher.py

Canonical deterministic matcher service for Phase 04.

Implements the 3-tier semantic matching decision tree and re-exports the
canonical matcher DTOs from codedmap.core.schema.matcher so that callers
can import all matcher-related symbols from a single location.

Design contract (PH4-MATCH-01 / D-01 / D-04):
  - Tier 1:  hash + name + path match   (confidence=1.0)
  - Tier 1B: name + path, no hash       (confidence=0.9)
  - Tier 2:  name + path, hash mismatch (confidence=0.8, evolved node)
  - Tier 3:  no match                   (confidence=0.0)

Phase 04 / PH4-MATCH-02 adapter boundary:
  - run_matcher() accepts a MatcherQueryAdapter (infra port) or a pre-fetched
    list of RawCandidateRow dicts.  Both paths are supported so that:
      * Integration callers pass an adapter and the engine fetches lazily.
      * Unit tests pass a pre-fetched list directly (no store required).
  - No raw SQL or concrete storage-driver imports are permitted here.

Invariants:
  - Label filter is always applied first.
  - content_hash is None -> TIER_1B path; Tier 2 is never attempted.
  - No auto-pick on multiple hits in any tier.
  - Diagnostics are deterministic strings for tooling compatibility.

Re-exports from codedmap.core.schema.matcher:
  - MatchTier, MatchStatus (Literal type aliases)
  - MatchCandidate (also aliased as CandidateDTO for Phase 02/03 compatibility)
  - MatchResult, MatchReport
"""

from __future__ import annotations

from typing import Any, List, Optional, Union

# Re-export canonical DTOs so callers can import everything from this module.
from codedmap.core.schema.matcher import (
    MatchCandidate,
    MatchReport,
    MatchResult,
    MatchStatus,
    MatchTier,
)
from codedmap.core.schema.common import normalize_file_path

# Adapter port (infra boundary) — import at module level for type hints only.
# Concrete implementations live under codedmap/infra/matcher/adapters/.
from codedmap.infra.matcher.query_adapter import MatcherQueryAdapter, RawCandidateRow

# Backward-compatible alias: Phase 02/03 code used CandidateDTO.
CandidateDTO = MatchCandidate

__all__ = [
    "MatchTier",
    "MatchStatus",
    "MatchCandidate",
    "MatchResult",
    "MatchReport",
    "CandidateDTO",
    "run_matcher",
]


# ---------------------------------------------------------------------------
# Deterministic matcher engine
# ---------------------------------------------------------------------------

def run_matcher(
    *,
    artifact_index: int,
    signature: Any,  # SemanticSignature — avoiding circular import
    adapter: Union[MatcherQueryAdapter, None] = None,
    candidates: Optional[List[RawCandidateRow]] = None,
) -> MatchResult:
    """Execute the deterministic 3-tier matching decision tree.

    Candidate source (exactly one must be provided):
      - adapter:    A MatcherQueryAdapter implementation.  The engine calls
                    adapter.lookup_candidates(signature) to fetch the pool.
      - candidates: Pre-fetched list of RawCandidateRow dicts (for unit tests
                    or callers that materialise the pool themselves).

    If both are omitted the function raises ValueError.  If both are provided,
    ``candidates`` takes precedence (allows callers to pre-filter).

    Decision tree:
      1. Fetch candidate pool via adapter or use provided list.
      2. Filter candidate pool by node_label (exact label match required).
      3. If signature.content_hash is set:
         a. Tier 1: filter by hash+name+path.
            - Unique hit  -> MATCHED / TIER_1 / confidence=1.0
            - Multiple    -> AMBIGUOUS / TIER_1 (degenerate, hash collision)
            - No hit      -> fall through to Tier 2
         b. Tier 2: filter by name+path (hash differs = evolved).
            - Unique hit  -> MATCHED / TIER_2 / confidence=0.8
            - Multiple    -> AMBIGUOUS / TIER_2
            - No hit      -> ORPHANED / TIER_3
      4. If signature.content_hash is None (Tier 1B path):
         a. Filter by name+path only.
            - Unique hit  -> MATCHED / TIER_1B / confidence=0.9
            - Multiple    -> AMBIGUOUS / TIER_1B
            - No hit      -> ORPHANED / TIER_3

    Args:
        artifact_index: 0-based position of the artifact in the batch.
        signature:      SemanticSignature with node_label, name, file_path,
                        and optional content_hash.
        adapter:        MatcherQueryAdapter implementation (infra layer).
        candidates:     Pre-fetched list of RawCandidateRow dicts; takes
                        precedence over adapter if provided.

    Returns:
        MatchResult with tier, status, matched_node_id, confidence, candidates
        (List[MatchCandidate]), and diagnostics.
    """
    diagnostics: List[str] = []

    # Resolve the lookup pool from either source.
    if candidates is not None:
        lookup_pool: List[RawCandidateRow] = candidates
    elif adapter is not None:
        lookup_pool = adapter.lookup_candidates(signature)
    else:
        raise ValueError(
            "run_matcher: either 'adapter' or 'candidates' must be provided"
        )

    # Step 1: filter by node_label
    label_pool = [c for c in lookup_pool if c.get("node_label") == signature.node_label]
    diagnostics.append(
        f"label filter '{signature.node_label}': {len(label_pool)} of {len(lookup_pool)} candidates remain"
    )

    if not label_pool:
        diagnostics.append("TIER_3: no candidates after label filter")
        return MatchResult(
            artifact_index=artifact_index,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
            candidates=[],
            diagnostics=diagnostics,
        )

    # Normalize signature file path for comparison
    sig_file = normalize_file_path(signature.file_path)
    sig_name = signature.name

    if signature.content_hash is not None:
        # ---- Tier 1 path ----
        sig_hash = signature.content_hash
        tier1_hits = [
            c for c in label_pool
            if c.get("content_hash") == sig_hash
            and c.get("name") == sig_name
            and normalize_file_path(str(c.get("file_path", ""))) == sig_file
        ]
        diagnostics.append(f"TIER_1 (hash+name+path): {len(tier1_hits)} hits")

        if len(tier1_hits) == 1:
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_1",
                status="MATCHED",
                matched_node_id=int(tier1_hits[0]["node_id"]),
                confidence=1.0,
                candidates=[],
                diagnostics=diagnostics,
            )
        if len(tier1_hits) > 1:
            match_candidates = [
                MatchCandidate(
                    node_id=int(c["node_id"]),
                    score=1.0,
                    reason="hash+name+path match (collision)",
                )
                for c in tier1_hits
            ]
            diagnostics.append("TIER_1: AMBIGUOUS — hash collision")
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_1",
                status="AMBIGUOUS",
                matched_node_id=None,
                confidence=1.0,
                candidates=match_candidates,
                diagnostics=diagnostics,
            )

        # ---- Tier 2 path (evolved) ----
        tier2_hits = [
            c for c in label_pool
            if c.get("name") == sig_name
            and normalize_file_path(str(c.get("file_path", ""))) == sig_file
        ]
        diagnostics.append(f"TIER_2 (name+path, hash mismatch): {len(tier2_hits)} hits")

        if len(tier2_hits) == 1:
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_2",
                status="MATCHED",
                matched_node_id=int(tier2_hits[0]["node_id"]),
                confidence=0.8,
                candidates=[],
                diagnostics=diagnostics,
            )
        if len(tier2_hits) > 1:
            match_candidates = [
                MatchCandidate(
                    node_id=int(c["node_id"]),
                    score=0.8,
                    reason="name+path match (evolved, hash differs)",
                )
                for c in tier2_hits
            ]
            diagnostics.append("TIER_2: AMBIGUOUS — multiple evolved candidates")
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_2",
                status="AMBIGUOUS",
                matched_node_id=None,
                confidence=0.8,
                candidates=match_candidates,
                diagnostics=diagnostics,
            )

        # ---- Tier 3 ----
        diagnostics.append("TIER_3: no match after Tier 1 and Tier 2")
        return MatchResult(
            artifact_index=artifact_index,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
            candidates=[],
            diagnostics=diagnostics,
        )

    else:
        # ---- Tier 1B path (no hash) ----
        tier1b_hits = [
            c for c in label_pool
            if c.get("name") == sig_name
            and normalize_file_path(str(c.get("file_path", ""))) == sig_file
        ]
        diagnostics.append(f"TIER_1B (name+path, no hash): {len(tier1b_hits)} hits")

        if len(tier1b_hits) == 1:
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_1B",
                status="MATCHED",
                matched_node_id=int(tier1b_hits[0]["node_id"]),
                confidence=0.9,
                candidates=[],
                diagnostics=diagnostics,
            )
        if len(tier1b_hits) > 1:
            match_candidates = [
                MatchCandidate(
                    node_id=int(c["node_id"]),
                    score=0.9,
                    reason="name+path match (hashless)",
                )
                for c in tier1b_hits
            ]
            diagnostics.append("TIER_1B: AMBIGUOUS — multiple name+path candidates")
            return MatchResult(
                artifact_index=artifact_index,
                tier="TIER_1B",
                status="AMBIGUOUS",
                matched_node_id=None,
                confidence=0.9,
                candidates=match_candidates,
                diagnostics=diagnostics,
            )

        # ---- Tier 3 ----
        diagnostics.append("TIER_3: no match in Tier 1B")
        return MatchResult(
            artifact_index=artifact_index,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
            candidates=[],
            diagnostics=diagnostics,
        )
