"""
Canonical semantic-edge identity helper for audit-relevant edges.

This module provides a canonical definition of when two edges are semantically the "same"
or distinct by their semantic properties (e.g., variable for DDG, label for CFG),
rather than relying on endpoint/type only.

Usage:
    from codedmap.infra.storage.base.edge_identity import (
        edge_semantic_identity,
        compute_semantic_edge_hash
    )

    # Get semantic identity tuple for an edge
    slot, value = edge_semantic_identity("DDG", {"variable": "x"})

    # Compute hash for dedup purposes
    edge_hash = compute_semantic_edge_hash(src_id, dst_id, edge_type, properties)
"""

from typing import Tuple, Optional, Dict, Any

from codedmap.core.schema.graph.enums import EdgeType


def edge_semantic_identity(edge_type: str, properties: Optional[Dict[str, Any]]) -> Tuple[str, Optional[str]]:
    """
    Determine the semantic identity of an edge based on its type and properties.

    For edges that support semantic variants (parallel edges between the same endpoints
    that differ by a semantic property), returns (slot_name, value).

    For edges that don't support semantic variants, returns (None, None).

    Args:
        edge_type: Edge type as string (e.g., "DDG", "CFG")
        properties: Edge properties dict (may be None)

    Returns:
        Tuple of (semantic_slot, semantic_value) where:
        - semantic_slot: Name of the property that distinguishes parallel edges
        - semantic_value: Value of that property, or None if not present

    Semantic slots by edge type:
        - DDG: "variable" - data dependency edges are distinct per variable
        - CFG: "label" - control flow edges are distinct per branch label (true/false)
        - Other: No semantic distinction (endpoint+type is sufficient)
    """
    # Normalize edge_type to string
    edge_type_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)

    if edge_type_str == "DDG":
        semantic_slot = "variable"
        semantic_value = (properties.get("variable") if properties else None) or ""
        return (semantic_slot, semantic_value)

    elif edge_type_str == "CFG":
        semantic_slot = "label"
        semantic_value = (properties.get("label") if properties else None) or ""
        return (semantic_slot, semantic_value)

    else:
        # For non-semantic edge types, use empty string to enable UNIQUE constraint dedup
        return (None, "")


def compute_semantic_edge_hash(
    src_id: int,
    dst_id: int,
    edge_type: Any,
    properties: Optional[Dict[str, Any]]
) -> int:
    """
    Compute a hash for edge deduplication that includes semantic identity.

    This function produces a hash that distinguishes:
    - Edges with different endpoints (src, dst)
    - Edges with different types
    - For DDG/CFG: edges with different semantic properties (variable/label)

    Args:
        src_id: Source node ID
        dst_id: Destination node ID
        edge_type: Edge type (EdgeType enum or string)
        properties: Edge properties dict (may be None)

    Returns:
        Integer hash suitable for set-based deduplication
    """
    # Get semantic identity
    semantic_slot, semantic_value = edge_semantic_identity(edge_type, properties)

    # Build hash key
    # For semantic edges, include the semantic value in the hash
    # For non-semantic edges, use None for the semantic component
    return hash((src_id, dst_id, edge_type, semantic_value))


__all__ = ['edge_semantic_identity', 'compute_semantic_edge_hash']
