import os
import sys

sys.path.append(os.getcwd())

from codedmap.core.schema.graph.base import GenericNode
from codedmap.core.schema.graph.enums import (
    NodeLabel, DispatchType, ControlStructureType, ModifierType,
)
from codedmap.core.schema.graph.nodes import (
    MethodNode, CallNode, FileNode, IdentifierNode, LiteralNode,
    BlockNode, LocalNode, ControlStructureNode, TypeDeclNode,
    NamespaceBlockNode, ReturnNode, ModifierNode,
)
from codedmap.frontend.integrations.joern.mapper import (
    JoernNodeMapper, JoernEdgeMapper,
)


class TestJoernNodeMapper:
    def setup_method(self):
        self.mapper = JoernNodeMapper()

    def test_method_node_mapping(self):
        result = self.mapper.map_node("METHOD", {
            "NAME": "main",
            "FULL_NAME": "test.c:main",
            "SIGNATURE": "int(int)",
            "FILENAME": "test.c",
            "LINE_NUMBER": 1,
            "IS_EXTERNAL": "false",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is MethodNode
        assert kwargs["name"] == "main"
        assert kwargs["fullName"] == "test.c:main"
        assert kwargs["signature"] == "int(int)"
        assert kwargs["fileName"] == "test.c"
        assert kwargs["lineNumber"] == 1
        assert kwargs["isExternal"] is False
        assert kwargs["label"] == NodeLabel.METHOD

    def test_call_node_with_dispatch_type(self):
        result = self.mapper.map_node("CALL", {
            "NAME": "printf",
            "METHOD_FULL_NAME": "printf",
            "DISPATCH_TYPE": "STATIC_DISPATCH",
            "CODE": "printf(msg)",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is CallNode
        assert kwargs["dispatchType"] == DispatchType.STATIC_DISPATCH

    def test_file_node_mapping(self):
        result = self.mapper.map_node("FILE", {
            "NAME": "test.c",
            "FULL_NAME": "test.c",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is FileNode

    def test_control_structure_mapping(self):
        result = self.mapper.map_node("CONTROL_STRUCTURE", {
            "CONTROL_STRUCTURE_TYPE": "IF",
            "CODE": "if (x > 0)",
            "LINE_NUMBER": 5,
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is ControlStructureNode
        assert kwargs["controlStructureType"] == ControlStructureType.IF

    def test_type_decl_with_inherits(self):
        result = self.mapper.map_node("TYPE_DECL", {
            "NAME": "MyClass",
            "FULL_NAME": "MyClass",
            "INHERITS_FROM_TYPE_FULL_NAME": "Base1;Base2",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is TypeDeclNode
        assert kwargs["inheritsFromTypeFullName"] == ["Base1", "Base2"]

    def test_namespace_alias_mapping(self):
        """NAMESPACE should map to NAMESPACE_BLOCK."""
        result = self.mapper.map_node("NAMESPACE", {
            "NAME": "<global>",
            "FULL_NAME": "<global>",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is NamespaceBlockNode
        assert kwargs["label"] == NodeLabel.NAMESPACE_BLOCK

    def test_unknown_label_fallback(self):
        """Unknown labels should fallback to GenericNode."""
        result = self.mapper.map_node("SOME_UNKNOWN_TYPE", {
            "NAME": "test",
        })
        assert result is not None
        node_class, kwargs = result
        assert node_class is GenericNode

    def test_skip_unknown_labels(self):
        """When skip_unknown_labels=True, unknown labels return None."""
        mapper = JoernNodeMapper(skip_unknown_labels=True)
        result = mapper.map_node("SOME_UNKNOWN_TYPE", {"NAME": "test"})
        assert result is None

    def test_is_external_string_conversion(self):
        result = self.mapper.map_node("METHOD", {
            "NAME": "ext_func",
            "FULL_NAME": "ext_func",
            "IS_EXTERNAL": "true",
        })
        assert result is not None
        _, kwargs = result
        assert kwargs["isExternal"] is True

    def test_order_int_conversion(self):
        result = self.mapper.map_node("BLOCK", {
            "ORDER": "5",
        })
        assert result is not None
        _, kwargs = result
        assert kwargs["order"] == 5

    def test_modifier_type_enum(self):
        result = self.mapper.map_node("MODIFIER", {
            "MODIFIER_TYPE": "STATIC",
        })
        assert result is not None
        _, kwargs = result
        assert kwargs["modifierType"] == ModifierType.STATIC

    def test_empty_properties(self):
        """Nodes with minimal properties should still map."""
        result = self.mapper.map_node("BLOCK", {})
        assert result is not None
        node_class, kwargs = result
        assert node_class is BlockNode


class TestJoernEdgeMapper:
    def setup_method(self):
        self.mapper = JoernEdgeMapper()

    def test_ast_edge(self):
        result = self.mapper.map_edge("AST", {})
        assert result is not None
        edge_type, props = result
        assert edge_type == "AST"
        assert props == {}

    def test_ddg_edge_with_variable(self):
        result = self.mapper.map_edge("DDG", {"VARIABLE": "x"})
        assert result is not None
        edge_type, props = result
        assert edge_type == "DDG"
        assert props["variable"] == "x"

    def test_reaching_def_alias(self):
        """REACHING_DEF should map to DDG."""
        result = self.mapper.map_edge("REACHING_DEF", {"VARIABLE": "y"})
        assert result is not None
        edge_type, props = result
        assert edge_type == "DDG"
        assert props["variable"] == "y"

    def test_cfg_edge(self):
        result = self.mapper.map_edge("CFG", {})
        assert result is not None
        edge_type, props = result
        assert edge_type == "CFG"

    def test_skip_edge_types(self):
        mapper = JoernEdgeMapper(skip_edge_types=["DOMINATE"])
        result = mapper.map_edge("DOMINATE", {})
        assert result is None

    def test_unknown_edge_type_passthrough(self):
        """Unknown edge types should pass through as strings."""
        result = self.mapper.map_edge("SOME_CUSTOM_EDGE", {})
        assert result is not None
        edge_type, _ = result
        assert edge_type == "SOME_CUSTOM_EDGE"

    def test_contains_edge(self):
        result = self.mapper.map_edge("CONTAINS", {})
        assert result is not None
        assert result[0] == "CONTAINS"

    def test_call_edge(self):
        result = self.mapper.map_edge("CALL", {})
        assert result is not None
        assert result[0] == "CALL"
