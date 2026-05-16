# codedmap/core/schema/security/sink_catalog.py
"""
Sink Catalog with dangerous sink definitions loaded from YAML.

Canonical location for SinkCatalog.
Moved from app/tracing/catalog.py to eliminate analysis→app dependency.

Default sinks are now loaded from YAML via RuleRegistry instead of
hardcoded _create_* methods.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from .sink_models import SinkDefinition, SinkCategory

logger = logging.getLogger(__name__)


@dataclass
class SinkCatalog:
    """
    Collection of dangerous sink function definitions.

    Provides filtering and lookup of sinks by category and language.
    """
    sinks: List[SinkDefinition] = field(default_factory=list)

    def add_sink(self, sink: SinkDefinition) -> None:
        """Add a sink definition to the catalog."""
        self.sinks.append(sink)

    def add_sinks(self, sinks: List[SinkDefinition]) -> None:
        """Add multiple sink definitions to the catalog."""
        self.sinks.extend(sinks)

    def by_category(self, category: SinkCategory) -> List[SinkDefinition]:
        """
        Filter sinks by category.

        Args:
            category: Sink category to filter by

        Returns:
            List of sinks matching the category
        """
        return [s for s in self.sinks if s.category == category]

    def by_language(self, lang: str) -> List[SinkDefinition]:
        """
        Filter sinks by language.

        Args:
            lang: Language to filter by (e.g., "python", "c", "cpp")

        Returns:
            List of sinks that apply to the language
        """
        return [s for s in self.sinks if s.matches_language(lang)]

    def find_by_name(self, name: str) -> Optional[SinkDefinition]:
        """
        Find a sink by function name.

        Performs case-insensitive matching and also checks short names
        (e.g., "recv" matches "socket.recv").

        Args:
            name: Function name to search for

        Returns:
            SinkDefinition if found, None otherwise
        """
        name_lower = name.lower()
        # First try exact match
        for sink in self.sinks:
            if sink.name.lower() == name_lower:
                return sink
        # Also check short name (e.g., "recv" matches "socket.recv")
        for sink in self.sinks:
            if "." in sink.name and sink.name.split(".")[-1].lower() == name_lower:
                return sink
        return None

    def is_sink(self, name: str) -> bool:
        """
        Check if a function name is a known sink.

        Args:
            name: Function name to check

        Returns:
            True if the function is a known sink
        """
        return self.find_by_name(name) is not None

    def get_all_categories(self) -> List[SinkCategory]:
        """Get all categories present in catalog."""
        return list(set(s.category for s in self.sinks))

    @classmethod
    def load_default(cls) -> "SinkCatalog":
        """
        Create catalog with default dangerous sinks loaded from YAML.

        Includes sinks for:
        - NETWORK: Socket receive operations (recv, recvfrom, accept)
        - FILE: File read operations (read, fread, fgets)
        - MEMORY: Memory operations (memcpy, strcpy, sprintf)
        - DESERIAL: Deserialization (pickle, yaml, marshal)

        Returns:
            SinkCatalog populated with default sinks
        """
        from codedmap.infra.rules import RuleRegistry
        catalog = RuleRegistry().load().build_sink_catalog()
        logger.info(f"Loaded default sink catalog with {len(catalog.sinks)} sinks")
        return catalog

    def to_dict(self) -> Dict[str, Any]:
        """Serialize catalog to dictionary."""
        return {
            "version": 1,
            "sinks": [s.to_dict() for s in self.sinks],
        }
