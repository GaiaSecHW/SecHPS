# codedmap/analysis/tagging/navigator.py
"""
TagNavigator — Business logic layer for security tagging operations.

Canonical location (moved from app/tagging/navigator.py).
Provides validated, human-friendly tag operations on CPG nodes.
Used by CLI `tag` command, `/cpg-tag` skill, and TagEngine.

Architecture:
    Skill/CLI -> TagNavigator -> CPGStore.tags (TagRepository) -> Storage Backend
"""

import re
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.tags.layer import TagLayer
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.base import BaseGraphNavigator

logger = logging.getLogger(__name__)

# Layered tag pattern: LAYER:NAMESPACE:NAME (colon-separated uppercase)
# Layers: ONTOLOGY (L1, read-only), SEMANTIC (L2, agent-writable), STATE (L3, human/agent)
# STATE layer allows 2-part format (STATE:REVIEWED) or 3+ parts (STATE:CUSTOM:NAME)
_LAYERED_TAG_PATTERN = re.compile(
    r"^(ONTOLOGY|SEMANTIC|STATE):[A-Z][A-Z0-9_]*(:[A-Z][A-Z0-9_]*)*$"
)


@dataclass
class TagResult:
    """Result of a single tag operation."""
    node_id: int
    node_name: str
    tag: str
    action: str  # "added", "removed", "already_exists", "not_found"
    warning: Optional[str] = None


class TagNavigator(BaseGraphNavigator):
    """
    Business logic layer for CPG node tagging.

    Responsibilities:
    - Tag format validation and normalization
    - Node resolution (delegated to caller / CLI bootstrap)
    - Human-readable operation results
    - Bulk tagging by name pattern
    """

    def __init__(self, store: CPGStore):
        super().__init__(store)

    def validate_tag(self, tag: str) -> Tuple[str, Optional[str]]:
        """
        Validate and normalize a tag string.

        Tags must use colon-separated namespace format: LAYER:NAMESPACE:NAME
        Valid layers: ONTOLOGY, SEMANTIC, STATE.

        Returns:
            (normalized_tag, None)

        Raises:
            ValueError: If the tag is empty or does not match the required format.
        """
        normalized = tag.strip().upper()
        if not normalized:
            raise ValueError("Tag cannot be empty.")
        if ":" not in normalized or not _LAYERED_TAG_PATTERN.match(normalized):
            raise ValueError(
                "Invalid tag format. Tags must use the colon-separated namespace format "
                "starting with ONTOLOGY:, SEMANTIC:, or STATE:."
            )
        return normalized, None

    def validate_namespaced_tag(self, tag: str) -> Tuple[str, Optional[str]]:
        """Validate a layered tag string. Delegates to validate_tag()."""
        return self.validate_tag(tag)

    def _validate_tag_appropriate(self, tag: str) -> Tuple[str, Optional[str]]:
        """Validate a tag. Delegates to validate_tag()."""
        return self.validate_tag(tag)

    def _detect_layer(self, tag: str) -> Optional['TagLayer']:
        """Detect the layer of a tag string by parsing its prefix.

        Returns TagLayer enum for valid layered tags, None for legacy flat tags.
        Does NOT import or use TagRegistry -- pure prefix parsing.
        """
        if not tag or ":" not in tag:
            return None
        prefix = tag.strip().upper().split(":")[0]
        try:
            return TagLayer(prefix)
        except ValueError:
            return None

    def add_tag(self, node: CPGNode, tag: str) -> TagResult:
        """Add a tag to a single node (idempotent)."""
        normalized, warning = self._validate_tag_appropriate(tag)

        existing = self.store.tags.get_all(node)
        if normalized in existing:
            return TagResult(
                node_id=node.id,
                node_name=getattr(node, "name", "?"),
                tag=normalized,
                action="already_exists",
                warning=warning,
            )

        self.store.tags.add(node, normalized)
        return TagResult(
            node_id=node.id,
            node_name=getattr(node, "name", "?"),
            tag=normalized,
            action="added",
            warning=warning,
        )

    def remove_tag(self, node: CPGNode, tag: str) -> TagResult:
        """Remove a tag from a single node."""
        normalized, _ = self._validate_tag_appropriate(tag)

        existing = self.store.tags.get_all(node)
        if normalized not in existing:
            return TagResult(
                node_id=node.id,
                node_name=getattr(node, "name", "?"),
                tag=normalized,
                action="not_found",
            )

        self.store.tags.remove(node, normalized)
        return TagResult(
            node_id=node.id,
            node_name=getattr(node, "name", "?"),
            tag=normalized,
            action="removed",
        )

    def list_tags(self, node: CPGNode) -> List[str]:
        """Get all tags for a node."""
        return self.store.tags.get_all(node)

    def find_by_tag(self, tag: str, limit: Optional[int] = 50) -> List[CPGNode]:
        """Find all nodes with a given tag (supports prefix matching for namespaced tags)."""
        normalized = tag.strip().upper()

        # For namespaced tags, support prefix matching
        # e.g., "ONTOLOGY:ENTRY_POINT" matches "ONTOLOGY:ENTRY_POINT:HTTP"
        if ":" in tag:
            # Try exact match first
            results = self.store.tags.find_nodes(normalized)
            if results:
                return results if limit is None else results[:limit]

            # If no exact match, try prefix matching
            prefix = tag.strip().upper()
            all_tags = self.store.tags.list_all(prefix=prefix.split(":")[0])
            matching_tags = [t for t in all_tags if t.startswith(prefix)]

            matched = []
            seen_ids = set()
            for t in matching_tags:
                nodes = self.store.tags.find_nodes(t)
                for node in nodes:
                    if node.id not in seen_ids:
                        seen_ids.add(node.id)
                        matched.append(node)
                        if limit is not None and len(matched) >= limit:
                            return matched
            return matched

        # Non-colon tag: validate (will raise for invalid format) then exact match
        normalized, _ = self.validate_tag(tag)
        results = self.store.tags.find_nodes(normalized)
        return results if limit is None else results[:limit]

    def bulk_tag(self, pattern: str, tag: str, node_type: str = "method") -> List[TagResult]:
        """
        Add a tag to all nodes matching a name pattern.

        Args:
            pattern: Name substring to match (e.g., "mepluginy", "alloc").
            tag: Tag to apply.
            node_type: "method"

        Returns:
            List of TagResult for each matched node.
        """
        normalized, warning = self._validate_tag_appropriate(tag)

        if node_type == "method":
            matches = self.store.methods.find_by_name(pattern, exact_match=False)
        elif node_type == "module":
            matches = self.store.modules.find_by_name(pattern, exact_match=False)
        else:
            matches = self.store.query.all_nodes().where_contains("name", pattern).to_list()

        results = []
        for node in matches:
            existing = self.store.tags.get_all(node)
            if normalized in existing:
                results.append(TagResult(
                    node_id=node.id,
                    node_name=getattr(node, "name", "?"),
                    tag=normalized,
                    action="already_exists",
                    warning=warning,
                ))
            else:
                self.store.tags.add(node, normalized)
                results.append(TagResult(
                    node_id=node.id,
                    node_name=getattr(node, "name", "?"),
                    tag=normalized,
                    action="added",
                    warning=warning,
                ))

        return results
