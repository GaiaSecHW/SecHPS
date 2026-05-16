import unittest
import logging
import sys
import os
from typing import List

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

# [Refactor] 1. 修正 Import 路径以匹配新架构 (Core/Infra)
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    FileNode, MethodNode, BlockNode, CallNode, LiteralNode
)
from codedmap.core.schema.graph.enums import EdgeType, DispatchType, Language, NodeLabel
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy

# 引用重构后的 Facade
from codedmap.infra.storage.store import CPGStore

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
# 屏蔽 Neo4j 驱动的繁琐日志
logging.getLogger('neo4j').setLevel(logging.WARNING)

class TestNeo4jStore(unittest.TestCase):
    
    # [Config] 请确保 Docker 中 Neo4j 已启动
    # docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/hello123456 neo4j:5.15
    URI = "neo4j://172.23.0.1:7689" # 注意: Bolt 协议端口通常是 7687
    AUTH = ("neo4j", "hello123456")

    def setUp(self):
        """每个测试用例执行前运行"""
        # 1. 构建配置
        storage_config = StorageConfig(
            uri=self.URI, 
            username=self.AUTH[0], 
            password=self.AUTH[1], 
            backend="neo4j",
            batch_size=100  # 测试环境下调小 batch 以触发 flush
        )
        config = CPGConfig(project_root="dummy/root", storage=storage_config)
        
        try:
            self.store = CPGStore(storage_config)
            # 2. 环境清理与初始化
            # clear_db 会删除所有节点
            self.store.clear_db() 
            # init_db 会创建必要的 Constraint (如 id 唯一性)，这对于 test_07 至关重要
            self.store.init_db()
        except Exception as e:
            self.skipTest(f"Could not connect to Neo4j, skipping tests. Error: {e}")

    def tearDown(self):
        if hasattr(self, 'store'):
            self.store.close()

    def _create_dummy_graph(self) -> CPGGraph:
        """辅助函数：构建一个简单的 CPG 图"""
        graph = CPGGraph()
        
        file_node = FileNode(id=1, name="test.c", fullName="/src/test.c", code="int main() { ... }", label=NodeLabel.FILE, language=Language.C)
        graph.add_node(file_node)

        # Method
        method_node = MethodNode(
            id=10, 
            name="main", 
            fullName="main", 
            signature="int main()", 
            code="int main() { return 0; }",
            isExternal=False,
            label=NodeLabel.METHOD
        )
        graph.add_node(method_node)

        # Block
        block_node = BlockNode(id=20, code="{ return 0; }", label=NodeLabel.BLOCK)
        graph.add_node(block_node)

        # Call
        call_node = CallNode(
            id=30,
            name="printf", 
            methodFullName="stdio.printf", 
            code='printf("hello")',
            dispatchType=DispatchType.STATIC_DISPATCH,
            label=NodeLabel.CALL
        )
        graph.add_node(call_node)
        
        # Literal
        lit_node = LiteralNode(id=31, code='"hello"', typeFullName="char*", label=NodeLabel.LITERAL)
        graph.add_node(lit_node)

        # Edges
        graph.add_edge(src=1, dst=10, type=EdgeType.AST)
        graph.add_edge(src=1, dst=10, type=EdgeType.CONTAINS)
        graph.add_edge(src=10, dst=20, type=EdgeType.AST)
        graph.add_edge(src=20, dst=30, type=EdgeType.AST)
        graph.add_edge(src=30, dst=31, type=EdgeType.ARGUMENT, properties={"argumentIndex": 1})
        graph.add_edge(src=30, dst=31, type=EdgeType.AST)

        return graph

    def test_01_connectivity_and_schema(self):
        logger.info("Running Test 01: Connectivity & Schema")
        # 测试原生 Cypher 执行能力
        res = self.store.run_cypher("RETURN 1 as val")
        self.assertEqual(res[0]['val'], 1)
        
        # 验证 Schema 是否已初始化 (Constraint 存在)
        # Neo4j 5.x 语法: SHOW CONSTRAINTS
        constraints = self.store.run_cypher("SHOW CONSTRAINTS YIELD name")
        self.assertTrue(len(constraints) > 0, "Schema constraints should be initialized")

    def test_02_write_and_read_graph(self):
        logger.info("Running Test 02: Write & Read")
        graph = self._create_dummy_graph()
        node_count = len(graph.nodes)
        edge_count = len(graph.edges)
        
        self.store.save(graph)
        
        # 验证节点数
        total_nodes = self.store.run_cypher("MATCH (n) RETURN count(n) as c")[0]['c']
        total_edges = self.store.run_cypher("MATCH ()-[r]->() RETURN count(r) as c")[0]['c']

        self.assertEqual(total_nodes, node_count, f"Node count mismatch: expected {node_count}, got {total_nodes}")
        self.assertEqual(total_edges, edge_count, f"Edge count mismatch: expected {edge_count}, got {total_edges}")

    def test_03_repositories(self):
        logger.info("Running Test 03: Repositories")
        graph = self._create_dummy_graph()
        self.store.save(graph)

        # 测试 Method Repo
        methods = self.store.methods.find_by_name("main")
        self.assertEqual(len(methods), 1)
        self.assertEqual(methods[0].name, "main")
        self.assertEqual(methods[0].id, 10)

        # 测试 File Repo
        files = self.store.files.find_all()
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "test.c")

    def test_04_traversal(self):
        logger.info("Running Test 04: Traversal")
        graph = self._create_dummy_graph()
        self.store.save(graph)
        
        # 验证语义快捷方式 .ast()
        main_methods = self.store.methods.find_by_name("main")
        main_method_id = main_methods[0].id

        children = self.store.query.by_id(main_method_id).ast().to_list()
        self.assertTrue(len(children) > 0)
        self.assertEqual(children[0].label, NodeLabel.BLOCK) # main -> block

        # 验证 .file() 反向查找
        file_node = self.store.query.by_id(main_method_id).file().to_list()
        self.assertEqual(len(file_node), 1)
        self.assertEqual(file_node[0].name, "test.c")

    def test_05_batch_writing_stress(self):
        logger.info("Running Test 05: Batch Stress")
        graph = CPGGraph()
        
        # 插入超过 batch_size 的数据量 (setup 中设为 100)
        count = 500 
        start_id = 10000
        for i in range(count):
            # 必须指定 ID，否则无法在 Neo4j 中 Merge
            n = LiteralNode(id=start_id + i, code=f"{i}", typeFullName="int", label=NodeLabel.LITERAL)
            graph.add_node(n)
            
        self.store.save(graph)
            
        total = self.store.run_cypher(f"MATCH (n:LITERAL) WHERE n.id >= {start_id} RETURN count(n) as c")[0]['c']
        self.assertEqual(total, count)

    # --- [New] Patch 测试 ---

    def test_06_apply_patch(self):
        """
        验证 Neo4jWriter 的原子操作
        """
        logger.info("Running Test 06: Apply Patch")
        
        # 1. 准备基础数据
        graph = self._create_dummy_graph()
        self.store.save(graph)
        
        # 2. 构建 Patch：新增节点和边
        patch_add = GraphPatch()
        new_method = MethodNode(
            id=100, name="patched_func", fullName="patched_func", 
            signature="void patched_func()", label=NodeLabel.METHOD
        )
        patch_add.add_node(new_method)
        # Call(30) -> Method(100)
        patch_add.add_edge(src=30, dst=100, edge_type=EdgeType.CALL) 
        
        self.store.apply_patch(patch_add)
        
        # 验证新增
        res_node = self.store.run_cypher("MATCH (n:METHOD {id: 100}) RETURN n")
        self.assertEqual(len(res_node), 1)
        self.assertEqual(res_node[0]['n']['name'], "patched_func")
        
        res_edge = self.store.run_cypher("MATCH (c:CALL {id: 30})-[r:CALL]->(m:METHOD {id: 100}) RETURN r")
        self.assertEqual(len(res_edge), 1)

        # 3. 构建 Patch：更新属性 & 删除边
        patch_update = GraphPatch()
        # 更新
        patch_update.update_node(100, name="patched_func_v2", isExternal=True)
        # 删除刚刚添加的边
        patch_update.remove_edge(src=30, dst=100, edge_type=EdgeType.CALL)
        
        self.store.apply_patch(patch_update)
        
        # 验证更新
        res_update = self.store.run_cypher("MATCH (n:METHOD {id: 100}) RETURN n.name as name, n.isExternal as ext")
        self.assertEqual(res_update[0]['name'], "patched_func_v2")
        self.assertTrue(res_update[0]['ext'])
        
        # 验证边删除
        res_del_edge = self.store.run_cypher("MATCH (c:CALL {id: 30})-[r:CALL]->(m:METHOD {id: 100}) RETURN r")
        self.assertEqual(len(res_del_edge), 0)

        # 4. 构建 Patch：节点级联删除
        # 删除 Block(20)，应该自动删除相关的 AST 边
        # Neo4j 的 DETACH DELETE n 会自动删除所有与 n 关联的边
        patch_del_node = GraphPatch()
        patch_del_node.remove_node(20)
        
        self.store.apply_patch(patch_del_node)
        
        # 验证节点消失
        res_del_node = self.store.run_cypher("MATCH (n {id: 20}) RETURN n")
        self.assertEqual(len(res_del_node), 0)
        
        # 验证边消失 (无论进出)
        res_del_rel = self.store.run_cypher("MATCH (n {id: 20})-[r]-() RETURN r")
        self.assertEqual(len(res_del_rel), 0)

    def test_07_patch_strategies(self):
        """
        验证冲突处理策略 (Requires init_db() to set unique constraints)
        """
        logger.info("Running Test 07: Patch Strategies")
        graph = CPGGraph()
        # 初始节点
        node = LiteralNode(id=999, code="original", label=NodeLabel.LITERAL)
        graph.add_node(node)
        self.store.save(graph)

        # 1. Test FAIL_ON_EXIST
        # 尝试插入已存在的 ID 999
        patch_fail = GraphPatch(strategy=PatchStrategy.FAIL_ON_EXIST)
        dup_node = LiteralNode(id=999, code="duplicate", label=NodeLabel.LITERAL)
        patch_fail.add_node(dup_node)

        # 预期抛出异常 (Neo4j Constraint Violation)
        # 注意: Neo4jWriter._add_nodes_atomic 使用 CREATE 语句
        # 如果 Schema 中有 ID 唯一约束，CREATE 会报错
        with self.assertRaises(Exception): # 捕获 neo4j.exceptions.ClientError
            self.store.apply_patch(patch_fail)
            
        # 验证未被修改
        res = self.store.run_cypher("MATCH (n {id: 999}) RETURN n.code as code")[0]['code']
        self.assertEqual(res, "original")

        # 2. Test SKIP_ON_EXIST
        # 使用 MERGE ... ON CREATE SET ...
        patch_skip = GraphPatch(strategy=PatchStrategy.SKIP_ON_EXIST)
        dup_node.code = "skipped_value"
        patch_skip.add_node(dup_node)
        
        self.store.apply_patch(patch_skip)
        
        # 验证未被修改
        res = self.store.run_cypher("MATCH (n {id: 999}) RETURN n.code as code")[0]['code']
        self.assertEqual(res, "original")

        # 3. Test OVERWRITE
        # 使用 MERGE ... SET ...
        patch_overwrite = GraphPatch(strategy=PatchStrategy.OVERWRITE)
        dup_node.code = "overwritten_value"
        patch_overwrite.add_node(dup_node)
        
        self.store.apply_patch(patch_overwrite)
        
        # 验证已被修改
        res = self.store.run_cypher("MATCH (n {id: 999}) RETURN n.code as code")[0]['code']
        self.assertEqual(res, "overwritten_value")

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
        results = self.store.query.methods("heavy_method").values("id", "name")
        
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