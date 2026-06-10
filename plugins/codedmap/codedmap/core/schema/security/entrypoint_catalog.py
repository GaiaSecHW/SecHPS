# codedmap/core/schema/security/entrypoint_catalog.py
"""
Entry Point Catalog with rules loaded from YAML.

Canonical location for EntryPointCatalog.
Moved from app/entrypoints/catalog.py to eliminate analysis→app dependency.

Default rules are now loaded from YAML via RuleRegistry instead of
hardcoded _create_* methods.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from .entrypoint_models import EntryPointCategory
from .entrypoint_rules import EntryPointRule, RulePattern

logger = logging.getLogger(__name__)


@dataclass
class EntryPointCatalog:
    """
    Collection of entry point detection rules.

    Provides filtering and organization of rules by category and language.
    """
    rules: List[EntryPointRule] = field(default_factory=list)

    def add_rule(self, rule: EntryPointRule) -> None:
        """Add a rule to the catalog."""
        self.rules.append(rule)

    def add_rules(self, rules: List[EntryPointRule]) -> None:
        """Add multiple rules to the catalog."""
        self.rules.extend(rules)

    def by_category(self, category: EntryPointCategory) -> List[EntryPointRule]:
        """
        Filter rules by category.

        Args:
            category: Entry point category to filter by

        Returns:
            List of rules matching the category
        """
        return [r for r in self.rules if r.category == category]

    def by_language(self, lang: str) -> List[EntryPointRule]:
        """
        Filter rules by language.

        Args:
            lang: Language to filter by (e.g., "python", "c", "cpp")

        Returns:
            List of rules that apply to the language
        """
        return [r for r in self.rules if r.matches_language(lang)]

    def by_name(self, name: str) -> Optional[EntryPointRule]:
        """
        Find a rule by name.

        Args:
            name: Rule name to search for

        Returns:
            EntryPointRule if found, None otherwise
        """
        for rule in self.rules:
            if rule.name == name:
                return rule
        return None

    def get_all_categories(self) -> List[EntryPointCategory]:
        """Get all categories present in catalog."""
        return list(set(r.category for r in self.rules))

    def get_all_languages(self) -> List[str]:
        """Get all languages covered by rules in catalog."""
        languages = set()
        for rule in self.rules:
            languages.update(l.lower() for l in rule.languages)
        return sorted(languages)

    @classmethod
    def load_default(cls) -> "EntryPointCatalog":
        """
        Create catalog with default rules loaded from YAML.

        Includes rules for:
        - CLI: main functions, argparse, getenv
        - Data: file operations (fopen, read)
        - Network: socket operations (recv, socket_read)
        - Kernel: syscall, ioctl (basic)

        Returns:
            EntryPointCatalog populated with default rules
        """
        from codedmap.infra.rules import RuleRegistry
        registry = RuleRegistry().load()
        catalog = cls()
        catalog.add_rules(registry.build_entrypoint_rules())
        logger.info(f"Loaded default catalog with {len(catalog.rules)} rules")
        return catalog

    def to_dict(self) -> Dict[str, Any]:
        """Serialize catalog to dictionary."""
        return {
            "version": 1,
            "rules": [r.to_dict() for r in self.rules],
        }
