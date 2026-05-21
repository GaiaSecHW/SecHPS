# tests/app/query/test_context.py
"""
Tests for Context Assembly feature (Phase 5).

Covers requirements:
- CTX-01: System can assemble code context around identified entry points
- CTX-02: Context includes function signature and surrounding code
- CTX-03: Context output is LLM-ready JSON (flat structure)
- CTX-04: Agent can request context depth (lines, call depth)
- CTX-05: Context integrates with entry point queries (DSL and CLI)
"""

import pytest
import json
from unittest.mock import MagicMock, patch
from dataclasses import asdict
from typing import List, Dict, Optional

import sys
import os
sys.path.append(os.getcwd())

from codedmap.app.query.context import (
    EntryPointContext,
    EntryPointContextResult,
    assemble_entry_point_context,
    _extract_signature,
    _parse_entry_point_tags,
    _create_fallback_context,
)
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import NodeLabel


# =========================================================================
# Mock Infrastructure
# =========================================================================

def make_method(
    id: int,
    name: str,
    full_name: str = None,
    file_name: str = "test.py",
    line_number: int = 10,
    tags: Optional[List[str]] = None
) -> MethodNode:
    """Create a MethodNode for testing."""
    node = MethodNode(
        id=id,
        name=name,
        fullName=full_name or f"pkg.{name}",
        fileName=file_name,
        lineNumber=line_number,
        label=NodeLabel.METHOD
    )
    node.tags = tags or []
    return node


def make_mock_store_for_context() -> MagicMock:
    """Build a mock CPGStore with entry point nodes and navigators."""
    store = MagicMock()

    # Create sample nodes
    http_handler = make_method(
        1001,
        "handle_http_request",
        "app.handlers.handle_http_request",
        "app/handlers.py",
        10,
        tags=["ONTOLOGY:ENTRY_POINT:HTTP"]
    )
    socket_recv = make_method(
        1002,
        "socket_recv",
        "network.socket_recv",
        "network/socket.c",
        42,
        tags=["ONTOLOGY:ENTRY_POINT:HTTP"]
    )
    main_func = make_method(
        1003,
        "main",
        "main",
        "main.c",
        1,
        tags=["ONTOLOGY:ENTRY_POINT:CLI"]
    )

    nodes = [http_handler, socket_recv, main_func]
    node_map = {n.id: n for n in nodes}

    # Mock store.get_node
    def get_node(node_id: int):
        return node_map.get(node_id)
    store.get_node.side_effect = get_node

    # Mock store.tags (TagRepository)
    tag_storage: Dict[int, List[str]] = {}
    for n in nodes:
        tag_storage[n.id] = list(getattr(n, "tags", []) or [])

    def tags_get_all(node_or_id):
        nid = getattr(node_or_id, "id", node_or_id)
        return list(tag_storage.get(nid, []))

    store.tags.get_all.side_effect = tags_get_all

    # Mock store.query (TraversalSource)
    mock_query = MagicMock()

    def mock_by_ids(ids):
        mock_traversal = MagicMock()
        matching_nodes = [node_map[i] for i in ids if i in node_map]
        mock_traversal.to_list.return_value = matching_nodes
        return mock_traversal

    mock_query.by_ids.side_effect = mock_by_ids
    mock_query.by_id.side_effect = lambda nid: mock_by_ids([nid])
    store.query = mock_query

    return store, nodes


def make_mock_navigators():
    """Create mock navigators for testing."""
    # Mock AstContextNavigator
    ast_nav = MagicMock()
    ast_nav.get_context_code.return_value = """def handle_http_request(request):
    \"\"\"Handle incoming HTTP request.\"\"\"
    data = request.json
    result = process_data(data)
    return jsonify(result)
"""

    # Mock CallGraphNavigator
    call_nav = MagicMock()
    caller_node = make_method(2001, "app_run", "app.app_run")
    call_nav.get_recursive_callers.return_value = [caller_node]

    # Mock ContextLoader
    context_loader = MagicMock()
    context_loader.get_context_data.return_value = {
        "architecture": {"module_path": "app.handlers"}
    }

    # Mock BackwardTracingNavigator
    trace_nav = MagicMock()
    mock_path = MagicMock()
    mock_path.found_controllable = True
    mock_path.hops = [MagicMock(), MagicMock(), MagicMock()]
    mock_path.termination_reason = "parameter"
    trace_result = MagicMock()
    trace_result.paths = [mock_path]
    trace_nav.trace_to_controllable.return_value = trace_result

    return ast_nav, call_nav, context_loader, trace_nav


# =========================================================================
# Test EntryPointContext (CTX-03: Flat JSON structure)
# =========================================================================

class TestEntryPointContext:
    """Tests for EntryPointContext dataclass."""

    def test_flat_structure(self):
        """CTX-03: EntryPointContext has flat structure (no nested objects)."""
        ctx = EntryPointContext(
            node_id=1001,
            name="handle_http_request",
            full_name="app.handlers.handle_http_request",
            file="app/handlers.py",
            line=10,
            level="L1",
            category="network",
            type="http",
            tags=["SECURITY:ENTRY_POINT:L1:NETWORK"],
            code="def handle_http_request...",
            signature="def handle_http_request(request)",
            callers=["app_run"],
            trace_found_controllable=True,
            trace_depth=2,
            trace_termination="parameter",
            module_path="app.handlers"
        )

        # Verify all fields are at top level (flat)
        data = ctx.to_dict()

        # All values should be primitives or lists of primitives
        assert isinstance(data["node_id"], int)
        assert isinstance(data["name"], str)
        assert isinstance(data["tags"], list)
        assert isinstance(data["callers"], list)
        assert all(isinstance(t, str) for t in data["tags"])
        assert all(isinstance(c, str) for c in data["callers"])

        # No nested objects
        for key, value in data.items():
            assert not isinstance(value, dict), f"{key} should not be a dict"

    def test_to_json(self):
        """EntryPointContext.to_json() produces valid JSON."""
        ctx = EntryPointContext(
            node_id=1001,
            name="handle_http_request",
            full_name="app.handlers.handle_http_request",
            file="app/handlers.py",
            line=10,
            level="L1",
            category="network",
            type="http",
            tags=["SECURITY:ENTRY_POINT:L1:NETWORK"],
            code="def handle_http_request...",
            signature="def handle_http_request(request)",
            callers=["app_run"],
            trace_found_controllable=True,
            trace_depth=2,
            trace_termination="parameter",
            module_path="app.handlers"
        )

        json_str = ctx.to_json()

        # Should be valid JSON
        data = json.loads(json_str)
        assert data["node_id"] == 1001
        assert data["name"] == "handle_http_request"

    def test_to_dict(self):
        """EntryPointContext.to_dict() returns dict with all fields."""
        ctx = EntryPointContext(
            node_id=1001,
            name="test",
            full_name="pkg.test",
            file="test.py",
            line=1,
            level="L1",
            category="network",
            type="http",
            tags=[],
            code="code",
            signature="sig",
            callers=[],
            trace_found_controllable=False,
            trace_depth=0,
            trace_termination=None,
            module_path=None
        )

        data = ctx.to_dict()

        # All 16 fields present
        assert len(data) == 16
        assert "node_id" in data
        assert "module_path" in data


# =========================================================================
# Test EntryPointContextResult (Metadata wrapper)
# =========================================================================

class TestEntryPointContextResult:
    """Tests for EntryPointContextResult wrapper class."""

    def test_wrapper_metadata(self):
        """EntryPointContextResult includes configuration metadata."""
        ctx1 = EntryPointContext(
            node_id=1, name="a", full_name="a", file="a.py", line=1,
            level="L1", category="network", type="http", tags=[],
            code="code", signature="sig", callers=[],
            trace_found_controllable=False, trace_depth=0,
            trace_termination=None, module_path=None
        )
        ctx2 = EntryPointContext(
            node_id=2, name="b", full_name="b", file="b.py", line=2,
            level="L2", category="cli", type="main", tags=[],
            code="code", signature="sig", callers=[],
            trace_found_controllable=False, trace_depth=0,
            trace_termination=None, module_path=None
        )

        result = EntryPointContextResult(
            results=[ctx1, ctx2],
            total=2,
            lines_used=25,
            call_depth_used=1,
            include_trace=True
        )

        assert result.total == 2
        assert result.lines_used == 25
        assert result.call_depth_used == 1
        assert result.include_trace is True

    def test_to_dict(self):
        """EntryPointContextResult.to_dict() includes nested results."""
        ctx = EntryPointContext(
            node_id=1, name="a", full_name="a", file="a.py", line=1,
            level="L1", category="network", type="http", tags=[],
            code="code", signature="sig", callers=[],
            trace_found_controllable=False, trace_depth=0,
            trace_termination=None, module_path=None
        )

        result = EntryPointContextResult(
            results=[ctx],
            total=1,
            lines_used=50,
            call_depth_used=2,
            include_trace=False
        )

        data = result.to_dict()

        assert "results" in data
        assert "total" in data
        assert "lines_used" in data
        assert "call_depth_used" in data
        assert "include_trace" in data
        assert len(data["results"]) == 1

    def test_to_json(self):
        """EntryPointContextResult.to_json() produces valid JSON."""
        ctx = EntryPointContext(
            node_id=1, name="a", full_name="a", file="a.py", line=1,
            level="L1", category="network", type="http", tags=[],
            code="code", signature="sig", callers=[],
            trace_found_controllable=False, trace_depth=0,
            trace_termination=None, module_path=None
        )

        result = EntryPointContextResult(
            results=[ctx],
            total=1,
            lines_used=25,
            call_depth_used=1,
            include_trace=True
        )

        json_str = result.to_json()
        data = json.loads(json_str)

        assert data["total"] == 1
        assert data["lines_used"] == 25


# =========================================================================
# Test _extract_signature helper (CTX-02)
# =========================================================================

class TestExtractSignature:
    """Tests for _extract_signature helper function."""

    def test_python_signature(self):
        """CTX-02: Extract Python function signature."""
        code = '''def handle_http_request(request, timeout=30):
    """Handle incoming HTTP request."""
    data = request.json
    return process(data)
'''
        sig = _extract_signature(code, "handle_http_request")

        assert sig is not None
        assert "def handle_http_request" in sig
        assert "request" in sig
        assert "timeout" in sig
        assert ":" not in sig  # Trailing colon removed

    def test_c_signature(self):
        """CTX-02: Extract C function signature."""
        code = '''int process_data(char *buffer, size_t len) {
    // Process incoming data
    return parse(buffer, len);
}
'''
        sig = _extract_signature(code, "process_data")

        assert sig is not None
        assert "int process_data" in sig
        assert "char *buffer" in sig
        assert "size_t len" in sig
        assert "{" not in sig  # Trailing brace removed

    def test_no_signature(self):
        """Returns None when no signature found."""
        code = "# Just a comment\nx = 1\n"
        sig = _extract_signature(code, "nonexistent")

        assert sig is None

    def test_signature_multiline_params(self):
        """Handles signatures spanning multiple lines."""
        code = '''def complex_function(
        param1,
        param2,
        param3=default
):
    pass
'''
        # Note: current implementation extracts first line only
        sig = _extract_signature(code, "complex_function")

        # Should find the function name
        assert sig is not None
        assert "complex_function" in sig

    def test_empty_code(self):
        """Returns None for empty code."""
        sig = _extract_signature("", "func")
        assert sig is None

    def test_empty_name(self):
        """Returns None for empty name."""
        sig = _extract_signature("def foo(): pass", "")
        assert sig is None


# =========================================================================
# Test _parse_entry_point_tags helper
# =========================================================================

class TestParseEntryPointTags:
    """Tests for _parse_entry_point_tags helper."""

    def test_parse_valid_tag(self):
        """Parse valid entry point tag."""
        tags = ["ONTOLOGY:ENTRY_POINT:HTTP"]
        level, category, ep_type = _parse_entry_point_tags(tags)

        assert level == "?"
        assert category == "http"
        assert ep_type == "http"

    def test_parse_multiple_tags(self):
        """Parse from multiple tags, find first entry point."""
        tags = ["INTERNAL", "ONTOLOGY:ENTRY_POINT:CLI"]
        level, category, ep_type = _parse_entry_point_tags(tags)

        assert level == "?"
        assert category == "cli"
        assert ep_type == "cli"

    def test_parse_empty_tags(self):
        """Returns defaults for empty tags."""
        level, category, ep_type = _parse_entry_point_tags([])

        assert level == "?"
        assert category == "?"
        assert ep_type == "?"

    def test_parse_no_entry_point_tag(self):
        """Returns defaults when no entry point tag found."""
        tags = ["INTERNAL", "TODO:review"]
        level, category, ep_type = _parse_entry_point_tags(tags)

        assert level == "?"
        assert category == "?"
        assert ep_type == "?"


# =========================================================================
# Test assemble_entry_point_context (CTX-01, CTX-04)
# =========================================================================

class TestAssembleEntryPointContext:
    """Tests for assemble_entry_point_context function."""

    def test_assemble_basic(self):
        """CTX-01: Assemble context around entry point."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        # Patch where the classes are imported FROM (the actual modules)
        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            result = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],  # http_handler
                lines=25,
                call_depth=1,
                include_trace=True
            )

        # Verify result structure
        assert isinstance(result, EntryPointContextResult)
        assert result.total == 1
        assert len(result.results) == 1

        # Verify context content
        ctx = result.results[0]
        assert ctx.node_id == 1001
        assert ctx.name == "handle_http_request"
        assert ctx.level == "?"
        assert ctx.category == "http"

    def test_configurable_lines(self):
        """CTX-04: Lines parameter controls code snippet size."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            # Request 50 lines
            result = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=50,
                call_depth=1,
                include_trace=True
            )

        # Verify lines_used reflects configuration
        assert result.lines_used == 50

        # Verify navigator was called with correct lines
        ast_nav.get_context_code.assert_called()
        call_args = ast_nav.get_context_code.call_args
        assert call_args[1].get("max_lines") == 50

    def test_configurable_call_depth(self):
        """CTX-04: call_depth parameter controls caller traversal."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            # Request depth of 3
            result = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=25,
                call_depth=3,
                include_trace=True
            )

        # Verify call_depth_used reflects configuration
        assert result.call_depth_used == 3

    def test_include_trace(self):
        """CTX-04: include_trace controls backward trace inclusion."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            # Include trace
            result_with_trace = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=25,
                call_depth=1,
                include_trace=True
            )

        assert result_with_trace.include_trace is True

        # Reset mocks
        ast_nav.reset_mock()
        call_nav.reset_mock()
        context_loader.reset_mock()
        trace_nav.reset_mock()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            # Exclude trace
            result_no_trace = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=25,
                call_depth=1,
                include_trace=False
            )

        assert result_no_trace.include_trace is False
        # Trace navigator should not be called when include_trace=False
        trace_nav.trace_to_controllable.assert_not_called()

    def test_multiple_nodes(self):
        """Assemble context for multiple nodes."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            result = assemble_entry_point_context(
                store=store,
                nodes=nodes,  # All 3 nodes
                lines=25,
                call_depth=1,
                include_trace=True
            )

        assert result.total == 3
        assert len(result.results) == 3

    def test_error_handling_fallback(self):
        """Gracefully handles errors and creates fallback context."""
        store, nodes = make_mock_store_for_context()

        # Make get_context_code raise an exception
        ast_nav = MagicMock()
        ast_nav.get_context_code.side_effect = Exception("Code not found")
        call_nav = MagicMock()
        call_nav.get_recursive_callers.return_value = []
        context_loader = MagicMock()
        context_loader.get_context_data.return_value = {}

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', side_effect=Exception("No trace")):

            result = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=25,
                call_depth=1,
                include_trace=True
            )

        # Should still return a result, with partial context
        assert result.total == 1
        # Code may be empty due to error
        ctx = result.results[0]
        assert ctx.node_id == 1001


# =========================================================================
# Test QueryStep.context() DSL method (CTX-05)
# =========================================================================

class TestQueryStepContext:
    """Tests for QueryStep.context() DSL method."""

    def test_context_method_exists(self):
        """CTX-05: QueryStep has context() method."""
        from codedmap.app.query.step import QueryStep

        # Verify method exists
        assert hasattr(QueryStep, 'context')
        assert callable(getattr(QueryStep, 'context'))

    def test_context_method_signature(self):
        """CTX-04: context() accepts lines, call_depth, include_trace params."""
        import inspect
        from codedmap.app.query.step import QueryStep

        sig = inspect.signature(QueryStep.context)
        params = sig.parameters

        # Check parameters exist with defaults
        assert 'lines' in params
        assert 'call_depth' in params
        assert 'include_trace' in params

        # Check defaults match CONTEXT.md decisions
        assert params['lines'].default == 25
        assert params['call_depth'].default == 1
        assert params['include_trace'].default is True

    def test_context_returns_result(self):
        """context() returns EntryPointContextResult."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        # Create mock QueryStep
        from codedmap.app.query.step import QueryStep

        mock_traversal = MagicMock()
        mock_traversal.to_list.return_value = [nodes[0]]

        step = QueryStep(mock_traversal, store)

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            result = step.context()

        assert isinstance(result, EntryPointContextResult)
        assert result.total == 1

    def test_context_with_custom_params(self):
        """context() passes custom parameters correctly."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        from codedmap.app.query.step import QueryStep

        mock_traversal = MagicMock()
        mock_traversal.to_list.return_value = [nodes[0]]

        step = QueryStep(mock_traversal, store)

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            result = step.context(
                lines=100,
                call_depth=5,
                include_trace=False
            )

        assert result.lines_used == 100
        assert result.call_depth_used == 5
        assert result.include_trace is False


# =========================================================================
# Test _create_fallback_context
# =========================================================================

class TestCreateFallbackContext:
    """Tests for _create_fallback_context helper."""

    def test_fallback_has_identity_fields(self):
        """Fallback context includes identity fields."""
        node = make_method(999, "broken_func", "pkg.broken_func", "broken.py", 50)

        ctx = _create_fallback_context(node, "Some error")

        assert ctx.node_id == 999
        assert ctx.name == "broken_func"
        assert ctx.full_name == "pkg.broken_func"
        assert ctx.file == "broken.py"
        assert ctx.line == 50

    def test_fallback_defaults(self):
        """Fallback context has sensible defaults."""
        node = make_method(999, "broken_func", "pkg.broken_func", "broken.py", 50)

        ctx = _create_fallback_context(node, "Some error")

        assert ctx.level == "?"
        assert ctx.category == "?"
        assert ctx.type == "?"
        assert ctx.tags == []
        assert ctx.signature is None
        assert ctx.callers == []
        assert ctx.trace_found_controllable is False
        assert ctx.trace_depth == 0
        assert ctx.trace_termination is None
        assert ctx.module_path is None

    def test_fallback_indicates_error(self):
        """Fallback context indicates error in code field."""
        node = make_method(999, "broken_func", "pkg.broken_func", "broken.py", 50)

        ctx = _create_fallback_context(node, "Database connection failed")

        assert "[Error:" in ctx.code
        assert "Database connection failed" in ctx.code


# =========================================================================
# Integration tests with real dataclasses
# =========================================================================

class TestContextIntegration:
    """Integration tests verifying full context assembly flow."""

    def test_full_context_assembly(self):
        """Full context assembly produces valid LLM-ready output."""
        store, nodes = make_mock_store_for_context()
        ast_nav, call_nav, context_loader, trace_nav = make_mock_navigators()

        with patch('codedmap.analysis.traversal.ast.AstContextNavigator', return_value=ast_nav), \
             patch('codedmap.analysis.traversal.call.CallGraphNavigator', return_value=call_nav), \
             patch('codedmap.analysis.traversal.context.ContextLoader', return_value=context_loader), \
             patch('codedmap.analysis.traversal.tracing.BackwardTracingNavigator', return_value=trace_nav):

            result = assemble_entry_point_context(
                store=store,
                nodes=[nodes[0]],
                lines=25,
                call_depth=1,
                include_trace=True
            )

        # Output should be valid JSON
        json_output = result.to_json()
        data = json.loads(json_output)

        # Verify structure for LLM consumption
        assert "results" in data
        assert len(data["results"]) == 1

        entry = data["results"][0]

        # All fields should be present and have expected types
        assert isinstance(entry["node_id"], int)
        assert isinstance(entry["name"], str)
        assert isinstance(entry["file"], str)
        assert isinstance(entry["line"], int)
        assert isinstance(entry["code"], str)
        assert isinstance(entry["callers"], list)
        assert isinstance(entry["tags"], list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
