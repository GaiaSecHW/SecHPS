"""Tag provenance tracking: who applied a tag and when.

Provides AppliedBy enum, unified Provenance Pydantic model,
and get_provenance_records() normalizer for multi-source provenance.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class AppliedBy(str, Enum):
    """Who applied a tag to a node."""

    SYSTEM = "system"
    RULE = "rule"
    AI = "ai"
    AGENT = "agent"
    HUMAN = "human"


class Provenance(BaseModel):
    """Universal provenance record for tag application and edge justification.

    Used by TagEngine for L2/L3 tag provenance and collaborative L1 tag attribution.
    Also reusable for module CONTAINS edge justification/confidence (Phase 41).
    """

    model_config = ConfigDict(frozen=True)

    applied_by: AppliedBy
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    justification: Optional[str] = Field(default=None, max_length=255)
    created_by: Optional[str] = None  # e.g. "auditor@tag:add"
    source: Optional[str] = None      # "SYSTEM" | "AGENT" | "HUMAN"
    author_id: Optional[str] = None   # e.g. "claude-3-flash", "entrypoint-detector-v1"


def get_provenance_records(provenance_dict: Dict[str, Any], tag: str) -> List[dict]:
    """Normalize provenance dict entry for *tag* to a list of dicts.

    Handles backward compatibility between:
    - Old shape: Dict[str, dict]  (single record stored as plain dict)
    - New shape: Dict[str, List[dict]]  (multiple records stored as list)

    Returns [] if tag is not present.
    """
    value = provenance_dict.get(tag)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
