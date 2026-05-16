"""Tag layer enum defining the three-tier tag classification system.

Layer 1 (ONTOLOGY): Frozen catalog of security-relevant tag categories.
Layer 2 (SEMANTIC): Agent/pass-applied tags with confidence and provenance.
Layer 3 (STATE): Human audit workflow state tags.
"""

from enum import Enum


class TagLayer(str, Enum):
    """Three-layer tag classification.

    ONTOLOGY - Immutable catalog of known security categories (sources, sinks, etc.)
    SEMANTIC - Analysis-derived tags with confidence scores and provenance tracking
    STATE    - Audit workflow tags (reviewed, suspicious, confirmed, etc.)
    """

    ONTOLOGY = "ONTOLOGY"
    SEMANTIC = "SEMANTIC"
    STATE = "STATE"
