# codedmap/core/schema/security/source_rules.py
"""
Pure data models for taint source detection rules.

Canonical location for SourcePattern and SourceRule.
Mirrors the entrypoint_rules.py structure but adds taints field for SourcePattern.

Zero I/O: RuleRegistry (infra) loads YAML and calls SourceRule.from_dict().
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .source_models import SourceCategory

logger = logging.getLogger(__name__)

# Valid taints format: "return" or "param[N]" where N is a non-negative integer
_TAINTS_PATTERN = re.compile(r"^(return|param\[\d+\])$")


@dataclass
class SourcePattern:
    """
    A single pattern to match in code, with taint propagation semantics.

    Attributes:
        type:         Pattern type — "call" or "identifier"
        function:     Function name for type="call" (e.g. "getenv", "recv")
        name:         Node name for type="identifier" (e.g. "argv", "environ")
        taints:       Where the taint propagates — "return" or "param[N]" (0-based)
                      "return"   = the function's return value is tainted
                      "param[N]" = parameter at index N is tainted (written to)
        code_pattern: Optional regex to match against code content
        fullname:     Optional regex pattern to match against methodFullName (Precision Path)
        _fullname_re: Compiled regex for fullname (internal use)
    """
    type: str  # "call" or "identifier"
    function: Optional[str] = None
    name: Optional[str] = None
    taints: str = "return"
    code_pattern: Optional[str] = None
    fullname: Optional[str] = None
    _fullname_re: Optional[re.Pattern] = field(default=None, repr=False)

    def __post_init__(self) -> None:
        """Validate pattern after initialization."""
        valid_types = {"call", "identifier"}
        if self.type not in valid_types:
            raise ValueError(
                f"Invalid SourcePattern type: {self.type!r}. Must be one of {sorted(valid_types)}"
            )

        if self.type == "call" and not self.function:
            raise ValueError("SourcePattern of type 'call' requires 'function' field")

        if self.type == "identifier" and not self.name:
            raise ValueError("SourcePattern of type 'identifier' requires 'name' field")

        if not _TAINTS_PATTERN.match(self.taints):
            raise ValueError(
                f"Invalid taints format: {self.taints!r}. "
                f"Must be 'return' or 'param[N]' (N is a non-negative integer)"
            )

        if self.fullname:
            try:
                object.__setattr__(self, '_fullname_re', re.compile(self.fullname))
            except re.error as e:
                logger.warning(f"Invalid fullname regex '{self.fullname}': {e}")

    def matches_fullname(self, method_full_name: str) -> bool:
        """Check if methodFullName matches the fullname regex (Precision Path)."""
        if not self.fullname or not self._fullname_re:
            return True
        return bool(self._fullname_re.search(method_full_name))

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SourcePattern":
        """Create SourcePattern from dictionary."""
        return cls(
            type=data["type"],
            function=data.get("function"),
            name=data.get("name"),
            taints=data.get("taints", "return"),
            code_pattern=data.get("code_pattern"),
            fullname=data.get("fullname"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize SourcePattern to dictionary."""
        result: Dict[str, Any] = {"type": self.type, "taints": self.taints}
        if self.function is not None:
            result["function"] = self.function
        if self.name is not None:
            result["name"] = self.name
        if self.code_pattern is not None:
            result["code_pattern"] = self.code_pattern
        if self.fullname is not None:
            result["fullname"] = self.fullname
        return result


@dataclass
class SourceRule:
    """
    A complete rule for detecting taint sources.

    Attributes:
        name:        Unique rule identifier (e.g. "getenv", "recv")
        category:    Taint source category (SourceCategory enum value)
        patterns:    List of patterns to match in code
        languages:   Supported languages (e.g. ["c", "cpp", "python"])
        description: Optional human-readable description
    """
    name: str
    category: SourceCategory
    patterns: List[SourcePattern]
    languages: List[str] = field(default_factory=lambda: ["c", "cpp", "python"])
    description: Optional[str] = None
    origin: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SourceRule":
        """Create SourceRule from dictionary.

        category is expected to be UPPERCASE (e.g. "NETWORK_DATA") as in sources.yaml.
        Raises ValueError for unknown categories or missing/empty patterns.
        """
        category_str = data.get("category", "")
        try:
            category = SourceCategory(category_str)
        except ValueError:
            raise ValueError(
                f"Invalid source category: {category_str!r}. "
                f"Must be one of {[c.value for c in SourceCategory]}"
            )

        patterns_data = data.get("patterns", [])
        if not patterns_data:
            raise ValueError(
                f"SourceRule '{data.get('name', 'unknown')}' must have at least one pattern"
            )

        patterns = [SourcePattern.from_dict(p) for p in patterns_data]

        return cls(
            name=data["name"],
            category=category,
            patterns=patterns,
            languages=data.get("languages", ["c", "cpp", "python"]),
            description=data.get("description"),
            origin=data.get("origin"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize SourceRule to dictionary."""
        return {
            "name": self.name,
            "category": self.category.value,
            "patterns": [p.to_dict() for p in self.patterns],
            "languages": self.languages,
            "description": self.description,
            "origin": self.origin,
        }

    def matches_language(self, lang: str) -> bool:
        """Check if rule applies to given language."""
        return lang.lower() in [ll.lower() for ll in self.languages]
