# codedmap/infra/storage/driver_sqlite/writer.py

import json
import time
import random
import sqlite3
import logging
from typing import List, Dict, Any, Set, Callable, ContextManager

from codedmap.core.schema.graph.enums import EdgeDirection, NodeLabel
from codedmap.core.schema.graph.patch import NodeListUpdate, PruneRequest, ListOpType, GraphPatch
from codedmap.infra.storage.base.writer import BaseGraphWriter
from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase
from codedmap.infra.storage.driver_sqlite.serializer import SqliteSerializer

logger = logging.getLogger(__name__)


class SqliteAtomicContext:
    """
    [Concurrency Control] 自定义事务上下文管理器。
    确保每次操作都使用独立的连接，并且强制使用 IMMEDIATE 事务防止死锁。
    """

    def __init__(self, db: SqliteDatabase):
        self.db = db
        self.conn = None
        self.cursor = None

    def __enter__(self):
        self.conn = self.db.get_connection()
        self.cursor = self.conn.cursor()
        self.conn.execute("BEGIN IMMEDIATE")
        return self.cursor

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type:
                self.conn.rollback()
            else:
                self.conn.commit()
        finally:
            self.conn.close()


class SqliteWriter(BaseGraphWriter):
    """
    [Concurrency Safe] SQLite 写入器。
    [Fix] 支持 created_by 字段的持久化与精准清理。
    """

    def __init__(self, db: SqliteDatabase):
        self.db = db

    def save_graph(self, graph: Any):
        self.db.merge_graph(graph)

    # --- 1. Concurrency Control Core ---

    def _execute_with_retry(self, action: Callable[[], None], max_retries: int = 100):
        for attempt in range(max_retries + 1):
            try:
                return action()
            except sqlite3.OperationalError as e:
                if "locked" in str(e):
                    if attempt < max_retries:
                        base_sleep = min(0.1 * (attempt + 1), 2.0)
                        jitter = random.random() * 1.0
                        sleep_time = base_sleep + jitter
                        if attempt > 10 and attempt % 10 == 0:
                            logger.warning(
                                f"Writer locked, retrying... (Attempt {attempt}/{max_retries}, Wait {sleep_time:.2f}s)")
                        time.sleep(sleep_time)
                        continue
                logger.error(f"Transaction failed after {max_retries} retries: {e}")
                raise e
            except Exception as e:
                raise e

    def _transaction_context(self) -> ContextManager:
        return SqliteAtomicContext(self.db)

    def apply_patch(self, patch: GraphPatch):
        def _action():
            # 必须调用 super 的方法，它包含了 Step 0 到 Step E 的编排逻辑
            super(SqliteWriter, SqliteWriter).apply_patch(self, patch)

        self._execute_with_retry(_action)

    # --- 2. Public API Implementations (Wrapped) ---

    def delete_nodes(self, node_ids: List[int]):
        def _action():
            with self._transaction_context() as tx:
                self._remove_nodes_atomic(tx, set(node_ids))

        self._execute_with_retry(_action)

    def delete_neighbor_nodes(self, source_node_ids: List[int], edge_type: str, direction: EdgeDirection):
        # 注意：这个 API 用于级联删除（例如删除文件时删除其包含的方法），
        # 不要混淆于 PruneRequest（清理边）
        def _action():
            with self._transaction_context() as tx:
                # 简单实现：查找邻居并删除
                placeholders = ",".join("?" * len(source_node_ids))
                # 假设 OUT 方向: src -> dst
                sql = f"SELECT dst FROM edges WHERE src IN ({placeholders}) AND type=?"
                tx.execute(sql, source_node_ids + [edge_type])
                targets = [r[0] for r in tx.fetchall()]
                if targets:
                    self._remove_nodes_atomic(tx, set(targets))

        self._execute_with_retry(_action)

    def update_nodes_properties(self, label: str, updates: List[Dict[str, Any]], match_key: str = "id"):
        if match_key != "id":
            raise NotImplementedError("Sqlite only supports update by ID")

        def _action():
            with self._transaction_context() as tx:
                for row in updates:
                    nid = row.get('id')
                    if nid is None: continue
                    tx.execute("SELECT properties FROM nodes WHERE id = ?", (nid,))
                    res = tx.fetchone()
                    if not res: continue

                    props = json.loads(res[0])
                    changed = False
                    for k, v in row.items():
                        if k == "id": continue
                        if props.get(k) != v:
                            props[k] = v
                            changed = True

                    if changed:
                        tx.execute("UPDATE nodes SET properties = ? WHERE id = ?",
                                   (json.dumps(props, ensure_ascii=False), nid))

        self._execute_with_retry(_action)

    def property_list_append(self, node_id: int, key: str, value: Any, unique: bool = True):
        update = NodeListUpdate(id=node_id, key=key, value=value, op=ListOpType.APPEND)
        self._apply_list_update_wrapper([update])

    def property_list_remove(self, node_id: int, key: str, value: Any):
        update = NodeListUpdate(id=node_id, key=key, value=value, op=ListOpType.REMOVE)
        self._apply_list_update_wrapper([update])

    def _apply_list_update_wrapper(self, updates: List[NodeListUpdate]):
        def _action():
            with self._transaction_context() as tx:
                self._update_node_lists_atomic(tx, updates)

        self._execute_with_retry(_action)

    def add_edges_batch(self, edges: List[Dict[str, Any]]):
        """
        [Implementation] Direct insert into edges table.
        [Fix] 支持 created_by field persistence.
        [Update] Support semantic edge variants for semantic dedup.
        """
        if not edges: return

        rows = []
        for e in edges:
            src = e.get('src')
            dst = e.get('dst')
            etype = e.get('type')
            creator = e.get('created_by', 'static')  # Default to static
            props = e.get('properties')

            if src is None or dst is None or not etype:
                continue

            props_json = json.dumps(props, ensure_ascii=False) if props else None

            # Compute semantic identity for this edge
            from codedmap.infra.storage.base.edge_identity import edge_semantic_identity
            semantic_slot, semantic_value = edge_semantic_identity(etype, props)

            rows.append((src, dst, etype, props_json, creator, semantic_slot, semantic_value))

        def _action():
            with self._transaction_context() as tx:
                # [Update] Include semantic columns
                tx.executemany(
                    "INSERT OR IGNORE INTO edges (src, dst, type, properties, created_by, semantic_slot, semantic_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    rows
                )

        self._execute_with_retry(_action)

    def add_tags_batch(self, tags: List[Dict[str, Any]]):
        if not tags: return

        def _action():
            with self._transaction_context() as tx:
                for item in tags:
                    node_id = item.get('id')
                    new_tags = set(item.get('tags', []))
                    if not node_id or not new_tags: continue

                    tx.execute("SELECT properties FROM nodes WHERE id = ?", (node_id,))
                    row = tx.fetchone()
                    if not row: continue

                    props = json.loads(row[0]) if row[0] else {}
                    current_tags = set(props.get('tags', []))

                    if not new_tags.issubset(current_tags):
                        updated_tags = list(current_tags.union(new_tags))
                        props['tags'] = updated_tags
                        tx.execute(
                            "UPDATE nodes SET properties = ? WHERE id = ?",
                            (json.dumps(props, ensure_ascii=False), node_id)
                        )

        self._execute_with_retry(_action)

    # --- 3. Atomic Internal Ops (Implemented for BaseGraphWriter) ---

    def _prune_neighbors_atomic(self, tx: Any, prunes: List[PruneRequest]):
        """
        精确清理逻辑。
        """
        for req in prunes:
            type_str = req.edge_type.value if hasattr(req.edge_type, 'value') else str(req.edge_type)

            # 构建基础 SQL
            sql_parts = ["DELETE FROM edges WHERE type=?"]
            params = [type_str]

            # 1. 过滤来源 (created_by)
            if req.created_by is not None:
                sql_parts.append("AND created_by=?")
                params.append(req.created_by)

            # 2. 过滤源节点 (src)
            # 如果 src_id 为 None，表示删除该类型（可能+该来源）的所有边 -> Global Prune
            if req.src_id is not None:
                sql_parts.append("AND src=?")
                params.append(req.src_id)
            else:
                logger.info(f"[Sqlite] Global Prune: Type={type_str}, Creator={req.created_by}")

            # 3. 执行删除
            final_sql = " ".join(sql_parts)
            tx.execute(final_sql, params)

            # [Safe Mode]
            # 默认只删边，不级联删点。因为 PruneRequest 主要用于清理旧的分析结果（边），
            # 而不是清理子图。如果真的需要删点，应该显式调用 delete_nodes。

    def _remove_nodes_atomic(self, tx: Any, node_ids: Set[int]):
        if not node_ids: return
        ids_list = list(node_ids)
        batch_size = 900
        for i in range(0, len(ids_list), batch_size):
            batch = ids_list[i:i + batch_size]
            placeholders = ",".join("?" * len(batch))
            tx.execute(f"DELETE FROM edges WHERE src IN ({placeholders}) OR dst IN ({placeholders})",
                       batch + batch)
            tx.execute(f"DELETE FROM nodes WHERE id IN ({placeholders})", batch)

    def _remove_edges_atomic(self, tx: Any, edges: list):
        for req in edges:
            src = getattr(req, 'src', None)
            dst = getattr(req, 'dst', None)
            etype = getattr(req, 'edge_type', getattr(req, 'type', None))
            type_str = etype.value if hasattr(etype, 'value') else str(etype)

            if dst is None:
                tx.execute("DELETE FROM edges WHERE src=? AND type=?", (src, type_str))
            else:
                tx.execute("DELETE FROM edges WHERE src=? AND dst=? AND type=?", (src, dst, type_str))

    def _add_nodes_atomic(self, tx: Any, nodes: list, strategy: str):
        sql = "INSERT OR REPLACE INTO nodes (id, label, properties) VALUES (?, ?, ?)"
        if strategy == "SKIP_ON_EXIST":
            sql = "INSERT OR IGNORE INTO nodes (id, label, properties) VALUES (?, ?, ?)"

        rows = [SqliteSerializer.node_to_row(n) for n in nodes]
        if rows:
            tx.executemany(sql, rows)

    def _add_edges_atomic(self, tx: Any, edges: list, strategy: str):
        rows = [SqliteSerializer.edge_to_row(e) for e in edges]

        if rows:
            tx.executemany(
                "INSERT INTO edges (src, dst, type, properties, created_by, semantic_slot, semantic_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows
            )

    def _update_nodes_atomic(self, tx: Any, updates: list):
        for up in updates:
            tx.execute("SELECT properties FROM nodes WHERE id=?", (up.id,))
            res = tx.fetchone()
            if res:
                props = json.loads(res[0])
                props.update(up.properties)
                if 'id' in props: del props['id']
                tx.execute("UPDATE nodes SET properties=? WHERE id=?",
                           (json.dumps(props, ensure_ascii=False), up.id))

    def _update_node_lists_atomic(self, tx: Any, updates: list):
        for up in updates:
            tx.execute("SELECT properties FROM nodes WHERE id=?", (up.id,))
            res = tx.fetchone()
            if res:
                props = json.loads(res[0])
                lst = props.get(up.key, [])
                if not isinstance(lst, list): lst = list(lst) if lst else []
                changed = False
                if up.op == ListOpType.APPEND:
                    if up.value not in lst:
                        lst.append(up.value)
                        changed = True
                elif up.op == ListOpType.REMOVE:
                    if up.value in lst:
                        lst.remove(up.value)
                        changed = True
                if changed:
                    props[up.key] = lst
                    tx.execute("UPDATE nodes SET properties=? WHERE id=?",
                               (json.dumps(props, ensure_ascii=False), up.id))