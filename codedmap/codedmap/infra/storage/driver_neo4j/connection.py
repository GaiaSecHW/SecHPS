# codedmap/infra/storage/driver_neo4j/connection.py

from neo4j import Transaction
from codedmap.infra.storage.interfaces import ConnectionManager, TransactionContext
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.infra.storage.driver_neo4j.schema_manager import SchemaManager

class Neo4jTransactionContext(TransactionContext):
    """Neo4j 事务上下文适配器"""
    def __init__(self, client: Neo4jClient):
        self.client = client
        self.session = None
        self.tx = None

    def __enter__(self) -> Transaction:
        # 手动开启 Session 和 Transaction
        self.session = self.client._driver.session(database=self.client._database)
        self.tx = self.session.begin_transaction()
        return self.tx

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type:
                self.tx.rollback()
            else:
                self.tx.commit()
        finally:
            if self.session:
                self.session.close()

class Neo4jConnection(ConnectionManager):
    def __init__(self, client: Neo4jClient):
        self.client = client
        self.schema_manager = SchemaManager(client)

    def connect(self):
        self.client.verify_connectivity()
        self.client.ensure_database_created(self.client._database)

    def close(self):
        self.client.close()

    def transaction(self) -> TransactionContext:
        return Neo4jTransactionContext(self.client)
    
    def init_schema(self):
        self.schema_manager.init_schema()

    def clear_database(self):
        """(危险) 清空数据库"""
        self.schema_manager.drop_all()
        self.schema_manager.init_schema()    