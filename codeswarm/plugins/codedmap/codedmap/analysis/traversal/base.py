# codedmap/analysis/traversal/base.py

import logging
from typing import Dict, List, Optional, Union, Any, TypeVar, Type, Tuple, Iterator, Set
from enum import Enum

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=CPGNode)


class TraversalDirection(Enum):
    IN = "IN"  # Parent / Caller / Def / Predecessor
    OUT = "OUT"  # Child / Callee / Use / Successor


class BaseGraphNavigator:
    """
    [Layer Supertype] 图导航器基类 (Refactored for Lazy Eval).

    职责：
    1. 封装对 CPGStore 的依赖。
    2. 提供防御性的节点属性访问 (Safe Access)。
    3. 提供适配了惰性化架构的邻居查找。

    [Architecture Change]
    全面利用 Storage DSL 的能力，减少 Python 侧的循环和过滤。
    """

    def __init__(self, store: CPGStore):
        self.store = store

    # =========================================================================
    # 1. Safe Node Access (Keep as is)
    # =========================================================================

    def _get_node_attr(self, node: Any, attr: str, default: Any = None) -> Any:
        if node is None: return default
        if attr == 'code': return self._resolve_code_content(node, default)
        if attr == 'line_number':
            val = getattr(node, 'lineNumber', None)
            if val is not None: return val
            val = getattr(node, 'line_number', None)
            if val is not None: return val
            return default

        val = getattr(node, attr, None)
        if val is not None: return val

        if "_" in attr:
            camel_key = self._to_camel_case(attr)
            val = getattr(node, camel_key, None)
            if val is not None: return val

        return default

    def _resolve_code_content(self, node: Any, default: Any) -> Any:
        if hasattr(node, 'get_code'):
            try:
                val = node.get_code()
                if val is not None: return val
            except Exception:
                pass
        return default

    def _to_camel_case(self, snake_str: str) -> str:
        parts = snake_str.split('_')
        return parts[0] + ''.join(x.title() for x in parts[1:])

    def _ensure_node_id(self, node: Union[CPGNode, int]) -> int:
        if isinstance(node, int): return node
        if hasattr(node, 'id'): return node.id
        return getattr(node, 'id', -1)

    # =========================================================================
    # 2. Graph Primitives (Adapted for Laziness)
    # =========================================================================

    def _get_neighbors(self,
                       node: Union[CPGNode, int],
                       edge_type: EdgeType,
                       direction: TraversalDirection) -> Iterator[CPGNode]:
        """
        [Lazy] 获取单跳邻居节点迭代器。
        Changed: 返回 Iterator 而非 List。
        """
        nid = self._ensure_node_id(node)
        try:
            query = self.store.query.by_id(nid)
            if direction == TraversalDirection.IN:
                # 返回 TraversalInterface，它本身是 Iterable
                return iter(query.in_(edge_type))
            else:
                return iter(query.out(edge_type))
        except Exception as e:
            logger.warning(f"Graph traversal failed (Node: {nid}): {e}")
            return iter([])

    def _get_neighbors_batch(self,
                             nodes: List[Union[CPGNode, int]],
                             edge_type: EdgeType,
                             direction: TraversalDirection) -> Dict[int, List[CPGNode]]:
        """
        [Batch] 批量获取邻居。
        适用于逻辑本身需要聚合结果的场景 (e.g. Taint Propagation)。
        这里的返回类型依然是 Dict[int, List]，因为调用方通常需要完整的 Map。
        """
        if not nodes: return {}

        # 1. 提取 ID
        ids = [self._ensure_node_id(n) for n in nodes]
        ids = list(set(ids))

        edge_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        dir_val = direction.value  # "IN" or "OUT"

        # 2. 调用 Store 批量接口获取 ID 映射
        raw_adj = self.store.get_neighbors_batch(ids, dir_val, [edge_val])
        if not raw_adj: return {}

        # 3. 收集所有目标 ID
        all_dst_ids = set()
        for dst_list in raw_adj.values():
            all_dst_ids.update(dst_list)

        if not all_dst_ids: return {}

        # 4. 批量 Hydration
        # 使用 by_ids 加载对象。
        # [Optimization] 如果 all_dst_ids 巨大，这里会是内存瓶颈。
        # 但考虑到这是 _get_neighbors_batch，调用者应该控制 nodes 的规模。
        dst_nodes = self.store.query.by_ids(list(all_dst_ids)).to_list()
        dst_map = {n.id: n for n in dst_nodes}

        # 5. 组装结果
        result = {}
        for src_id, dst_ids in raw_adj.items():
            objs = [dst_map[d] for d in dst_ids if d in dst_map]
            if objs:
                result[src_id] = objs

        return result

    def _find_ancestor(self,
                       start_node: Union[CPGNode, int],
                       target_type: Type[T],
                       max_depth: int = 20,
                       include_self: bool = True) -> Optional[T]:
        """
        [Optimized] 向上查找最近的特定类型祖先。
        Strategy: 使用 DSL 的 limit(1) 仅获取最近的一个。
        """
        # 1. Self Check
        if include_self and isinstance(start_node, target_type):
            return start_node

        start_id = self._ensure_node_id(start_node)

        # 2. 获取 Label
        target_label = None
        if hasattr(target_type, "label"):
            l = getattr(target_type, "label")
            target_label = l.value if hasattr(l, 'value') else str(l)

        # 3. 构建 DSL 查询
        # 关键优化：limit(1)
        query = self.store.query.by_id(start_id).repeat(
            edge_type=EdgeType.AST,
            direction="IN",
            min_depth=1,
            max_depth=max_depth,
            target_label=target_label
        ).limit(1)  # 只取最近的一个

        # 4. 执行 (first() 本质是 next(iter(query)))
        candidate = query.first()

        # 5. 二次校验 (Double Check Type)
        if candidate and isinstance(candidate, target_type):
            return candidate

        return None

    def batch_find_ancestor(
        self,
        node_ids: List[int],
        target_type: Type[T],
        via_edge: EdgeType = EdgeType.AST,
        max_depth: int = 50
    ) -> Dict[int, Optional[T]]:
        """
        Batch resolve ancestor nodes by walking up edges.

        Uses existing store APIs (get_neighbors_batch, by_ids) for efficient
        batch processing without leaking storage-specific semantics.

        Algorithm:
        1. pending = {node_id: current_id} (starts as itself)
        2. For each depth level:
           a. Batch fetch parent IDs via get_neighbors_batch()
           b. Batch fetch parent nodes via by_ids()
           c. Check if any parent matches target_type
           d. Update pending for next iteration

        Args:
            node_ids: List of node IDs to resolve
            target_type: Target ancestor type (e.g., MethodNode)
            via_edge: Edge type to traverse (default: AST)
            max_depth: Maximum traversal depth

        Returns:
            Dict mapping node_id -> ancestor_node (or None if not found)

        Example:
            nav = AstContextNavigator(store)
            method_map = nav.batch_find_ancestor([1, 2, 3], MethodNode)
            # Returns: {1: <MethodNode>, 2: <MethodNode>, 3: None}
        """
        if not node_ids:
            return {}

        target_label = self._get_target_label(target_type)

        edge_val = via_edge.value if hasattr(via_edge, 'value') else str(via_edge)

        pending: Dict[int, int] = {nid: nid for nid in node_ids}
        result: Dict[int, T] = {}

        for _ in range(max_depth):
            if not pending:
                break

            current_ids = list(set(pending.values()))

            parent_map = self.store.get_neighbors_batch(
                current_ids,
                direction="IN",
                edge_types=[edge_val]
            )

            if not parent_map:
                break

            all_parent_ids: Set[int] = set()
            for parents in parent_map.values():
                all_parent_ids.update(parents)

            if not all_parent_ids:
                break

            parent_nodes = self.store.query.by_ids(list(all_parent_ids)).to_list()
            parent_node_map = {n.id: n for n in parent_nodes}

            next_pending: Dict[int, int] = {}
            for orig_id, curr_id in pending.items():
                parent_ids = parent_map.get(curr_id, [])
                if not parent_ids:
                    continue

                parent_id = parent_ids[0]
                parent_node = parent_node_map.get(parent_id)

                if parent_node is None:
                    continue

                if isinstance(parent_node, target_type):
                    result[orig_id] = parent_node
                elif target_label and self._get_node_label(parent_node) == target_label:
                    result[orig_id] = parent_node
                else:
                    next_pending[orig_id] = parent_id

            pending = next_pending

        return result

    def _get_target_label(self, target_type: Type) -> Optional[str]:
        """Extract the default label from a Pydantic model class."""
        try:
            if hasattr(target_type, 'model_fields'):
                field = target_type.model_fields.get('label')
                if field and hasattr(field, 'default'):
                    default = field.default
                    if default is not None:
                        return default.value if hasattr(default, 'value') else str(default)
        except Exception:
            pass
        return None

    def _get_node_label(self, node: CPGNode) -> Optional[str]:
        """Helper to safely extract node label string."""
        label = getattr(node, 'label', None)
        if label is None:
            return None
        return label.value if hasattr(label, 'value') else str(label)