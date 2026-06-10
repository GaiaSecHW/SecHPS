# codedmap/core/schema/graph/nodes/extensions.py
# AI/vector extensions

from typing import Any, Dict, Optional, List
from pydantic import Field, field_validator

from ..base import CPGNode
from ..enums import NodeLabel


class InsightNode(CPGNode):
    """AI insight / audit note node."""
    label: NodeLabel = NodeLabel.INSIGHT
    category: str = Field(..., description="The domain/aspect of this insight")
    title: str = Field(..., max_length=120, description="Short human-readable title (max 120 chars)")
    content: str = Field(..., description="Detailed analysis content (Markdown)")
    source: str = Field(default="unknown", description="Origin of this insight (pass name, agent, user)")
    confidence: Optional[float] = Field(default=None, ge=0, le=1.0, description="Confidence score 0-1")
    status: str = Field(default="active", description="Lifecycle status (active, archived, superseded)")
    scope: str = Field(default="campaign", description="Knowledge layer scope for this note")
    knowledge_class: str = Field(default="assessment", description="Knowledge semantic class")
    campaign_id: Optional[str] = Field(default=None, description="Run-scoped campaign identifier")
    review_state: str = Field(default="unreviewed", description="Review lifecycle state")
    visibility: str = Field(default="default", description="Workflow visibility policy")
    evidence_bundle: Dict[str, Any] = Field(default_factory=dict, description="Structured reviewable evidence")
    promoted_from: Optional[str] = Field(default=None, description="Source campaign or artifact lineage")
    created_at: Optional[str] = Field(default=None, description="ISO-8601 creation timestamp")
    updated_at: Optional[str] = Field(default=None, description="ISO-8601 last update timestamp")

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v):
        if isinstance(v, str):
            v = v.strip().upper()
        return v


class EmbeddingChunkNode(CPGNode):
    """语义向量分块节点。"""
    label: NodeLabel = NodeLabel.EMBEDDING_CHUNK
    content: str = Field(..., description="The source_code content of this chunk")
    chunk_index: int = Field(default=0)
    source: str = Field(default="unknown", description="Origin source name")


class VectorNode(CPGNode):
    """专门存储向量的节点，用于冷热分离。"""
    embedding: List[float] = Field(..., description="The vector payload")
    model_version: str = Field(default="v1", description="Model used")
    label: NodeLabel = NodeLabel.VECTOR
