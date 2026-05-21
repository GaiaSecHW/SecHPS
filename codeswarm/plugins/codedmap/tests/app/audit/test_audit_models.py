# tests/app/audit/test_audit_models.py
"""
Unit tests for audit domain models.

Tests model construction, serialization, schema generation,
and validation for all audit Pydantic models.
"""

import sys
import os
sys.path.append(os.getcwd())

import pytest
import json

from codedmap.app.audit.models import (
    AuditConfig,
    AuditEvent,
    Candidate,
    EvidencePath,
    EvidenceBundle,
    AuditSession,
)


class TestAuditConfig:

    def test_default_values(self):
        config = AuditConfig()
        assert config.max_trace_depth == 10
        assert config.max_paths_per_sink == 10
        assert config.categories is None
        assert config.include_context is False
        assert config.auto_tag is True

    def test_custom_values(self):
        config = AuditConfig(
            max_trace_depth=5,
            max_paths_per_sink=3,
            categories=["network", "cli"],
            include_context=True,
            auto_tag=False,
        )
        assert config.max_trace_depth == 5
        assert config.categories == ["network", "cli"]

    def test_json_serialization(self):
        config = AuditConfig(max_trace_depth=20)
        data = json.loads(config.model_dump_json())
        assert data["max_trace_depth"] == 20
        assert data["auto_tag"] is True

    def test_json_schema(self):
        schema = AuditConfig.model_json_schema()
        assert "properties" in schema
        assert "max_trace_depth" in schema["properties"]

    def test_validation_min_depth(self):
        with pytest.raises(Exception):
            AuditConfig(max_trace_depth=0)

    def test_validation_max_depth(self):
        with pytest.raises(Exception):
            AuditConfig(max_trace_depth=200)


class TestAuditEvent:

    def test_construction(self):
        event = AuditEvent(
            actor_id="service",
            actor_type="system",
            operation="tag_add",
            target_kind="node_tag",
            target_id=42,
            field="tags",
            new_value={"tag": "STATE:REVIEWED"},
            status="applied",
        )
        assert event.actor_id == "service"
        assert event.target_kind == "node_tag"
        assert event.event_id
        assert event.timestamp

    def test_json_roundtrip(self):
        event = AuditEvent(
            actor_id="auditor",
            actor_type="human",
            source="cli.tag.add",
            operation="tag_add",
            target_kind="node_tag",
            target_id=7,
            target_label="recv",
            field="tags",
            old_value=None,
            new_value={"tag": "STATE:AUDITED"},
            status="applied",
            reason="manual review",
        )
        data = json.loads(event.model_dump_json())
        restored = AuditEvent.model_validate(data)
        assert restored.actor_id == "auditor"
        assert restored.new_value == {"tag": "STATE:AUDITED"}


class TestCandidate:

    def test_construction(self):
        c = Candidate(
            node_id=42,
            name="recv",
            file="net.c",
            line=100,
            category="network",
            level="L1",
            rule_name="network_recv",
        )
        assert c.node_id == 42
        assert c.name == "recv"
        assert c.tags == []

    def test_with_tags(self):
        c = Candidate(
            node_id=1,
            name="main",
            file="main.c",
            line=1,
            category="cli",
            level="L1",
            rule_name="cli_main",
            tags=["ONTOLOGY:ENTRY_POINT:CLI"],
        )
        assert c.tags == ["ONTOLOGY:ENTRY_POINT:CLI"]

    def test_json_roundtrip(self):
        c = Candidate(
            node_id=42,
            name="recv",
            file="net.c",
            line=100,
            category="network",
            level="L1",
            rule_name="network_recv",
        )
        data = json.loads(c.model_dump_json())
        c2 = Candidate.model_validate(data)
        assert c2.node_id == c.node_id
        assert c2.name == c.name

    def test_json_schema(self):
        schema = Candidate.model_json_schema()
        assert "node_id" in schema["properties"]
        assert "category" in schema["properties"]


class TestEvidencePath:

    def test_empty_path(self):
        p = EvidencePath(sink_node_id=10)
        assert p.sink_node_id == 10
        assert p.hops == []
        assert p.found_controllable is False
        assert p.depth == 0

    def test_full_path(self):
        p = EvidencePath(
            sink_node_id=10,
            sink_name="recv",
            sink_file="net.c",
            sink_line=42,
            hops=[
                {"node_id": 10, "file": "net.c", "line": 42, "code": "recv(buf)", "hop_type": "sink"},
                {"node_id": 11, "file": "net.c", "line": 40, "code": "buf = ...", "hop_type": "ddg"},
            ],
            found_controllable=True,
            termination_reason="entry_point",
            depth=2,
        )
        assert p.found_controllable is True
        assert p.depth == 2
        assert len(p.hops) == 2

    def test_json_roundtrip(self):
        p = EvidencePath(
            sink_node_id=10,
            sink_name="recv",
            found_controllable=True,
            termination_reason="source",
            depth=3,
        )
        data = json.loads(p.model_dump_json())
        p2 = EvidencePath.model_validate(data)
        assert p2.found_controllable is True


class TestEvidenceBundle:

    def _make_candidate(self):
        return Candidate(
            node_id=42,
            name="recv",
            file="net.c",
            line=100,
            category="network",
            level="L1",
            rule_name="network_recv",
        )

    def test_empty_bundle(self):
        c = self._make_candidate()
        b = EvidenceBundle(candidate=c)
        assert b.candidate.node_id == 42
        assert b.paths == []
        assert b.has_controllable is False

    def test_bundle_with_finding(self):
        c = self._make_candidate()
        path = EvidencePath(
            sink_node_id=42,
            found_controllable=True,
            termination_reason="entry_point",
            depth=3,
        )
        b = EvidenceBundle(
            candidate=c,
            paths=[path],
            total_paths=1,
            has_controllable=True,
        )
        assert b.has_controllable is True
        assert b.total_paths == 1

    def test_bundle_with_context(self):
        c = self._make_candidate()
        b = EvidenceBundle(
            candidate=c,
            context={"code": "void recv() {...}", "file_path": "net.c"},
        )
        assert b.context is not None
        assert "code" in b.context

    def test_json_roundtrip(self):
        c = self._make_candidate()
        b = EvidenceBundle(candidate=c, total_paths=0)
        data = json.loads(b.model_dump_json())
        b2 = EvidenceBundle.model_validate(data)
        assert b2.candidate.name == "recv"


class TestAuditSession:

    def test_empty_session(self):
        s = AuditSession()
        assert s.bundles == []
        assert s.total_candidates == 0
        assert s.total_findings == 0
        assert s.tagged_nodes == []

    def test_session_with_results(self):
        c = Candidate(
            node_id=1, name="recv", file="net.c", line=10,
            category="network", level="L1", rule_name="net",
        )
        path = EvidencePath(
            sink_node_id=1, found_controllable=True,
            termination_reason="entry_point", depth=2,
        )
        bundle = EvidenceBundle(
            candidate=c, paths=[path], total_paths=1, has_controllable=True,
        )
        s = AuditSession(
            bundles=[bundle],
            total_candidates=1,
            total_findings=1,
            tagged_nodes=[1],
        )
        assert s.total_findings == 1
        assert s.tagged_nodes == [1]

    def test_session_json_roundtrip(self):
        s = AuditSession(total_candidates=5, total_findings=2)
        data = json.loads(s.model_dump_json())
        s2 = AuditSession.model_validate(data)
        assert s2.total_candidates == 5
        assert s2.total_findings == 2

    def test_session_json_schema(self):
        schema = AuditSession.model_json_schema()
        assert "properties" in schema
        assert "bundles" in schema["properties"]
        assert "total_findings" in schema["properties"]

    def test_config_preserved(self):
        config = AuditConfig(max_trace_depth=5, auto_tag=False)
        s = AuditSession(config=config)
        assert s.config.max_trace_depth == 5
        assert s.config.auto_tag is False
