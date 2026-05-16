# codedmap/core/schema/security/sanitizer_catalog.py
"""
Catalog of sanitizer detection rules.

Mirrors SourceCatalog structure exactly.
load_default() calls RuleRegistry().load().build_sanitizer_rules() — no hasattr guard.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Set

from .sanitizer_models import SanitizerCategory
from .sanitizer_models import SanitizerRule


@dataclass
class SanitizerCatalog:
    """
    Catalog of sanitizer detection rules.

    Provides filtering by category, language, and name.
    Use load_default() to populate from the global sanitizers YAML via RuleRegistry.
    """
    rules: List[SanitizerRule] = field(default_factory=list)

    def add_rule(self, rule: SanitizerRule) -> None:
        """Add a single rule to the catalog."""
        self.rules.append(rule)

    def add_rules(self, rules: List[SanitizerRule]) -> None:
        """Add multiple rules to the catalog."""
        self.rules.extend(rules)

    def by_category(self, category: SanitizerCategory) -> List[SanitizerRule]:
        """Return all rules matching the given category."""
        return [r for r in self.rules if r.category == category]

    def by_language(self, lang: str) -> List[SanitizerRule]:
        """Return all rules that apply to the given language."""
        return [r for r in self.rules if lang.lower() in [l.lower() for l in r.languages]]

    def by_name(self, name: str) -> Optional[SanitizerRule]:
        """Return the first rule with the given name, or None."""
        for rule in self.rules:
            if rule.name == name:
                return rule
        return None

    def get_all_categories(self) -> Set[SanitizerCategory]:
        """Return the set of categories present in the catalog."""
        return {r.category for r in self.rules}

    def get_all_languages(self) -> Set[str]:
        """Return the set of languages present in the catalog."""
        langs: Set[str] = set()
        for rule in self.rules:
            langs.update(rule.languages)
        return langs

    @classmethod
    def load_default(cls) -> "SanitizerCatalog":
        """Load the default catalog from YAML via RuleRegistry.

        Calls RuleRegistry().load().build_sanitizer_rules() directly.
        Raises AttributeError loudly if RuleRegistry is missing the method.
        """
        from codedmap.infra.rules import RuleRegistry
        registry = RuleRegistry().load()
        catalog = cls()
        catalog.add_rules(registry.build_sanitizer_rules())
        return catalog
