import unittest
from unittest.mock import MagicMock, ANY
import sys
import os

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

# [Refactor] Updated Imports
from codedmap.infra.storage.driver_neo4j.traversal import Neo4jTraversalSource, Neo4jTraversal
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.core.schema.graph.nodes import MethodNode, FileNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType

class TestNeo4jTraversal(unittest.TestCase):

    def setUp(self):
        # Mock Neo4jClient
        self.mock_client = MagicMock(spec=Neo4jClient)
        
        # 初始化入口 Source
        self.source = Neo4jTraversalSource(self.mock_client)

    def _normalize_query(self, query: str) -> str:
        """辅助函数：压缩空白字符以便对比 Cypher 语句"""
        return " ".join(query.split())

    def test_basic_query_generation(self):
        """测试 1: 基础查询生成 (methods)"""
        # 1. 构建查询
        t = self.source.methods("main")
        
        # 2. 触发执行
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        # 3. 验证 Cypher
        args, _ = self.mock_client.execute_read.call_args
        query, params = args[0], args[1]
        
        normalized_query = self._normalize_query(query)
        
        # 验证基础结构
        self.assertIn("MATCH (n:METHOD)", normalized_query)
        self.assertIn("WHERE n.name = $start_name", normalized_query)
        self.assertIn("RETURN n", normalized_query)
        
        # 验证参数
        self.assertEqual(params['start_name'], "main")

    def test_chaining_steps(self):
        """测试 2: 链式调用 (out -> in_)"""
        # cpg.methods("main").out("AST").in_("REF")
        t = self.source.methods("main").out(EdgeType.AST).in_(EdgeType.REF)
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        args, _ = self.mock_client.execute_read.call_args
        query = self._normalize_query(args[0])
        
        # [Update] 验证反引号转义 (Implementation Detail)
        ast_edge = EdgeType.AST.value
        ref_edge = EdgeType.REF.value
        
        self.assertIn("MATCH (n:METHOD)", query)
        # 验证 out 步
        self.assertIn(f"MATCH (n)-[:`{ast_edge}`]->(next)", query)
        self.assertIn("WITH next as n", query)
        # 验证 in_ 步
        self.assertIn(f"MATCH (n)<-[:`{ref_edge}`]-(next)", query)

    def test_filtering_and_params(self):
        """测试 3: 属性过滤与参数化"""
        # cpg.methods().filter(name="test", isExternal=True)
        t = self.source.methods().filter(name="test", isExternal=True)
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        args, _ = self.mock_client.execute_read.call_args
        query, params = args[0], args[1]
        normalized = self._normalize_query(query)
        
        # 验证 WHERE 子句
        # 注意: params key 是动态生成的 (filter_0, filter_1)
        self.assertIn("WHERE", normalized)
        # 检查是否包含参数占位符
        self.assertTrue("n.name = $filter_" in normalized)
        self.assertTrue("n.isExternal = $filter_" in normalized)
        
        # 验证参数值是否正确传入
        self.assertIn("test", params.values())
        self.assertIn(True, params.values())

    def test_semantic_steps_callers(self):
        """测试 4: 语义算子 (callers) [Refactor Updated]"""
        # cpg.methods("a").callers()
        t = self.source.methods("a").callers()
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        # 获取生成的完整 Cypher
        args, _ = self.mock_client.execute_read.call_args
        query = self._normalize_query(args[0])
        
        # 验证逻辑：callers() 应该由两步反向查找组成
        # Step 1: 找到调用点 (Call Site)
        # MATCH (n)<-[:`CALL`]-(next)
        call_step = f"MATCH (n)<-[:`{EdgeType.CALL.value}`]-(next)"
        
        # Step 2: 找到包含该调用点的方法 (Caller Method)
        # MATCH (n)<-[:`CONTAINS`]-(next)
        contains_step = f"MATCH (n)<-[:`{EdgeType.CONTAINS.value}`]-(next)"
        
        # 断言这两个步骤都存在，且顺序正确 (简单起见检查存在性即可)
        self.assertIn(self._normalize_query(call_step), query)
        self.assertIn(self._normalize_query(contains_step), query)
        
        # 验证是否正确传递了锚点
        self.assertIn("WITH next as n", query)

    def test_immutability(self):
        """测试 5: 验证对象不可变性 (Immutability)"""
        t1 = self.source.methods()
        
        # t2 是基于 t1 的延伸
        t2 = t1.out(EdgeType.AST)
        
        # t1 不应该包含 AST 步骤
        self.assertEqual(len(t1._query_parts), 1) 
        # t2 应该包含 AST 步骤
        self.assertEqual(len(t2._query_parts), 3) # start + match + with
        
        # 验证两者是不同对象
        self.assertIsNot(t1, t2)

    def test_terminals_count_limit(self):
        """测试 6: 终结操作 (count, limit, distinct)"""
        t = self.source.methods().distinct().limit(5)
        
        # 测试 count()
        # count() 会执行一个特殊的查询，返回 [{'cnt': 42}]
        self.mock_client.execute_read.return_value = [{'cnt': 42}]
        count_val = t.count()
        
        self.assertEqual(count_val, 42)
        count_query = self._normalize_query(self.mock_client.execute_read.call_args[0][0])
        self.assertIn("RETURN count(DISTINCT n) as cnt", count_query)
        
        # 测试 to_list() (此时 limit 应该生效)
        self.mock_client.execute_read.return_value = []
        t.to_list()
        list_query = self._normalize_query(self.mock_client.execute_read.call_args[0][0])
        self.assertIn("LIMIT 5", list_query)

    def test_result_conversion(self):
        """测试 7: 结果映射 (Mock DB Return -> Pydantic)"""
        t = self.source.methods()
        
        # 模拟 Neo4j 返回的数据结构
        # DataConverter.to_pydantic 能够处理 dict
        mock_data = [{
            "id": 100, 
            "name": "main", 
            "fullName": "main", 
            "signature": "int main()", 
            "label": "METHOD" # 必须包含 label 以便 Converter 推断类型
        }]
        self.mock_client.execute_read.return_value = mock_data
        
        results = t.to_list()
        
        self.assertEqual(len(results), 1)
        node = results[0]
        # 验证类型是否正确转换
        self.assertIsInstance(node, MethodNode)
        self.assertEqual(node.name, "main")
        self.assertEqual(node.id, 100)

    def test_entry_by_id(self):
        """测试 9: 按 ID 起始遍历 (by_id)"""
        # cpg.by_id(123)
        t = self.source.by_id(123)
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        args, _ = self.mock_client.execute_read.call_args
        query, params = args[0], args[1]
        normalized = self._normalize_query(query)
        
        # 验证查询结构
        self.assertIn("MATCH (n) WHERE n.id = $start_id", normalized)
        # 验证参数
        self.assertEqual(params['start_id'], 123)

    def test_order_by(self):
        """测试 10: 排序功能 (order_by)"""
        # cpg.methods().order_by("name", desc=True)
        t = self.source.methods().order_by("name", desc=True)
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        query = self._normalize_query(self.mock_client.execute_read.call_args[0][0])
        
        # 验证排序子句
        self.assertIn("WITH n ORDER BY n.name DESC", query)

    def test_ast_shortcut(self):
        """测试 11: AST 快捷方式 (out + order_by)"""
        # cpg.by_id(1).ast()
        t = self.source.by_id(1).ast()
        
        self.mock_client.execute_read.return_value = []
        t.to_list()
        
        query = self._normalize_query(self.mock_client.execute_read.call_args[0][0])
        
        # 1. 验证 AST 边游走 (带反引号)
        ast_edge = EdgeType.AST.value
        self.assertIn(f"-[:`{ast_edge}`]->", query)
        
        # 2. 验证自动排序
        self.assertIn("ORDER BY n.order ASC", query)

if __name__ == '__main__':
    unittest.main()