# codedmap/infra/storage/driver_neo4j/traversal.py

from __future__ import annotations
from typing import List, TypeVar, Optional, Type, Iterator, Any, Dict, Union
import logging

# [Core Imports]
from codedmap.core.schema.graph.nodes import CPGNode, InsightNode, MethodNode, FileNode, TypeDeclNode, VectorNode, ModuleNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

# [Infra Imports]
from codedmap.infra.storage.interfaces import TraversalInterface
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.infra.storage.base.converter import DataConverter

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=CPGNode)


class Neo4jTraversal(TraversalInterface[T]):
    """
    [Infra] 基于 Neo4j 的惰性图遍历构建器。
    """

    # =========================================================================
    # 1. Lifecycle & Internals
    # =========================================================================

    def __init__(self,
                 client: Neo4jClient,
                 start_query: str,
                 params: Dict[str, Any],
                 model_class: Type[T] = CPGNode):
        self.client = client
        self._query_parts: List[str] = [start_query] if start_query else []
        self._params: Dict[str, Any] = params
        self._model_class = model_class

        # 状态标志
        self._limit: Optional[int] = None
        self._skip: Optional[int] = None
        self._distinct_flag: bool = False

        # 投影字段列表
        self._projections: List[str] = []

    def _clone(self) -> 'Neo4jTraversal':
        """Deep Copy for Builder Pattern"""
        new_t = Neo4jTraversal(self.client, "", self._params.copy(), self._model_class)
        new_t._query_parts = list(self._query_parts)
        new_t._limit = self._limit
        new_t._skip = self._skip
        new_t._distinct_flag = self._distinct_flag
        new_t._projections = list(self._projections)
        return new_t

    def _build_return_clause(self, return_expr: str = "n") -> str:
        """Helper: 构建最终的 RETURN 子句"""
        parts = list(self._query_parts)
        modifier = "DISTINCT " if self._distinct_flag else ""
        full_query = "\n".join(parts)
        full_query += f"\nRETURN {modifier}{return_expr}"
        if self._skip:
            full_query += f" SKIP {self._skip}"
        if self._limit:
            full_query += f" LIMIT {self._limit}"
        return full_query

    # =========================================================================
    # 2. Core Iterator Implementation (Lazy Evaluation)
    # =========================================================================

    def __iter__(self) -> Iterator[T]:
        """
        [Stream] 流式遍历实现。
        """
        # 1. 构建查询语句
        if self._projections:
            cols = [f"n.{k} as {k}" for k in self._projections]
            if "id" not in self._projections:
                cols.insert(0, "n.id as id")
            return_clause = ", ".join(cols)
        else:
            return_clause = "n"

        query = self._build_return_clause(return_clause)
        is_partial = bool(self._projections)

        # 2. 开启 Session 并流式读取
        try:
            with self.client.session() as session:
                result = session.run(query, self._params)
                for record in result:
                    if is_partial:
                        data = dict(record)
                        obj = DataConverter.to_pydantic(data, self._model_class, partial=True)
                    else:
                        obj = DataConverter.to_pydantic(record['n'], self._model_class)

                    if obj:
                        yield obj
        except Exception as e:
            logger.error(f"Error during streaming traversal: {e}")
            raise

    # =========================================================================
    # 3. Terminal Operations (Execution)
    # =========================================================================

    def count(self) -> int:
        """[Optimized] 转化为 SELECT count(*) 查询。"""
        query = self._build_return_clause("count(n) as cnt")
        res = self.client.execute_read(query, self._params)
        if res and res[0]:
            return res[0]['cnt']
        return 0

    def id_list(self) -> List[int]:
        """[Optimized] 仅拉取 ID。"""
        query = self._build_return_clause("n.id as id")
        records = self.client.execute_read(query, self._params)
        return [r['id'] for r in records if r.get('id') is not None]

    def iter_batch(self, batch_size: int = 1000, shard_index: int = 0, total_shards: int = 1) -> Iterator[List[T]]:
        """
        [Keyset Pagination] Neo4j 大规模遍历的最佳实践。
        """
        base_traversal = self.order_by("id")
        last_seen_id = -1

        if shard_index >= total_shards: return

        if total_shards > 1:
            param_shard_idx = f"shard_idx_{len(base_traversal._params)}"
            param_total = f"shard_total_{len(base_traversal._params)}"
            base_traversal._params[param_shard_idx] = shard_index
            base_traversal._params[param_total] = total_shards
            base_traversal._query_parts.append(f"WHERE n.id % ${param_total} = ${param_shard_idx}")

        while True:
            current_batch = base_traversal._clone()
            param_cursor = f"cursor_{len(current_batch._params)}"
            current_batch._params[param_cursor] = last_seen_id
            current_batch._query_parts.append(f"WHERE n.id > ${param_cursor}")
            current_batch._limit = batch_size

            # Materialize current batch (Safe for small batch_size)
            batch_results = list(current_batch)

            if not batch_results:
                break

            yield batch_results

            last_item = batch_results[-1]
            if hasattr(last_item, 'id'):
                last_seen_id = last_item.id
            elif isinstance(last_item, dict):
                last_seen_id = last_item.get('id')
            else:
                break

    # =========================================================================
    # 4. Topology Steps (DSL)
    # =========================================================================

    def out(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'Neo4jTraversal':
        edge_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        t = self._clone()
        t._query_parts.append(f"MATCH (n)-[:`{edge_str}`]->(next)")
        t._query_parts.append("WITH next as n")
        if target_class: t._model_class = target_class
        return t

    def in_(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'Neo4jTraversal':
        edge_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        t = self._clone()
        t._query_parts.append(f"MATCH (n)<-[:`{edge_str}`]-(next)")
        t._query_parts.append("WITH next as n")
        if target_class: t._model_class = target_class
        return t

    def repeat(self,
               edge_type: Union[str, EdgeType],
               direction: str = "OUT",
               min_depth: int = 1,
               max_depth: int = 10,
               target_label: Optional[Union[str, NodeLabel]] = None) -> 'Neo4jTraversal':

        t = self._clone()
        edge_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        range_str = f"*{min_depth}..{max_depth}"
        arrow_body = f"[:`{edge_str}`{range_str}]"

        if direction == "OUT":
            rel_pattern = f"-{arrow_body}->"
        elif direction == "IN":
            rel_pattern = f"<-{arrow_body}-"
        else:
            rel_pattern = f"-{arrow_body}-"

        target_node_pattern = "(next)"
        if target_label:
            lbl_str = target_label.value if hasattr(target_label, 'value') else str(target_label)
            target_node_pattern = f"(next:`{lbl_str}`)"
            target_cls = CPGNode.get_class_by_label(lbl_str)
            if target_cls:
                t._model_class = target_cls
        else:
            t._model_class = CPGNode

        t._query_parts.append(f"MATCH (n){rel_pattern}{target_node_pattern}")
        t._query_parts.append("WITH DISTINCT next as n")
        return t

    # =========================================================================
    # 5. Filtering (Logic Operators)
    # =========================================================================

    def filter(self, **kwargs) -> 'Neo4jTraversal':
        t = self._clone()
        filters = []
        for k, v in kwargs.items():
            if not k.isidentifier(): continue
            param_key = f"filter_{len(t._params)}"
            filters.append(f"n.{k} = ${param_key}")
            t._params[param_key] = v
        if filters:
            t._query_parts.append("WHERE " + " AND ".join(filters))
        return t

    def where_contains(self, property_name: str, value: str) -> 'Neo4jTraversal':
        if not property_name.isidentifier(): return self
        t = self._clone()
        param_key = f"contains_{len(t._params)}"
        t._params[param_key] = value
        t._query_parts.append(f"WHERE n.{property_name} CONTAINS ${param_key}")
        return t

    def where_no_out_edge(self, edge_type: Union[str, EdgeType]) -> 'Neo4jTraversal':
        t = self._clone()
        edge_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        t._query_parts.append(f"WHERE NOT (n)-[:`{edge_str}`]->()")
        return t

    def has_tag(self, tag: str) -> 'Neo4jTraversal':
        t = self._clone()
        t._query_parts.append(f"WHERE '{tag}' IN n.tags")
        return t

    def has_no_tag(self, tag: str) -> 'Neo4jTraversal':
        t = self._clone()
        t._query_parts.append(f"WHERE NOT '{tag}' IN coalesce(n.tags, [])")
        return t

    def has_label(self, label: Union[str, NodeLabel]) -> 'Neo4jTraversal':
        label_str = label.value if hasattr(label, 'value') else str(label)
        t = self._clone()
        t._query_parts.append(f"WHERE n:`{label_str}`")
        return t

    # =========================================================================
    # 6. Configuration & Projection
    # =========================================================================

    def distinct(self) -> 'Neo4jTraversal':
        t = self._clone()
        t._distinct_flag = True
        return t

    def limit(self, count: int) -> 'Neo4jTraversal':
        t = self._clone()
        t._limit = count
        return t

    def skip(self, count: int) -> 'Neo4jTraversal':
        t = self._clone()
        t._skip = count
        return t

    def order_by(self, property_name: str, desc: bool = False) -> 'Neo4jTraversal':
        if not property_name.isidentifier():
            raise ValueError(f"Invalid property name: {property_name}")
        t = self._clone()
        direction = "DESC" if desc else "ASC"
        t._query_parts.append(f"WITH n ORDER BY n.{property_name} {direction}")
        return t

    def property(self, *keys: str) -> 'Neo4jTraversal[T]':
        t = self._clone()
        safe_keys = [k for k in keys if k.isidentifier()]
        t._projections.extend(safe_keys)
        return t

    def values(self, *keys: str) -> Iterator[Dict[str, Any]]:
        """
        [Stream] 流式投影。
        """
        if not keys: return
        safe_keys = [k for k in keys if k.isidentifier()]

        # 临时构建查询，不影响 self 状态
        query_parts = list(self._query_parts)
        modifier = "DISTINCT " if self._distinct_flag else ""
        projections = [f"n.{k} AS {k}" for k in safe_keys]
        full_query = "\n".join(query_parts)
        full_query += f"\nRETURN {modifier}" + ", ".join(projections)

        if self._skip: full_query += f" SKIP {self._skip}"
        if self._limit: full_query += f" LIMIT {self._limit}"

        # 使用流式接口
        try:
            with self.client.session() as session:
                result = session.run(full_query, self._params)
                for record in result:
                    yield dict(record)
        except Exception as e:
            logger.error(f"Error during streaming values: {e}")
            raise

    def raw(self) -> Iterator[Dict[str, Any]]:
        """
        [Stream] 返回原始字典数据 (High Performance)。
        跳过 Pydantic 验证和实例化，但保证 id 和 label 存在。
        """
        # 1. 类似 __iter__ 的查询构建逻辑
        if self._projections:
            # 场景 A: 投影模式 (.property('name', 'code'))
            cols = [f"n.{k} as {k}" for k in self._projections]
            # 强制包含 id，方便后续引用
            if "id" not in self._projections:
                cols.insert(0, "n.id as id")
            # 投影模式下通常不需要 label，除非显式请求 n.label (Neo4j需要用 labels(n))
            # 这里简单处理：如果投影了，就只返回投影的字段
            return_clause = ", ".join(cols)
        else:
            # 场景 B: 全量模式 (RETURN n)
            return_clause = "n"

        query = self._build_return_clause(return_clause)
        is_partial = bool(self._projections)

        try:
            with self.client.session() as session:
                result = session.run(query, self._params)
                for record in result:
                    if is_partial:
                        # 投影模式：直接返回字典
                        yield dict(record)
                    else:
                        # 全量模式：从 Node 对象解包
                        node = record['n']

                        # 1. 提取属性 (dict(node) 仅包含 properties)
                        data = dict(node)

                        # 2. 补全 label (取第一个 label，CPG 约定单 Label)
                        # 注意：Neo4j labels 是一个 FrozenSet
                        if node.labels:
                            data['label'] = next(iter(node.labels))
                        else:
                            data['label'] = 'UNKNOWN'

                        # 3. 确保 id 存在 (如果 id 存在于属性中则已包含，否则可能需要从 element_id 提取)
                        # 根据你的 Schema 设计，id 是显式存储在 properties 里的，所以 data['id'] 应该已有

                        yield data

        except Exception as e:
            logger.error(f"Error during streaming raw: {e}")
            raise

    # =========================================================================
    # 7. Semantic Shortcuts (Keep for Neo4j optimization)
    # =========================================================================

    def ast(self) -> 'Neo4jTraversal':
        return self.out(EdgeType.AST).order_by("order")

    def ast_children(self) -> 'Neo4jTraversal':
        return self.ast()

    def ast_parent(self) -> 'Neo4jTraversal':
        return self.in_(EdgeType.AST)

    def callers(self) -> 'Neo4jTraversal':
        return self.in_(EdgeType.CALL).in_(EdgeType.CONTAINS, target_class=MethodNode)

    def callees(self) -> 'Neo4jTraversal':
        return self.out(EdgeType.CONTAINS).out(EdgeType.CALL, target_class=MethodNode)

    def file(self) -> 'Neo4jTraversal':
        t = self._clone()
        t._query_parts.append(f"MATCH (f:FILE)-[:AST|CONTAINS*1..20]->(n)")
        t._query_parts.append("WITH f as n")
        t._model_class = FileNode
        return t.distinct()

    def method(self) -> 'Neo4jTraversal':
        t = self._clone()
        t._query_parts.append(f"MATCH (m:METHOD)-[:AST|CONTAINS*0..20]->(n)")
        t._query_parts.append("WITH m as n")
        t._model_class = MethodNode
        return t.distinct()

    def type_decl(self) -> 'Neo4jTraversal':
        t = self._clone()
        t._query_parts.append(f"MATCH (td:TYPE_DECL)-[:AST|CONTAINS*0..20]->(n)")
        t._query_parts.append("WITH td as n")
        try:
            t._model_class = TypeDeclNode
        except ImportError:
            pass
        return t.distinct()

    def insights(self, category: str = None) -> 'Neo4jTraversal':
        try:
            target_cls = InsightNode
        except ImportError:
            target_cls = None
        t = self.out(EdgeType.HAS_INSIGHT, target_class=target_cls)
        if category: t = t.filter(category=category)
        return t

    def vectors(self) -> 'Neo4jTraversal':
        return self.out(EdgeType.HAS_VECTOR, target_class=VectorNode)


class Neo4jTraversalSource:
    def __init__(self, client: Neo4jClient):
        self.client = client

    def by_id(self, node_id: int) -> Neo4jTraversal[CPGNode]:
        query = "MATCH (n) WHERE n.id = $start_id"
        return Neo4jTraversal(self.client, query, {"start_id": int(node_id)}, CPGNode)

    def by_ids(self, node_ids: List[int]) -> Neo4jTraversal[CPGNode]:
        # Neo4j handles large IN clauses well, usually up to 65k ids
        query = "MATCH (n) WHERE n.id IN $id_list"
        ids = [int(i) for i in node_ids]
        return Neo4jTraversal(self.client, query, {"id_list": ids}, CPGNode)

    def methods(self, name: str = None) -> Neo4jTraversal[MethodNode]:
        query = "MATCH (n:METHOD)"
        params = {}
        if name:
            query += " WHERE n.name = $start_name"
            params["start_name"] = name
        return Neo4jTraversal(self.client, query, params, MethodNode)

    def files(self, name: str = None) -> Neo4jTraversal[FileNode]:
        query = "MATCH (n:FILE)"
        params = {}
        if name:
            query += " WHERE n.name = $start_name"
            params["start_name"] = name
        return Neo4jTraversal(self.client, query, params, FileNode)

    def all_nodes(self, node_label: Union[str, NodeLabel]) -> Neo4jTraversal[CPGNode]:
        label_str = node_label.value if hasattr(node_label, 'value') else str(node_label)
        target_class = CPGNode.get_class_by_label(label_str)
        query = f"MATCH (n:`{label_str}`)"
        return Neo4jTraversal(self.client, query, {}, target_class)

    def modules(self, name: str = None) -> Neo4jTraversal[ModuleNode]:
        query = "MATCH (n:MODULE)"
        params = {}
        if name:
            query += " WHERE n.name = $start_name"
            params["start_name"] = name
        return Neo4jTraversal(self.client, query, params, ModuleNode)

    def vectors(self) -> Neo4jTraversal:
        from codedmap.core.schema.graph.nodes import VectorNode
        label_str = NodeLabel.VECTOR.value
        query = f"MATCH (n:`{label_str}`)"
        return Neo4jTraversal(self.client, query, {}, VectorNode)

    def all_nodes_in(
        self,
        node_label: Union[str, NodeLabel],
        property: str,
        values: List[Any]
    ) -> Neo4jTraversal[CPGNode]:
        """
        Batch IN query for exact property match.

        Neo4j backend: uses UNWIND for efficient batch matching.
        """
        if not values:
            return Neo4jTraversal(self.client, "MATCH (n) WHERE false", {}, CPGNode)

        label_str = node_label.value if hasattr(node_label, 'value') else str(node_label)
        target_class = CPGNode.get_class_by_label(label_str)
        query = f"MATCH (n:`{label_str}`) WHERE n.{property} IN $values"
        params = {"values": values}
        return Neo4jTraversal(self.client, query, params, target_class)

    def all_nodes_containing_any(
        self,
        node_label: Union[str, NodeLabel],
        property: str,
        substrings: List[str]
    ) -> Neo4jTraversal[CPGNode]:
        """
        Batch OR-LIKE query for substring match.

        Neo4j backend: uses OR-based CONTAINS for substring matching.
        """
        if not substrings:
            return Neo4jTraversal(self.client, "MATCH (n) WHERE false", {}, CPGNode)

        label_str = node_label.value if hasattr(node_label, 'value') else str(node_label)
        target_class = CPGNode.get_class_by_label(label_str)

        where_clauses = [f"n.{property} CONTAINS $substr_{i}" for i in range(len(substrings))]
        query = f"MATCH (n:`{label_str}`) WHERE {' OR '.join(where_clauses)}"
        params = {f"substr_{i}": s for i, s in enumerate(substrings)}
        return Neo4jTraversal(self.client, query, params, target_class)


class Neo4jEdgeTraversal:
    """
    [Edge DSL] Neo4j edge traversal implementation.
    Simple design for basic edge queries with optimized count.
    """

    def __init__(self, client: 'Neo4jClient', query: str, params: Dict[str, Any]):
        self.client = client
        self._query = query
        self._params = params

    def __iter__(self) -> Iterator[Any]:
        from codedmap.infra.storage.base.converter import DataConverter
        with self.client.session() as session:
            result = session.run(self._query, self._params)
            for record in result:
                edge = DataConverter.to_cpg_edge(record)
                if edge:
                    yield edge

    def to_list(self) -> List[Any]:
        return list(self)

    def first(self) -> Optional[Any]:
        try:
            return next(iter(self))
        except StopIteration:
            return None

    def count(self) -> int:
        """
        [Optimized] Use count() aggregation instead of consuming iterator.
        """
        count_query = self._query.replace("RETURN r", "RETURN count(r) as cnt")
        records = self.client.execute_read(count_query, self._params)
        return records[0]['cnt'] if records else 0


class Neo4jEdgeTraversalSource:
    """
    [Factory] Edge DSL entry point for Neo4j.
    """

    def __init__(self, client: 'Neo4jClient'):
        self.client = client

    def by_src(self, node_id: int) -> Neo4jEdgeTraversal:
        """Get edges where src = node_id."""
        query = """
        MATCH (a)-[r]->(b)
        WHERE a.id = $src
        RETURN a.id as src, b.id as dst, type(r) as type, properties(r) as props
        """
        return Neo4jEdgeTraversal(self.client, query, {"src": node_id})

    def by_dst(self, node_id: int) -> Neo4jEdgeTraversal:
        """Get edges where dst = node_id."""
        query = """
        MATCH (a)-[r]->(b)
        WHERE b.id = $dst
        RETURN a.id as src, b.id as dst, type(r) as type, properties(r) as props
        """
        return Neo4jEdgeTraversal(self.client, query, {"dst": node_id})

    def all(self) -> Neo4jEdgeTraversal:
        """Get all edges."""
        query = """
        MATCH (a)-[r]->(b)
        RETURN a.id as src, b.id as dst, type(r) as type, properties(r) as props
        """
        return Neo4jEdgeTraversal(self.client, query, {})


class Neo4jStatisticsHelper:
    """
    [Helper] Statistics query implementation for Neo4j.
    """

    def __init__(self, reader: 'Neo4jReader'):
        self._reader = reader

    def node_count(self, label: Optional[str] = None) -> int:
        """Count nodes, optionally filtered by label."""
        if label is None:
            query = "MATCH (n) RETURN count(n) as cnt"
            records = self._reader.client.execute_read(query, {})
        else:
            query = f"MATCH (n:`{label}`) RETURN count(n) as cnt"
            records = self._reader.client.execute_read(query, {})
        return records[0]['cnt'] if records else 0

    def edge_count(self, edge_type: Optional[str] = None) -> int:
        """Count edges, optionally filtered by type."""
        return self._reader.count_edges(edge_type)