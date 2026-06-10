"""Pipeline phase control configuration for CPG SDK."""
from pydantic import BaseModel, Field


class PipelineConfig(BaseModel):
    """流水线阶段控制"""
    skip_ingestion: bool = Field(
        default=False,
        description="Skip Phase 1 (Frontend parsing). Use when graph is pre-populated."
    )
    skip_analysis: bool = Field(
        default=False,
        description="Skip Phase 2 (Global batch passes: Linker, CallGraph, PointsTo, PDG). "
                    "Use when importing from Joern/CodeQL which already provide these edges."
    )
    skip_export: bool = Field(
        default=False,
        description="Skip Phase 3 (Neo4j CSV export). Overrides bulk-mode auto-export."
    )
    frontend_batch_size: int = Field(
        default=10,
        description="Number of files per batch task in frontend parsing (ProcessPool)."
    )
