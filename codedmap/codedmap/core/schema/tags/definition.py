"""TagDefinition Pydantic model for structured tag metadata.

Each tag definition captures its layer, namespace, name, and optional
provenance fields (confidence, applied_by, source, created_at).
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from .layer import TagLayer


class TagDefinition(BaseModel):
    """Immutable tag definition with layer, namespace, name, and provenance.

    The full_tag property produces the canonical colon-separated string
    format used for storage in CPGNode.tags (List[str]).

    Examples:
        ONTOLOGY:SOURCE:USER_INPUT
        SEMANTIC:AUTH:PASSWORD_HASH
        STATE:CUSTOM:NEEDS_REFACTOR
    """

    model_config = ConfigDict(frozen=True)

    layer: TagLayer
    namespace: str
    name: str
    description: str = ""

    # L2 Semantic provenance fields
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    applied_by: Optional[str] = None
    source: Optional[str] = None
    created_at: Optional[datetime] = None

    @property
    def full_tag(self) -> str:
        """Canonical colon-separated tag string: LAYER:NAMESPACE:NAME."""
        return f"{self.layer.value}:{self.namespace}:{self.name}"
