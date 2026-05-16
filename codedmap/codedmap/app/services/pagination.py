"""Shared pagination helpers for service-layer list/find commands."""

from __future__ import annotations

from typing import Sequence, TypeVar, Dict, Any

T = TypeVar("T")

DEFAULT_LIMIT = 50
MAX_LIMIT = 500


def normalize_page(offset: int = 0, limit: int = DEFAULT_LIMIT, *, max_limit: int = MAX_LIMIT) -> tuple[int, int]:
    """Normalize untrusted offset/limit inputs to safe integer bounds."""
    safe_offset = max(int(offset or 0), 0)
    safe_limit = max(int(limit or DEFAULT_LIMIT), 1)
    if max_limit > 0:
        safe_limit = min(safe_limit, max_limit)
    return safe_offset, safe_limit


def paginate_sequence(items: Sequence[T], offset: int = 0, limit: int = DEFAULT_LIMIT) -> Dict[str, Any]:
    """Apply offset/limit paging to an in-memory sequence with canonical metadata."""
    safe_offset, safe_limit = normalize_page(offset=offset, limit=limit)
    total = len(items)
    page_items = list(items[safe_offset: safe_offset + safe_limit])
    has_more = (safe_offset + safe_limit) < total
    return {
        "items": page_items,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "has_more": has_more,
        "truncated": has_more,
    }
