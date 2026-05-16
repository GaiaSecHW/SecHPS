# codedmap/app/taint/models/state.py

from typing import Tuple
from codedmap.core.schema.graph.nodes import CPGNode

class AnalysisState:
    """
    污点分析的搜索状态。
    包含当前节点、路径历史(ID列表)以及当前的调用栈上下文。
    """
    __slots__ = ('node', 'path_ids', 'call_stack')

    def __init__(self, node: CPGNode, path_ids: Tuple[int, ...], call_stack: Tuple[int, ...]):
        self.node = node
        self.path_ids = path_ids      # 仅存储 ID 以节省内存
        self.call_stack = call_stack  # 调用栈 (CallSite IDs)

    def __hash__(self):
        # 核心去重逻辑：同一个节点，在同一个调用栈下，只访问一次
        # 这就是 Context-Sensitive 的关键：即便是同一个节点，如果由不同的函数调用进来，视为不同状态
        return hash((self.node.id, self.call_stack))

    def __eq__(self, other):
        if not isinstance(other, AnalysisState):
            return False
        return self.node.id == other.node.id and self.call_stack == other.call_stack
