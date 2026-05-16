"""Sanitizer domain models for L1 ontology V2.

Provides SanitizerCategory enum, Sanitizer dataclass, and SanitizerRule dataclass.
Mirrors the Guard/EntryPoint pattern exactly.
Core-pure: zero imports from app/, infra/, analysis/, or pipeline/.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from codedmap.core.schema.tags.layer import TagLayer


class SanitizerCategory(str, Enum):
    """V2 sanitizer categories — exactly 5 values, all UPPERCASE.

    Values directly encode the ONTOLOGY tag name:
      Sanitizer.full_tag -> f"ONTOLOGY:SANITIZER:{category.value}"
    """
    ESCAPE = "ESCAPE"
    ENCODE = "ENCODE"
    TYPE_CAST = "TYPE_CAST"
    TRUNCATE = "TRUNCATE"
    NORMALIZE = "NORMALIZE"


@dataclass
class Sanitizer:
    """Represents a detected sanitizer (data transformation) in the code."""

    node_id: int
    name: str
    file: str
    line: int
    category: SanitizerCategory
    rule_id: str
    tags: List[str] = field(default_factory=list)
    transform: Optional[str] = None
    triggers: List[dict] = field(default_factory=list)

    @property
    def full_tag(self) -> str:
        """ONTOLOGY:SANITIZER:{category.value}"""
        return f"{TagLayer.ONTOLOGY.value}:SANITIZER:{self.category.value}"

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
            "transform": self.transform,
            "triggers": self.triggers,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Sanitizer":
        return cls(
            node_id=data["id"],
            name=data["name"],
            file=data["file"],
            line=data["line"],
            category=SanitizerCategory(data["category"]),
            rule_id=data["rule_id"],
            tags=data.get("tags", []),
            transform=data.get("transform"),
            triggers=data.get("triggers", []),
        )


@dataclass
class SanitizerRule:
    """Rule definition for sanitizer detection."""

    name: str
    category: SanitizerCategory
    patterns: List[dict]
    languages: List[str] = field(default_factory=lambda: ["c", "cpp", "python"])
    description: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "SanitizerRule":
        return cls(
            name=data["name"],
            category=SanitizerCategory(data["category"].upper()),
            patterns=data.get("patterns", []),
            languages=data.get("languages", ["c", "cpp", "python"]),
            description=data.get("description"),
        )
