"""Guard domain models for L1 ontology V2.

Provides GuardCategory enum, Guard dataclass, and GuardRule dataclass.
Mirrors the EntryPoint/Source pattern exactly.
Core-pure: zero imports from app/, infra/, analysis/, or pipeline/.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from codedmap.core.schema.tags.layer import TagLayer


class GuardCategory(str, Enum):
    """V2 guard categories — exactly 5 values, all UPPERCASE.

    Values directly encode the ONTOLOGY tag name:
      Guard.full_tag -> f"ONTOLOGY:GUARD:{category.value}"
    """
    BOUNDS_CHECK = "BOUNDS_CHECK"
    NULL_CHECK = "NULL_CHECK"
    TYPE_CHECK = "TYPE_CHECK"
    AUTH_CHECK = "AUTH_CHECK"
    STATE_CHECK = "STATE_CHECK"


@dataclass
class Guard:
    """Represents a detected guard (defensive check) in the code."""

    node_id: int
    name: str
    file: str
    line: int
    category: GuardCategory
    rule_id: str
    tags: List[str] = field(default_factory=list)
    condition: Optional[str] = None
    triggers: List[dict] = field(default_factory=list)

    @property
    def full_tag(self) -> str:
        """ONTOLOGY:GUARD:{category.value}"""
        return f"{TagLayer.ONTOLOGY.value}:GUARD:{self.category.value}"

    def to_dict(self) -> dict:
        return {
            "id": self.node_id,
            "label": "METHOD",
            "name": self.name,
            "file": self.file,
            "line": self.line,
            "category": self.category.value,
            "rule_id": self.rule_id,
            "tags": self.tags,
            "full_tag": self.full_tag,
            "condition": self.condition,
            "triggers": self.triggers,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Guard":
        return cls(
            node_id=data["id"],
            name=data["name"],
            file=data["file"],
            line=data["line"],
            category=GuardCategory(data["category"]),
            rule_id=data["rule_id"],
            tags=data.get("tags", []),
            condition=data.get("condition"),
            triggers=data.get("triggers", []),
        )


@dataclass
class GuardRule:
    """Rule definition for guard detection."""

    name: str
    category: GuardCategory
    patterns: List[dict]
    languages: List[str] = field(default_factory=lambda: ["c", "cpp", "python"])
    description: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "GuardRule":
        return cls(
            name=data["name"],
            category=GuardCategory(data["category"].upper()),
            patterns=data.get("patterns", []),
            languages=data.get("languages", ["c", "cpp", "python"]),
            description=data.get("description"),
        )
