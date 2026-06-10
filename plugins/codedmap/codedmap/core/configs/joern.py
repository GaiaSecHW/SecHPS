"""Joern CPG import configuration for CPG SDK."""
from pathlib import Path
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class JoernImportConfig(BaseModel):
    """Joern CPG 导入配置"""
    enabled: bool = Field(
        default=False,
        description="Enable Joern CSV import as the ingestion source."
    )
    export_dir: Optional[Path] = Field(
        default=None,
        description="Path to the Joern neo4jcsv export directory containing nodes.csv and edges.csv."
    )
    export_format: Literal["neo4jcsv"] = Field(
        default="neo4jcsv",
        description="Joern export format. Currently only 'neo4jcsv' is supported."
    )
    id_strategy: Literal["regenerate", "passthrough", "hybrid"] = Field(
        default="hybrid",
        description="ID translation strategy. 'hybrid' regenerates global node IDs for merge compatibility."
    )
    skip_unknown_labels: bool = Field(
        default=False,
        description="If True, skip nodes with labels not in codedmap. If False, use GenericNode fallback."
    )
    skip_edge_types: List[str] = Field(
        default_factory=list,
        description="Edge types to skip during import (e.g., ['DOMINATE', 'POST_DOMINATE'])."
    )
    batch_size: int = Field(
        default=5000,
        description="Batch size for store writes during import."
    )
