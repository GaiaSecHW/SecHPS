# codedmap/infra/ai/cache.py
"""
Unified AI Result Cache.

Content-hash based caching for all AI service calls.
Same input (prompt + context) never triggers a duplicate LLM call.

Uses DiskMap (SQLite KV) for persistent caching across sessions.

Usage:
    from codedmap.infra.ai.cache import AICache

    cache = AICache(cache_dir="/path/to/cache")
    key = cache.make_key(prompt="...", context="...")
    result = cache.get(key)
    if result is None:
        result = call_llm(...)
        cache.set(key, result)
"""

import hashlib
import json
import logging
import os
from typing import Optional, Any

logger = logging.getLogger(__name__)


class AICache:
    """
    Content-hash based AI result cache backed by DiskMap.

    Thread-safe for reads. Writes are append-only (no updates).
    """

    def __init__(self, cache_dir: Optional[str] = None, enabled: bool = True):
        self.enabled = enabled
        self._disk_map = None
        self._cache_dir = cache_dir

    def _ensure_disk_map(self):
        """Lazily initialize DiskMap."""
        if self._disk_map is not None:
            return
        if not self.enabled:
            return

        try:
            from codedmap.infra.utils.disk_map import DiskMap

            cache_dir = self._cache_dir or os.path.join(
                os.path.expanduser("~"), ".cpg_sdk", "ai_cache"
            )
            os.makedirs(cache_dir, exist_ok=True)

            db_path = os.path.join(cache_dir, "ai_cache.db")
            self._disk_map = DiskMap(db_path)
            self._disk_map.__enter__()
            logger.debug(f"AI cache initialized at {db_path}")
        except Exception as e:
            logger.warning(f"Failed to initialize AI cache: {e}")
            self.enabled = False

    @staticmethod
    def make_key(*args, **kwargs) -> str:
        """
        Generate a deterministic cache key from arbitrary inputs.

        All arguments are serialized to JSON and SHA-256 hashed.
        """
        content = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
        return hashlib.sha256(content.encode()).hexdigest()

    def get(self, key: str) -> Optional[str]:
        """Get cached result by key. Returns None on miss."""
        if not self.enabled:
            return None
        self._ensure_disk_map()
        if self._disk_map is None:
            return None
        try:
            return self._disk_map.get(key)
        except Exception:
            return None

    def set(self, key: str, value: Any):
        """Store result in cache."""
        if not self.enabled:
            return
        self._ensure_disk_map()
        if self._disk_map is None:
            return
        try:
            str_value = value if isinstance(value, str) else json.dumps(value, default=str)
            self._disk_map.set(key, str_value)
        except Exception as e:
            logger.warning(f"Failed to cache AI result: {e}")

    def close(self):
        """Close the underlying DiskMap."""
        if self._disk_map is not None:
            try:
                self._disk_map.__exit__(None, None, None)
            except Exception:
                pass
            self._disk_map = None
