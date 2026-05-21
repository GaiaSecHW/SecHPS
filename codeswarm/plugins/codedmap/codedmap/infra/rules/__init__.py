"""
Rules module — rule registry and loading infrastructure.

Infra layer (Layer 1): provides rule management services.

Public API:
- RuleRegistry: Unified registry for SDK and project-level rules
- CascadingRuleLoader: Loads V2 ontology + per-language rules from YAML
- OntologyError: Raised when a rule's category is not in the ontology
- Tombstone, MergedRule, RuleSet: Data models for rule management
"""

from .loader import CascadingRuleLoader, OntologyError
from .models import MergedRule, RuleSet, Tombstone
from .registry import RuleRegistry

__all__ = [
    "RuleRegistry",
    "CascadingRuleLoader",
    "OntologyError",
    "Tombstone",
    "MergedRule",
    "RuleSet",
]
