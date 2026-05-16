# codedmap/analysis/traversal/tracing.py
"""
Backward Tracing Navigator - traces from sinks to controllable inputs.

Canonical location (moved from app/tracing/navigator.py).
Uses BFS backward traversal through DDG edges with termination heuristics
to find paths from dangerous sink functions to where user input becomes controllable.
"""

import logging
from collections import deque
from typing import Union, List, Set, Optional, Iterator

from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.tags.matcher import SecurityTagMatcher
from codedmap.core.schema.security import (
    StaticSecurityRules,
    SinkCategory, TraceHop, TracePath, TraceResult,
    SinkCatalog,
)
from codedmap.analysis.traversal.base import BaseGraphNavigator, TraversalDirection

logger = logging.getLogger(__name__)


class BackwardTracingNavigator(BaseGraphNavigator):
    """
    Backward DDG traversal from sinks to controllable inputs.

    Uses BFS with cycle detection to find all paths from a sink function
    to where user input becomes controllable (entry points, known sources).

    Termination conditions:
    1. Node has ONTOLOGY:ENTRY_POINT:* tag
    2. Node is known source function (StaticSecurityRules._SOURCE_DB)
    3. Max depth reached
    """

    def __init__(self, store: CPGStore, sink_catalog: Optional[SinkCatalog] = None):
        """
        Initialize backward tracing navigator.

        Args:
            store: CPGStore instance for graph queries
            sink_catalog: Optional pre-built SinkCatalog (e.g., from RuleRegistry).
                          If None, loads default catalog from YAML.
        """
        super().__init__(store)
        self.sink_catalog = sink_catalog or SinkCatalog.load_default()
        self._entry_point_tags_cache = None

    def trace_to_controllable(
        self,
        start_node: Union[CPGNode, int],
        max_depth: int = 10,
        max_paths: int = 10,
    ) -> TraceResult:
        """
        Trace backward from sink through DDG to find controllable input.

        Uses BFS with visited tracking to handle cycles.
        Terminates at: entry points, known sources, or max_depth.

        Args:
            start_node: Sink node to trace from (CPGNode or node ID)
            max_depth: Maximum hops to trace (default 10 per CONTEXT.md)
            max_paths: Maximum paths to return (default 10 per CONTEXT.md)

        Returns:
            TraceResult with all paths found
        """
        start_id = self._ensure_node_id(start_node)

        # BFS queue: (node_id, depth, path_so_far)
        # path_so_far is list of (node_id, hop_type) tuples
        queue = deque([(start_id, 0, [(start_id, "sink")])])
        visited_paths: Set[int] = {start_id}  # Track visited nodes to avoid cycles
        paths_found: List[TracePath] = []

        while queue and len(paths_found) < max_paths:
            curr_id, depth, path = queue.popleft()

            # Check termination: is this a controllable input?
            termination = self._check_controllable(curr_id)

            if termination:
                # Found a path to controllable input
                trace_path = self._build_trace_path(path, termination, True)
                paths_found.append(trace_path)
                continue

            # Check depth limit
            if depth >= max_depth:
                # Record partial path (didn't reach controllable input)
                trace_path = self._build_trace_path(path, "max_depth", False)
                paths_found.append(trace_path)
                continue

            # Get DDG predecessors (backward data flow) — intra-procedural
            has_new_predecessors = False
            for pred in self._get_ddg_predecessors(curr_id):
                if pred.id not in visited_paths:
                    visited_paths.add(pred.id)
                    new_path = path + [(pred.id, "ddg")]
                    queue.append((pred.id, depth + 1, new_path))
                    has_new_predecessors = True

            # Inter-procedural: jump from method boundary to caller arguments
            for pred in self._get_interprocedural_predecessors(curr_id):
                if pred.id not in visited_paths:
                    visited_paths.add(pred.id)
                    new_path = path + [(pred.id, "interprocedural")]
                    queue.append((pred.id, depth + 1, new_path))
                    has_new_predecessors = True

            # Cross-boundary: traverse IPC/SYSCALL/RPC/SHARED_DATA edges backward
            for pred in self._get_cross_boundary_predecessors(curr_id):
                if pred.id not in visited_paths:
                    visited_paths.add(pred.id)
                    new_path = path + [(pred.id, "cross_boundary")]
                    queue.append((pred.id, depth + 1, new_path))
                    has_new_predecessors = True

            # Record dead-end paths (no unvisited predecessors found)
            if not has_new_predecessors:
                trace_path = self._build_trace_path(path, "dead_end", False)
                paths_found.append(trace_path)

        return TraceResult(
            sink_node_id=start_id,
            paths=paths_found[:max_paths],
            max_depth_used=max_depth,
            total_paths=len(paths_found),
        )

    def _get_ddg_predecessors(self, node_id: int) -> Iterator[CPGNode]:
        """Get DDG predecessors (nodes that define values used by this node)."""
        return self._get_neighbors(node_id, EdgeType.DDG, TraversalDirection.IN)

    def _get_cross_boundary_predecessors(self, node_id: int) -> Iterator[CPGNode]:
        """Yield nodes that link TO this node via cross-boundary edges (backward traversal)."""
        cross_boundary_types = [EdgeType.IPC, EdgeType.SYSCALL, EdgeType.RPC, EdgeType.SHARED_DATA]
        for edge_type in cross_boundary_types:
            yield from self._get_neighbors(node_id, edge_type, TraversalDirection.IN)

    def _get_interprocedural_predecessors(self, node_id: int) -> Iterator[CPGNode]:
        """
        Cross procedure boundaries when DDG chain reaches METHOD or METHOD_PARAMETER_IN.

        For METHOD_PARAMETER_IN at order N:
          1. Find parent METHOD (AST IN)
          2. Find all CALL sites targeting that method (CALL IN on METHOD)
          3. For each call site, find ARGUMENT child at order N (AST OUT, filter by order)
          4. Yield those argument nodes

        For METHOD nodes:
          1. Find all CALL sites (CALL IN)
          2. Yield call sites as predecessors (the call expression itself carries data)
        """
        node = self.store.get_node(node_id)
        if not node:
            return

        raw_label = getattr(node, "label", "")
        # Handle both enum (NodeLabel.METHOD → .value = "METHOD") and plain string
        label = (raw_label.value if hasattr(raw_label, "value") else str(raw_label)).upper()

        if label == "METHOD_PARAMETER_IN":
            yield from self._resolve_param_to_caller_args(node)
        elif label == "METHOD":
            yield from self._resolve_method_to_call_sites(node)

    def _resolve_param_to_caller_args(self, param_node: CPGNode) -> Iterator[CPGNode]:
        """Resolve METHOD_PARAMETER_IN to caller's matching ARGUMENT nodes."""
        param_order = getattr(param_node, "order", None)
        if param_order is None:
            return

        # Find parent METHOD via AST IN
        method_nodes = list(self._get_neighbors(param_node, EdgeType.AST, TraversalDirection.IN))
        for method_node in method_nodes:
            raw_ml = getattr(method_node, "label", "")
            method_label = (raw_ml.value if hasattr(raw_ml, "value") else str(raw_ml)).upper()
            if method_label != "METHOD":
                continue

            # Find all CALL sites targeting this method
            call_sites = self._get_neighbors(method_node, EdgeType.CALL, TraversalDirection.IN)
            for call_site in call_sites:
                # Find ARGUMENT children of the call site
                arg_children = self._get_neighbors(call_site, EdgeType.AST, TraversalDirection.OUT)
                for arg in arg_children:
                    arg_order = getattr(arg, "argument_index", None)
                    if arg_order is None:
                        arg_order = getattr(arg, "argumentIndex", None)
                    if arg_order is not None and int(arg_order) == int(param_order):
                        yield arg

    def _resolve_method_to_call_sites(self, method_node: CPGNode) -> Iterator[CPGNode]:
        """Resolve METHOD node to its call sites."""
        call_sites = self._get_neighbors(method_node, EdgeType.CALL, TraversalDirection.IN)
        for call_site in call_sites:
            yield call_site

    def _check_controllable(self, node_id: int) -> Optional[str]:
        """
        Check if node represents controllable input.

        Returns:
            Termination reason if controllable, None otherwise
        """
        node = self.store.get_node(node_id)
        if not node:
            return None

        # 1. Check for entry point tags
        if self._has_entry_point_tag(node):
            return "entry_point"

        # 2. Check for ONTOLOGY:SOURCE:* tags
        tags = self.store.tags.get_all(node)
        if any(SecurityTagMatcher.is_source(tag) for tag in tags):
            return "source"

        # 3. Check for known source functions (fallback for untagged nodes)
        node_name = getattr(node, "name", None) or getattr(node, "code", "")
        if node_name and StaticSecurityRules.is_obvious_source(node_name):
            return "source"

        # 4. Check if node is a method/function parameter (potential external input)
        if self._is_parameter_node(node):
            return "parameter"

        return None

    def _has_entry_point_tag(self, node: CPGNode) -> bool:
        """Check if node has an ONTOLOGY:ENTRY_POINT:* tag."""
        tags = self.store.tags.get_all(node)
        for tag in tags:
            if SecurityTagMatcher.is_entry_point(tag):
                return True
        return False

    def _is_parameter_node(self, node: CPGNode) -> bool:
        """Check if node is a function parameter (potential external input)."""
        label = getattr(node, "label", None)
        if label and str(label).upper() == "PARAM":
            return True
        # Also check if identifier matches parameter names in enclosing method
        # This is a heuristic - check if parent method has a param with this name
        return False  # Conservative: don't mark as controllable without evidence

    def _build_trace_path(
        self,
        path: List[tuple],  # [(node_id, hop_type), ...]
        termination_reason: str,
        found_controllable: bool,
    ) -> TracePath:
        """Build a TracePath from the raw path data."""
        hops = []
        for node_id, hop_type in path:
            node = self.store.get_node(node_id)
            if node:
                code = self._get_node_code(node)
                file_name = self._get_node_file(node)
                line = self._get_node_line(node)

                hops.append(TraceHop(
                    node_id=node_id,
                    file=file_name,
                    line=line,
                    code=code[:80] if code else "",  # Truncate to 80 chars
                    hop_type=hop_type,
                ))

        return TracePath(
            hops=hops,
            found_controllable=found_controllable,
            termination_reason=termination_reason,
        )

    def _get_node_code(self, node: CPGNode) -> str:
        """Get code snippet from node (handles both code and code() method)."""
        code = getattr(node, "code", None)
        if code:
            return str(code).strip()
        # Try get_code() method if available
        if hasattr(node, "get_code"):
            result = node.get_code()
            return result.strip() if result else ""
        return ""

    def _get_node_file(self, node: CPGNode) -> str:
        """Get file name from node."""
        return getattr(node, "file_name", None) or getattr(node, "fileName", "") or ""

    def _get_node_line(self, node: CPGNode) -> int:
        """Get line number from node."""
        line = getattr(node, "line_number", None) or getattr(node, "lineNumber", 0)
        return int(line) if line else 0
