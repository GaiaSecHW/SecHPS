import unittest
import sys
import os
import logging
from typing import Type

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

logging.basicConfig(level=logging.DEBUG)

# --- 1. 导入 Schema 和 枚举 ---
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType, ParseStrategy
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, BlockNode, ReturnNode, CallNode, 
    IdentifierNode, ControlStructureNode, JumpTargetNode
)

# --- 2. 导入 重构后的 Stream Pass ---
from codedmap.analysis.passes.stream.cfg import CFGPass
from codedmap.core.configs.storage import StorageConfig

class TestCFGPass(unittest.TestCase):

    def setUp(self):
        """
        [Stream Architecture Setup]
        不再需要 CPGStore，直接在内存中构建 CPGGraph。
        """
        self.config = StorageConfig(backend="memory")
        self.pass_instance = CFGPass(config=self.config)
        self.graph = CPGGraph()

    def _create_node(self, cls: Type, **kwargs):
        """
        辅助函数：创建真实节点并添加到内存图中。
        """
        # 1. 填充必填字段
        if "code" not in kwargs:
            kwargs["code"] = "<code>"
        
        model_fields = cls.model_fields
        if "name" in model_fields and "name" not in kwargs:
            kwargs["name"] = "test_name"
        if "full_name" in model_fields and "full_name" not in kwargs:
            kwargs["fullName"] = "test.Name"

        if cls == MethodReturnNode and "type_full_name" not in kwargs:
            kwargs["typeFullName"] = "void"
            
        node = cls(**kwargs)
        # 直接添加到内存图
        self.graph.add_node(node)
        return node

    def _link_ast(self, parent, child):
        """建立 AST 边 (直接操作内存图)"""
        self.graph.add_ast_edge(parent, child)

    def _assert_cfg(self, src, dst, label=None):
        """
        断言图中存在从 src 到 dst 的 CFG 边。
        """
        found = False
        # 直接遍历内存图的边列表
        for edge in self.graph.edges:
            if edge.type == EdgeType.CFG and edge.src == src.id and edge.dst == dst.id:
                if label:
                    edge_label = edge.properties.get("label")
                    if edge_label == label:
                        found = True
                else:
                    found = True
                
                if found: break
        
        self.assertTrue(found, f"Expected CFG edge {type(src).__name__}:{src.id} -> {type(dst).__name__}:{dst.id} (label={label}) not found.")

    def _assert_no_cfg(self, src, dst):
        """断言不存在 CFG 边"""
        for edge in self.graph.edges:
            if edge.type == EdgeType.CFG and edge.src == src.id and edge.dst == dst.id:
                self.fail(f"Unexpected CFG edge found: {src.id} -> {dst.id}")

    def _run_pass(self):
        """
        [New Entry Point]
        直接调用 StreamPass 的 run_on_graph 方法。
        """
        # 传入 FULL 策略，确保不跳过分析
        self.pass_instance.run_on_graph(self.graph, strategy=ParseStrategy.FULL)

    # =========================================================================
    # 测试用例 (保持原逻辑不变，因为 DSL 操作被替换成了直接 Graph 操作)
    # =========================================================================

    def test_basic_linear_flow(self):
        """测试线性流: Method -> Block -> Stmt1 -> Stmt2 -> MethodReturn"""
        method = self._create_node(MethodNode, name="main")
        block = self._create_node(BlockNode, order=1)
        ret_node = self._create_node(MethodReturnNode, order=2)
        
        stmt1 = self._create_node(CallNode, name="foo", order=1)
        stmt2 = self._create_node(CallNode, name="bar", order=2)

        self._link_ast(method, block)
        self._link_ast(method, ret_node)
        self._link_ast(block, stmt1)
        self._link_ast(block, stmt2)

        self._run_pass()

        self._assert_cfg(method, stmt1)   # Method Entry -> First Stmt
        self._assert_cfg(stmt1, stmt2)    # Stmt1 -> Stmt2
        self._assert_cfg(stmt2, ret_node) # Last Stmt -> MethodReturn

    def test_if_else_structure(self):
        """测试 IF-ELSE"""
        method = self._create_node(MethodNode)
        block = self._create_node(BlockNode)
        ret_node = self._create_node(MethodReturnNode)
        self._link_ast(method, block)
        self._link_ast(method, ret_node)

        # IF 结构
        if_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.IF, order=1)
        self._link_ast(block, if_node)

        cond = self._create_node(IdentifierNode, name="x", order=1)
        true_stmt = self._create_node(CallNode, name="true_func", order=2)
        false_stmt = self._create_node(CallNode, name="false_func", order=3)
        
        self._link_ast(if_node, cond)
        self._link_ast(if_node, true_stmt)
        self._link_ast(if_node, false_stmt)

        after_stmt = self._create_node(CallNode, name="after", order=2)
        self._link_ast(block, after_stmt)

        self._run_pass()

        self._assert_cfg(cond, true_stmt, "TRUE")
        self._assert_cfg(cond, false_stmt, "FALSE")
        self._assert_cfg(true_stmt, after_stmt)
        self._assert_cfg(false_stmt, after_stmt)

    def test_while_loop_with_break_continue(self):
        """测试 While + Break + Continue"""
        method = self._create_node(MethodNode)
        block = self._create_node(BlockNode)
        ret_node = self._create_node(MethodReturnNode)
        self._link_ast(method, block)
        self._link_ast(method, ret_node)

        while_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.WHILE, order=1)
        self._link_ast(block, while_node)

        cond = self._create_node(IdentifierNode, name="i", order=1)
        body = self._create_node(BlockNode, order=2)
        self._link_ast(while_node, cond)
        self._link_ast(while_node, body)

        stmt1 = self._create_node(CallNode, name="process", order=1)
        
        # Break
        if_break = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.IF, order=2)
        break_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.BREAK, order=2)
        cond_break = self._create_node(IdentifierNode, name="b", order=1)
        self._link_ast(if_break, cond_break)
        self._link_ast(if_break, break_node)

        # Continue
        if_cont = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.IF, order=3)
        cont_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.CONTINUE, order=2)
        cond_cont = self._create_node(IdentifierNode, name="c", order=1)
        self._link_ast(if_cont, cond_cont)
        self._link_ast(if_cont, cont_node)

        self._link_ast(body, stmt1)
        self._link_ast(body, if_break)
        self._link_ast(body, if_cont)

        after_loop = self._create_node(CallNode, name="end", order=2)
        self._link_ast(block, after_loop)

        self._run_pass()

        self._assert_cfg(cond, stmt1, "TRUE") # Enter loop
        self._assert_cfg(cond, after_loop)    # Loop exit
        self._assert_cfg(break_node, after_loop) # Break -> Exit
        self._assert_cfg(cont_node, cond) # Continue -> Condition

    def test_for_loop_full(self):
        """测试 For Loop: for(init; cond; update)"""
        method = self._create_node(MethodNode)
        block = self._create_node(BlockNode)
        ret = self._create_node(MethodReturnNode)
        self._link_ast(method, block)
        self._link_ast(method, ret)

        for_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.FOR)
        self._link_ast(block, for_node)

        # 4 children: Init, Cond, Update, Body
        init = self._create_node(CallNode, name="init", order=1)
        cond = self._create_node(IdentifierNode, name="check", order=2)
        update = self._create_node(CallNode, name="incr", order=3)
        body = self._create_node(CallNode, name="do_work", order=4)

        self._link_ast(for_node, init)
        self._link_ast(for_node, cond)
        self._link_ast(for_node, update)
        self._link_ast(for_node, body)

        self._run_pass()

        self._assert_cfg(init, cond)
        self._assert_cfg(cond, body, "TRUE")
        self._assert_cfg(body, update)
        self._assert_cfg(update, cond)
        self._assert_cfg(cond, ret)

    def test_switch_case_fallthrough(self):
        """测试 Switch Case"""
        method = self._create_node(MethodNode)
        block = self._create_node(BlockNode)
        ret = self._create_node(MethodReturnNode)
        self._link_ast(method, block)
        self._link_ast(method, ret)

        switch_node = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.SWITCH)
        self._link_ast(block, switch_node)

        cond = self._create_node(IdentifierNode, name="s_cond", order=1)
        s_body = self._create_node(BlockNode, order=2)
        self._link_ast(switch_node, cond)
        self._link_ast(switch_node, s_body)

        case1 = self._create_node(JumpTargetNode, name="case 1", order=1)
        stmt1 = self._create_node(CallNode, name="f1", order=2)
        
        case2 = self._create_node(JumpTargetNode, name="case 2", order=3)
        stmt2 = self._create_node(CallNode, name="f2", order=4)
        brk = self._create_node(ControlStructureNode, controlStructureType=ControlStructureType.BREAK, order=5)

        default_lbl = self._create_node(JumpTargetNode, name="default", order=6)
        stmt3 = self._create_node(CallNode, name="f3", order=7)

        for n in [case1, stmt1, case2, stmt2, brk, default_lbl, stmt3]:
            self._link_ast(s_body, n)

        self._run_pass()

        self._assert_cfg(cond, case1, "case 1")
        self._assert_cfg(cond, case2, "case 2")
        self._assert_cfg(cond, default_lbl, "default")

        # Fallthrough
        self._assert_cfg(stmt1, case2)
        # Break
        self._assert_cfg(brk, ret)
        self._assert_no_cfg(brk, default_lbl)
        # Default
        self._assert_cfg(default_lbl, stmt3)

if __name__ == "__main__":
    unittest.main()