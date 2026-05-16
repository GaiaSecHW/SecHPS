import unittest
import sys
import os
from typing import Set

sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, BlockNode, CallNode, 
    ControlStructureNode, LiteralNode, IdentifierNode, ReturnNode, JumpTargetNode
)
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType, NodeLabel, ParseStrategy
from codedmap.analysis.passes.stream.cfg import CFGPass
from codedmap.analysis.passes.stream.cdg import CDGPass
from codedmap.core.configs.storage import StorageConfig

import logging
logging.basicConfig(level=logging.INFO)

class BaseTestCDG(unittest.TestCase):
    """CDG 测试基类，提供构图和断言辅助方法"""

    def setUp(self):
        self.config = StorageConfig(backend="memory")
        self.graph = CPGGraph()
        
    def create_method_scaffold(self, name="main"):
        """创建一个包含 Method, Block, MethodReturn 的基础骨架"""
        method = MethodNode(
            name=name, 
            fullName=name, 
            signature="()", 
            code=f"{name}()",
            label=NodeLabel.METHOD
        )
        block = BlockNode(code="{...}", label=NodeLabel.BLOCK)
        method_ret = MethodReturnNode(
            name="RET", 
            fullName=f"{name}.RET", 
            typeFullName="void", 
            code="RET",
            label=NodeLabel.METHOD_RETURN
        )
        
        # 必须先添加节点分配 ID (MemoryBackend/CPGGraph 会自动处理 ID 自增)
        self.graph.add_node(method)
        self.graph.add_node(block)
        self.graph.add_node(method_ret)
        
        self.graph.add_ast_edge(method, block)
        self.graph.add_ast_edge(method, method_ret)
        
        return method, block, method_ret

    def run_passes(self):
        """
        [Refactor] 适配 Stream Pipeline 的运行方式
        不再调用 store.run()，而是直接在内存图上运行 pipeline。
        """
        # 1. 准备策略 (测试用例默认为 FULL)
        strategy = ParseStrategy.FULL

        # 2. 运行 CFG Pass (In-Memory)
        # 构造函数只接收 config
        cfg_pass = CFGPass(config=self.config)
        # 显式调用 run_on_graph，原地修改 self.graph
        cfg_pass.run_on_graph(self.graph, strategy)
        
        # 3. 运行 CDG Pass (In-Memory)
        cdg_pass = CDGPass(config=self.config)
        cdg_pass.run_on_graph(self.graph, strategy)

    def get_controllers(self, node: AnyNode) -> Set[int]:
        """获取控制该节点的所有节点 ID"""
        controllers = set()
        for edge in self.graph.edges:
            if edge.type == EdgeType.CDG and edge.dst == node.id:
                controllers.add(edge.src)
        return controllers

    def assert_controlled_by(self, dependent: AnyNode, controller: AnyNode):
        """断言 dependent 受 controller 控制"""
        controllers = self.get_controllers(dependent)
        self.assertIn(controller.id, controllers, 
                      f"Node {dependent.code} (ID:{dependent.id}) should be controlled by {controller.code} (ID:{controller.id}), but controllers are {controllers}")

    def assert_not_controlled_by(self, dependent: AnyNode, controller: AnyNode):
        """断言 dependent 不受 controller 控制"""
        controllers = self.get_controllers(dependent)
        self.assertNotIn(controller.id, controllers, 
                         f"Node {dependent.code} should NOT be controlled by {controller.code}")


class TestCDG(BaseTestCDG):

    def test_linear_flow(self):
        """场景 1: 线性流"""
        method, block, _ = self.create_method_scaffold()
        
        call_a = CallNode(name="a", methodFullName="a", code="call_a()", label=NodeLabel.CALL)
        call_b = CallNode(name="b", methodFullName="b", code="call_b()", label=NodeLabel.CALL)
        
        self.graph.add_node(call_a)
        self.graph.add_node(call_b)
        
        self.graph.add_ast_edge(block, call_a)
        self.graph.add_ast_edge(block, call_b)
        call_a.order = 1
        call_b.order = 2

        self.run_passes()

        self.assert_controlled_by(call_a, method)
        self.assert_controlled_by(call_b, method)

    def test_simple_if(self):
        """场景 2: 简单 IF"""
        method, block, _ = self.create_method_scaffold()
        
        if_node = ControlStructureNode(controlStructureType=ControlStructureType.IF, code="if(cond)", label=NodeLabel.CONTROL_STRUCTURE)
        cond = IdentifierNode(name="cond", typeFullName="bool", code="cond", label=NodeLabel.IDENTIFIER)
        true_block = BlockNode(code="{true}", label=NodeLabel.BLOCK)
        false_block = BlockNode(code="{false}", label=NodeLabel.BLOCK)
        
        true_stmt = CallNode(name="true_call", methodFullName="t", code="true_call()", label=NodeLabel.CALL)
        false_stmt = CallNode(name="false_call", methodFullName="f", code="false_call()", label=NodeLabel.CALL)
        after_stmt = CallNode(name="after", methodFullName="after", code="after()", label=NodeLabel.CALL)

        for n in [if_node, cond, true_block, false_block, true_stmt, false_stmt, after_stmt]:
            self.graph.add_node(n)

        # 组装 AST
        self.graph.add_ast_edge(block, if_node)
        self.graph.add_ast_edge(block, after_stmt)
        if_node.order = 1
        after_stmt.order = 2

        cond.order = 1
        true_block.order = 2
        false_block.order = 3
        self.graph.add_ast_edge(if_node, cond)
        self.graph.add_ast_edge(if_node, true_block)
        self.graph.add_ast_edge(if_node, false_block)
        
        self.graph.add_ast_edge(true_block, true_stmt)
        self.graph.add_ast_edge(false_block, false_stmt)

        self.run_passes()

        self.assert_controlled_by(true_stmt, if_node)
        self.assert_controlled_by(false_stmt, if_node)
        self.assert_not_controlled_by(after_stmt, if_node)
        self.assert_controlled_by(after_stmt, method)

    def test_nested_if(self):
        """场景 3: 嵌套 IF"""
        method, block, _ = self.create_method_scaffold()
        
        outer_if = ControlStructureNode(controlStructureType=ControlStructureType.IF, code="if(x)", label=NodeLabel.CONTROL_STRUCTURE)
        outer_cond = IdentifierNode(name="x", typeFullName="bool", code="x", label=NodeLabel.IDENTIFIER)
        outer_body = BlockNode(code="{...}", label=NodeLabel.BLOCK)
        
        inner_if = ControlStructureNode(controlStructureType=ControlStructureType.IF, code="if(y)", label=NodeLabel.CONTROL_STRUCTURE)
        inner_cond = IdentifierNode(name="y", typeFullName="bool", code="y", label=NodeLabel.IDENTIFIER)
        inner_body = BlockNode(code="{...}", label=NodeLabel.BLOCK)
        
        stmt = CallNode(name="foo", methodFullName="foo", code="foo()", label=NodeLabel.CALL)

        for n in [outer_if, outer_cond, outer_body, inner_if, inner_cond, inner_body, stmt]:
            self.graph.add_node(n)

        # 组装 AST
        self.graph.add_ast_edge(block, outer_if)
        
        outer_cond.order = 1
        outer_body.order = 2
        self.graph.add_ast_edge(outer_if, outer_cond)
        self.graph.add_ast_edge(outer_if, outer_body)
        
        self.graph.add_ast_edge(outer_body, inner_if)
        
        inner_cond.order = 1
        inner_body.order = 2
        self.graph.add_ast_edge(inner_if, inner_cond)
        self.graph.add_ast_edge(inner_if, inner_body)
        
        self.graph.add_ast_edge(inner_body, stmt)

        self.run_passes()

        self.assert_controlled_by(stmt, inner_if)
        # inner_cond (not inner_if) is the CFG participant that is control-dependent on outer_if.
        # ControlStructureNode is an AST grouping node, not a CFG node.
        self.assert_controlled_by(inner_cond, outer_if)

    def test_while_loop(self):
        """场景 4: While 循环"""
        method, block, _ = self.create_method_scaffold()
        
        while_node = ControlStructureNode(controlStructureType=ControlStructureType.WHILE, code="while(cond)", label=NodeLabel.CONTROL_STRUCTURE)
        cond = IdentifierNode(name="cond", typeFullName="bool", code="cond", label=NodeLabel.IDENTIFIER)
        body = BlockNode(code="{...}", label=NodeLabel.BLOCK)
        stmt = CallNode(name="loop_body", methodFullName="lb", code="loop_body()", label=NodeLabel.CALL)

        for n in [while_node, cond, body, stmt]:
            self.graph.add_node(n)

        self.graph.add_ast_edge(block, while_node)
        cond.order = 1
        body.order = 2
        self.graph.add_ast_edge(while_node, cond)
        self.graph.add_ast_edge(while_node, body)
        self.graph.add_ast_edge(body, stmt)

        self.run_passes()

        self.assert_controlled_by(stmt, while_node)

    def test_unreachable_code(self):
        """场景 5: 死代码"""
        method, block, _ = self.create_method_scaffold()
        
        ret_node = ReturnNode(code="return", label=NodeLabel.RETURN)
        dead_stmt = CallNode(name="dead", methodFullName="dead", code="dead()", label=NodeLabel.CALL)
        
        self.graph.add_node(ret_node)
        self.graph.add_node(dead_stmt)
        
        self.graph.add_ast_edge(block, ret_node)
        self.graph.add_ast_edge(block, dead_stmt)
        ret_node.order = 1
        dead_stmt.order = 2

        try:
            self.run_passes()
        except Exception as e:
            self.fail(f"CDG Pass crashed on unreachable code: {e}")

        # 验证: dead_stmt 不应该被 method 控制
        # 因为在 CFG 中它是不可达的，所以在 CDG 中它通常要么被忽略，要么挂在 Entry 上
        # 根据重构逻辑，PostDomTree 只计算可达节点，所以它不会出现在 CDG 边中
        controllers = self.get_controllers(dead_stmt)
        self.assertEqual(len(controllers), 0, "Dead code should not have control dependencies")

    def test_switch_case(self):
        """场景 6: Switch Case"""
        method, block, _ = self.create_method_scaffold()

        switch_node = ControlStructureNode(controlStructureType=ControlStructureType.SWITCH, code="switch(x)", label=NodeLabel.CONTROL_STRUCTURE)
        cond = IdentifierNode(name="x", code="x", label=NodeLabel.IDENTIFIER)
        body = BlockNode(code="{...}", label=NodeLabel.BLOCK)
        
        case1 = JumpTargetNode(name="case 1", code="case 1:", label=NodeLabel.JUMP_TARGET)
        stmt_a = CallNode(name="A", code="A()", label=NodeLabel.CALL)
        break1 = ControlStructureNode(controlStructureType=ControlStructureType.BREAK, code="break", label=NodeLabel.CONTROL_STRUCTURE)
        
        case2 = JumpTargetNode(name="case 2", code="case 2:", label=NodeLabel.JUMP_TARGET)
        stmt_b = CallNode(name="B", code="B()", label=NodeLabel.CALL)
        
        nodes = [switch_node, cond, body, case1, stmt_a, break1, case2, stmt_b]
        for n in nodes:
            self.graph.add_node(n)
        
        # AST 组装
        self.graph.add_ast_edge(block, switch_node)
        self.graph.add_ast_edge(switch_node, cond)
        self.graph.add_ast_edge(switch_node, body)
        
        stmts = [case1, stmt_a, break1, case2, stmt_b]
        for i, s in enumerate(stmts):
            self.graph.add_ast_edge(body, s)
            s.order = i + 1

        self.run_passes()

        self.assert_controlled_by(stmt_a, switch_node)
        self.assert_controlled_by(stmt_b, switch_node)

if __name__ == '__main__':
    unittest.main()