# codedmap/infra/storage/driver_sqlite/reader.py

import json
import math
from typing import List, Dict, Optional, Any, Tuple
from collections import defaultdict

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.nodes import VectorNode
from codedmap.core.schema.graph import CPGGraph
from codedmap.infra.storage.interfaces import GraphReader
from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase
from codedmap.infra.storage.driver_sqlite.serializer import SqliteSerializer


class SqliteReader(GraphReader):
    def __init__(self, db: SqliteDatabase):
        self.db = db

    def get_node(self, node_id: int) -> Optional[Any]:
        conn = self.db.get_connection()
        try:
            cursor = conn.execute("SELECT id, label, properties FROM nodes WHERE id = ?", (node_id,))
            row = cursor.fetchone()
            if row:
                return SqliteSerializer.row_to_node(row)
            return None
        finally:
            conn.close()

    def get_nodes_batch(self, node_ids: List[int]) -> List[Any]:
        """
        批量获取节点对象
        """
        # 1. 快速返回
        if not node_ids:
            return []

        # 2. 去重 (减少 DB 查询量和反序列化开销)
        unique_ids = list(set(node_ids))

        result_nodes = []
        conn = self.db.get_connection()

        try:
            # 3. 分批执行 (Safe Batching)
            # SQLite default host parameter limit is often 999. We use 950 for safety.
            BATCH_LIMIT = 950

            for i in range(0, len(unique_ids), BATCH_LIMIT):
                chunk = unique_ids[i: i + BATCH_LIMIT]

                # 动态构建参数占位符
                placeholders = ",".join("?" for _ in chunk)
                query = f"SELECT id, label, properties FROM nodes WHERE id IN ({placeholders})"

                # 执行查询
                cursor = conn.execute(query, chunk)

                # 序列化结果
                for row in cursor:
                    node = SqliteSerializer.row_to_node(row)
                    if node:
                        result_nodes.append(node)

            return result_nodes

        finally:
            conn.close()

    def get_neighbors(self, node_id: int, direction: str, edge_types: Optional[List[str]]) -> List[int]:
        conn = self.db.get_connection()
        try:
            # 动态构建 SQL
            params = [node_id]
            if direction == "OUT":
                query = "SELECT dst FROM edges WHERE src = ?"
            else:
                query = "SELECT src FROM edges WHERE dst = ?"

            if edge_types:
                placeholders = ",".join("?" for _ in edge_types)
                query += f" AND type IN ({placeholders})"
                params.extend(edge_types)

            cursor = conn.execute(query, params)
            # fetchall 返回的是 List[Row], Row[0] 是 id
            return [row[0] for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_neighbors_batch(self, node_ids: List[int], direction: str, edge_types: Optional[List[str]]) -> Dict[
        int, List[int]]:
        """
        批量获取邻居。使用 IN 查询优化。
        """
        if not node_ids: return {}

        conn = self.db.get_connection()
        try:
            result = defaultdict(list)
            ids_str = ",".join(str(int(uid)) for uid in set(node_ids))  # 安全转换

            base_col = "src" if direction == "OUT" else "dst"
            target_col = "dst" if direction == "OUT" else "src"

            query = f"SELECT src, dst FROM edges WHERE {base_col} IN ({ids_str})"

            params = []
            if edge_types:
                placeholders = ",".join("?" for _ in edge_types)
                query += f" AND type IN ({placeholders})"
                params.extend(edge_types)

            cursor = conn.execute(query, params)

            for row in cursor:
                # row['src'] / row['dst'] based on direction
                key = row[base_col]
                val = row[target_col]
                result[key].append(val)

            return dict(result)
        finally:
            conn.close()

    def get_neighbor_nodes_batch(self,
                                 node_ids: List[int],
                                 direction: str,
                                 edge_types: Optional[List[str]],
                                 target_labels: Optional[List[str]] = None) -> Dict[int, List[CPGNode]]:
        """
        [Implementation] 利用 SQLite JOIN 进行高效过滤和抓取。
        """
        if not node_ids: return {}

        conn = self.db.get_connection()
        try:
            # 1. 参数准备
            # Chunking 依然必要，防止 node_ids 过多导致 SQL 语句过长
            # 这里简化展示，实际应复用 self._chunked_query 或类似的 Batch 逻辑

            result = defaultdict(list)
            unique_ids = list(set(node_ids))

            # 这里的 950 是 SQLite 变量限制的安全阈值
            batch_size = 950

            for i in range(0, len(unique_ids), batch_size):
                chunk = unique_ids[i: i + batch_size]
                id_placeholders = ",".join("?" for _ in chunk)
                params = list(chunk)

                # 2. 构建 SQL
                # 动态构建 WHERE 子句
                where_clauses = [f"e.{'src' if direction == 'OUT' else 'dst'} IN ({id_placeholders})"]

                if edge_types:
                    et_ph = ",".join("?" for _ in edge_types)
                    where_clauses.append(f"e.type IN ({et_ph})")
                    params.extend(edge_types)

                if target_labels:
                    lbl_ph = ",".join("?" for _ in target_labels)
                    where_clauses.append(f"n.label IN ({lbl_ph})")
                    params.extend(target_labels)

                where_sql = " AND ".join(where_clauses)

                # 确定 JOIN 方向
                join_on = "e.dst" if direction == "OUT" else "e.src"
                group_key = "e.src" if direction == "OUT" else "e.dst"

                query = f"""
                SELECT 
                    {group_key} as source_id,
                    n.id, n.label, n.properties
                FROM edges e
                JOIN nodes n ON {join_on} = n.id
                WHERE {where_sql}
                """

                cursor = conn.execute(query, params)

                # 3. 结果序列化
                for row in cursor:
                    src_id = row[0]
                    # row[1:] 对应 (id, label, props)
                    node = SqliteSerializer.row_to_node(row[1:])
                    if node:
                        result[src_id].append(node)

            return result

        finally:
            conn.close()

    def get_subgraph(self, node_ids: List[int]) -> CPGGraph:
        """
        获取子图 (Nodes + Internal Edges)
        """
        graph = CPGGraph()
        if not node_ids: return graph

        conn = self.db.get_connection()
        try:
            ids_str = ",".join(str(int(uid)) for uid in set(node_ids))

            # 1. Fetch Nodes
            n_cursor = conn.execute(f"SELECT id, label, properties FROM nodes WHERE id IN ({ids_str})")
            for row in n_cursor:
                node = SqliteSerializer.row_to_node(row)
                if node: graph.add_node(node)

            # 2. Fetch Internal Edges (src IN ids AND dst IN ids)
            # Query includes semantic columns for proper deserialization
            e_cursor = conn.execute(f"""
                SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value FROM edges
                WHERE src IN ({ids_str}) AND dst IN ({ids_str})
            """)
            for row in e_cursor:
                edge = SqliteSerializer.row_to_edge(row)
                if edge: graph.edges.append(edge)

            return graph
        finally:
            conn.close()

    def search_similar_nodes(self,
                             label: str,
                             property: str,
                             query_vector: List[float],
                             top_k: int = 5,
                             min_score: float = 0.0) -> List[Tuple[Any, float]]:
        """
        [Vector Search]
        SQLite 本身不支持向量。策略：
        1. 从 DB 加载所有 VECTOR 类型的节点到内存。
        2. 在 Python 中计算相似度。
        3. 反向查库获取 Host。
        注意：对于 10w+ 向量，这可能较慢，但在 Analysis 阶段通常是可以接受的。
        """
        candidates = []
        conn = self.db.get_connection()

        try:
            # 1. 加载所有 VectorNode (Label=VECTOR)
            # 必须反序列化以获取 embedding
            cursor = conn.execute("SELECT id, label, properties FROM nodes WHERE label = ?", (NodeLabel.VECTOR.value,))

            for row in cursor:
                v_node = SqliteSerializer.row_to_node(row)
                if not isinstance(v_node, VectorNode) or not v_node.embedding:
                    continue

                # 2. 计算相似度
                score = self._cosine_similarity(query_vector, v_node.embedding)
                if score >= min_score:
                    # 3. 反向查找 Host
                    # 查找 edges 表: dst = v_node.id AND type = HAS_VECTOR
                    h_cursor = conn.execute(
                        "SELECT src FROM edges WHERE dst = ? AND type = ?",
                        (v_node.id, EdgeType.HAS_VECTOR.value)
                    )
                    hosts = h_cursor.fetchall()

                    for h_row in hosts:
                        host_id = h_row[0]
                        # 获取 Host 详情并检查 Label
                        host_node = self.get_node(host_id)
                        if not host_node: continue

                        # 检查 Host Label
                        target_lbl = label.value if hasattr(label, 'value') else str(label)
                        host_lbl = host_node.label.value if hasattr(host_node.label, 'value') else str(host_node.label)

                        if host_lbl == target_lbl:
                            candidates.append((host_node, score))
        finally:
            conn.close()

        # Sort & Limit
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[:top_k]

    def _cosine_similarity(self, v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2): return 0.0
        dot = sum(a * b for a, b in zip(v1, v2))
        norm_a = math.sqrt(sum(a * a for a in v1))
        norm_b = math.sqrt(sum(b * b for b in v2))
        if norm_a == 0 or norm_b == 0: return 0.0
        return dot / (norm_a * norm_b)

    def list_tags(self, prefix: str = None) -> List[str]:
        conn = self.db.get_connection()
        try:
            if prefix is None:
                cursor = conn.execute(
                    "SELECT DISTINCT value "
                    "FROM nodes, json_each(json_extract(properties, '$.tags')) "
                    "WHERE value IS NOT NULL AND value != '' "
                    "ORDER BY value"
                )
            else:
                cursor = conn.execute(
                    "SELECT DISTINCT value "
                    "FROM nodes, json_each(json_extract(properties, '$.tags')) "
                    "WHERE value IS NOT NULL AND value != '' "
                    "  AND UPPER(value) LIKE ? "
                    "ORDER BY value",
                    (prefix.upper() + "%",)
                )
            return [row[0] for row in cursor.fetchall()]
        finally:
            conn.close()

    def count_edges(self, edge_type: Optional[str] = None) -> int:
        """
        Count edges in the database.
        Uses COUNT(*) for optimal performance.
        """
        conn = self.db.get_connection()
        try:
            if edge_type is None:
                cursor = conn.execute("SELECT COUNT(*) FROM edges")
            else:
                cursor = conn.execute("SELECT COUNT(*) FROM edges WHERE type = ?", (edge_type,))
            return cursor.fetchone()[0]
        finally:
            conn.close()

    def find_edge(self, src: int, dst: int, edge_type: str) -> Optional[Any]:
        """
        Find a specific edge by source, destination, and type.
        Uses indexed lookup for performance.
        """
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                "SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value "
                "FROM edges WHERE src = ? AND dst = ? AND type = ? LIMIT 1",
                (src, dst, edge_type)
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return SqliteSerializer.row_to_edge(row)
        finally:
            conn.close()

    def export_to_file(self, path: str, format: str = "json"):
        # 复用 store 的 export 功能，或者简单 dump
        pass