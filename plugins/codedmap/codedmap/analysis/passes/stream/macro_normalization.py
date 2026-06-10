import logging
from typing import List, Optional

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import CallNode, BlockNode, ControlStructureNode
from codedmap.core.schema.graph.enums import ControlStructureType, EdgeType
from codedmap.core.configs.c_cpp_macros import MacroRegistry

logger = logging.getLogger(__name__)


class MacroNormalizationPass(StreamPass):
    """
    [Stream Phase] 宏语义归一化 Pass.

    职责：
    1. 静态识别 (Registry): 将在白名单中的宏标记为 semantic_type="LOOP"。
    2. 动态启发 (Heuristic): 将结构可疑(Call后跟Block且含跳转)的未知宏标记为 suspicious_macro=True。
    3. 结构修正 (Surgery): 对确认为循环的宏进行 AST 重组，将流离的 Block 兄弟归位为子节点。
    """

    def analyze(self, graph: CPGGraph):
        # [Safety] 创建节点列表副本，防止在遍历过程中因 AST 结构调整(添加/删除边)导致迭代器失效
        all_nodes = list(graph.nodes.values())

        for node in all_nodes:
            if isinstance(node, CallNode):
                self._normalize_call(node, graph)

    def _normalize_call(self, node: CallNode, graph: CPGGraph):
        is_loop = False

        # 1. L1 Check: 静态注册表 (白名单 + 正则)
        if MacroRegistry.is_loop(node.name):
            is_loop = True

        # 2. L2 Check: 结构启发式 (针对未知宏)
        elif self._is_suspicious(node, graph):
            if node.metadata is None: node.metadata = {}
            node.metadata["suspicious_macro"] = True

        # 3. 如果确认为循环，执行归一化操作
        if is_loop:
            if node.metadata is None: node.metadata = {}
            # TODO BUG，在cfg看不到semantic_type
            node.metadata["semantic_type"] = "LOOP"

            # [AST Surgery] 修复由 Parser 导致的 AST 结构分离问题
            self._reparent_trailing_block(node, graph)

    def _reparent_trailing_block(self, node: CallNode, graph: CPGGraph):
        """
        [AST Surgery] 核心修复逻辑。
        """
        parent = graph.get_ast_parent(node)
        if not parent: return

        siblings = graph.get_ast_children(parent)
        try:
            my_index = siblings.index(node)
        except ValueError:
            return

        # 检查是否存在下一个兄弟节点
        if my_index + 1 >= len(siblings):
            return

        next_sibling = siblings[my_index + 1]

        # 判定条件：下一个兄弟必须是 BlockNode
        if isinstance(next_sibling, BlockNode):
            # 1. 从原父节点断开
            graph.remove_edge(parent, next_sibling, EdgeType.AST)

            # 2. 计算新的 AST Order
            current_children = graph.get_ast_children(node)
            base_order = 0

            if current_children:
                last_child = current_children[-1]
                last_order = getattr(last_child, 'order', 0)
                if last_order is None:
                    last_order = 0
                base_order = last_order

            new_order = base_order + 1

            # 3. 挂载到 Macro 节点下
            next_sibling.order = new_order
            graph.add_edge(node, next_sibling, EdgeType.AST)

    def _is_suspicious(self, node: CallNode, graph: CPGGraph) -> bool:
        """
        结构特征检查。
        """
        # 特征 A: Trailing Block
        parent = graph.get_ast_parent(node)
        if parent:
            siblings = graph.get_ast_children(parent)
            try:
                my_index = siblings.index(node)
                if my_index + 1 < len(siblings):
                    next_node = siblings[my_index + 1]
                    if isinstance(next_node, BlockNode):
                        if self._contains_orphan_jump(next_node, graph):
                            return True
            except ValueError:
                pass

        # 特征 B: Argument Block
        children = graph.get_ast_children(node)
        for child in children:
            if isinstance(child, BlockNode):
                if self._contains_orphan_jump(child, graph):
                    return True

        return False

    def _contains_orphan_jump(self, start_node: BlockNode, graph: CPGGraph) -> bool:
        """
        深度扫描 Block，查找属于当前层级的 Break/Continue。
        [Fix] 增加 visited 集合，防止因 AST 环导致的死循环。
        """
        # 使用栈进行深度优先搜索
        stack = [start_node]
        visited = set()  # [Safe] 初始化访问记录

        while stack:
            curr = stack.pop()

            # [Safe] 环检测：如果节点已访问，直接跳过
            if curr.id in visited:
                continue
            visited.add(curr.id)

            # 1. 遇到内层控制结构：停止该分支的下探
            if isinstance(curr, ControlStructureNode) and curr.control_structure_type in [
                ControlStructureType.FOR, ControlStructureType.WHILE,
                ControlStructureType.SWITCH, ControlStructureType.DO
            ]:
                continue

            # 2. 发现目标：Break/Continue
            if isinstance(curr, ControlStructureNode):
                if curr.control_structure_type in [ControlStructureType.BREAK, ControlStructureType.CONTINUE]:
                    return True

            # 3. 继续遍历子节点
            children = graph.get_ast_children(curr)
            stack.extend(reversed(children))

        return False