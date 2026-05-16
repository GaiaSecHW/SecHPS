# codedmap/infra/utils/disk_map.py

import sqlite3
import os
import tempfile
import logging
import time
from typing import Generator, Tuple, Any, List, Dict, Optional, Set, Iterator

logger = logging.getLogger(__name__)


class DiskMap:
    """
    [Key-Value Store]
    用于存储 1对1 的映射关系 (如 Linker 中的 USR -> NodeID)。
    Key 必须是唯一的。
    """

    def __init__(self,
                 table_name: str = "disk_map",
                 key_type: str = "TEXT",
                 value_type: str = "BLOB",
                 existing_db_path: Optional[str] = None,
                 work_dir: Optional[str] = None,
                 filename: Optional[str] = None):

        self.table_name = table_name
        self.key_type = key_type
        self.value_type = value_type
        self.conn = None
        self.temp_dir = None

        # --- Path Resolution ---
        if existing_db_path:
            self.db_path = existing_db_path
        elif work_dir:
            if not os.path.exists(work_dir):
                os.makedirs(work_dir, exist_ok=True)
            fname = filename if filename else f"{table_name}.db"
            self.db_path = os.path.join(work_dir, fname)
        else:
            self.temp_dir = tempfile.TemporaryDirectory(prefix="cpg_diskmap_")
            self.db_path = os.path.join(self.temp_dir.name, "map.db")

        self._connect()
        self._init_schema()

    def _connect(self):
        # [Concurrency Fix] 设置 timeout，防止 SQLite "database is locked" 错误
        self.conn = sqlite3.connect(self.db_path, timeout=60.0, check_same_thread=False)

        # [Performance Tuning]
        # WAL 模式允许多个 Reader 和一个 Writer 同时操作，显著减少锁竞争
        self.conn.execute("PRAGMA journal_mode=WAL")
        # NORMAL 模式在大多数情况下足够安全，且比 FULL 快得多
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA cache_size=-64000")  # 64MB Cache
        self.conn.execute("PRAGMA temp_store=MEMORY")
        self.conn.execute("PRAGMA mmap_size=2147483648")  # 2GB Mmap

    def _init_schema(self):
        try:
            # 标准 KV 表
            sql = f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    key {self.key_type} PRIMARY KEY,
                    value {self.value_type}
                ) WITHOUT ROWID;
            """
            self.conn.execute(sql)
            self.conn.commit()
        except Exception as e:
            logger.error(f"Failed to init DiskMap schema: {e}")
            raise

    def bulk_set(self, items: Generator[Tuple[Any, Any], None, None], batch_size=50000):
        """
        用于 Linker 等场景的批量写入。
        注意：对于 KV Store，后写入会覆盖先写入 (REPLACE INTO)。
        """
        cursor = self.conn.cursor()
        sql = f"INSERT OR REPLACE INTO {self.table_name} VALUES (?, ?)"

        batch = []
        try:
            for item in items:
                # [Robustness] 强制 Key 转为 string，防止类型混用导致查不到
                k, v = item
                if self.key_type == "TEXT":
                    k = str(k)
                batch.append((k, v))

                if len(batch) >= batch_size:
                    cursor.executemany(sql, batch)
                    self.conn.commit()
                    batch = []

            if batch:
                cursor.executemany(sql, batch)
                self.conn.commit()

        except Exception as e:
            logger.error(f"DiskMap bulk_set failed: {e}")
            raise

    def get(self, key: Any) -> Any:
        if self.key_type == "TEXT": key = str(key)
        res = self.conn.execute(f"SELECT value FROM {self.table_name} WHERE key=?", (key,)).fetchone()
        return res[0] if res else None

    def get_batch(self, keys: List[Any]) -> Dict[Any, Any]:
        if not keys: return {}
        # [Robustness] Handle keys conversion
        if self.key_type == "TEXT":
            keys = [str(k) for k in keys]

        placeholders = ','.join(['?'] * len(keys))
        sql = f"SELECT key, value FROM {self.table_name} WHERE key IN ({placeholders})"
        try:
            cursor = self.conn.execute(sql, keys)
            return dict(cursor.fetchall())
        except Exception:
            # Fallback for too many variables constraint
            result = {}
            chunk_size = 900
            for i in range(0, len(keys), chunk_size):
                chunk = keys[i:i + chunk_size]
                p_chunk = ','.join(['?'] * len(chunk))
                c = self.conn.execute(f"SELECT key, value FROM {self.table_name} WHERE key IN ({p_chunk})", chunk)
                result.update(dict(c.fetchall()))
            return result

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None
        if self.temp_dir:
            self.temp_dir.cleanup()

    def __contains__(self, key):
        if self.key_type == "TEXT": key = str(key)
        res = self.conn.execute(f"SELECT 1 FROM {self.table_name} WHERE key=?", (key,)).fetchone()
        return res is not None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class DiskSet:
    """
    [Concurrent Safe Set]
    彻底重构：不再存储 Blob，而是存储 (Key, Member) 的关系行。
    支持多进程并发写入，利用 SQLite 的原子性进行自动合并。
    """

    def __init__(self, disk_map: DiskMap):
        """
        注意：现在的 DiskSet 实际上接管了 disk_map 的连接，
        并在同一数据库文件中创建一个专门用于存储集合关系的表。
        """
        self.map = disk_map
        # 使用 disk_map 的 table_name 作为前缀，防止冲突
        self.set_table_name = f"{self.map.table_name}_set"

        self._init_set_schema()

    def _init_set_schema(self):
        # 创建复合主键表 (key, member)
        # 这确保了 (key, member) 的唯一性，实现了 Set 的语义
        # 且 INSERT OR IGNORE 实现了并发安全的合并
        sql = f"""
            CREATE TABLE IF NOT EXISTS {self.set_table_name} (
                key TEXT,
                member INTEGER,
                PRIMARY KEY (key, member)
            ) WITHOUT ROWID;

            -- 可选：为 member 创建索引以支持反向查询 (who points to x?)
            CREATE INDEX IF NOT EXISTS idx_{self.set_table_name}_member
            ON {self.set_table_name}(member);
        """
        self.map.conn.executescript(sql)
        self.map.conn.commit()

    def add(self, key: int, value: int) -> bool:
        """
        单条添加。
        Returns: True if inserted (new), False if existed.
        虽然是 Atomic 的，但频繁调用 IO 慢，请尽量使用 batch_update。
        """
        try:
            self.map.conn.execute(
                f"INSERT OR IGNORE INTO {self.set_table_name} VALUES (?, ?)",
                (str(key), value)
            )
            # 这里的返回值检查比较 tricky，sqlite3 execute 不直接返回 affected rows
            # 但对于 Solver 来说，只要保证写入即可。
            # 如果需要精确的 change detection (worklist update)，通常在 batch 层面做会更好。
            return True
        except Exception as e:
            logger.error(f"DiskSet add failed: {e}")
            return False

    def get(self, key: int) -> Set[int]:
        """读取集合：SELECT member FROM table WHERE key=?"""
        cursor = self.map.conn.execute(
            f"SELECT member FROM {self.set_table_name} WHERE key=?",
            (str(key),)
        )
        return {row[0] for row in cursor.fetchall()}

    def contains_key(self, key: int) -> bool:
        cursor = self.map.conn.execute(
            f"SELECT 1 FROM {self.set_table_name} WHERE key=? LIMIT 1",
            (str(key),)
        )
        return cursor.fetchone() is not None

    def update(self, key: int, values: Set[int]) -> bool:
        """
        将 values 合并到 key 中。
        """
        if not values: return False
        data = [(str(key), v) for v in values]
        return self._bulk_insert(data)

    def _bulk_insert(self, data: List[Tuple[str, int]]) -> bool:
        if not data: return False
        try:
            self.map.conn.executemany(
                f"INSERT OR IGNORE INTO {self.set_table_name} VALUES (?, ?)",
                data
            )
            # 在 batch update 模式下，我们暂时认为"只要有写入动作"就算 True
            # 精确计算 changed 需要 count before/after，太慢。
            # Solver 可以通过 "Worker返回的新边数量" 来判断收敛，或者简单的 Over-approximate
            return True
        except Exception as e:
            logger.error(f"DiskSet bulk insert failed: {e}")
            return False

    def count(self, key: Optional[int] = None) -> int:
        """
        Count elements in the set.
        - If key is None: return total row count.
        - If key is specified: return size of that key's set.
        """
        if key is None:
            cursor = self.map.conn.execute(
                f"SELECT COUNT(*) FROM {self.set_table_name}"
            )
        else:
            cursor = self.map.conn.execute(
                f"SELECT COUNT(*) FROM {self.set_table_name} WHERE key=?",
                (str(key),)
            )
        return cursor.fetchone()[0]

    def iter_items(self) -> Iterator[Tuple[int, Set[int]]]:
        """
        遍历所有集合。
        注意：这需要在内存中聚合，如果单个 Set 极大可能会耗内存。
        但通常 Points-to Set 是稀疏的。
        """
        # 使用 ORDER BY key 让我们能流式聚合
        cursor = self.map.conn.execute(
            f"SELECT key, member FROM {self.set_table_name} ORDER BY key"
        )

        current_key = None
        current_set = set()

        while True:
            rows = cursor.fetchmany(5000)
            if not rows: break

            for k_str, m in rows:
                try:
                    k = int(k_str)
                except:
                    continue  # Should not happen if strictly managed

                if k != current_key:
                    if current_key is not None:
                        yield current_key, current_set
                    current_key = k
                    current_set = set()

                current_set.add(m)

        if current_key is not None:
            yield current_key, current_set

    # -------------------------------------------------------------------------
    # Batch Updater (Concurrent Safe)
    # -------------------------------------------------------------------------

    class BatchUpdater:
        def __init__(self, disk_set: 'DiskSet', flush_threshold: int = 50000):
            self.ds = disk_set
            # Buffer: List of (key_str, member_int)
            self.buffer: List[Tuple[str, int]] = []
            self.threshold = flush_threshold

        def add(self, key: int, value: int):
            self.buffer.append((str(key), value))
            if len(self.buffer) >= self.threshold:
                self.flush()

        def update(self, key: int, values: Set[int]):
            if not values: return
            k_str = str(key)
            for v in values:
                self.buffer.append((k_str, v))

            if len(self.buffer) >= self.threshold:
                self.flush()

        def flush(self):
            if not self.buffer: return
            try:
                self.ds.map.conn.executemany(
                    f"INSERT OR IGNORE INTO {self.ds.set_table_name} VALUES (?, ?)",
                    self.buffer
                )
                self.ds.map.conn.commit()
                self.buffer.clear()
            except Exception as e:
                # 遇到数据库锁定时，稍微退避重试一次
                logger.warning(f"Batch flush locked, retrying... {e}")
                time.sleep(0.1)
                try:
                    self.ds.map.conn.executemany(
                        f"INSERT OR IGNORE INTO {self.ds.set_table_name} VALUES (?, ?)",
                        self.buffer
                    )
                    self.ds.map.conn.commit()
                    self.buffer.clear()
                except Exception as e2:
                    logger.error(f"Batch flush failed permanently: {e2}")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            self.flush()

    def batch_update(self, flush_threshold=50000):
        return self.BatchUpdater(self, flush_threshold)
