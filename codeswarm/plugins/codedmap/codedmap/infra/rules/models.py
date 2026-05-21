"""
Rule data models for the rule registry.

These dataclasses represent the core data structures for rule management:
- Tombstone: A suppression of an SDK rule by ID with mandatory reason
- MergedRule: A rule entry with origin and active/tombstoned status
- RuleSet: A merged rule set for a single rule type
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Tombstone:
    """A suppression of an SDK rule by ID with mandatory reason."""

    id: str
    reason: str


@dataclass
class MergedRule:
    """A rule entry with origin and active/tombstoned status."""

    id: str
    data: Dict[str, Any]
    origin: str  # "SDK_CORE" or "LOCAL_OVERRIDE"
    active: bool = True
    tombstone_reason: Optional[str] = None


@dataclass
class RuleSet:
    """Merged rule set for a single rule type."""

    rules: List[MergedRule] = field(default_factory=list)

    def active_rules(self) -> List[MergedRule]:
        return [r for r in self.rules if r.active]

    def tombstoned_rules(self) -> List[MergedRule]:
        return [r for r in self.rules if not r.active]

    def by_id(self, rule_id: str) -> Optional[MergedRule]:
        for r in self.rules:
            if r.id == rule_id:
                return r
        return None
