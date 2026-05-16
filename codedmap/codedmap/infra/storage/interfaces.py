# -*- coding: utf-8 -*-
# codedmap/infra/storage/interfaces.py

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import (
    List, Dict, Any, Optional, Protocol, Tuple, Type, TypeVar,
    Generic, Union, Iterator, ContextManager, TYPE_CHECKING
)

# -----------------------------------------------------------------------------
# Type Forward References (避免运行时循环引用)
# -----------------------------------------------------------------------------
if TYPE_CHECKING:
    from codedmap.core.schema.graph import CPGGraph, CPGEdge
    from codedmap.core.schema.graph.nodes import (
        CPGNode, MethodNode, FileNode, InsightNode, VectorNode, TypeDeclNode,
        ModuleNode
    )
    from codedmap.core.schema.graph.enums import EdgeDirection, EdgeType, NodeLabel
    from codedmap.core.schema.graph.patch import GraphPatch

T = TypeVar("T", bound='CPGNode')


# =============================================================================
# 1. Capability Descriptors (特性描述符 - 替代 hasattr)
# =============================================================================

@dataclass(frozen=True)
class EngineCapabilities:
    """
    [Architectural Decision]
    显式声明后端支持的能力，作为 Feature Flags。
    Store 层应检查此配置，而不是使用 hasattr 或 try-except。
    """
    supports_atomic_batch_ops: bool = False  # 支持原子批量写入
    supports_vector_search: bool = False  # 支持向量索引
    supports_bulk_export: bool = False  # 支持快速导出 (如 CSV)
    supports_transactions: bool = True  # 支持事务
    memory_optimized: bool = False  # 是否为纯内存操作 (提示可不做缓存)
    supports_programmatic_import: bool = False  # 是否支持在 SDK 内直接导入 CSV


# =============================================================================
# 2. Connection & Lifecycle (生命周期)
# =============================================================================

class TransactionContext(ABC):
    """[Contract] 抽象事务上下文"""

    @abstractmethod
    def __enter__(self): ...

    @abstractmethod
    def __exit__(self, exc_type, exc_val, exc_tb): ...


class ConnectionManager(ABC):
    """[Contract] 资源管理"""

    @abstractmethod
    def connect(self):
        """建立连接 / 初始化资源"""
        ...

    @abstractmethod
    def close(self):
        """释放资源 / 关闭连接"""
        ...

    @abstractmethod
    def transaction(self) -> ContextManager:
        """获取写事务上下文"""
        ...


# =============================================================================
# 3. Read/Write Interfaces (CQRS 底层)
# =============================================================================

class GraphReader(ABC):
    """
    [Query Side] 底层原子读取接口。
    用于高性能点查、批量查或特定算法的子图加载。
    """

    @abstractmethod
    def get_node(self, node_id: int) -> Optional['CPGNode']: ...

    @abstractmethod
    def get_nodes_batch(self, node_ids: List[int]) -> List['CPGNode']: ...

    @abstractmethod
    def get_neighbors(self, node_id: int, direction: str, edge_types: Optional[List[str]]) -> List[int]:
        """仅返回邻居 ID"""
        ...

    @abstractmethod
    def get_neighbors_batch(self, node_ids: List[int], direction: str, edge_types: Optional[List[str]]) -> Dict[
        int, List[int]]:
        """批量返回邻居 ID 映射"""
        ...

    @abstractmethod
    def get_neighbor_nodes_batch(self,
                                 node_ids: List[int],
                                 direction: str,
                                 edge_types: Optional[List[str]],
                                 target_labels: Optional[List[str]] = None) -> Dict[int, List['CPGNode']]:
        """
        [Hybrid] 同时获取拓扑和数据。
        支持服务端 Label 过滤，减少不必要的对象传输。
        """
        ...

    @abstractmethod
    def get_subgraph(self, node_ids: List[int]) -> 'CPGGraph':
        """提取给定节点集合及其内部边的子图"""
        ...

    def get_context_subgraph(self, root_id: int) -> Optional['CPGGraph']:
        """
        [Architecture] 将 'load_method_to_memory' 逻辑下沉。
        获取指定节点（通常是 Method）的完整上下文子图（AST + DataFlow）。

        Default: 抛出未实现，由具体 Driver (如 Neo4j) 提供优化实现。
        """
        return None

    @abstractmethod
    def search_similar_nodes(self, label: str, property: str, query_vector: List[float],
                             top_k: int = 5, min_score: float = 0.0) -> List[Tuple['CPGNode', float]]:
        """向量相似度搜索"""
        ...

    @abstractmethod
    def list_tags(self, prefix: str = None) -> List[str]:
        """
        List all unique tags in the database, optionally filtered by prefix.
        Push-down: each driver implements at storage level to avoid materializing nodes.
        prefix: Optional uppercase prefix (e.g. SECURITY). Case-insensitive comparison.
        Returns: Sorted list of unique tag strings.
        """
        ...

    @abstractmethod
    def count_edges(self, edge_type: Optional[str] = None) -> int:
        """
        Count edges in the database.
        edge_type: Optional edge type filter.
        Returns: Total count of edges.
        """
        ...

    @abstractmethod
    def find_edge(self, src: int, dst: int, edge_type: str) -> Optional['CPGEdge']:
        """
        Find a specific edge by source, destination, and type.
        Returns CPGEdge or None if not found.
        """
        ...


class GraphWriter(ABC):
    """
    [Command Side] 底层写入接口。
    负责数据的持久化变更。
    """

    @abstractmethod
    def save_graph(self, graph: 'CPGGraph'):
        """保存或合并整个内存图"""
        ...

    @abstractmethod
    def apply_patch(self, patch: 'GraphPatch'):
        """应用原子图修复补丁"""
        ...

    # --- Atomic Primitives (原子操作原语) ---
    # 这些方法通常在事务内部被调用

    @abstractmethod
    def add_edges_batch(self, edges: List[Dict[str, Any]]): ...

    @abstractmethod
    def add_tags_batch(self, tags: List[Dict[str, Any]]): ...

    @abstractmethod
    def update_nodes_properties(self, label: str, updates: List[Dict[str, Any]], match_key: str = "id"): ...

    @abstractmethod
    def property_list_append(self, node_id: int, key: str, value: Any, unique: bool = True): ...

    @abstractmethod
    def property_list_remove(self, node_id: int, key: str, value: Any): ...

    @abstractmethod
    def delete_nodes(self, node_ids: List[int]): ...

    @abstractmethod
    def delete_neighbor_nodes(self, source_node_ids: List[int], edge_type: str, direction: str = "OUT"): ...


# =============================================================================
# 5. Traversal DSL (核心抽象)
# =============================================================================

class TraversalInterface(Generic[T], ABC):
    """
    [DSL Core] 惰性流式遍历接口。

    Design Pattern: Builder + Iterator.
    所有的步骤（out, filter）都应该返回一个新的 Traversal 实例（或修改自身状态），
    直到终结操作（to_list, iter_batch, first）被调用时才真正执行查询。
    """

    # --- 1. Core Primitives (Driver 必须实现) ---

    @abstractmethod
    def __iter__(self) -> Iterator[T]:
        """
        [Lazy] 触发迭代。
        Driver 必须实现此方法以生成结果流。
        """
        ...

    @abstractmethod
    def out(self, edge_type: Union[str, 'EdgeType'], target_class: Type = None) -> 'TraversalInterface[Any]':
        """(n)-[edge]->(m)"""
        ...

    @abstractmethod
    def in_(self, edge_type: Union[str, 'EdgeType'], target_class: Type = None) -> 'TraversalInterface[Any]':
        """(n)<-[edge]-(m)"""
        ...

    @abstractmethod
    def repeat(self, edge_type: Union[str, 'EdgeType'], direction: str = "OUT",
               min_depth: int = 1, max_depth: int = 10,
               target_label: Union[str, 'NodeLabel'] = None) -> 'TraversalInterface[Any]':
        """BFS/DFS 深度遍历"""
        ...

    @abstractmethod
    def filter(self, **kwargs) -> 'TraversalInterface[T]':
        """精确匹配属性: .filter(name='main')"""
        ...

    @abstractmethod
    def has_label(self, label: Union[str, 'NodeLabel']) -> 'TraversalInterface[T]':
        ...

    @abstractmethod
    def has_tag(self, tag: str) -> 'TraversalInterface[T]':
        ...

    @abstractmethod
    def has_no_tag(self, tag: str) -> 'TraversalInterface[T]':
        ...

    @abstractmethod
    def where_contains(self, property_name: str, value: str) -> 'TraversalInterface[T]':
        ...

    @abstractmethod
    def where_no_out_edge(self, edge_type: Union[str, 'EdgeType']) -> 'TraversalInterface[T]':
        ...

    # --- 2. Configuration & Projection (Driver 必须实现) ---

    @abstractmethod
    def limit(self, count: int) -> 'TraversalInterface[T]':
        """限制结果数量"""
        ...

    @abstractmethod
    def skip(self, count: int) -> 'TraversalInterface[T]':
        """Skip first N results (for pagination). Applied after sorting, before limit."""
        ...

    @abstractmethod
    def distinct(self) -> 'TraversalInterface[T]':
        """结果去重"""
        ...

    @abstractmethod
    def order_by(self, property_name: str, desc: bool = False) -> 'TraversalInterface[T]':
        """排序"""
        ...

    @abstractmethod
    def property(self, *keys: str) -> 'TraversalInterface[T]':
        """
        [Optimization Hint]
        指示后续只需加载特定属性。这不改变返回类型（依然是对象），但可能会使得对象只有部分字段有值。
        """
        ...

    # --- 3. Semantic Shortcuts (Mixin: 提供默认实现，Driver 可按需覆盖) ---

    def ast(self) -> 'TraversalInterface[Any]':
        """AST 子节点"""
        return self.out("AST").order_by("order")

    def ast_parent(self) -> 'TraversalInterface[Any]':
        """AST 父节点"""
        return self.in_("AST")

    def descendants(self, edge_type: Union[str, 'EdgeType'] = "AST",
                    max_depth: int = 100,
                    target_label: Union[str, 'NodeLabel'] = None) -> 'TraversalInterface[Any]':
        """Find all descendant nodes via repeated outgoing edges (default: AST)."""
        return self.repeat(edge_type, "OUT", min_depth=1, max_depth=max_depth,
                           target_label=target_label)

    def files(self, name: str = None) -> 'TraversalInterface[Any]':
        """查找关联的文件节点"""
        # 注意：这里使用了字符串字面量以避免循环导入
        t = self.repeat("AST", "IN", max_depth=20, target_label="FILE")
        if name:
            t = t.filter(name=name)
        return t

    def callers(self) -> 'TraversalInterface[Any]':
        """查找调用者: (Method) -[CONTAINS]-> (Call) -[CALL]-> (Target)"""
        # 这里的 import 必须在方法内部，这是 Python 解决循环引用的标准做法
        from codedmap.core.schema.graph.nodes import MethodNode
        return self.in_("CALL").in_("CONTAINS", target_class=MethodNode)

    def callees(self) -> 'TraversalInterface[Any]':
        """查找被调用者"""
        from codedmap.core.schema.graph.nodes import MethodNode
        return self.out("CONTAINS").out("CALL", target_class=MethodNode)

    def methods(self) -> 'TraversalInterface[Any]':
        """查找所属方法"""
        return self.repeat("AST", "IN", max_depth=20, target_label="METHOD")

    def insights(self, category: str = None) -> 'TraversalInterface[Any]':
        t = self.out("HAS_INSIGHT")
        if category:
            t = t.filter(category=category)
        return t

    def vectors(self) -> 'TraversalInterface[Any]':
        return self.out("HAS_VECTOR")

    # --- 4. Terminal Operations (终结算子 - 触发执行) ---

    def to_list(self) -> List[T]:
        """立即执行并将结果收集为列表"""
        return list(self)

    def first(self) -> Optional[T]:
        """
        [Optimization] 获取第一个结果并立即停止。
        Driver 应优化此操作（如追加 LIMIT 1）。
        """
        # 默认实现：取迭代器第一个
        try:
            return next(iter(self.limit(1)))
        except StopIteration:
            return None

    def count(self) -> int:
        """统计数量"""
        # 默认实现：消耗迭代器计数。Driver 应覆盖为 COUNT(*) 查询。
        return sum(1 for _ in self)

    def id_list(self) -> List[int]:
        """仅返回 ID 列表"""
        # 默认实现：遍历对象取 ID。Driver 应覆盖为只查询 ID 列。
        return [getattr(n, 'id') for n in self if getattr(n, 'id', None) is not None]

    @abstractmethod
    def values(self, *keys: str) -> Iterator[Dict[str, Any]]:
        """
        [Performance] 投影查询。
        直接返回字典流，跳过对象实例化开销。
        """
        ...

    @abstractmethod
    def raw(self) -> Iterator[Dict[str, Any]]:
        """
        [Performance] 返回原始数据字典流 (含 id, label)。
        """
        ...

    @abstractmethod
    def iter_batch(self, batch_size: int = 1000, shard_index: int = 0, total_shards: int = 1) -> Iterator[List[T]]:
        """
        [Scalability] 分页/分片迭代。
        这是处理海量数据（如全库扫描）的推荐方式。
        Driver 应使用 Keyset Pagination (WHERE id > last_id) 实现以保证性能。
        """
        pass


class TraversalSourceProtocol(Protocol):
    """[Factory] DSL 入口协议"""

    def by_id(self, node_id: int) -> TraversalInterface['CPGNode']: ...

    def by_ids(self, node_ids: List[int]) -> TraversalInterface['CPGNode']: ...

    def methods(self, name: str = None) -> TraversalInterface['MethodNode']: ...

    def files(self, name: str = None) -> TraversalInterface['FileNode']: ...

    def all_nodes(self, node_label: Union[str, 'NodeLabel'] = None) -> TraversalInterface['CPGNode']: ...

    def vectors(self) -> TraversalInterface['VectorNode']: ...

    def modules(self, name: str = None) -> TraversalInterface['ModuleNode']: ...

    def all_nodes_in(
        self,
        node_label: Union[str, 'NodeLabel'],
        property: str,
        values: List[Any]
    ) -> TraversalInterface['CPGNode']:
        """
        Batch IN query for exact property match.

        Returns nodes where label matches AND property value is in the provided list.

        Args:
            node_label: Node label (e.g., "CALL", "METHOD", "IDENTIFIER")
            property: Property name to match (e.g., "name", "fullName")
            values: List of values to match against

        Returns:
            TraversalInterface for chaining

        Example:
            store.query.all_nodes_in("CALL", "name", ["recv", "read", "fgets"])
        """
        ...

    def all_nodes_containing_any(
        self,
        node_label: Union[str, 'NodeLabel'],
        property: str,
        substrings: List[str]
    ) -> TraversalInterface['CPGNode']:
        """
        Batch OR-LIKE query for substring match.

        Returns nodes where label matches AND property contains any of the substrings.

        Args:
            node_label: Node label (e.g., "CALL", "METHOD")
            property: Property name to search (e.g., "methodFullName")
            substrings: List of substrings to search for

        Returns:
            TraversalInterface for chaining

        Example:
            store.query.all_nodes_containing_any("CALL", "methodFullName", ["recv", "read"])
        """
        ...


class EdgeTraversalSourceProtocol(Protocol):
    """[Factory] Edge DSL entry point protocol."""

    def by_src(self, node_id: int) -> 'EdgeTraversalInterface':
        """Get edges where src = node_id."""
        ...

    def by_dst(self, node_id: int) -> 'EdgeTraversalInterface':
        """Get edges where dst = node_id."""
        ...

    def all(self) -> 'EdgeTraversalInterface':
        """Get all edges."""
        ...


class EdgeTraversalInterface(ABC):
    """
    [Edge DSL] Lazy edge traversal interface.
    Simple design for basic edge queries.
    """

    @abstractmethod
    def __iter__(self) -> Iterator['CPGEdge']:
        """Iterate over edges."""
        ...

    def to_list(self) -> List['CPGEdge']:
        """Collect all edges as a list."""
        return list(self)

    def first(self) -> Optional['CPGEdge']:
        """Get the first edge or None."""
        try:
            return next(iter(self))
        except StopIteration:
            return None

    @abstractmethod
    def count(self) -> int:
        """Count edges - optimized per backend."""
        ...


class StatisticsHelperProtocol(Protocol):
    """[Helper] Statistics query protocol."""

    def node_count(self, label: Optional[str] = None) -> int:
        """Count nodes, optionally filtered by label."""
        ...

    def edge_count(self, edge_type: Optional[str] = None) -> int:
        """Count edges, optionally filtered by type."""
        ...


class BulkWriterProtocol(Protocol):
    def write_nodes_stream(self, iterator: Iterator[Any]): ...

    def write_edges_stream(self, iterator: Iterator[Any]): ...

    def close(self): ...

    def __enter__(self): ...

    def __exit__(self, *args): ...


# =============================================================================
# 6. Storage Engine (The Root Abstraction)
# =============================================================================

class StorageEngine(ABC):
    """
    [The Bridge] 存储引擎统一抽象。
    CPGStore 唯一持有的对象。
    """

    @property
    @abstractmethod
    def capabilities(self) -> EngineCapabilities:
        """获取引擎能力描述符"""
        ...

    @property
    @abstractmethod
    def reader(self) -> GraphReader:
        """获取读组件"""
        ...

    @property
    @abstractmethod
    def writer(self) -> GraphWriter:
        """获取写组件"""
        ...

    @property
    @abstractmethod
    def traversal_source(self) -> TraversalSourceProtocol:
        """获取 DSL 查询入口"""
        ...

    @property
    @abstractmethod
    def edge_source(self) -> EdgeTraversalSourceProtocol:
        """获取边遍历入口"""
        ...

    @property
    @abstractmethod
    def stats(self) -> StatisticsHelperProtocol:
        """获取统计查询入口"""
        ...

    @abstractmethod
    def connect(self):
        """初始化连接"""
        ...

    @abstractmethod
    def close(self):
        """关闭连接"""
        ...

    @abstractmethod
    def clear_database(self):
        """Drop all data. Dangerous — for testing and reset only."""
        ...

    @abstractmethod
    def transaction(self) -> TransactionContext:
        """获取事务"""
        ...

    # --- Extension Points (特殊能力) ---

    def snapshot(self, output_path: str):
        """
        [Export Phase] 数据库快照导出。
        (原 export_bulk)

        Use Case:
        将当前数据库中**已存储**的所有数据导出到文件。
        用于备份、迁移或保存分析后的结果（包含新生成的 Tag 和 Edge）。

        如果引擎不支持导出 (supports_bulk_export=False)，抛出异常。
        """
        raise NotImplementedError("Snapshot/Export not supported by this engine.")

    @abstractmethod
    def create_bulk_writer(self, output_dir: str, worker_id: str = None) -> 'BulkWriterProtocol':
        """
        [Ingestion Phase] 创建离线批量写入器。

        Use Case:
        在解析超大型项目时，使用此 Writer 将数据流式写入 CSV/Gzip 文件，
        而不是直接插入数据库，从而避免 OOM。
        """
        pass

    def import_bulk(self, input_dir: str):
        """
        [Import Phase] 批量导入数据。

        对于 SQLite: 读取 CSV 并执行批量 INSERT。
        对于 Neo4j: 可能抛出异常并提示用户执行 neo4j-admin import 命令。
        """
        raise NotImplementedError("Import not supported or requires manual execution.")    