# codedmap/app/query/models.py
"""
Predefined audit category constants and DTOs for the agent audit API.

Provides:
- Category string constants for common insight types
- InsightSummary Pydantic model for serialization / agent consumption
"""

from typing import Any, Dict, Generic, List, Optional, Tuple, TypeVar
from pydantic import BaseModel, Field, field_validator
T = TypeVar('T')


# ---------------------------------------------------------------------------
# InsightSummary DTO
# ---------------------------------------------------------------------------

class InsightSummary(BaseModel):
    """Lightweight DTO mirroring InsightNode fields for agent consumption."""

    id: Optional[int] = None
    node_ids: List[int] = Field(default_factory=list)
    category: str
    title: str = Field(..., max_length=120)
    content: str
    source: str = Field(default="unknown")
    confidence: Optional[float] = Field(default=None, ge=0, le=1.0)
    status: str = Field(default="active")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v):
        if isinstance(v, str):
            v = v.strip().upper()
        return v


# ---------------------------------------------------------------------------
# Graph Overview / Node Detail / Pagination DTOs
# ---------------------------------------------------------------------------

class GraphOverview(BaseModel):
    """Graph-level statistics for cpg.describe() and cpg stats CLI."""
    total_nodes: int
    total_edges: int = Field(default=-1, description="Total edge count (-1 if unavailable)")
    node_counts: Dict[str, int] = Field(default_factory=dict)
    files: int = 0
    methods: int = 0
    modules: int = 0
    entry_points: int = 0
    insights: int = 0
    languages: List[str] = Field(default_factory=list)
    top_tags: List[Tuple[str, int]] = Field(default_factory=list)


class NodeDetail(BaseModel):
    """Full node inspection result."""
    id: int
    label: str
    name: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    file_path: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    tags: List[str] = Field(default_factory=list)
    parent_id: Optional[int] = None
    children_count: int = 0
    insights_count: int = 0


class PageResult(BaseModel, Generic[T]):
    """Paginated result container."""
    items: List[T]
    total: int
    offset: int
    limit: int
    has_more: bool


# ---------------------------------------------------------------------------
# TacticalStats models (Phase 35)
# ---------------------------------------------------------------------------

class CategoryBreakdown(BaseModel):
    """Attack surface category breakdown with top-N categories."""
    total: int
    top_categories: List[Dict[str, int]] = Field(default_factory=list)
    # e.g. [{"HTTP": 5}, {"SYSCALL": 3}] — each dict has one key


class AuditProgress(BaseModel):
    """Audited/total ratio for a security node type."""
    total: int
    audited: int
    percent: float  # 0.0-100.0, computed as round(audited/total*100, 1) if total>0 else 0.0


class MethodHotSpot(BaseModel):
    """A method ranked by unaudited threat score."""
    node_id: int
    name: str
    file: Optional[str] = None
    line: Optional[int] = None
    score: int  # (unaudited_sinks * 2) + unaudited_sources
    unaudited_sinks: int
    unaudited_sources: int


class TacticalStats(BaseModel):
    """Agent-friendly tactical dashboard replacing GraphOverview for stats command."""
    # Graph header
    total_nodes: int
    total_edges: int = -1
    files: int = 0
    methods: int = 0
    modules: int = 0
    languages: List[str] = Field(default_factory=list)
    # Attack surface
    entry_points: CategoryBreakdown
    sources: CategoryBreakdown
    sinks: CategoryBreakdown
    guards: int = 0
    sanitizers: int = 0
    # Audit progress
    entry_point_audit: AuditProgress
    source_audit: AuditProgress
    sink_audit: AuditProgress
    notes_total: int = 0
    notes_by_category: Dict[str, int] = Field(default_factory=dict)
    repairs_total: int = 0
    # Hot spots
    hot_spots: List[MethodHotSpot] = Field(default_factory=list)
    hot_spots_total_methods: int = 0
    # Drill-down hints
    suggested_commands: List[str] = Field(default_factory=list)
