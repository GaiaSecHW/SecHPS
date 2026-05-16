# codedmap/infra/storage/driver_sqlite/store.py

import sqlite3
import logging
import os
import time
import random
from typing import Optional

from codedmap.core.schema.graph import CPGGraph
from codedmap.infra.storage.driver_sqlite.serializer import SqliteSerializer

logger = logging.getLogger(__name__)


class SqliteDatabase:
    """
    [Core] SQLite 数据库管理器。
    负责 DDL、连接配置以及将数据导出为 CSV。
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        # 确保目录存在
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

        self._init_db_schema()

    def get_connection(self) -> sqlite3.Connection:
        """获取配置优化后的连接"""
        # [Fix 1] isolation_level=None 表示我们要手动控制事务 (使用 BEGIN IMMEDIATE)
        conn = sqlite3.connect(self.db_path, timeout=60.0, isolation_level=None)

        # [Performance Tuning]
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA cache_size=-64000;")  # ~64MB
        conn.execute("PRAGMA mmap_size=268435456;")  # 256MB
        conn.execute("PRAGMA wal_autocheckpoint=20000;")

        # 增加 busy_timeout，让 SQLite 内部自动重试等待锁释放
        conn.execute("PRAGMA busy_timeout = 30000;")  # 30s

        conn.row_factory = sqlite3.Row
        return conn

    def _init_db_schema(self):
        """初始化表结构和索引"""
        conn = self.get_connection()
        try:

            # 快速路径 (Fast Path): 先检查表是否存在。
            # 如果表已存在（绝大多数 Worker 的情况），直接跳过后续的锁操作。
            # 这避免了多个 Worker 启动时争抢 BEGIN IMMEDIATE 写锁导致的 'database is locked'。
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'")
            if cursor.fetchone():
                # Schema exists — but check for missing columns from later versions
                self._migrate_schema(conn)
                return

            # DDL 最好在一个立即事务中完成
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.cursor()

            # 1. Nodes Table
            cursor.execute("""
                           CREATE TABLE IF NOT EXISTS nodes
                           (
                               id INTEGER PRIMARY KEY,
                               label TEXT NOT NULL,
                               properties TEXT -- JSON string
                           )
                           """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label)")

            # 2. Edges Table
            # Note: semantic_slot and semantic_value columns enable storage of parallel edges
            # that differ by semantic property (DDG variable, CFG label).
            # UNIQUE constraint includes semantic_value to distinguish semantic variants.
            cursor.execute("""
                           CREATE TABLE IF NOT EXISTS edges
                           (
                               src INTEGER NOT NULL,
                               dst INTEGER NOT NULL,
                               type TEXT NOT NULL,
                               properties TEXT,
                               created_by TEXT DEFAULT 'static',
                               semantic_slot TEXT,
                               semantic_value TEXT,
                               UNIQUE(src, dst, type, semantic_value)
                           )
                           """)

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_src_type ON edges(src, type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_dst_type ON edges(dst, type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_cleanup ON edges(created_by, type)")

            self._ensure_audit_log_schema(conn)

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _migrate_schema(self, conn):
        """Add columns introduced in later schema versions to legacy databases."""
        try:
            # Check if semantic_slot column exists in edges table
            cursor = conn.execute("PRAGMA table_info(edges)")
            columns = {row[1] for row in cursor.fetchall()}  # row[1] is column name

            if 'semantic_slot' not in columns:
                logger.info("Migrating edges table: adding semantic_slot, semantic_value columns")
                conn.execute("ALTER TABLE edges ADD COLUMN semantic_slot TEXT")
                conn.execute("ALTER TABLE edges ADD COLUMN semantic_value TEXT")
            self._ensure_audit_log_schema(conn)
        except Exception as e:
            logger.warning(f"Schema migration check failed: {e}")

    def _ensure_audit_log_schema(self, conn):
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
              event_id TEXT PRIMARY KEY,
              timestamp TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              actor_type TEXT NOT NULL,
              source TEXT,
              operation TEXT NOT NULL,
              target_kind TEXT NOT NULL,
              target_id INTEGER,
              target_label TEXT,
              field TEXT,
              old_value TEXT,
              new_value TEXT,
              status TEXT NOT NULL,
              reason TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_kind, target_id, timestamp)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, timestamp)"
        )

    def clear_database(self):
        """Drop all tables and recreate schema."""
        conn = self.get_connection()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DROP TABLE IF EXISTS edges")
            conn.execute("DROP TABLE IF EXISTS nodes")
            conn.execute("DROP TABLE IF EXISTS audit_log")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        self._init_db_schema()

    def checkpoint(self, mode: str = "TRUNCATE"):
        """
        强制将 WAL 数据回写到 DB，并截断 WAL 文件。
        """
        conn = self.get_connection()
        try:
            logger.info(f"Executing Manual WAL Checkpoint ({mode})...")
            start = time.time()
            # TRUNCATE 会阻塞直到完成，并清空 WAL 文件释放空间，这对 60GB WAL 至关重要
            conn.execute(f"PRAGMA wal_checkpoint({mode});")
            duration = time.time() - start
            logger.info(f"Checkpoint completed in {duration:.2f}s.")
        except Exception as e:
            logger.warning(f"Checkpoint failed: {e}")
        finally:
            conn.close()

    def merge_graph(self, graph: CPGGraph, max_retries: int = 60):  # [Changed] 默认重试 60 次
        """
        [Bulk Write] 将内存图批量写入 SQLite。
        高并发增强版：增加重试次数，采用线性+随机退避策略。
        """
        if not graph.nodes and not graph.edges:
            return

        try:
            node_rows = [SqliteSerializer.node_to_row(n) for n in graph.nodes.values()]
            edge_rows = [SqliteSerializer.edge_to_row(e) for e in graph.edges]
        except Exception as e:
            logger.error(f"Serialization failed: {e}")
            raise

        # 重试循环
        for attempt in range(max_retries + 1):
            conn = None
            try:
                conn = self.get_connection()

                # 获取写锁
                conn.execute("BEGIN IMMEDIATE")

                if node_rows:
                    conn.executemany(
                        "INSERT OR REPLACE INTO nodes (id, label, properties) VALUES (?, ?, ?)",
                        node_rows
                    )

                if edge_rows:
                    conn.executemany(
                        "INSERT OR IGNORE INTO edges (src, dst, type, properties, created_by, semantic_slot, semantic_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        edge_rows
                    )

                conn.commit()
                return  # 成功退出

            except sqlite3.OperationalError as e:
                if "locked" in str(e):
                    if conn: conn.rollback()

                    if attempt < max_retries:
                        # [Changed] 优化退避策略
                        # 前 10 次：快速重试 (0.1s ~ 1.0s)
                        # 后续：稳健重试 (1.0s ~ 3.0s)
                        # 避免指数爆炸导致等待太久，但在高竞争下保持耐心
                        base_sleep = min(0.1 * (attempt + 1), 2.0)
                        jitter = random.random() * 1.0
                        sleep_time = base_sleep + jitter

                        # 仅在多次失败后打印日志，避免刷屏
                        if attempt > 10 and attempt % 10 == 0:
                            logger.warning(
                                f"Database locked, retrying merge_graph (Attempt {attempt}/{max_retries}, Wait {sleep_time:.2f}s)")

                        time.sleep(sleep_time)
                        continue
                    else:
                        logger.error(f"Failed to merge graph after {max_retries} retries: {e}")
                        raise
                else:
                    if conn: conn.rollback()
                    raise
            except Exception as e:
                if conn: conn.rollback()
                logger.error(f"Failed to merge graph to SQLite: {e}")
                raise
            finally:
                if conn: conn.close()

    def export_to_neo4j_csv(self, output_dir: str):
        """
        [Export Bridge] 将 SQLite 数据流式导出为 Neo4j Admin Import 兼容格式。
        """
        from codedmap.infra.storage.driver_neo4j.bulk.writer import Neo4jBulkWriter
        logger.info(f"Starting export from SQLite to Neo4j Bulk Format: {output_dir}")

        # worker_id="final" 标识这是汇总导出
        with Neo4jBulkWriter(output_dir, worker_id="final") as csv_writer:

            conn = self.get_connection()
            # 导出是只读操作，不需要 WAL 写锁，建议 read_uncommitted 提升速度
            conn.execute("PRAGMA read_uncommitted = 1")

            arraysize = 5000

            try:
                # --- Export Nodes ---
                logger.info("Exporting Nodes...")
                cursor = conn.cursor()
                cursor.execute("SELECT id, label, properties FROM nodes")

                while True:
                    rows = cursor.fetchmany(arraysize)
                    if not rows: break

                    # 使用 writer 的流式接口
                    # 这里的 rows 是 SQLite Row 对象，我们需要转为 dict 流
                    node_iterator = (SqliteSerializer.row_to_dict(row) for row in rows)
                    csv_writer.write_nodes_stream(node_iterator)

                # --- Export Edges ---
                logger.info("Exporting Edges...")
                cursor.execute("SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value FROM edges")

                while True:
                    rows = cursor.fetchmany(arraysize)
                    if not rows: break

                    # 需要构造符合 CPGEdge 结构的字典
                    # SqliteSerializer.row_to_edge 返回的是对象，这里我们手动构造 dict 更轻量
                    def edge_gen():
                        for row in rows:
                            # row: (src, dst, type, properties_json)
                            edge_obj = SqliteSerializer.row_to_edge(row)
                            if edge_obj:
                                yield edge_obj  # write_edges_stream 支持对象

                    csv_writer.write_edges_stream(edge_gen())

            finally:
                conn.close()

        logger.info("SQLite to CSV Export Completed.")
