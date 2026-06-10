# codedmap/app/query/context.py
"""
Entry Point Context Assembly - LLM-ready context for security analysis.

Provides flat JSON structure with all relevant context for an entry point:
- Identity fields (node_id, name, file, line, etc.)
- Code context (signature, code snippet)
- Call graph context (callers)
- Backward trace summary (controllable inputs)
- Architecture context (module path)
"""

import json
import logging
from dataclasses import dataclass, asdict, field
from typing import List, Optional, Any, Union

from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.base import CPGNode

logger = logging.getLogger(__name__)


@dataclass
class EntryPointContext:
    """
    LLM-ready context for a single entry point.

    All fields are at top-level (flat structure) for easy JSON consumption.
    No nested objects - everything is a primitive or list of primitives.
    """
    # Identity fields
    node_id: int
    name: str
    full_name: Optional[str]
    file: str
    line: int

    # Entry point metadata
    level: str  # L1, L2, L3
    category: str  # network, ipc, cli, etc.
    type: str  # http, grpc, etc.
    tags: List[str]

    # Code context
    code: str
    signature: Optional[str]

    # Call graph context
    callers: List[str]  # List of caller method names

    # Backward trace summary
    trace_found_controllable: bool
    trace_depth: int
    trace_termination: Optional[str]  # entry_point, source, parameter, max_depth, None

    # Architecture context
    module_path: Optional[str]

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    def to_json(self) -> str:
        """Export as JSON string."""
        return json.dumps(self.to_dict(), indent=2)


@dataclass
class EntryPointContextResult:
    """
    Wrapper for entry point context results with metadata.

    Provides total count and configuration used for the assembly.
    """
    results: List[EntryPointContext]
    total: int
    lines_used: int
    call_depth_used: int
    include_trace: bool

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "results": [r.to_dict() for r in self.results],
            "total": self.total,
            "lines_used": self.lines_used,
            "call_depth_used": self.call_depth_used,
            "include_trace": self.include_trace,
        }

    def to_json(self) -> str:
        """Export as JSON string."""
        return json.dumps(self.to_dict(), indent=2)


def assemble_entry_point_context(
    store: CPGStore,
    nodes: List[CPGNode],
    lines: int = 25,
    call_depth: int = 1,
    include_trace: bool = True,
) -> EntryPointContextResult:
    """
    Assemble LLM-ready context for a list of entry point nodes.

    This is the main entry point for context assembly. It composes
    multiple navigators to gather all relevant context.

    Args:
        store: CPGStore instance for graph queries
        nodes: List of CPGNode objects (entry points)
        lines: Number of code lines to include (default 25 per CONTEXT.md)
        call_depth: Depth for caller chain traversal (default 1 per CONTEXT.md)
        include_trace: Whether to include backward trace summary (default True)

    Returns:
        EntryPointContextResult with all assembled contexts
    """
    # Lazy imports to avoid heavy dependencies at module load
    from codedmap.analysis.traversal.ast import AstContextNavigator
    from codedmap.analysis.traversal.call import CallGraphNavigator
    from codedmap.analysis.traversal.context import ContextLoader, ContextStrategy

    # Create navigator instances
    ast_nav = AstContextNavigator(store)
    call_nav = CallGraphNavigator(store)
    context_loader = ContextLoader(store)

    # Assemble context for each node
    results = []
    for node in nodes:
        try:
            ctx = _assemble_single_context(
                store=store,
                node=node,
                ast_nav=ast_nav,
                call_nav=call_nav,
                context_loader=context_loader,
                lines=lines,
                call_depth=call_depth,
                include_trace=include_trace,
            )
            results.append(ctx)
        except Exception as e:
            logger.warning(f"Failed to assemble context for node {getattr(node, 'id', '?')}: {e}")
            # Create minimal context on failure
            results.append(_create_fallback_context(node, str(e)))

    return EntryPointContextResult(
        results=results,
        total=len(results),
        lines_used=lines,
        call_depth_used=call_depth,
        include_trace=include_trace,
    )


def _assemble_single_context(
    store: CPGStore,
    node: CPGNode,
    ast_nav: "AstContextNavigator",
    call_nav: "CallGraphNavigator",
    context_loader: "ContextLoader",
    lines: int,
    call_depth: int,
    include_trace: bool,
) -> EntryPointContext:
    """
    Assemble context for a single entry point node.

    Extracts all fields using the provided navigators and handles
    exceptions gracefully for partial context on failure.
    """
    # Extract identity fields from node attributes
    node_id = getattr(node, "id", -1)
    name = getattr(node, "name", "?")
    full_name = getattr(node, "fullName", None) or getattr(node, "full_name", None)
    file_name = getattr(node, "fileName", None) or getattr(node, "file_name", "") or ""
    line_number = getattr(node, "lineNumber", None) or getattr(node, "line_number", 0) or 0

    # Get tags and parse entry point metadata
    tags = list(store.tags.get_all(node)) if hasattr(store, "tags") else []
    level, category, ep_type = _parse_entry_point_tags(tags)

    # Get code context via AstContextNavigator
    try:
        code = ast_nav.get_context_code(node, max_lines=lines, window_strategy=True) or ""
    except Exception as e:
        logger.debug(f"Failed to get code context: {e}")
        code = ""

    # Extract signature from code
    signature = _extract_signature(code, name) if code else None

    # Get caller chain via CallGraphNavigator
    try:
        callers_iter = call_nav.get_recursive_callers(node, max_depth=call_depth)
        callers = [getattr(c, "name", "?") for c in callers_iter]
    except Exception as e:
        logger.debug(f"Failed to get callers: {e}")
        callers = []

    # Get backward trace summary via BackwardTracingNavigator
    trace_found_controllable = False
    trace_depth = 0
    trace_termination = None

    if include_trace:
        try:
            # Lazy import to avoid heavy dependencies
            from codedmap.analysis.traversal.tracing import BackwardTracingNavigator
            trace_nav = BackwardTracingNavigator(store)
            trace_result = trace_nav.trace_to_controllable(node, max_depth=10, max_paths=1)

            if trace_result.paths:
                first_path = trace_result.paths[0]
                trace_found_controllable = first_path.found_controllable
                trace_depth = len(first_path.hops) - 1 if first_path.hops else 0
                trace_termination = first_path.termination_reason
        except Exception as e:
            logger.debug(f"Failed to get backward trace: {e}")

    # Get architecture context via ContextLoader (PUBLIC interface)
    module_path = None
    try:
        context_data = context_loader.get_context_data(node, ContextStrategy.SUMMARY)
        architecture = context_data.get("architecture", {})
        module_path = architecture.get("module_path") if architecture else None
    except Exception as e:
        logger.debug(f"Failed to get architecture context: {e}")

    return EntryPointContext(
        node_id=node_id,
        name=name,
        full_name=full_name,
        file=file_name,
        line=line_number,
        level=level,
        category=category,
        type=ep_type,
        tags=tags,
        code=code,
        signature=signature,
        callers=callers,
        trace_found_controllable=trace_found_controllable,
        trace_depth=trace_depth,
        trace_termination=trace_termination,
        module_path=module_path,
    )


def _parse_entry_point_tags(tags: List[str]) -> tuple:
    """
    Extract level, category, and type from entry point tags.

    ONTOLOGY format: ONTOLOGY:ENTRY_POINT:{category}
    Level is no longer encoded in the tag string; defaults to "?".
    Uses SecurityTagMatcher for ONTOLOGY-only recognition.

    Returns:
        Tuple of (level, category, type) - defaults to "?" if not found
    """
    from codedmap.core.schema.tags.matcher import SecurityTagMatcher

    if not tags:
        return "?", "?", "?"

    for tag in tags:
        if tag and SecurityTagMatcher.is_entry_point(tag):
            category, _ = SecurityTagMatcher.parse_entry_point(tag)
            if category:
                cat_lower = category.lower()
                return "?", cat_lower, cat_lower

    return "?", "?", "?"


def _extract_signature(code: str, name: str) -> Optional[str]:
    """
    Extract function signature from code block.

    Uses simple heuristic: find first line containing the function name
    that looks like a signature (has opening parenthesis).

    Handles both Python (def foo():) and C (int foo() {) styles.

    Args:
        code: Code block to search
        name: Function/method name to look for

    Returns:
        Signature string without trailing braces/colons, or None if not found
    """
    if not code or not name:
        return None

    lines = code.split("\n")
    for line in lines:
        stripped = line.strip()

        # Skip empty lines and comments
        if not stripped or stripped.startswith("//") or stripped.startswith("#"):
            continue

        # Check if line contains the function name and looks like a signature
        if name in stripped and "(" in stripped:
            # Found a potential signature line
            # Extract up to and including the closing parenthesis
            paren_depth = 0
            sig_chars = []
            found_open = False

            for char in stripped:
                sig_chars.append(char)
                if char == "(":
                    paren_depth += 1
                    found_open = True
                elif char == ")":
                    paren_depth -= 1
                    if found_open and paren_depth == 0:
                        # Found matching close paren - stop here
                        break

            sig = "".join(sig_chars).rstrip()

            # Remove trailing { or : for C/Python style
            while sig.endswith("{") or sig.endswith(":"):
                sig = sig[:-1].rstrip()

            # Remove trailing } as well
            while sig.endswith("}"):
                sig = sig[:-1].rstrip()

            return sig

    return None


def _create_fallback_context(node: CPGNode, error: str) -> EntryPointContext:
    """
    Create minimal context when assembly fails.

    Provides identity fields only with error indication.
    """
    return EntryPointContext(
        node_id=getattr(node, "id", -1),
        name=getattr(node, "name", "?"),
        full_name=getattr(node, "fullName", None) or getattr(node, "full_name", None),
        file=getattr(node, "fileName", "") or getattr(node, "file_name", "") or "",
        line=getattr(node, "lineNumber", 0) or getattr(node, "line_number", 0) or 0,
        level="?",
        category="?",
        type="?",
        tags=[],
        code=f"[Error: {error}]",
        signature=None,
        callers=[],
        trace_found_controllable=False,
        trace_depth=0,
        trace_termination=None,
        module_path=None,
    )
