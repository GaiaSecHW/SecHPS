# codedmap/analysis/tagging/__init__.py
"""
Tagging Analysis Package.

Canonical location for TagEngine and TagNavigator (Layer 2).
Moved from app/tagging/ to eliminate analysis→app import violations.
"""

from .engine import TagEngine, TagPermissionError  # noqa: F401
from .navigator import TagNavigator, TagResult  # noqa: F401

__all__ = [
    "TagEngine",
    "TagPermissionError",
    "TagNavigator",
    "TagResult",
]
