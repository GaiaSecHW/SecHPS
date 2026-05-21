# codedmap/analysis/traversal/context_slice.py
"""
Context Slice Assembly — Structured context extraction for agents.

This module provides the ContextSlice Pydantic model hierarchy and ContextSliceBuilder
that assembles depth-bounded context from a target CPG node. Agents call build(node)
and receive everything needed to reason about a function without additional queries.

Requirements: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, DSL-02
"""

from collections import deque
from typing import Any, Dict, Iterator, List, Optional, Set, Union

from pydantic import BaseModel, ConfigDict, Field

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    CallNode,
    ControlStructureNode,
    FileNode,
    IdentifierNode,
    MethodNode,
    NamespaceBlockNode,
    TypeDeclNode,
)
from codedmap.infra.storage.store import CPGStore


# =============================================================================
# Pydantic Models
# =============================================================================


class SliceOptions(BaseModel):
    """Configuration options for context slice assembly."""

    model_config = ConfigDict(frozen=True)

    ddg_depth: int = 3
    include_source: bool = True
    include_ddg: bool = True
    include_callees: bool = True
    include_globals: bool = True
    include_tags: bool = True
    max_source_lines: int = 600
    truncate_source: bool = True
    max_callees: int = 20


class TargetInfo(BaseModel):
    """Target node metadata."""

    model_config = ConfigDict(ser_json_exclude_none=False)

    node_id: int
    node_name: str
    label: str
    language: Optional[str] = None
    file_path: Optional[str] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    summary: Optional[str] = None


class ScopeEntry(BaseModel):
    """Enclosing scope entry (FILE, NAMESPACE, TYPE_DECL, METHOD)."""

    model_config = ConfigDict(ser_json_exclude_none=False)

    type: str  # FILE, NAMESPACE, TYPE_DECL, METHOD
    name: str


class DDGEntry(BaseModel):
    """Data dependency graph entry with depth annotation."""

    model_config = ConfigDict(ser_json_exclude_none=False)

    node_id: int
    variable: str
    code: str
    line: Optional[int] = None
    file_path: Optional[str] = None
    depth: int
    control_context: List[str] = Field(default_factory=list)
    truncated: bool = False


class CalleeInfo(BaseModel):
    """Callee method information."""

    model_config = ConfigDict(ser_json_exclude_none=False)

    node_id: int
    name: str
    full_name: Optional[str] = None
    signature: Optional[str] = None
    file_path: Optional[str] = None
    line: Optional[int] = None
    is_external: bool = False
    docstring: Optional[str] = None
    summary: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class ContextSlice(BaseModel):
    """
    Unified context slice model for agent consumption.

    None = explicitly excluded by options
    [] = included but nothing found
    """

    model_config = ConfigDict(ser_json_exclude_none=False)

    target: TargetInfo
    enclosing_scope: List[ScopeEntry]  # Always present, outermost to innermost
    source: Optional[str] = None
    target_line_range: Optional[List[int]] = None
    reaching_definitions: Optional[List[DDGEntry]] = None
    forward_usages: Optional[List[DDGEntry]] = None
    callees: Optional[List[CalleeInfo]] = None
    callees_truncated: Optional[bool] = None
    callees_total: Optional[int] = None
    tags: Optional[List[str]] = None
    tags_provenance: Optional[Dict[str, Any]] = None
    referenced_globals: Optional[List[str]] = None


# =============================================================================
# ContextSliceBuilder
# =============================================================================


class ContextSliceBuilder:
    """
    Assembles structured ContextSlice from a target CPG node.

    Usage:
        builder = ContextSliceBuilder(store, ast_navigator, call_navigator)
        slice = builder.build(node, SliceOptions(ddg_depth=5))
        json_data = slice.model_dump(mode='json')
    """

    def __init__(
        self,
        store: CPGStore,
        ast: "AstContextNavigator",
        call: "CallGraphNavigator",
    ):
        self.store = store
        self.ast = ast
        self.call = call

    def build(self, node: CPGNode, options: Optional[SliceOptions] = None) -> ContextSlice:
        """Build a ContextSlice for the given node."""
        options = options or SliceOptions()

        # Core sections (always built)
        target = self._build_target_info(node)
        scope = self._build_scope_chain(node)

        # Optional sections based on options
        source = self._build_source(node, options) if options.include_source else None
        target_line_range = self._get_target_line_range(node) if options.include_source else None

        reaching = self._build_ddg_backward(node, options) if options.include_ddg else None
        forward = self._build_ddg_forward(node, options) if options.include_ddg else None

        callees_data = self._build_callees(node, options) if options.include_callees else None
        globals_data = self._build_globals(node, options) if options.include_globals else None
        tags_data = self._build_tags(node) if options.include_tags else None

        return ContextSlice(
            target=target,
            enclosing_scope=scope,
            source=source,
            target_line_range=target_line_range,
            reaching_definitions=reaching,
            forward_usages=forward,
            callees=callees_data[0] if callees_data else None,
            callees_truncated=callees_data[1] if callees_data else None,
            callees_total=callees_data[2] if callees_data else None,
            tags=tags_data[0] if tags_data else None,
            tags_provenance=tags_data[1] if tags_data else None,
            referenced_globals=globals_data,
        )

    # =========================================================================
    # Target Info & Scope Chain
    # =========================================================================

    def _build_target_info(self, node: CPGNode) -> TargetInfo:
        """Extract target node metadata."""
        label = ""
        if hasattr(node, "label"):
            lbl = node.label
            label = lbl.value if hasattr(lbl, "value") else str(lbl)

        language = None
        file_path = getattr(node, "file_name", None)

        # Get language from enclosing file
        if file_path:
            try:
                enclosing_file = self.ast.get_enclosing_file(node)
                if enclosing_file and hasattr(enclosing_file, "language"):
                    lang = enclosing_file.language
                    language = lang.value if hasattr(lang, "value") else str(lang)
            except Exception:
                pass

        return TargetInfo(
            node_id=node.id,
            node_name=getattr(node, "name", "") or "",
            label=label,
            language=language,
            file_path=file_path,
            line_start=getattr(node, "line_number", None),
            line_end=getattr(node, "line_number_end", None),
            summary=getattr(node, "summary", None),
        )

    def _build_scope_chain(self, node: CPGNode) -> List[ScopeEntry]:
        """Build enclosing scope chain from outermost to innermost."""
        scope: List[ScopeEntry] = []

        # File (outermost)
        try:
            file_node = self.ast.get_enclosing_file(node)
            if file_node:
                scope.append(ScopeEntry(type="FILE", name=getattr(file_node, "name", "") or ""))
        except Exception:
            pass

        # Namespace
        try:
            ns_node = self.ast.get_enclosing_namespace(node)
            if ns_node:
                scope.append(
                    ScopeEntry(type="NAMESPACE", name=getattr(ns_node, "name", "") or "")
                )
        except Exception:
            pass

        # Type declaration (class/struct)
        try:
            type_node = self.ast.get_enclosing_type(node)
            if type_node:
                scope.append(
                    ScopeEntry(type="TYPE_DECL", name=getattr(type_node, "name", "") or "")
                )
        except Exception:
            pass

        # Method
        try:
            method_node = self.ast.get_enclosing_method(node)
            if method_node:
                scope.append(
                    ScopeEntry(type="METHOD", name=getattr(method_node, "name", "") or "")
                )
        except Exception:
            pass

        return scope

    # =========================================================================
    # Source Code
    # =========================================================================

    def _build_source(self, node: CPGNode, options: SliceOptions) -> Optional[str]:
        """Build source code with line-number prefixes and optional truncation."""
        # For MethodNode, get the method body directly
        if isinstance(node, MethodNode):
            return self._get_method_source(node, node, options)

        # For non-method targets, find enclosing method and highlight target lines
        try:
            enclosing_method = self.ast.get_enclosing_method(node)
            if enclosing_method:
                return self._get_method_source(enclosing_method, node, options)
        except Exception:
            pass

        # Fallback: try to get context code via AST navigator
        try:
            return self.ast.get_context_code(node, max_lines=options.max_source_lines)
        except Exception:
            return None

    def _get_method_source(
        self, method: MethodNode, target: CPGNode, options: SliceOptions
    ) -> Optional[str]:
        """Get method source with line-number prefixes and target highlighting."""
        code = getattr(method, "code", None)
        if not code:
            return None

        lines = code.split("\n")
        method_start_line = getattr(method, "line_number", 1) or 1
        target_start = getattr(target, "line_number", None)
        target_end = getattr(target, "line_number_end", target_start)

        # Apply smart truncation if needed
        if options.truncate_source and len(lines) > options.max_source_lines:
            lines, omitted_before, omitted_after = self._smart_truncate_lines(
                lines, method_start_line, target_start, options.max_source_lines
            )
        else:
            omitted_before = 0
            omitted_after = 0

        # Build output with line-number prefixes
        output_lines = []

        if omitted_before > 0:
            output_lines.append(f"... [{omitted_before} lines omitted] ...")

        for i, line in enumerate(lines):
            line_num = method_start_line + i

            # Highlight target lines
            if target_start and target_end and target_start <= line_num <= target_end:
                prefix = ">> "
            else:
                prefix = "   "

            output_lines.append(f"{line_num:>4} | {prefix}{line}")

        if omitted_after > 0:
            output_lines.append(f"... [{omitted_after} lines omitted] ...")

        return "\n".join(output_lines)

    def _smart_truncate_lines(
        self, lines: List[str], method_start: int, target_line: Optional[int], max_lines: int
    ) -> tuple:
        """
        Smart truncation: keep signature (~10 lines), window around target, omit middle.
        Returns (truncated_lines, omitted_before, omitted_after).
        """
        sig_lines = min(10, max_lines // 4)
        window_size = 50

        if target_line is None:
            # No target line, just truncate from end
            return lines[:max_lines], 0, len(lines) - max_lines

        target_idx = target_line - method_start
        if target_idx < 0:
            target_idx = 0

        # Keep signature
        header = lines[:sig_lines]

        # Window around target
        window_start = max(sig_lines, target_idx - window_size)
        window_end = min(len(lines), target_idx + window_size + 1)
        window = lines[window_start:window_end]

        omitted_before = window_start - sig_lines
        omitted_after = len(lines) - window_end

        return header + window, omitted_before, omitted_after

    def _get_target_line_range(self, node: CPGNode) -> Optional[List[int]]:
        """Return [line_start, line_end] if both present, else None."""
        start = getattr(node, "line_number", None)
        end = getattr(node, "line_number_end", None)
        if start is not None and end is not None:
            return [start, end]
        return None

    # =========================================================================
    # DDG (Data Dependency Graph)
    # =========================================================================

    def _build_ddg_backward(self, node: CPGNode, options: SliceOptions) -> List[DDGEntry]:
        """Build reaching definitions via backward DDG traversal."""
        return self._build_ddg_traversal(node, options, direction="backward")

    def _build_ddg_forward(self, node: CPGNode, options: SliceOptions) -> List[DDGEntry]:
        """Build forward usages via forward DDG traversal."""
        return self._build_ddg_traversal(node, options, direction="forward")

    def _build_ddg_traversal(
        self, node: CPGNode, options: SliceOptions, direction: str
    ) -> List[DDGEntry]:
        """
        Custom BFS for DDG traversal preserving edge variable property.

        CRITICAL: Must use CPGGraph.get_in_edges/get_out_edges to preserve
        edge properties. DSL repeat(DDG) loses variable property.
        """
        # Find enclosing method to load subgraph
        try:
            method = self.ast.get_enclosing_method(node)
            if method is None:
                return []
            method_id = method.id
        except Exception:
            return []

        # Load method subgraph with edges
        method_graph = self.store.load_method_to_memory(method_id)
        if method_graph is None:
            return []

        target_id = node.id
        results: List[DDGEntry] = []
        visited: Set[int] = {target_id}

        # BFS queue: (node_id, depth)
        queue = deque([(target_id, 0)])

        while queue:
            nid, depth = queue.popleft()

            if depth >= options.ddg_depth:
                # Check if chain continues → mark last entry as truncated
                has_more = self._check_ddg_has_more(method_graph, nid, direction)
                if results and results[-1].node_id == nid:
                    results[-1].truncated = has_more
                continue

            # Get DDG edges based on direction
            if direction == "backward":
                edges = method_graph.get_in_edges(nid, EdgeType.DDG)
            else:
                edges = method_graph.get_out_edges(nid, EdgeType.DDG)

            for edge in edges:
                # Get neighbor node ID
                neighbor_id = edge.src if direction == "backward" else edge.dst

                if neighbor_id in visited:
                    continue
                visited.add(neighbor_id)

                # Get neighbor node (may be in subgraph or need fallback lookup)
                neighbor = method_graph.nodes.get(neighbor_id)
                if neighbor is None:
                    neighbor = self.store.get_node(neighbor_id)
                if neighbor is None:
                    continue

                # Extract variable from edge properties
                variable = edge.properties.get("variable", "") if edge.properties else ""

                # Build DDGEntry
                entry = DDGEntry(
                    node_id=neighbor_id,
                    variable=variable,
                    code=getattr(neighbor, "code", "") or "",
                    line=getattr(neighbor, "line_number", None),
                    file_path=getattr(neighbor, "file_name", None),
                    depth=depth + 1,
                    control_context=self._extract_control_context(neighbor, method_graph),
                    truncated=False,
                )
                results.append(entry)
                queue.append((neighbor_id, depth + 1))

        return results

    def _check_ddg_has_more(self, graph: CPGGraph, nid: int, direction: str) -> bool:
        """Check if DDG chain continues beyond this node."""
        if direction == "backward":
            edges = graph.get_in_edges(nid, EdgeType.DDG)
        else:
            edges = graph.get_out_edges(nid, EdgeType.DDG)
        return len(edges) > 0

    def _extract_control_context(
        self, node: CPGNode, method_graph: CPGGraph
    ) -> List[str]:
        """
        Walk AST upward to find enclosing control structures.
        Returns list of condition expressions, outermost to innermost.
        """
        conditions: List[str] = []
        current_id = node.id
        max_depth = 20

        for _ in range(max_depth):
            # Get AST parent
            parent_edges = method_graph.get_in_edges(current_id, EdgeType.AST)
            if not parent_edges:
                break

            parent_id = parent_edges[0].src
            parent = method_graph.nodes.get(parent_id)

            if parent is None:
                # Fallback to store lookup
                parent = self.store.get_node(parent_id)
                if parent is None:
                    break

            # Check if parent is a control structure
            if isinstance(parent, ControlStructureNode):
                # Try to get condition via CONDITION edge
                cond_edges = method_graph.get_out_edges(parent_id, EdgeType.CONDITION)
                if cond_edges:
                    cond_node = method_graph.nodes.get(cond_edges[0].dst)
                    if cond_node:
                        cond_code = getattr(cond_node, "code", "")
                        cst = getattr(parent, "control_structure_type", "")
                        cst_str = cst.value if hasattr(cst, "value") else str(cst)
                        conditions.append(f"{cst_str.lower()} ({cond_code})")
                else:
                    # Fallback: use parent's code
                    conditions.append(getattr(parent, "code", "") or "")

            current_id = parent_id

        # Reverse to get outermost first
        conditions.reverse()
        return conditions

    # =========================================================================
    # Callees
    # =========================================================================

    def _build_callees(
        self, node: CPGNode, options: SliceOptions
    ) -> Optional[tuple]:
        """Build callee list with interestingness sorting."""
        # For non-method targets, find enclosing method first
        if isinstance(node, MethodNode):
            method = node
        else:
            try:
                method = self.ast.get_enclosing_method(node)
                if method is None:
                    return None
            except Exception:
                return None

        # Get callees via CallGraphNavigator
        try:
            callees_iter = self.call.get_callees(method)
            callees_list = list(callees_iter)
        except Exception:
            return None

        total_count = len(callees_list)

        # Build CalleeInfo objects
        callee_infos: List[CalleeInfo] = []
        for callee in callees_list:
            info = CalleeInfo(
                node_id=callee.id,
                name=getattr(callee, "name", "") or "",
                full_name=getattr(callee, "full_name", None),
                signature=getattr(callee, "signature", None),
                file_path=getattr(callee, "file_name", None),
                line=getattr(callee, "line_number", None),
                is_external=getattr(callee, "is_external", False) or getattr(callee, "is_stub", False),
                docstring=self._get_docstring(callee),
                summary=getattr(callee, "summary", None),
                tags=list(getattr(callee, "tags", []) or []),
            )
            callee_infos.append(info)

        # Sort by interestingness: tagged first, then internal, then external
        callee_infos.sort(key=self._callee_sort_key)

        # Truncate if needed
        truncated = len(callee_infos) > options.max_callees
        if truncated:
            callee_infos = callee_infos[: options.max_callees]

        return (callee_infos, truncated, total_count)

    def _callee_sort_key(self, callee: CalleeInfo) -> tuple:
        """Sort key for callee interestingness: tagged first, then internal, then external."""
        has_tags = len(callee.tags) > 0
        is_internal = not callee.is_external
        # False < True, so (not has_tags, not is_internal) puts tagged+internal first
        return (not has_tags, not is_internal)

    def _get_docstring(self, node: CPGNode) -> Optional[str]:
        """Extract docstring from method node."""
        try:
            return self.ast.get_docstring(node)
        except Exception:
            return None

    # =========================================================================
    # Tags
    # =========================================================================

    def _build_tags(self, node: CPGNode) -> tuple:
        """Return (tags, tags_provenance) tuple."""
        tags = list(getattr(node, "tags", []) or [])
        provenance = dict(getattr(node, "tags_provenance", {}) or {})
        return (tags, provenance)

    # =========================================================================
    # Globals
    # =========================================================================

    def _build_globals(self, node: CPGNode, options: SliceOptions) -> List[str]:
        """
        Detect referenced globals: module-level vars/constants accessed in function body.

        Best-effort heuristic: find enclosing method, look for IdentifierNodes
        that have REF edges pointing to declarations outside the method's AST subtree.
        """
        if isinstance(node, MethodNode):
            method = node
        else:
            try:
                method = self.ast.get_enclosing_method(node)
                if method is None:
                    return []
            except Exception:
                return []

        method_id = method.id

        method_graph = self.store.load_method_to_memory(method_id)
        if method_graph is None:
            return []

        globals_found: List[str] = []
        seen_ids: Set[int] = set()
        target_ids: List[int] = []

        for nid, n in method_graph.nodes.items():
            if not isinstance(n, IdentifierNode):
                continue

            ref_edges = method_graph.get_out_edges(nid, EdgeType.REF)
            for edge in ref_edges:
                target_id = edge.dst
                if target_id in seen_ids:
                    continue
                seen_ids.add(target_id)
                target_ids.append(target_id)

        if not target_ids:
            return []

        target_nodes = self.store.query.by_ids(target_ids).to_list()
        target_node_map = {n.id: n for n in target_nodes}

        for target_id in target_ids:
            target = target_node_map.get(target_id)
            if target is None:
                continue

            if self._is_global_declaration(target, method_id):
                code = getattr(target, "code", "") or getattr(target, "name", "")
                if code:
                    globals_found.append(code)

        return globals_found

    def _is_global_declaration(self, node: CPGNode, method_id: int) -> bool:
        """Check if a declaration node is at file/namespace scope (not in method)."""
        # Walk AST upward to see if we hit a METHOD node before FILE
        current_id = node.id
        max_depth = 20

        for _ in range(max_depth):
            parent_edges = self.store.query.by_id(current_id).in_(EdgeType.AST).to_list()
            if not parent_edges:
                break

            parent = parent_edges[0]
            if parent.id == method_id:
                return False  # Found method first → not global

            if isinstance(parent, (FileNode, NamespaceBlockNode)):
                return True  # Found file/namespace first → global

            current_id = parent.id

        return False
