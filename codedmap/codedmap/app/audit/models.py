# codedmap/app/audit/models.py
"""
Audit domain models — Pydantic V2 models for agent-oriented audit workflows.

These models represent the task-oriented abstractions that agents use to
execute the security audit workflow: surface → trace → bundle → state writeback.

All models support:
- model_dump(mode="json") for JSON serialization
- model_json_schema() for programmatic schema discovery
- model_validate() for deserialization
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class AuditConfig(BaseModel):
    """Configuration for an audit session.

    Controls the scope and behavior of the audit workflow.

    Attributes:
        max_trace_depth: Maximum hops for backward tracing (default: 10).
        max_paths_per_sink: Maximum trace paths per sink (default: 10).
        categories: Optional list of entry point categories to include
            (e.g., ["network", "cli"]). None means all categories.
        include_context: If True, enrich evidence bundles with source context.
        auto_tag: If True, automatically apply STATE tags to findings.
    """

    model_config = ConfigDict(frozen=False)

    max_trace_depth: int = Field(default=10, ge=1, le=100)
    max_paths_per_sink: int = Field(default=10, ge=1, le=100)
    categories: Optional[List[str]] = None
    include_context: bool = False
    auto_tag: bool = True


class AuditEvent(BaseModel):
    """Durable audit event for graph mutations."""

    model_config = ConfigDict(frozen=False)

    event_id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    actor_id: str
    actor_type: str
    source: Optional[str] = None
    operation: str
    target_kind: str
    target_id: Optional[int] = None
    target_label: Optional[str] = None
    field: Optional[str] = None
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    status: str = "applied"
    reason: Optional[str] = None


class Candidate(BaseModel):
    """An attack-surface candidate (entry point).

    Represents a function or call site that was identified as an entry point
    into the application — a potential starting point for attacker-controlled
    data to enter the system.

    Attributes:
        node_id: CPG node identifier.
        name: Function or method name.
        file: Source file path.
        line: Line number in source file.
        category: Entry point category (network, cli, data, kernel).
        level: Detection confidence level (L1, L2, L3).
        rule_name: Name of the detection rule that matched.
        tags: Security tags on this node.
    """

    model_config = ConfigDict(frozen=False)

    node_id: int
    name: str
    file: str
    line: int
    category: str
    level: str
    rule_name: str
    tags: List[str] = Field(default_factory=list)


class EvidencePath(BaseModel):
    """A single evidence path from sink to controllable input.

    Represents one traced data-flow path that demonstrates how
    attacker-controlled input can reach a dangerous operation.

    Note: 'evidence' in the audit context means proof of a vulnerability path
    (audit proof), distinct from tag Provenance (which tracks who applied a tag
    and why). See codedmap.core.schema.tags.provenance for tag provenance.

    Attributes:
        sink_node_id: CPG node ID of the sink (dangerous operation).
        sink_name: Name of the sink function.
        sink_file: Source file of the sink.
        sink_line: Line number of the sink.
        hops: Ordered list of trace hops (each is a dict with
            node_id, file, line, code, hop_type).
        found_controllable: Whether this path reaches controllable input.
        termination_reason: Why tracing stopped (entry_point, source,
            parameter, max_depth).
        depth: Number of hops in the path.
    """

    model_config = ConfigDict(frozen=False)

    sink_node_id: int
    sink_name: str = ""
    sink_file: str = ""
    sink_line: int = 0
    hops: List[Dict[str, Any]] = Field(default_factory=list)
    found_controllable: bool = False
    termination_reason: str = ""
    depth: int = 0


class EvidenceBundle(BaseModel):
    """All evidence collected for a single candidate.

    Groups all trace results for one attack-surface candidate,
    summarizing whether controllable input was found.

    Note: 'evidence' in the audit context means proof of a vulnerability path
    (audit proof), distinct from tag Provenance (which tracks who applied a tag
    and why). See codedmap.core.schema.tags.provenance for tag provenance.

    Attributes:
        candidate: The attack-surface candidate this evidence is for.
        paths: List of evidence paths found during tracing.
        total_paths: Total number of paths discovered.
        has_controllable: Whether any path reaches controllable input.
        context: Optional enriched source context (when include_context=True).
    """

    model_config = ConfigDict(frozen=False)

    candidate: Candidate
    paths: List[EvidencePath] = Field(default_factory=list)
    total_paths: int = 0
    has_controllable: bool = False
    context: Optional[Dict[str, Any]] = None


class AuditSession(BaseModel):
    """Top-level result of an audit run.

    Contains all evidence bundles produced by an audit workflow,
    along with summary statistics and configuration used.

    Attributes:
        bundles: List of evidence bundles (one per candidate).
        total_candidates: Total number of attack-surface candidates found.
        total_findings: Number of candidates with at least one controllable path.
        config: The AuditConfig used for this session.
        tagged_nodes: Node IDs that received state tags during writeback.
    """

    model_config = ConfigDict(frozen=False)

    bundles: List[EvidenceBundle] = Field(default_factory=list)
    total_candidates: int = 0
    total_findings: int = 0
    config: AuditConfig = Field(default_factory=AuditConfig)
    tagged_nodes: List[int] = Field(default_factory=list)
