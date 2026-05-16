# tests/cli/test_witness_paths.py
"""
Phase 22 — AGT-03: Structured witness path tests.

Tests for structured JSON output in callers, dataflow, and reachability.
"""

import unittest
from unittest.mock import MagicMock, patch, PropertyMock
from collections import deque

from codedmap.analysis.traversal.call import CallGraphNavigator
from codedmap.analysis.traversal.dataflow import DataFlowNavigator
from codedmap.analysis.traversal.cfg import ControlFlowNavigator
from codedmap.cli._output import WitnessHop, _node_to_witness_hop


def _make_mock_node(node_id, name="test", file_name="test.c", line_number=1, label="METHOD"):
    """Create a mock CPGNode."""
    node = MagicMock()
    node.id = node_id
    node.name = name
    node.file_name = file_name
    node.fileName = file_name
    node.line_number = line_number
    node.lineNumber = line_number
    node.label = MagicMock(value=label)
    node.code = f"void {name}() {{}}"
    return node


class TestCallersWithDepth(unittest.TestCase):
    """Test CallGraphNavigator.get_recursive_callers_with_depth()."""

    def test_yields_depth_info(self):
        """get_recursive_callers_with_depth yields (node, depth) tuples."""
        store = MagicMock()
        nav = CallGraphNavigator(store)

        caller1 = _make_mock_node(10, "caller1")
        caller2 = _make_mock_node(20, "caller2")

        # Mock: target(id=1) has caller1, caller1 has caller2
        def mock_callers(node_id):
            query = MagicMock()
            if node_id == 1:
                query.callers.return_value = iter([caller1])
            elif node_id == 10:
                query.callers.return_value = iter([caller2])
            else:
                query.callers.return_value = iter([])
            return query

        store.query.by_id = lambda nid: mock_callers(nid)

        results = list(nav.get_recursive_callers_with_depth(1, max_depth=5))

        self.assertEqual(len(results), 2)
        # caller1 is depth 1 (direct caller of target)
        self.assertEqual(results[0], (caller1, 1))
        # caller2 is depth 2 (caller of caller1)
        self.assertEqual(results[1], (caller2, 2))

    def test_respects_max_depth(self):
        """get_recursive_callers_with_depth stops at max_depth."""
        store = MagicMock()
        nav = CallGraphNavigator(store)

        caller1 = _make_mock_node(10, "caller1")
        caller2 = _make_mock_node(20, "caller2")

        def mock_callers(node_id):
            query = MagicMock()
            if node_id == 1:
                query.callers.return_value = iter([caller1])
            elif node_id == 10:
                query.callers.return_value = iter([caller2])
            else:
                query.callers.return_value = iter([])
            return query

        store.query.by_id = lambda nid: mock_callers(nid)

        # max_depth=1 should only find direct callers
        results = list(nav.get_recursive_callers_with_depth(1, max_depth=1))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0], (caller1, 1))

    def test_handles_cycles(self):
        """get_recursive_callers_with_depth handles recursive/cyclic calls."""
        store = MagicMock()
        nav = CallGraphNavigator(store)

        caller1 = _make_mock_node(10, "caller1")

        # caller1 calls itself (cycle)
        def mock_callers(node_id):
            query = MagicMock()
            if node_id == 1:
                query.callers.return_value = iter([caller1])
            elif node_id == 10:
                node_self = _make_mock_node(10, "caller1")  # same ID
                query.callers.return_value = iter([node_self])
            else:
                query.callers.return_value = iter([])
            return query

        store.query.by_id = lambda nid: mock_callers(nid)

        results = list(nav.get_recursive_callers_with_depth(1, max_depth=5))
        # Should only yield caller1 once (visited set prevents cycles)
        self.assertEqual(len(results), 1)


class TestDataflowStructured(unittest.TestCase):
    """Test DataFlowNavigator.get_data_slice_structured()."""

    def test_returns_structured_entries(self):
        """get_data_slice_structured returns list of dicts with expected fields."""
        store = MagicMock()
        nav = DataFlowNavigator(store)

        node1 = _make_mock_node(1, "target", "main.c", 10, "CALL")
        node2 = _make_mock_node(2, "def_node", "main.c", 5, "IDENTIFIER")

        # Mock repeat() to return node2
        repeat_result = MagicMock()
        repeat_result.__iter__ = MagicMock(return_value=iter([node2]))
        by_id_result = MagicMock()
        by_id_result.repeat.return_value = repeat_result
        by_id_result.first.return_value = node1
        store.query.by_id.return_value = by_id_result

        entries = nav.get_data_slice_structured(node1, direction="IN", max_depth=3)

        # Should have at least the start node
        self.assertIsInstance(entries, list)
        for entry in entries:
            self.assertIn("node_id", entry)
            self.assertIn("line", entry)
            self.assertIn("code", entry)
            self.assertIn("is_origin", entry)
            self.assertIn("label", entry)

    def test_marks_origin_node(self):
        """The origin node has is_origin=True."""
        store = MagicMock()
        nav = DataFlowNavigator(store)

        node1 = _make_mock_node(1, "target", "main.c", 10)

        # Mock: no DDG edges, just the start node
        repeat_result = MagicMock()
        repeat_result.__iter__ = MagicMock(return_value=iter([]))
        by_id_result = MagicMock()
        by_id_result.repeat.return_value = repeat_result
        by_id_result.first.return_value = node1
        store.query.by_id.return_value = by_id_result

        entries = nav.get_data_slice_structured(node1, direction="IN", max_depth=3)

        origins = [e for e in entries if e["is_origin"]]
        self.assertEqual(len(origins), 1)
        self.assertEqual(origins[0]["node_id"], 1)


class TestCFGFindPath(unittest.TestCase):
    """Test ControlFlowNavigator.find_path()."""

    def test_finds_direct_path(self):
        """find_path returns path for directly connected nodes."""
        store = MagicMock()
        nav = ControlFlowNavigator(store)

        start = _make_mock_node(1, "start")
        end = _make_mock_node(2, "end")

        # Mock: start → end
        def mock_by_id(nid):
            q = MagicMock()
            q.first.return_value = start if nid == 1 else end
            return q

        store.query.by_id = mock_by_id

        # Mock get_successors
        with patch.object(nav, 'get_successors') as mock_succ:
            def succ_side_effect(nid):
                if (nid == 1 or (hasattr(nid, 'id') and nid.id == 1)):
                    return iter([end])
                return iter([])
            mock_succ.side_effect = succ_side_effect

            path = nav.find_path(1, 2, max_steps=10)

        self.assertEqual(len(path), 2)
        self.assertEqual(path[0].id, 1)
        self.assertEqual(path[1].id, 2)

    def test_returns_empty_for_unreachable(self):
        """find_path returns empty list when no path exists."""
        store = MagicMock()
        nav = ControlFlowNavigator(store)

        start = _make_mock_node(1, "start")

        def mock_by_id(nid):
            q = MagicMock()
            q.first.return_value = start if nid == 1 else None
            return q

        store.query.by_id = mock_by_id

        with patch.object(nav, 'get_successors', return_value=iter([])):
            path = nav.find_path(1, 999, max_steps=10)

        self.assertEqual(path, [])

    def test_self_reachability(self):
        """find_path returns single-node path for same start and end."""
        store = MagicMock()
        nav = ControlFlowNavigator(store)

        node = _make_mock_node(1, "self")
        q = MagicMock()
        q.first.return_value = node
        store.query.by_id.return_value = q

        path = nav.find_path(1, 1)
        self.assertEqual(len(path), 1)
        self.assertEqual(path[0].id, 1)


class TestWitnessHopModel(unittest.TestCase):
    """Test WitnessHop Pydantic model serialization."""

    def test_witness_hop_defaults(self):
        """WitnessHop has sensible defaults."""
        hop = WitnessHop(node_id=42)
        self.assertEqual(hop.node_id, 42)
        self.assertEqual(hop.name, "?")
        self.assertIsNone(hop.file)
        self.assertIsNone(hop.line)
        self.assertEqual(hop.label, "UNKNOWN")
        self.assertEqual(hop.depth, 0)
        self.assertEqual(hop.edge_type, "")

    def test_witness_hop_full_construction(self):
        """WitnessHop with all fields set."""
        hop = WitnessHop(
            node_id=100,
            name="main",
            file="main.c",
            line=42,
            label="METHOD",
            depth=2,
            edge_type="CALL",
        )
        self.assertEqual(hop.node_id, 100)
        self.assertEqual(hop.name, "main")
        self.assertEqual(hop.file, "main.c")
        self.assertEqual(hop.line, 42)
        self.assertEqual(hop.label, "METHOD")
        self.assertEqual(hop.depth, 2)
        self.assertEqual(hop.edge_type, "CALL")

    def test_witness_hop_json_serialization(self):
        """WitnessHop serializes to JSON with all expected keys."""
        hop = WitnessHop(
            node_id=1, name="foo", file="bar.c", line=10,
            label="CALL", depth=1, edge_type="CALL",
        )
        data = hop.model_dump(mode="json")
        self.assertIn("node_id", data)
        self.assertIn("name", data)
        self.assertIn("file", data)
        self.assertIn("line", data)
        self.assertIn("label", data)
        self.assertIn("depth", data)
        self.assertIn("edge_type", data)
        self.assertEqual(data["node_id"], 1)

    def test_witness_hop_json_schema(self):
        """WitnessHop produces a valid JSON schema for agents."""
        schema = WitnessHop.model_json_schema()
        self.assertIn("properties", schema)
        props = schema["properties"]
        self.assertIn("node_id", props)
        self.assertIn("depth", props)
        self.assertIn("edge_type", props)

    def test_node_to_witness_hop_helper(self):
        """_node_to_witness_hop converts a mock CPGNode to WitnessHop dict."""
        node = _make_mock_node(42, "target_func", "main.c", 10, "METHOD")
        hop_dict = _node_to_witness_hop(node, depth=3, edge_type="CALL")
        self.assertEqual(hop_dict["node_id"], 42)
        self.assertEqual(hop_dict["name"], "target_func")
        self.assertEqual(hop_dict["file"], "main.c")
        self.assertEqual(hop_dict["line"], 10)
        self.assertEqual(hop_dict["label"], "METHOD")
        self.assertEqual(hop_dict["depth"], 3)
        self.assertEqual(hop_dict["edge_type"], "CALL")

    def test_node_to_witness_hop_default_depth(self):
        """_node_to_witness_hop uses depth=0 and empty edge_type by default."""
        node = _make_mock_node(1, "test")
        hop_dict = _node_to_witness_hop(node)
        self.assertEqual(hop_dict["depth"], 0)
        self.assertEqual(hop_dict["edge_type"], "")


if __name__ == "__main__":
    unittest.main()
