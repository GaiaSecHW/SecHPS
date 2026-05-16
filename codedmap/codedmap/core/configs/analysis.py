"""Analysis engine configuration for CPG SDK."""
from typing import Literal
from pydantic import BaseModel, Field


class AnalysisConfig(BaseModel):

    runner_type: Literal["thread", "process", "sequential"] = Field(
        default="process",  # [Default Change] 默认改为 process 以支持 Map-Reduce
        description="Execution strategy for Global Analysis Passes. Use 'process' for CPU-bound tasks like CallGraph."
    )
    max_workers: int = Field(
        default=4,
        description="Max concurrency for Analysis Runner (Global Passes)"
    )

    """分析引擎参数"""
    max_call_depth: int = Field(default=5, description="Context sensitive analysis depth (k-CFA)")
    slicing_depth: int = Field(default=20, description="Max depth for slicing BFS")
    check_taint_sanitizers: bool = True
