import unittest
from typing import List, Optional

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    FileNode, MethodNode, BlockNode, LocalNode, IdentifierNode, 
    CallNode, LiteralNode, TypeDeclNode, MemberNode, MethodParameterInNode,
    MethodParameterOutNode, NamespaceBlockNode, DirectoryNode, FieldIdentifierNode
)
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType
from codedmap.core.schema.graph.operators import Operators
from codedmap.core.graph_builder import CPGBuilder

class TestCPGBuilder(unittest.TestCase):

    def setUp(self):
        """每个测试前重置图和构建器"""
        self.graph = CPGGraph()
        self.builder = CPGBuilder(self.graph)

    # =========================================================================
    # 辅助断言方法 (Helpers)
    # =========================================================================

    def _find_edge(self, src_node, dst_node, edge_type):
        """查找是否存在特定类型的边"""
        for edge in self.graph.edges:
            if edge.src == src_node.id and edge.dst == dst_node.id and edge.type == edge_type:
                return edge
        return None

    def assertAstEdge(self, parent, child):
        self.assertIsNotNone(self._find_edge(parent, child, EdgeType.AST), 
                             f"Missing AST edge: {parent.label} -> {child.label}")

    def assertRefEdge(self, usage, definition):
        self.assertIsNotNone(self._find_edge(usage, definition, EdgeType.REF),
                             f"Missing REF edge: {usage.name} -> {definition.name}")

    def assertContainsEdge(self, parent, child):
        self.assertIsNotNone(self._find_edge(parent, child, EdgeType.CONTAINS),
                             f"Missing CONTAINS edge: {parent.label} -> {child.label}")

    def _get_directory_by_path(self, path: str) -> Optional[DirectoryNode]:
        """Helper: 按路径查找目录节点"""
        for node in self.graph.nodes.values():
            if isinstance(node, DirectoryNode) and node.path == path:
                return node
        return None

    # =========================================================================
    # Test Cases: Directory & Hierarchy (重点关注区域)
    # =========================================================================

    def test_directory_hierarchy_generation(self):
        """[Happy Path] 测试 src/utils/helper.py 的生成"""
        filename = "src/utils/helper.py"
        with self.builder.file(filename) as f_node:
            pass

        dir_src = self._get_directory_by_path("src")
        dir_utils = self._get_directory_by_path("src/utils")

        self.assertIsNotNone(dir_src)
        self.assertIsNotNone(dir_utils)

        # 验证层级: src -> utils -> file
        self.assertContainsEdge(dir_src, dir_utils)
        self.assertContainsEdge(dir_utils, f_node)

    def test_directory_deduplication_cache(self):
        """
        [Boundary Case 1] 验证目录去重缓存
        场景: 
          1. 解析 src/utils/a.py -> 创建 src, src/utils
          2. 解析 src/utils/b.py -> 应该复用已有的 src/utils，而不是创建新的
        """
        # File A
        with self.builder.file("src/utils/a.py") as f_a:
            pass
        
        # 记录此时 utils 节点的 ID
        dir_utils_first = self._get_directory_by_path("src/utils")
        self.assertIsNotNone(dir_utils_first)
        id_first = dir_utils_first.id

        # File B (同目录)
        with self.builder.file("src/utils/b.py") as f_b:
            pass

        # File C (不同子目录，但共用父目录 src)
        with self.builder.file("src/core/c.py") as f_c:
            pass

        # 验证结果
        # 1. 再次获取 src/utils，ID 必须相同
        dir_utils_second = self._get_directory_by_path("src/utils")
        self.assertEqual(dir_utils_second.id, id_first, "Directory node was duplicated! Cache failed.")
        
        # 2. 验证图中的总目录数
        # 预期: src, src/utils, src/core (共3个)
        all_dirs = [n for n in self.graph.nodes.values() if isinstance(n, DirectoryNode)]
        self.assertEqual(len(all_dirs), 3, f"Expected 3 directories, found {len(all_dirs)}: {[d.path for d in all_dirs]}")

        # 3. 验证包含关系
        # src/utils 应该同时包含 a.py 和 b.py
        self.assertContainsEdge(dir_utils_second, f_a)
        self.assertContainsEdge(dir_utils_second, f_b)

    def test_deep_recursive_creation(self):
        """
        [Boundary Case 2] 验证深度递归创建
        场景: a/b/c/d/e.py (中间目录都不存在)
        """
        path = "level1/level2/level3/level4/deep.py"
        with self.builder.file(path) as f_node:
            pass

        # 验证每一个层级都存在
        l1 = self._get_directory_by_path("level1")
        l2 = self._get_directory_by_path("level1/level2")
        l3 = self._get_directory_by_path("level1/level2/level3")
        l4 = self._get_directory_by_path("level1/level2/level3/level4")

        self.assertIsNotNone(l1)
        self.assertIsNotNone(l2)
        self.assertIsNotNone(l3)
        self.assertIsNotNone(l4)

        # 验证链条连接
        self.assertContainsEdge(l1, l2)
        self.assertContainsEdge(l2, l3)
        self.assertContainsEdge(l3, l4)
        self.assertContainsEdge(l4, f_node)

    def test_root_level_files(self):
        """
        [Boundary Case 3] 根目录文件不应创建 DirectoryNode
        场景: main.py, README.md
        """
        with self.builder.file("main.py") as f_main:
            pass
        
        with self.builder.file("README.md") as f_readme:
            pass

        # 检查是否创建了名为 "." 或 "" 的目录节点
        root_dirs = [n for n in self.graph.nodes.values() 
                     if isinstance(n, DirectoryNode) and n.path in [".", "", "/"]]
        self.assertEqual(len(root_dirs), 0, "Should not create directory node for root level files")

    # =========================================================================
    # Test Cases: Other Logic (Keeping previous tests)
    # =========================================================================

    def test_basic_structure(self):
        with self.builder.file("main.c") as f_node:
            with self.builder.method("main", "int main()") as m_node:
                with self.builder.block() as b_node:
                    self.builder.literal("1")
        self.assertAstEdge(f_node, m_node)
        self.assertContainsEdge(f_node, m_node)

    def test_symbol_resolution_local(self):
        with self.builder.method("func") as m:
            with self.builder.block() as b:
                x_def = self.builder.local_variable("x", "int")
                x_usage = self.builder.identifier("x")
                self.assertRefEdge(x_usage, x_def)

    def test_symbol_resolution_parameter(self):
        with self.builder.method("func") as m:
            p_in = self.builder.parameter("a", "int", 1)
            with self.builder.block():
                a_usage = self.builder.identifier("a")
                self.assertRefEdge(a_usage, p_in)

    def test_symbol_shadowing(self):
        with self.builder.method("shadow_test"):
            with self.builder.block():
                x_outer = self.builder.local_variable("x", "int")
                with self.builder.block():
                    x_inner = self.builder.local_variable("x", "int")
                    use_inner = self.builder.identifier("x")
                    self.assertRefEdge(use_inner, x_inner)
                    self.assertIsNone(self._find_edge(use_inner, x_outer, EdgeType.REF))
                use_outer = self.builder.identifier("x")
                self.assertRefEdge(use_outer, x_outer)

    def test_parameter_in_out_link(self):
        with self.builder.method("func"):
            p_in = self.builder.parameter("x", "int", 1)
            out_nodes = [n for n in self.graph.nodes.values() if isinstance(n, MethodParameterOutNode) and n.name == "x"]
            self.assertEqual(len(out_nodes), 1)
            self.assertIsNotNone(self._find_edge(p_in, out_nodes[0], EdgeType.PARAMETER_LINK))

    def test_complex_expressions(self):
        with self.builder.method("calc"):
            with self.builder.block() as blk:
                self.builder.local_variable("x", "int")
                self.builder.local_variable("y", "int")
                rhs = self.builder.binary_op(self.builder.identifier("x"), self.builder.literal("1"), Operators.addition)
                assign_node = self.builder.assignment(self.builder.identifier("y"), rhs)
                self.assertIsInstance(assign_node, CallNode)
                self.assertAstEdge(blk, assign_node)

    def test_field_access(self):
        with self.builder.method("test"):
            with self.builder.block():
                obj = self.builder.identifier("obj")
                fa_node = self.builder.field_access(obj, "field")
                self.assertEqual(fa_node.name, Operators.fieldAccess)
                args = [n for n in self.graph.nodes.values() if self._find_edge(fa_node, n, EdgeType.ARGUMENT)]
                self.assertTrue(any(isinstance(n, (FieldIdentifierNode, IdentifierNode, LiteralNode)) for n in args))

    def test_class_definition(self):
        with self.builder.type_decl("MyClass", "pkg.MyClass") as cls_node:
            mem_node = self.builder.add_member("mVariable", "int")
            with self.builder.method("mMethod") as m_node:
                pass
            self.assertContainsEdge(cls_node, mem_node)
            self.assertContainsEdge(cls_node, m_node)

    def test_imports_and_namespace(self):
        with self.builder.file("test.py") as f_node:
            with self.builder.namespace_block("pkg") as ns_node:
                imp_node = self.builder.add_import("sys")
                self.assertAstEdge(ns_node, imp_node)
            imp_node_2 = self.builder.add_import("os")
            self.assertAstEdge(f_node, imp_node_2)

    def test_metadata_and_global(self):
        self.builder.add_meta_data("C", "/root")
        with self.builder.file("globals.c") as f:
            g_var = self.builder.global_variable("g_count", "int")
            self.assertAstEdge(f, g_var)

if __name__ == "__main__":
    unittest.main()