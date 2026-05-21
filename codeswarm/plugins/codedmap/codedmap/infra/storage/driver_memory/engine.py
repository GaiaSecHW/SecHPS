import os
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.interfaces import (
    StorageEngine, EngineCapabilities, TransactionContext,
    GraphReader, GraphWriter, TraversalSourceProtocol,
    EdgeTraversalSourceProtocol, StatisticsHelperProtocol
)

# 导入具体组件
from .store import MemoryDatabase
from .connection import MemoryConnection
from .reader import MemoryReader
from .writer import MemoryWriter
from .traversal import MemoryTraversalSource, MemoryEdgeTraversalSource, MemoryStatisticsHelper


class MemoryEngine(StorageEngine):
    def __init__(self, config: StorageConfig):
        self._capabilities = EngineCapabilities(
            supports_atomic_batch_ops=False,
            supports_vector_search=True,  # 你的 MemoryReader 实现了 Bruteforce 搜索
            supports_bulk_export=True,
            memory_optimized=True
        )

        # 1. 初始化 DB
        self.db = MemoryDatabase()
        # 支持启动时加载
        if config.uri and os.path.exists(config.uri):
            try:
                self.db.load_from_file(config.uri)
            except Exception:
                pass  # Log warning in production

        # 2. 组装
        self._connection = MemoryConnection(self.db)
        self._reader = MemoryReader(self.db)
        self._writer = MemoryWriter(self.db)
        self._traversal = MemoryTraversalSource(self.db)
        self._edge_source = MemoryEdgeTraversalSource(self.db)
        self._stats = MemoryStatisticsHelper(self._reader)



    @property
    def capabilities(self) -> EngineCapabilities:
        return self._capabilities

    @property
    def reader(self) -> GraphReader:
        return self._reader

    @property
    def writer(self) -> GraphWriter:
        return self._writer

    @property
    def traversal_source(self) -> TraversalSourceProtocol:
        return self._traversal

    @property
    def edge_source(self) -> EdgeTraversalSourceProtocol:
        return self._edge_source

    @property
    def stats(self) -> StatisticsHelperProtocol:
        return self._stats

    def connect(self):
        pass

    def close(self):
        pass

    def clear_database(self):
        self.db.clear()

    def transaction(self) -> TransactionContext:
        return self._connection.transaction()

    def snapshot(self, output_path: str):
        self._reader.export_to_file(output_path)

    def create_bulk_writer(self, output_dir: str, worker_id: str = None):
        raise NotImplementedError("Memory engine does not support bulk writing.")