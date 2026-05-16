# codedmap\analysis\traversal\__init__.py

from .ast import AstContextNavigator
from .dataflow import DataFlowNavigator
from .call import CallGraphNavigator
from .cfg import ControlFlowNavigator
from .context import ContextLoader
from .structure import RepoStructureNavigator
from .formatter import ChainFormatter, FocusStrategy
from .module import ModuleNavigator

# Context Slice (Phase 16)
from .context_slice import (
    ContextSliceBuilder,
    ContextSlice,
    SliceOptions,
    TargetInfo,
    ScopeEntry,
    DDGEntry,
    CalleeInfo,
)

# TagNavigator moved to codedmap.analysis.tagging.navigator
# Re-export for backward compatibility, but use deferred import to avoid circular deps
def __getattr__(name):
    if name == "TagNavigator":
        from codedmap.analysis.tagging.navigator import TagNavigator
        return TagNavigator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "AstContextNavigator",
    "DataFlowNavigator",
    "CallGraphNavigator",
    "ControlFlowNavigator",
    "ContextLoader",
    "RepoStructureNavigator",
    "ChainFormatter",
    "FocusStrategy",
    "ModuleNavigator",
    "TagNavigator",
    # Context Slice (Phase 16)
    "ContextSliceBuilder",
    "ContextSlice", 
    "SliceOptions",
    "TargetInfo",
    "ScopeEntry",
    "DDGEntry",
    "CalleeInfo",
]
