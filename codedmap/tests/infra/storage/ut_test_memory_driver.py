import unittest
import sys
import os
from typing import List

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

# [Refactor] Updated Imports
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    MethodNode, FileNode, CallNode, BlockNode, LiteralNode
)
from codedmap.core.schema.graph.enums import EdgeType, Language, NodeLabel
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy


from codedmap.infra.storage.store import CPGStore

class TestMemoryDriver(unittest.TestCase):

    def setUp(self):
        """
        测试夹具准备：构建一个微型 CPG 图谱
        """
        # [Refactor] 1. 配置初始化
        storage_config = StorageConfig(backend="memory")
        config = CPGConfig(storage=storage_config, project_root='.')
        
        # [Refactor] 2. 使用 CPGStore 作为统一入口
        self.store = CPGStore(storage_config)

        # 3. 构造节点 (保持不变)
        self.file_node = FileNode(id=1, name="test.py", fullName="/root/test.py", label=NodeLabel.FILE, code="", language=Language.PYTHON)
        
        self.method_main = MethodNode(
            id=10, name="main", fullName="test.py:main", 
            signature="def main()", label=NodeLabel.METHOD, isExternal=False
        )
        
        self.block_node = BlockNode(id=20, label=NodeLabel.BLOCK, order=1)
        
        self.call_node = CallNode(
            id=30, name="foo", methodFullName="test.py:foo", 
            label=NodeLabel.CALL, order=2
        )
        
        self.lit_1 = LiteralNode(id=31, code="1", label=NodeLabel.LITERAL, order=1)
        self.lit_2 = LiteralNode(id=32, code="2", label=NodeLabel.LITERAL, order=2)
        
        self.method_foo = MethodNode(
            id=40, name="foo", fullName="test.py:foo", 
            signature="def foo()", label=NodeLabel.METHOD, isExternal=True
        )

        self.graph = CPGGraph()

        self.graph.add_node(self.file_node)
        self.graph.add_node(self.method_main)
        self.graph.add_node(self.block_node)
        self.graph.add_node(self.call_node)
        self.graph.add_node(self.lit_1)
        self.graph.add_node(self.lit_2)
        self.graph.add_node(self.method_foo)

        self.graph.add_edge(src=1, dst=10, type=EdgeType.AST.value, properties={})
        self.graph.add_edge(src=10, dst=20, type=EdgeType.AST.value, properties={})
        self.graph.add_edge(src=20, dst=31, type=EdgeType.AST.value, properties={})
        self.graph.add_edge(src=20, dst=32, type=EdgeType.AST.value, properties={})
        self.graph.add_edge(src=20, dst=30, type=EdgeType.AST.value, properties={})
        self.graph.add_edge(src=10, dst=30, type=EdgeType.CONTAINS.value, properties={})
        self.graph.add_edge(src=30, dst=40, type=EdgeType.CALL.value, properties={})
        
        # [Refactor] 使用 store.save
        self.store.save(self.graph)
        
        # [Refactor] 获取 query source
        self.source = self.store.query

    def tearDown(self):
        self.store.close()

    # --- 测试用例 ---

    def test_backend_initialization_and_clearing(self):
        # 验证初始状态
        self.assertEqual(self.source.all_nodes("METHOD").count(), 2)
        
        # [Refactor] 使用 store.clear_db()
        self.store.clear_db()
        
        # 验证清空后
        # 注意：clear_db 后，store.query 引用的 TraversalSource 应该能感知到数据变空
        # 或者我们需要重新获取 query 对象 (取决于实现，如果是引用 Graph 对象，则是实时的)
        # 在 MemoryFactory 实现中，Source 持有 Indexer，Indexer 持有 Graph。
        # 如果 clear 只是 graph.nodes.clear()，那么引用保持有效。
        # 如果 clear 替换了 graph 对象，则可能需要刷新。
        # 假设架构设计良好：
        self.assertEqual(self.source.all_nodes("METHOD").count(), 0)

    def test_entry_points(self):
        nodes = self.source.by_id(10).to_list()
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0].name, "main")
        methods = self.source.methods().to_list()
        self.assertEqual(len(methods), 2)

    def test_traversal_steps_out_in(self):
        blocks = self.source.by_id(10).out(EdgeType.AST.value).to_list()
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].id, 20)
        parents = self.source.by_id(20).in_(EdgeType.AST.value).to_list()
        self.assertEqual(len(parents), 1)
        self.assertEqual(parents[0].id, 10)

    def test_filtering(self):
        ext_methods = self.source.methods().filter(isExternal=True).to_list()
        self.assertEqual(len(ext_methods), 1)
        self.assertEqual(ext_methods[0].name, "foo")
        none_methods = self.source.methods().filter(name="non_existent").to_list()
        self.assertEqual(len(none_methods), 0)

    def test_modifiers_limit_order_distinct(self):
        res = self.source.methods().limit(1).to_list()
        self.assertEqual(len(res), 1)
        
        # 验证复杂链式调用
        literals = self.source.by_id(20).out(EdgeType.AST.value).filter(label="LITERAL").order_by("order").to_list()
        self.assertEqual(len(literals), 2)
        self.assertEqual(literals[0].code, "1")
        
        parents_unique = self.source.all_nodes("LITERAL").in_(EdgeType.AST.value).distinct().to_list()
        self.assertEqual(len(parents_unique), 1)

    def test_semantic_ast(self):
        # 测试我们在 TraversalInterface 中新增的 ast() 语义方法
        children = self.source.by_id(20).ast().to_list()
        self.assertTrue(len(children) >= 3)
        orders = [c.order for c in children if hasattr(c, 'order')]
        self.assertEqual(orders, sorted(orders))

    def test_semantic_call_graph(self):
        # 测试 callers() / callees()
        callees = self.source.by_id(10).callees().to_list()
        self.assertEqual(len(callees), 1)
        self.assertEqual(callees[0].id, 40)
        
        callers = self.source.by_id(40).callers().to_list()
        self.assertEqual(len(callers), 1)
        self.assertEqual(callers[0].id, 10)

    def test_method_repository(self):
        # [Refactor] 使用 store.methods
        repo = self.store.methods
        
        res = repo.find_by_name("main")
        self.assertEqual(len(res), 1)
        
        res_full = repo.find_by_full_name("test.py:foo")
        self.assertEqual(len(res_full), 1)
        self.assertEqual(res_full[0].id, 40)

    def test_immutability(self):
        t1 = self.source.methods()
        t2 = t1.filter(name="main")
        count1 = t1.count()
        self.assertEqual(count1, 2)
        count2 = t2.count()
        self.assertEqual(count2, 1)

    # --- Patch 功能测试 ---

    def test_apply_patch_features(self):
        """
        全面测试 Patch 的增删改及级联删除逻辑
        """
        # 1. 测试新增 (Additions)
        patch_add = GraphPatch()
        new_node_id = 100
        new_node = MethodNode(
            id=new_node_id, name="patched_func", fullName="test.py:patched_func", 
            label=NodeLabel.METHOD
        )
        patch_add.add_node(new_node)
        patch_add.add_edge(src=self.method_main.id, dst=new_node_id, edge_type=EdgeType.CALL)
        
        # [Refactor] 使用 store.apply_patch
        self.store.apply_patch(patch_add)
        
        # 验证新增
        self.assertEqual(self.source.by_id(new_node_id).count(), 1)
        callers = self.source.by_id(new_node_id).in_(EdgeType.CALL).to_list()
        self.assertEqual(len(callers), 1)
        self.assertEqual(callers[0].id, 10)

        # 2. 测试更新 (Updates)
        patch_update = GraphPatch()
        new_sig = "void patched_func(int x)"
        patch_update.update_node(new_node_id, signature=new_sig)
        
        self.store.apply_patch(patch_update)
        
        updated_node = self.source.by_id(new_node_id).to_list()[0]
        self.assertEqual(updated_node.signature, new_sig)

        # 3. 测试边删除 (Edge Removal)
        patch_rm_edge = GraphPatch()
        patch_rm_edge.remove_edge(src=10, dst=20, edge_type=EdgeType.AST)
        
        self.store.apply_patch(patch_rm_edge)
        
        count = self.source.by_id(10).out(EdgeType.AST).filter(id=20).count()
        self.assertEqual(count, 0)
        self.assertEqual(self.source.by_id(20).count(), 1)

        # 4. 测试节点级联删除 (Cascading Delete)
        # 这验证了 BaseGraphWriter.apply_patch 的编排逻辑在 MemoryWriter 中是否正确实现
        patch_rm_node = GraphPatch()
        patch_rm_node.remove_node(30)
        
        self.store.apply_patch(patch_rm_node)
        
        self.assertEqual(self.source.by_id(30).count(), 0)
        self.assertEqual(self.source.by_id(20).out(EdgeType.AST).filter(id=30).count(), 0)
        self.assertEqual(self.source.by_id(10).out(EdgeType.CONTAINS).filter(id=30).count(), 0)
        self.assertEqual(self.source.by_id(40).in_(EdgeType.CALL).filter(id=30).count(), 0)

    def test_patch_conflict_strategy(self):
        """
        测试 ID 冲突策略
        """
        # 1. FAIL_ON_EXIST
        patch_fail = GraphPatch(strategy=PatchStrategy.FAIL_ON_EXIST)
        duplicate_node = self.method_main.model_copy()
        duplicate_node.name = "should_fail"
        patch_fail.add_node(duplicate_node)
        
        # MemoryWriter 应该在检测到 ID 存在时抛出异常 (如果逻辑正确实现)
        # 注意：MemoryWriter.add_nodes_atomic 实现时需要检查
        with self.assertRaises(ValueError):
            self.store.apply_patch(patch_fail)
            
        current = self.source.by_id(10).to_list()[0]
        self.assertEqual(current.name, "main")

        # 2. SKIP_ON_EXIST
        patch_skip = GraphPatch(strategy=PatchStrategy.SKIP_ON_EXIST)
        patch_skip.add_node(duplicate_node) 
        
        self.store.apply_patch(patch_skip)
        
        current = self.source.by_id(10).to_list()[0]
        self.assertEqual(current.name, "main")

        # 3. OVERWRITE (默认)
        patch_overwrite = GraphPatch(strategy=PatchStrategy.OVERWRITE)
        duplicate_node.name = "overwritten"
        patch_overwrite.add_node(duplicate_node)
        
        self.store.apply_patch(patch_overwrite)
        
        current = self.source.by_id(10).to_list()[0]
        self.assertEqual(current.name, "overwritten")

    def test_fuzzy_matching(self):
        """测试 where_contains 算子"""
        # 假设存在方法 "main" 和 "foo"
        # 搜索包含 "ai" 的方法 -> 应该匹配 "main"
        results = self.store.query.methods().where_contains("name", "ai").to_list()
        
        names = [n.name for n in results]
        self.assertIn("main", names)
        self.assertNotIn("foo", names)
        
        # Repository 层的测试
        repo_results = self.store.methods.find_by_name("ai", exact_match=False)
        self.assertEqual(len(repo_results), len(results))
        self.assertEqual(repo_results[0].name, "main")

    def test_skeleton_mode(self):
        """测试 values() 投影查询 (Skeleton Mode)"""
        # 准备数据: 一个包含 heavy_data 的节点
        graph = CPGGraph()
        # 模拟一个巨大的 code 属性
        heavy_code = "int main() { ... }" * 100 
        node = MethodNode(
            id=9000, 
            name="heavy_method", 
            fullName="heavy_method", 
            signature="void heavy_method()", 
            code=heavy_code, # 我们不想查这个字段
            label=NodeLabel.METHOD
        )
        graph.add_node(node)
        self.store.save(graph)

        # 1. 使用 values() 只查询轻量属性
        # 注意：不包含 "code"
        results = list(self.store.query.methods("heavy_method").values("id", "name"))
        
        self.assertEqual(len(results), 1)
        res = results[0]
        
        # 2. 验证返回类型是 dict
        self.assertIsInstance(res, dict)
        
        # 3. 验证包含请求的字段
        self.assertEqual(res["id"], 9000)
        self.assertEqual(res["name"], "heavy_method")
        
        # 4. 验证不包含未请求的字段 (code)
        # 在 Neo4j 模式下，这意味着 code 根本没有通过网络传输
        self.assertNotIn("code", res)
        self.assertNotIn("signature", res)

if __name__ == '__main__':
    unittest.main()