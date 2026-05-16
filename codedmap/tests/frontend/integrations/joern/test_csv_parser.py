import os
import sys
import tempfile
from pathlib import Path

sys.path.append(os.getcwd())

from codedmap.frontend.integrations.joern.csv_parser import (
    ColumnSpec,
    _convert_value,
    parse_nodes,
    parse_edges,
    find_csv_files,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestColumnSpec:
    def test_meta_id_column(self):
        col = ColumnSpec(":ID")
        assert col.property_name == "ID"
        assert col.is_meta is True
        assert col.neo4j_type == "id"

    def test_meta_label_column(self):
        col = ColumnSpec(":LABEL")
        assert col.property_name == "LABEL"
        assert col.is_meta is True

    def test_meta_start_id(self):
        col = ColumnSpec(":START_ID")
        assert col.property_name == "START_ID"
        assert col.is_meta is True
        assert col.neo4j_type == "start_id"

    def test_typed_string_column(self):
        col = ColumnSpec("NAME:STRING")
        assert col.property_name == "NAME"
        assert col.neo4j_type == "string"
        assert col.is_meta is False

    def test_typed_int_column(self):
        col = ColumnSpec("LINE_NUMBER:INT")
        assert col.property_name == "LINE_NUMBER"
        assert col.neo4j_type == "int"
        assert col.is_meta is False

    def test_untyped_column(self):
        col = ColumnSpec("CODE")
        assert col.property_name == "CODE"
        assert col.neo4j_type == "string"
        assert col.is_meta is False

    def test_id_with_namespace(self):
        col = ColumnSpec(":ID(SomeSpace)")
        assert col.property_name == "ID"
        assert col.is_meta is True


class TestConvertValue:
    def test_empty_string(self):
        assert _convert_value("", "string") is None

    def test_int_conversion(self):
        assert _convert_value("42", "int") == 42
        assert _convert_value("abc", "int") is None

    def test_long_conversion(self):
        assert _convert_value("1000000", "long") == 1000000

    def test_float_conversion(self):
        assert _convert_value("3.14", "float") == 3.14

    def test_boolean_true(self):
        assert _convert_value("true", "boolean") is True
        assert _convert_value("True", "boolean") is True
        assert _convert_value("1", "boolean") is True

    def test_boolean_false(self):
        assert _convert_value("false", "boolean") is False
        assert _convert_value("0", "boolean") is False

    def test_string_array(self):
        assert _convert_value("int;float;double", "string_array") == ["int", "float", "double"]
        assert _convert_value("single", "string_array") == ["single"]

    def test_int_array(self):
        assert _convert_value("1;2;3", "int_array") == [1, 2, 3]

    def test_string_passthrough(self):
        assert _convert_value("hello world", "string") == "hello world"


class TestParseNodes:
    def test_parse_fixture_nodes(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        assert len(nodes) > 0

        # 验证 METHOD 节点
        method_nodes = [(id_, label, props) for id_, label, props in nodes if label == "METHOD"]
        assert len(method_nodes) == 1
        joern_id, label, props = method_nodes[0]
        assert joern_id == 1
        assert label == "METHOD"
        assert props["NAME"] == "main"
        assert props["FULL_NAME"] == "test.c:main"
        assert props["LINE_NUMBER"] == 1
        assert props["FILENAME"] == "test.c"
        assert props["SIGNATURE"] == "int(int)"

    def test_parse_file_node(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        file_nodes = [(id_, label, props) for id_, label, props in nodes if label == "FILE"]
        assert len(file_nodes) == 1
        joern_id, _, props = file_nodes[0]
        assert joern_id == 8
        assert props["NAME"] == "test.c"

    def test_parse_call_node(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        call_nodes = [(id_, label, props) for id_, label, props in nodes if label == "CALL"]
        assert len(call_nodes) == 2  # printf and <operator>.assignment
        # printf call
        printf_call = [n for n in call_nodes if n[2].get("NAME") == "printf"][0]
        assert printf_call[2]["DISPATCH_TYPE"] == "STATIC_DISPATCH"
        assert printf_call[2]["METHOD_FULL_NAME"] == "printf"

    def test_parse_type_decl_with_inherits(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        td_nodes = [(id_, label, props) for id_, label, props in nodes if label == "TYPE_DECL"]
        assert len(td_nodes) == 1
        _, _, props = td_nodes[0]
        assert props["NAME"] == "TestStruct"
        assert props["INHERITS_FROM_TYPE_FULL_NAME"] == "int;float"

    def test_parse_control_structure(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        cs_nodes = [(id_, label, props) for id_, label, props in nodes if label == "CONTROL_STRUCTURE"]
        assert len(cs_nodes) == 1
        _, _, props = cs_nodes[0]
        assert props["CONTROL_STRUCTURE_TYPE"] == "IF"

    def test_all_labels_present(self):
        nodes = list(parse_nodes(FIXTURES_DIR / "nodes.csv"))
        labels = {label for _, label, _ in nodes}
        expected = {
            "METHOD", "METHOD_PARAMETER_IN", "LOCAL", "BLOCK", "CALL",
            "IDENTIFIER", "LITERAL", "FILE", "NAMESPACE_BLOCK", "TYPE_DECL",
            "MODIFIER", "RETURN", "IMPORT", "JUMP_TARGET", "METHOD_RETURN",
            "TYPE", "BINDING", "CONTROL_STRUCTURE", "FIELD_IDENTIFIER",
        }
        assert expected.issubset(labels), f"Missing labels: {expected - labels}"


class TestParseEdges:
    def test_parse_fixture_edges(self):
        edges = list(parse_edges(FIXTURES_DIR / "edges.csv"))
        assert len(edges) > 0

    def test_ast_edges(self):
        edges = list(parse_edges(FIXTURES_DIR / "edges.csv"))
        ast_edges = [(s, e, t, p) for s, e, t, p in edges if t == "AST"]
        assert len(ast_edges) > 5

    def test_ddg_edge_with_variable(self):
        edges = list(parse_edges(FIXTURES_DIR / "edges.csv"))
        ddg_edges = [(s, e, t, p) for s, e, t, p in edges if t == "DDG"]
        assert len(ddg_edges) == 1
        start, end, _, props = ddg_edges[0]
        assert start == 13
        assert end == 6
        assert props["VARIABLE"] == "x"

    def test_contains_edges(self):
        edges = list(parse_edges(FIXTURES_DIR / "edges.csv"))
        contains = [(s, e, t, p) for s, e, t, p in edges if t == "CONTAINS"]
        assert len(contains) == 2  # FILE->METHOD, NAMESPACE->METHOD

    def test_call_edge(self):
        edges = list(parse_edges(FIXTURES_DIR / "edges.csv"))
        call_edges = [(s, e, t, p) for s, e, t, p in edges if t == "CALL"]
        assert len(call_edges) == 1
        assert call_edges[0][0] == 5  # CallNode -> MethodNode
        assert call_edges[0][1] == 1


class TestFindCsvFiles:
    def test_find_in_fixtures(self):
        node_files, edge_files = find_csv_files(FIXTURES_DIR)
        assert len(node_files) >= 1
        assert len(edge_files) >= 1
        assert any("nodes" in f.name.lower() for f in node_files)
        assert any("edges" in f.name.lower() for f in edge_files)

    def test_missing_directory(self):
        import pytest
        with pytest.raises(FileNotFoundError):
            find_csv_files(Path("/nonexistent/path"))

    def test_empty_directory(self):
        import pytest
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(FileNotFoundError):
                find_csv_files(Path(tmpdir))
