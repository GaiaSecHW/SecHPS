# tests/app/tracing/test_navigator.py
"""
Tests for BackwardTracingNavigator: BFS backward traversal, termination conditions, result building.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from unittest.mock import Mock, MagicMock
from typing import List, Iterator

from codedmap.analysis.traversal.tracing import BackwardTracingNavigator
from codedmap.core.schema.security import (
    SinkCatalog,
    SinkCategory,
    TraceHop,
    TracePath,
    TraceResult,
)
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.analysis.traversal.base import TraversalDirection


class MockNode:
    """Mock CPGNode for testing."""
    def __init__(self, node_id: int, name: str = "", code: str = "",
                 file_name: str = "", line_number: int = 0, label: str = ""):
        self.id = node_id
        self.name = name
        self.code = code
        self.file_name = file_name
        self.fileName = file_name  # camelCase alias
        self.line_number = line_number
        self.lineNumber = line_number  # camelCase alias
        self.label = label


class MockTagRepository:
    """Mock TagRepository for testing."""
    def __init__(self, tags_by_node: dict = None):
        self._tags_by_node = tags_by_node or {}

    def get_all(self, node_or_id) -> List[str]:
        node_id = node_or_id.id if hasattr(node_or_id, 'id') else node_or_id
        return self._tags_by_node.get(node_id, [])


class MockStore:
    """Mock CPGStore for testing."""
    def __init__(self, nodes: dict = None, neighbors: dict = None, tags_by_node: dict = None):
        self._nodes = nodes or {}
        self._neighbors = neighbors or {}  # {(node_id, edge_type, direction): [nodes]}
        self.tags = MockTagRepository(tags_by_node)
        self._query = MockQuery(self)

    def get_node(self, node_id: int):
        return self._nodes.get(node_id)

    @property
    def query(self):
        return self._query


class MockQuery:
    """Mock query interface."""
    def __init__(self, store: MockStore):
        self._store = store

    def by_id(self, node_id: int):
        return MockTraversal(self._store, [node_id])

    def by_ids(self, node_ids: List[int]):
        return MockTraversal(self._store, node_ids)


class MockTraversal:
    """Mock traversal interface."""
    def __init__(self, store: MockStore, node_ids: List[int]):
        self._store = store
        self._node_ids = node_ids

    def in_(self, edge_type, target_class=None):
        """Get incoming neighbors."""
        results = []
        for nid in self._node_ids:
            key = (nid, str(edge_type.value) if hasattr(edge_type, 'value') else str(edge_type), "IN")
            results.extend(self._store._neighbors.get(key, []))
        return iter(results)

    def out(self, edge_type, target_class=None):
        """Get outgoing neighbors."""
        results = []
        for nid in self._node_ids:
            key = (nid, str(edge_type.value) if hasattr(edge_type, 'value') else str(edge_type), "OUT")
            results.extend(self._store._neighbors.get(key, []))
        return iter(results)

    def first(self):
        """Get first result."""
        for nid in self._node_ids:
            node = self._store._nodes.get(nid)
            if node:
                return node
        return None

    def to_list(self):
        """Convert to list."""
        return [self._store._nodes.get(nid) for nid in self._node_ids if self._store._nodes.get(nid)]

    def __iter__(self):
        return iter(self.to_list())


# =============================================================================
# Test: Navigator Initialization
# =============================================================================

class TestBackwardTracingNavigatorInit:
    """Tests for BackwardTracingNavigator initialization."""

    def test_init_with_default_catalog(self):
        """Test initialization with default sink catalog."""
        store = MockStore()
        navigator = BackwardTracingNavigator(store)
        assert navigator.store == store
        assert navigator.sink_catalog is not None
        assert isinstance(navigator.sink_catalog, SinkCatalog)

    def test_init_with_custom_catalog(self):
        """Test initialization with custom sink catalog."""
        store = MockStore()
        custom_catalog = SinkCatalog()
        custom_catalog.add_sink(
            SinkCatalog.load_default().sinks[0]
        )
        navigator = BackwardTracingNavigator(store, sink_catalog=custom_catalog)
        assert navigator.sink_catalog == custom_catalog


# =============================================================================
# Test: trace_to_controllable Basic Functionality
# =============================================================================

class TestTraceToControllable:
    """Tests for trace_to_controllable method."""

    def test_trace_from_sink_returns_result(self):
        """Test that tracing from a sink returns a TraceResult."""
        # Setup: single node, no DDG edges
        sink_node = MockNode(1, "system", "system(cmd)", "test.c", 10, "CALL")
        store = MockStore(nodes={1: sink_node})
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(sink_node, max_depth=5)

        assert isinstance(result, TraceResult)
        assert result.sink_node_id == 1
        assert result.max_depth_used == 5

    def test_trace_respects_max_depth(self):
        """Test that tracing respects max_depth parameter."""
        # Setup: chain of 5 nodes
        nodes = {
            1: MockNode(1, "sink", "sink()", "test.c", 10),
            2: MockNode(2, "a", "a()", "test.c", 9),
            3: MockNode(3, "b", "b()", "test.c", 8),
            4: MockNode(4, "c", "c()", "test.c", 7),
            5: MockNode(5, "d", "d()", "test.c", 6),
        }
        # DDG edges: 5 -> 4 -> 3 -> 2 -> 1
        neighbors = {
            (1, "DDG", "IN"): [nodes[2]],
            (2, "DDG", "IN"): [nodes[3]],
            (3, "DDG", "IN"): [nodes[4]],
            (4, "DDG", "IN"): [nodes[5]],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=2, max_paths=10)

        # With max_depth=2, we should reach node 3 but not beyond
        assert result.max_depth_used == 2
        # All paths should have termination_reason="max_depth" since nothing is controllable
        for path in result.paths:
            assert path.termination_reason == "max_depth"

    def test_trace_respects_max_paths(self):
        """Test that tracing respects max_paths parameter."""
        # Setup: 1 sink with 5 DDG predecessors
        sink_node = MockNode(1, "sink", "sink()", "test.c", 10)
        predecessors = [
            MockNode(i, f"p{i}", f"p{i}()", "test.c", 10 - i)
            for i in range(2, 7)
        ]
        nodes = {1: sink_node}
        nodes.update({n.id: n for n in predecessors})

        neighbors = {
            (1, "DDG", "IN"): predecessors,
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=1, max_paths=3)

        # Should return at most 3 paths
        assert len(result.paths) <= 3

    def test_trace_handles_cycle(self):
        """Test that tracing handles cyclic DDG without infinite loop."""
        # Setup: A -> B -> C -> A (cycle), plus D which is a dead end
        # This tests that the algorithm doesn't hang on cycles
        nodes = {
            1: MockNode(1, "a", "a()", "test.c", 10),
            2: MockNode(2, "b", "b()", "test.c", 11),
            3: MockNode(3, "c", "c()", "test.c", 12),
        }
        # Cyclic: a <- b <- c <- a
        neighbors = {
            (1, "DDG", "IN"): [nodes[2]],
            (2, "DDG", "IN"): [nodes[3]],
            (3, "DDG", "IN"): [nodes[1]],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        # Should complete without hanging - the algorithm handles cycles
        # by tracking visited nodes, so it won't infinite loop
        result = navigator.trace_to_controllable(1, max_depth=10)

        assert isinstance(result, TraceResult)
        # When all nodes are in a cycle with no controllable input,
        # no paths are recorded (all predecessors already visited)
        # This is correct behavior - we only record paths when we
        # find controllable input OR hit max_depth with new nodes
        assert result.sink_node_id == 1


# =============================================================================
# Test: Termination Conditions
# =============================================================================

class TestTerminationConditions:
    """Tests for termination condition detection."""

    def test_terminate_at_entry_point_tag(self):
        """Test termination when node has entry point tag."""
        # Setup: sink <- node with entry_point tag
        sink_node = MockNode(1, "sink", "sink()", "test.c", 10)
        entry_node = MockNode(2, "main", "main(argc, argv)", "test.c", 5)
        nodes = {1: sink_node, 2: entry_node}
        neighbors = {
            (1, "DDG", "IN"): [entry_node],
        }
        tags_by_node = {
            2: ["ONTOLOGY:ENTRY_POINT:CLI"],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors, tags_by_node=tags_by_node)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5)

        assert result.total_paths >= 1
        assert result.found_controllable is True
        # Check that path terminates at entry_point
        found_entry_point = False
        for path in result.paths:
            if path.termination_reason == "entry_point":
                found_entry_point = True
                assert path.found_controllable is True
        assert found_entry_point, "Should have found at least one entry_point termination"

    def test_terminate_at_known_source(self):
        """Test termination when node is a known source function."""
        # Setup: sink <- recv (known source)
        sink_node = MockNode(1, "sink", "sink()", "test.c", 10)
        source_node = MockNode(2, "recv", "recv(sock, buf, len, 0)", "test.c", 5)
        nodes = {1: sink_node, 2: source_node}
        neighbors = {
            (1, "DDG", "IN"): [source_node],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5)

        assert result.found_controllable is True
        # Check that path terminates at source
        found_source = False
        for path in result.paths:
            if path.termination_reason == "source":
                found_source = True
                assert path.found_controllable is True
        assert found_source, "Should have found at least one source termination"

    def test_terminate_at_max_depth(self):
        """Test termination when max_depth is reached."""
        # Setup: chain with no controllable inputs
        nodes = {
            1: MockNode(1, "sink", "sink()", "test.c", 10),
            2: MockNode(2, "a", "a()", "test.c", 9),
            3: MockNode(3, "b", "b()", "test.c", 8),
        }
        neighbors = {
            (1, "DDG", "IN"): [nodes[2]],
            (2, "DDG", "IN"): [nodes[3]],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=1)

        # Should have partial path terminated at max_depth
        assert result.found_controllable is False
        for path in result.paths:
            assert path.termination_reason == "max_depth"
            assert path.found_controllable is False


# =============================================================================
# Test: TraceResult Properties
# =============================================================================

class TestTraceResult:
    """Tests for TraceResult properties."""

    def test_result_has_correct_sink_node_id(self):
        """Test that result contains correct sink node ID."""
        sink_node = MockNode(42, "sink", "sink()", "test.c", 10)
        store = MockStore(nodes={42: sink_node})
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(42, max_depth=5)

        assert result.sink_node_id == 42

    def test_result_paths_are_built_correctly(self):
        """Test that result paths are built with correct hops."""
        sink_node = MockNode(1, "sink", "system(cmd)", "test.c", 10)
        entry_node = MockNode(2, "getenv", "getenv(\"PATH\")", "test.c", 5)
        nodes = {1: sink_node, 2: entry_node}
        neighbors = {
            (1, "DDG", "IN"): [entry_node],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5)

        assert result.total_paths >= 1
        for path in result.paths:
            assert len(path.hops) >= 1
            # First hop should be the sink
            assert path.hops[0].node_id == 1
            assert path.hops[0].hop_type == "sink"

    def test_found_controllable_property(self):
        """Test that found_controllable aggregates from paths."""
        # Case 1: No paths found controllable
        result1 = TraceResult(
            sink_node_id=1,
            paths=[TracePath([], False, "max_depth")],
            max_depth_used=5,
            total_paths=1
        )
        assert result1.found_controllable is False

        # Case 2: At least one path found controllable
        result2 = TraceResult(
            sink_node_id=1,
            paths=[
                TracePath([], False, "max_depth"),
                TracePath([], True, "source"),
            ],
            max_depth_used=5,
            total_paths=2
        )
        assert result2.found_controllable is True


# =============================================================================
# Test: TraceHop Properties
# =============================================================================

class TestTraceHop:
    """Tests for TraceHop building."""

    def test_hop_code_truncated_to_80_chars(self):
        """Test that code snippets are truncated to 80 characters."""
        # Create a very long code snippet
        long_code = "x = " + "very_long_function_name_" * 10 + "(arg1, arg2, arg3);"
        assert len(long_code) > 80

        sink_node = MockNode(1, "sink", long_code, "test.c", 10)
        store = MockStore(nodes={1: sink_node})
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=0)

        # Even with max_depth=0, we should get a partial path with the sink
        if result.paths:
            hop = result.paths[0].hops[0]
            assert len(hop.code) <= 80

    def test_hop_has_correct_file_and_line(self):
        """Test that hop has correct file and line information."""
        sink_node = MockNode(1, "sink", "sink()", "src/main.c", 42, "CALL")
        store = MockStore(nodes={1: sink_node})
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=0)

        if result.paths:
            hop = result.paths[0].hops[0]
            assert hop.file == "src/main.c"
            assert hop.line == 42


# =============================================================================
# Test: Helper Methods
# =============================================================================

class TestHelperMethods:
    """Tests for internal helper methods."""

    def test_get_node_code_from_code_attribute(self):
        """Test _get_node_code extracts from code attribute."""
        node = MockNode(1, "test", "x = y + 1", "test.c", 10)
        store = MockStore(nodes={1: node})
        navigator = BackwardTracingNavigator(store)

        code = navigator._get_node_code(node)
        assert code == "x = y + 1"

    def test_get_node_file_from_file_name_attribute(self):
        """Test _get_node_file extracts from file_name attribute."""
        node = MockNode(1, "test", "code", "src/test.c", 10)
        store = MockStore(nodes={1: node})
        navigator = BackwardTracingNavigator(store)

        file_name = navigator._get_node_file(node)
        assert file_name == "src/test.c"

    def test_get_node_line_from_line_number_attribute(self):
        """Test _get_node_line extracts from line_number attribute."""
        node = MockNode(1, "test", "code", "test.c", 123)
        store = MockStore(nodes={1: node})
        navigator = BackwardTracingNavigator(store)

        line = navigator._get_node_line(node)
        assert line == 123

    def test_is_parameter_node_returns_false_conservatively(self):
        """Test _is_parameter_node returns False for non-PARAM nodes."""
        node = MockNode(1, "test", "x", "test.c", 10, label="IDENTIFIER")
        store = MockStore(nodes={1: node})
        navigator = BackwardTracingNavigator(store)

        # Should return False conservatively for non-PARAM labels
        assert navigator._is_parameter_node(node) is False


# =============================================================================
# Test: Integration Scenarios
# =============================================================================

class TestIntegrationScenarios:
    """Integration-style tests for realistic scenarios."""

    def test_multi_hop_trace_to_entry_point(self):
        """Test tracing multiple hops to an entry point."""
        # Setup: system(cmd) <- cmd = getenv("PATH") <- main parameter
        sink = MockNode(1, "system", "system(cmd)", "main.c", 20)
        getenv_call = MockNode(2, "getenv", "getenv(\"CMD\")", "main.c", 15)
        entry = MockNode(3, "main", "main(int argc, char **argv)", "main.c", 5)

        nodes = {1: sink, 2: getenv_call, 3: entry}
        neighbors = {
            (1, "DDG", "IN"): [getenv_call],
            (2, "DDG", "IN"): [entry],
        }
        tags_by_node = {
            3: ["ONTOLOGY:ENTRY_POINT:CLI"],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors, tags_by_node=tags_by_node)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5)

        # Should find path to entry point
        assert result.found_controllable is True
        # Should have 2 paths: one to getenv (source), one to main (entry_point)
        assert result.total_paths >= 1

    def test_branching_ddg_multiple_paths(self):
        """Test handling of branching DDG with multiple paths."""
        # Setup: sink <- a <- c
        #              <- b <- c
        sink = MockNode(1, "sink", "sink(x, y)", "test.c", 10)
        a = MockNode(2, "a", "a()", "test.c", 8)
        b = MockNode(3, "b", "b()", "test.c", 9)
        c = MockNode(4, "getenv", "getenv(\"VAR\")", "test.c", 5)

        nodes = {1: sink, 2: a, 3: b, 4: c}
        neighbors = {
            (1, "DDG", "IN"): [a, b],
            (2, "DDG", "IN"): [c],
            (3, "DDG", "IN"): [c],
        }
        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5, max_paths=10)

        # Both paths should eventually reach the source
        assert result.found_controllable is True



# =============================================================================
# Test: Interprocedural Tracing (GAP-2 fix)
# =============================================================================

class TestInterproceduralTracing:
    """Tests for interprocedural DDG crossing at procedure boundaries."""

    def test_trace_crosses_method_parameter_in(self):
        """Test that tracing crosses METHOD_PARAMETER_IN to caller's argument."""
        sink_call = MockNode(1, "strcpy", "strcpy(buf, param)", "b.c", 10, "CALL")
        param_node = MockNode(2, "param", "param", "b.c", 5, "METHOD_PARAMETER_IN")
        param_node.order = 1
        param_node.argument_index = 1

        method_b = MockNode(3, "process", "void process(char* param)", "b.c", 4, "METHOD")
        call_site = MockNode(4, "process_call", "process(getenv(\"X\"))", "a.c", 20, "CALL")
        arg_node = MockNode(5, "getenv", "getenv(\"X\")", "a.c", 20, "CALL")
        arg_node.argument_index = 1

        nodes = {1: sink_call, 2: param_node, 3: method_b, 4: call_site, 5: arg_node}

        neighbors = {
            (1, "DDG", "IN"): [param_node],
            (2, "AST", "IN"): [method_b],
            (3, "CALL", "IN"): [call_site],
            (4, "AST", "OUT"): [arg_node],
        }

        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=10)

        all_node_ids = set()
        for path in result.paths:
            for hop in path.hops:
                all_node_ids.add(hop.node_id)
        assert 5 in all_node_ids, "Should have crossed to caller's argument node"

    def test_trace_crosses_method_to_call_sites(self):
        """Test that tracing crosses METHOD node to its call sites."""
        sink_call = MockNode(1, "sink", "sink(x)", "b.c", 10, "CALL")
        some_id = MockNode(2, "x", "x", "b.c", 8, "IDENTIFIER")
        method_node = MockNode(3, "helper", "void helper()", "b.c", 1, "METHOD")
        call_site = MockNode(4, "helper_call", "helper()", "a.c", 20, "CALL")
        caller_method = MockNode(5, "getenv", "getenv(\"VAR\")", "a.c", 15, "CALL")

        nodes = {1: sink_call, 2: some_id, 3: method_node, 4: call_site, 5: caller_method}

        neighbors = {
            (1, "DDG", "IN"): [some_id],
            (2, "DDG", "IN"): [method_node],
            (3, "CALL", "IN"): [call_site],
            (4, "DDG", "IN"): [caller_method],
        }

        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=10)

        all_node_ids = set()
        for path in result.paths:
            for hop in path.hops:
                all_node_ids.add(hop.node_id)
        assert 4 in all_node_ids, "Should have crossed to call site"

    def test_interprocedural_finds_entry_point(self):
        """Test full interprocedural trace from sink to entry point."""
        sink_call = MockNode(1, "system", "system(cmd)", "handler.c", 50, "CALL")
        param = MockNode(2, "cmd", "cmd", "handler.c", 40, "METHOD_PARAMETER_IN")
        param.order = 0
        param.argument_index = 0

        handler_method = MockNode(3, "handle_request", "void handle_request(char* cmd)", "handler.c", 38, "METHOD")
        main_call = MockNode(4, "handle_call", "handle_request(argv[1])", "main.c", 10, "CALL")
        main_arg = MockNode(5, "argv_access", "argv[1]", "main.c", 10, "IDENTIFIER")
        main_arg.argument_index = 0

        nodes = {1: sink_call, 2: param, 3: handler_method, 4: main_call, 5: main_arg}

        neighbors = {
            (1, "DDG", "IN"): [param],
            (2, "AST", "IN"): [handler_method],
            (3, "CALL", "IN"): [main_call],
            (4, "AST", "OUT"): [main_arg],
        }

        tags_by_node = {
            5: ["ONTOLOGY:ENTRY_POINT:CLI"],
        }

        store = MockStore(nodes=nodes, neighbors=neighbors, tags_by_node=tags_by_node)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=10)

        assert result.found_controllable is True
        found_entry = False
        for path in result.paths:
            if path.termination_reason == "entry_point":
                found_entry = True
                assert path.found_controllable is True
        assert found_entry, "Should find entry point through interprocedural trace"

    def test_no_interprocedural_for_non_boundary_nodes(self):
        """Test that interprocedural logic is NOT applied to regular nodes."""
        sink = MockNode(1, "sink", "sink(x)", "test.c", 10, "CALL")
        ident = MockNode(2, "x", "x", "test.c", 8, "IDENTIFIER")

        nodes = {1: sink, 2: ident}
        neighbors = {
            (1, "DDG", "IN"): [ident],
        }

        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=5)

        for path in result.paths:
            for hop in path.hops:
                assert hop.hop_type != "interprocedural"

    def test_param_order_matching(self):
        """Test that interprocedural matching respects parameter order."""
        sink = MockNode(1, "sink", "sink(p)", "b.c", 10, "CALL")
        param = MockNode(2, "p", "p", "b.c", 5, "METHOD_PARAMETER_IN")
        param.order = 1

        method_b = MockNode(3, "func", "void func(int a, int b)", "b.c", 4, "METHOD")
        call_site = MockNode(4, "func_call", "func(safe, dangerous)", "a.c", 20, "CALL")

        arg0 = MockNode(5, "safe", "safe", "a.c", 20, "IDENTIFIER")
        arg0.argument_index = 0
        arg1 = MockNode(6, "getenv", "getenv(\"VAR\")", "a.c", 20, "CALL")
        arg1.argument_index = 1

        nodes = {1: sink, 2: param, 3: method_b, 4: call_site, 5: arg0, 6: arg1}

        neighbors = {
            (1, "DDG", "IN"): [param],
            (2, "AST", "IN"): [method_b],
            (3, "CALL", "IN"): [call_site],
            (4, "AST", "OUT"): [arg0, arg1],
        }

        store = MockStore(nodes=nodes, neighbors=neighbors)
        navigator = BackwardTracingNavigator(store)

        result = navigator.trace_to_controllable(1, max_depth=10)

        all_node_ids = set()
        for path in result.paths:
            for hop in path.hops:
                all_node_ids.add(hop.node_id)
        assert 6 in all_node_ids, "Should match arg at same order as param"
        assert 5 not in all_node_ids, "Should NOT match arg at different order"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
