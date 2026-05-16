# codedmap/app/taint/core/context.py

from typing import Optional, Tuple
from codedmap.core.schema.graph.nodes import CPGNode, MethodParameterInNode, MethodReturnNode, CallNode

class CallStackManager:
    """
    负责管理 Context-Sensitive 分析中的调用栈变更。
    实现 k-limiting 策略防止无限递归。
    """
    def __init__(self, max_depth: int = 5):
        self.max_depth = max_depth

    def update_context(self, src: CPGNode, dst: CPGNode, current_stack: Tuple[int, ...]) -> Optional[Tuple[int, ...]]:
        """
        根据边的流向（src -> dst）计算新的调用栈。

        Returns:
            Tuple: 新的栈
            None: 表示路径在当前上下文中非法（如 Return 到了错误的调用点）
        """

        # 1. 函数进入 (Function Entry): Call/Argument -> Parameter
        if isinstance(dst, MethodParameterInNode):
            # 防止栈溢出 (k-limiting)
            if len(current_stack) >= self.max_depth:
                return None

            # Push: 记录调用点 (src 的 ID)
            # 在 CPG 中，通常是从 Argument 流向 Parameter，我们记录这个 Argument 作为 Return 的锚点
            return current_stack + (src.id,)

        # 2. 函数返回 (Function Exit): MethodReturn -> Call/Argument
        elif isinstance(src, MethodReturnNode):
            # 2.1 空栈：允许返回到任意位置 (支持从中间开始分析)
            if not current_stack:
                return current_stack

            # 2.2 非空栈：必须匹配栈顶的调用点
            expected_return_site_id = current_stack[-1]

            # 检查 dst 是否是合法的返回位置
            # 简单校验：如果 dst 的 ID 等于栈顶记录的 ID，则匹配成功
            # 注意：如果记录的是 Argument ID，这里 dst 也应该是 Argument ID
            if dst.id == expected_return_site_id:
                return current_stack[:-1] # Pop

            # 不匹配，视为非法路径 (Context Mismatch)
            return None

        # 3. 过程内 (Intra-procedural): 栈保持不变
        return current_stack
