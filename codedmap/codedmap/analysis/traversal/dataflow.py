# codedmap/analysis/traversal/dataflow.py

from typing import Dict, List, Union, Tuple, Set, Literal, Iterator
from itertools import chain
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from .base import BaseGraphNavigator, TraversalDirection

# 定义切片方向类型
SliceDirection = Literal["IN", "OUT", "BOTH"]


class DataFlowNavigator(BaseGraphNavigator):
    """
    数据流维度导航: 负责 Def-Use 链追踪和切片。
    [Refactored v3.0] 适配 Lazy Storage，引入矢量化上下文查询。
    """

    def get_definitions(self, node: Union[CPGNode, int]) -> Iterator[CPGNode]:
        """
        [Lazy] Backward: Find Reaching Definitions (One Hop).
        Returns an iterator, not a list.
        """
        return self._get_neighbors(node, EdgeType.DDG, TraversalDirection.IN)

    def get_usages(self, node: Union[CPGNode, int]) -> Iterator[CPGNode]:
        """
        [Lazy] Forward: Find Usages (One Hop).
        Returns an iterator, not a list.
        """
        return self._get_neighbors(node, EdgeType.DDG, TraversalDirection.OUT)

    def get_data_slice(self,
                       node: Union[CPGNode, int],
                       direction: SliceDirection = "IN",
                       max_depth: int = 5) -> str:
        """
        生成数据流切片（文本形式）。

        [Optimization Strategy]:
        1. 使用 DSL 收集数据流节点 (Lazy Fetch)。
        2. 提取所有节点 ID，进行一次批量的上下文查询 (Batch Context Fetch)，替代循环查询。
        3. 仅在最后格式化阶段进行必要的属性访问。
        """
        start_id = self._ensure_node_id(node)

        # 容器：用于去重和后续处理
        # 虽然最终要排序输出文本，我们需要先收集对象
        collected_nodes: Dict[int, CPGNode] = {}

        # -------------------------------------------------------
        # 1. 收集数据流节点 (Data Flow Trace)
        # -------------------------------------------------------
        iterators = []

        # 构造查询方向
        if direction in ("IN", "BOTH"):
            iterators.append(
                self.store.query.by_id(start_id)
                .repeat(EdgeType.DDG, direction="IN", max_depth=max_depth)
            )

        if direction in ("OUT", "BOTH"):
            iterators.append(
                self.store.query.by_id(start_id)
                .repeat(EdgeType.DDG, direction="OUT", max_depth=max_depth)
            )

        # 消费迭代器，收集节点和ID
        # chain(*iterators) 将多个方向的流合并为一个
        for n in chain(*iterators):
            if n.id not in collected_nodes:
                collected_nodes[n.id] = n

        # -------------------------------------------------------
        # 2. 批量补充控制流上下文 (Vectorized Context Fetch)
        # -------------------------------------------------------
        # 原逻辑：for n in nodes: query_parent(n) -> N 次查询
        # 新逻辑：query.by_ids(all_ids).repeat(...) -> 1 次查询 (底层自动分批)

        ddg_node_ids = list(collected_nodes.keys())

        if ddg_node_ids:
            # 语义：找到这些数据流节点所属的控制结构 (AST 向上找 1-3 层)
            control_iter = (
                self.store.query.by_ids(ddg_node_ids)
                .repeat(
                    EdgeType.AST,
                    direction="IN",
                    min_depth=1,
                    max_depth=3,
                    target_label=NodeLabel.CONTROL_STRUCTURE
                )
            )

            for cn in control_iter:
                if cn.id not in collected_nodes:
                    collected_nodes[cn.id] = cn

        # -------------------------------------------------------
        # 3. 确保包含起始节点本身 (Ensure Start Node)
        # -------------------------------------------------------
        if start_id not in collected_nodes:
            # 尝试获取起始节点对象
            if isinstance(node, CPGNode):
                collected_nodes[start_id] = node
            else:
                # 只有在之前的查询没覆盖到 start_id 时才去查 DB
                start_node_obj = self.store.query.by_id(start_id).first()
                if start_node_obj:
                    collected_nodes[start_id] = start_node_obj

        # -------------------------------------------------------
        # 4. 提取属性、排序与格式化 (Formatting)
        # -------------------------------------------------------
        slice_entries: List[Tuple[int, str]] = []

        for nid, n_obj in collected_nodes.items():
            # 使用基类保留的 safe accessor 获取属性 (处理 None 和 alias)
            code = self._get_node_attr(n_obj, 'code')
            line = self._get_node_attr(n_obj, 'line_number')

            # 过滤掉无效节点 (如无源码的隐式节点)
            if code and line is not None:
                try:
                    # 标记起始节点
                    prefix = ">> " if nid == start_id else "   "
                    # 清理代码空白
                    clean_code = code.strip()
                    slice_entries.append((int(line), f"{prefix}{clean_code}"))
                except (ValueError, TypeError):
                    pass

        if not slice_entries:
            return ""

        # 按行号排序
        slice_entries.sort(key=lambda x: x[0])

        # 生成最终文本 (去重行)
        unique_lines = []
        seen_lines = set()

        for line, code_str in slice_entries:
            if line not in seen_lines:
                unique_lines.append(f"Line {line:<4} | {code_str}")
                seen_lines.add(line)

        return "\n".join(unique_lines)

    def get_data_slice_structured(self,
                                   node: Union[CPGNode, int],
                                   direction: SliceDirection = "IN",
                                   max_depth: int = 5) -> List[Dict]:
        """
        Like get_data_slice, but returns structured entries for JSON output.

        Returns list of dicts sorted by line number:
        [{node_id, file, line, code, is_origin, label}, ...]
        """
        start_id = self._ensure_node_id(node)
        collected_nodes: Dict[int, CPGNode] = {}

        # 1. Collect data flow nodes
        iterators = []
        if direction in ("IN", "BOTH"):
            iterators.append(
                self.store.query.by_id(start_id)
                .repeat(EdgeType.DDG, direction="IN", max_depth=max_depth)
            )
        if direction in ("OUT", "BOTH"):
            iterators.append(
                self.store.query.by_id(start_id)
                .repeat(EdgeType.DDG, direction="OUT", max_depth=max_depth)
            )

        for n in chain(*iterators):
            if n.id not in collected_nodes:
                collected_nodes[n.id] = n

        # 2. Ensure start node is included
        if start_id not in collected_nodes:
            if isinstance(node, CPGNode):
                collected_nodes[start_id] = node
            else:
                start_node_obj = self.store.query.by_id(start_id).first()
                if start_node_obj:
                    collected_nodes[start_id] = start_node_obj

        # 3. Build structured entries
        entries = []
        for nid, n_obj in collected_nodes.items():
            code = self._get_node_attr(n_obj, 'code')
            line = self._get_node_attr(n_obj, 'line_number')
            file_path = (self._get_node_attr(n_obj, 'file_name')
                         or getattr(n_obj, 'fileName', None))
            label = getattr(n_obj, 'label', 'UNKNOWN')
            if hasattr(label, 'value'):
                label = label.value

            if code and line is not None:
                try:
                    entries.append({
                        "node_id": nid,
                        "file": file_path,
                        "line": int(line),
                        "code": code.strip(),
                        "is_origin": nid == start_id,
                        "label": str(label),
                    })
                except (ValueError, TypeError):
                    pass

        entries.sort(key=lambda x: x["line"])
        return entries