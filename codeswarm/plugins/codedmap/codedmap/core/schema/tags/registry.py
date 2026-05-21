"""TagRegistry: query and manage tag definitions across all three layers.

The registry loads the frozen L1 ontology at init and allows runtime
registration of L2 (SEMANTIC) and L3 (STATE) tag definitions.
Self-contained: no imports from storage, graph, or node modules.
"""

from typing import Optional

from .layer import TagLayer
from .definition import TagDefinition
from .ontology import L1_ONTOLOGY


class TagRegistry:
    """Central registry for tag schema queries and runtime registration.

    Provides:
        list_ontology() - enumerate all L1 ontology definitions
        get_layer()     - parse a tag string to determine its layer
        is_writable()   - check if a tag layer allows modifications
        register()      - register new L2/L3 tag definitions
        validate()      - check if a tag string is recognized
    """

    def __init__(self) -> None:
        self._ontology: dict[str, TagDefinition] = dict(L1_ONTOLOGY)
        self._registered: dict[str, TagDefinition] = {}

    def list_ontology(self) -> list[TagDefinition]:
        """Return all L1 ontology tag definitions."""
        return list(self._ontology.values())

    def get_layer(self, tag: str) -> Optional[TagLayer]:
        """Parse a colon-separated tag string and return its TagLayer.

        Returns None for legacy flat tags (no colon separator).
        """
        if ":" not in tag:
            return None
        prefix = tag.split(":")[0]
        try:
            return TagLayer(prefix)
        except ValueError:
            return None

    def is_writable(self, tag: str) -> bool:
        """Check if a tag is writable.

        ONTOLOGY layer tags are immutable (False).
        All other tags (SEMANTIC, STATE, legacy) are writable (True).
        """
        layer = self.get_layer(tag)
        if layer == TagLayer.ONTOLOGY:
            return False
        return True

    def register(self, definition: TagDefinition) -> None:
        """Register a new tag definition.

        Raises ValueError if attempting to register an ONTOLOGY tag
        (L1 ontology is frozen and immutable).
        """
        if definition.layer == TagLayer.ONTOLOGY:
            raise ValueError(
                f"Cannot register ONTOLOGY tags: {definition.full_tag}. "
                "L1 ontology is frozen."
            )
        self._registered[definition.full_tag] = definition

    def validate(self, tag: str) -> bool:
        """Check if a tag string is recognized.

        Returns True if the tag matches a known L1 ontology entry,
        a registered L2/L3 definition, or is a valid layered/legacy format.
        """
        # Known ontology tag
        if tag in self._ontology:
            return True
        # Registered tag
        if tag in self._registered:
            return True
        # Valid layered format (has colon and valid layer prefix)
        if ":" in tag:
            layer = self.get_layer(tag)
            return layer is not None
        # Legacy flat tag (accepted but unvalidated)
        return True
