# codedmap/infra/storage/driver_memory/traversal.py

from __future__ import annotations
from typing import List, Iterator, Any, Dict, Optional, Callable, Union, Type, TypeVar, TYPE_CHECKING
from collections import defaultdict
import logging
from itertools import islice

# [Core Imports]
from codedmap.core.schema.graph.nodes import CPGNode, InsightNode, MethodNode, FileNode, VectorNode, TypeDeclNode, ModuleNode
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.infra.storage.interfaces import TraversalInterface

if TYPE_CHECKING:
    from codedmap.infra.storage.driver_memory.store import MemoryDatabase

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=CPGNode)


class GraphIndexer:
    """
    [Helper] 内存图索引器。
    维护 Label -> ID 列表的映射，以及提供 O(1) 的节点和邻接查找。
    """

    def __init__(self, graph: CPGGraph):
        self.graph = graph
        self._label_index: Dict[str, List[int]] = defaultdict(list)
        self._build_label_index()

    def _build_label_index(self):
        # 预先构建 Label 索引
        for node in self.graph.nodes.values():
            label_val = self._get_label_value(node)
            self._label_index[label_val].append(node.id)

    def _get_label_value(self, node: Union[CPGNode, Dict]) -> str:
        if isinstance(node, dict):
            val = node.get("label", "UNKNOWN")
        else:
            val = getattr(node, "label", "UNKNOWN")

        return val.value if hasattr(val, "value") else str(val)

    def get_node(self, node_id: int) -> Optional[CPGNode]:
        return self.graph.get_node_by_id(node_id)

    def get_nodes_by_label(self, label: Union[str, NodeLabel]) -> Iterator[CPGNode]:
        label_str = label.value if hasattr(label, "value") else str(label)
        # 直接迭代 ID 列表并查找对象，避免存储对象引用导致双重内存消耗
        for nid in self._label_index.get(label_str, []):
            node = self.graph.get_node_by_id(nid)
            if node: yield node

    def get_neighbors(self, node_id: int, edge_type: Union[str, EdgeType], direction: str) -> Iterator[CPGNode]:
        """
        获取指定类型和方向的邻居节点。
        """
        edges = []
        if direction == "OUT":
            edges = self.graph.get_out_edges(node_id)
        elif direction == "IN":
            edges = self.graph.get_in_edges(node_id)

        target_type = edge_type
        if hasattr(edge_type, "value"): target_type = edge_type.value

        for edge in edges:
            current_type = edge.type.value if hasattr(edge.type, "value") else edge.type
            if current_type == target_type:
                target_id = edge.dst if direction == "OUT" else edge.src
                node = self.graph.get_node_by_id(target_id)
                if node: yield node


class MemoryTraversal(TraversalInterface[T]):
    """
    [Infra] 基于内存对象的遍历器实现。
    完全支持惰性求值 (Lazy Evaluation)。
    """

    # 全局类级缓存：Model Class -> {Alias -> FieldName}
    # 避免在热路径 (Hot Path) 中重复反射 Pydantic Model
    _ALIAS_CACHE: Dict[Type, Dict[str, str]] = {}

    # =========================================================================
    # 1. Lifecycle & Internals
    # =========================================================================

    def __init__(self, indexer: GraphIndexer, iterator_factory: Callable[[], Iterator[T]]):
        self._indexer = indexer
        # 使用工厂函数而非直接传入 Iterator，确保 Traversal 对象可重入 (Re-iterable)
        self._iter_factory = iterator_factory

        # State Flags
        self._limit_count: Optional[int] = None
        self._skip_count: Optional[int] = None
        self._distinct_flag: bool = False
        self._sort_key: Optional[str] = None
        self._sort_desc: bool = False

        # 投影字段 (兼容性)
        self._projections: List[str] = []

    def __iter__(self) -> Iterator[T]:
        """
        [Core] 实现迭代器协议。
        """
        return self._execute()

    def _clone(self) -> 'MemoryTraversal':
        """Deep Copy for Builder Pattern"""
        t = MemoryTraversal(self._indexer, self._iter_factory)
        t._limit_count = self._limit_count
        t._skip_count = self._skip_count
        t._distinct_flag = self._distinct_flag
        t._sort_key = self._sort_key
        t._sort_desc = self._sort_desc
        t._projections = list(self._projections)
        return t

    def _resolve_field_name(self, model_cls: Type, alias: str) -> str:
        """
        [Optimization] 缓存化字段别名解析。
        解决 Pydantic model_fields 遍历带来的性能开销。
        """
        if model_cls not in self._ALIAS_CACHE:
            mapping = {}
            if hasattr(model_cls, "model_fields"):
                for name, info in model_cls.model_fields.items():
                    if info.alias:
                        mapping[info.alias] = name
                    mapping[name] = name  # 自身也映射，方便查找
            self._ALIAS_CACHE[model_cls] = mapping

        return self._ALIAS_CACHE[model_cls].get(alias, alias)

    def _get_attr_optimized(self, node: Any, attr_name: str) -> Any:
        """
        [Optimization] 高速属性获取。兼容 Dict 和 Object。
        """
        # 1. Handle Dict (e.g. from .values() upstream)
        if isinstance(node, dict):
            if attr_name == 'id': return node.get('id')
            if attr_name == 'label': return node.get('label')

            # Try direct key
            val = node.get(attr_name)
            if val is not None: return val

            # Try properties dict inside dict
            props = node.get('properties')
            if props and isinstance(props, dict):
                return props.get(attr_name)
            return None

        # 2. Handle Object (Direct Access)
        val = getattr(node, attr_name, AttributeError)
        if val is not AttributeError:
            return val

        # 3. Handle Object (Alias Lookup)
        real_name = self._resolve_field_name(type(node), attr_name)
        val = getattr(node, real_name, AttributeError)
        if val is not AttributeError:
            return val

        # 4. Handle Object (Dynamic Properties)
        if hasattr(node, "properties") and node.properties:
            return node.properties.get(attr_name)

        return None

    def _get_id(self, node: Any) -> Optional[int]:
        if isinstance(node, dict):
            return node.get('id')
        return getattr(node, 'id', None)

    def _get_label_str(self, node: Any) -> str:
        if isinstance(node, dict):
            val = node.get('label', '')
        else:
            val = getattr(node, 'label', '')
        return val.value if hasattr(val, 'value') else str(val)

    def _execute(self) -> Iterator[T]:
        """
        [Pipeline Engine] 执行流式计算管道。
        """
        # 1. Source
        iterator = self._iter_factory()

        # 2. Sort & Distinct (Blocking Operations)
        if self._sort_key or self._distinct_flag:
            nodes = list(iterator)

            if self._distinct_flag:
                seen = set()
                unique_nodes = []
                for n in nodes:
                    nid = self._get_id(n)
                    if nid is not None and nid not in seen:
                        seen.add(nid)
                        unique_nodes.append(n)
                nodes = unique_nodes

            if self._sort_key:
                def sort_key_fn(n):
                    val = self._get_attr_optimized(n, self._sort_key)
                    if val is None: return "" if isinstance(val, str) else 0
                    return val

                nodes.sort(key=sort_key_fn, reverse=self._sort_desc)

            iterator = iter(nodes)

        # 3. Skip (Streaming Operation)
        if self._skip_count is not None:
            iterator = islice(iterator, self._skip_count, None)

        # 4. Limit (Streaming Operation)
        if self._limit_count is not None:
            iterator = islice(iterator, self._limit_count)

        return iterator

    # =========================================================================
    # 2. Topology Steps
    # =========================================================================

    def out(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'MemoryTraversal':
        parent_factory = self._iter_factory
        e_type_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)

        def factory():
            for node in parent_factory():
                nid = self._get_id(node)
                if nid is None: continue

                for neighbor in self._indexer.get_neighbors(nid, e_type_val, "OUT"):
                    if target_class and not isinstance(neighbor, target_class):
                        continue
                    yield neighbor

        return MemoryTraversal(self._indexer, factory)

    def in_(self, edge_type: Union[str, EdgeType], target_class: Type = None) -> 'MemoryTraversal':
        parent_factory = self._iter_factory
        e_type_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)

        def factory():
            for node in parent_factory():
                nid = self._get_id(node)
                if nid is None: continue

                for neighbor in self._indexer.get_neighbors(nid, e_type_val, "IN"):
                    if target_class and not isinstance(neighbor, target_class):
                        continue
                    yield neighbor

        return MemoryTraversal(self._indexer, factory)

    def repeat(self,
               edge_type: Union[str, EdgeType],
               direction: str = "OUT",
               min_depth: int = 1,
               max_depth: int = 10,
               target_label: Optional[Union[str, NodeLabel]] = None) -> 'MemoryTraversal':

        parent_factory = self._iter_factory
        edge_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        lbl_val = target_label.value if hasattr(target_label, 'value') else str(target_label) if target_label else None

        def factory():
            for start_node in parent_factory():
                start_id = self._get_id(start_node)
                if start_id is None: continue

                queue = [(start_id, 0)]
                visited = {start_id}
                idx = 0

                while idx < len(queue):
                    curr_id, depth = queue[idx]
                    idx += 1

                    if depth >= max_depth: continue

                    neighbors = self._indexer.get_neighbors(curr_id, edge_val, direction)

                    for nb in neighbors:
                        nb_id = nb.id # Neighbors are always objects from Indexer
                        if nb_id in visited: continue
                        visited.add(nb_id)

                        next_depth = depth + 1

                        if next_depth >= min_depth:
                            if lbl_val:
                                if self._get_label_str(nb) == lbl_val: yield nb
                            else:
                                yield nb

                        if next_depth < max_depth:
                            queue.append((nb_id, next_depth))

        return MemoryTraversal(self._indexer, factory).distinct()

    # =========================================================================
    # 3. Filtering
    # =========================================================================

    def filter(self, **kwargs) -> 'MemoryTraversal':
        parent_factory = self._iter_factory

        def factory():
            for node in parent_factory():
                match = True
                for k, v in kwargs.items():
                    node_val = self._get_attr_optimized(node, k)
                    if node_val != v:
                        match = False
                        break
                if match: yield node

        return MemoryTraversal(self._indexer, factory)

    def where_contains(self, property_name: str, value: str) -> 'MemoryTraversal':
        parent_factory = self._iter_factory

        def factory():
            for node in parent_factory():
                node_val = self._get_attr_optimized(node, property_name)
                if node_val is not None:
                    if isinstance(node_val, str) and value in node_val:
                        yield node
                    elif isinstance(node_val, (list, tuple)) and value in node_val:
                        yield node

        return MemoryTraversal(self._indexer, factory)

    def where_no_out_edge(self, edge_type: Union[str, EdgeType]) -> 'MemoryTraversal':
        parent_factory = self._iter_factory
        e_type_val = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)

        def factory():
            for node in parent_factory():
                nid = self._get_id(node)
                if nid is None: continue

                # 使用迭代器探测
                neighbors_iter = self._indexer.get_neighbors(nid, e_type_val, "OUT")
                try:
                    next(neighbors_iter)
                    continue
                except StopIteration:
                    yield node

        return MemoryTraversal(self._indexer, factory)

    def has_tag(self, tag: str) -> 'MemoryTraversal':
        def factory():
            for node in self._iter_factory():
                tags = self._get_attr_optimized(node, "tags") or []
                if isinstance(tags, list) and tag in tags: yield node

        return MemoryTraversal(self._indexer, factory)

    def has_no_tag(self, tag: str) -> 'MemoryTraversal':
        def factory():
            for node in self._iter_factory():
                tags = self._get_attr_optimized(node, "tags") or []
                if isinstance(tags, list) and tag not in tags: yield node

        return MemoryTraversal(self._indexer, factory)

    def has_label(self, label: Union[str, NodeLabel]) -> 'MemoryTraversal':
        label_str = label.value if hasattr(label, 'value') else str(label)

        def factory():
            for node in self._iter_factory():
                if self._get_label_str(node) == label_str: yield node

        return MemoryTraversal(self._indexer, factory)

    # =========================================================================
    # 4. Configuration & Projection
    # =========================================================================

    def limit(self, count: int) -> 'MemoryTraversal':
        t = self._clone()
        t._limit_count = count
        return t

    def skip(self, count: int) -> 'MemoryTraversal':
        t = self._clone()
        t._skip_count = count
        return t

    def distinct(self) -> 'MemoryTraversal':
        t = self._clone()
        t._distinct_flag = True
        return t

    def order_by(self, property_name: str, desc: bool = False) -> 'MemoryTraversal':
        t = self._clone()
        t._sort_key = property_name
        t._sort_desc = desc
        return t

    def property(self, *keys: str) -> 'MemoryTraversal':
        """
        [Projection] 内存模式下仅做兼容记录，因为对象已经在内存中。
        """
        t = self._clone()
        t._projections.extend(keys)
        return t

    def values(self, *keys: str) -> Iterator[Dict[str, Any]]:
        """
        [Stream] 属性投影。
        """

        # [Fix] 修正返回值类型注解 List -> Iterator
        def value_gen():
            for node in self._execute():
                item = {}
                for k in keys:
                    item[k] = self._get_attr_optimized(node, k)
                yield item

        return value_gen()

    def raw(self) -> Iterator[Dict[str, Any]]:
        """[Stream] 返回原始字典数据"""
        iterator = self._execute()
        is_projection = bool(self._projections)

        for node in iterator:
            if isinstance(node, dict):
                if is_projection:
                    # Filter keys
                    item = {
                        'id': node.get('id'),
                        'label': node.get('label')
                    }
                    for k in self._projections:
                        item[k] = self._get_attr_optimized(node, k)
                    yield item
                else:
                    yield node
            else:
                # Node is Object
                if is_projection:
                    item = {
                        'id': node.id,
                        'label': self._get_label_str(node)
                    }
                    for k in self._projections:
                        item[k] = self._get_attr_optimized(node, k)
                    yield item
                else:
                    data = node.model_dump(by_alias=True)
                    data['id'] = node.id
                    data['label'] = self._get_label_str(node)
                    yield data

    # =========================================================================
    # 5. Semantic Shortcuts
    # =========================================================================

    def ast(self) -> 'MemoryTraversal':
        return self.out(EdgeType.AST).order_by("order")

    def ast_children(self) -> 'MemoryTraversal':
        return self.ast()

    def ast_parent(self) -> 'MemoryTraversal':
        return self.in_(EdgeType.AST)

    def callers(self) -> 'MemoryTraversal':
        return self.in_(EdgeType.CALL).in_(EdgeType.CONTAINS, target_class=MethodNode)

    def callees(self) -> 'MemoryTraversal':
        return self.out(EdgeType.CONTAINS).out(EdgeType.CALL, target_class=MethodNode)

    def file(self) -> 'MemoryTraversal':
        parent_factory = self._iter_factory

        def factory():
            for node in parent_factory():
                curr = node
                found_file = None
                depth = 0
                max_depth = 20
                while depth < max_depth:
                    if isinstance(curr, FileNode):
                        found_file = curr
                        break
                    # Upward traversal
                    if isinstance(curr, dict) and curr.get('label') == NodeLabel.FILE.value:
                        # Dict check support (if needed, but usually file traversal needs object for edges)
                        # Memory backend usually deals with objects unless values() is used.
                        # If values() is used, traversal shortcuts might not work well because we lose graph context.
                        # Assuming objects for semantic traversal.
                        pass

                    curr_id = self._get_id(curr)
                    if curr_id is None: break

                    parents = list(self._indexer.get_neighbors(curr_id, EdgeType.AST.value, "IN"))
                    if not parents:
                        parents = list(self._indexer.get_neighbors(curr_id, EdgeType.CONTAINS.value, "IN"))
                    if not parents: break
                    curr = parents[0]
                    depth += 1
                if found_file: yield found_file
                return MemoryTraversal(self._indexer, factory).distinct()

    def method(self) -> 'MemoryTraversal':
        parent_factory = self._iter_factory

        def factory():
            for node in parent_factory():
                curr = node
                found_method = None
                depth = 0
                max_depth = 50

                while depth < max_depth:
                    l_str = self._get_label_str(curr)

                    if l_str == NodeLabel.METHOD.value:
                        found_method = curr
                        break

                    # 如果到了文件层级还没找到，说明不在方法内，停止查找
                    if l_str == NodeLabel.FILE.value:
                        break

                    curr_id = self._get_id(curr)
                    if curr_id is None:
                        break

                    # 向上遍历 (AST优先，其次CONTAINS)
                    parents = list(self._indexer.get_neighbors(curr_id, EdgeType.AST.value, "IN"))
                    if not parents:
                        parents = list(self._indexer.get_neighbors(curr_id, EdgeType.CONTAINS.value, "IN"))

                    if not parents:
                        break

                    curr = parents[0]
                    depth += 1

                if found_method:
                    yield found_method

        return MemoryTraversal(self._indexer, factory).distinct()

    def type_decl(self) -> 'MemoryTraversal':
        parent_factory = self._iter_factory

        def factory():
            for node in parent_factory():
                curr = node
                found_type = None
                depth = 0
                max_depth = 50

                while depth < max_depth:
                    l_str = self._get_label_str(curr)

                    if l_str == NodeLabel.TYPE_DECL.value:
                        found_type = curr
                        break

                    if l_str == NodeLabel.FILE.value:
                        break

                    curr_id = self._get_id(curr)
                    if curr_id is None:
                        break

                    # 向上遍历
                    parents = list(self._indexer.get_neighbors(curr_id, EdgeType.AST.value, "IN"))
                    if not parents:
                        parents = list(self._indexer.get_neighbors(curr_id, EdgeType.CONTAINS.value, "IN"))

                    if not parents:
                        break

                    curr = parents[0]
                    depth += 1

                if found_type:
                    yield found_type

        return MemoryTraversal(self._indexer, factory).distinct()

    def insights(self, category: str = None) -> 'MemoryTraversal':
        t = self.out(EdgeType.HAS_INSIGHT, target_class=InsightNode)
        if category:
            t = t.filter(category=category)
        return t

    def vectors(self) -> 'MemoryTraversal':
        return self.out(EdgeType.HAS_VECTOR, target_class=VectorNode)

    # =========================================================================
    # 6. Terminal Operations
    # =========================================================================

    def count(self) -> int:
        """
        [Optimization] 如果底层是 list，直接取 len；否则消费迭代器。
        """
        # 注意：这里调用的是 self._execute()，它可能返回 list 也可能返回 generator
        iterable = self._execute()
        if hasattr(iterable, "__len__"):
            return len(iterable)
        return sum(1 for _ in iterable)

    def id_list(self) -> List[int]:
        return [self._get_id(n) for n in self if self._get_id(n) is not None]

    def iter_batch(self, batch_size: int = 1000, shard_index: int = 0, total_shards: int = 1) -> Iterator[List[T]]:
        iterator = self._execute()

        if total_shards > 1:
            # [FIX] Safe ID Access
            iterator = (
                node for node in iterator
                if (self._get_id(node) or -1) % total_shards == shard_index
            )

        while True:
            batch = list(islice(iterator, batch_size))
            if not batch: break
            yield batch

class MemoryTraversalSource:
    """
    DSL 入口点。
    """

    def __init__(self, db: 'MemoryDatabase'):
        self.db = db

    @property
    def indexer(self) -> GraphIndexer:
        if self.db.indexer is None:
            return GraphIndexer(CPGGraph())
        return self.db.indexer

    def by_id(self, node_id: int) -> MemoryTraversal[CPGNode]:
        current_indexer = self.indexer

        def factory():
            node = current_indexer.get_node(node_id)
            if node: yield node

        return MemoryTraversal(current_indexer, factory)

    def by_ids(self, node_ids: List[int]) -> MemoryTraversal[CPGNode]:
        current_indexer = self.indexer

        def factory():
            for nid in node_ids:
                node = current_indexer.get_node(nid)
                if node: yield node

        return MemoryTraversal(current_indexer, factory)

    def methods(self, name: str = None) -> MemoryTraversal[MethodNode]:
        current_indexer = self.indexer

        def factory():
            for node in current_indexer.get_nodes_by_label(NodeLabel.METHOD):
                if name is None or node.name == name:
                    yield node

        return MemoryTraversal(current_indexer, factory)

    def files(self, name: str = None) -> MemoryTraversal[FileNode]:
        current_indexer = self.indexer

        def factory():
            for node in current_indexer.get_nodes_by_label(NodeLabel.FILE):
                if name is None or node.name == name:
                    yield node

        return MemoryTraversal(current_indexer, factory)

    def all_nodes(self, node_label: Union[str, NodeLabel] = None) -> MemoryTraversal[CPGNode]:
        current_indexer = self.indexer

        def factory():
            if node_label is None:
                yield from current_indexer.graph.nodes.values()
            else:
                yield from current_indexer.get_nodes_by_label(node_label)

        return MemoryTraversal(current_indexer, factory)

    def modules(self, name: str = None) -> MemoryTraversal[ModuleNode]:
        current_indexer = self.indexer

        def factory():
            for node in current_indexer.get_nodes_by_label(NodeLabel.MODULE):
                if name is None or node.name == name:
                    yield node

        return MemoryTraversal(current_indexer, factory)

    def vectors(self) -> MemoryTraversal[VectorNode]:
        current_indexer = self.indexer

        def factory():
            yield from current_indexer.get_nodes_by_label(NodeLabel.VECTOR)

        return MemoryTraversal(current_indexer, factory)

    def all_nodes_in(
        self,
        node_label: Union[str, NodeLabel],
        property: str,
        values: List[Any]
    ) -> MemoryTraversal[CPGNode]:
        """
        Batch IN query for exact property match.

        Memory backend: iterates all nodes of label and filters in Python.
        """
        current_indexer = self.indexer

        if not values:
            return MemoryTraversal(current_indexer, lambda: iter([]))

        label_val = node_label.value if hasattr(node_label, 'value') else str(node_label)
        value_set = set(values)

        def factory():
            for node in current_indexer.get_nodes_by_label(label_val):
                prop_val = getattr(node, property, None)
                if prop_val is None:
                    props = getattr(node, 'properties', {})
                    if isinstance(props, dict):
                        prop_val = props.get(property)
                if prop_val in value_set:
                    yield node

        return MemoryTraversal(current_indexer, factory)

    def all_nodes_containing_any(
        self,
        node_label: Union[str, NodeLabel],
        property: str,
        substrings: List[str]
    ) -> MemoryTraversal[CPGNode]:
        """
        Batch OR-LIKE query for substring match.

        Memory backend: iterates all nodes of label and filters in Python.
        """
        current_indexer = self.indexer

        if not substrings:
            return MemoryTraversal(current_indexer, lambda: iter([]))

        label_val = node_label.value if hasattr(node_label, 'value') else str(node_label)

        def factory():
            for node in current_indexer.get_nodes_by_label(label_val):
                prop_val = getattr(node, property, None)
                if prop_val is None:
                    props = getattr(node, 'properties', {})
                    if isinstance(props, dict):
                        prop_val = props.get(property)
                if prop_val is None:
                    prop_val = ""
                for substr in substrings:
                    if substr in str(prop_val):
                        yield node
                        break

        return MemoryTraversal(current_indexer, factory)


class MemoryEdgeTraversal:
    """
    [Edge DSL] Memory edge traversal implementation.
    Simple design for basic edge queries.
    """

    def __init__(self, iterator_factory: Callable[[], Iterator[Any]]):
        self._iter_factory = iterator_factory

    def __iter__(self) -> Iterator[Any]:
        return self._iter_factory()

    def to_list(self) -> List[Any]:
        return list(self)

    def first(self) -> Optional[Any]:
        try:
            return next(iter(self))
        except StopIteration:
            return None

    def count(self) -> int:
        return sum(1 for _ in self)


class MemoryEdgeTraversalSource:
    """
    [Factory] Edge DSL entry point for Memory backend.
    """

    def __init__(self, db: 'MemoryDatabase'):
        self.db = db

    def by_src(self, node_id: int) -> MemoryEdgeTraversal:
        """Get edges where src = node_id."""
        def factory():
            for edge in self.db.graph._out_index.get(node_id, []):
                yield edge
        return MemoryEdgeTraversal(factory)

    def by_dst(self, node_id: int) -> MemoryEdgeTraversal:
        """Get edges where dst = node_id."""
        def factory():
            for edge in self.db.graph._in_index.get(node_id, []):
                yield edge
        return MemoryEdgeTraversal(factory)

    def all(self) -> MemoryEdgeTraversal:
        """Get all edges."""
        def factory():
            for edge in self.db.graph.edges:
                yield edge
        return MemoryEdgeTraversal(factory)


class MemoryStatisticsHelper:
    """
    [Helper] Statistics query implementation for Memory backend.
    """

    def __init__(self, reader: 'MemoryReader'):
        self._reader = reader

    def node_count(self, label: Optional[str] = None) -> int:
        """Count nodes, optionally filtered by label."""
        if label is None:
            return len(self._reader.db.graph.nodes)
        
        count = 0
        for node in self._reader.db.graph.nodes.values():
            lbl = getattr(node, 'label', None)
            lbl_str = lbl.value if hasattr(lbl, 'value') else str(lbl)
            if lbl_str == label:
                count += 1
        return count

    def edge_count(self, edge_type: Optional[str] = None) -> int:
        """Count edges, optionally filtered by type."""
        return self._reader.count_edges(edge_type)