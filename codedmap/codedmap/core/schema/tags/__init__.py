"""Tag schema package: three-layer tag classification for CPG nodes.

Public API:
    TagLayer       - Enum: ONTOLOGY, SEMANTIC, STATE
    TagDefinition  - Pydantic model for tag metadata
    TagRegistry    - Query and register tag definitions

Data:
    L1_ONTOLOGY         - Frozen dict of ontology TagDefinitions
    STATE_VOCABULARY     - Pre-defined L3 audit state names
    ONTOLOGY_CATEGORIES  - Raw category dict (namespace -> names)
"""

from .layer import TagLayer
from .definition import TagDefinition
from .registry import TagRegistry
from .ontology import L1_ONTOLOGY, STATE_VOCABULARY, ONTOLOGY_CATEGORIES
from .matcher import SecurityTagMatcher
from .provenance import Provenance, AppliedBy

__all__ = [
    "TagLayer",
    "TagDefinition",
    "TagRegistry",
    "L1_ONTOLOGY",
    "STATE_VOCABULARY",
    "ONTOLOGY_CATEGORIES",
    "SecurityTagMatcher",
    "Provenance",
    "AppliedBy",
]
