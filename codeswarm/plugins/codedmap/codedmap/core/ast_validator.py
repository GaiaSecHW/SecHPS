# codedmap/core/ast_validator.py

from typing import List, Dict, Set, Any, Optional
from dataclasses import dataclass
import logging

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.core.schema.graph.base import CPGNode

logger = logging.getLogger(__name__)


@dataclass
class CycleReport:
    """AST 环报告"""
    path_ids: List[int]  # 构成环的节点 ID 序列
    path_details: List[str]  # 节点详情摘要 (Label:ID:Code)

    def to_prompt_context(self) -> str:
        """生成用于 LLM 修复的提示上下文"""
        return (
            "Detected AST Cycle:\n"
            f"{' -> '.join(self.path_details)}\n"
            "This implies a parent node is contained within its own children."
        )


class GraphValidator:
    """
    图结构验证器。
    用于检测 AST 环、悬空边等结构性问题。
    """

    def __init__(self, graph: CPGGraph):
        self.graph = graph
        # 0: Unvisited, 1: Visiting (in recursion stack), 2: Visited
        self._colors: Dict[int, int] = {}
        self._parent_map: Dict[int, int] = {}  # 用于回溯路径 reconstruct path
        self._cycles: List[CycleReport] = []

    def find_ast_cycles(self) -> List[CycleReport]:
        """
        检测图中所有的 AST 环。
        Returns: 包含环信息的列表。
        """
        self._colors.clear()
        self._parent_map.clear()
        self._cycles.clear()

        # 遍历图中所有节点作为起点 (处理非连通图)
        # 仅关注可能是 AST 节点的节点 (有 ID 的)
        node_ids = list(self.graph.nodes.keys())

        for node_id in node_ids:
            if self._colors.get(node_id, 0) == 0:
                self._dfs_detect_cycle(node_id)

        if self._cycles:
            logger.warning(f"[GraphValidator] Found {len(self._cycles)} AST cycles!")

        return self._cycles

    def _dfs_detect_cycle(self, u_id: int):
        # Mark as Visiting (Gray)
        self._colors[u_id] = 1

        # 获取所有 AST 子节点
        # 注意：直接操作底层索引以提高性能，避免对象实例化开销
        out_edges = self.graph._out_index.get(u_id, [])
        ast_children_ids = [e.dst for e in out_edges if e.type == EdgeType.AST]

        for v_id in ast_children_ids:
            v_color = self._colors.get(v_id, 0)

            if v_color == 1:
                # Found a cycle! (Gray -> Gray)
                # v_id is the start of the loop in the current stack
                self._record_cycle(start_node=v_id, end_node=u_id)

            elif v_color == 0:
                # Continue DFS
                self._parent_map[v_id] = u_id
                self._dfs_detect_cycle(v_id)

        # Mark as Visited (Black)
        self._colors[u_id] = 2

    def _record_cycle(self, start_node: int, end_node: int):
        """
        回溯路径构造环报告。
        Cycle path: start -> ... -> end -> start
        """
        path = []
        curr = end_node

        # 回溯直到找到 start_node
        while curr != start_node:
            path.append(curr)
            curr = self._parent_map.get(curr)
            if curr is None:
                # 防御性编程：理论上不应发生，除非 parent_map 状态不一致
                path.append(start_node)
                break

        path.append(start_node)
        path.reverse()  # 现在是 start -> ... -> end
        path.append(start_node)  # 闭合环

        # 提取详细信息供 LLM 使用
        details = []
        for nid in path:
            node = self.graph.nodes.get(nid)
            if node:
                label = getattr(node, 'label', 'UNKNOWN')
                # 截取部分 Code 防止过长
                code = getattr(node, 'code', '') or ''
                if len(code) > 50: code = code[:47] + "..."
                details.append(f"[{label}:{nid} `{code}`]")
            else:
                details.append(f"[MISSING:{nid}]")

        self._cycles.append(CycleReport(path_ids=path, path_details=details))