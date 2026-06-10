"""Tests for CPG.trace_back() DSL method."""

import pytest
from unittest.mock import Mock, MagicMock, patch

from codedmap.app.query import CPG
from codedmap.core.schema.security import TraceResult, TracePath, TraceHop


class TestTraceBackDSL:
    """Tests for the trace_back() DSL method."""

    def test_trace_back_returns_trace_result(self):
        """trace_back() should return a TraceResult."""
        mock_store = Mock()
        mock_node = Mock(id=123)

        # Create expected result
        expected_result = TraceResult(
            sink_node_id=123,
            paths=[],
            max_depth_used=10,
            total_paths=0,
        )

        # Patch the navigator's trace_to_controllable method
        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ):
            cpg = CPG(mock_store)
            result = cpg.trace_back(mock_node)

            assert isinstance(result, TraceResult)
            assert result.sink_node_id == 123

    def test_trace_back_passes_max_depth(self):
        """trace_back() should pass max_depth to navigator."""
        mock_store = Mock()
        mock_node = Mock(id=123)

        expected_result = TraceResult(
            sink_node_id=123,
            paths=[],
            max_depth_used=5,
            total_paths=0,
        )

        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ) as mock_trace:
            cpg = CPG(mock_store)
            cpg.trace_back(mock_node, max_depth=5)

            mock_trace.assert_called_once()
            call_kwargs = mock_trace.call_args
            assert call_kwargs[1]['max_depth'] == 5

    def test_trace_back_passes_max_paths(self):
        """trace_back() should pass max_paths to navigator."""
        mock_store = Mock()
        mock_node = Mock(id=123)

        expected_result = TraceResult(
            sink_node_id=123,
            paths=[],
            max_depth_used=10,
            total_paths=0,
        )

        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ) as mock_trace:
            cpg = CPG(mock_store)
            cpg.trace_back(mock_node, max_paths=5)

            mock_trace.assert_called_once()
            call_kwargs = mock_trace.call_args
            assert call_kwargs[1]['max_paths'] == 5

    def test_trace_back_accepts_node_id(self):
        """trace_back() should accept an integer node ID."""
        mock_store = Mock()

        expected_result = TraceResult(
            sink_node_id=123,
            paths=[],
            max_depth_used=10,
            total_paths=0,
        )

        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ) as mock_trace:
            cpg = CPG(mock_store)
            result = cpg.trace_back(123)

            mock_trace.assert_called_once()
            assert result.sink_node_id == 123

    def test_trace_back_default_parameters(self):
        """trace_back() should use default parameters max_depth=10 and max_paths=10."""
        mock_store = Mock()
        mock_node = Mock(id=456)

        expected_result = TraceResult(
            sink_node_id=456,
            paths=[],
            max_depth_used=10,
            total_paths=0,
        )

        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ) as mock_trace:
            cpg = CPG(mock_store)
            cpg.trace_back(mock_node)

            mock_trace.assert_called_once()
            call_kwargs = mock_trace.call_args
            assert call_kwargs[1]['max_depth'] == 10
            assert call_kwargs[1]['max_paths'] == 10

    def test_trace_back_with_controllable_input(self):
        """trace_back() should return paths with found_controllable=True when input found."""
        mock_store = Mock()
        mock_node = Mock(id=789)

        # Create a path with controllable input
        hop = TraceHop(
            node_id=789,
            file="test.c",
            line=10,
            code="memcpy(dst, src, n)",
            hop_type="sink"
        )
        source_hop = TraceHop(
            node_id=790,
            file="test.c",
            line=5,
            code="char *src = recv(sock, buf, len)",
            hop_type="entry_point"
        )
        path = TracePath(
            hops=[hop, source_hop],
            found_controllable=True,
            termination_reason="entry_point",
        )

        expected_result = TraceResult(
            sink_node_id=789,
            paths=[path],
            max_depth_used=10,
            total_paths=1,
        )

        with patch(
            'codedmap.analysis.traversal.tracing.BackwardTracingNavigator.trace_to_controllable',
            return_value=expected_result
        ):
            cpg = CPG(mock_store)
            result = cpg.trace_back(mock_node)

            assert result.found_controllable is True
            assert result.total_paths == 1
            assert len(result.paths) == 1
            assert result.paths[0].depth == 2
