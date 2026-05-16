"""
codedmap/core/schema/matcher.py

Canonical matcher DTO contract for Phase 04 semantic matcher module.

Centralizes all matcher data types:
  - MatchTier:      Enum of recognized matching tiers (TIER_1, TIER_1B, TIER_2, TIER_3)
  - MatchStatus:    Enum of match resolution outcomes (MATCHED, AMBIGUOUS, ORPHANED)
  - MatchCandidate: A single candidate node with relevance score and reason
  - MatchResult:    Per-artifact match outcome from the semantic matcher engine
  - MatchReport:    Aggregated matching results for a batch of artifacts

Design constraints:
  - Pure data models — zero FastAPI, CLI, or storage imports allowed here (Layer 0).
  - Uses Pydantic V2 with frozen models and Literal types for strict validation.
  - Preserves confidence ranges: TIER_1=1.0, TIER_1B=0.9, TIER_2=0.8, TIER_3=0.0.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums / Literals
# ---------------------------------------------------------------------------

MatchTier = Literal["TIER_1", "TIER_1B", "TIER_2", "TIER_3"]
"""Matching tier that produced a result.

TIER_1:  Exact hash + name + path match (content_hash present).
TIER_1B: Name + path match, no content_hash provided.
TIER_2:  Name + path match when hash is present but mismatched (evolved node).
TIER_3:  No match found — artifact is orphaned.
"""

MatchStatus = Literal["MATCHED", "AMBIGUOUS", "ORPHANED"]
"""Final resolution status for a single artifact.

MATCHED:   Exactly one candidate passed all filters — node_id is set.
AMBIGUOUS: Multiple candidates survived — agent must disambiguate.
ORPHANED:  Zero candidates survived — artifact cannot be projected.
"""


# ---------------------------------------------------------------------------
# MatchCandidate
# ---------------------------------------------------------------------------

class MatchCandidate(BaseModel):
    """A single candidate node found during matching with its relevance score.

    Fields:
      node_id: Local graph node ID of the candidate.
      score:   Relevance score in [0.0, 1.0] — reflects confidence at the tier level.
      reason:  Human-readable explanation of why this candidate matched.
    """

    model_config = ConfigDict(frozen=True)

    node_id: int = Field(..., description="Local graph node ID of the candidate")
    score: float = Field(..., ge=0.0, le=1.0, description="Relevance score in [0.0, 1.0]")
    reason: str = Field(..., description="Human-readable explanation of why this candidate matched")


# ---------------------------------------------------------------------------
# MatchResult
# ---------------------------------------------------------------------------

class MatchResult(BaseModel):
    """Per-artifact match outcome from the semantic matcher engine.

    Fields:
      artifact_index:  0-based index of the artifact in the batch.
      tier:            Matching tier that produced this result.
      status:          Final resolution status (MATCHED / AMBIGUOUS / ORPHANED).
      matched_node_id: The resolved node ID when status=MATCHED; None otherwise.
      confidence:      Confidence score in [0.0, 1.0].
      candidates:      Candidate list populated when status=AMBIGUOUS.
      diagnostics:     Trace of matching steps for agent diagnostics.
    """

    model_config = ConfigDict(frozen=True)

    artifact_index: int = Field(..., description="0-based index of the artifact in the batch")
    tier: MatchTier = Field(..., description="Matching tier that produced this result")
    status: MatchStatus = Field(..., description="Final resolution status")
    matched_node_id: Optional[int] = Field(
        default=None,
        description="The resolved node ID when status=MATCHED; None for AMBIGUOUS or ORPHANED",
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score in [0.0, 1.0]")
    candidates: List[MatchCandidate] = Field(
        default_factory=list,
        description="Candidate list populated when status=AMBIGUOUS",
    )
    diagnostics: List[str] = Field(
        default_factory=list,
        description="Trace of matching steps for agent diagnostics",
    )


# ---------------------------------------------------------------------------
# MatchReport
# ---------------------------------------------------------------------------

class MatchReport(BaseModel):
    """Aggregated matching results for a batch of artifacts.

    Fields:
      results: Per-artifact match results in input order.
    """

    results: List[MatchResult] = Field(
        default_factory=list,
        description="Per-artifact match results in input order",
    )
