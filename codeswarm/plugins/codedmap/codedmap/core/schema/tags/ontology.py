"""L1 Ontology catalog and L3 State vocabulary.

ONTOLOGY_CATEGORIES defines the frozen set of security-relevant tag
categories organized by namespace. L1_ONTOLOGY is the materialized
dict of TagDefinition objects keyed by full_tag string.

STATE_VOCABULARY defines the pre-defined L3 audit workflow states.

Categories are loaded lazily from YAML via RuleRegistry on first access.
"""

from typing import Optional

from .layer import TagLayer
from .definition import TagDefinition


# Lazy-loaded cache
_ontology_categories: Optional[dict[str, list[str]]] = None
_l1_ontology: Optional[dict[str, TagDefinition]] = None


def _load_categories() -> dict[str, list[str]]:
    """Load ONTOLOGY_CATEGORIES from global YAML rules via RuleRegistry."""
    from codedmap.infra.rules import RuleRegistry
    return RuleRegistry().load().get_ontology_categories()


def _get_ontology_categories() -> dict[str, list[str]]:
    """Get ONTOLOGY_CATEGORIES, loading from YAML on first access."""
    global _ontology_categories
    if _ontology_categories is None:
        _ontology_categories = _load_categories()
    return _ontology_categories


# L3: Pre-defined audit workflow states
STATE_VOCABULARY: list[str] = [
    "REVIEWED",
    "SUSPICIOUS",
    "FALSE_POSITIVE",
    "CONFIRMED_VULN",
]

# Description templates per namespace
_DESCRIPTIONS: dict[str, str] = {
    "SOURCE": "Data source: {}",
    "SINK": "Security-sensitive sink: {}",
    "SANITIZER": "Input sanitizer: {}",
    "ENTRY_POINT": "Program entry point: {}",
    "ROLE": "Architectural role: {}",
}


def _build_ontology(categories: dict[str, list[str]] | None = None) -> dict[str, TagDefinition]:
    """Build the materialized L1 ontology catalog.

    Args:
        categories: Optional categories dict. If None, uses ONTOLOGY_CATEGORIES.
    """
    cats = categories if categories is not None else _get_ontology_categories()
    catalog: dict[str, TagDefinition] = {}
    for namespace, names in cats.items():
        desc_template = _DESCRIPTIONS.get(namespace, "{}")
        for name in names:
            td = TagDefinition(
                layer=TagLayer.ONTOLOGY,
                namespace=namespace,
                name=name,
                description=desc_template.format(name.lower().replace("_", " ")),
            )
            catalog[td.full_tag] = td
    return catalog


def _get_l1_ontology() -> dict[str, TagDefinition]:
    """Get L1_ONTOLOGY, building on first access."""
    global _l1_ontology
    if _l1_ontology is None:
        _l1_ontology = _build_ontology()
    return _l1_ontology


class _LazyDict(dict):
    """A dict that loads its data lazily on first access."""

    def __init__(self, loader):
        super().__init__()
        self._loader = loader
        self._loaded = False

    def _ensure_loaded(self):
        if not self._loaded:
            self._loaded = True
            self.update(self._loader())

    def __getitem__(self, key):
        self._ensure_loaded()
        return super().__getitem__(key)

    def __contains__(self, key):
        self._ensure_loaded()
        return super().__contains__(key)

    def __iter__(self):
        self._ensure_loaded()
        return super().__iter__()

    def __len__(self):
        self._ensure_loaded()
        return super().__len__()

    def items(self):
        self._ensure_loaded()
        return super().items()

    def keys(self):
        self._ensure_loaded()
        return super().keys()

    def values(self):
        self._ensure_loaded()
        return super().values()

    def get(self, key, default=None):
        self._ensure_loaded()
        return super().get(key, default)


# Public API — lazy-loaded on first access to avoid circular imports
ONTOLOGY_CATEGORIES: dict[str, list[str]] = _LazyDict(_load_categories)
L1_ONTOLOGY: dict[str, TagDefinition] = _LazyDict(_build_ontology)
