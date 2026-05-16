# codedmap/analysis/tagging/engine.py
"""
TagEngine — Unified API for all tagging operations.

Canonical location (moved from app/tagging/engine.py).

Encapsulates:
- TagNavigator (tag CRUD: add, remove, list, find, bulk)
- TagRegistry (three-layer schema with permission enforcement)
- StaticSecurityRules (zero-cost rule-based tagging)
- AITagger (on-demand LLM-based tagging, injected via factory)

Usage:
    tagger = TagEngine(store)

    # Manual tagging (L2/L3 only — L1 ONTOLOGY tags are read-only)
    tagger.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent", justification="password hash function")
    tagger.add(node, "STATE:REVIEWED", applied_by="human")

    # Rule-based batch tagging (zero AI cost, outputs ONTOLOGY-prefixed tags)
    tagger.auto_tag_by_rules()

    # AI-assisted tagging (requires ai_tagger_factory injection)
    tagger.ai_tag(method_node)
    tagger.ai_tag_all(budget_limit=100)

    # Query
    sources = tagger.find("ONTOLOGY:SOURCE:*")
    tags = tagger.list_tags(node)
"""

import logging
import fnmatch
from datetime import datetime, timezone
from typing import List, Optional, Callable, Any

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.tags.registry import TagRegistry
from codedmap.core.schema.tags.layer import TagLayer
from codedmap.core.schema.tags.provenance import Provenance, AppliedBy
from codedmap.core.schema.tags.matcher import SecurityTagMatcher
from codedmap.infra.storage.store import CPGStore
from .navigator import TagNavigator, TagResult

logger = logging.getLogger(__name__)

# Collaborative L1 namespaces: AGENT writes require non-empty justification.
# SYSTEM writes bypass this check entirely (via add_system_tag / _add_system_tag).
_COLLABORATIVE_L1_PREFIXES = ("ONTOLOGY:GUARD:", "ONTOLOGY:SANITIZER:", "ONTOLOGY:ROLE:")


class TagPermissionError(PermissionError):
    """Raised when attempting to write a read-only tag layer."""
    pass


class TagEngine:
    """
    Unified tagging API — single entry point for all tag operations.

    Args:
        store: CPGStore instance for graph access.
        ai_tagger_factory: Optional callable ``(store, **kwargs) -> AITagger``.
            Inject from the app layer to enable ``ai_tag()`` / ``ai_tag_all()``.
            When not provided, those methods raise ``RuntimeError``.
    """

    def __init__(self, store: CPGStore, ai_tagger_factory: Optional[Callable[..., Any]] = None):
        self.store = store
        self._navigator = TagNavigator(store)
        self._registry = TagRegistry()
        self._ai_tagger = None
        self._ai_tagger_factory = ai_tagger_factory

    # =========================================================================
    # Manual Tag Operations (delegated to TagNavigator)
    # =========================================================================

    def add(
        self,
        node: CPGNode,
        tag: str,
        applied_by: str = "agent",
        confidence: Optional[float] = None,
        created_by: str = None,
        justification: Optional[str] = None,
    ) -> TagResult:
        """
        Add a tag to a node (idempotent).

        Rejects System-Only L1 ONTOLOGY tags (ENTRY_POINT, SOURCE, SINK).
        Collaborative L1 tags (GUARD, SANITIZER, ROLE) require non-empty justification
        when applied_by != "system".

        Args:
            node: Target CPGNode.
            tag: Tag string (e.g., "SEMANTIC:SINK:SQL_INJECTION").
            applied_by: Who applied the tag ("agent", "ai", "human", etc.).
            confidence: Optional confidence score (0.0-1.0) for L2 SEMANTIC tags.
            created_by: Optional created_by identifier (overrides applied_by for provenance).
            justification: Required for AGENT writes to collaborative L1 namespaces
                           (GUARD/SANITIZER/ROLE). Must be a non-empty string.

        Returns:
            TagResult with action "added" or "already_exists".

        Raises:
            TagPermissionError: If attempting to add a System-Only L1 ONTOLOGY tag,
                                or a collaborative L1 tag without justification.
        """
        normalized = tag.strip().upper()

        # Justification Gate: collaborative L1 namespaces (GUARD/SANITIZER/ROLE)
        # AGENT writes require non-empty justification; SYSTEM writes bypass this check.
        if any(normalized.startswith(p) for p in _COLLABORATIVE_L1_PREFIXES):
            if applied_by != "system" and (not justification or not justification.strip()):
                raise TagPermissionError(
                    f"AGENT L1 tag {normalized!r} requires non-empty 'justification' parameter. "
                    f"Provide Guard condition, Sanitizer transform, or Role justification."
                )
            # Collaborative L1 tags bypass is_writable() — they are agent-writable with justification
            return self._add_collaborative_l1_tag(
                node,
                normalized,
                applied_by,
                justification,
                created_by=created_by,
            )

        if not self._registry.is_writable(normalized):
            layer = self._registry.get_layer(normalized)
            raise TagPermissionError(
                f"Cannot add tag '{normalized}': {layer.value} layer tags are read-only. "
                f"Only system rule passes can apply L1 tags."
            )
        result = self._navigator.add_tag(node, tag)
        if result.action == "added":
            self._record_provenance(
                node,
                normalized,
                applied_by,
                confidence=confidence,
                justification=justification,
                created_by=created_by,
            )
        return result

    def remove(self, node: CPGNode, tag: str, created_by: str = None) -> TagResult:
        """Remove a tag from a node."""
        result = self._navigator.remove_tag(node, tag)
        if result.action == "removed":
            self._delete_provenance(node, result.tag)
        return result

    def list_tags(self, node: CPGNode) -> List[str]:
        """Get all tags for a node."""
        return self._navigator.list_tags(node)

    def list_all_tags(self, prefix: str = None) -> List[str]:
        """
        List all unique tags in the database, optionally filtered by prefix.
        Routes through TagRepository.list_all() which delegates to reader.list_tags().
        """
        return self.store.tags.list_all(prefix=prefix)

    def find(self, tag_pattern: str, limit: Optional[int] = 50) -> List[CPGNode]:
        """
        Find nodes by tag or tag pattern.

        Supports wildcard patterns like "ONTOLOGY:SOURCE:*", "ONTOLOGY:SINK:*".
        For exact match, pass the full tag name.
        """
        if "*" in tag_pattern or "?" in tag_pattern:
            return self._find_by_pattern(tag_pattern, limit)
        return self._navigator.find_by_tag(tag_pattern, limit)

    def bulk_tag(self, pattern: str, tag: str, node_type: str = "method", created_by: str = None) -> List[TagResult]:
        """Add a tag to all nodes matching a name pattern."""
        results = self._navigator.bulk_tag(pattern, tag, node_type)
        if created_by:
            for r in results:
                if r.action == "added":
                    node = self.store.get_node(r.node_id)
                    if node is not None:
                        self._record_provenance(node, r.tag, "agent", created_by=created_by)
        return results

    # =========================================================================
    # Rule-Based Tagging (Zero AI Cost)
    # =========================================================================

    # auto_tag_by_rules() removed in Phase 38 — replaced by EntryPointPass + SourcePass + SinkPass

    # =========================================================================
    # AI-Assisted Tagging (On-Demand)
    # =========================================================================

    def ai_tag(self, method: MethodNode, **kwargs) -> List[str]:
        """
        Run AI tagging on a single method.
        Lazily initializes AI agent on first call.

        Returns:
            List of tag strings applied.
        """
        tagger = self._get_ai_tagger(**kwargs)
        return tagger.tag_method(method)

    def ai_tag_all(self, budget_limit: Optional[int] = None, **kwargs) -> int:
        """
        Run AI tagging on all internal methods.

        Args:
            budget_limit: Max number of methods to process (None = unlimited).

        Returns:
            Number of methods that received at least one tag.
        """
        tagger = self._get_ai_tagger(**kwargs)
        methods = list(self.store.query.methods().filter(is_external=False))
        return tagger.tag_methods(methods, budget_limit=budget_limit)

    # =========================================================================
    # Internal Helpers
    # =========================================================================

    def _add_system_tag(self, node: CPGNode, tag: str) -> TagResult:
        """Bypass is_writable() for system-applied L1 tags. Internal use only.
        Also bypasses Justification Gate — system writes never require justification."""
        return self._navigator.add_tag(node, tag)

    def _add_collaborative_l1_tag(
        self,
        node: CPGNode,
        tag: str,
        applied_by: str,
        justification: Optional[str],
        created_by: Optional[str] = None,
    ) -> TagResult:
        """Write a collaborative L1 tag (GUARD/SANITIZER/ROLE) with provenance.

        Called after Justification Gate passes. Records Provenance with source=AGENT
        and the provided justification string.
        """
        result = self._navigator.add_tag(node, tag)
        if result.action == "added":
            record = Provenance(
                applied_by=AppliedBy(applied_by) if applied_by in AppliedBy._value2member_map_ else AppliedBy.AGENT,
                source="AGENT",
                author_id=applied_by,
                justification=justification,
                created_by=created_by,
                timestamp=datetime.now(timezone.utc),
            )
            if node.tags_provenance is None:
                node.tags_provenance = {}
            existing = node.tags_provenance.get(tag)
            if isinstance(existing, list):
                existing.append(record.model_dump(mode="json"))
            else:
                node.tags_provenance[tag] = [record.model_dump(mode="json")]
            self._persist_provenance(node)
        return result

    def add_system_tag(self, node: CPGNode, tag: str) -> TagResult:
        """
        Add a tag bypassing the L1 ONTOLOGY permission check.

        Intended for system and analysis passes (e.g., EntryPointPass) that
        need to write L1 ONTOLOGY tags programmatically.  Normal callers
        should use ``add()`` instead — it enforces layer permissions and
        records provenance.

        Args:
            node: Target CPGNode.
            tag:  Tag string (e.g. ``"ONTOLOGY:ENTRY_POINT:CLI"``).

        Returns:
            TagResult with action ``"added"`` or ``"already_exists"``.
        """
        return self._navigator.add_tag(node, tag)

    def _record_provenance(
        self,
        node: CPGNode,
        tag: str,
        applied_by: str,
        confidence: Optional[float] = None,
        justification: Optional[str] = None,
        created_by: Optional[str] = None,
    ):
        """Record provenance for L2/L3 tags only. Skip L1 and legacy flat tags."""
        layer = self._registry.get_layer(tag)
        if layer not in (TagLayer.SEMANTIC, TagLayer.STATE):
            return
        prov = Provenance(
            applied_by=AppliedBy(applied_by),
            timestamp=datetime.now(timezone.utc),
            confidence=confidence,
            justification=justification,
            created_by=created_by,
        )
        if node.tags_provenance is None:
            node.tags_provenance = {}
        node.tags_provenance[tag] = prov.model_dump(mode="json")
        self._persist_provenance(node)

    def _delete_provenance(self, node: CPGNode, tag: str) -> None:
        if node.tags_provenance is None:
            return
        if tag in node.tags_provenance:
            del node.tags_provenance[tag]
            self._persist_provenance(node)

    def _persist_provenance(self, node: CPGNode) -> None:
        node_id = getattr(node, "id", None)
        if node_id is None:
            return
        self.store.update_node_properties(
            node_id,
            {"tags_provenance": getattr(node, "tags_provenance", {}) or {}},
        )

    def _get_ai_tagger(self, **kwargs):
        """Lazily create AI tagger via the injected factory."""
        if self._ai_tagger is None:
            if self._ai_tagger_factory is None:
                raise RuntimeError(
                    "AI tagging requires an ai_tagger_factory. "
                    "Pass ai_tagger_factory=lambda store, **kw: AITagger(store, **kw) "
                    "when constructing TagEngine."
                )
            self._ai_tagger = self._ai_tagger_factory(self.store, **kwargs)
        return self._ai_tagger

    def _find_by_pattern(self, pattern: str, limit: Optional[int]) -> List[CPGNode]:
        """Find nodes matching a tag wildcard pattern."""
        # Normalize the pattern to uppercase for case-insensitive matching
        normalized_pattern = pattern.strip().upper()

        # Extract prefix for efficient filtering
        prefix = pattern.split("*")[0].split("?")[0].rstrip(":").rstrip("_")

        # Get all matching tags using list_all with prefix
        matching_tags = self.store.tags.list_all(prefix=prefix if prefix else None)

        # Filter tags by the full pattern (case-insensitive)
        matching_tags = [t for t in matching_tags if fnmatch.fnmatch(t.upper(), normalized_pattern)]

        # Find nodes for each matching tag
        matched = []
        seen_ids = set()
        for tag in matching_tags:
            nodes = self.store.tags.find_nodes(tag)
            for node in nodes:
                if node.id not in seen_ids:
                    seen_ids.add(node.id)
                    matched.append(node)
                    if limit is not None and len(matched) >= limit:
                        return matched

        return matched
