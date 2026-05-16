import unittest
from typing import Type, Optional
import sys
import os
import logging

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

# 引入真实 Schema 和 SSOT 组件
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType, NodeLabel, ParseStrategy
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, MethodParameterInNode,
    BlockNode, LocalNode, IdentifierNode, CallNode, ControlStructureNode,
    TypeDeclNode, MemberNode
)

# [New] 引入拆分后的 Passes
from codedmap.analysis.passes.stream.local_ref import LocalRefPass
from codedmap.analysis.passes.batch.global_ref import GlobalRefPass

from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.cpg_config import CPGConfig

# 配置日志以便调试
logging.basicConfig(level=logging.DEBUG)

class TestRefPass(unittest.TestCase):

    def setUp(self):
        # 1. 初始化 Memory Store
        self.config = CPGConfig(
            project_root=".", 
            storage={"backend": "memory"}
        )
        self.store = CPGStore(self.config.storage)
        
        # 2. 获取底层 Graph 引用用于数据注入 (Test Cheat)
        # 在测试中我们直接操作 MemoryBackend 的内部图
        self.graph = self.store._conn.db.graph
        
        # 3. [New] 实例化两个 Pass
        # LocalRefPass 是 StreamPass，只依赖 Config
        self.local_pass = LocalRefPass(config=self.config)
        # GlobalRefPass 是 BatchPass，依赖 Store
        self.global_pass = GlobalRefPass(self.store, config=self.config)

    def tearDown(self):
        self.store.close()

    def _create_node(self, cls: Type, **kwargs):
        """辅助创建节点，确保 Label 和基础属性存在"""
        if "code" not in kwargs: kwargs["code"] = "<code>"
        
        # 自动填充 Label
        if "label" not in kwargs:
            if cls == MethodNode: kwargs["label"] = NodeLabel.METHOD
            elif cls == MethodReturnNode: kwargs["label"] = NodeLabel.METHOD_RETURN
            elif cls == MethodParameterInNode: kwargs["label"] = NodeLabel.METHOD_PARAMETER_IN
            elif cls == BlockNode: kwargs["label"] = NodeLabel.BLOCK
            elif cls == LocalNode: kwargs["label"] = NodeLabel.LOCAL
            elif cls == IdentifierNode: kwargs["label"] = NodeLabel.IDENTIFIER
            elif cls == CallNode: kwargs["label"] = NodeLabel.CALL
            elif cls == ControlStructureNode: kwargs["label"] = NodeLabel.CONTROL_STRUCTURE
            elif cls == TypeDeclNode: kwargs["label"] = NodeLabel.TYPE_DECL
            elif cls == MemberNode: kwargs["label"] = NodeLabel.MEMBER # [New] Added Member

        # 默认值填充
        if cls == MethodNode and "name" not in kwargs: kwargs["name"] = "test_func"
        if cls == MethodNode and "fullName" not in kwargs: kwargs["fullName"] = "test.test_func"
        if cls == MethodReturnNode and "type_full_name" not in kwargs: kwargs["typeFullName"] = "void"
        
        if "name" in cls.model_fields and "name" not in kwargs: kwargs["name"] = "temp"
        if "full_name" in cls.model_fields and "full_name" not in kwargs: kwargs["fullName"] = "temp"
        if "type_full_name" in cls.model_fields and "type_full_name" not in kwargs: kwargs["typeFullName"] = "ANY"
        if "order" not in kwargs: kwargs["order"] = 0

        if "controlStructureType"  not in kwargs and cls == ControlStructureNode:
            kwargs["controlStructureType"] = ControlStructureType.IF

        node = cls(**kwargs)
        self.graph.add_node(node)
        return node

    def _link_ast(self, parent, child):
        self.graph.add_ast_edge(parent, child)

    def _assert_ref(self, usage, definition):
        """断言 usage -> definition 存在 REF 边"""
        found = False
        edges = self.graph.edges
        for edge in edges:
            if edge.type == EdgeType.REF and edge.src == usage.id and edge.dst == definition.id:
                found = True
                break
        self.assertTrue(found, f"Expected REF edge: {usage.label}({usage.name}) -> {definition.label}({definition.name})")

    def _assert_no_ref(self, usage, definition):
        edges = self.graph.edges
        for edge in edges:
            if edge.type == EdgeType.REF and edge.src == usage.id and edge.dst == definition.id:
                self.fail(f"Unexpected REF edge found: {usage.name} -> {definition.name}")

    def _run_pass(self):
        """
        [关键重构] 模拟流水线执行顺序：
        1. Local Pass (Stream Mode) -> 内存中构建局部边
        2. Rebuild Indices -> 确保 Global Pass 能查到局部构建的数据
        3. Global Pass (Batch Mode) -> 查库构建全局边
        """
        # Step 1: 运行 LocalRefPass (模拟 Worker 行为)
        # 直接在 self.graph (内存图) 上运行
        self.local_pass.run_on_graph(self.graph, strategy=ParseStrategy.FULL)
        
        # Step 2: 刷新索引
        # 因为 GlobalRefPass 依赖 self.query (TraversalSource)，
        # 而 MemoryBackend 的 TraversalSource 依赖索引，
        # LocalRefPass 可能修改了图但没刷新索引，所以这里手动刷新一下。
        self.store._conn.db._rebuild_index()
        
        # Step 3: 运行 GlobalRefPass (模拟 Main Process 行为)
        self.global_pass.run()
        
        # Step 4: 再次刷新 (如果 GlobalPass 加了边，虽然 MemoryBackend save 会自动刷新，但为了保险)
        self.store._conn.db._rebuild_index()

    # =========================================================================
    # Test Cases (保持原样，逻辑通用)
    # =========================================================================

    def test_parameter_resolution(self):
        """测试参数引用 (Local Ref)"""
        method = self._create_node(MethodNode, name="foo")
        param_x = self._create_node(MethodParameterInNode, name="x", order=1)
        self._link_ast(method, param_x)
        
        block = self._create_node(BlockNode)
        self._link_ast(method, block)
        
        ident_x = self._create_node(IdentifierNode, name="x")
        ret = self._create_node(CallNode, name="<operator>.return")
        self._link_ast(block, ret)
        self._link_ast(ret, ident_x)

        self._run_pass()

        self._assert_ref(ident_x, param_x)

    def test_local_variable_and_shadowing(self):
        """测试变量遮蔽 (Local Ref)"""
        method = self._create_node(MethodNode, name="shadow_test")
        block_outer = self._create_node(BlockNode)
        self._link_ast(method, block_outer)

        # Outer Local x
        local1 = self._create_node(LocalNode, name="x", order=1)
        self._link_ast(block_outer, local1)

        # Outer Usage x
        use1 = self._create_node(IdentifierNode, name="x", order=2)
        self._link_ast(block_outer, use1)

        # Inner Block
        block_inner = self._create_node(BlockNode, order=3)
        self._link_ast(block_outer, block_inner)

        # Inner Local x
        local2 = self._create_node(LocalNode, name="x", order=1)
        self._link_ast(block_inner, local2)

        # Inner Usage x
        use2 = self._create_node(IdentifierNode, name="x", order=2)
        self._link_ast(block_inner, use2)

        # Outer Usage x (after block)
        use3 = self._create_node(IdentifierNode, name="x", order=4)
        self._link_ast(block_outer, use3)

        self._run_pass()

        self._assert_ref(use1, local1)
        self._assert_ref(use2, local2)
        self._assert_no_ref(use2, local1)
        self._assert_ref(use3, local1)

    def test_for_loop_scope(self):
        """测试 For 循环作用域 (Local Ref)"""
        method = self._create_node(MethodNode, name="loop_test")
        block = self._create_node(BlockNode)
        self._link_ast(method, block)

        for_node = self._create_node(ControlStructureNode, control_structure_type=ControlStructureType.FOR)
        self._link_ast(block, for_node)

        local_i = self._create_node(LocalNode, name="i", order=1)
        self._link_ast(for_node, local_i) 

        body = self._create_node(BlockNode, order=4)
        self._link_ast(for_node, body)
        
        use_in_loop = self._create_node(IdentifierNode, name="i")
        self._link_ast(body, use_in_loop)

        use_outside = self._create_node(IdentifierNode, name="i", order=2)
        self._link_ast(block, use_outside)

        self._run_pass()

        self._assert_ref(use_in_loop, local_i)
        self._assert_no_ref(use_outside, local_i)

    def test_undefined_reference(self):
        """测试未定义的变量"""
        method = self._create_node(MethodNode, name="undef_test")
        block = self._create_node(BlockNode)
        self._link_ast(method, block)

        use_global = self._create_node(IdentifierNode, name="global_var")
        self._link_ast(block, use_global)

        self._run_pass()

        found = False
        for edge in self.graph.edges:
            if edge.src == use_global.id and edge.type == EdgeType.REF:
                found = True
        self.assertFalse(found)

    def test_global_scope(self):
        """测试全局作用域引用 (Global Ref)"""
        # 1. 定义全局函数 (Target)
        global_method = self._create_node(MethodNode, name="global_func", full_name="global_func")
        
        # 2. 定义调用函数 (Source)
        client_method = self._create_node(MethodNode, name="client")
        block = self._create_node(BlockNode)
        self._link_ast(client_method, block)
        
        # 3. 使用全局引用
        use_global = self._create_node(IdentifierNode, name="global_func")
        self._link_ast(block, use_global)
        
        # 运行流水线
        self._run_pass()
        
        # 断言: use_global 应该通过 GlobalRefPass 连接到 global_method
        self._assert_ref(use_global, global_method)

    def test_global_member_ref(self):
        """[新增] 测试全局变量(Member)引用"""
        # 模拟 C 语言中的全局变量: int g_val;
        global_var = self._create_node(MemberNode, name="g_val", typeFullName="int")
        
        client_method = self._create_node(MethodNode, name="user_func")
        block = self._create_node(BlockNode)
        self._link_ast(client_method, block)
        
        use_g = self._create_node(IdentifierNode, name="g_val")
        self._link_ast(block, use_g)
        
        self._run_pass()
        
        self._assert_ref(use_g, global_var)

if __name__ == "__main__":
    unittest.main()