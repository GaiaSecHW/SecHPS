# codedmap/core/schema/security/static_rules.py
"""
Static security rules for sink/source/sanitizer classification.

Canonical location for StaticSecurityRules.
Moved from app/tagging/rules.py to eliminate analysis→app dependency.

Rule data is loaded from YAML via RuleRegistry. Zero hardcoded rules
remain in this module.
"""

import re
from typing import Optional, Set, Dict


def _load_rules() -> tuple[Dict[str, str], Dict[str, str], Set[str]]:
    """Load rule data from YAML via RuleRegistry."""
    from codedmap.infra.rules import RuleRegistry
    registry = RuleRegistry().load()
    return registry.get_sink_db(), registry.get_source_db(), registry.get_safe_set()


# Module-level lazy cache: initialized on first access
_sink_db: Optional[Dict[str, str]] = None
_source_db: Optional[Dict[str, str]] = None
_safe_set: Optional[Set[str]] = None


def _ensure_loaded() -> None:
    """Load rules on first access."""
    global _sink_db, _source_db, _safe_set
    if _sink_db is None:
        _sink_db, _source_db, _safe_set = _load_rules()


class StaticSecurityRules:
    """
    [Funnel Level 1] Static security rule library.

    Responsibilities:
    1. Fast lookup for known vulnerability functions (Sinks).
    2. Fast lookup for known input functions (Sources).
    3. Whitelist of known safe/harmless functions (Sanitizers/Safe).

    Design principles:
    - High Precision: only includes industry-recognized dangerous/safe functions.
    - Fast Lookup: uses Hash Set / Dict O(1) lookup.
    - Conservative: returns None when uncertain, deferring to LLM.

    Rule data is loaded from YAML files via RuleRegistry on first access.
    """

    # =========================================================================
    # Public Interface
    # =========================================================================

    @classmethod
    def get_sink_category(cls, name: str) -> Optional[str]:
        """Check if function is a known Sink, return category or None."""
        if not name:
            return None
        _ensure_loaded()
        name_lower = name.lower()
        if name_lower in _sink_db:
            return _sink_db[name_lower]

        if "::" in name_lower:
            short_name = name_lower.split("::")[-1]
            return _sink_db.get(short_name)

        if "." in name_lower:
            short_name = name_lower.split(".")[-1]
            return _sink_db.get(short_name)

        return None

    @classmethod
    def is_obvious_sink(cls, name: str) -> bool:
        return cls.get_sink_category(name) is not None

    @classmethod
    def get_source_category(cls, name: str) -> Optional[str]:
        """Check if function is a known Source, return category or None."""
        if not name:
            return None
        _ensure_loaded()
        name_lower = name.lower()

        if name_lower in _source_db:
            return _source_db[name_lower]

        if "." in name_lower:
            return _source_db.get(name_lower.split(".")[-1])

        return None

    @classmethod
    def is_obvious_source(cls, name: str) -> bool:
        return cls.get_source_category(name) is not None

    @classmethod
    def is_obvious_safe(cls, name: str) -> bool:
        """Check if function is a known safe/utility function."""
        if not name:
            return False
        _ensure_loaded()
        name_lower = name.lower()

        if name_lower in _safe_set:
            return True

        if name_lower.startswith("is_") or name_lower.startswith("has_"):
            return True
        if name_lower.startswith("get_") and ("size" in name_lower or "len" in name_lower):
            return True

        if "::" in name_lower:
            short = name_lower.split("::")[-1]
            return short in _safe_set

        if "." in name_lower:
            short = name_lower.split(".")[-1]
            return short in _safe_set

        return False
