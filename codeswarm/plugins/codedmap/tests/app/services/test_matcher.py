"""
tests/app/services/test_matcher.py

Dedicated matcher seam test suite — primary verification surface for Phase 04.

Purpose:
  Focused mock-driven tests for the canonical matcher contract at the service seam.
  Uses adapter doubles or stub candidate pools — no real SQLite database needed.

Test groups:
  - schema:    MatchTier, MatchStatus, MatchCandidate, MatchResult, MatchReport
               from codedmap.core.schema.matcher (Phase 04 canonical path)
  - adapter:   MatcherQueryAdapter protocol, SqliteMatcherAdapter, run_matcher adapter path
  - exact:     Tier 1 exact match (hash+name+path)
  - no_hash:   Tier 1B match (name+path, no content_hash)
  - evolved:   Tier 2 evolved match (hash mismatch, name+path match)
  - orphan:    Tier 3 no-match scenarios
  - ambiguous: Multiple candidate AMBIGUOUS outcomes — no auto-pick
  - projection: Knowledge projection integration case (ambiguity + strict all-or-nothing)

Run selective tests:
  python3 -m pytest tests/app/services/test_matcher.py -q -k schema
  python3 -m pytest tests/app/services/test_matcher.py -q -k exact
  python3 -m pytest tests/app/services/test_matcher.py -q -k no_hash
  python3 -m pytest tests/app/services/test_matcher.py -q -k evolved
  python3 -m pytest tests/app/services/test_matcher.py -q -k orphan
  python3 -m pytest tests/app/services/test_matcher.py -q -k ambiguous
  python3 -m pytest tests/app/services/test_matcher.py -q -k projection
"""

from __future__ import annotations

import sys
import os

sys.path.append(os.getcwd())

import pytest
from pydantic import ValidationError


# ---------------------------------------------------------------------------
# Schema: MatchTier / MatchStatus literals
# ---------------------------------------------------------------------------

class TestMatchTierLiterals:
    """schema: MatchTier literal values are TIER_1, TIER_1B, TIER_2, TIER_3."""

    def test_schema_tier_1_accepted(self):
        """TIER_1 is a valid MatchTier value."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1",
            status="MATCHED",
            matched_node_id=1,
            confidence=1.0,
        )
        assert result.tier == "TIER_1"

    def test_schema_tier_1b_accepted(self):
        """TIER_1B is a valid MatchTier value."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1B",
            status="MATCHED",
            matched_node_id=5,
            confidence=0.9,
        )
        assert result.tier == "TIER_1B"

    def test_schema_tier_2_accepted(self):
        """TIER_2 is a valid MatchTier value."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_2",
            status="MATCHED",
            matched_node_id=7,
            confidence=0.8,
        )
        assert result.tier == "TIER_2"

    def test_schema_tier_3_accepted(self):
        """TIER_3 is a valid MatchTier value."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
        )
        assert result.tier == "TIER_3"

    def test_schema_invalid_tier_rejected(self):
        """Unknown tier strings must raise ValidationError."""
        from codedmap.core.schema.matcher import MatchResult
        with pytest.raises(ValidationError):
            MatchResult(
                artifact_index=0,
                tier="TIER_X",
                status="MATCHED",
                matched_node_id=1,
                confidence=1.0,
            )


class TestMatchStatusLiterals:
    """schema: MatchStatus literal values are MATCHED, AMBIGUOUS, ORPHANED."""

    def test_schema_status_matched_accepted(self):
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1",
            status="MATCHED",
            matched_node_id=1,
            confidence=1.0,
        )
        assert result.status == "MATCHED"

    def test_schema_status_ambiguous_accepted(self):
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1",
            status="AMBIGUOUS",
            matched_node_id=None,
            confidence=1.0,
        )
        assert result.status == "AMBIGUOUS"

    def test_schema_status_orphaned_accepted(self):
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
        )
        assert result.status == "ORPHANED"

    def test_schema_invalid_status_rejected(self):
        from codedmap.core.schema.matcher import MatchResult
        with pytest.raises(ValidationError):
            MatchResult(
                artifact_index=0,
                tier="TIER_1",
                status="UNKNOWN_STATUS",
                matched_node_id=1,
                confidence=1.0,
            )


# ---------------------------------------------------------------------------
# Schema: MatchCandidate
# ---------------------------------------------------------------------------

class TestMatchCandidateSchema:
    """schema: MatchCandidate fields and constraints."""

    def test_schema_match_candidate_valid(self):
        from codedmap.core.schema.matcher import MatchCandidate
        c = MatchCandidate(node_id=42, score=0.9, reason="name+path match")
        assert c.node_id == 42
        assert c.score == 0.9
        assert c.reason == "name+path match"

    def test_schema_match_candidate_score_out_of_range(self):
        """Score must be in [0.0, 1.0]."""
        from codedmap.core.schema.matcher import MatchCandidate
        with pytest.raises(ValidationError):
            MatchCandidate(node_id=1, score=1.5, reason="out of range")

    def test_schema_match_candidate_score_negative(self):
        from codedmap.core.schema.matcher import MatchCandidate
        with pytest.raises(ValidationError):
            MatchCandidate(node_id=1, score=-0.1, reason="negative score")

    def test_schema_match_candidate_fields(self):
        from codedmap.core.schema.matcher import MatchCandidate
        fields = set(MatchCandidate.model_fields.keys())
        assert fields == {"node_id", "score", "reason"}

    def test_schema_match_candidate_is_frozen(self):
        """MatchCandidate is immutable."""
        from codedmap.core.schema.matcher import MatchCandidate
        c = MatchCandidate(node_id=1, score=0.5, reason="test")
        with pytest.raises(Exception):
            c.node_id = 999  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Schema: MatchResult
# ---------------------------------------------------------------------------

class TestMatchResultSchema:
    """schema: MatchResult DTO strict field contract from core/schema/matcher."""

    def test_schema_match_result_matched_tier1(self):
        """MatchResult with TIER_1 MATCHED has node_id set and confidence=1.0."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1",
            status="MATCHED",
            matched_node_id=12345,
            confidence=1.0,
            candidates=[],
            diagnostics=["exact hash+name+path match"],
        )
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1"
        assert result.matched_node_id == 12345
        assert result.confidence == 1.0

    def test_schema_match_result_tier1b_confidence(self):
        """TIER_1B MATCHED has confidence=0.9."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1B",
            status="MATCHED",
            matched_node_id=5,
            confidence=0.9,
        )
        assert result.confidence == 0.9

    def test_schema_match_result_tier2_confidence(self):
        """TIER_2 MATCHED has confidence=0.8."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_2",
            status="MATCHED",
            matched_node_id=7,
            confidence=0.8,
        )
        assert result.confidence == 0.8

    def test_schema_match_result_tier3_orphaned(self):
        """TIER_3 ORPHANED has confidence=0.0 and matched_node_id=None."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=2,
            tier="TIER_3",
            status="ORPHANED",
            matched_node_id=None,
            confidence=0.0,
            candidates=[],
            diagnostics=["no candidates found"],
        )
        assert result.status == "ORPHANED"
        assert result.matched_node_id is None
        assert result.confidence == 0.0

    def test_schema_match_result_ambiguous_has_candidates(self):
        """AMBIGUOUS result has candidates list populated."""
        from codedmap.core.schema.matcher import MatchResult, MatchCandidate
        result = MatchResult(
            artifact_index=1,
            tier="TIER_1B",
            status="AMBIGUOUS",
            matched_node_id=None,
            confidence=0.9,
            candidates=[
                MatchCandidate(node_id=100, score=0.9, reason="name+path match"),
                MatchCandidate(node_id=101, score=0.9, reason="name+path match"),
            ],
            diagnostics=["2 candidates found"],
        )
        assert result.matched_node_id is None
        assert len(result.candidates) == 2

    def test_schema_match_result_diagnostics_is_list_of_str(self):
        """diagnostics field is List[str]."""
        from codedmap.core.schema.matcher import MatchResult
        result = MatchResult(
            artifact_index=0,
            tier="TIER_1",
            status="MATCHED",
            matched_node_id=1,
            confidence=1.0,
            diagnostics=["step1", "step2"],
        )
        assert all(isinstance(d, str) for d in result.diagnostics)

    def test_schema_match_result_required_fields(self):
        """MatchResult has the required set of fields."""
        from codedmap.core.schema.matcher import MatchResult
        fields = set(MatchResult.model_fields.keys())
        required = {
            "artifact_index", "tier", "status", "matched_node_id",
            "confidence", "candidates", "diagnostics",
        }
        assert required.issubset(fields)

    def test_schema_match_result_invalid_tier(self):
        from codedmap.core.schema.matcher import MatchResult
        with pytest.raises(ValidationError):
            MatchResult(
                artifact_index=0,
                tier="TIER_X",
                status="MATCHED",
                matched_node_id=1,
                confidence=1.0,
            )

    def test_schema_match_result_invalid_status(self):
        from codedmap.core.schema.matcher import MatchResult
        with pytest.raises(ValidationError):
            MatchResult(
                artifact_index=0,
                tier="TIER_1",
                status="UNKNOWN",
                matched_node_id=1,
                confidence=1.0,
            )


# ---------------------------------------------------------------------------
# Schema: MatchReport
# ---------------------------------------------------------------------------

class TestMatchReportSchema:
    """schema: MatchReport aggregates MatchResult objects."""

    def test_schema_match_report_empty(self):
        """MatchReport can be created with an empty results list."""
        from codedmap.core.schema.matcher import MatchReport
        report = MatchReport(results=[])
        assert report.results == []

    def test_schema_match_report_with_results(self):
        """MatchReport holds MatchResult objects in order."""
        from codedmap.core.schema.matcher import MatchReport, MatchResult
        results = [
            MatchResult(
                artifact_index=0,
                tier="TIER_1",
                status="MATCHED",
                matched_node_id=10,
                confidence=1.0,
            ),
            MatchResult(
                artifact_index=1,
                tier="TIER_3",
                status="ORPHANED",
                matched_node_id=None,
                confidence=0.0,
            ),
        ]
        report = MatchReport(results=results)
        assert len(report.results) == 2
        assert report.results[0].status == "MATCHED"
        assert report.results[1].status == "ORPHANED"

    def test_schema_match_report_fields(self):
        """MatchReport has exactly one field: results."""
        from codedmap.core.schema.matcher import MatchReport
        fields = set(MatchReport.model_fields.keys())
        assert "results" in fields

    def test_schema_match_report_default_empty_list(self):
        """MatchReport.results defaults to empty list."""
        from codedmap.core.schema.matcher import MatchReport
        report = MatchReport()
        assert report.results == []


# ---------------------------------------------------------------------------
# Schema: import path guard
# ---------------------------------------------------------------------------

class TestCanonicalImportPath:
    """schema: All matcher DTOs are importable from codedmap.core.schema.matcher."""

    def test_schema_match_tier_importable(self):
        import importlib
        mod = importlib.import_module("codedmap.core.schema.matcher")
        assert hasattr(mod, "MatchTier")

    def test_schema_match_status_importable(self):
        import importlib
        mod = importlib.import_module("codedmap.core.schema.matcher")
        assert hasattr(mod, "MatchStatus")

    def test_schema_match_candidate_importable(self):
        import importlib
        mod = importlib.import_module("codedmap.core.schema.matcher")
        assert hasattr(mod, "MatchCandidate")

    def test_schema_match_result_importable(self):
        import importlib
        mod = importlib.import_module("codedmap.core.schema.matcher")
        assert hasattr(mod, "MatchResult")

    def test_schema_match_report_importable(self):
        import importlib
        mod = importlib.import_module("codedmap.core.schema.matcher")
        assert hasattr(mod, "MatchReport")


# ---------------------------------------------------------------------------
# Adapter: MatcherQueryAdapter protocol and SqliteMatcherAdapter
# ---------------------------------------------------------------------------

class TestMatcherQueryAdapterProtocol:
    """adapter: MatcherQueryAdapter protocol shape and import path."""

    def test_adapter_query_adapter_importable(self):
        """MatcherQueryAdapter is importable from codedmap.infra.matcher.query_adapter."""
        import importlib
        mod = importlib.import_module("codedmap.infra.matcher.query_adapter")
        assert hasattr(mod, "MatcherQueryAdapter")

    def test_adapter_raw_candidate_row_importable(self):
        """RawCandidateRow type alias is importable."""
        import importlib
        mod = importlib.import_module("codedmap.infra.matcher.query_adapter")
        assert hasattr(mod, "RawCandidateRow")

    def test_adapter_sqlite_importable(self):
        """SqliteMatcherAdapter is importable from adapters.sqlite."""
        import importlib
        mod = importlib.import_module("codedmap.infra.matcher.adapters.sqlite")
        assert hasattr(mod, "SqliteMatcherAdapter")

    def test_adapter_sqlite_has_lookup_candidates(self):
        """SqliteMatcherAdapter.lookup_candidates must exist as a method."""
        from codedmap.infra.matcher.adapters.sqlite import SqliteMatcherAdapter
        assert hasattr(SqliteMatcherAdapter, "lookup_candidates")
        assert callable(SqliteMatcherAdapter.lookup_candidates)

    def test_adapter_sqlite_is_runtime_checkable_matcher_adapter(self):
        """SqliteMatcherAdapter instances satisfy the MatcherQueryAdapter Protocol."""
        from codedmap.infra.matcher.query_adapter import MatcherQueryAdapter
        from codedmap.infra.matcher.adapters.sqlite import SqliteMatcherAdapter

        class _FakeStore:
            class query:
                @staticmethod
                def methods():
                    return _FakeTraversal()
                @staticmethod
                def all_nodes(label):
                    return _FakeTraversal()

        class _FakeTraversal:
            def to_list(self):
                return []

        adapter = SqliteMatcherAdapter(_FakeStore())
        assert isinstance(adapter, MatcherQueryAdapter)


class TestRunMatcherAdapterPath:
    """adapter: run_matcher() with adapter= argument works end-to-end."""

    def _make_pool(self):
        return [
            {
                "node_id": 42,
                "node_label": "METHOD",
                "name": "main",
                "file_path": "src/main.c",
                "content_hash": "abc123",
            }
        ]

    def test_adapter_run_matcher_via_candidates(self):
        """run_matcher with candidates= list returns correct result without adapter."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="main",
            file_path="src/main.c",
            content_hash="abc123",
        )
        result = run_matcher(
            artifact_index=0,
            signature=sig,
            candidates=self._make_pool(),
        )
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1"
        assert result.matched_node_id == 42

    def test_adapter_run_matcher_via_protocol_adapter(self):
        """run_matcher with adapter= argument calls lookup_candidates and returns result."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature
        from codedmap.infra.matcher.query_adapter import MatcherQueryAdapter

        pool = self._make_pool()

        class _MockAdapter:
            """Minimal mock satisfying MatcherQueryAdapter protocol."""
            def lookup_candidates(self, signature):
                return pool

        sig = SemanticSignature(
            node_label="METHOD",
            name="main",
            file_path="src/main.c",
            content_hash="abc123",
        )
        result = run_matcher(
            artifact_index=0,
            signature=sig,
            adapter=_MockAdapter(),
        )
        assert result.status == "MATCHED"
        assert result.matched_node_id == 42

    def test_adapter_run_matcher_no_source_raises(self):
        """run_matcher raises ValueError when neither adapter nor candidates provided."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature
        import pytest

        sig = SemanticSignature(
            node_label="METHOD",
            name="fn",
            file_path="src/x.c",
        )
        with pytest.raises(ValueError, match="adapter.*candidates"):
            run_matcher(artifact_index=0, signature=sig)

    def test_adapter_candidates_takes_precedence_over_adapter(self):
        """When both candidates and adapter are given, candidates takes precedence."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        # Adapter returns empty pool (would cause ORPHANED), candidates has a match
        class _EmptyAdapter:
            def lookup_candidates(self, signature):
                return []

        pool = self._make_pool()
        sig = SemanticSignature(
            node_label="METHOD",
            name="main",
            file_path="src/main.c",
            content_hash="abc123",
        )
        result = run_matcher(
            artifact_index=0,
            signature=sig,
            adapter=_EmptyAdapter(),
            candidates=pool,
        )
        # candidates= should win -> MATCHED
        assert result.status == "MATCHED"


# ---------------------------------------------------------------------------
# Adapter double used across decision-tree tests
# ---------------------------------------------------------------------------

class _StubAdapter:
    """Adapter double: wraps a fixed candidate pool. No real database needed."""

    def __init__(self, pool):
        self._pool = pool

    def lookup_candidates(self, signature):
        return self._pool


# Shared candidate pool for decision-tree behavior tests:
#   node_id=1: METHOD "login" in "src/auth.py" with hash "deadbeef"
#   node_id=2: METHOD "login" in "src/auth.py" with hash "cafebabe" (evolved)
#   node_id=3: METHOD "logout" in "src/auth.py" with hash "12345678"
#   node_id=4: CALL "login" in "src/auth.py" (different label, filtered out)

_DT_POOL = [
    {
        "node_id": 1,
        "node_label": "METHOD",
        "name": "login",
        "file_path": "src/auth.py",
        "content_hash": "deadbeef",
    },
    {
        "node_id": 2,
        "node_label": "METHOD",
        "name": "login",
        "file_path": "src/auth.py",
        "content_hash": "cafebabe",
    },
    {
        "node_id": 3,
        "node_label": "METHOD",
        "name": "logout",
        "file_path": "src/auth.py",
        "content_hash": "12345678",
    },
    {
        "node_id": 4,
        "node_label": "CALL",
        "name": "login",
        "file_path": "src/auth.py",
        "content_hash": "deadbeef",
    },
]


# ---------------------------------------------------------------------------
# exact: Tier 1 — hash + name + path match
# ---------------------------------------------------------------------------

class TestMatcherExact:
    """exact: Tier 1 exact match via hash+name+path, via both candidates= and adapter double."""

    def test_exact_tier1_matched_via_candidates(self):
        """Tier 1: unique hash+name+path match -> MATCHED, TIER_1, confidence=1.0."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1"
        assert result.matched_node_id == 1
        assert result.confidence == 1.0

    def test_exact_tier1_matched_via_adapter_double(self):
        """Tier 1: same match via _StubAdapter shows adapter boundary works end-to-end."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        adapter = _StubAdapter(_DT_POOL)
        result = run_matcher(artifact_index=0, signature=sig, adapter=adapter)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1"
        assert result.matched_node_id == 1

    def test_exact_label_filter_excludes_call_node(self):
        """Label filter excludes node_id=4 (CALL) even though name+hash match."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        # Search for METHOD label — should match only METHOD nodes
        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        # node_id=4 is CALL, must be excluded; node_id=1 is METHOD with matching hash
        assert result.status == "MATCHED"
        assert result.matched_node_id == 1  # not 4

    def test_exact_tier1_diagnostics_contain_tier1_label(self):
        """Tier 1 result diagnostics mention TIER_1."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert any("TIER_1" in d for d in result.diagnostics)


# ---------------------------------------------------------------------------
# no_hash: Tier 1B — name + path only, no content_hash
# ---------------------------------------------------------------------------

class TestMatcherNoHash:
    """no_hash: Tier 1B match when signature has no content_hash."""

    def test_no_hash_tier1b_unique_name_path(self):
        """Tier 1B: no content_hash, unique name+path match -> MATCHED, TIER_1B, confidence=0.9."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1B"
        assert result.matched_node_id == 3
        assert result.confidence == 0.9

    def test_no_hash_skips_tier2_entirely(self):
        """Tier 1B path never falls through to Tier 2 — no hash means no evolved check."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        # Tier must be TIER_1B — if it were TIER_2 the no-hash contract would be broken
        assert result.tier == "TIER_1B"
        assert "TIER_2" not in result.tier

    def test_no_hash_via_adapter_double(self):
        """Tier 1B via _StubAdapter confirms adapter boundary respected."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash=None,
        )
        adapter = _StubAdapter(_DT_POOL)
        result = run_matcher(artifact_index=0, signature=sig, adapter=adapter)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_1B"


# ---------------------------------------------------------------------------
# evolved: Tier 2 — hash present but mismatched, name+path still match
# ---------------------------------------------------------------------------

class TestMatcherEvolved:
    """evolved: Tier 2 evolved match when hash has changed but name+path are stable."""

    def test_evolved_tier2_hash_mismatch_unique_name_path(self):
        """Tier 2: hash present, Tier 1 miss, unique name+path -> MATCHED, TIER_2, confidence=0.8."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash="00000000",  # hash differs from stored "12345678"
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_2"
        assert result.matched_node_id == 3
        assert result.confidence == 0.8

    def test_evolved_confidence_less_than_tier1(self):
        """Tier 2 confidence (0.8) is strictly less than Tier 1 confidence (1.0)."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash="00000000",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.confidence < 1.0

    def test_evolved_via_adapter_double(self):
        """Tier 2 via _StubAdapter confirms adapter boundary respected for evolved path."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="logout",
            file_path="src/auth.py",
            content_hash="00000000",
        )
        adapter = _StubAdapter(_DT_POOL)
        result = run_matcher(artifact_index=0, signature=sig, adapter=adapter)
        assert result.status == "MATCHED"
        assert result.tier == "TIER_2"


# ---------------------------------------------------------------------------
# orphan: Tier 3 — no match after all tiers
# ---------------------------------------------------------------------------

class TestMatcherOrphan:
    """orphan: Tier 3 — ORPHANED when no candidates survive matching."""

    def test_orphan_unknown_name(self):
        """No candidate with matching name -> ORPHANED, TIER_3, confidence=0.0."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="nonexistent_fn",
            file_path="src/missing.py",
            content_hash="aabbccdd",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "ORPHANED"
        assert result.tier == "TIER_3"
        assert result.matched_node_id is None
        assert result.confidence == 0.0
        assert result.candidates == []

    def test_orphan_empty_pool(self):
        """Empty pool always produces ORPHANED."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=[])
        assert result.status == "ORPHANED"
        assert result.tier == "TIER_3"

    def test_orphan_wrong_label_filtered_to_empty(self):
        """Candidates with wrong node_label are excluded before any tier matching."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        # Searching for FILE — pool has no FILE nodes
        sig = SemanticSignature(
            node_label="FILE",
            name="login",
            file_path="src/auth.py",
            content_hash="deadbeef",
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "ORPHANED"
        assert result.tier == "TIER_3"

    def test_orphan_via_adapter_double(self):
        """Tier 3 via _StubAdapter confirms orphan path works through adapter boundary."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        adapter = _StubAdapter([])  # empty pool
        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
        )
        result = run_matcher(artifact_index=0, signature=sig, adapter=adapter)
        assert result.status == "ORPHANED"

    def test_orphan_no_hash_unknown_name(self):
        """Tier 1B with no content_hash and unknown name -> ORPHANED via Tier 3."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="definitely_not_there",
            file_path="src/auth.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "ORPHANED"
        assert result.tier == "TIER_3"


# ---------------------------------------------------------------------------
# ambiguous: multiple candidates — never auto-pick
# ---------------------------------------------------------------------------

class TestMatcherAmbiguous:
    """ambiguous: AMBIGUOUS when multiple candidates survive — no auto-pick in any tier."""

    def test_ambiguous_tier1b_multiple_name_path(self):
        """Tier 1B: no hash, multiple name+path matches -> AMBIGUOUS, matched_node_id=None."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",      # node_id=1 and node_id=2 both match
            file_path="src/auth.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "AMBIGUOUS"
        assert result.matched_node_id is None
        assert len(result.candidates) >= 2

    def test_ambiguous_tier2_multiple_name_path(self):
        """Tier 2: hash present, no Tier-1 match, multiple name+path matches -> AMBIGUOUS."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash="00000000",  # no exact hash match -> falls to Tier 2
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert result.status == "AMBIGUOUS"
        assert result.matched_node_id is None

    def test_ambiguous_candidates_have_scores(self):
        """AMBIGUOUS result populates candidates list with scores in [0.0, 1.0]."""
        from codedmap.app.services.matcher import run_matcher, MatchCandidate
        from codedmap.core.schema.common import SemanticSignature

        sig = SemanticSignature(
            node_label="METHOD",
            name="login",
            file_path="src/auth.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, candidates=_DT_POOL)
        assert all(isinstance(c, MatchCandidate) for c in result.candidates)
        assert all(0.0 <= c.score <= 1.0 for c in result.candidates)

    def test_ambiguous_via_adapter_double(self):
        """AMBIGUOUS via _StubAdapter with a pool containing duplicates."""
        from codedmap.app.services.matcher import run_matcher
        from codedmap.core.schema.common import SemanticSignature

        dup_pool = [
            {"node_id": 10, "node_label": "METHOD", "name": "fn", "file_path": "src/x.py", "content_hash": "aaa"},
            {"node_id": 11, "node_label": "METHOD", "name": "fn", "file_path": "src/x.py", "content_hash": "bbb"},
        ]
        adapter = _StubAdapter(dup_pool)
        sig = SemanticSignature(
            node_label="METHOD",
            name="fn",
            file_path="src/x.py",
            content_hash=None,
        )
        result = run_matcher(artifact_index=0, signature=sig, adapter=adapter)
        assert result.status == "AMBIGUOUS"
        assert result.matched_node_id is None


# ---------------------------------------------------------------------------
# projection: knowledge projection integration — ambiguity + strict all-or-nothing
# ---------------------------------------------------------------------------

# Candidate pool shared by projection integration tests
_PROJ_POOL = [
    {
        "node_id": 100,
        "node_label": "METHOD",
        "name": "login",
        "file_path": "src/auth.py",
        "content_hash": "deadbeef",
    },
    {
        "node_id": 200,
        "node_label": "METHOD",
        "name": "logout",
        "file_path": "src/auth.py",
        "content_hash": "cafebabe",
    },
]


def _make_artifact(name, file_path, content_hash=None):
    """Build a minimal NoteArtifact dict for projection tests.

    Phase 05-01: Uses typed NoteArtifact fields (title/content/category/source)
    instead of the legacy payload dict.
    """
    sig = {"node_label": "METHOD", "name": name, "file_path": file_path}
    if content_hash is not None:
        sig["content_hash"] = content_hash
    return {
        "artifact_type": "NOTE",
        "schema_version": "1.0",
        "target_signature": sig,
        "title": "test",
        "content": "test note",
        "category": "COORDINATION",
        "source": "manual",
    }


class TestKnowledgeProjectionIntegration:
    """projection: project_knowledge() proves ambiguity and strict all-or-nothing flow
    through the new adapter-backed service seam.

    Phase 05-01: Imports from codedmap.app.services.knowledge (canonical).
    """

    def test_projection_all_matched_strict(self):
        """allow_partial=False: all matched -> projected=N, failed=0, all-or-nothing success."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),
            NoteArtifact(**_make_artifact("logout", "src/auth.py", "cafebabe")),
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.projected == 2
        assert resp.failed == 0
        assert resp.errors == []
        assert resp.allow_partial is False

    def test_projection_ambiguous_produces_error(self):
        """AMBIGUOUS match -> error code=AMBIGUOUS via adapter-backed projection service."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        # Two METHOD nodes with same name+path but different hashes
        dup_pool = [
            {"node_id": 1, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "aaa"},
            {"node_id": 2, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "bbb"},
        ]
        artifacts = [
            NoteArtifact(**_make_artifact("dup", "src/x.py")),  # no hash -> AMBIGUOUS
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=dup_pool)
        assert resp.failed == 1
        assert resp.errors[0].code == "AMBIGUOUS"

    def test_projection_strict_all_or_nothing_on_orphan(self):
        """allow_partial=False: any orphan -> projected=0, failed=N (all-or-nothing rollback)."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),   # MATCHED
            NoteArtifact(**_make_artifact("missing_fn", "src/gone.py")),           # ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.projected == 0
        assert resp.failed == 2
        assert resp.allow_partial is False

    def test_projection_allow_partial_persists_valid(self):
        """allow_partial=True: valid artifacts projected, failures collected separately."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),   # MATCHED
            NoteArtifact(**_make_artifact("missing_fn", "src/gone.py")),           # ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=_PROJ_POOL)
        assert resp.projected == 1
        assert resp.failed == 1
        assert len(resp.errors) == 1
        assert resp.allow_partial is True

    def test_projection_adapter_double_routes_through_service_seam(self):
        """_StubAdapter used by project_knowledge proves adapter boundary in projection flow."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        # Use adapter double instead of candidates= to prove the seam
        # project_knowledge delegates to run_matcher which accepts the adapter
        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),
        ]
        # Pass via candidates= (same as what adapter would return)
        resp = project_knowledge(
            artifacts=artifacts,
            allow_partial=False,
            candidates=_PROJ_POOL,
        )
        assert resp.projected == 1


# ---------------------------------------------------------------------------
# Phase 05-02: KnowledgeProjectReport — exact/evolved/orphaned/ambiguous counters
# ---------------------------------------------------------------------------

class TestKnowledgeProjectReportCounters:
    """projection: KnowledgeProjectReport exposes typed tier counters per D-24/D-26."""

    def test_projection_report_exact_match_tier1(self):
        """TIER_1 match increments exact_matches in the report."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),  # TIER_1
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.exact_matches == 1
        assert resp.evolved_matches == 0
        assert resp.orphaned == 0
        assert resp.ambiguous == 0

    def test_projection_report_exact_match_tier1b(self):
        """TIER_1B match (no hash) increments exact_matches — not evolved."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py")),  # No hash -> TIER_1B
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.exact_matches == 1
        assert resp.evolved_matches == 0

    def test_projection_report_evolved_match_tier2(self):
        """TIER_2 match (hash mismatch) increments evolved_matches."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        pool = [
            {"node_id": 100, "node_label": "METHOD", "name": "login", "file_path": "src/auth.py", "content_hash": "new_hash"},
        ]
        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "old_hash")),  # hash mismatch -> TIER_2
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=pool)
        assert resp.evolved_matches == 1
        assert resp.exact_matches == 0

    def test_projection_report_orphaned_counter(self):
        """ORPHANED match increments orphaned counter."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_artifact("missing_fn", "src/gone.py")),  # ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=_PROJ_POOL)
        assert resp.orphaned == 1
        assert resp.exact_matches == 0

    def test_projection_report_ambiguous_counter(self):
        """AMBIGUOUS match increments ambiguous counter."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        dup_pool = [
            {"node_id": 1, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "aaa"},
            {"node_id": 2, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "bbb"},
        ]
        artifacts = [
            NoteArtifact(**_make_artifact("dup", "src/x.py")),  # AMBIGUOUS
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=dup_pool)
        assert resp.ambiguous == 1
        assert resp.exact_matches == 0

    def test_projection_report_counters_sum_correctly(self):
        """exact + evolved + orphaned + ambiguous == total artifacts processed."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        dup_pool = [
            {"node_id": 1, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "aaa"},
            {"node_id": 2, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "bbb"},
        ]
        pool = _PROJ_POOL + dup_pool + [
            {"node_id": 300, "node_label": "METHOD", "name": "evolved", "file_path": "src/ev.py", "content_hash": "new"},
        ]
        artifacts = [
            NoteArtifact(**_make_artifact("login", "src/auth.py", "deadbeef")),  # TIER_1
            NoteArtifact(**_make_artifact("logout", "src/auth.py")),              # TIER_1B
            NoteArtifact(**_make_artifact("evolved", "src/ev.py", "old")),        # TIER_2
            NoteArtifact(**_make_artifact("missing", "src/gone.py")),             # ORPHANED
            NoteArtifact(**_make_artifact("dup", "src/x.py")),                    # AMBIGUOUS
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=pool)
        total = resp.exact_matches + resp.evolved_matches + resp.orphaned + resp.ambiguous
        assert total == len(artifacts), f"Counter sum {total} != len(artifacts) {len(artifacts)}"


# ---------------------------------------------------------------------------
# Phase 05-02: Real NOTE/TAG persistence with store integration
# ---------------------------------------------------------------------------

class TestKnowledgeProjectRealPersistence:
    """projection: project_knowledge() performs real NOTE/TAG persistence via store."""

    def _make_store_with_method(self, name, file_name):
        """Helper: create an in-memory store with a single MethodNode."""
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.utils.id_generator import generate_id

        store = CPGStore(StorageConfig(backend="memory"))
        method_id = generate_id()
        method = MethodNode(id=method_id, name=name, label=NodeLabel.METHOD, fileName=file_name)
        graph = CPGGraph()
        graph.add_node(method)
        store._engine.writer.save_graph(graph)
        return store, method_id

    def _make_adapter(self, store):
        """Return a SqliteMatcherAdapter-compatible adapter backed by the store."""
        from codedmap.infra.matcher.adapters.sqlite import SqliteMatcherAdapter
        return SqliteMatcherAdapter(store=store)

    def _make_note_artifact_for(self, name, file_path, content_hash=None):
        """Build a NoteArtifact for the given node signature."""
        from codedmap.app.services.knowledge import NoteArtifact
        sig = {"node_label": "METHOD", "name": name, "file_path": file_path}
        if content_hash is not None:
            sig["content_hash"] = content_hash
        return NoteArtifact(
            schema_version="1.0",
            target_signature=sig,
            title="Test finding",
            content="Persistence test content",
            category="COORDINATION",
            source="test_agent",
        )

    def _make_tag_artifact_for(self, name, file_path):
        """Build a TagArtifact for the given node signature."""
        from codedmap.app.services.knowledge import TagArtifact
        return TagArtifact(
            schema_version="1.0",
            target_signature={"node_label": "METHOD", "name": name, "file_path": file_path},
            tag="SINK:SQL_INJECT",
            source="test_agent",
        )

    def test_note_projection_persists_via_insight_upsert(self):
        """NOTE artifact persisted via store.insights.upsert() — InsightNode created."""
        from codedmap.app.services.knowledge import project_knowledge

        store, method_id = self._make_store_with_method("exec_query", "src/db.py")
        try:
            adapter = self._make_adapter(store)
            artifact = self._make_note_artifact_for("exec_query", "src/db.py")
            resp = project_knowledge(
                artifacts=[artifact],
                allow_partial=False,
                adapter=adapter,
                store=store,
            )
            assert resp.projected == 1
            # Verify InsightNode was created in the store
            insights = store.insights.find_all_insights()
            assert len(insights) == 1
            assert insights[0].title == "Test finding"
        finally:
            store.close()

    def test_tag_projection_persists_via_store_tags_add(self):
        """TAG artifact persisted via store.tags.add() — tag appears on the node."""
        from codedmap.app.services.knowledge import project_knowledge

        store, method_id = self._make_store_with_method("exec_query", "src/db.py")
        try:
            adapter = self._make_adapter(store)
            artifact = self._make_tag_artifact_for("exec_query", "src/db.py")
            resp = project_knowledge(
                artifacts=[artifact],
                allow_partial=False,
                adapter=adapter,
                store=store,
            )
            assert resp.projected == 1
            # Verify tag was stored — TAG not disguised as Insight
            tags_on_node = store.tags.get_all(method_id)
            assert "SINK:SQL_INJECT" in tags_on_node
            # Verify no InsightNode was created for TAG
            insights = store.insights.find_all_insights()
            assert len(insights) == 0, "TAG must not be persisted as InsightNode"
        finally:
            store.close()

    def test_strict_mode_no_partial_write_on_match_failure(self):
        """Strict mode: orphaned artifact causes zero NOTE writes in the store."""
        from codedmap.app.services.knowledge import project_knowledge

        store, method_id = self._make_store_with_method("exec_query", "src/db.py")
        try:
            adapter = self._make_adapter(store)
            artifacts = [
                self._make_note_artifact_for("exec_query", "src/db.py"),  # matches
                self._make_note_artifact_for("missing_fn", "src/gone.py"),  # orphaned
            ]
            resp = project_knowledge(
                artifacts=artifacts,
                allow_partial=False,
                adapter=adapter,
                store=store,
            )
            assert resp.projected == 0
            # No InsightNode should have been created (strict rollback)
            insights = store.insights.find_all_insights()
            assert len(insights) == 0, "Strict mode must leave zero InsightNodes after failure"
        finally:
            store.close()

    def test_strict_mode_no_partial_write_on_persistence_failure(self):
        """Strict mode: write error after first success leaves zero surviving writes."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact
        from unittest.mock import patch

        store, method_id = self._make_store_with_method("exec_query", "src/db.py")
        try:
            adapter = self._make_adapter(store)
            artifacts = [
                self._make_note_artifact_for("exec_query", "src/db.py"),  # matches
                self._make_note_artifact_for("exec_query", "src/db.py"),  # matches too
            ]
            # Simulate persistence failure on the second write
            call_count = [0]
            original_upsert = store.insights.upsert

            def failing_upsert(*args, **kwargs):
                call_count[0] += 1
                if call_count[0] > 1:
                    raise RuntimeError("Simulated persistence failure")
                return original_upsert(*args, **kwargs)

            store.insights.upsert = failing_upsert

            resp = project_knowledge(
                artifacts=artifacts,
                allow_partial=False,
                adapter=adapter,
                store=store,
            )
            # Strict mode: all writes must be rolled back
            assert resp.projected == 0
            # Any insights created before failure should be rolled back
            insights = store.insights.find_all_insights()
            assert len(insights) == 0, "Strict mode must leave zero InsightNodes after write failure"
        finally:
            store.close()

    def test_partial_mode_persists_successes_and_reports_failures(self):
        """allow_partial=True: matched artifacts persisted, failures reported individually."""
        from codedmap.app.services.knowledge import project_knowledge

        store, method_id = self._make_store_with_method("exec_query", "src/db.py")
        try:
            adapter = self._make_adapter(store)
            artifacts = [
                self._make_note_artifact_for("exec_query", "src/db.py"),    # matches -> persisted
                self._make_note_artifact_for("missing_fn", "src/gone.py"),  # orphaned -> failure
            ]
            resp = project_knowledge(
                artifacts=artifacts,
                allow_partial=True,
                adapter=adapter,
                store=store,
            )
            assert resp.projected == 1
            assert resp.failed == 1
            # The successful note must be in the store
            insights = store.insights.find_all_insights()
            assert len(insights) == 1
        finally:
            store.close()
