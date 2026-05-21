# codedmap/analysis/traversal/formatter.py

import logging
from enum import Enum
from typing import List, Optional, Union, Dict, Iterable

from codedmap.core.schema.graph.nodes import MethodNode

# 引用 Navigators
from .ast import AstContextNavigator
from .dataflow import DataFlowNavigator

logger = logging.getLogger(__name__)


class ContextLevel(Enum):
    SIGNATURE = "signature"
    SUMMARY = "summary"
    HEAD = "head"
    FULL = "full"


class FocusStrategy(Enum):
    """
    [Strategy] 聚焦策略。
    决定调用链中哪些节点应该被 '高亮' (展示 Full Code)。
    """
    SINK = "sink"  # 聚焦最后一个节点 (默认)
    SOURCE = "source"  # 聚焦第一个节点
    ENDS = "ends"  # 聚焦首尾两个节点 (哑铃模式)
    ALL = "all"  # 全部展开 (慎用，仅限短链)
    # INDEX 策略通过额外参数支持


class ChainFormatter:
    """
    [Presentation Layer] 调用链格式化器.
    [Refactored] 适配惰性迭代器输入，作为 Pipeline 的终结节点。
    """

    def __init__(self, ast_nav: AstContextNavigator, dataflow_nav: DataFlowNavigator):
        self.ast = ast_nav
        self.dataflow = dataflow_nav

    def format_call_chain(self,
                          chain: Iterable[MethodNode],
                          strategy: FocusStrategy = FocusStrategy.SINK,
                          focus_index: Optional[int] = None) -> str:
        """
        格式化调用链。

        Args:
            chain: 方法节点迭代器 (Lazy Iterator)。
            strategy: 聚焦策略。
            focus_index: 当策略为特定索引时使用。
        """
        # 1. [Materialize] 格式化需要全局视野（如计算总长度、定位首尾），
        # 因此必须在此处消耗迭代器。这是符合架构设计的（Terminal Operation）。
        nodes = list(chain)

        if not nodes:
            return "Empty Call Chain"

        total_nodes = len(nodes)
        output_parts = []

        # 2. 预计算每个节点的 Level
        levels = self._calculate_levels(total_nodes, strategy, focus_index)

        for i, node in enumerate(nodes):
            level = levels[i]

            # 3. 渲染内容 (Render)
            node_content = self._render_node(node, level)

            # 4. Header Construction
            # 使用 getattr 防御性访问，兼容部分加载的对象
            file_path = getattr(node, 'file_name', 'unknown') or 'unknown'
            line_num = getattr(node, 'line_number', '?') or '?'
            name = getattr(node, 'name', 'unknown')

            # 在 Header 中标记这是 Focus 节点，方便 LLM 注意
            focus_mark = " [FOCUS]" if level == ContextLevel.FULL else ""
            header = f"[{i}] Method: {name} (File: {file_path}:{line_num}){focus_mark}"

            block = f"{header}\n{node_content}"
            output_parts.append(block)

            # Add connector
            if i < total_nodes - 1:
                output_parts.append(self._get_connector_string())

        return "\n".join(output_parts)

    def _calculate_levels(self, total: int, strategy: FocusStrategy, index: Optional[int]) -> List[ContextLevel]:
        """
        [Core Algorithm] 根据策略计算每个节点的展示等级。
        """
        levels = [ContextLevel.SIGNATURE] * total

        # 定义辅助函数：设置焦点及其邻居
        def set_focus(idx: int):
            if 0 <= idx < total:
                levels[idx] = ContextLevel.FULL
                # 邻居设置为 HEAD (Context Window)
                if idx - 1 >= 0 and levels[idx - 1] != ContextLevel.FULL:
                    levels[idx - 1] = ContextLevel.HEAD
                if idx + 1 < total and levels[idx + 1] != ContextLevel.FULL:
                    levels[idx + 1] = ContextLevel.HEAD

        # 执行策略
        if strategy == FocusStrategy.ALL:
            return [ContextLevel.FULL] * total

        elif strategy == FocusStrategy.SOURCE:
            set_focus(0)

        elif strategy == FocusStrategy.SINK:
            set_focus(total - 1)

        elif strategy == FocusStrategy.ENDS:
            set_focus(0)
            set_focus(total - 1)

        elif index is not None:  # Custom Index
            # 处理负数索引
            target_idx = index
            if target_idx < 0: target_idx = total + target_idx
            set_focus(target_idx)

        return levels

    def _render_node(self, node: MethodNode, level: ContextLevel) -> str:
        """根据等级渲染内容 (包含降级逻辑)"""
        # A. FULL
        if level == ContextLevel.FULL:
            # 这里的 get_context_code 可能会触发 lazy query，但这已经是按需加载了
            code = self.ast.get_context_code(node, max_lines=100, window_strategy=True)
            if code: return f"```python\n{code}\n```"
            return "# Code not available"

        # B. HEAD (ContextLevel.HEAD)
        if level == ContextLevel.HEAD:
            if self._has_summary(node):
                return self._get_summary_view(node)
            return self._get_head_view(node)

        # C. SIGNATURE (Default)
        return self._get_signature_view(node)

    # --- View Helpers ---

    def _get_signature_view(self, node: MethodNode) -> str:
        sig = getattr(node, 'signature', None)
        if not sig:
            name = getattr(node, 'name', 'unknown')
            return f"    def {name}(...): # Signature only"
        return f"    {sig} ..."

    def _get_summary_view(self, node: MethodNode) -> str:
        # 假设 Summary 存储在 properties 中
        summary = getattr(node, 'summary', None)
        # 如果 summary 是 list (多条摘要)，取第一条
        if isinstance(summary, list) and summary:
            summary = summary[0]

        name = getattr(node, 'name', 'unknown')
        return f"    # [AI Summary]: {summary}\n    def {name}(...): ..."

    def _get_head_view(self, node: MethodNode) -> str:
        # 使用 AST Navigator 截取前 10 行
        code = self.ast.get_context_code(node, max_lines=10, window_strategy=False)
        if code:
            return f"```python\n{code}\n```"
        return self._get_signature_view(node)

    def _has_summary(self, node: MethodNode) -> bool:
        return bool(getattr(node, 'summary', None))

    def _get_connector_string(self) -> str:
        return (
            "      │\n"
            "      ▼ (calls)\n"
        )