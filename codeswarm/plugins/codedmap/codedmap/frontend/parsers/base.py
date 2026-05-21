# codedmap/frontend/parsers/base.py

import logging
import time
import os
from abc import ABC, abstractmethod
from typing import Optional, Any

from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import ParseStrategy
from codedmap.core.schema.graph import AnyNode
from codedmap.core.schema.graph.nodes import MethodNode, TypeDeclNode
from codedmap.utils.path_utils import normalize_path

logger = logging.getLogger("cpg.parser")


class AbstractParser(ABC):
    """
    [Layer 0] 所有解析器的顶层抽象接口。
    定义了 "Input(File) -> Output(Graph)" 的标准契约。
    增强功能: 自动统计解析耗时与图构建增量。
    """

    def __init__(self, builder: CPGBuilder, project_root: str = None):
        self.builder = builder
        self.project_root = project_root
        self.current_filename: str = ""
        self.strategy: ParseStrategy = ParseStrategy.FULL

    def parse_file(self, file_path: str, strategy: ParseStrategy = ParseStrategy.FULL) -> AnyNode:
        self.current_filename = normalize_path(file_path, self.project_root, True)
        self.strategy = strategy

        start_time = time.time()

        # [Stats Init] 记录解析前的最大 ID
        # 利用 Graph 的内部状态，避免全量集合运算
        # 假设 graph 维护了 _max_id (我们在 graph.py 中定义的)
        # 如果 _max_id 是 PrivateAttr，可以通过 self.builder.graph.nodes.keys() 获取 max
        graph_ref = self.builder.graph
        start_max_id = graph_ref._max_id if hasattr(graph_ref, '_max_id') else (
            max(graph_ref.nodes.keys()) if graph_ref.nodes else 0)

        initial_edge_count = len(graph_ref.edges)

        # 文件大小
        file_size_kb = 0.0
        try:
            file_size_kb = os.path.getsize(file_path) / 1024.0
        except OSError:
            pass

        parse_result = None
        status = "OK"

        try:
            # Step A: 解析
            parse_result = self._parse_implementation(file_path)

            # Step B: 构建
            if parse_result:
                self.run(self.current_filename, parse_result)
            else:
                status = "EMPTY"

        except Exception as e:
            status = "FAIL"
            logger.error(f"Failed to parse {file_path}: {e}", exc_info=True)
            # 根据 Worker 逻辑决定是否 raise
            # raise e

        finally:
            duration = time.time() - start_time

            # [Stats Calculation]
            # 1. 基础计数
            final_edge_count = len(graph_ref.edges)
            delta_edges = final_edge_count - initial_edge_count

            # 2. 智能节点统计 (只统计新增的)
            # 我们只遍历 ID > start_max_id 的节点
            new_nodes = [
                node for nid, node in graph_ref.nodes.items()
                if nid > start_max_id
            ]
            delta_nodes = len(new_nodes)

            # 3. 关键类型细分 (Key Breakdown)
            # 只关心 Method 和 TypeDecl (Struct/Class)
            methods_count = 0
            types_count = 0

            for n in new_nodes:
                if isinstance(n, MethodNode):
                    methods_count += 1
                elif isinstance(n, TypeDeclNode):
                    types_count += 1

            # 构造日志详情字符串
            details = f"+{delta_nodes} Nodes, +{delta_edges} Edges"
            if methods_count > 0 or types_count > 0:
                details += f" ({methods_count} Methods, {types_count} Types)"

            log_msg = (
                f"[{self.__class__.__name__}] {os.path.basename(file_path)} "
                f"({file_size_kb:.1f}KB) | {status} | {duration:.3f}s | {details}"
            )

            # Log Strategy
            if duration > 1.0 or status == "FAIL":
                logger.info(log_msg)
            else:
                logger.debug(log_msg)

        return parse_result

    @abstractmethod
    def _parse_implementation(self, file_path: str) -> Any:
        """
        [Hook] 子类实现具体的解析动作。
        """
        pass

    @abstractmethod
    def run(self, filename: str, parse_result: Any):
        """
        [Hook] 具体的图构建逻辑。
        """
        pass