import unittest
import json
import tempfile
import os
import shutil
import logging
from typing import List

# 调整 path 以便导入模块
import sys
sys.path.append(os.getcwd())

from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode, FileNode
from codedmap.core.schema.graph.enums import EdgeType, Language, NodeLabel
from codedmap.frontend.integrations.dynamic.trace_loader import DynamicTraceIntegration
from codedmap.core.schema.overlays.trace import (
    EDGE_EXECUTED_IN, EDGE_NEXT_EVENT, EDGE_MAPPED_TO, EDGE_HAS_VALUE
)

# 配置日志以便观察测试输出
logging.basicConfig(level=logging.INFO)

class TestDynamicTraceIntegration(unittest.TestCase):

    def setUp(self):
        # 1. 初始化内存存储
        self.config = CPGConfig(project_root=".", storage={"backend": "memory"})
        self.store = CPGStore(self.config.storage)
        
        # 2. 初始化插件
        self.plugin = DynamicTraceIntegration()
        
        # 3. 创建临时目录用于存放 trace json
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        self.store.close()
        shutil.rmtree(self.test_dir)

    def _create_trace_file(self, filename: str, content: dict) -> str:
        """Helper: 创建临时 JSON 文件"""
        path = os.path.join(self.test_dir, filename)
        with open(path, 'w') as f:
            json.dump(content, f)
        return path

    def test_basic_trace_loading(self):
        """
        [Scenario 1] 基础流程测试: Session, Event, Value, NextEvent 链表构建
        """
        trace_data = {
            "session_id": "sess_001",
            "events": [
                {
                    "seq": 1, "file": "main.c", "line": 10, 
                    "values": [{"name": "a", "value": "100"}]
                },
                {
                    "seq": 2, "file": "main.c", "line": 11,
                    "values": [{"name": "b", "value": "200"}]
                }
            ]
        }
        path = self._create_trace_file("basic.json", trace_data)

        # 运行集成
        delta = self.plugin.run(self.store, path, create_anchors=False)
        
        # 验证 Session
        sessions = [n for n in delta.nodes.values() if n.label == "TRACE_SESSION"]
        self.assertEqual(len(sessions), 1, "Should have 1 session in delta")
        self.assertEqual(sessions[0].session_id, "sess_001")
        
        # 验证 Events
        events = [n for n in delta.nodes.values() if n.label == "TRACE_EVENT"]
        self.assertEqual(len(events), 2)
        
        self.store.save(delta)

        # 验证 NextEvent 链表 (Event1 -> Event2)
        # 找到 seq=1 和 seq=2 的节点 ID
        evt1 = next(e for e in events if e.seq_id == 1)
        evt2 = next(e for e in events if e.seq_id == 2)
        
        # 检查是否有一条 NEXT_EVENT 边从 evt1 到 evt2
        has_next_edge = False
        for edge in delta.edges:
            if edge.src == evt1.id and edge.dst == evt2.id and edge.type == EDGE_NEXT_EVENT:
                has_next_edge = True
                break
        self.assertTrue(has_next_edge, "Should establish NEXT_EVENT edge between sequential events")

        # 验证 RuntimeValue
        values = [n for n in delta.nodes.values() if n.label == "RUNTIME_VALUE"]
        self.assertEqual(len(values), 2) # a=100, b=200

    def test_mapping_to_existing_static_nodes(self):
        """
        [Scenario 2] 静态映射测试: 数据库中已存在静态节点，Trace 应该自动连接
        """
        # 1. 预先在 Store 中“造”一些静态节点 (模拟 ProjectBuilder 的工作)
        # 假设 main.c 的第 42 行有一个 func_vuln 方法
        static_graph = CPGGraph()
        file_node = FileNode(id=1001, name="vuln.c", fullName="/path/to/vuln.c", label=NodeLabel.FILE, language=Language.C)
        method_node = MethodNode(
            id=1002, name="func_vuln", fullName="func_vuln", label=NodeLabel.METHOD, 
            lineNumber=42, filename="vuln.c"
        )
        # 必须建立 AST 关系，Resolver 才能通过文件名找到节点 (通常 Resolver 依赖 AST 或 Index)
        # 这里为了简单，我们假设 Resolver 实现会去查属性。
        # 如果 CodeLocationResolver 依赖 AST 边，这里需要 static_graph.add_edge(file_node, method_node, AST)
        static_graph.add_node(file_node)
        static_graph.add_node(method_node)
        
        static_graph.add_edge(file_node, method_node, EdgeType.AST)
        
        self.store.save(static_graph)
        
        # 2. 准备 Trace 数据，指向 vuln.c:42
        trace_data = {
            "session_id": "sess_map",
            "events": [
                {"seq": 1, "file": "vuln.c", "line": 42, "func": "func_vuln"}
            ]
        }
        path = self._create_trace_file("map.json", trace_data)

        # 3. 运行集成
        delta = self.plugin.run(self.store, path)
        
        # 4. 验证 MAPPED_TO 边
        # 应该有一条边从 Event 连接到 MethodNode(id=1002)
        mapped_edge_found = False
        for edge in delta.edges:
            # 检查是否有边指向 ID 1002
            if edge.dst == 1002 and (edge.type == EDGE_MAPPED_TO or edge.type == "MAPPED_TO"):
                mapped_edge_found = True
                break
        
        self.assertTrue(mapped_edge_found, "Event should be mapped to existing static MethodNode")

    def test_lazy_anchors_creation(self):
        """
        [Scenario 3] 懒加载锚点测试: 静态节点缺失，create_anchors=True
        """
        # 1. Store 是空的，没有任何静态节点
        trace_data = {
            "events": [
                {"seq": 1, "file": "unknown.c", "line": 99}
            ]
        }
        path = self._create_trace_file("anchor.json", trace_data)

        # 2. 开启 create_anchors
        delta = self.plugin.run(self.store, path, create_anchors=True)
        
        # 3. 验证是否自动创建了 File Anchor
        file_anchors = [n for n in delta.nodes.values() if n.label == NodeLabel.FILE]
        self.assertEqual(len(file_anchors), 1)
        self.assertEqual(file_anchors[0].name, "unknown.c")
        
        anchor_id = file_anchors[0].id
        
        # 4. 验证 Event 是否连接到了这个 Anchor
        event = [n for n in delta.nodes.values() if n.label == "TRACE_EVENT"][0]
        
        edge_exists = any(
            e for e in delta.edges 
            if e.src == event.id and e.dst == anchor_id and e.type == EDGE_MAPPED_TO
        )
        self.assertTrue(edge_exists, "Event should be mapped to the auto-created File Anchor")

    def test_lazy_anchors_id_determinism(self):
        """
        [Scenario 4] 验证 Anchor ID 的确定性 (跨运行一致性)
        """
        trace_data = { "events": [{"seq": 1, "file": "shared.c", "line": 1}] }
        path = self._create_trace_file("shared.json", trace_data)
        
        # 第一次运行
        delta1 = self.plugin.run(self.store, path, create_anchors=True)
        anchor1 = [n for n in delta1.nodes.values() if n.label == NodeLabel.FILE][0]
        
        # 模拟第二次运行 (即便是新建一个 plugin 实例)
        plugin2 = DynamicTraceIntegration()
        # 清空 store 模拟全新环境，或者只看生成的 delta ID
        delta2 = plugin2.run(self.store, path, create_anchors=True)
        anchor2 = [n for n in delta2.nodes.values() if n.label == NodeLabel.FILE][0]
        
        # ID 必须完全一致
        self.assertEqual(anchor1.id, anchor2.id, "Anchor IDs for same file must be deterministic")

    def test_create_anchors_disabled(self):
        """
        [Scenario 5] 验证 create_anchors=False 时不创建节点
        """
        trace_data = { "events": [{"seq": 1, "file": "missing.c", "line": 1}] }
        path = self._create_trace_file("missing.json", trace_data)
        
        delta = self.plugin.run(self.store, path, create_anchors=False)
        
        # 不应有 File 节点
        files = [n for n in delta.nodes.values() if n.label == NodeLabel.FILE]
        self.assertEqual(len(files), 0)
        
        # Event 节点存在，但没有 MAPPED_TO 边
        has_map_edge = any(e for e in delta.edges if e.type == EDGE_MAPPED_TO)
        self.assertFalse(has_map_edge)

    def test_invalid_file_handling(self):
        """
        [Scenario 6] 异常处理测试
        """
        # 文件不存在
        delta = self.plugin.run(self.store, "non_existent.json")
        self.assertEqual(len(delta.nodes), 0)
        
        # JSON 格式错误
        bad_path = self._create_trace_file("bad.json", {})
        with open(bad_path, 'w') as f: f.write("{ invalid json")
        
        delta = self.plugin.run(self.store, bad_path)
        self.assertEqual(len(delta.nodes), 0)

if __name__ == '__main__':
    unittest.main()