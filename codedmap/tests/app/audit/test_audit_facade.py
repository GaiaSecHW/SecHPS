# tests/app/audit/test_audit_facade.py
"""
Integration tests for AuditFacade.

Tests the full audit workflow using mocked low-level components
(EntryPointDetector, BackwardTracingNavigator, TagEngine).
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from codedmap.app.audit.facade import AuditFacade
from codedmap.app.audit.models import (
    AuditConfig,
    AuditSession,
    Candidate,
    EvidenceBundle,
    EvidencePath,
)
from codedmap.core.schema.security import (
    EntryPoint,
    EntryPointLevel,
    EntryPointCategory,
    TraceHop,
    TracePath,
    TraceResult,
)


def _make_entry_point(
    node_id=1,
    name="recv",
    file="net.c",
    line=42,
    level=EntryPointLevel.L1,
    category=EntryPointCategory.NETWORK_LISTENER,
    rule_name="network_recv",
):
    return EntryPoint(
        node_id=node_id,
        name=name,
        file=file,
        line=line,
        level=level,
        category=category,
        rule_name=rule_name,
    )


def _make_trace_result(
    sink_node_id=1,
    found_controllable=True,
    termination_reason="entry_point",
    depth=3,
):
    hops = [
        TraceHop(node_id=sink_node_id, file="net.c", line=42, code="recv(buf, 1024)", hop_type="sink"),
        TraceHop(node_id=sink_node_id + 1, file="net.c", line=40, code="buf = get_buffer()", hop_type="ddg"),
        TraceHop(node_id=sink_node_id + 2, file="net.c", line=10, code="int main()", hop_type="ddg"),
    ]
    path = TracePath(
        hops=hops[:depth],
        found_controllable=found_controllable,
        termination_reason=termination_reason,
    )
    return TraceResult(
        sink_node_id=sink_node_id,
        paths=[path],
        max_depth_used=10,
        total_paths=1,
    )


class TestScanSurface:
    """Tests for AuditFacade.scan_surface()."""

    def test_returns_candidates_from_detector(self):
        store = MagicMock()
        facade = AuditFacade(store)

        ep1 = _make_entry_point(node_id=1, name="recv")
        ep2 = _make_entry_point(node_id=2, name="accept", line=50)

        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep1, ep2]

        candidates = facade.scan_surface()

        assert len(candidates) == 2
        assert candidates[0].node_id == 1
        assert candidates[0].name == "recv"
        assert candidates[1].node_id == 2

    def test_converts_entry_point_to_candidate(self):
        store = MagicMock()
        facade = AuditFacade(store)

        ep = _make_entry_point(
            node_id=42,
            name="main",
            file="main.c",
            line=10,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="cli_main",
        )

        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        candidates = facade.scan_surface()
        c = candidates[0]

        assert isinstance(c, Candidate)
        assert c.node_id == 42
        assert c.name == "main"
        assert c.file == "main.c"
        assert c.category == "CLI_COMMAND"
        assert c.level == "L2"
        assert c.rule_name == "cli_main"

    def test_filters_by_category(self):
        store = MagicMock()
        config = AuditConfig(categories=["NETWORK_LISTENER"])
        facade = AuditFacade(store)

        ep1 = _make_entry_point(node_id=1, category=EntryPointCategory.NETWORK_LISTENER)
        ep2 = _make_entry_point(node_id=2, category=EntryPointCategory.CLI_COMMAND, name="main")

        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep1, ep2]

        candidates = facade.scan_surface(config=config)
        assert len(candidates) == 1
        assert candidates[0].category == "NETWORK_LISTENER"

    def test_empty_results(self):
        store = MagicMock()
        facade = AuditFacade(store)

        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = []

        candidates = facade.scan_surface()
        assert candidates == []


class TestTraceCandidate:
    """Tests for AuditFacade.trace_candidate()."""

    def test_produces_evidence_bundle(self):
        store = MagicMock()
        facade = AuditFacade(store)

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="network_recv",
        )

        trace_result = _make_trace_result(sink_node_id=1, found_controllable=True)

        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        bundle = facade.trace_candidate(candidate)

        assert isinstance(bundle, EvidenceBundle)
        assert bundle.candidate.node_id == 1
        assert bundle.has_controllable is True
        assert bundle.total_paths == 1
        assert len(bundle.paths) == 1

    def test_evidence_path_details(self):
        store = MagicMock()
        facade = AuditFacade(store)

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="network_recv",
        )

        trace_result = _make_trace_result(sink_node_id=1)
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        bundle = facade.trace_candidate(candidate)
        path = bundle.paths[0]

        assert isinstance(path, EvidencePath)
        assert path.sink_node_id == 1
        assert path.found_controllable is True
        assert path.termination_reason == "entry_point"
        assert len(path.hops) > 0

    def test_no_controllable_input(self):
        store = MagicMock()
        facade = AuditFacade(store)

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="network_recv",
        )

        trace_result = _make_trace_result(found_controllable=False, termination_reason="max_depth")
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        bundle = facade.trace_candidate(candidate)
        assert bundle.has_controllable is False

    def test_respects_config_depth(self):
        store = MagicMock()
        config = AuditConfig(max_trace_depth=5, max_paths_per_sink=3)
        facade = AuditFacade(store, config=config)

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="network_recv",
        )

        trace_result = _make_trace_result()
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        facade.trace_candidate(candidate)

        facade._tracer.trace_to_controllable.assert_called_once_with(
            start_node=1,
            max_depth=5,
            max_paths=3,
        )


class TestCollectEvidence:
    """Tests for AuditFacade.collect_evidence()."""

    def test_full_workflow(self):
        store = MagicMock()
        store.get_node.return_value = MagicMock()
        facade = AuditFacade(store)

        # Mock detector
        ep = _make_entry_point(node_id=1)
        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        # Mock tracer
        trace_result = _make_trace_result(sink_node_id=1, found_controllable=True)
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        # Mock tagger
        facade._tagger = MagicMock()
        mock_result = MagicMock()
        mock_result.action = "added"
        facade._tagger.add.return_value = mock_result

        session = facade.collect_evidence()

        assert isinstance(session, AuditSession)
        assert session.total_candidates == 1
        assert session.total_findings == 1
        assert len(session.bundles) == 1
        assert session.bundles[0].has_controllable is True

    def test_auto_tag_disabled(self):
        store = MagicMock()
        config = AuditConfig(auto_tag=False)
        facade = AuditFacade(store, config=config)

        ep = _make_entry_point(node_id=1)
        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        trace_result = _make_trace_result(found_controllable=True)
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        session = facade.collect_evidence()

        assert session.total_findings == 1
        assert session.tagged_nodes == []  # No tagging because auto_tag=False

    def test_auto_tag_enabled(self):
        store = MagicMock()
        node_mock = MagicMock()
        store.get_node.return_value = node_mock
        config = AuditConfig(auto_tag=True)
        facade = AuditFacade(store, config=config)

        ep = _make_entry_point(node_id=1)
        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        trace_result = _make_trace_result(found_controllable=True)
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        mock_tag_result = MagicMock()
        mock_tag_result.action = "added"
        facade._tagger = MagicMock()
        facade._tagger.add.return_value = mock_tag_result

        session = facade.collect_evidence()

        assert 1 in session.tagged_nodes
        facade._tagger.add.assert_called_once()

    def test_with_pre_discovered_candidates(self):
        store = MagicMock()
        facade = AuditFacade(store, config=AuditConfig(auto_tag=False))

        # Provide candidates directly — detector should NOT be called
        candidates = [
            Candidate(node_id=1, name="recv", file="net.c", line=42,
                      category="network", level="L1", rule_name="net"),
        ]

        trace_result = _make_trace_result(found_controllable=False, termination_reason="max_depth")
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        session = facade.collect_evidence(candidates=candidates)

        assert session.total_candidates == 1
        assert session.total_findings == 0

    def test_trace_failure_handled_gracefully(self):
        store = MagicMock()
        facade = AuditFacade(store, config=AuditConfig(auto_tag=False))

        ep = _make_entry_point(node_id=1)
        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.side_effect = RuntimeError("graph error")

        session = facade.collect_evidence()

        # Failure is handled gracefully - candidate still in bundles with empty evidence
        assert session.total_candidates == 1
        assert session.total_findings == 0
        assert len(session.bundles) == 1
        assert session.bundles[0].has_controllable is False
        assert session.bundles[0].paths == []

    def test_empty_audit(self):
        store = MagicMock()
        facade = AuditFacade(store, config=AuditConfig(auto_tag=False))

        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = []

        session = facade.collect_evidence()

        assert session.total_candidates == 0
        assert session.total_findings == 0
        assert session.bundles == []

    def test_session_serializable(self):
        store = MagicMock()
        facade = AuditFacade(store, config=AuditConfig(auto_tag=False))

        ep = _make_entry_point(node_id=1)
        facade._detector = MagicMock()
        facade._detector.detect_all.return_value = [ep]

        trace_result = _make_trace_result(found_controllable=True)
        facade._tracer = MagicMock()
        facade._tracer.trace_to_controllable.return_value = trace_result

        session = facade.collect_evidence()

        # Must serialize to JSON without error
        import json
        data = json.loads(session.model_dump_json())
        assert data["total_candidates"] == 1
        assert data["total_findings"] == 1


class TestApplyState:
    """Tests for AuditFacade.apply_state()."""

    def test_tags_finding_nodes(self):
        store = MagicMock()
        node_mock = MagicMock()
        store.get_node.return_value = node_mock
        facade = AuditFacade(store)

        mock_tag_result = MagicMock()
        mock_tag_result.action = "added"
        facade._tagger = MagicMock()
        facade._tagger.add.return_value = mock_tag_result

        candidate = Candidate(
            node_id=42, name="recv", file="net.c", line=100,
            category="network", level="L1", rule_name="net",
        )
        bundle = EvidenceBundle(
            candidate=candidate,
            has_controllable=True,
            total_paths=1,
        )
        session = AuditSession(bundles=[bundle], total_findings=1)

        tagged = facade.apply_state(session)

        assert 42 in tagged
        facade._tagger.add.assert_called_once_with(
            node_mock, "STATE:AUDITED", applied_by="audit_facade",
        )

    def test_skips_non_finding_bundles(self):
        store = MagicMock()
        facade = AuditFacade(store)
        facade._tagger = MagicMock()

        candidate = Candidate(
            node_id=42, name="recv", file="net.c", line=100,
            category="network", level="L1", rule_name="net",
        )
        bundle = EvidenceBundle(
            candidate=candidate,
            has_controllable=False,
        )
        session = AuditSession(bundles=[bundle])

        tagged = facade.apply_state(session)

        assert tagged == []
        facade._tagger.add.assert_not_called()

    def test_custom_tag(self):
        store = MagicMock()
        node_mock = MagicMock()
        store.get_node.return_value = node_mock
        facade = AuditFacade(store)

        mock_tag_result = MagicMock()
        facade._tagger = MagicMock()
        facade._tagger.add.return_value = mock_tag_result

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="net",
        )
        bundle = EvidenceBundle(candidate=candidate, has_controllable=True)
        session = AuditSession(bundles=[bundle])

        facade.apply_state(session, tag="STATE:SUSPICIOUS")

        facade._tagger.add.assert_called_once_with(
            node_mock, "STATE:SUSPICIOUS", applied_by="audit_facade",
        )

    def test_handles_missing_node(self):
        store = MagicMock()
        store.get_node.return_value = None  # Node not found
        facade = AuditFacade(store)
        facade._tagger = MagicMock()

        candidate = Candidate(
            node_id=999, name="gone", file="x.c", line=1,
            category="network", level="L1", rule_name="net",
        )
        bundle = EvidenceBundle(candidate=candidate, has_controllable=True)
        session = AuditSession(bundles=[bundle])

        tagged = facade.apply_state(session)
        assert tagged == []

    def test_handles_tag_error(self):
        store = MagicMock()
        store.get_node.return_value = MagicMock()
        facade = AuditFacade(store)

        facade._tagger = MagicMock()
        facade._tagger.add.side_effect = RuntimeError("tag error")

        candidate = Candidate(
            node_id=1, name="recv", file="net.c", line=42,
            category="network", level="L1", rule_name="net",
        )
        bundle = EvidenceBundle(candidate=candidate, has_controllable=True)
        session = AuditSession(bundles=[bundle])

        tagged = facade.apply_state(session)
        assert tagged == []  # Error handled gracefully


class TestDSLWiring:
    """Tests that AuditFacade is accessible via CPG DSL."""

    def test_cpg_audit_property(self):
        from codedmap.app.query.root import CPG

        store = MagicMock()
        cpg = CPG(store)

        # audit property should return an AuditFacade instance
        audit = cpg.audit
        assert isinstance(audit, AuditFacade)

    def test_cpg_audit_cached(self):
        from codedmap.app.query.root import CPG

        store = MagicMock()
        cpg = CPG(store)

        # Should return the same instance on repeated access
        audit1 = cpg.audit
        audit2 = cpg.audit
        assert audit1 is audit2
