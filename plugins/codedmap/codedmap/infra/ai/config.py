# codedmap/infra/ai/config.py
"""
AI Cost Control Configuration.

Provides tiered model selection, budget limits, and mode control
to prevent runaway AI costs during analysis.

Usage:
    from codedmap.infra.ai.config import AIConfig

    config = AIConfig(mode="on_demand", budget_limit=500)
    model = config.get_model("fast")  # → "qwen3-8b"
"""

from typing import Dict, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field


class AIConfig(BaseModel):
    """AI cost control and model selection configuration."""

    model_config = ConfigDict(frozen=False)

    # Tiered model selection — map task complexity to model size
    tier_models: Dict[str, str] = Field(default_factory=lambda: {
        "fast": "qwen3-8b",           # Low-cost: tagging, summary
        "standard": "gpt-4o-mini",     # Standard: type inference, resolution
        "deep": "claude-sonnet-4-5-20250929",  # Deep analysis: vuln verification
    })

    # Budget control
    budget_limit: Optional[int] = Field(
        default=1000,
        description="Max token budget per session (None = unlimited)"
    )
    tokens_used: int = Field(default=0, description="Tokens consumed in current session")

    # Caching
    cache_enabled: bool = Field(default=True, description="Enable AI result caching")
    cache_dir: Optional[str] = Field(default=None, description="Cache directory (None = auto)")

    # Execution mode
    mode: Literal["on_demand", "batch", "disabled"] = Field(
        default="on_demand",
        description="on_demand: AI called per-query; batch: AI runs in pipeline passes; disabled: no AI"
    )

    def get_model(self, tier: str = "standard") -> str:
        """Get model name for a given complexity tier."""
        return self.tier_models.get(tier, self.tier_models.get("standard", "gpt-4o-mini"))

    def check_budget(self, estimated_tokens: int = 0) -> bool:
        """Check if budget allows another AI call."""
        if self.budget_limit is None:
            return True
        return (self.tokens_used + estimated_tokens) <= self.budget_limit

    def record_usage(self, tokens: int):
        """Record token usage."""
        self.tokens_used += tokens

    @property
    def is_enabled(self) -> bool:
        """Whether AI is enabled."""
        return self.mode != "disabled"

    @property
    def is_on_demand(self) -> bool:
        """Whether AI runs in on-demand mode (per-query)."""
        return self.mode == "on_demand"

    @property
    def is_batch(self) -> bool:
        """Whether AI runs in batch mode (pipeline passes)."""
        return self.mode == "batch"
