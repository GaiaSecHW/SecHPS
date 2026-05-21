# codedmap/infra/storage/driver_memory/connection.py

from contextlib import contextmanager
from codedmap.infra.storage.interfaces import ConnectionManager, TransactionContext
from codedmap.infra.storage.driver_memory.store import MemoryDatabase

class MemoryTransaction(TransactionContext):
    """内存事务就是一个线程锁的上下文"""
    def __init__(self, lock):
        self.lock = lock

    def __enter__(self):
        self.lock.acquire()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.lock.release()

class MemoryConnection(ConnectionManager):
    def __init__(self, db: MemoryDatabase):
        self.db = db

    def connect(self):
        pass # 内存模式无需握手

    def close(self):
        pass # 内存随进程回收

    def transaction(self) -> TransactionContext:
        return MemoryTransaction(self.db.lock)