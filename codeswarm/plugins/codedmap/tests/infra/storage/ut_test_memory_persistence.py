import sys
import unittest
import os
import shutil
from pathlib import Path

# 确保项目根目录在 path 中
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.storage.driver_memory.backend import MemoryBackend

class TestMemoryPersistence(unittest.TestCase):
    def setUp(self):
        self.backend = MemoryBackend()
        self.test_dir = Path("./test_dumps")
        self.test_dir.mkdir(exist_ok=True)
        self.snapshot_path = self.test_dir / "cpg.bin.gz"

        # 构造一些数据
        self.graph = CPGGraph()
        self.n1 = MethodNode(id=1, name="main", fullName="main")
        self.n2 = MethodNode(id=2, name="foo", fullName="foo")
        self.graph.add_node(self.n1)
        self.graph.add_node(self.n2)
        self.graph.add_call_edge(self.n1, self.n2)
        
        self.backend.save_graph(self.graph)

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_persist_and_restore(self):
        # 1. 保存
        self.backend.persist(str(self.snapshot_path))
        self.assertTrue(self.snapshot_path.exists())
        self.assertGreater(self.snapshot_path.stat().st_size, 0)

        # 2. 清空后端
        self.backend.clear_data()
        self.assertIsNone(self.backend._graph)
        self.assertIsNone(self.backend._source) # 索引也应清空

        # 3. 恢复
        self.backend.restore(str(self.snapshot_path))
        
        # 4. 验证数据完整性
        restored_graph = self.backend._graph
        self.assertIsNotNone(restored_graph)
        self.assertEqual(len(restored_graph.nodes), 2)
        self.assertEqual(len(restored_graph.edges), 1)
        
        # 验证索引是否重建 (能否查询到)
        node = self.backend._graph.get_node(1)
        self.assertEqual(node.name, "main")
        
        # 验证 Traversal Source 是否可用
        methods = self.backend.traversal().methods("main").to_list()
        self.assertEqual(len(methods), 1)
        self.assertEqual(methods[0].id, 1)

if __name__ == "__main__":
    unittest.main()