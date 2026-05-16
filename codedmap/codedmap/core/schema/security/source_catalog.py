# codedmap/core/schema/security/source_catalog.py
"""
Catalog of taint source rules.

Mirrors EntryPointCatalog structure.
load_default() calls RuleRegistry.build_source_rules() — no hasattr guard.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Set

from .source_models import SourceCategory
from .source_rules import SourceRule


@dataclass
class SourceCatalog:
    """
    Catalog of taint source detection rules.

    Provides filtering by category, language, and name.
    Use load_default() to populate from the global sources.yaml.
    """
    rules: List[SourceRule] = field(default_factory=list)

    def add_rule(self, rule: SourceRule) -> None:
        """Add a single rule to the catalog."""
        self.rules.append(rule)

    def add_rules(self, rules: List[SourceRule]) -> None:
        """Add multiple rules to the catalog."""
        self.rules.extend(rules)

    def by_category(self, category: SourceCategory) -> List[SourceRule]:
        """Return all rules matching the given category."""
        return [r for r in self.rules if r.category == category]

    def by_language(self, lang: str) -> List[SourceRule]:
        """Return all rules that apply to the given language."""
        return [r for r in self.rules if r.matches_language(lang)]

    def by_name(self, name: str) -> Optional[SourceRule]:
        """Return the first rule with the given name, or None."""
        for rule in self.rules:
            if rule.name == name:
                return rule
        return None

    def get_all_categories(self) -> Set[SourceCategory]:
        """Return the set of categories present in the catalog."""
        return {r.category for r in self.rules}

    def get_all_languages(self) -> Set[str]:
        """Return the set of languages present in the catalog."""
        langs: Set[str] = set()
        for rule in self.rules:
            langs.update(rule.languages)
        return langs

    @classmethod
    def load_default(cls) -> "SourceCatalog":
        """Load the default catalog from global sources.yaml via RuleRegistry.

        Calls RuleRegistry().load().build_source_rules() directly.
        No hasattr guard — build_source_rules() is present in this plan.
        Raises AttributeError loudly if RuleRegistry is missing the method.
        """
        from codedmap.infra.rules import RuleRegistry
        registry = RuleRegistry().load()
        catalog = cls()
        catalog.add_rules(registry.build_source_rules())
        return catalog
