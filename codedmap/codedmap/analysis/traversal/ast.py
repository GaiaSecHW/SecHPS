# codedmap/analysis/traversal/ast.py

import logging
from typing import Optional, List, Union, Iterator, Dict

from codedmap.core.schema.graph.nodes import MethodNode, FileNode, TypeDeclNode, NamespaceBlockNode, LiteralNode, \
    AnnotationNode
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from .base import BaseGraphNavigator, TraversalDirection

logger = logging.getLogger(__name__)


class AstContextNavigator(BaseGraphNavigator):
    """
    AST 维度导航: 负责代码位置、层级结构查询。
    [Refactored v2.6] 全面适配惰性化 Storage 接口。
    """

    # =========================================================================
    # 1. Parent / Container Lookup (Upward)
    # =========================================================================

    def get_enclosing_method(self, node: Union[CPGNode, int]) -> Optional[MethodNode]:
        """向上查找所属方法"""
        return self._find_ancestor(node, MethodNode)

    def batch_get_enclosing_methods(self, node_ids: List[int]) -> Dict[int, Optional[MethodNode]]:
        """
        Batch version of get_enclosing_method().

        Efficiently resolves parent METHOD for multiple nodes using batch operations.

        Args:
            node_ids: List of node IDs to resolve

        Returns:
            Dict mapping node_id -> MethodNode (or None if not found)

        Example:
            nav = AstContextNavigator(store)
            method_map = nav.batch_get_enclosing_methods([1, 2, 3])
        """
        return self.batch_find_ancestor(node_ids, MethodNode)

    def get_enclosing_file(self, node: Union[CPGNode, int]) -> Optional[FileNode]:
        """
        向上查找所属文件。
        """
        node_id = self._ensure_node_id(node)
        return self.store.query.by_id(node_id).file().first()

    def batch_get_enclosing_files(self, node_ids: List[int]) -> Dict[int, Optional[FileNode]]:
        """
        Batch version of get_enclosing_file().

        Efficiently resolves parent FILE for multiple nodes using batch operations.

        Args:
            node_ids: List of node IDs to resolve

        Returns:
            Dict mapping node_id -> FileNode (or None if not found)

        Example:
            nav = AstContextNavigator(store)
            file_map = nav.batch_get_enclosing_files([1, 2, 3])
        """
        return self.batch_find_ancestor(node_ids, FileNode)

    def get_enclosing_type(self, node: Union[CPGNode, int]) -> Optional[TypeDeclNode]:
        """向上查找所属类型定义 (Class/Struct)"""
        node_id = self._ensure_node_id(node)
        # 尝试使用 shortcut，如果 backend 不支持，回退到 _find_ancestor
        try:
            return self.store.query.by_id(node_id).type_decl().first()
        except (AttributeError, NotImplementedError):
            pass
        return self._find_ancestor(node, TypeDeclNode)

    def get_enclosing_namespace(self, node: Union[CPGNode, int]) -> Optional[NamespaceBlockNode]:
        return self._find_ancestor(node, NamespaceBlockNode)

    # =========================================================================
    # 2. Child Lookup (Downward) - Return Iterators Preferred
    # =========================================================================

    def get_methods_in_file(self, file_node: Union[FileNode, int]) -> Iterator[MethodNode]:
        """
        获取文件内定义的所有方法。
        [Lazy] 返回 Iterator，而非 List。
        """
        file_id = self._ensure_node_id(file_node)
        # 使用 descendants DSL，driver 会处理递归
        return iter(self.store.query.by_id(file_id)
                    .descendants(target_label=NodeLabel.METHOD, max_depth=100))

    def get_methods_in_type(self, type_decl: Union[TypeDeclNode, int]) -> Iterator[MethodNode]:
        """
        获取类型定义内的所有方法。
        [Lazy] 返回 Iterator。
        """
        type_id = self._ensure_node_id(type_decl)
        return iter(self.store.query.by_id(type_id)
                    .descendants(target_label=NodeLabel.METHOD, max_depth=50))

    def get_base_types(self, type_decl: Union[TypeDeclNode, int]) -> Iterator[TypeDeclNode]:
        """
        获取基类。
        [Lazy] 返回 Iterator。
        """
        # _get_neighbors 已经重构为返回 Iterator
        return self._get_neighbors(type_decl, EdgeType.INHERITS_FROM, TraversalDirection.OUT)

    # =========================================================================
    # 3. Metadata Extraction (New Features)
    # =========================================================================

    def get_docstring(self, node: Union[MethodNode, TypeDeclNode, int]) -> Optional[str]:
        """
        [New] 尝试提取 Docstring。
        逻辑：查找 AST 子节点中的第一个 LITERAL 节点（通常是 Python 的 docstring）。
        """
        node_id = self._ensure_node_id(node)

        # 惰性迭代：一旦找到匹配的 docstring，立即停止遍历
        candidates = (self.store.query.by_id(node_id)
                      .ast_children()  # Method -> Block
                      .ast_children()  # Block -> Literal
                      .has_label(NodeLabel.LITERAL)
                      .limit(3))       # Limit pushed to DB if possible

        for cand in candidates:
            code = getattr(cand, 'code', '')
            # 简单的 heuristic: 检查是否被引号包裹
            if code.startswith('"""') or code.startswith("'''") or code.startswith('"') or code.startswith("'"):
                return code.strip('"\' \n')

        return None

    def get_annotations(self, node: Union[MethodNode, TypeDeclNode, int]) -> List[str]:
        """
        [New] 提取注解/装饰器 (Annotations)。
        返回 List[str] 是合理的，因为 annotation 数量通常很少。
        """
        node_id = self._ensure_node_id(node)

        try:
            annotations = (self.store.query.by_id(node_id)
                           .ast_children()
                           .has_label(NodeLabel.ANNOTATION)) # Lazy iterator

            # 只有在列表推导时才触发加载
            return [getattr(ann, 'code', getattr(ann, 'name', '')) for ann in annotations]
        except Exception:
            return []

    # =========================================================================
    # 4. Code Context Extraction (Logic mostly unchanged)
    # =========================================================================

    def get_context_code(self, node: Union[CPGNode, int], max_lines: int = 50, window_strategy: bool = True) -> \
            Optional[str]:
        """
        [Enhanced] 获取节点的代码上下文。
        """
        container_node = self.get_enclosing_method(node)
        container_type = "METHOD"

        if not container_node:
            container_node = self.get_enclosing_file(node)
            container_type = "FILE"

        if not container_node:
            # logger.debug(f"get_context_code: No enclosing context found for node {self._ensure_node_id(node)}")
            return None

        full_code = self._get_node_attr(container_node, 'code')

        if not full_code:
            return None

        lines = full_code.split('\n')
        if max_lines <= 0 or len(lines) <= max_lines:
            return full_code

        is_file = (container_type == "FILE")

        if window_strategy:
            return self._extract_smart_window(node, container_node, lines, max_lines, is_file_container=is_file)
        else:
            return self._extract_code_head(lines, max_lines)

    def _extract_smart_window(self, node: CPGNode, container: CPGNode, lines: List[str], max_lines: int,
                              is_file_container: bool) -> str:
        """
        [Logic] 智能截取代码窗口，处理行号偏移。
        """
        target_line = self._get_node_attr(node, 'line_number')
        if target_line is None:
            return self._extract_code_head(lines, max_lines)

        if is_file_container:
            target_index = target_line - 1
        else:
            method_start = self._get_node_attr(container, 'line_number', default=1)
            target_index = target_line - method_start

        half = max_lines // 2
        start_index = max(0, target_index - half)
        end_index = min(len(lines), start_index + max_lines)

        if end_index - start_index < max_lines and start_index > 0:
            start_index = max(0, end_index - max_lines)

        parts = []
        if start_index > 0:
            parts.append(f"... [{start_index} lines hidden] ...")

        parts.extend(lines[start_index:end_index])

        if end_index < len(lines):
            remaining = len(lines) - end_index
            parts.append(f"... [{remaining} lines hidden] ...")

        return "\n".join(parts)

    def _extract_code_head(self, lines: List[str], max_lines: int) -> str:
        """截取头部 N 行"""
        return "\n".join(lines[:max_lines]) + (
            f"\n... [{len(lines) - max_lines} lines hidden] ..." if len(lines) > max_lines else "")