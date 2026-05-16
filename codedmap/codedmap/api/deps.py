# codedmap/api/deps.py
"""
Shared FastAPI dependencies: CPGStore singleton and API key validation.
"""

import asyncio
import re
from typing import Optional

from fastapi import Header, HTTPException
from fastapi.security import APIKeyHeader

from codedmap.infra.storage.store import CPGStore

ACTOR_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')

# ---------------------------------------------------------------------------
# Store singleton
# ---------------------------------------------------------------------------

_store: Optional[CPGStore] = None
_store_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _store_lock
    if _store_lock is None:
        _store_lock = asyncio.Lock()
    return _store_lock


def init_store(db_path: str, backend: str = "sqlite") -> None:
    """Initialize the module-level CPGStore singleton."""
    global _store
    from codedmap.core.configs.storage import StorageConfig
    _store = CPGStore(StorageConfig(backend=backend, uri=db_path))


def close_store() -> None:
    """Close and clear the singleton store."""
    global _store
    if _store is not None:
        try:
            _store.close()
        except Exception:
            pass
        _store = None


def get_store() -> CPGStore:
    """FastAPI Depends() callable — returns the singleton store or raises 503."""
    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialized")
    return _store


async def get_store_lock() -> asyncio.Lock:
    """FastAPI Depends() callable — returns the write serialization lock."""
    return _get_lock()


# ---------------------------------------------------------------------------
# API key auth
# ---------------------------------------------------------------------------

_api_key: Optional[str] = None


def verify_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """FastAPI dependency for optional API key authentication.

    If no key is configured, all requests pass through.
    If a key is configured, the X-API-Key header must match.
    """
    if _api_key is None:
        return  # Auth not configured — open access
    if x_api_key != _api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Agent ID validation
# ---------------------------------------------------------------------------

def require_agent_id(x_agent_id: str = Header(..., alias="X-Agent-ID")) -> str:
    """FastAPI dependency that requires X-Agent-ID header with valid format.

    Valid actor format: alphanumeric characters, hyphens, underscores only.
    Must NOT contain '@' or ':' which are reserved for created_by composition.

    Returns:
        The validated actor string for use in get_created_by().

    Raises:
        HTTPException 400: If header is missing, empty, or has invalid format.
    """
    if not x_agent_id or not x_agent_id.strip():
        raise HTTPException(
            status_code=400,
            detail="X-Agent-ID header is required for graph modification requests"
        )

    actor = x_agent_id.strip()

    if not ACTOR_PATTERN.match(actor):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid X-Agent-ID format: '{actor}'. Must contain only letters, numbers, hyphens, and underscores."
        )

    return actor
