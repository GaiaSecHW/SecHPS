import unittest
import logging
import sys
import os

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())
logging.basicConfig(level=logging.DEBUG)

from typing import Type
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    MethodNode, BlockNode, CallNode, IdentifierNode, LocalNode, LiteralNode, 
    ControlStructureNode, MethodReturnNode
)
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType, NodeLabel, ParseStrategy
from codedmap.core.schema.graph.operators import Operators
from codedmap.analysis.passes.stream.ddg import DataFlowPass
from codedmap.core.configs.storage import StorageConfig

class TestDDGPass(unittest.TestCase):

    def setUp(self):
        """
        [Stream Architecture 适配] 
        不再需要 CPGStore，直接在内存 CPGGraph 上测试。
        """
        self.config = StorageConfig(backend="memory")
        
        # 1. 直接创建内存图
        self.graph = CPGGraph()
        
        # 2. 实例化 Pass (StreamPass 只需要 StorageConfig)
        self.pass_instance = DataFlowPass(config=self.config)

    def tearDown(self):
        self.graph = None

    def _create_node(self, cls: Type, **kwargs):
        """
        辅助函数：创建节点并自动填充 Pydantic 必填字段。
        """
        # 1. 基础字段
        if "code" not in kwargs: kwargs["code"] = "<code>"
        if "order" not in kwargs: kwargs["order"] = 0
        
        # 2. 利用 Pydantic model_fields 动态检查必填项
        fields = cls.model_fields
        
        if "name" in fields and "name" not in kwargs: 
            kwargs["name"] = "temp_name"
            
        if "full_name" in fields and "full_name" not in kwargs:
            kwargs["fullName"] = "test.Name"
            
        if "type_full_name" in fields and "type_full_name" not in kwargs:
            kwargs["typeFullName"] = "ANY"
            
        if "control_structure_type" in fields and "control_structure_type" not in kwargs:
             kwargs["controlStructureType"] = ControlStructureType.IF

        node = cls(**kwargs)
        # 直接添加到内存图
        self.graph.add_node(node)
        return node

    def _link(self, src, dst, type):
        self.graph.add_edge(src, dst, type)

    def _make_assignment(self, block, lhs_var, rhs_node, order):
        """构造 x = rhs 结构，并建立 REF"""
        # Call: <operator>.assignment
        assign = self._create_node(CallNode, name=Operators.assignment, order=order, label=NodeLabel.CALL)
        self._link(block, assign, EdgeType.AST)
        
        # LHS: Identifier x
        lhs = self._create_node(IdentifierNode, name=lhs_var.name, order=1, label=NodeLabel.IDENTIFIER)
        self._link(assign, lhs, EdgeType.AST)
        self._link(lhs, lhs_var, EdgeType.REF) # 关键：建立引用
        
        # RHS: Node
        rhs_node.order = 2
        self._link(assign, rhs_node, EdgeType.AST)
        
        return assign, lhs

    def _make_usage(self, block, var, order):
        """构造 foo(x) 结构"""
        call = self._create_node(CallNode, name="foo", order=order, label=NodeLabel.CALL)
        self._link(block, call, EdgeType.AST)
        
        ident = self._create_node(IdentifierNode, name=var.name, order=1, label=NodeLabel.IDENTIFIER)
        self._link(call, ident, EdgeType.AST)
        self._link(ident, var, EdgeType.REF)
        
        return call, ident

    def _assert_ddg(self, src_node, dst_node, var_name):
        found = False
        for edge in self.graph.edges:
            if edge.type == EdgeType.DDG and edge.src == src_node.id and edge.dst == dst_node.id:
                if edge.properties.get("variable") == var_name:
                    found = True
                    break
        self.assertTrue(found, f"Expected DDG edge {src_node.id} -> {dst_node.id} for var '{var_name}'")

    # =========================================================================
    # Test Cases
    # =========================================================================

    def test_basic_reaching_def(self):
        """
        int x;
        x = 1; (def1)
        foo(x); (use1)
        """
        method = self._create_node(MethodNode, name="main", label=NodeLabel.METHOD)
        block = self._create_node(BlockNode, label=NodeLabel.BLOCK)
        self._link(method, block, EdgeType.AST)
        
        x_local = self._create_node(LocalNode, name="x", typeFullName="int", label=NodeLabel.LOCAL)
        self._link(block, x_local, EdgeType.AST)
        
        # x = 1
        lit1 = self._create_node(LiteralNode, code="1", label=NodeLabel.LITERAL)
        assign1, lhs1 = self._make_assignment(block, x_local, lit1, 1)
        
        # foo(x)
        use_call, use_ident = self._make_usage(block, x_local, 2)
        
        # 手动连接 CFG (CallNode -> Identifier)
        self._link(assign1, use_ident, EdgeType.CFG) 
        
        # [Stream Architecture 关键] 
        # 直接在内存图上运行，传入 FULL 策略
        self.pass_instance.run_on_graph(self.graph, ParseStrategy.FULL)
        
        # Check: LHS(Identifier) -> UseIdent
        self._assert_ddg(lhs1, use_ident, "x")

    def test_kill_definition(self):
        """
        x = 1; (def1)
        x = 2; (def2) - kills def1
        foo(x); (use) - should only depend on def2
        """
        method = self._create_node(MethodNode, label=NodeLabel.METHOD)
        block = self._create_node(BlockNode, label=NodeLabel.BLOCK)
        self._link(method, block, EdgeType.AST)
        
        x = self._create_node(LocalNode, name="x", label=NodeLabel.LOCAL)
        
        # x = 1
        a1, lhs1 = self._make_assignment(block, x, self._create_node(LiteralNode, label=NodeLabel.LITERAL), 1)
        # x = 2
        a2, lhs2 = self._make_assignment(block, x, self._create_node(LiteralNode, label=NodeLabel.LITERAL), 2)
        # use(x)
        _, u = self._make_usage(block, x, 3)
        
        # CFG: a1 -> a2 -> u
        self._link(a1, a2, EdgeType.CFG)
        self._link(a2, u, EdgeType.CFG)
        
        # Run Stream Pass
        self.pass_instance.run_on_graph(self.graph, ParseStrategy.FULL)
        
        # Assertions
        self._assert_ddg(lhs2, u, "x")
        
        # Assert NO DDG from lhs1 to u (Killed)
        found_killed = False
        for edge in self.graph.edges:
            if edge.type == EdgeType.DDG and edge.src == lhs1.id and edge.dst == u.id:
                found_killed = True
                break
        self.assertFalse(found_killed, "Def1 (LHS1) should be killed by Def2 (LHS2)")

    def test_branch_merge(self):
        """
        if (?) { x = 1 (d1) } else { x = 2 (d2) }
        use(x) (u) -> depends on d1 AND d2
        """
        method = self._create_node(MethodNode, label=NodeLabel.METHOD)
        block = self._create_node(BlockNode, label=NodeLabel.BLOCK)
        self._link(method, block, EdgeType.AST)
        
        x = self._create_node(LocalNode, name="x", label=NodeLabel.LOCAL)
        
        # Condition
        cond = self._create_node(IdentifierNode, name="cond", label=NodeLabel.IDENTIFIER)
        
        # D1: x = 1
        d1, lhs1 = self._make_assignment(block, x, self._create_node(LiteralNode, label=NodeLabel.LITERAL), 1)
        # D2: x = 2
        d2, lhs2 = self._make_assignment(block, x, self._create_node(LiteralNode, label=NodeLabel.LITERAL), 2)
        # Use: x
        _, u = self._make_usage(block, x, 3)
        
        # CFG: Cond -> D1, Cond -> D2, D1 -> U, D2 -> U (Diamond shape)
        self._link(cond, d1, EdgeType.CFG)
        self._link(cond, d2, EdgeType.CFG)
        self._link(d1, u, EdgeType.CFG)
        self._link(d2, u, EdgeType.CFG)
        
        # Run Stream Pass
        self.pass_instance.run_on_graph(self.graph, ParseStrategy.FULL)
        
        # lhs1 -> u, lhs2 -> u
        self._assert_ddg(lhs1, u, "x")
        self._assert_ddg(lhs2, u, "x")

    def test_skeleton_skip(self):
        """
        [New Test] 验证 SKELETON 策略下是否跳过分析
        """
        method = self._create_node(MethodNode, name="stub_method", label=NodeLabel.METHOD)
        # 即使有逻辑，如果是 SKELETON 策略也应该忽略
        block = self._create_node(BlockNode, label=NodeLabel.BLOCK)
        self._link(method, block, EdgeType.AST)
        x = self._create_node(LocalNode, name="x", label=NodeLabel.LOCAL)
        a1, lhs1 = self._make_assignment(block, x, self._create_node(LiteralNode), 1)
        _, u = self._make_usage(block, x, 2)
        self._link(a1, u, EdgeType.CFG)

        # Run with SKELETON
        self.pass_instance.run_on_graph(self.graph, ParseStrategy.SKELETON)

        # Assert NO DDG edges generated
        ddg_edges = [e for e in self.graph.edges if e.type == EdgeType.DDG]
        self.assertEqual(len(ddg_edges), 0, "SKELETON strategy should skip DDG analysis")

if __name__ == "__main__":
    unittest.main()