import os
import sys

sys.path.append(os.getcwd())

from codedmap.utils.id_generator import generate_deterministic_id
from codedmap.frontend.integrations.joern.id_bridge import JoernIdBridge


class TestPassthroughStrategy:
    def test_passthrough_returns_original_id(self):
        bridge = JoernIdBridge(strategy="passthrough")
        cpg_id = bridge.translate_node_id(
            joern_id=12345,
            label="CALL",
            properties={"name": "test"},
        )
        assert cpg_id == 12345

    def test_passthrough_for_global_node(self):
        bridge = JoernIdBridge(strategy="passthrough")
        cpg_id = bridge.translate_node_id(
            joern_id=99999,
            label="METHOD",
            properties={"fullName": "test.c:main", "fileName": "test.c", "signature": "int(int)"},
        )
        assert cpg_id == 99999

    def test_edge_translation(self):
        bridge = JoernIdBridge(strategy="passthrough")
        bridge.translate_node_id(100, "CALL", {})
        bridge.translate_node_id(200, "METHOD", {"fullName": "foo"})

        assert bridge.translate_edge_id(100) == 100
        assert bridge.translate_edge_id(200) == 200
        assert bridge.translate_edge_id(999) is None


class TestRegenerateStrategy:
    def test_method_node_regenerate(self):
        bridge = JoernIdBridge(strategy="regenerate")
        cpg_id = bridge.translate_node_id(
            joern_id=1,
            label="METHOD",
            properties={
                "fullName": "test.c:main",
                "fileName": "test.c",
                "signature": "int(int)",
            },
        )
        expected = generate_deterministic_id("test.c", "METHOD", "test.c:main", "int(int)")
        assert cpg_id == expected

    def test_file_node_regenerate(self):
        bridge = JoernIdBridge(strategy="regenerate")
        cpg_id = bridge.translate_node_id(
            joern_id=8,
            label="FILE",
            properties={"fullName": "test.c", "name": "test.c"},
        )
        expected = generate_deterministic_id("FILE", "test.c")
        assert cpg_id == expected

    def test_type_decl_regenerate(self):
        bridge = JoernIdBridge(strategy="regenerate")
        cpg_id = bridge.translate_node_id(
            joern_id=10,
            label="TYPE_DECL",
            properties={"fullName": "TestStruct", "fileName": "test.c"},
        )
        expected = generate_deterministic_id("test.c", "TYPE_DECL", "TestStruct", "")
        assert cpg_id == expected

    def test_ast_node_regenerate_with_position(self):
        bridge = JoernIdBridge(strategy="regenerate")
        cpg_id = bridge.translate_node_id(
            joern_id=5,
            label="CALL",
            properties={
                "fileName": "test.c",
                "lineNumber": 5,
                "columnNumber": 5,
                "order": 0,
                "argumentIndex": None,
                "code": "printf(msg)",
            },
        )
        expected = generate_deterministic_id(
            "test.c", "CALL", "5", "5", "0", "-1", "-1", "-1", "printf(msg)"
        )
        assert cpg_id == expected

    def test_edge_translation_after_regenerate(self):
        bridge = JoernIdBridge(strategy="regenerate")
        cpg_id = bridge.translate_node_id(
            1, "METHOD",
            {"fullName": "test.c:main", "fileName": "test.c", "signature": "int(int)"},
        )
        assert bridge.translate_edge_id(1) == cpg_id


class TestHybridStrategy:
    def test_global_node_uses_regenerate(self):
        bridge = JoernIdBridge(strategy="hybrid")
        cpg_id = bridge.translate_node_id(
            joern_id=1,
            label="METHOD",
            properties={
                "fullName": "test.c:main",
                "fileName": "test.c",
                "signature": "int(int)",
            },
        )
        expected = generate_deterministic_id("test.c", "METHOD", "test.c:main", "int(int)")
        assert cpg_id == expected
        assert cpg_id != 1  # Should NOT be passthrough

    def test_ast_node_uses_passthrough(self):
        bridge = JoernIdBridge(strategy="hybrid")
        cpg_id = bridge.translate_node_id(
            joern_id=5,
            label="CALL",
            properties={"name": "printf"},
        )
        assert cpg_id == 5  # Passthrough for non-global

    def test_file_node_uses_regenerate(self):
        bridge = JoernIdBridge(strategy="hybrid")
        cpg_id = bridge.translate_node_id(
            joern_id=8,
            label="FILE",
            properties={"fullName": "test.c"},
        )
        expected = generate_deterministic_id("FILE", "test.c")
        assert cpg_id == expected

    def test_stats_tracking(self):
        bridge = JoernIdBridge(strategy="hybrid")
        bridge.translate_node_id(1, "METHOD", {"fullName": "main", "fileName": "test.c", "signature": ""})
        bridge.translate_node_id(5, "CALL", {"name": "printf"})
        bridge.translate_node_id(6, "IDENTIFIER", {"name": "x"})

        stats = bridge.stats
        assert stats["total"] == 3
        assert stats["regenerated"] == 1
        assert stats["passthrough"] == 2
