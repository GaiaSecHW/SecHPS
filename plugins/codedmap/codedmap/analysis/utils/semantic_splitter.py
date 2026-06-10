# codedmap/analysis/utils/code_splitter.py

import logging
from typing import List, Callable, Iterator, Any
from dataclasses import dataclass

from codedmap.core.schema.graph.base import AstNode
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)


class SemanticCodeSplitter:
    """
    [Generic Analysis Utility] 语义感知代码切割器。

    核心职责：
    利用 AST 拓扑结构，将大代码块递归拆解为小块，同时保持局部语法完整性。

    [Refactored v2.0] 全面惰性化适配：
    1. 使用 yield 流式产出 Chunk。
    2. AST 子节点获取适配 Lazy Storage。
    """

    def __init__(self,
                 store: CPGStore,
                 cost_fn: Callable[[str], int],
                 max_cost: int):
        self.store = store
        self.cost_fn = cost_fn
        self.max_cost = max_cost

    def split(self, node: AstNode) -> Iterator[str]:
        """
        通用入口。返回生成器，流式产出代码块。
        """
        full_code = self._get_code(node)

        # 1. 快速检查 (Fast Path)
        if self.cost_fn(full_code) <= self.max_cost:
            yield full_code
            return

        # 2. 递归拆解 (Recursive Generator)
        raw_chunks_iter = self._recursive_split_gen(node)

        # 3. 流式合并 (Streaming Merge)
        yield from self._merge_small_chunks_gen(raw_chunks_iter)

    def _recursive_split_gen(self, node: AstNode) -> Iterator[str]:
        """递归生成器"""
        node_code = self._get_code(node)

        # Base Case: 自身足够小
        if self.cost_fn(node_code) <= self.max_cost:
            yield node_code
            return

        # Fetch Children (Lazy -> List for Sorting)
        # 注意：这里必须转 List，因为代码切割严重依赖 AST 的物理顺序 (order)。
        # 对于单个 AST 节点来说，子节点数量通常是可控的 (几千以内)，这里的 List 是安全的。
        children_iter = (self.store.query.by_id(node.id)
                         .out(EdgeType.AST)
                         .order_by("order"))  # 使用 Storage 层的排序能力

        # 如果 Storage 层不支持服务端排序，则在 Python 侧排序
        # children = list(children_iter)
        # children.sort(key=lambda x: getattr(x, 'order', 0))

        # 这里假设 order_by 已经生效 (Memory/SQLite 均已支持)
        children_empty = True

        current_buffer = ""

        for child in children_iter:
            children_empty = False
            child_code = self._get_code(child)
            child_cost = self.cost_fn(child_code)

            # 计算 buffer cost (近似值，忽略连接符开销以提升性能)
            buffer_cost = self.cost_fn(current_buffer)

            # Case A: 子节点本身超大 -> 必须递归拆解
            if child_cost > self.max_cost:
                # 先清空缓冲区
                if current_buffer:
                    yield current_buffer
                    current_buffer = ""
                # 递归 yield from
                yield from self._recursive_split_gen(child)
                continue

            # Case B: 加入 buffer 会超标 -> 结算 buffer
            if buffer_cost + child_cost > self.max_cost:
                if current_buffer:
                    yield current_buffer
                current_buffer = child_code
            else:
                # 简单拼接
                current_buffer = f"{current_buffer}\n{child_code}" if current_buffer else child_code

        # 处理叶子节点依然超大的情况
        if children_empty:
            logger.warning(f"Leaf node {getattr(node, 'id', '?')} exceeds cost limit. Yielding as is.")
            yield node_code
            return

        # 结算剩余 buffer
        if current_buffer:
            yield current_buffer

    def _merge_small_chunks_gen(self, raw_chunks: Iterator[str]) -> Iterator[str]:
        """
        [Stream Processor] 流式合并微小块。
        """
        current = ""
        for chunk in raw_chunks:
            if not current:
                current = chunk
                continue

            # 尝试合并
            # 注意：这里的合并是简单的文本拼接。
            # 如果需要更精细的控制，可以记录 Token 数。
            candidate = f"{current}\n{chunk}"

            if self.cost_fn(candidate) <= self.max_cost:
                current = candidate
            else:
                yield current
                current = chunk

        if current:
            yield current

    def _get_code(self, node: AstNode) -> str:
        # 优先使用属性访问，避免异常开销
        code = getattr(node, 'code', None)
        if code is not None:
            return code

        # 兼容旧接口 get_code()
        if hasattr(node, 'get_code'):
            try:
                val = node.get_code()
                if val is not None: return val
            except:
                pass
        return ""