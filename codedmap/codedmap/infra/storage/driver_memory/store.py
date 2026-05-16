# codedmap/infra/storage/driver_memory/store.py

import json
import os
import threading
import logging
from typing import Optional
from codedmap.core.schema.graph import CPGGraph
from codedmap.infra.storage.driver_memory.traversal import GraphIndexer

logger = logging.getLogger(__name__)


class MemoryDatabase:
    """
    [Internal] 内存数据库实例。
    持有数据状态、索引和锁。
    """

    def __init__(self):
        self.lock = threading.RLock()
        self.graph: CPGGraph = CPGGraph()
        self.audit_log = []
        self.indexer: Optional[GraphIndexer] = None
        self._rebuild_index()

    def _rebuild_index(self):
        """重建索引 (当图结构发生变化时调用)"""
        # GraphIndexer 在 traversal.py 中定义
        # 注意：这里有循环引用的风险，但在运行时通常没问题，因为 traversal 已经导入了 store 用于类型检查
        # 最好确保 GraphIndexer 是独立的可导入对象
        self.indexer = GraphIndexer(self.graph)

    def merge_graph(self, other_graph: CPGGraph):
        """合并图并刷新索引"""
        with self.lock:
            self.graph.merge(other_graph)
            self._rebuild_index()

    def clear(self):
        with self.lock:
            self.graph = CPGGraph()
            self.audit_log = []
            self._rebuild_index()

    def load_from_file(self, path: str, format: str = "json") -> None:
        """
        [Persistence] 从文件加载数据并覆盖当前内存图。
        """
        if not os.path.exists(path):
            raise FileNotFoundError(f"Database snapshot not found: {path}")

        print(f"[MemoryDB] Loading graph from {path} ({format})...")

        loaded_graph = None

        if format == "json":
            # JSON 通用性好，安全，但需要经过 Pydantic 验证
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # 使用解包参数初始化
            loaded_graph = CPGGraph(**data)

        else:
            raise ValueError(
                f"Unsupported format: {format}. MemoryDatabase only accepts JSON snapshots."
            )

        if loaded_graph:
            # 原子替换整个图对象
            with self.lock:
                self.graph = loaded_graph
                self._rebuild_index()  # 记得重建索引

            print(f"[MemoryDB] Graph loaded. Nodes: {len(self.graph.nodes)}, Edges: {len(self.graph.edges)}")
