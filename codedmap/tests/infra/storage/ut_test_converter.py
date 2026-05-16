import unittest
from typing import Set
from unittest.mock import MagicMock, patch
import logging
import sys
import os

sys.path.append(os.getcwd())

from codedmap.infra.storage.base import converter
from codedmap.core.schema.graph.base import CPGNode 
from codedmap.core.schema.graph.enums import EdgeType

# --- Mock Objects (Fix 1: Support Integer Indexing) ---

class MockNeo4jNode(dict):
    """
    模拟 Neo4j.graph.Node。
    """
    def __init__(self, id_val, properties, labels: Set[str]):
        super().__init__(properties)
        self.id = id_val
        self.element_id = f"e:{id_val}"
        self._labels = labels
        if 'id' not in self:
            self['id'] = id_val

    @property
    def labels(self):
        return self._labels

class MockRecord(dict):
    """
    模拟 Neo4j.Record。
    [Fix]: 同时支持 Key 访问和 Integer Index 访问。
    """
    def __init__(self, data_dict):
        super().__init__(data_dict)
        self._keys = list(data_dict.keys())
        self._values = list(data_dict.values())
    
    def values(self):
        return self._values
    
    def __getitem__(self, key):
        # 支持整数索引 data[0]
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)
    
    def __len__(self):
        return len(self._values)

# --- Test Schema ---

class TestSimpleNode(CPGNode):
    label: str = "TEST_NODE"
    name: str
    code: str

# [Fix 2]: 定义一个宽松的 UnknownNode 用于测试，防止被真实 Schema 的 Enum/Literal 校验卡住
class MockUnknownNode(CPGNode):
    # 给定一个默认值，防止因缺少 label 导致 Pydantic 校验直接失败
    # 如果 DataConverter 逻辑正确，它会将 label 覆盖为 "ALIEN_TECH"
    label: str = "DEFAULT_MOCK_LABEL"
    
    # 允许额外字段，防止 id 类型不匹配或其他元数据干扰
    model_config = {"extra": "allow"}

# --- Test Suite ---

class TestDataConverter(unittest.TestCase):
    
    def setUp(self):
        self.logger_patcher = patch('codedmap.infra.storage.base.converter.logger')
        self.mock_logger = self.logger_patcher.start()

        # 注册 TestSimpleNode
        self.original_registry = CPGNode._node_registry.copy()
        CPGNode._node_registry["TEST_NODE"] = TestSimpleNode

        self.valid_props = {
            "id": 1001,
            "name": "test_func",
            "code": "void test()",
        }
        self.node_mock = MockNeo4jNode(1, self.valid_props, {"TEST_NODE"})

    def tearDown(self):
        self.logger_patcher.stop()
        CPGNode._node_registry = self.original_registry

    def test_convert_dict_direct(self):
        data = self.valid_props.copy()
        data['label'] = "TEST_NODE"
        result = converter.DataConverter.to_pydantic(data)
        self.assertIsInstance(result, TestSimpleNode)
        self.assertEqual(result.name, "test_func")

    def test_convert_neo4j_node_valid(self):
        with patch('codedmap.infra.storage.base.converter.Neo4jNode', new=MockNeo4jNode):
            result = converter.DataConverter.to_pydantic(self.node_mock)
            self.assertIsNotNone(result)
            self.assertIsInstance(result, TestSimpleNode)
            self.assertEqual(result.id, 1001)

    def test_convert_record_single_node(self):
        """测试 Record 输入 (修复了 KeyError: 0)"""
        record_data = {"n": self.node_mock}
        record_mock = MockRecord(record_data)
        
        with patch('codedmap.infra.storage.base.converter.Record', new=MockRecord):
            with patch('codedmap.infra.storage.base.converter.Neo4jNode', new=MockNeo4jNode):
                result = converter.DataConverter.to_pydantic(record_mock)
                self.assertIsNotNone(result)
                self.assertIsInstance(result, TestSimpleNode)

    def test_validation_failure(self):
        # When target class validation fails, converter falls back to GenericNode
        invalid_props = {"id": 1002, "code": "missing_name"}
        node = MockNeo4jNode(3, invalid_props, labels={"TEST_NODE"})

        from codedmap.core.schema.graph.base import GenericNode
        with patch('codedmap.infra.storage.base.converter.Neo4jNode', new=MockNeo4jNode):
            result = converter.DataConverter.to_pydantic(node)
            self.assertIsInstance(result, GenericNode)

    def test_missing_id_fallback(self):
        props_no_id = {"name": "fallback", "code": "x"}
        node = MockNeo4jNode(4, props_no_id, labels={"TEST_NODE"})
        if 'id' in node: del node['id']
        
        with patch('codedmap.infra.storage.base.converter.Neo4jNode', new=MockNeo4jNode):
            result = converter.DataConverter.to_pydantic(node)
            self.assertIsNone(result)
            self.assertTrue(self.mock_logger.warning.called)

    def test_unknown_label_fallback(self):
        """
        [Fix]: Mock CPGNode.get_class_by_label 方法，强制其返回 MockUnknownNode。
        这确保 DataConverter 使用我们的测试类进行实例化，而不是真实的 GenericNode 或 UnknownNode。
        """
        unknown_node = MockNeo4jNode(5, {"id": 999}, labels={"ALIEN_TECH"})
        
        # 保存原始方法
        original_method = CPGNode.get_class_by_label
        
        # 定义 Side Effect: 拦截 ALIEN_TECH，其他透传
        def side_effect(label):
            if label == "ALIEN_TECH":
                return MockUnknownNode
            return original_method(label)
            
        # [Critical Fix] Patch CPGNode 上的类方法
        with patch.object(CPGNode, 'get_class_by_label', side_effect=side_effect):
            with patch('codedmap.infra.storage.base.converter.Neo4jNode', new=MockNeo4jNode):
                result = converter.DataConverter.to_pydantic(unknown_node)
                
                # 验证结果不为 None (此时有了默认值，应该能通过校验)
                self.assertIsNotNone(result, "Converter returned None, meaning validation failed.")
                
                # 验证是否是我们指定的 Mock 类
                self.assertIsInstance(result, MockUnknownNode)
                
                # [关键验证] 验证 Label 是否被 DataConverter 正确注入并覆盖了默认值
                # 如果这里失败 (等于 DEFAULT_MOCK_LABEL)，说明 DataConverter 没把 Neo4j Label 塞进 properties
                self.assertEqual(result.label, "ALIEN_TECH")

    # --- Edge Tests ---

    def test_convert_edge_valid(self):
        row_data = {
            "src": 100,
            "dst": 101,
            "type": EdgeType.DDG,
            "props": {"variable": "x"}
        }
        record = MockRecord(row_data)
        
        with patch('codedmap.infra.storage.base.converter.Record', new=MockRecord):
            edge = converter.DataConverter.to_cpg_edge(record)
            self.assertIsNotNone(edge)
            self.assertEqual(edge.src, 100)
            self.assertEqual(edge.dst, 101)

    def test_convert_edge_missing_node_id(self):
        row_data = {
            "dst": 101,
            "type": EdgeType.AST,
            "props": {}
        }
        edge = converter.DataConverter.to_cpg_edge(row_data)
        self.assertIsNone(edge)

if __name__ == '__main__':
    unittest.main()