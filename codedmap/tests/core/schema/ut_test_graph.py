import unittest
from typing import Type
import sys
import os

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

# 导入真实 Schema
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import FileNode, MethodNode, CallNode
from codedmap.core.schema.graph.enums import EdgeType

class TestCPGGraph(unittest.TestCase):

    def setUp(self):
        """每个测试前创建一个新图"""
        from codedmap.utils import id_generator
        print(f"\n[DIAGNOSTIC] Loaded id_generator from: {id_generator.__file__}")
        
        # 检查是否是单例
        if hasattr(id_generator, '_generator'):
            gen = id_generator._generator
            print(f"[DIAGNOSTIC] Generator instance: {gen}")
            print(f"[DIAGNOSTIC] Machine ID: {getattr(gen, 'machine_id', 'UNKNOWN')}")
        else:
            print("[DIAGNOSTIC] _generator instance NOT FOUND in module! (Running old code?)")
        # --- Diagnostic End ---

        self.graph = CPGGraph()

    def _create_node(self, cls: Type, **kwargs):
        """辅助：创建节点并填充必填项"""
        # Pydantic 模型可能会有校验，填充一些默认的必填字段以防万一
        if "code" not in kwargs and "code" in cls.model_fields: kwargs["code"] = ""
        if "name" in cls.model_fields and "name" not in kwargs: kwargs["name"] = "test"
        if "full_name" in cls.model_fields and "full_name" not in kwargs: kwargs["fullName"] = "test"
        if "fullName" in cls.model_fields and "fullName" not in kwargs: kwargs["fullName"] = "test"
        # 实例化节点
        return cls(**kwargs)

    # =========================================================================
    # 1. 节点管理测试 (Snowflake ID)
    # =========================================================================

    def test_add_node_auto_id(self):
        """测试自动 ID 分配 (Snowflake ID)"""
        n1 = self._create_node(FileNode, name="a.c")
        n2 = self._create_node(MethodNode, name="main")

        # 即使 n1 初始化时已有 ID，add_node 也会返回该 ID 或生成新 ID
        id1 = self.graph.add_node(n1)
        id2 = self.graph.add_node(n2)

        # [Check] Snowflake ID 是大整数
        self.assertIsInstance(id1, int)
        self.assertGreater(id1, 0)
        self.assertNotEqual(id1, id2)
        
        # 验证对象内的 ID 已同步
        self.assertEqual(n1.id, id1)
        
        # 验证 Max ID 更新
        self.assertGreaterEqual(self.graph._max_id, id1)
        self.assertGreaterEqual(self.graph._max_id, id2)
        
        # 验证内部存储
        self.assertEqual(self.graph.nodes[id1], n1)

    def test_add_node_with_existing_id(self):
        """测试添加自带 ID 的节点（如从存储恢复）"""
        # 手动指定一个 ID
        manual_id = 100
        n1 = self._create_node(FileNode, id=manual_id, name="b.c")
        
        self.graph.add_node(n1)
        
        self.assertEqual(n1.id, manual_id)
        self.assertGreaterEqual(self.graph._max_id, manual_id)
        
        # 添加下一个新节点
        n2 = self._create_node(MethodNode)
        # 确保 n2 的 ID 不会与 manual_id 冲突
        if n2.id is None:
            new_id = self.graph.add_node(n2)
        else:
            new_id = self.graph.add_node(n2)
        
        self.assertNotEqual(new_id, manual_id)
        self.assertGreater(new_id, 0)

    # =========================================================================
    # 2. 边管理测试
    # =========================================================================

    def test_add_edge_basic(self):
        """测试添加边"""
        n1 = self._create_node(FileNode)
        n2 = self._create_node(MethodNode)
        self.graph.add_node(n1)
        self.graph.add_node(n2)

        edge = self.graph.add_edge(n1, n2, EdgeType.AST)
        
        self.assertEqual(len(self.graph.edges), 1)
        self.assertEqual(edge.src, n1.id)
        self.assertEqual(edge.dst, n2.id)
        self.assertEqual(edge.type, EdgeType.AST)

    def test_add_edge_validation(self):
        """
        [Fix] 测试添加边时的 ID 校验。
        这个测试的目的是验证：当试图连接没有 ID 的节点时，是否会报错。
        """
        n1 = self._create_node(FileNode)
        n2 = self._create_node(MethodNode)

        # [关键修复]：显式将 ID 设为 None。
        # 你的环境显示 n1 在初始化后已经自动分配了 ID (比如 Pydantic default_factory)。
        # 为了测试 add_edge 的 "ValueError: Nodes must have IDs" 逻辑，
        # 我们必须手动制造一个"没有 ID"的场景。
        n1.id = None
        n2.id = None

        # 确保 id 确实为 None (现在肯定通过)
        self.assertIsNone(n1.id)
        self.assertIsNone(n2.id)

        # 应该抛出 ValueError
        with self.assertRaises(ValueError):
            self.graph.add_edge(n1, n2, EdgeType.AST)

    def test_helper_methods(self):
        """测试语法糖方法"""
        n1 = self._create_node(MethodNode)
        n2 = self._create_node(CallNode, name="foo")
        self.graph.add_node(n1)
        self.graph.add_node(n2)

        # CFG
        self.graph.add_cfg_edge(n1, n2, label="TRUE")
        edge_cfg = self.graph.edges[-1]
        self.assertEqual(edge_cfg.type, EdgeType.CFG)
        self.assertEqual(edge_cfg.properties["label"], "TRUE")

        # DDG
        self.graph.add_ddg_edge(n1, n2, variable="x")
        edge_ddg = self.graph.edges[-1]
        self.assertEqual(edge_ddg.type, EdgeType.DDG)
        self.assertEqual(edge_ddg.properties["variable"], "x")

    # =========================================================================
    # 3. 图合并测试
    # =========================================================================

    def test_merge_subgraph_no_id_shift(self):
        """
        测试图合并：验证 ID 不会发生偏移。
        """
        # 1. 准备主图
        main_n1 = self._create_node(FileNode, name="main.c")
        self.graph.add_node(main_n1) 
        main_id = main_n1.id
        
        # 2. 准备子图
        subgraph = CPGGraph()
        sub_n1 = self._create_node(FileNode, name="lib.c")
        sub_n2 = self._create_node(MethodNode, name="lib_func")
        
        subgraph.add_node(sub_n1)
        subgraph.add_node(sub_n2)
        sub_id_1 = sub_n1.id
        sub_id_2 = sub_n2.id
        
        # 3. 执行合并
        self.graph.merge(subgraph)

        # 4. 验证
        self.assertEqual(len(self.graph.nodes), 3)
        self.assertTrue(self.graph.has_node(sub_id_1))
        self.assertTrue(self.graph.has_node(sub_id_2))
        
        # 验证对象数据
        self.assertEqual(self.graph.nodes[sub_id_1].name, "lib.c")

    def test_merge_subgraph_edges_integrity(self):
        """
        测试图合并后，边的连接关系保持不变。
        """
        # 主图
        n1 = self._create_node(FileNode)
        self.graph.add_node(n1) 
        
        # 子图
        subgraph = CPGGraph()
        s1 = self._create_node(MethodNode, name="A")
        s2 = self._create_node(MethodNode, name="B")
        subgraph.add_node(s1)
        subgraph.add_node(s2)
        
        subgraph.add_edge(s1, s2, EdgeType.CFG)
        
        s1_id = s1.id
        s2_id = s2.id
        
        # 合并
        self.graph.merge(subgraph)
        
        # 验证
        self.assertEqual(len(self.graph.edges), 1)
        merged_edge = self.graph.edges[0]
        
        self.assertEqual(merged_edge.src, s1_id)
        self.assertEqual(merged_edge.dst, s2_id)
        self.assertEqual(merged_edge.type, EdgeType.CFG)

    def test_merge_empty_subgraph(self):
        """测试合并空子图"""
        subgraph = CPGGraph()
        initial_len = len(self.graph.nodes)
        self.graph.merge(subgraph)
        self.assertEqual(len(self.graph.nodes), initial_len)

if __name__ == "__main__":
    unittest.main()