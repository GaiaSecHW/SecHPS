# codedmap/infra/storage/driver_sqlite/bulk/importer.py

import csv
import gzip
import logging
import sqlite3
import time
import queue
import threading
from pathlib import Path
from typing import List, Tuple, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase

logger = logging.getLogger(__name__)

# 特殊标记
SENTINEL = object()


class SqliteBulkLoader:
    """
    [High-Performance + Diagnostics] 并行流水线导入器（带性能诊断）。
    """

    def __init__(self, db: SqliteDatabase, data_dir: str):
        self.db = db
        self.data_dir = Path(data_dir) / "data"

        # 保持现有 Batch Size (看来 20w 很合适)
        self.db_batch_size = 200000

        self.queue_max_size = 100

        self.read_workers = 16

        self.total_nodes = 0
        self.total_edges = 0

    def run(self):
        start_time = time.time()
        logger.info(f"Starting Parallel SQLite Bulk Import from {self.data_dir}...")

        conn = self._get_fast_connection()
        try:
            logger.info("[Step 1/5] Initializing Schema...")
            self._init_schema(conn)

            # --- 1. Import Nodes ---
            node_files = sorted(list(self.data_dir.glob("nodes_*.csv.gz")))
            if node_files:
                logger.info(f"[Step 2/5] Pipeline Importing {len(node_files)} node shards...")
                self._pipeline_import(conn, node_files, "node")

            logger.info(f"  >> Nodes Finished. Total: {self.total_nodes}")

            # --- 2. Import Edges ---
            edge_files = sorted(list(self.data_dir.glob("edges_*.csv.gz")))
            if edge_files:
                logger.info(f"[Step 3/5] Pipeline Importing {len(edge_files)} edge shards...")
                self._pipeline_import(conn, edge_files, "edge")

            logger.info(f"  >> Edges Finished. Total: {self.total_edges}")

            # --- 3. Indices ---
            logger.info("[Step 4/5] Building indices...")
            t_idx = time.time()
            self._build_indices(conn)
            conn.commit()
            logger.info(f"  >> Indices built in {time.time() - t_idx:.2f}s")

            # --- 4. Analyze ---
            logger.info("[Step 5/5] Analyzing...")
            conn.execute("ANALYZE;")
            conn.commit()

            duration = time.time() - start_time
            logger.info(f"Bulk Import completed in {duration:.2f}s.")

        except Exception as e:
            conn.rollback()
            logger.error(f"Import Fatal Error: {e}", exc_info=True)
            raise
        finally:
            conn.close()

    def _pipeline_import(self, conn: sqlite3.Connection, files: List[Path], kind: str):
        """
        生产者-消费者主循环 (带监控)
        """
        # 队列存放的是 List[Tuple] (微批次)
        data_queue = queue.Queue(maxsize=self.queue_max_size)

        if kind == "node":
            sql = "INSERT OR IGNORE INTO nodes (id, label, properties) VALUES (?, ?, ?)"
        else:
            sql = "INSERT OR IGNORE INTO edges (src, dst, type, properties, created_by) VALUES (?, ?, ?, ?, 'static')"

        executor = ThreadPoolExecutor(max_workers=self.read_workers)

        # 提交任务
        futures = [executor.submit(self._producer_task, f, kind, data_queue) for f in files]

        # 监视线程：生产者全部结束后发送 SENTINEL
        def monitor_producers():
            for f in as_completed(futures):
                if f.exception():
                    logger.error(f"Producer failed: {f.exception()}")
            data_queue.put(SENTINEL)

        threading.Thread(target=monitor_producers, daemon=True).start()

        # --- 消费者循环 (主线程) ---
        buffer = []
        count_in_stage = 0

        # 性能监控变量
        t_last_log = time.time()
        c_last_log = 0

        # Commit 计数器
        uncommitted_count = 0
        COMMIT_THRESHOLD = 500000  # 每 50 万行提交一次，释放内存 Journal

        while True:
            try:
                # [Diagnostic] 检查队列状态
                # 如果 queue size 经常为 0 -> 瓶颈在 Read/Parse (生产者太慢)
                # 如果 queue size 经常满 (50) -> 瓶颈在 DB Write (消费者太慢)
                q_size = data_queue.qsize()

                # 获取数据 (阻塞最多 1 秒，方便打印 idle 日志)
                try:
                    item = data_queue.get(timeout=1.0)
                except queue.Empty:
                    # 队列空了，说明消费者比生产者快
                    # logger.debug(f"[Starvation] Queue empty. Waiting for producers...")
                    continue

                if item is SENTINEL:
                    break

                buffer.extend(item)
                count_in_stage += len(item)

                # 记录未提交数量
                uncommitted_count += len(item)

                # 批量写入
                if len(buffer) >= self.db_batch_size:
                    t0 = time.time()
                    conn.executemany(sql, buffer)
                    t_write = time.time() - t0

                    buffer.clear()

                    # 阶段性 Commit 释放内存
                    if uncommitted_count >= COMMIT_THRESHOLD:
                        t0 = time.time()
                        conn.commit()
                        logger.info(
                            f"     [Mem] Committed {uncommitted_count} rows to free RAM ({time.time() - t0:.3f}s)")
                        uncommitted_count = 0

                    # [Diagnostic] 每隔 3 秒打印详细性能指标
                    now = time.time()
                    if now - t_last_log > 3.0:
                        delta_n = count_in_stage - c_last_log
                        delta_t = now - t_last_log
                        speed = delta_n / delta_t

                        # 核心诊断日志
                        logger.info(
                            f"  >> [Perf] {kind.upper()}: "
                            f"Total={count_in_stage:,} | "
                            f"Speed={speed / 1000:.1f}k/s | "
                            f"QSize={q_size}/{self.queue_max_size} | "
                            f"LastWrite={t_write:.3f}s"
                        )

                        # 智能分析提示
                        if q_size == 0 and speed < 20000:
                            logger.warning("     [Analysis] BOTTLENECK: DISK READ / CPU (Producers too slow)")
                        elif q_size >= self.queue_max_size * 0.8:
                            logger.warning("     [Analysis] BOTTLENECK: DB WRITE (Consumer too slow)")

                        t_last_log = now
                        c_last_log = count_in_stage

            except Exception as e:
                logger.error(f"Consumer error: {e}")
                raise

        # 写入剩余
        if buffer:
            conn.executemany(sql, buffer)

        conn.commit()

        if kind == "node":
            self.total_nodes += count_in_stage
        else:
            self.total_edges += count_in_stage

        executor.shutdown()

    def _producer_task(self, file_path: Path, kind: str, q: queue.Queue):
        """Producer"""
        rows = []
        expected_cols = 3 if kind == "node" else 4

        try:
            with gzip.open(file_path, "rt", encoding="utf-8", newline="") as f:
                reader = csv.reader(f)
                try:
                    next(reader)
                except StopIteration:
                    return

                for row in reader:
                    if len(row) != expected_cols: continue

                    if kind == "node":
                        rows.append((int(row[0]), row[1], row[2]))
                    else:
                        rows.append((int(row[0]), int(row[1]), row[2], row[3]))

            if rows:
                q.put(rows)  # Block if queue is full

        except Exception as e:
            logger.error(f"Error reading {file_path}: {e}")
            raise

    def _get_fast_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db.db_path)
        conn.execute("PRAGMA synchronous = OFF;")
        conn.execute("PRAGMA journal_mode = MEMORY;")
        conn.execute("PRAGMA cache_size = -500000;")
        conn.execute("PRAGMA locking_mode = EXCLUSIVE;")
        conn.execute("PRAGMA temp_store = MEMORY;")
        conn.execute("PRAGMA foreign_keys = OFF;")
        return conn

    def _init_schema(self, conn: sqlite3.Connection):
        conn.execute("DROP TABLE IF EXISTS nodes")
        conn.execute("DROP TABLE IF EXISTS edges")
        conn.execute("""
                     CREATE TABLE nodes
                     (
                         id         INTEGER PRIMARY KEY,
                         label      TEXT NOT NULL,
                         properties TEXT
                     )
                     """)
        conn.execute("""
                     CREATE TABLE edges
                     (
                         src        INTEGER NOT NULL,
                         dst        INTEGER NOT NULL,
                         type       TEXT    NOT NULL,
                         properties TEXT,
                         created_by TEXT DEFAULT 'static',
                         UNIQUE (src, dst, type) ON CONFLICT IGNORE
                     )
                     """)

    def _build_indices(self, conn: sqlite3.Connection):
        logger.info("  .. Creating index: idx_nodes_label")
        conn.execute("CREATE INDEX idx_nodes_label ON nodes(label)")
        logger.info("  .. Creating index: idx_edges_src_type")
        conn.execute("CREATE INDEX idx_edges_src_type ON edges(src, type)")
        logger.info("  .. Creating index: idx_edges_dst_type")
        conn.execute("CREATE INDEX idx_edges_dst_type ON edges(dst, type)")
        logger.info("  .. Creating index: idx_edges_cleanup")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_edges_cleanup ON edges(created_by, type)")

class SqliteImporter:
    """
    [Component] 适配器。
    """

    def __init__(self, db: SqliteDatabase):
        self.db = db

    def run(self, data_dir: str):
        loader = SqliteBulkLoader(self.db, data_dir)
        loader.run()