import logging
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.interfaces import StorageEngine

logger = logging.getLogger(__name__)


class StorageEngineFactory:
    """
    [Registry] 全局存储引擎工厂。
    这是唯一包含条件导入 (Conditional Import) 的地方。
    """

    @staticmethod
    def create(config: StorageConfig) -> StorageEngine:
        backend = config.backend.lower()
        logger.info(f"Initializing Storage Engine: {backend}")

        if backend == "neo4j":
            from codedmap.infra.storage.driver_neo4j.engine import Neo4jEngine
            return Neo4jEngine(config)

        elif backend == "sqlite":
            from codedmap.infra.storage.driver_sqlite.engine import SqliteEngine
            return SqliteEngine(config)

        elif backend == "memory":
            from codedmap.infra.storage.driver_memory.engine import MemoryEngine
            return MemoryEngine(config)

        else:
            raise ValueError(f"Unsupported storage backend: {backend}")