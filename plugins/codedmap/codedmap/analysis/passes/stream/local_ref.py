# codedmap/passes/local_ref_pass.py

from typing import List, Optional, Dict, Callable, Type
from contextlib import contextmanager
import logging
import time

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.analysis.passes.utils.scope import ScopeManager

from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, MethodParameterInNode,
    BlockNode, LocalNode, IdentifierNode, ControlStructureNode,
    TypeDeclNode, CallNode, LiteralNode, JumpTargetNode, ReturnNode,
    FieldIdentifierNode
)
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.operators import Operators

logger = logging.getLogger(__name__)


class LocalRefPass(StreamPass):
    """
    局部引用解析 Pass (Stream Architecture).
    Architectural Decision:
    引入 astParentType 进行防御性编程，严格区分 Stack Variable 和 File-Scope Static Variable。
    """

    def analyze(self, graph: CPGGraph):
        start_time = time.time()
        methods = [
            n for n in graph.nodes.values()
            if isinstance(n, MethodNode) and not getattr(n, 'is_stub', False)
        ]

        stats = {"processed": 0, "ref_edges": 0, "errors": 0}

        for method in methods:
            try:
                processor = LocalRefProcessor(method, graph)
                edges_count = processor.process()
                stats["processed"] += 1
                stats["ref_edges"] += edges_count
            except Exception as e:
                stats["errors"] += 1
                logger.error(f"Error processing Local REF for {method.name}: {e}", exc_info=True)

        duration = time.time() - start_time
        if stats["processed"] > 0:
            logger.info(
                f"[LocalRefPass] Processed {stats['processed']} methods in {duration:.3f}s. "
                f"New Edges: {stats['ref_edges']}"
            )


class LocalRefProcessor:
    def __init__(self, method: MethodNode, graph: CPGGraph):
        self.method = method
        self.graph = graph
        self.scope_manager = ScopeManager()
        self._visited = set()
        self._edges_count = 0

        self._dispatch_table = {
            BlockNode: self.handle_BlockNode,
            ControlStructureNode: self.handle_ControlStructureNode,
            TypeDeclNode: self.handle_TypeDeclNode,
            LocalNode: self.handle_LocalNode,
            IdentifierNode: self.handle_IdentifierNode,
            CallNode: self.handle_CallNode,
            MethodNode: self.handle_MethodNode,  # Stop recursion

            # Leafs
            LiteralNode: self.handle_LeafNode,
            JumpTargetNode: self.handle_LeafNode,
            MethodParameterInNode: self.handle_LeafNode,
            MethodReturnNode: self.handle_LeafNode,
            FieldIdentifierNode: self.handle_LeafNode
        }

    @contextmanager
    def _scope_context(self, node: AnyNode, name: str):
        self.scope_manager.enter_scope(node, name)
        try:
            yield
        finally:
            self.scope_manager.exit_scope()

    def _add_ref_edge(self, src: AnyNode, dst: AnyNode):
        self.graph.add_ref_edge(src, dst)
        self._edges_count += 1

    # =========================================================================
    # Validation Logic (New Feature)
    # =========================================================================

    def _is_valid_local_declaration(self, node: AnyNode) -> bool:
        """
        [Architecture Check]
        判断一个声明节点是否真的属于当前局部作用域。
        防止 Parser 错误地将 Global/Static 变量标记为 LOCAL 从而污染栈分析。
        """
        # 1. 检查 Label
        if not isinstance(node, (LocalNode, MethodParameterInNode)):
            return False

        # 2. 检查 Name
        if not node.name:
            return False

        # 3. 检查 Parent Type
        # 如果 LOCAL 的父节点是 NAMESPACE 或 FILE，它其实是全局变量，应由 Linker 处理
        parent_type = getattr(node, 'astParentType', None)
        if parent_type in ("NAMESPACE_BLOCK", "TRANSLATION_UNIT", "FILE"):
            return False

        return True

    # =========================================================================
    # Process
    # =========================================================================

    def process(self) -> int:
        method_name = self.method.name or str(self.method.id)
        with self._scope_context(self.method, f"Method:{method_name}"):
            children = self.graph.get_ast_children(self.method)

            # 1. 注册参数
            for child in children:
                if isinstance(child, MethodParameterInNode):
                    if self._is_valid_local_declaration(child):
                        self.scope_manager.add_declaration(child.name, child)

            # 2. 遍历方法体
            for child in children:
                if not isinstance(child, (MethodParameterInNode, MethodReturnNode)):
                    self.visit(child)

        return self._edges_count

    def visit(self, node: AnyNode):
        if not node or node.id in self._visited: return
        self._visited.add(node.id)

        handler = self._dispatch_table.get(type(node))
        if handler:
            handler(node)
        else:
            self.visit_children(node)

    def visit_children(self, node: AnyNode):
        for child in self.graph.get_ast_children(node):
            self.visit(child)

    # =========================================================================
    # Handlers
    # =========================================================================

    def handle_LeafNode(self, node: AnyNode):
        pass

    def handle_MethodNode(self, node: MethodNode):
        # Stop recursion for nested methods
        pass

    def handle_BlockNode(self, node: BlockNode):
        with self._scope_context(node, "Block"):
            self.visit_children(node)

    def handle_ControlStructureNode(self, node: ControlStructureNode):
        with self._scope_context(node, f"Ctrl:{node.control_structure_type}"):
            self.visit_children(node)

    def handle_TypeDeclNode(self, node: TypeDeclNode):
        # 即使是内部类，它的成员也不属于当前函数的局部变量
        # 但我们仍然需要遍历 TypeDecl 内部，因为里面可能包含方法定义（虽然 handle_MethodNode 会阻断）
        # 或者初始化块。
        # 这里不注册 TypeDecl 名字本身到局部作用域，因为 Type 引用通常由 Linker 处理
        with self._scope_context(node, f"Type:{node.name}"):
            self.visit_children(node)

    def handle_LocalNode(self, node: LocalNode):
        # [Adaptation] 使用校验逻辑
        if self._is_valid_local_declaration(node):
            self.scope_manager.add_declaration(node.name, node)

        self.visit_children(node)

    def handle_CallNode(self, node: CallNode):
        # Standard logic
        field_access_ops = {Operators.fieldAccess, Operators.indirectFieldAccess, Operators.indexAccess}
        children = self.graph.get_ast_children(node)
        if not children: return

        if node.name in field_access_ops:
            if len(children) >= 1: self.visit(children[0])
            if node.name == Operators.indexAccess and len(children) >= 2: self.visit(children[1])
        else:
            self.visit_children(node)

    def handle_IdentifierNode(self, node: IdentifierNode):
        if not node.name: return

        # 1. 栈上查找
        definition = self.scope_manager.resolve(node.name)

        if definition:
            # 2. [Double Insurance] 再次确认找到的定义是否真的是局部变量
            # 虽然 _is_valid_local_declaration 已经过滤了入栈
            # 但这里可以防止 ScopeManager 内部逻辑出现意外
            if self._is_valid_local_declaration(definition):
                self._add_ref_edge(node, definition)
        else:
            # Not found locally -> Leave for Linker (Global/Static) or Type Ref
            pass