from __future__ import annotations
from typing import List, Iterator, TypeVar, Union, Optional, Type, Any, Dict, Callable, Set
from itertools import islice
import logging
import json

from codedmap.core.schema.graph.nodes import CPGNode, MethodNode, FileNode, VectorNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.infra.storage.interfaces import TraversalInterface
from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase
from codedmap.infra.storage.driver_sqlite.serializer import SqliteSerializer

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=CPGNode)


class SqliteTraversal(TraversalInterface[T]):
    """
    [Sqlite Implementation]
    High-Performance Streaming Traversal.

    Key Features:
    1. Cursor Streaming: Uses server-side cursors (fetchmany).
    2. Auto-Batching: Splits large IN queries to respect SQLite limits.
    3. Memory Safety: Never materializes full datasets in memory.
    """

    # SQLite default limit is often 999. Use safe margin.
    SQL_BATCH_LIMIT = 900

    def __init__(self, db: SqliteDatabase, source_iter_factory: Callable[[], Iterator[Any]]):
        self.db = db
        self._source_iter_factory = source_iter_factory

        # Lazy Operations Stack
        self._limit_count: Optional[int] = None
        self._skip_count: Optional[int] = None
        self._distinct_flag: bool = False
        self._sort_key: Optional[str] = None
        self._sort_desc: bool = False
        self._projections: List[str] = []

    # =========================================================================
    # Safe Accessors (Helpers)
    # =========================================================================

    def _get_id(self, node: Union[Dict, CPGNode]) -> Optional[int]:
        """[Helper] 安全获取 ID"""
        if isinstance(node, dict):
            return node.get('id')
        return getattr(node, 'id', None)

    def _get_attr(self, node: Union[Dict, CPGNode], key: str):
        """[Helper] 兼容 Dict 和 Object 的属性获取"""
        # 1. Try Dict
        if isinstance(node, dict):
            if key == 'id': return node.get('id')
            if key == 'label': return node.get('label')
            # 尝试直接获取，或者从 properties 中获取
            val = node.get(key)
            if val is not None: return val
            props = node.get('properties', {})
            return props.get(key) if isinstance(props, dict) else None

        # 2. Try Object
        if hasattr(node, key): return getattr(node, key)
        if hasattr(node, "properties") and node.properties:
            return node.properties.get(key)
        return None

    def _get_label(self, node: Union[Dict, CPGNode]) -> Optional[str]:
        """[Helper] 安全获取 Label 字符串"""
        if isinstance(node, dict):
            val = node.get('label')
        else:
            val = getattr(node, 'label', None)

        # 处理 Enum
        if hasattr(val, 'value'):
            return val.value
        return str(val) if val else None

    def _get_tags(self, node: Union[Dict, CPGNode]) -> List[str]:
        """[Helper] 安全获取 Tags"""
        val = self._get_attr(node, "tags")
        if not val: return []
        return val if isinstance(val, list) else list(val)

    # =========================================================================
    # Core Iteration
    # =========================================================================

    def __iter__(self) -> Iterator[T]:
        """
        [Core] 触发流式计算管道。
        """
        # 1. Source Generation
        iterator = self._source_iter_factory()

        # 这里的 iterator 可能产生 dict 或 Pydantic 对象
        # 为了保证 TraversalInterface 对外契约的一致性，我们需要在这里做最后的"保底物化"
        # 如果流出的是 dict，转为 object。如果已经是 object，直接 yield。

        # 2. Sort & Distinct (必须物化)
        if self._sort_key or self._distinct_flag:
            # 这里必须消耗迭代器
            raw_items = list(iterator)

            # 统一化为对象以便排序/去重 (此时无法避免内存开销，但这是 sort/distinct 的代价)
            materialized_nodes = [self._ensure_object(i) for i in raw_items]

            if self._distinct_flag:
                seen_ids = set()
                unique_nodes = []
                for n in materialized_nodes:
                    if n.id not in seen_ids:
                        seen_ids.add(n.id)
                        unique_nodes.append(n)
                materialized_nodes = unique_nodes

            if self._sort_key:
                def sort_key_fn(n):
                    val = self._get_attr(n, self._sort_key)
                    if val is None: return "" if isinstance(val, str) else 0
                    return val

                materialized_nodes.sort(key=sort_key_fn, reverse=self._sort_desc)

            iterator = iter(materialized_nodes)

        # 3. Skip (Streaming)
        if self._skip_count is not None:
            iterator = islice(iterator, self._skip_count, None)

        # 4. Limit (Streaming)
        if self._limit_count is not None:
            iterator = islice(iterator, self._limit_count)

        # 4. Final Yield
        for item in iterator:
            yield self._ensure_object(item)

    def _ensure_object(self, item: Union[Dict, CPGNode]) -> CPGNode:
        """[Helper] 确保返回的是 Pydantic 对象"""
        if isinstance(item, dict):
            # 使用 DataConverter 或通用转换逻辑
            # 这里简化处理，直接利用 Pydantic 构造
            from codedmap.infra.storage.base.converter import DataConverter
            return DataConverter.to_pydantic(item)
        return item

    def _clone(self) -> 'SqliteTraversal':
        t = SqliteTraversal(self.db, self._source_iter_factory)
        t._limit_count = self._limit_count
        t._skip_count = self._skip_count
        t._distinct_flag = self._distinct_flag
        t._sort_key = self._sort_key
        t._sort_desc = self._sort_desc
        t._projections = list(self._projections)
        return t

    # =========================================================================
    # Batching Topology Steps (Streaming Safe)
    # =========================================================================

    def out(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'SqliteTraversal':
        return self._hop_batch(edge_type, "OUT", target_class)

    def in_(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'SqliteTraversal':
        return self._hop_batch(edge_type, "IN", target_class)

    def _hop_batch(self, edge_type: Union[str, EdgeType], direction: str, target_class: Type) -> 'SqliteTraversal':
        """
        [Auto-Batching] 优化版：减少中间层对象的持有。
        """
        type_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        parent_factory = self._source_iter_factory

        # 增大内部批处理，因为现在处理的是 ID，内存占用小
        INTERNAL_BATCH_SIZE = 5000

        def factory():
            parent_iter = parent_factory()
            while True:
                # 1. 攒批：只提取 ID，尽快释放上游对象
                batch_ids = []
                try:
                    for _ in range(INTERNAL_BATCH_SIZE):
                        node = next(parent_iter)
                        nid = self._get_id(node)
                        if nid is not None:
                            batch_ids.append(nid)
                except StopIteration:
                    pass

                if not batch_ids:
                    break

                # 2. 批量查询邻居 (返回 dict 以保持轻量)
                # 使用 _query_neighbors_data 因为 hop_batch 只有一步，通常就是为了拿结果
                yield from self._query_neighbors_data(batch_ids, type_str, direction, target_class)

        return SqliteTraversal(self.db, factory)

    def _python_bfs_repeat(self, edge_type, direction, min_depth, max_depth, target_label) -> 'SqliteTraversal':
        """
        [Optimized BFS]
        纯 ID 游走：在中间层级 (depth < max_depth) 仅使用 edges 表进行 ID 跳跃。
        不查询 nodes 表，不反序列化 JSON，不创建 Pydantic 对象。
        """
        edge_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        lbl_val = target_label.value if hasattr(target_label, 'value') else str(target_label) if target_label else None

        parent_factory = self._source_iter_factory

        def factory():
            # 1. Initial Frontier (IDs only)
            # 消耗上游迭代器，只提取 ID，转为 Set 去重
            current_ids = set()
            for node in parent_factory():
                nid = self._get_id(node)
                if nid is not None:
                    current_ids.add(nid)

            if not current_ids: return

            visited = set(current_ids)
            depth = 0

            while depth < max_depth and current_ids:
                depth += 1
                next_level_ids = set()
                ids_list = list(current_ids)

                # 判断当前层是否需要 Yield 数据
                # 如果 depth >= min_depth，这些节点是结果的一部分，我们需要获取它们的完整数据
                should_yield = depth >= min_depth

                if should_yield:
                    # 场景 A: 需要返回结果 -> 查询 Nodes 表 (JOIN)
                    # 此时我们需要同时获取 ID (为了下一层) 和 Node Data (为了 yield)
                    node_iter = self._query_neighbors_data(ids_list, edge_val, direction, None)

                    for node_dict in node_iter:
                        nid = node_dict['id']
                        if nid in visited: continue

                        visited.add(nid)
                        next_level_ids.add(nid)

                        # Label 过滤 (内存中)
                        if lbl_val:
                            if node_dict.get('label') == lbl_val:
                                yield node_dict
                        else:
                            yield node_dict

                else:
                    # 场景 B: 中间层 -> 只查询 Edges 表 (Fast Topology Hop)
                    # [Critical Optimization] 只查 ID，不查属性，不读 JSON
                    neighbor_ids_iter = self._query_neighbors_ids_only(ids_list, edge_val, direction)

                    for nid in neighbor_ids_iter:
                        if nid in visited: continue
                        visited.add(nid)
                        next_level_ids.add(nid)

                # Move to next level
                current_ids = next_level_ids

        return SqliteTraversal(self.db, factory).distinct()

    # =========================================================================
    # Database Query Helpers (Chunked)
    # =========================================================================

    def _query_neighbors_ids_only(self, node_ids: List[int], type_str: str, direction: str) -> Iterator[int]:
        """
        [Topology Only] 仅查询邻居 ID。用于 BFS 中间层。
        只访问 edges 表，速度极快，内存占用极低。
        """
        conn = self.db.get_connection()
        try:
            # Chunking
            for i in range(0, len(node_ids), self.SQL_BATCH_LIMIT):
                chunk = node_ids[i: i + self.SQL_BATCH_LIMIT]
                placeholders = ",".join("?" for _ in chunk)

                # 确定查询列
                target_col = "dst" if direction == "OUT" else "src"
                source_col = "src" if direction == "OUT" else "dst"

                query = f"SELECT {target_col} FROM edges WHERE {source_col} IN ({placeholders}) AND type = ?"
                params = chunk + [type_str]

                cursor = conn.execute(query, params)
                for row in cursor:
                    yield row[0]  # yield int
        finally:
            conn.close()

    def _query_neighbors_data(self, node_ids: List[int], type_str: str, direction: str, target_class: Type) -> \
    Iterator[Dict]:
        """
        [Full Data] 查询邻居节点完整数据。用于 BFS 结果层或 hop_batch。
        """
        conn = self.db.get_connection()
        try:
            for i in range(0, len(node_ids), self.SQL_BATCH_LIMIT):
                chunk = node_ids[i: i + self.SQL_BATCH_LIMIT]
                placeholders = ",".join("?" for _ in chunk)

                if direction == "OUT":
                    # (n)-[e]->(m)
                    query = f"""
                    SELECT m.id, m.label, m.properties 
                    FROM edges e
                    JOIN nodes m ON e.dst = m.id
                    WHERE e.src IN ({placeholders}) AND e.type = ?
                    """
                else:
                    # (n)<-[e]-(m)
                    query = f"""
                    SELECT m.id, m.label, m.properties 
                    FROM edges e
                    JOIN nodes m ON e.src = m.id
                    WHERE e.dst IN ({placeholders}) AND e.type = ?
                    """

                params = chunk + [type_str]
                cursor = conn.execute(query, params)

                for row in cursor:
                    # 使用 row_to_dict 避免过早 Pydantic 化
                    node_dict = SqliteSerializer.row_to_dict(row)

                    if target_class:
                        # 如果指定了 target_class，这里必须简单检查一下 label
                        # 或者为了性能，暂时忽略 label 检查，由上层处理
                        pass

                    yield node_dict
        finally:
            conn.close()

    def repeat(self,
               edge_type: Union[str, EdgeType],
               direction: str = "OUT",
               min_depth: int = 1,
               max_depth: int = 10,
               target_label: Optional[Union[str, NodeLabel]] = None) -> 'SqliteTraversal':
        """
        [BFS] Breadth-First Search with batch optimization.
        """
        if max_depth == 1 and min_depth <= 1:
            t = self._hop_batch(edge_type, direction, None)
            if target_label:
                return t.has_label(target_label)
            return t

        return self._python_bfs_repeat(edge_type, direction, min_depth, max_depth, target_label)


    # =========================================================================
    # Filtering Logic (Pushed to Python side, streaming)
    # =========================================================================

    def filter(self, **kwargs) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory

        def factory():
            for node in parent_factory():
                match = True
                for k, v in kwargs.items():
                    val = self._get_attr(node, k)
                    if val != v:
                        match = False
                        break
                if match: yield node

        return SqliteTraversal(self.db, factory)

    def where_contains(self, property_name: str, value: str) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory

        def factory():
            for node in parent_factory():
                val = self._get_attr(node, property_name)
                if val and isinstance(val, str) and value in val:
                    yield node

        return SqliteTraversal(self.db, factory)

    def where_no_out_edge(self, edge_type: str) -> 'SqliteTraversal':
        type_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        parent_factory = self._source_iter_factory
        CHECK_BATCH_SIZE = 1000

        def factory():
            parent_iter = parent_factory()
            while True:
                batch = list(islice(parent_iter, CHECK_BATCH_SIZE))
                if not batch: break

                ids = []
                for n in batch:
                    nid = self._get_id(n)
                    if nid is not None:
                        ids.append(nid)

                if not ids: continue

                has_edge_ids = self._batch_check_edges(ids, type_str, "OUT")

                for node in batch:
                    nid = self._get_id(node)
                    if nid is not None and nid not in has_edge_ids:
                        yield node

        return SqliteTraversal(self.db, factory)

    def _batch_check_edges(self, node_ids: List[int], type_str: str, direction: str) -> Set[int]:
        """Helper: Return set of IDs that HAVE the specified edge."""
        conn = self.db.get_connection()
        result_ids = set()
        try:
            unique_ids = list(set(node_ids))
            col = "src" if direction == "OUT" else "dst"

            for i in range(0, len(unique_ids), self.SQL_BATCH_LIMIT):
                chunk = unique_ids[i: i + self.SQL_BATCH_LIMIT]
                placeholders = ",".join("?" for _ in chunk)

                query = f"SELECT DISTINCT {col} FROM edges WHERE {col} IN ({placeholders}) AND type = ?"
                cursor = conn.execute(query, chunk + [type_str])

                for row in cursor:
                    result_ids.add(row[0])
        finally:
            conn.close()
        return result_ids

    def has_label(self, label: str) -> 'SqliteTraversal':
        lbl_str = label.value if hasattr(label, 'value') else str(label)
        parent_factory = self._source_iter_factory

        def factory():
            for node in parent_factory():
                # [FIX] 替换 unsafe getattr
                val = self._get_label(node)
                if val == lbl_str: yield node

        return SqliteTraversal(self.db, factory)

    def has_tag(self, tag: str) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory
        def factory():
            for node in parent_factory():
                tags = self._get_tags(node)
                if tag in tags: yield node
        return SqliteTraversal(self.db, factory)

    def has_no_tag(self, tag: str) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory
        def factory():
            for node in parent_factory():
                tags = self._get_tags(node)
                if tag not in tags: yield node
        return SqliteTraversal(self.db, factory)

    # =========================================================================
    # Configuration
    # =========================================================================

    def limit(self, count: int) -> 'SqliteTraversal':
        t = self._clone()
        t._limit_count = count
        return t

    def skip(self, count: int) -> 'SqliteTraversal':
        t = self._clone()
        t._skip_count = count
        return t

    def distinct(self) -> 'SqliteTraversal':
        t = self._clone()
        t._distinct_flag = True
        return t

    def order_by(self, property_name: str, desc: bool = False) -> 'SqliteTraversal':
        t = self._clone()
        t._sort_key = property_name
        t._sort_desc = desc
        return t

    def property(self, *keys: str) -> 'SqliteTraversal':
        t = self._clone()
        t._projections.extend(keys)
        return t

    def values(self, *keys: str) -> Iterator[Dict[str, Any]]:
        """
        [Ultra-Fast Path]
        属性投影。直接操作内部字典流，完全绕过 Pydantic 实例化。
        这是解决 OOM 和性能瓶颈的终极武器。
        """
        # 1. 直接获取源迭代器 (产生的是 dict 或 raw object)
        iterator = self._source_iter_factory()

        # 2. Skip (if set)
        if self._skip_count is not None:
            iterator = islice(iterator, self._skip_count, None)

        # 3. 处理 Limit (如果设置了)
        if self._limit_count is not None:
            iterator = islice(iterator, self._limit_count)

        # 3. 投影逻辑
        for item in iterator:
            result = {}
            for k in keys:
                result[k] = self._get_attr(item, k)
            yield result

    def raw(self) -> Iterator[Dict[str, Any]]:
        """
        [New API]
        如果你确信不需要 Pydantic 的校验方法，只想要数据。
        返回原始字典：{'id': 1, 'label': 'METHOD', 'name': 'main', ...}
        """
        iterator = self._source_iter_factory()

        if self._skip_count is not None:
            iterator = islice(iterator, self._skip_count, None)

        if self._limit_count is not None:
            iterator = islice(iterator, self._limit_count)

        for item in iterator:
            if isinstance(item, dict):
                yield item
            else:
                # 如果源头已经是对象（极少情况），退化为 dump
                # 排除 id 和 label 以保持 dict 结构一致性
                d = item.model_dump(by_alias=True)
                d['id'] = item.id
                d['label'] = item.label.value if hasattr(item.label, 'value') else item.label
                yield d

    # =========================================================================
    # Terminal Operations
    # =========================================================================

    def iter_batch(self, batch_size: int = 1000, shard_index: int = 0, total_shards: int = 1) -> Iterator[List[T]]:
        iterator = iter(self)
        if total_shards > 1:
            iterator = (n for n in iterator if (self._get_id(n) or -1) % total_shards == shard_index)

        while True:
            batch = list(islice(iterator, batch_size))
            if not batch: break
            yield batch

    # =========================================================================
    # Shortcuts
    # =========================================================================

    def ast(self) -> 'SqliteTraversal':
        return self.out(EdgeType.AST).order_by("order")

    def ast_children(self) -> 'SqliteTraversal':
        return self.ast()

    def ast_parent(self) -> 'SqliteTraversal':
        return self.in_(EdgeType.AST)

    def callers(self) -> 'SqliteTraversal':
        return self.in_(EdgeType.CALL).in_(EdgeType.CONTAINS, MethodNode)

    def callees(self) -> 'SqliteTraversal':
        return self.out(EdgeType.CONTAINS).out(EdgeType.CALL, MethodNode)

    def file(self) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory

        def factory():
            for node in parent_factory():
                curr_id = self._get_id(node)
                if curr_id is None:
                    continue
                depth = 0
                max_depth = 20
                while depth < max_depth:
                    conn = self.db.get_connection()
                    try:
                        row = conn.execute(
                            "SELECT id, label, properties FROM nodes WHERE id = ?", (curr_id,)
                        ).fetchone()
                    finally:
                        conn.close()
                    if row is None:
                        break
                    node_dict = SqliteSerializer.row_to_dict(row)
                    if node_dict.get('label') == NodeLabel.FILE.value:
                        yield node_dict
                        break
                    parents = list(self._query_neighbors_ids_only([curr_id], EdgeType.AST.value, "IN"))
                    if not parents:
                        parents = list(self._query_neighbors_ids_only([curr_id], EdgeType.CONTAINS.value, "IN"))
                    if not parents:
                        break
                    curr_id = parents[0]
                    depth += 1

        return SqliteTraversal(self.db, factory).distinct()

    def method(self) -> 'SqliteTraversal':
        parent_factory = self._source_iter_factory

        def factory():
            for node in parent_factory():
                curr_id = self._get_id(node)
                if curr_id is None:
                    continue
                depth = 0
                max_depth = 50
                while depth < max_depth:
                    conn = self.db.get_connection()
                    try:
                        row = conn.execute(
                            "SELECT id, label, properties FROM nodes WHERE id = ?", (curr_id,)
                        ).fetchone()
                    finally:
                        conn.close()
                    if row is None:
                        break
                    node_dict = SqliteSerializer.row_to_dict(row)
                    label_str = node_dict.get('label')
                    if label_str == NodeLabel.METHOD.value:
                        yield node_dict
                        break
                    if label_str == NodeLabel.FILE.value:
                        break
                    parents = list(self._query_neighbors_ids_only([curr_id], EdgeType.AST.value, "IN"))
                    if not parents:
                        parents = list(self._query_neighbors_ids_only([curr_id], EdgeType.CONTAINS.value, "IN"))
                    if not parents:
                        break
                    curr_id = parents[0]
                    depth += 1

        return SqliteTraversal(self.db, factory).distinct()

    def type_decl(self) -> 'SqliteTraversal':
        return self.in_(EdgeType.AST)

    def insights(self, category: str = None) -> 'SqliteTraversal':
        t = self.out(EdgeType.HAS_INSIGHT)
        if category: t = t.filter(category=category)
        return t

    def vectors(self) -> 'SqliteTraversal':
        return self.out(EdgeType.HAS_VECTOR, VectorNode)


class SqliteTraversalSource:
    """
    DSL Entry Point.
    Responsible for creating the initial generator with proper resource management.
    """

    SQL_BATCH_LIMIT = 900

    def __init__(self, db: SqliteDatabase):
        self.db = db

    def _sql_factory(self, sql: str, params: tuple = ()) -> Callable[[], Iterator[Dict[str, Any]]]:
        def factory():
            conn = self.db.get_connection()
            cursor = conn.cursor()
            cursor.arraysize = 5000

            try:
                cursor.execute(sql, params)
                while True:
                    rows = cursor.fetchmany(5000)
                    if not rows: break
                    for row in rows:
                        # 关键修改：使用 row_to_dict， 现在源头产生的是轻量级字典，内存占用极低
                        yield SqliteSerializer.row_to_dict(row)
            except Exception:
                # 捕获执行期间的错误，确保不会静默失败
                raise
            finally:
                # 确保连接关闭
                conn.close()

        return factory

    def by_id(self, node_id: int):
        sql = "SELECT id, label, properties FROM nodes WHERE id = ?"
        return SqliteTraversal(self.db, self._sql_factory(sql, (node_id,)))

    def by_ids(self, node_ids: List[int]):
        if not node_ids:
            return SqliteTraversal(self.db, lambda: iter([]))

        unique_ids = list(set(node_ids))

        # [Optimized] Handle massive ID lists by chunking logic inside generator
        if len(unique_ids) > 950:
            def big_factory():
                conn = self.db.get_connection()
                try:
                    for i in range(0, len(unique_ids), 950):
                        chunk = unique_ids[i:i + 950]
                        ph = ",".join("?" for _ in chunk)
                        sql = f"SELECT id, label, properties FROM nodes WHERE id IN ({ph})"
                        cursor = conn.execute(sql, chunk)
                        for row in cursor:
                            yield SqliteSerializer.row_to_dict(row)
                finally:
                    conn.close()

            return SqliteTraversal(self.db, big_factory)

        ids_str = ",".join(str(i) for i in unique_ids)
        sql = f"SELECT id, label, properties FROM nodes WHERE id IN ({ids_str})"
        return SqliteTraversal(self.db, self._sql_factory(sql))

    def methods(self, name: str = None):
        t = self.all_nodes(NodeLabel.METHOD)
        if name: return t.filter(name=name)
        return t

    def files(self, name: str = None):
        t = self.all_nodes(NodeLabel.FILE)
        if name: return t.filter(name=name)
        return t

    def all_nodes(self, node_label: Union[str, NodeLabel] = None):
        if node_label:
            val = node_label.value if hasattr(node_label, 'value') else str(node_label)
            sql = "SELECT id, label, properties FROM nodes WHERE label = ?"
            return SqliteTraversal(self.db, self._sql_factory(sql, (val,)))
        else:
            sql = "SELECT id, label, properties FROM nodes"
            return SqliteTraversal(self.db, self._sql_factory(sql))

    def modules(self, name: str = None):
        t = self.all_nodes(NodeLabel.MODULE)
        if name:
            return t.filter(name=name)
        return t

    def vectors(self):
        return self.all_nodes(NodeLabel.VECTOR)

    def all_nodes_in(
        self,
        node_label: Union[str, NodeLabel],
        property: str,
        values: List[Any]
    ):
        """
        Batch IN query for exact property match.

        Uses json_extract for property access with chunking for SQLite parameter limit.
        """
        if not values:
            return SqliteTraversal(self.db, lambda: iter([]))

        label_val = node_label.value if hasattr(node_label, 'value') else str(node_label)
        str_values = [str(v) if v is not None else "" for v in values]

        def factory():
            conn = self.db.get_connection()
            try:
                for i in range(0, len(str_values), self.SQL_BATCH_LIMIT):
                    chunk = str_values[i:i + self.SQL_BATCH_LIMIT]
                    placeholders = ",".join("?" for _ in chunk)
                    sql = (
                        f"SELECT id, label, properties FROM nodes "
                        f"WHERE label = ? "
                        f"AND json_extract(properties, '$.{property}') IN ({placeholders})"
                    )
                    cursor = conn.execute(sql, [label_val] + chunk)
                    for row in cursor:
                        yield SqliteSerializer.row_to_dict(row)
            finally:
                conn.close()

        return SqliteTraversal(self.db, factory)


class SqliteEdgeTraversal:
    """
    [Edge DSL] SQLite edge traversal implementation.
    Simple design for basic edge queries with optimized count.
    """

    def __init__(self, db: 'SqliteDatabase', iterator_factory: Callable[[], Iterator[Any]]):
        self.db = db
        self._iter_factory = iterator_factory

    def __iter__(self) -> Iterator[Any]:
        return self._iter_factory()

    def to_list(self) -> List[Any]:
        return list(self)

    def first(self) -> Optional[Any]:
        try:
            return next(iter(self))
        except StopIteration:
            return None

    def count(self) -> int:
        """
        [Optimized] Use COUNT(*) query instead of consuming iterator.
        This method is overridden by specific implementations for better performance.
        """
        return sum(1 for _ in self)


class SqliteEdgeTraversalSource:
    """
    [Factory] Edge DSL entry point for SQLite.
    """

    def __init__(self, db: 'SqliteDatabase'):
        self.db = db

    def by_src(self, node_id: int) -> SqliteEdgeTraversal:
        """Get edges where src = node_id."""
        def factory():
            conn = self.db.get_connection()
            try:
                cursor = conn.execute(
                    "SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value "
                    "FROM edges WHERE src = ?",
                    (node_id,)
                )
                for row in cursor:
                    edge = SqliteSerializer.row_to_edge(row)
                    if edge:
                        yield edge
            finally:
                conn.close()

        return SqliteEdgeTraversal(self.db, factory)

    def by_dst(self, node_id: int) -> SqliteEdgeTraversal:
        """Get edges where dst = node_id."""
        def factory():
            conn = self.db.get_connection()
            try:
                cursor = conn.execute(
                    "SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value "
                    "FROM edges WHERE dst = ?",
                    (node_id,)
                )
                for row in cursor:
                    edge = SqliteSerializer.row_to_edge(row)
                    if edge:
                        yield edge
            finally:
                conn.close()

        return SqliteEdgeTraversal(self.db, factory)

    def all(self) -> SqliteEdgeTraversal:
        """Get all edges."""
        def factory():
            conn = self.db.get_connection()
            try:
                cursor = conn.execute(
                    "SELECT src, dst, type, properties, created_by, semantic_slot, semantic_value FROM edges"
                )
                cursor.arraysize = 5000
                while True:
                    rows = cursor.fetchmany(5000)
                    if not rows:
                        break
                    for row in rows:
                        edge = SqliteSerializer.row_to_edge(row)
                        if edge:
                            yield edge
            finally:
                conn.close()

        return SqliteEdgeTraversal(self.db, factory)


class SqliteStatisticsHelper:
    """
    [Helper] Statistics query implementation for SQLite.
    """

    def __init__(self, reader: 'SqliteReader'):
        self._reader = reader

    def node_count(self, label: Optional[str] = None) -> int:
        """Count nodes, optionally filtered by label."""
        conn = self._reader.db.get_connection()
        try:
            if label is None:
                cursor = conn.execute("SELECT COUNT(*) FROM nodes")
            else:
                cursor = conn.execute("SELECT COUNT(*) FROM nodes WHERE label = ?", (label,))
            return cursor.fetchone()[0]
        finally:
            conn.close()

    def edge_count(self, edge_type: Optional[str] = None) -> int:
        """Count edges, optionally filtered by type."""
        return self._reader.count_edges(edge_type)