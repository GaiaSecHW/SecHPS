"""Smart dispatch strategy configuration for CPG SDK."""
from typing import List
from pydantic import BaseModel, Field


class DispatchConfig(BaseModel):
    """
    智能调度策略配置
    """
    critical_paths: List[str] = Field(
        default=[
            r"drivers/net/.*",
            r"kernel/bpf/.*",
            r"security/.*",
            r"net/.*"
        ],
        description="Regex patterns for files that MUST be FULL parsed"
    )

    ignore_paths: List[str] = Field(
        default=[
            r".*/tests?/.*",
            r".*/docs?/.*",
            r"tools/.*",
            r"samples/.*",
            r"Documentation/.*"
        ],
        description="Regex patterns for files to IGNORE"
    )

    sensitive_keywords: List[str] = Field(
        default=[
            "copy_from_user", "get_user", "__user",
            "sk_buff", "socket", "kvm_run", "bpf_context"
        ],
        description="Keywords that trigger FULL parsing if found in file head"
    )
