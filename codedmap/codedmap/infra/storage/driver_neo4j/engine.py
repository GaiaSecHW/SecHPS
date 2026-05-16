import logging
import os

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.interfaces import (
    StorageEngine, EngineCapabilities, TransactionContext,
    GraphReader, GraphWriter, TraversalSourceProtocol,
    EdgeTraversalSourceProtocol, StatisticsHelperProtocol
)
from .bulk.writer import Neo4jBulkWriter

# 导入具体组件
from .client import Neo4jClient
from .connection import Neo4jConnection
from .reader import Neo4jReader
from .writer import Neo4jWriter
from .traversal import Neo4jTraversalSource, Neo4jEdgeTraversalSource, Neo4jStatisticsHelper

logger = logging.getLogger(__name__)

class Neo4jEngine(StorageEngine):
    def __init__(self, config: StorageConfig):
        self._capabilities = EngineCapabilities(
            supports_atomic_batch_ops=True,
            supports_vector_search=True,
            supports_bulk_export=True,  # Neo4jReader 实现了 export_to_file
            supports_transactions=True
        )

        # 1. 初始化 Client (单例持有)
        self.client = Neo4jClient(
            uri=config.uri,
            auth=(config.username, config.password.get_secret_value() if config.password else None),
            database=getattr(config, "database", "neo4j")
        )

        # 2. 组装组件
        self._connection = Neo4jConnection(self.client)
        self._reader = Neo4jReader(self.client)
        self._writer = Neo4jWriter(self.client, batch_size=config.batch_size)
        self._traversal = Neo4jTraversalSource(self.client)
        self._edge_source = Neo4jEdgeTraversalSource(self.client)
        self._stats = Neo4jStatisticsHelper(self._reader)


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
        self._connection.connect()
        # Neo4j 特有：自动初始化 Schema
        self._connection.init_schema()

    def close(self):
        self._connection.close()

    def clear_database(self):
        self._connection.clear_database()

    def transaction(self) -> TransactionContext:
        return self._connection.transaction()

    def snapshot(self, output_path: str):
        # 委托给 Reader 的流式导出
        self._reader.export_to_file(output_path)

    def create_bulk_writer(self, output_dir: str, worker_id: str = None):
        return Neo4jBulkWriter(output_dir, worker_id)

    def import_bulk(self, input_dir: str):
        abs_path = os.path.abspath(input_dir)

        # [Critical] 这里的 \x1F 必须与 Encoder.ARRAY_DELIMITER 保持一致
        # 在 Shell 命令中通常写作 $'\x1F' 或者直接传入特殊字符
        # 为了通用性，建议用户在 Shell 中执行时小心处理，或者我们在 Log 中提示
        # "Use standard array delimiter or specify it"

        msg = f"""
        [Neo4j Bulk Import Instruction]

        Please run the following command in your terminal (ensure Neo4j is stopped):

        neo4j-admin database import full \\
            --array-delimiter="\\x1F" \\
            --nodes="{abs_path}/headers/nodes_.*_header.csv,{abs_path}/data/nodes_.*.csv.gz" \\
            --relationships="{abs_path}/headers/edges_.*_header.csv,{abs_path}/data/edges_.*.csv.gz" \\
            --overwrite-destination \\
            {self.client._database}

        [Note]: We use the 'Unit Separator' (\\x1F) for arrays to support code analysis.
        """
        logger.info(msg)
        raise NotImplementedError("Neo4j requires manual offline import. See logs for command.")