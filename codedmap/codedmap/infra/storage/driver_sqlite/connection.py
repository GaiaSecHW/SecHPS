# codedmap/infra/storage/driver_sqlite/connection.py

import sqlite3
from typing import Any
from codedmap.infra.storage.interfaces import ConnectionManager, TransactionContext
from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase

class SqliteTransaction(TransactionContext):
    """
    SQLite 事务上下文。
    """
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self):
        # sqlite3 默认在 execute 时自动开启事务 (Implicit transaction)
        # 这里我们显式确保处于事务中
        return self.conn.cursor()

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        # conn 不在这里关闭，由 ConnectionManager 管理

class SqliteConnection(ConnectionManager):
    def __init__(self, db: SqliteDatabase):
        self.db = db
        # 保持一个长连接用于事务操作 (Thread-local in practice usually, here simplified)
        # 注意：sqlite3 连接对象不能跨线程使用 (check_same_thread=True by default)
        # 这里每次 connect 返回新连接，或者在 Writer/Reader 内部管理
        self._conn = None

    def connect(self):
        # 懒加载，或者测试连接
        conn = self.db.get_connection()
        conn.close()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def transaction(self) -> TransactionContext:
        """
        获取一个写事务。
        注意：为了线程安全，这里每次创建一个新的连接用于事务，或者复用 ThreadLocal 连接。
        为简单起见，我们在 Writer 中通常直接获取连接，但为了接口兼容：
        """
        # 如果没有活跃连接，创建一个
        if self._conn is None:
            self._conn = self.db.get_connection()
        return SqliteTransaction(self._conn)