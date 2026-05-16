"""Role domain models for L1 ontology V2.

Provides RoleCategory enum and Role dataclass.
Roles are architectural context — agent/human-applied, not auto-detected.
Core-pure: zero imports from app/, infra/, analysis/, or pipeline/.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from codedmap.core.schema.tags.layer import TagLayer


class RoleCategory(str, Enum):
    """V2 role categories — exactly 7 values, all UPPERCASE.

    Values directly encode the ONTOLOGY tag name:
      Role.full_tag -> f"ONTOLOGY:ROLE:{category.value}"
    """
    BOUNDARY       = "BOUNDARY"
    LOGIC_PROVIDER = "LOGIC_PROVIDER"
    DATA_STORAGE   = "DATA_STORAGE"
    INFRASTRUCTURE = "INFRASTRUCTURE"
    DRIVER         = "DRIVER"
    KERNEL_CORE    = "KERNEL_CORE"
    UTILITY        = "UTILITY"


@dataclass
class Role:
    """Represents an architectural role assigned to a code element.

    Roles are collaborative L1 tags — agents can apply with justification,
    humans can apply freely, system passes can also apply.
    Unlike Guard/Sanitizer, roles are NOT auto-detected from patterns.
    """

    node_id: int
    name: str
    file: str
    line: int
    category: RoleCategory
    tags: List[str] = field(default_factory=list)
    justification: Optional[str] = None

    @property
    def full_tag(self) -> str:
        """ONTOLOGY:ROLE:{category.value}"""
        return f"{TagLayer.ONTOLOGY.value}:ROLE:{self.category.value}"

    def to_dict(self) -> dict:
        return {
            "id": self.node_id,
            "label": "METHOD",
            "name": self.name,
            "file": self.file,
            "line": self.line,
            "category": self.category.value,
            "tags": self.tags,
            "full_tag": self.full_tag,
            "justification": self.justification,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Role":
        return cls(
            node_id=data["id"],
            name=data["name"],
            file=data["file"],
            line=data["line"],
            category=RoleCategory(data["category"]),
            tags=data.get("tags", []),
            justification=data.get("justification"),
        )
