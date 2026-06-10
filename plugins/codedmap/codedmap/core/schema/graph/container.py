# codedmap/core/schema/graph/container.py

from __future__ import annotations

from typing import List, Union, Dict, Optional, Any, Iterator, Set, Type, TYPE_CHECKING
from collections import defaultdict
import logging

if TYPE_CHECKING:
    from .patch import GraphPatch

# [Pydantic V2]
from pydantic import BaseModel, Field, PrivateAttr, model_serializer

from .base import CPGNode  # 核心基类
from .edges import CPGEdge, EdgeType
from codedmap.utils.id_generator import generate_id

logger = logging.getLogger(__name__)

# Runtime dispatch via _node_registry; no manual maintenance
AnyNode = CPGNode


class CPGGraph(BaseModel):
    """
    CPG 内存图容器 (Industrial Grade)

    Architecture:
    1. Nodes: 使用 Dict[int, CPGNode] 存储。
    2. Edges: 使用 List[Edge] 存储主数据，同时维护 _out_index 和 _in_index 邻接表。
    3. Indexing: 在添加边时自动更新索引。
    4. Merge Strategy: 支持智能合并，防止骨架节点覆盖完整节点。
    """

    # 核心数据存储
    # key: node_id, value: CPGNode
    nodes: Dict[int, AnyNode] = Field(default_factory=dict)

    # 边列表
    edges: List[CPGEdge] = Field(default_factory=list)

    # 内部状态：追踪当前图中的最大 ID (用于 Snowflake ID 生成器的参照或合并逻辑)
    _max_id: int = PrivateAttr(default=0)

    # 高性能邻接索引 (Private, 不参与序列化)
    # SrcID -> List[CPGEdge]
    _out_index: Dict[int, List[CPGEdge]] = PrivateAttr(default_factory=lambda: defaultdict(list))
    # DstID -> List[CPGEdge]
    _in_index: Dict[int, List[CPGEdge]] = PrivateAttr(default_factory=lambda: defaultdict(list))

    # Dedup Set (Hash of (src, dst, type))
    _edge_dedup_set: Set[int] = PrivateAttr(default_factory=set)

    @model_serializer
    def ser_model(self) -> Dict[str, Any]:
        """
        [Pydantic V2 序列化定制]
        导出 JSON 格式，兼容 Neo4j 导入工具。
        """
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges
        }

    def __init__(self, **data):
        super().__init__(**data)
        # 如果是从数据加载初始化的，需要重建索引
        if self.nodes or self.edges:
            self._rebuild_indexes()
            if self.nodes:
                # 确保 _max_id 初始化正确，处理可能存在的负数ID (虽然通常ID为正)
                self._max_id = max(self.nodes.keys()) if self.nodes else 0

    def _rebuild_indexes(self):
        """全量重建索引"""
        self._out_index.clear()
        self._in_index.clear()
        self._edge_dedup_set.clear()

        edge_set_add = self._edge_dedup_set.add
        out_idx = self._out_index
        in_idx = self._in_index
        compute_hash = self._compute_edge_hash

        for edge in self.edges:
            out_idx[edge.src].append(edge)
            in_idx[edge.dst].append(edge)
            edge_set_add(compute_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None))

    def shrink_memory(self):
        """
        [Optimization] 释放构建阶段的辅助内存。
        在图构建完成、准备进行只读分析时调用。
        """
        self._edge_dedup_set.clear()
        self._edge_dedup_set = set()  # Replace with empty small set

    # =========================================================================
    # Node Operations
    # =========================================================================

    def add_node(self, node: AnyNode) -> int:
        """
        添加节点到图中。
        """
        if node.id is None:
            node.id = generate_id()

        # 更新 max_id (用于后续 merge 逻辑)
        if node.id > self._max_id:
            self._max_id = node.id

        self.nodes[node.id] = node
        return node.id

    def add_nodes_from(self, nodes: List[AnyNode]):
        """[Optimization] 批量添加节点"""
        for node in nodes:
            self.add_node(node)

    def remove_node(self, node_or_id: Union[AnyNode, int], cascade: bool = False):
        """
        [Safe Remove] 删除节点及其关联的所有边。

        Args:
            node_or_id: 节点对象或 ID。
            cascade: 是否级联删除 AST 子节点 (默认 False)。
                     如果在 CPG 中删除一个 Block 或 Method，通常希望连带删除其子树。
        """
        # 1. 解析 Node ID
        node_id = node_or_id.id if hasattr(node_or_id, 'id') else node_or_id

        if node_id not in self.nodes:
            logger.warning(f"Attempted to remove non-existent node: {node_id}")
            return

        # 2. (可选) 级联删除 AST 子节点
        # 注意：必须在删除当前节点连接关系之前获取子节点
        if cascade:
            children = self.get_ast_children(node_id)
            for child in children:
                self.remove_node(child.id, cascade=True)

        # 3. 清理边关联 (Updating Indexes & Dedup Set)
        # 我们需要处理两类受影响的边：
        # A. 从该节点发出的边 (Out Edges): node -> other
        # B. 指向该节点的边 (In Edges): other -> node

        out_edges = self._out_index.get(node_id, [])
        in_edges = self._in_index.get(node_id, [])

        # 3.1 处理 Out Edges: 从目标节点的 _in_index 中移除这些边
        for edge in out_edges:
            dst = edge.dst
            if dst in self._in_index:
                self._in_index[dst] = [e for e in self._in_index[dst] if e.src != node_id]

            edge_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.discard(edge_hash)

        # 3.2 处理 In Edges: 从源节点的 _out_index 中移除这些边
        for edge in in_edges:
            src = edge.src
            if src in self._out_index:
                self._out_index[src] = [e for e in self._out_index[src] if e.dst != node_id]

            edge_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.discard(edge_hash)

        # 4. 从主边列表 self.edges 中移除
        # 这一步是 O(E)，但为了保持列表紧凑不得不做。
        # 使用列表推导式一次性过滤比多次 remove 效率高。
        self.edges = [e for e in self.edges if e.src != node_id and e.dst != node_id]

        # 5. 清除该节点自身的索引入口
        if node_id in self._out_index:
            del self._out_index[node_id]
        if node_id in self._in_index:
            del self._in_index[node_id]

        # 6. 删除节点本身
        del self.nodes[node_id]

    def get_node_by_id(self, node_id: int) -> Optional[AnyNode]:
        """O(1) 获取节点"""
        return self.nodes.get(node_id)

    def relocate_node_id(self, old_id: int, new_id: int) -> bool:
        """
        [Safe] 将节点的 ID 从 old_id 变更为 new_id，同步更新所有索引。

        用于碰撞修复场景：当节点的 ID 在构造后因属性变化（如 argument_index 赋值）
        而发生漂移时，需要原子地更新 nodes dict + 边列表 + 邻接索引 + dedup set。

        Returns:
            True 如果迁移成功，False 如果 old_id 不存在。
        """
        if old_id not in self.nodes:
            return False

        node = self.nodes.pop(old_id)
        node.id = new_id
        self.nodes[new_id] = node

        # 更新 _max_id
        if new_id > self._max_id:
            self._max_id = new_id

        # 更新所有引用了 old_id 的边 (src 或 dst)
        # 同时重建受影响的索引和 dedup set 条目
        out_edges = self._out_index.pop(old_id, [])
        in_edges = self._in_index.pop(old_id, [])

        for edge in out_edges:
            # 从 dedup set 移除旧 hash
            old_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.discard(old_hash)
            # 更新 edge.src
            edge.src = new_id
            # 添加新 hash
            new_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.add(new_hash)

        for edge in in_edges:
            old_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.discard(old_hash)
            # 更新 edge.dst
            edge.dst = new_id
            new_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            self._edge_dedup_set.add(new_hash)

        # 重建邻接索引条目
        # 注意: 边对象是共享引用 — 修改 edge.src/dst 后，其他节点邻接表中的
        # 同一对象自动反映新 ID，无需额外遍历
        self._out_index[new_id] = out_edges
        self._in_index[new_id] = in_edges

        return True

    def has_node(self, node_id: int) -> bool:
        return node_id in self.nodes

    def __contains__(self, node_id: int) -> bool:
        return node_id in self.nodes

    # =========================================================================
    # Edge Operations
    # =========================================================================

    @staticmethod
    def _compute_edge_hash(src_id: int, dst_id: int, edge_type, properties: Dict = None) -> int:
        """
        计算边的去重 hash。
        对于 DDG/CFG 等语义边，将关键 properties 纳入 hash，
        避免同一对节点间不同 variable/label 的边被误判为重复。
        """
        edge_type_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)
        semantic_value = None
        if properties:
            if edge_type_str == "DDG":
                semantic_value = properties.get("variable")
            elif edge_type_str == "CFG":
                semantic_value = properties.get("label")
        return hash((src_id, dst_id, edge_type, semantic_value))

    def add_edge(self, src: Union[AnyNode, int], dst: Union[AnyNode, int], type: EdgeType,
                 check_duplicates: bool = True,
                 **kwargs) -> CPGEdge:
        """
        添加边。
        支持传入 Node 对象或 Node ID。
        """
        src_id = src.id if hasattr(src, 'id') else src
        dst_id = dst.id if hasattr(dst, 'id') else dst

        if src_id not in self.nodes or dst_id not in self.nodes:
             logger.debug(f"Adding edge {type} connecting non-existent nodes: {src_id} -> {dst_id}")

        # [Fast Dedup Check] O(1)
        if check_duplicates:
            edge_hash = self._compute_edge_hash(src_id, dst_id, type, kwargs if kwargs else None)
            if edge_hash in self._edge_dedup_set:
                return CPGEdge(src=src_id, dst=dst_id, type=type, properties=kwargs)

        # 创建新边
        edge = CPGEdge(src=src_id, dst=dst_id, type=type, properties=kwargs)

        # 更新存储
        self.edges.append(edge)
        self._out_index[src_id].append(edge)
        self._in_index[dst_id].append(edge)

        if check_duplicates:
            self._edge_dedup_set.add(edge_hash)

        return edge

    def _add_edge_internal(self, edge: CPGEdge, check_duplicates: bool = False):
        """[Internal] 底层添加边逻辑"""
        if check_duplicates:
            edge_hash = self._compute_edge_hash(edge.src, edge.dst, edge.type, edge.properties if edge.properties else None)
            if edge_hash in self._edge_dedup_set:
                return
            self._edge_dedup_set.add(edge_hash)

        self.edges.append(edge)
        self._out_index[edge.src].append(edge)
        self._in_index[edge.dst].append(edge)

    def remove_edge(self, src: Union[AnyNode, int], dst: Union[AnyNode, int], type: EdgeType):
        """删除边"""
        src_id = src.id if hasattr(src, 'id') else src
        dst_id = dst.id if hasattr(dst, 'id') else dst
        if src_id is None or dst_id is None: return

        # 清理 dedup set（如果存在）
        # 注意: 需要遍历匹配的边来获取 properties，以便计算正确的 hash
        # 因为 remove_edge 不知道 properties，我们从主边列表中找到匹配边后再清理
        for e in self.edges:
            if e.src == src_id and e.dst == dst_id and e.type == type:
                edge_hash = self._compute_edge_hash(e.src, e.dst, e.type, e.properties if e.properties else None)
                self._edge_dedup_set.discard(edge_hash)

        # 过滤条件
        def is_not_target(e: CPGEdge):
            return not (e.src == src_id and e.dst == dst_id and e.type == type)

        # 从主边列表中移除
        original_len = len(self.edges)
        self.edges = [e for e in self.edges if is_not_target(e)]

        if len(self.edges) == original_len:
            return

        # 更新索引
        if src_id in self._out_index:
            self._out_index[src_id] = [e for e in self._out_index[src_id] if is_not_target(e)]

        if dst_id in self._in_index:
            self._in_index[dst_id] = [e for e in self._in_index[dst_id] if is_not_target(e)]

    # =========================================================================
    # High-Performance Query APIs
    # =========================================================================

    def get_out_edges(self, node_id: int, edge_type: Optional[EdgeType] = None) -> List[CPGEdge]:
        edges = self._out_index.get(node_id, [])
        if edge_type is None:
            return edges
        # List comprehension is faster than filter
        return [e for e in edges if e.type == edge_type]

    def get_in_edges(self, node_id: int, edge_type: Optional[EdgeType] = None) -> List[CPGEdge]:
        edges = self._in_index.get(node_id, [])
        if edge_type is None:
            return edges
        return [e for e in edges if e.type == edge_type]

    def get_successors(self, node_id: int, edge_type: Optional[EdgeType] = None) -> Iterator[AnyNode]:
        for edge in self.get_out_edges(node_id, edge_type):
            node = self.nodes.get(edge.dst)
            if node:
                yield node

    def get_predecessors(self, node_id: int, edge_type: Optional[EdgeType] = None) -> Iterator[AnyNode]:
        for edge in self.get_in_edges(node_id, edge_type):
            node = self.nodes.get(edge.src)
            if node:
                yield node

    # =========================================================================
    # Shortcut Methods
    # =========================================================================

    def add_ast_edge(self, p: AnyNode, c: AnyNode):
        return self.add_edge(p, c, EdgeType.AST)

    def add_ref_edge(self, u: AnyNode, d: AnyNode):
        return self.add_edge(u, d, EdgeType.REF)

    def add_cfg_edge(self, s: AnyNode, d: AnyNode, label: str = None):
        props = {"label": label} if label else {}
        return self.add_edge(s, d, EdgeType.CFG, **props)

    def add_ddg_edge(self, s: AnyNode, d: AnyNode, variable: str):
        return self.add_edge(s, d, EdgeType.DDG, variable=variable)

    def add_call_edge(self, call_site: AnyNode, method: AnyNode):
        return self.add_edge(call_site, method, EdgeType.CALL)

    def add_argument_edge(self, call: AnyNode, arg: AnyNode, index: int):
        return self.add_edge(call, arg, EdgeType.ARGUMENT, argumentIndex=index)

    def add_receiver_edge(self, call: AnyNode, receiver: AnyNode):
        return self.add_edge(call, receiver, EdgeType.RECEIVER)

    def add_condition_edge(self, structure: AnyNode, expr: AnyNode):
        return self.add_edge(structure, expr, EdgeType.CONDITION)

    # 显式支持 CONTAINS (对应 Directory -> File)
    def add_contains_edge(self, parent: AnyNode, child: AnyNode):
        return self.add_edge(parent, child, EdgeType.CONTAINS)

    # =========================================================================
    # Merge Logic & Slicing
    # =========================================================================

    def merge(self, subgraph: 'CPGGraph', consume: bool = False):
        """
        [Safe Merge] 合并子图到当前主图中。

        Args:
            subgraph: 要合并的子图。
            consume: 如果为 True，合并后清空子图以释放内存（适用于 pipeline 中一次性子图）。
                     默认 False，不修改源图。
        """
        if self is subgraph:
            return

        if not subgraph.nodes and not subgraph.edges:
            return

        # 迁移节点 (Smart Overlay)
        for node_id, new_node in subgraph.nodes.items():

            # [Stub Protection] 智能合并逻辑
            if node_id in self.nodes:
                existing_node = self.nodes[node_id]

                existing_is_stub = getattr(existing_node, 'is_stub', False)
                new_is_stub = getattr(new_node, 'is_stub', False)

                # 如果库里的已经是完整的(not stub)，而新来的是个骨架(stub)，则跳过覆盖
                if not existing_is_stub and new_is_stub:
                    continue

                # 否则覆盖 (Full->Stub, Stub->Stub, Full->Full)
                self.nodes[node_id] = new_node

            else:
                self.nodes[node_id] = new_node

            if node_id > self._max_id:
                self._max_id = node_id

        # 迁移边
        for edge in subgraph.edges:
            self._add_edge_internal(edge, check_duplicates=True)

        # 可选：释放源图内存
        if consume:
            subgraph.nodes.clear()
            subgraph.edges.clear()
            subgraph._out_index.clear()
            subgraph._in_index.clear()

    def get_subgraph(self, node_ids: List[int]) -> 'CPGGraph':
        """[Slicing] 提取子图"""
        subgraph = CPGGraph()
        valid_ids = set(node_ids)

        # 1. 复制节点
        for nid in valid_ids:
            node = self.nodes.get(nid)
            if node:
                subgraph.add_node(node)

        # 2. 复制诱导子图 (Induced Subgraph) 的边
        for nid in valid_ids:
            out_edges = self._out_index.get(nid, [])
            for edge in out_edges:
                if edge.dst in valid_ids:
                    subgraph.add_edge(
                        src=edge.src,
                        dst=edge.dst,
                        type=edge.type,
                        **edge.properties
                    )
        return subgraph

    # =========================================================================
    # Structural Traversal
    # =========================================================================

    def get_ast_parent(self, node_or_id: Union[AnyNode, int]) -> Optional[AnyNode]:
        """获取唯一的 AST 父节点"""
        node_id = node_or_id if isinstance(node_or_id, int) else node_or_id.id
        edges = self.get_in_edges(node_id, EdgeType.AST)

        if not edges:
            return None

        # AST 严格只能有一个父节点，取第一个
        parent_edge = edges[0]
        return self.nodes.get(parent_edge.src)

    def get_ast_children(self, node_or_id: Union[AnyNode, int]) -> List[AnyNode]:
        """获取有序的 AST 子节点"""
        node_id = node_or_id if isinstance(node_or_id, int) else node_or_id.id
        edges = self.get_out_edges(node_id, EdgeType.AST)

        if not edges:
            return []

        children = []
        for edge in edges:
            child = self.nodes.get(edge.dst)
            if child:
                children.append(child)

        # 排序：AST 子节点必须按 order 排序
        children.sort(key=lambda x: getattr(x, 'order', 0) or 0)
        return children

    # =========================================================================
    # Patch Application (统一内存/存储变更路径)
    # =========================================================================

    def apply_patch(self, patch: GraphPatch) -> None:
        """
        将 GraphPatch 原子地应用到内存图。

        执行顺序 (与 Writer 协议一致):
          1. Prune (盲删) → 2. 删除节点/边 → 3. 添加节点 → 4. 更新属性 → 5. 列表操作 → 6. 添加边

        这使得 GraphPatch 不仅可用于外部存储写入，也可用于纯内存场景。
        """
        # 延迟导入避免循环依赖 (TYPE_CHECKING 仅供静态检查)
        from .patch import ListOpType

        # --- Phase 1: Prune (盲删出向邻居) ---
        for prune in patch.prune_actions:
            out_edges = self.get_out_edges(prune.src_id, prune.edge_type)
            target_ids = [e.dst for e in out_edges]
            for tid in target_ids:
                self.remove_node(tid, cascade=False)

        # --- Phase 2: Deletions ---
        for edge_req in patch.edges_to_remove:
            if edge_req.dst is not None:
                self.remove_edge(edge_req.src, edge_req.dst, edge_req.edge_type)
            else:
                # dst=None 语义: 删除 src 出发的所有该类型边
                out_edges = self.get_out_edges(edge_req.src, edge_req.edge_type)
                for e in list(out_edges):  # list() 防止迭代中修改
                    self.remove_edge(e.src, e.dst, e.type)

        for node_id in patch.nodes_to_remove:
            if node_id in self.nodes:
                self.remove_node(node_id, cascade=False)

        # --- Phase 3: Add Nodes ---
        for node in patch.nodes_to_add:
            if node.id in self.nodes:
                # 遵循 patch.strategy
                from .patch import PatchStrategy
                if patch.strategy == PatchStrategy.SKIP_ON_EXIST:
                    continue
                elif patch.strategy == PatchStrategy.FAIL_ON_EXIST:
                    raise RuntimeError(f"apply_patch: Node {node.id} already exists (FAIL_ON_EXIST)")
                # OVERWRITE: 直接覆盖
            self.add_node(node)

        # --- Phase 4: Property Updates ---
        for update in patch.node_property_updates:
            node = self.nodes.get(update.id)
            if node is None:
                logger.warning(f"apply_patch: Node {update.id} not found for property update")
                continue
            for key, value in update.properties.items():
                if hasattr(node, key):
                    setattr(node, key, value)
                else:
                    # 对于 extra='allow' 的节点，直接设置
                    setattr(node, key, value)

        # --- Phase 5: Atomic List Operations ---
        for list_op in patch.node_list_updates:
            node = self.nodes.get(list_op.id)
            if node is None:
                logger.warning(f"apply_patch: Node {list_op.id} not found for list update")
                continue

            current_list = getattr(node, list_op.key, None)
            if current_list is None:
                current_list = []
                setattr(node, list_op.key, current_list)

            if list_op.op == ListOpType.APPEND:
                if list_op.value not in current_list:
                    current_list.append(list_op.value)
            elif list_op.op == ListOpType.REMOVE:
                try:
                    current_list.remove(list_op.value)
                except ValueError:
                    pass  # 值不存在，静默跳过

        # --- Phase 6: Add Edges ---
        for edge in patch.edges_to_add:
            self._add_edge_internal(edge, check_duplicates=True)