import logging
from typing import Any, Dict, List, Optional, Tuple

from codedmap.core.configs.storage import StorageConfig
from codedmap.core.schema.graph import CPGGraph, CPGNode
from codedmap.core.schema.graph.patch import GraphPatch
from codedmap.core.schema.graph.enums import EdgeDirection

# Interfaces
from codedmap.infra.storage.interfaces import (
    StorageEngine, TraversalSourceProtocol, GraphWriter,
    EdgeTraversalSourceProtocol, StatisticsHelperProtocol
)
# Repositories
from codedmap.infra.storage.repository import (
    InsightRepository, MethodRepository, FileRepository, TagRepository,
    AstRepository, VectorRepository, ModuleRepository
)
from codedmap.infra.storage.audit_log import AuditLogRepository
# Factory
from codedmap.infra.storage.factory import StorageEngineFactory

logger = logging.getLogger(__name__)


class CPGStore:
    """
    [Facade] CPG 存储层的统一门面。
    它现在只作为一个薄层，将请求转发给底层的 StorageEngine。
    """

    def __init__(self, config: StorageConfig):
        self.config = config

        # 1. 创建并连接引擎
        self._engine: StorageEngine = StorageEngineFactory.create(config)
        self._engine.connect()

        # 2. 快捷引用 (Private)
        self._writer: GraphWriter = self._engine.writer

        # 3. 初始化实体 Repos (依赖注入)
        query_source = self._engine.traversal_source

        self._method_repo = MethodRepository(query_source)
        self._file_repo = FileRepository(query_source)
        self._module_repo = ModuleRepository(query_source)
        self.ast = AstRepository(query_source)

        # 需要写权限的 Repo
        self.tags = TagRepository(writer=self._writer, source=query_source, reader=self._engine.reader)
        self.insights = InsightRepository(self._writer, query_source)
        self.vectors = VectorRepository(self._writer, query_source)
        self.audit_log = AuditLogRepository(config.backend, getattr(self._engine, "db", None))

    # =========================================================================
    # Public API - Repository Accessors
    # =========================================================================

    @property
    def query(self) -> TraversalSourceProtocol:
        """DSL 查询入口"""
        return self._engine.traversal_source

    @property
    def edges(self) -> EdgeTraversalSourceProtocol:
        """边遍历入口"""
        return self._engine.edge_source

    @property
    def stats(self) -> StatisticsHelperProtocol:
        """统计查询入口"""
        return self._engine.stats

    @property
    def methods(self) -> MethodRepository:
        return self._method_repo

    @property
    def files(self) -> FileRepository:
        return self._file_repo

    @property
    def modules(self) -> ModuleRepository:
        return self._module_repo

    # =========================================================================
    # Public API - CQRS Operations (Delegates)
    # =========================================================================

    def save(self, graph: CPGGraph):
        """保存图数据"""
        self._writer.save_graph(graph)

    def apply_patch(self, patch: GraphPatch):
        """应用补丁"""
        self._writer.apply_patch(patch)

    def add_edges_batch(self, edges: List[Dict[str, Any]]):
        self._writer.add_edges_batch(edges)

    def add_tags_batch(self, tags: List[Dict[str, Any]]):
        self._writer.add_tags_batch(tags)

    def update_nodes_properties(self, label: str, updates: List[Dict[str, Any]], match_key: str = "id"):
        self._writer.update_nodes_properties(label, updates, match_key)

    def update_node_properties(self, node_id: int, properties: Dict[str, Any]):
        """Facade helper for single node update"""
        payload = properties.copy()
        payload["id"] = node_id
        self._writer.update_nodes_properties("ANY", [payload], match_key="id")

    def delete_nodes(self, node_ids: List[int]):
        self._writer.delete_nodes(node_ids)

    def delete_neighbor_nodes(self, source_node_ids: List[int], edge_type: str, direction: str = "OUT"):
        self._writer.delete_neighbor_nodes(source_node_ids, edge_type, direction)

    # =========================================================================
    # Read & Search Operations
    # =========================================================================

    def get_node(self, node_id: int) -> Optional[CPGNode]:
        return self._engine.reader.get_node(node_id)

    def get_nodes_batch(self, node_ids: List[int]) -> List[CPGNode]:
        return self._engine.reader.get_nodes_batch(node_ids)

    def search_similar_nodes(self, label: str, query_vector: List[float], top_k: int = 5) -> List[Any]:
        """
        语义检索 Facade。
        根据 capabilities 检查是否支持。
        """
        if not self._engine.capabilities.supports_vector_search:
            logger.warning("Current storage backend does not support vector search.")
            return []

        results = self._engine.reader.search_similar_nodes(
            label=label,
            property="embedding",
            query_vector=query_vector,
            top_k=top_k
        )
        return [node for node, score in results]

    def get_neighbors(self, node_id: int, direction: str, edge_types: Optional[List[str]] = None) -> List[int]:
        return self._engine.reader.get_neighbors(node_id, direction, edge_types)

    def get_neighbors_batch(self, node_ids: List[int], direction: str, edge_types: Optional[List[str]]) -> Dict[
        int, List[int]]:
        """批量返回邻居 ID 映射"""
        return self._engine.reader.get_neighbors_batch(node_ids, direction, edge_types)

    def get_neighbor_nodes_batch(self,
                                 node_ids: List[int],
                                 direction: str,
                                 edge_types: Optional[List[str]],
                                 target_labels: Optional[List[str]] = None) -> Dict[int, List['CPGNode']]:
        return self._engine.reader.get_neighbor_nodes_batch(node_ids, direction, edge_types, target_labels)

    def get_subgraph(self, node_ids: List[int]) -> CPGGraph:
        return self._engine.reader.get_subgraph(node_ids)

    def find_edge(self, src: int, dst: int, edge_type: str):
        """
        Find a specific edge by source, destination, and type.
        Returns CPGEdge or None if not found.
        """
        return self._engine.reader.find_edge(src, dst, edge_type)

    # =========================================================================
    # Special Features (Capability Based)
    # =========================================================================

    def load_method_to_memory(self, method_id: int) -> Optional[CPGGraph]:
        """
        混合加载：将特定方法的上下文加载到内存。
        逻辑已下沉到 Reader.get_context_subgraph。
        """
        try:
            # 1. 尝试使用 Reader 的专用上下文加载能力
            graph = self._engine.reader.get_context_subgraph(method_id)
            if graph: return graph
        except NotImplementedError:
            pass  # Reader 没实现专用方法，回退到通用逻辑

        # 2. 通用回退逻辑 (Generic Traversal)
        # 这里的 DSL 逻辑也可以考虑移到 Reader 的基类默认实现中，但为了 Facade 方便暂时保留在此
        # 或者调用 self._engine.reader.get_subgraph + 手动计算 IDs
        return self._generic_context_load(method_id)

    def _generic_context_load(self, method_id: int) -> Optional[CPGGraph]:
        """[Fallback] 使用通用 DSL 加载上下文"""
        try:
            # 使用 first() 检查是否存在
            if not self.query.by_id(method_id).first():
                return None

            descendant_ids = (
                self.query.by_id(method_id)
                .repeat("AST", max_depth=100)  # .descendants()
                .id_list()
            )
            all_ids = [method_id] + descendant_ids
            return self._engine.reader.get_subgraph(all_ids)
        except Exception as e:
            logger.warning(f"Generic context load failed: {e}")
            return None

    def create_bulk_writer(self, output_dir: str, worker_id: str = None):
        """
        [Ingestion Phase] 创建离线批量写入器。

        用于 "Stream-to-Disk" 模式。
        在解析超大型项目时，使用 context manager 获取 writer，
        将数据直接流式写入 CSV/Parquet，而不是直接插入数据库，从而彻底规避 OOM。

        Example:
            with store.create_bulk_writer("./data") as writer:
                writer.write_nodes_stream(parser.nodes())
        """
        # 直接委托给 Engine，Store 不需要知道是写 CSV 还是 Parquet
        return self._engine.create_bulk_writer(output_dir, worker_id)

    def import_bulk_data(self, input_dir: str):
        """
        [Ingestion Phase] 将 create_bulk_writer 生成的数据导入数据库。

        - SQLite: 自动执行导入。
        - Neo4j: 打印导入命令提示（因为需要离线操作）。
        """
        if self._engine.capabilities.supports_programmatic_import:
            self._engine.import_bulk(input_dir)
        else:
            # 对于不支持自动导入的引擎 (Neo4j)，调用它以获取操作指南
            try:
                self._engine.import_bulk(input_dir)
            except NotImplementedError as e:
                # 友好的用户提示
                logger.info(str(e))

    def snapshot(self, output_dir: str):
        """
        [Export Phase] 数据库快照导出 (原 export_csv)。

        用于 "Database-to-Disk" 模式。
        将当前数据库中 **已存储** 的所有数据导出到文件。
        通常用于备份、迁移，或者保存分析后新生成的 Tag 和 Edge。
        """
        if self._engine.capabilities.supports_bulk_export:
            self._engine.snapshot(output_dir)
        else:
            raise NotImplementedError(
                f"Backend {type(self._engine).__name__} does not support snapshot/export."
            )

    # =========================================================================
    # Lifecycle
    # =========================================================================

    def checkpoint(self, mode: str = "TRUNCATE"):
        """
        Force a WAL checkpoint on SQLite backends.

        In bulk mode, large writes accumulate in the WAL file. This method
        forces a checkpoint between pipeline phases to prevent WAL growth
        and optimize subsequent read performance.

        Args:
            mode: Checkpoint mode ("PASSIVE", "FULL", "RESTART", "TRUNCATE").
                  TRUNCATE clears the WAL file, freeing disk space.

        No-op for non-SQLite backends.
        """
        if self.config.backend != "sqlite":
            return

        engine = getattr(self, "_engine", None)
        db = getattr(engine, "db", None)

        if db and hasattr(db, "checkpoint"):
            try:
                db.checkpoint(mode=mode)
            except Exception as e:
                logger.warning(f"WAL checkpoint failed: {e}")

    def init_db(self):
        # 委托给 Engine 的 Connect 过程 (Engine 负责 schema init)
        # 这里仅作保留，如果需要强制刷新
        pass

    def clear_db(self):
        self._engine.clear_database()

    def close(self):
        self._engine.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
