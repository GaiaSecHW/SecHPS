"""SecurityTagMatcher — L1 ONTOLOGY + L2 SEMANTIC security tag matching.

Provides static classmethods for recognizing tags in both:
- L1 ONTOLOGY format: ONTOLOGY:{NAMESPACE}:{NAME} (system rules)
- L2 SEMANTIC format: SEMANTIC:{NAMESPACE}:{NAME} (AI inference)

Uses whitelist matching: only ONTOLOGY:* and SEMANTIC:* prefixes are recognized.

This module is core-pure: zero imports from app, infra, analysis, or pipeline.
"""

from typing import Tuple, Optional

from codedmap.core.schema.tags.layer import TagLayer

_L1_ENTRY_POINT_PREFIX = f"{TagLayer.ONTOLOGY.value}:ENTRY_POINT:"
_L1_SOURCE_PREFIX = f"{TagLayer.ONTOLOGY.value}:SOURCE:"
_L1_SINK_PREFIX = f"{TagLayer.ONTOLOGY.value}:SINK:"
_L1_SANITIZER_PREFIX = f"{TagLayer.ONTOLOGY.value}:SANITIZER:"
_L1_GUARD_PREFIX = f"{TagLayer.ONTOLOGY.value}:GUARD:"
_L1_ROLE_PREFIX = f"{TagLayer.ONTOLOGY.value}:ROLE:"

_L2_ENTRY_POINT_PREFIX = f"{TagLayer.SEMANTIC.value}:ENTRY_POINT:"
_L2_SOURCE_PREFIX = f"{TagLayer.SEMANTIC.value}:SOURCE:"
_L2_SINK_PREFIX = f"{TagLayer.SEMANTIC.value}:SINK:"
_L2_SANITIZER_PREFIX = f"{TagLayer.SEMANTIC.value}:SANITIZER:"

_ENTRY_POINT_PREFIXES = (_L1_ENTRY_POINT_PREFIX, _L2_ENTRY_POINT_PREFIX)
_SOURCE_PREFIXES = (_L1_SOURCE_PREFIX, _L2_SOURCE_PREFIX)
_SINK_PREFIXES = (_L1_SINK_PREFIX, _L2_SINK_PREFIX)
_SANITIZER_PREFIXES = (_L1_SANITIZER_PREFIX, _L2_SANITIZER_PREFIX)
_GUARD_PREFIXES = (_L1_GUARD_PREFIX,)  # L1 only — GUARD has no SEMANTIC equivalent
_ROLE_PREFIXES = (_L1_ROLE_PREFIX,)    # L1 only — no SEMANTIC:ROLE:* equivalent

_SECURITY_PREFIXES = (
    *_ENTRY_POINT_PREFIXES,
    *_SOURCE_PREFIXES,
    *_SINK_PREFIXES,
    *_SANITIZER_PREFIXES,
    *_GUARD_PREFIXES,
)

_NAMESPACE_PREFIX_MAP = {
    "ENTRY_POINT": _ENTRY_POINT_PREFIXES,
    "SOURCE": _SOURCE_PREFIXES,
    "SINK": _SINK_PREFIXES,
    "SANITIZER": _SANITIZER_PREFIXES,
    "GUARD": _GUARD_PREFIXES,
    "ROLE": _ROLE_PREFIXES,
}


class SecurityTagMatcher:
    """L1 ONTOLOGY + L2 SEMANTIC security tag matching.

    All methods are classmethods — no instantiation required.
    Recognizes both canonical ONTOLOGY (L1) and SEMANTIC (L2) formats.
    Legacy formats are explicitly rejected.

    Examples::

        # L1 ONTOLOGY (system rules)
        SecurityTagMatcher.is_entry_point("ONTOLOGY:ENTRY_POINT:HTTP")  # True
        SecurityTagMatcher.is_sink("ONTOLOGY:SINK:SQL_INJECTION")       # True

        # L2 SEMANTIC (AI inference)
        SecurityTagMatcher.is_entry_point("SEMANTIC:ENTRY_POINT:HTTP")  # True
        SecurityTagMatcher.is_sink("SEMANTIC:SINK:SQL_INJECTION")       # True

        # Legacy formats (NOT recognized)
        SecurityTagMatcher.is_sink("SINK_KNOWN_SYSTEM")                 # False
        SecurityTagMatcher.is_entry_point("security:entry_point:L1:network")  # False
    """

    @classmethod
    def is_entry_point(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:ENTRY_POINT:*`` or ``SEMANTIC:ENTRY_POINT:*``."""
        return tag.startswith(_ENTRY_POINT_PREFIXES)

    @classmethod
    def is_source(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:SOURCE:*`` or ``SEMANTIC:SOURCE:*``."""
        return tag.startswith(_SOURCE_PREFIXES)

    @classmethod
    def is_sink(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:SINK:*`` or ``SEMANTIC:SINK:*``."""
        return tag.startswith(_SINK_PREFIXES)

    @classmethod
    def is_sanitizer(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:SANITIZER:*`` or ``SEMANTIC:SANITIZER:*``."""
        return tag.startswith(_SANITIZER_PREFIXES)

    @classmethod
    def is_guard(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:GUARD:*`` (L1 only — no SEMANTIC equivalent)."""
        return tag.startswith(_L1_GUARD_PREFIX)

    @classmethod
    def is_role(cls, tag: str) -> bool:
        """Return True if *tag* matches ``ONTOLOGY:ROLE:*`` (L1 only — no SEMANTIC equivalent)."""
        return tag.startswith(_L1_ROLE_PREFIX)

    @classmethod
    def get_role_category(cls, tag: str) -> Optional[str]:
        """Extract category name from a role tag, or None if not a role tag.

        Example: ``get_role_category("ONTOLOGY:ROLE:BOUNDARY")`` -> ``"BOUNDARY"``
        """
        if tag.startswith(_L1_ROLE_PREFIX):
            return tag[len(_L1_ROLE_PREFIX):]
        return None

    @classmethod
    def get_guard_category(cls, tag: str) -> Optional[str]:
        """Extract category name from a guard tag, or None if not a guard tag.

        Example: ``get_guard_category("ONTOLOGY:GUARD:AUTH_CHECK")`` -> ``"AUTH_CHECK"``
        """
        if tag.startswith(_L1_GUARD_PREFIX):
            return tag[len(_L1_GUARD_PREFIX):]
        return None

    @classmethod
    def get_sanitizer_category(cls, tag: str) -> Optional[str]:
        """Extract category name from a sanitizer tag (L1 or L2), or None if not a sanitizer tag.

        Example: ``get_sanitizer_category("ONTOLOGY:SANITIZER:ESCAPE")`` -> ``"ESCAPE"``
        """
        if tag.startswith(_L1_SANITIZER_PREFIX):
            return tag[len(_L1_SANITIZER_PREFIX):]
        if tag.startswith(_L2_SANITIZER_PREFIX):
            return tag[len(_L2_SANITIZER_PREFIX):]
        return None

    @classmethod
    def is_security_tag(cls, tag: str) -> bool:
        """Return True if *tag* is any L1 ONTOLOGY or L2 SEMANTIC security tag.

        Covers ENTRY_POINT, SOURCE, SINK, and SANITIZER namespaces.
        Does NOT match ONTOLOGY:ROLE:* or SEMANTIC:ROLE:* or non-security layers.
        """
        return tag.startswith(_SECURITY_PREFIXES)

    @classmethod
    def is_l1_tag(cls, tag: str) -> bool:
        """Return True if *tag* is an L1 ONTOLOGY tag (system rule)."""
        return tag.startswith(f"{TagLayer.ONTOLOGY.value}:")

    @classmethod
    def is_l2_tag(cls, tag: str) -> bool:
        """Return True if *tag* is an L2 SEMANTIC tag (AI inference)."""
        return tag.startswith(f"{TagLayer.SEMANTIC.value}:")

    @classmethod
    def _parse_namespace(
        cls, tag: str, l1_prefix: str, l2_prefix: str
    ) -> Tuple[Optional[str], Optional[TagLayer]]:
        """Internal helper to extract category and layer dynamically."""
        if tag.startswith(l1_prefix):
            return tag[len(l1_prefix):], TagLayer.ONTOLOGY
        if tag.startswith(l2_prefix):
            return tag[len(l2_prefix):], TagLayer.SEMANTIC
        return None, None

    @classmethod
    def parse_entry_point(cls, tag: str) -> Tuple[Optional[str], Optional[TagLayer]]:
        """Extract category and layer from an entry-point tag (L1 or L2).

        Returns:
            ``(category, layer)`` for valid tags, e.g., ``("HTTP", TagLayer.ONTOLOGY)``.
            ``(None, None)`` for unrecognized tags (including legacy formats).
        """
        return cls._parse_namespace(tag, _L1_ENTRY_POINT_PREFIX, _L2_ENTRY_POINT_PREFIX)

    @classmethod
    def parse_source(cls, tag: str) -> Tuple[Optional[str], Optional[TagLayer]]:
        """Extract category and layer from a source tag (L1 or L2)."""
        return cls._parse_namespace(tag, _L1_SOURCE_PREFIX, _L2_SOURCE_PREFIX)

    @classmethod
    def parse_sink(cls, tag: str) -> Tuple[Optional[str], Optional[TagLayer]]:
        """Extract category and layer from a sink tag (L1 or L2)."""
        return cls._parse_namespace(tag, _L1_SINK_PREFIX, _L2_SINK_PREFIX)

    @classmethod
    def parse_sanitizer(cls, tag: str) -> Tuple[Optional[str], Optional[TagLayer]]:
        """Extract category and layer from a sanitizer tag (L1 or L2)."""
        return cls._parse_namespace(tag, _L1_SANITIZER_PREFIX, _L2_SANITIZER_PREFIX)

    @classmethod
    def parse_any_security_tag(
        cls, tag: str
    ) -> Tuple[Optional[str], Optional[str], Optional[TagLayer]]:
        """Parse any valid security tag into (namespace, category, layer).

        This is a generic parser for cases where the caller doesn't know
        the specific namespace (SINK/SOURCE/etc.) beforehand.

        Returns:
            ``(namespace, category, layer)`` for valid tags,
            e.g., ``("SINK", "SQL_INJECTION", TagLayer.ONTOLOGY)``.
            ``(None, None, None)`` if not a recognized security tag.
        """
        if not cls.is_security_tag(tag):
            return None, None, None

        parts = tag.split(":")
        if len(parts) < 3:
            return None, None, None

        layer_str, namespace = parts[0], parts[1]
        category = ":".join(parts[2:])

        layer = TagLayer.ONTOLOGY if layer_str == TagLayer.ONTOLOGY.value else TagLayer.SEMANTIC
        return namespace, category, layer
