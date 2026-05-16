# codedmap/analysis/traversal/call.py

from typing import Iterator, Tuple, Union, Set
from collections import deque
from codedmap.core.schema.graph.nodes import MethodNode, CallNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from .base import BaseGraphNavigator, TraversalDirection


class CallGraphNavigator(BaseGraphNavigator):
    """
    调用图维度导航: 负责 Caller/Callee 关系查询。
    [Refactored] 全面适配 Storage DSL，实现完全惰性化 (Lazy Evaluation)。
    """

    def get_callers(self, method: Union[MethodNode, int]) -> Iterator[CallNode]:
        """
        [Lazy] 查找直接调用者 (Call Sites)。
        Path: (CallNode) -[:CALL]-> (MethodNode)
        """
        # _get_neighbors 现在返回的是 Iterator，直接透传
        return self._get_neighbors(method, EdgeType.CALL, TraversalDirection.IN)

    def get_callees(self, method: Union[MethodNode, int]) -> Iterator[MethodNode]:
        """
        [Lazy] 查找被调用的方法 (Callees)。

        Logic: 找到方法体内的所有 Call 节点 -> 跳转到目标方法。
        Path: (Method) -[:AST*]-> (Call) -[:CALL]-> (TargetMethod)
        """
        method_id = self._ensure_node_id(method)

        # 返回 DSL 查询对象 (TraversalInterface)，它是 Iterable 的。
        # 只有在外部进行循环时，底层才会真正执行分批查询。
        return (self.store.query.by_id(method_id)
                .descendants(target_label=NodeLabel.CALL, max_depth=100)  # 1. 找内部 Call
                .out(EdgeType.CALL, target_class=MethodNode)  # 2. 找目标 Method
                .distinct())  # 3. 流式去重

    def get_recursive_callers(self, method: Union[MethodNode, int], max_depth: int = 5) -> Iterator[MethodNode]:
        """
        [Traceback] 递归查找上游调用该方法的 **Method**。
        [Optimized] 使用生成器实现惰性 BFS。
        """
        start_id = self._ensure_node_id(method)

        # 使用 deque 优化 pop(0) 的性能 (O(N) -> O(1))
        queue = deque([(start_id, 0)])

        # 记录已访问 ID，防止环路死循环 (Caller A calls B, B calls A)
        visited = {start_id}

        while queue:
            curr_mid, depth = queue.popleft()

            if depth >= max_depth:
                continue

            # [Lazy Fetch] 获取当前方法的直接调用者所属的方法
            # 使用 DSL 的 .callers() 快捷方式，它通常映射为 .in_(CALL).method()
            # 这里返回的是一个 Iterator，不会一次性加载所有 Caller
            caller_methods_iter = self.store.query.by_id(curr_mid).callers()

            for caller in caller_methods_iter:
                if caller.id not in visited:
                    visited.add(caller.id)

                    # [Yield Immediately] 找到一个就返回一个，无需等待整层结束
                    yield caller

                    # 只有未达到最大深度时才入队
                    if depth + 1 < max_depth:
                        queue.append((caller.id, depth + 1))

    def get_recursive_callers_with_depth(
        self, method: Union[MethodNode, int], max_depth: int = 5
    ) -> Iterator[Tuple[MethodNode, int]]:
        """
        Like get_recursive_callers, but yields (MethodNode, depth) tuples.

        Depth starts at 1 for direct callers of the target method.
        """
        start_id = self._ensure_node_id(method)
        queue = deque([(start_id, 0)])
        visited = {start_id}

        while queue:
            curr_mid, depth = queue.popleft()
            if depth >= max_depth:
                continue

            caller_methods_iter = self.store.query.by_id(curr_mid).callers()
            for caller in caller_methods_iter:
                if caller.id not in visited:
                    visited.add(caller.id)
                    yield (caller, depth + 1)
                    if depth + 1 < max_depth:
                        queue.append((caller.id, depth + 1))