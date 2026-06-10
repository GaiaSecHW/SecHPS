# codedmap/frontend/integrations/joern/importer.py

"""
Joern Neo4j CSV 导入器 — 顶层编排。

两阶段流式导入：
  Pass 1 (节点): 逐行读取 nodes.csv -> 映射 -> 写入 CPGGraph / Store
  Pass 2 (边):   逐行读取 edges.csv -> ID 翻译 -> 写入

用法：
  importer = JoernCSVImporter(config)
  stats = importer.run("/path/to/joern/export")
"""

import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.edges import CPGEdge
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.patch import GraphPatch

from .csv_parser import parse_nodes, parse_edges, find_csv_files
from .mapper import JoernNodeMapper, JoernEdgeMapper
from .id_bridge import JoernIdBridge, IdStrategy

logger = logging.getLogger(__name__)


class ImportStats:
    """导入统计信息。"""

    def __init__(self):
        self.nodes_read = 0
        self.nodes_imported = 0
        self.nodes_skipped = 0
        self.edges_read = 0
        self.edges_imported = 0
        self.edges_skipped = 0
        self.edges_missing_endpoint = 0
        self.duration_seconds = 0.0

    def summary(self) -> str:
        return (
            f"Import completed in {self.duration_seconds:.1f}s: "
            f"nodes={self.nodes_imported}/{self.nodes_read} "
            f"(skipped={self.nodes_skipped}), "
            f"edges={self.edges_imported}/{self.edges_read} "
            f"(skipped={self.edges_skipped}, missing_endpoint={self.edges_missing_endpoint})"
        )


class JoernCSVImporter:
    """
    Joern Neo4j CSV -> codedmap 导入器。

    支持两种写入模式：
    1. 内存模式: 构建 CPGGraph 对象（适合中小项目）
    2. Store 模式: 通过 GraphPatch 批量写入 CPGStore（适合大项目）
    """

    def __init__(
        self,
        id_strategy: IdStrategy = "hybrid",
        skip_unknown_labels: bool = False,
        skip_edge_types: Optional[List[str]] = None,
        batch_size: int = 5000,
    ):
        self.id_strategy = id_strategy
        self.skip_unknown_labels = skip_unknown_labels
        self.skip_edge_types = skip_edge_types or []
        self.batch_size = batch_size

        self._node_mapper = JoernNodeMapper(skip_unknown_labels=skip_unknown_labels)
        self._edge_mapper = JoernEdgeMapper(skip_edge_types=skip_edge_types)
        self._id_bridge = JoernIdBridge(strategy=id_strategy)
        self._stats = ImportStats()

    def run(self, export_dir: str) -> ImportStats:
        """
        执行导入，返回 CPGGraph。

        Args:
            export_dir: Joern 导出目录路径

        Returns:
            ImportStats 统计信息
        """
        start_time = time.time()
        export_path = Path(export_dir)

        logger.info(f"Starting Joern CSV import from: {export_path}")
        logger.info(f"ID strategy: {self.id_strategy}")

        # 查找 CSV 文件
        node_files, edge_files = find_csv_files(export_path)

        # 创建内存图
        graph = CPGGraph()

        # Pass 1: 导入节点
        logger.info("=== Pass 1: Importing nodes ===")
        for node_file in node_files:
            logger.info(f"  Processing: {node_file.name}")
            self._import_nodes_from_file(node_file, graph)

        logger.info(
            f"  Nodes: imported={self._stats.nodes_imported}, "
            f"skipped={self._stats.nodes_skipped}"
        )
        logger.info(f"  {self._id_bridge.get_stats_summary()}")

        # Pass 2: 导入边
        logger.info("=== Pass 2: Importing edges ===")
        for edge_file in edge_files:
            logger.info(f"  Processing: {edge_file.name}")
            self._import_edges_from_file(edge_file, graph)

        logger.info(
            f"  Edges: imported={self._stats.edges_imported}, "
            f"skipped={self._stats.edges_skipped}, "
            f"missing_endpoint={self._stats.edges_missing_endpoint}"
        )

        self._stats.duration_seconds = time.time() - start_time
        logger.info(self._stats.summary())

        self._graph = graph
        return self._stats

    def get_graph(self) -> CPGGraph:
        """获取导入后的 CPGGraph（run() 之后调用）。"""
        if not hasattr(self, "_graph"):
            raise RuntimeError("Call run() before get_graph()")
        return self._graph

    def run_to_store(self, export_dir: str, store) -> ImportStats:
        """
        导入并直接写入 CPGStore。

        通过 GraphPatch 批量写入，适合大规模导入。

        Args:
            export_dir: Joern 导出目录路径
            store: CPGStore 实例

        Returns:
            ImportStats 统计信息
        """
        start_time = time.time()
        export_path = Path(export_dir)

        logger.info(f"Starting Joern CSV import to store from: {export_path}")
        logger.info(f"ID strategy: {self.id_strategy}, batch_size: {self.batch_size}")

        node_files, edge_files = find_csv_files(export_path)

        # Pass 1: 批量写入节点
        logger.info("=== Pass 1: Importing nodes to store ===")
        node_batch: List[CPGNode] = []

        for node_file in node_files:
            logger.info(f"  Processing: {node_file.name}")
            for joern_id, joern_label, joern_props in parse_nodes(node_file):
                self._stats.nodes_read += 1
                node = self._create_node(joern_id, joern_label, joern_props)
                if node is None:
                    self._stats.nodes_skipped += 1
                    continue

                node_batch.append(node)
                self._stats.nodes_imported += 1

                if len(node_batch) >= self.batch_size:
                    self._flush_nodes_to_store(store, node_batch)
                    node_batch.clear()

        if node_batch:
            self._flush_nodes_to_store(store, node_batch)

        logger.info(
            f"  Nodes: imported={self._stats.nodes_imported}, "
            f"skipped={self._stats.nodes_skipped}"
        )

        # Pass 2: 批量写入边
        logger.info("=== Pass 2: Importing edges to store ===")
        edge_batch: List[Dict[str, Any]] = []

        for edge_file in edge_files:
            logger.info(f"  Processing: {edge_file.name}")
            for start_id, end_id, edge_type, edge_props in parse_edges(edge_file):
                self._stats.edges_read += 1
                edge_dict = self._create_edge_dict(start_id, end_id, edge_type, edge_props)
                if edge_dict is None:
                    continue

                edge_batch.append(edge_dict)
                self._stats.edges_imported += 1

                if len(edge_batch) >= self.batch_size:
                    store.add_edges_batch(edge_batch)
                    edge_batch.clear()

        if edge_batch:
            store.add_edges_batch(edge_batch)

        logger.info(
            f"  Edges: imported={self._stats.edges_imported}, "
            f"skipped={self._stats.edges_skipped}, "
            f"missing_endpoint={self._stats.edges_missing_endpoint}"
        )

        self._stats.duration_seconds = time.time() - start_time
        logger.info(self._stats.summary())
        return self._stats

    # =========================================================================
    # Private: 节点处理
    # =========================================================================

    def _import_nodes_from_file(self, node_file: Path, graph: CPGGraph) -> None:
        """从单个 CSV 文件导入节点到 CPGGraph。"""
        for joern_id, joern_label, joern_props in parse_nodes(node_file):
            self._stats.nodes_read += 1
            node = self._create_node(joern_id, joern_label, joern_props)
            if node is None:
                self._stats.nodes_skipped += 1
                continue

            graph.add_node(node)
            self._stats.nodes_imported += 1

    def _create_node(
        self, joern_id: int, joern_label: str, joern_props: Dict[str, Any]
    ) -> Optional[CPGNode]:
        """创建单个 codedmap 节点。"""
        # 1. 映射
        result = self._node_mapper.map_node(joern_label, joern_props)
        if result is None:
            return None

        node_class, kwargs = result

        # 2. ID 翻译
        cpg_id = self._id_bridge.translate_node_id(
            joern_id, joern_label, kwargs
        )
        kwargs["id"] = cpg_id

        # 3. 实例化
        try:
            node = node_class(**kwargs)
            return node
        except Exception as e:
            logger.debug(
                f"Failed to create {node_class.__name__} (label={joern_label}, "
                f"id={joern_id}): {e}"
            )
            # Fallback: 尝试用 GenericNode
            try:
                from codedmap.core.schema.graph.base import GenericNode
                generic = GenericNode(id=cpg_id, label=joern_label, **joern_props)
                return generic
            except Exception:
                return None

    # =========================================================================
    # Private: 边处理
    # =========================================================================

    def _import_edges_from_file(self, edge_file: Path, graph: CPGGraph) -> None:
        """从单个 CSV 文件导入边到 CPGGraph。"""
        for start_id, end_id, edge_type, edge_props in parse_edges(edge_file):
            self._stats.edges_read += 1

            # 1. 映射边类型和属性
            result = self._edge_mapper.map_edge(edge_type, edge_props)
            if result is None:
                self._stats.edges_skipped += 1
                continue

            mapped_type, properties = result

            # 2. 翻译 ID
            src = self._id_bridge.translate_edge_id(start_id)
            dst = self._id_bridge.translate_edge_id(end_id)

            if src is None or dst is None:
                self._stats.edges_missing_endpoint += 1
                continue

            # 3. 添加边
            # graph.add_edge uses **kwargs as properties, so unpack directly
            edge_kwargs = {**properties, "created_by": "joern_import"}
            graph.add_edge(src, dst, type=mapped_type, **edge_kwargs)
            self._stats.edges_imported += 1

    def _create_edge_dict(
        self,
        start_id: int,
        end_id: int,
        edge_type: str,
        edge_props: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """创建边字典（用于 store.add_edges_batch）。"""
        # 1. 映射
        result = self._edge_mapper.map_edge(edge_type, edge_props)
        if result is None:
            self._stats.edges_skipped += 1
            return None

        mapped_type, properties = result

        # 2. ID 翻译
        src = self._id_bridge.translate_edge_id(start_id)
        dst = self._id_bridge.translate_edge_id(end_id)

        if src is None or dst is None:
            self._stats.edges_missing_endpoint += 1
            return None

        return {
            "src": src,
            "dst": dst,
            "type": mapped_type,
            "properties": properties,
            "created_by": "joern_import",
        }

    def _flush_nodes_to_store(self, store, nodes: List[CPGNode]) -> None:
        """将一批节点通过 GraphPatch 写入 store。"""
        patch = GraphPatch(created_by="joern_import")
        for node in nodes:
            patch.add_node(node)
        store.apply_patch(patch)

    @property
    def stats(self) -> ImportStats:
        return self._stats

    @property
    def id_bridge(self) -> JoernIdBridge:
        return self._id_bridge
