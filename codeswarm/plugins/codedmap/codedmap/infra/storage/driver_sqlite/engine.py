import logging
import os
from urllib.parse import urlparse

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.interfaces import (
    StorageEngine, EngineCapabilities, TransactionContext,
    GraphReader, GraphWriter, TraversalSourceProtocol,
    EdgeTraversalSourceProtocol, StatisticsHelperProtocol
)
from .bulk.importer import SqliteImporter

from .store import SqliteDatabase
from .connection import SqliteConnection
from .reader import SqliteReader
from .writer import SqliteWriter
from .traversal import SqliteTraversalSource, SqliteEdgeTraversalSource, SqliteStatisticsHelper
from .bulk.writer import SqliteBulkWriter

logger = logging.getLogger(__name__)

_NON_SQLITE_SCHEMES = {"bolt", "neo4j", "neo4j+s", "neo4j+ssc", "http", "https"}


class SqliteEngine(StorageEngine):
    def __init__(self, config: StorageConfig):
        self._capabilities = EngineCapabilities(
            supports_atomic_batch_ops=True,
            supports_vector_search=False,
            supports_bulk_export=True,
            supports_transactions=True,
            supports_programmatic_import=True,
        )

        path = self._resolve_db_path(config.uri)

        # 1. 初始化 DB Core
        self.db = SqliteDatabase(path)

        # 2. 组装组件
        self._connection = SqliteConnection(self.db)
        self._reader = SqliteReader(self.db)
        self._writer = SqliteWriter(self.db)
        self._traversal = SqliteTraversalSource(self.db)
        self._edge_source = SqliteEdgeTraversalSource(self.db)
        self._stats = SqliteStatisticsHelper(self._reader)
        self._importer = SqliteImporter(self.db)


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

    def close(self):
        self._connection.close()

    def clear_database(self):
        self.db.clear_database()

    def transaction(self) -> TransactionContext:
        return self._connection.transaction()

    def snapshot(self, output_path: str):
        # 委托给 DB Core 的导出功能
        self.db.export_to_neo4j_csv(output_path)

    def create_bulk_writer(self, output_dir: str, worker_id: str = None):
        return SqliteBulkWriter(output_dir, worker_id)

    def import_bulk(self, input_dir: str):
        self._importer.run(input_dir)

    @staticmethod
    def _resolve_db_path(uri: str) -> str:
        """Resolve a storage URI to a local filesystem path for SQLite.

        Accepts:
          - ``sqlite:///path/to/db``  →  ``/path/to/db``
          - ``sqlite://relative.db``  →  ``relative.db``
          - ``:memory:``              →  ``:memory:``
          - ``/path/to/db``           →  ``/path/to/db``  (plain path)
          - ``relative.db``           →  ``relative.db``  (plain path)

        Rejects URIs whose scheme belongs to another storage driver
        (bolt://, neo4j://, http://, …) to prevent accidental file creation
        like ``bolt:/localhost:7687``.
        """
        if uri == ":memory:":
            return uri

        parsed = urlparse(uri)
        if parsed.scheme in _NON_SQLITE_SCHEMES:
            raise ValueError(
                f"SqliteEngine received a non-SQLite URI: '{uri}'. "
                f"Did you forget to set 'uri' in StorageConfig when backend='sqlite'?"
            )

        if parsed.scheme == "sqlite":
            # sqlite:///abs/path → "/abs/path";  sqlite://rel.db → "rel.db"
            return uri[len("sqlite://"):]

        # Plain filesystem path (no scheme) — use as-is
        return uri