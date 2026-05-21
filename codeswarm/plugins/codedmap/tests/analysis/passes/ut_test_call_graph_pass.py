import unittest
import sys
import os
import logging

logging.basicConfig(level=logging.DEBUG)

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode, CallNode, FileNode
from codedmap.core.schema.graph.enums import EdgeType, DispatchType, Language, NodeLabel
from codedmap.analysis.passes.batch.call_graph import CallGraphPass
from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.cpg_config import CPGConfig

class TestCallGraphPass(unittest.TestCase):

    def setUp(self):
        """
        [SSOT Setup]
        不再直接实例化 CPGGraph 传给 Pass，而是初始化 Memory 模式的 Store。
        """
        # 1. 配置 Memory Backend
        self.config = CPGConfig(
            project_root=".", 
            storage={"backend": "memory"}
        )
        self.store = CPGStore(self.config.storage)
        
        # 2. 获取底层的 Graph 对象用于测试数据注入 (Cheat Sheet)
        # 在 Memory 模式下，store._conn.db.graph 是真正的数据容器
        self.graph = self.store._conn.db.graph
        
        # 3. 实例化 Pass (传入 Store)
        self.pass_instance = CallGraphPass(self.store, config=self.config)

    def tearDown(self):
        self.store.close()

    # --- 数据构建辅助方法 (必须符合 AST 规范) ---

    def _create_file(self, name):
        """创建文件节点"""
        node = FileNode(name=name, fullName=f"/src/{name}", code="", language=Language.C)
        self.graph.add_node(node)
        return node

    def _create_method(self, name, full_name=None, signature=None, file_node=None):
        """创建 MethodNode 并挂载到文件 (AST)"""
        if not full_name: full_name = name
        node = MethodNode(
            name=name, 
            fullName=full_name, 
            signature=signature or "",
            code=name,
            label=NodeLabel.METHOD
        )
        self.graph.add_node(node)
        
        # [Fix] 建立 AST 边，确保 DSL .file() 能工作
        if file_node:
            self.graph.add_ast_edge(file_node, node)
            self.graph.add_edge(file_node, node, EdgeType.CONTAINS)
            
        return node

    def _create_call(self, name, method_full_name=None, signature=None, dispatch_type=DispatchType.STATIC_DISPATCH, parent_method=None):
        """创建 CallNode 并挂载到 Method (AST)"""
        node = CallNode(
            name=name,
            methodFullName=method_full_name,
            signature=signature,
            dispatch_type=dispatch_type,
            code=f"{name}(...)",
            label=NodeLabel.CALL
        )
        self.graph.add_node(node)
        
        # [Fix] 建立 AST 边，确保 Call 属于某个 Method
        if parent_method:
            self.graph.add_ast_edge(parent_method, node)
            self.graph.add_edge(parent_method, node, EdgeType.CONTAINS)
            
        return node

    # --- 断言辅助方法 (基于 Store 查询) ---

    def _assert_call_edge(self, call_node, method_node):
        """断言存在 CALL 边"""
        # 使用 Store 查询，模拟真实验证
        # Match (c)-[:CALL]->(m)
        targets = self.store.query.by_id(call_node.id).out(EdgeType.CALL).to_list()
        
        found = any(t.id == method_node.id for t in targets)
        self.assertTrue(found, f"Expected CALL edge: {call_node.name} -> {method_node.name}")

    def _assert_phantom_created(self, call_node, expected_name):
        """断言创建了 Phantom Node"""
        targets = self.store.query.by_id(call_node.id).out(EdgeType.CALL).to_list()
        
        self.assertEqual(len(targets), 1, "Should link to exactly one target")
        phantom = targets[0]
        
        self.assertTrue(phantom.is_external, "Phantom node should be external")
        self.assertEqual(phantom.name, expected_name)
        self.assertTrue(phantom.full_name.startswith("<external>"), "Fullname should start with <external>")

    # =========================================================================
    # Test Cases
    # =========================================================================

    def test_exact_fullname_match(self):
        """策略 1: FullName 精确匹配"""
        # 1. 准备数据
        # 必须先保存到 Store (Memory 模式下直接改 self.graph 即可，因为是同一个引用)
        m_node = self._create_method(name="foo", full_name="pkg.foo")
        c_node = self._create_call(name="foo", method_full_name="pkg.foo")
        
        # 对于 MemoryBackend，需要手动触发一次索引重建，因为我们要用 DSL 查询
        # 在真实的 ProjectBuilder 流程中，save() 会触发重建。这里我们手动模拟。
        self.store._conn.db._rebuild_index()

        # 2. 运行 Pass
        self.pass_instance.run()
        
        # 3. 验证
        self._assert_call_edge(c_node, m_node)

    def test_fuzzy_name_match(self):
        """策略 3: Name 模糊匹配"""
        m_node = self._create_method(name="bar", full_name="a.b.bar")
        c_node = self._create_call(name="bar", method_full_name="ANY")
        
        self.store._conn.db._rebuild_index()
        self.pass_instance.run()
        
        self._assert_call_edge(c_node, m_node)
        
        # 验证属性回写 (MethodFullName 是否被更新)
        # 注意：Pass 更新了属性，如果是 MemoryBackend，对象属性应该变了
        # 如果是 Neo4j，需要重新 fetch。这里 Memory 模式直接查对象。
        updated_call = self.store.files.get_by_id(c_node.id) # GenericRepo
        # 或者直接用 self.graph (因为是同一个对象引用)
        self.assertEqual(c_node.method_full_name, m_node.full_name)

    def test_signature_overloading(self):
        """策略 2: 签名重载"""
        m1 = self._create_method(name="func", full_name="func_int", signature="(int)")
        m2 = self._create_method(name="func", full_name="func_char", signature="(char)")
        
        c1 = self._create_call(name="func", signature="(int)")
        c2 = self._create_call(name="func", signature="(char)")
        
        self.store._conn.db._rebuild_index()
        self.pass_instance.run()
        
        self._assert_call_edge(c1, m1)
        self._assert_call_edge(c2, m2)

    def test_scope_ambiguity_resolution(self):
        """策略 4: 文件作用域消歧 [重点修复]"""
        # 构建完整的 AST 树: File -> Method -> Call
        
        # File A
        f_a = self._create_file("a.c")
        m_a = self._create_method(name="helper", full_name="a:helper", file_node=f_a)
        # Call in A calls "helper"
        # 必须有个父方法包裹这个 Call，否则它不属于任何文件
        main_a = self._create_method(name="main_a", full_name="a:main", file_node=f_a)
        c_a = self._create_call(name="helper", parent_method=main_a)
        
        # File B
        f_b = self._create_file("b.c")
        m_b = self._create_method(name="helper", full_name="b:helper", file_node=f_b)
        main_b = self._create_method(name="main_b", full_name="b:main", file_node=f_b)
        c_b = self._create_call(name="helper", parent_method=main_b)
        
        self.store._conn.db._rebuild_index()
        self.pass_instance.run()
        
        # 验证: A 中的调用连向 A 中的定义
        self._assert_call_edge(c_a, m_a)
        self._assert_call_edge(c_b, m_b)

    def test_external_phantom_creation(self):
        """测试 Phantom 节点"""
        # 创建一个孤立的 Call (没有 Method 定义)
        # 注意：为了让 DSL 查到它，它至少要在 graph 里
        c_printf = self._create_call(name="printf")
        
        self.store._conn.db._rebuild_index()
        self.pass_instance.run()
        
        self._assert_phantom_created(c_printf, "printf")
        
        # 再次运行，验证是否复用 (Idempotency)
        # MemoryBackend 的 save 逻辑是 merge，所以这会模拟增量构建
        c_printf_2 = self._create_call(name="printf")
        
        # 必须手动刷新索引，因为增加了 c_printf_2
        self.store._conn.db._rebuild_index()
        self.pass_instance.run()
        
        # 验证全图中只有一个 printf 方法节点
        methods = self.store.query.methods("printf").to_list()
        self.assertEqual(len(methods), 1)

if __name__ == "__main__":
    unittest.main()