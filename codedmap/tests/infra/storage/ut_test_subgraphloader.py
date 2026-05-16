import unittest
from unittest.mock import MagicMock
import sys
import os
import logging

# 配置日志
logging.basicConfig(level=logging.DEBUG)

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

# Mock Neo4j 驱动对象 (通常不需要实际安装 neo4j driver 也能跑 mock 测试)
# 如果环境中没有 neo4j 包，可以创建一个 Dummy 类来规避 ImportError
try:
    from neo4j.graph import Node as Neo4jNode, Relationship as Neo4jRelationship
except ImportError:
    # Fallback for environments without neo4j driver installed
    class Neo4jNode(MagicMock): pass
    class Neo4jRelationship(MagicMock): pass

# [Refactor] 1. 修正 Import 路径以匹配 Infra/Core 架构
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.infra.storage.driver_neo4j.loader import SubgraphLoader

# [Refactor] 2. 修正 Core Schema 路径
from codedmap.core.schema.graph.nodes import MethodNode
# 假设 GenericNode 是用于表示未知类型的通用节点，如果未定义，可用 CPGNode 代替
try:
    from codedmap.core.schema.graph.base import GenericNode
except ImportError:
    from codedmap.core.schema.graph.nodes import CPGNode as GenericNode

# --- Mock Helpers (工具函数) ---

def make_mock_node(id: int, labels: list, user_props: dict = None, element_id: str = None):
    """构造模拟的 Neo4j Node 对象"""
    props = user_props.copy() if user_props else {}
    props["id"] = id
    # Neo4j 5.x 使用 element_id，4.x 使用 id
    props["element_id"] = element_id or str(id)
    
    primary_label = labels[0] if labels else "UNKNOWN"
    if "label" not in props: props["label"] = primary_label
    
    # 填充必须字段以避免 Pydantic 校验失败
    if "code" not in props: props["code"] = "<code>"
    if "order" not in props: props["order"] = 0

    # 根据 Label 填充特定字段
    if "METHOD" in labels:
        if "name" not in props: props["name"] = "test_func"
        if "fullName" not in props: props["fullName"] = "test.test_func"
        if "signature" not in props: props["signature"] = "void test()"
        if "isExternal" not in props: props["isExternal"] = False
    elif "FILE" in labels:
        if "name" not in props: props["name"] = "test.py"
    elif "BLOCK" in labels:
        if "typeFullName" not in props: props["typeFullName"] = "void"
    elif "METHOD_RETURN" in labels:
         if "typeFullName" not in props: props["typeFullName"] = "void"
         if "code" not in props: props["code"] = "RET"

    node = MagicMock(spec=Neo4jNode)
    node.id = id
    node.element_id = element_id or str(id)
    node.labels = set(labels)
    
    # 模拟 dict 行为
    node.keys.side_effect = lambda: list(props.keys())
    node.__iter__.side_effect = lambda: iter(props.keys())
    node.__getitem__.side_effect = lambda k: props[k]
    node.get.side_effect = lambda k, d=None: props.get(k, d)
    node.items.side_effect = lambda: props.items()
    return node

def make_mock_rel(id: int, start_node, end_node, type_: str, props: dict = None, element_id: str = None):
    """构造模拟的 Neo4j Relationship 对象"""
    if props is None: props = {}
    rel = MagicMock(spec=Neo4jRelationship)
    rel.id = id
    rel.element_id = element_id or f"rel_{id}"
    rel.start_node = start_node
    rel.end_node = end_node
    rel.type = type_
    
    rel.keys.side_effect = lambda: list(props.keys())
    rel.__iter__.side_effect = lambda: iter(props.keys())
    rel.__getitem__.side_effect = lambda k: props[k]
    rel.get.side_effect = lambda k, d=None: props.get(k, d)
    rel.items.side_effect = lambda: props.items()
    return rel

class TestSubgraphLoader(unittest.TestCase):

    def setUp(self):
        self.mock_client = MagicMock(spec=Neo4jClient)
        self.loader = SubgraphLoader(self.mock_client)

    def test_load_function_ast_success(self):
        """[Scenario 1] 标准场景: 加载方法及其 AST 子节点"""
        n_method = make_mock_node(10, ["METHOD"], {"name": "main"})
        n_block = make_mock_node(20, ["BLOCK"])
        r_ast = make_mock_rel(100, n_method, n_block, "AST", {"order": 1})

        # 模拟 Cypher 返回结果: 包含节点和关系的列表
        mock_record = {
            "nodes": [n_method, n_block],
            "rels_list": [[r_ast]]
        }
        self.mock_client.execute_read.return_value = [mock_record]

        cpg_graph = self.loader.load_function_ast(10)

        # 验证节点和边的数量
        self.assertEqual(len(cpg_graph.nodes), 2)
        self.assertEqual(len(cpg_graph.edges), 1)

        # 验证具体节点类型
        # CPGGraph.nodes 是 {id: Node} 字典
        method_node = cpg_graph.nodes.get(10)
        self.assertIsNotNone(method_node)
        self.assertIsInstance(method_node, MethodNode)
        self.assertEqual(method_node.name, "main")

    def test_load_not_found(self):
        """[Scenario 2] 指定 ID 不存在"""
        self.mock_client.execute_read.return_value = []
        cpg_graph = self.loader.load_function_ast(999)
        self.assertEqual(len(cpg_graph.nodes), 0)

    def test_single_node_no_children(self):
        """[Scenario 3] 只有 Method 节点，没有子节点"""
        n_method = make_mock_node(10, ["METHOD"])
        mock_record = {
            "nodes": [n_method],
            "rels_list": [[]]
        }
        self.mock_client.execute_read.return_value = [mock_record]

        cpg_graph = self.loader.load_function_ast(10)
        self.assertEqual(len(cpg_graph.nodes), 1)
        self.assertEqual(len(cpg_graph.edges), 0)

    def test_edge_deduplication(self):
        """[Scenario 4] 边去重逻辑验证"""
        n1 = make_mock_node(1, ["METHOD"])
        n2 = make_mock_node(2, ["BLOCK"])
        
        rel_unique_id = "rel_xyz"
        # 模拟完全相同的边对象（具有相同的 element_id）
        r1 = make_mock_rel(100, n1, n2, "AST", {}, element_id=rel_unique_id)
        r2 = make_mock_rel(100, n1, n2, "AST", {}, element_id=rel_unique_id)

        # 模拟 Cypher 返回了两条路径，导致边重复
        mock_record = {
            "nodes": [n1, n2],
            "rels_list": [[r1], [r2]]
        }
        self.mock_client.execute_read.return_value = [mock_record]

        cpg_graph = self.loader.load_function_ast(1)

        self.assertEqual(len(cpg_graph.nodes), 2)
        # 验证 Loader 内部实现了去重，只保留 1 条边
        self.assertEqual(len(cpg_graph.edges), 1)

    def test_data_conversion_robustness(self):
        """
        [Scenario 5] 验证未知节点的健壮性 (Robustness)
        确保未知 Label 的节点不会导致 Crash，而是降级为 GenericNode/CPGNode。
        """
        n_ok = make_mock_node(1, ["METHOD"], {"name": "ok"})
        # 这是一个未知的 Label
        n_unknown = make_mock_node(2, ["ALIEN_TECH"], {"some_prop": "val"})
        
        mock_record = {
            "nodes": [n_ok, n_unknown],
            "rels_list": []
        }
        self.mock_client.execute_read.return_value = [mock_record]

        cpg_graph = self.loader.load_function_ast(1)

        # 断言：未知节点也应该被加载
        self.assertEqual(len(cpg_graph.nodes), 2)
        
        # 验证 n_ok
        self.assertEqual(cpg_graph.nodes[1].label, "METHOD")
        
        # 验证 n_unknown 是否被安全降级加载
        unknown_node = cpg_graph.nodes[2]
        
        # 验证类型：如果是 GenericNode 或基础 CPGNode
        self.assertTrue(isinstance(unknown_node, GenericNode))
        # 验证属性保留
        self.assertEqual(unknown_node.id, 2)
        # 如果你的 GenericNode 支持保留原始 Label
        if hasattr(unknown_node, "label"):
            # 注意：如果 fallback 是 CPGNode，label 可能是 Enum UNKNOWN 或字符串
            # 这里根据具体实现调整，通常我们会尽量保留原始 label 字符串
            pass

if __name__ == '__main__':
    unittest.main()