# codedmap/core/schema/security/entrypoint_rules.py
"""
Pure data models for entry point detection rules.

Canonical location for RulePattern, EntryPointRule.
RuleLoader (I/O) moved to infra/loaders/rule_loader.py to preserve core "zero I/O" invariant.
"""

import re
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from .entrypoint_models import EntryPointCategory

logger = logging.getLogger(__name__)


@dataclass
class RulePattern:
    """
    A single pattern to match in code.

    Attributes:
        type: Pattern type - "call", "method", or "identifier"
        function: Function name pattern for call types (e.g., "recv", "requests.get")
        name: Node name pattern for method/identifier types
        is_entry: Whether this pattern marks a true entry point (like main())
        code_pattern: Optional regex pattern to match against code content
        fullname: Optional regex pattern to match against methodFullName (Precision Path)
        _fullname_re: Compiled regex for fullname (internal use)
    """
    type: str  # "call", "method", "identifier"
    function: Optional[str] = None
    name: Optional[str] = None
    is_entry: bool = False
    code_pattern: Optional[str] = None
    fullname: Optional[str] = None
    _fullname_re: Optional[re.Pattern] = field(default=None, repr=False)

    def __post_init__(self):
        """Validate pattern after initialization."""
        valid_types = {"call", "method", "identifier"}
        if self.type not in valid_types:
            raise ValueError(f"Invalid pattern type: {self.type}. Must be one of {valid_types}")

        if self.type == "call" and not self.function:
            raise ValueError("Call pattern requires 'function' field")

        if self.type in ("method", "identifier") and not self.name:
            raise ValueError(f"{self.type} pattern requires 'name' field")

        if self.fullname:
            try:
                object.__setattr__(self, '_fullname_re', re.compile(self.fullname))
            except re.error as e:
                logger.warning(f"Invalid fullname regex '{self.fullname}': {e}")

    def matches_code(self, code: str) -> bool:
        """Check if code matches the code_pattern regex."""
        if not self.code_pattern:
            return True
        try:
            return bool(re.search(self.code_pattern, code, re.IGNORECASE))
        except re.error:
            logger.warning(f"Invalid regex pattern: {self.code_pattern}")
            return False

    def matches_fullname(self, method_full_name: str) -> bool:
        """Check if methodFullName matches the fullname regex (Precision Path)."""
        if not self.fullname or not self._fullname_re:
            return True
        return bool(self._fullname_re.search(method_full_name))

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RulePattern":
        """Create RulePattern from dictionary."""
        return cls(
            type=data["type"],
            function=data.get("function"),
            name=data.get("name"),
            is_entry=data.get("is_entry", False),
            code_pattern=data.get("code_pattern"),
            fullname=data.get("fullname"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize RulePattern to dictionary."""
        result = {"type": self.type}
        if self.function is not None:
            result["function"] = self.function
        if self.name is not None:
            result["name"] = self.name
        if self.is_entry:
            result["is_entry"] = self.is_entry
        if self.code_pattern:
            result["code_pattern"] = self.code_pattern
        if self.fullname:
            result["fullname"] = self.fullname
        return result


@dataclass
class EntryPointRule:
    """
    A complete rule for detecting entry points.

    Attributes:
        name: Unique rule identifier
        category: Entry point category (network, cli, data, kernel)
        patterns: List of patterns to match
        languages: Supported languages (e.g., ["c", "cpp", "python"])
        description: Optional human-readable description
    """
    name: str
    category: EntryPointCategory
    patterns: List[RulePattern]
    languages: List[str] = field(default_factory=lambda: ["c", "cpp", "python"])
    description: Optional[str] = None
    protocol: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EntryPointRule":
        """Create EntryPointRule from dictionary."""
        # Parse category — normalize to UPPERCASE since YAML may use lowercase.
        category_str = data.get("category", "NETWORK_LISTENER").upper()
        try:
            category = EntryPointCategory(category_str)
        except ValueError:
            raise ValueError(f"Invalid category: {category_str}. Must be one of {[c.value for c in EntryPointCategory]}")

        # Parse patterns
        patterns_data = data.get("patterns", [])
        if not patterns_data:
            raise ValueError(f"Rule '{data.get('name', 'unknown')}' must have at least one pattern")

        patterns = [RulePattern.from_dict(p) for p in patterns_data]

        return cls(
            name=data["name"],
            category=category,
            patterns=patterns,
            languages=data.get("languages", ["c", "cpp", "python"]),
            description=data.get("description"),
            protocol=data.get("protocol"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize EntryPointRule to dictionary."""
        return {
            "name": self.name,
            "category": self.category.value,
            "patterns": [p.to_dict() for p in self.patterns],
            "languages": self.languages,
            "description": self.description,
            "protocol": self.protocol,
        }

    def matches_language(self, lang: str) -> bool:
        """Check if rule applies to given language."""
        return lang.lower() in [l.lower() for l in self.languages]


