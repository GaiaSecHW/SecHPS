# codedmap\core\schema\patch.py

import time
from typing import List, Set, Dict, Any, Optional, Union
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict

from .container import AnyNode
from .edges import CPGEdge
from .enums import EdgeType

# --- Enums ---

class PatchStrategy(str, Enum):
    """
    补丁冲突解决策略。
    用于指导 Writer 在遇到数据已存在时的行为。
    """
    OVERWRITE = "OVERWRITE"      # 默认：覆盖旧值 (Merge/Upsert)
    SKIP_ON_EXIST = "SKIP_ON_EXIST" # 如果存在则跳过 (Keep Old)
    FAIL_ON_EXIST = "FAIL_ON_EXIST" # 如果存在则报错 (Strict Mode)

class ListOpType(str, Enum):
    """列表操作类型"""
    APPEND = "APPEND"  # 追加 (自动去重)
    REMOVE = "REMOVE"  # 移除

# --- Models ---

class EdgeRemovalRequest(BaseModel):
    """
    边删除请求。
    dst 为 Optional，支持 "删除从 src 出发的所有特定类型边" 的语义（如果 Writer 支持）。
    """
    src: int
    dst: Optional[int] = None 
    edge_type: EdgeType
    model_config = ConfigDict(use_enum_values=True)

class NodePropertyUpdate(BaseModel):
    id: int
    properties: Dict[str, Any]

class NodeListUpdate(BaseModel):
    """
    [Atomic] 列表属性原子变更请求。
    """
    id: int
    key: str  # 属性名 (e.g. "tags", "topics")
    value: Any # 要追加/移除的值
    op: ListOpType = ListOpType.APPEND
    
    # Pydantic V2 config
    model_config = ConfigDict(use_enum_values=True)


class PruneRequest(BaseModel):
    """
    [Blind Write] 盲写删除请求。
    语义：找到从 `src_id` 出发，通过 `edge_type` 连接的所有目标节点，并删除它们（及其关系）。
    """
    src_id: int
    edge_type: EdgeType
    model_config = ConfigDict(use_enum_values=True)


class GraphPatch(BaseModel):
    """
    [Core] 图修复补丁 (Graph Repair Patch).
    
    定义了对图数据的一次原子性变更。
    Writer 应该在一个事务中按顺序执行：删除 -> 添加节点 -> 更新属性 -> 添加边。
    """
    
    # --- Metadata ---
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    created_by: Optional[str] = Field(default=None, description="创建该Patch的分析器名称")
    strategy: PatchStrategy = Field(default=PatchStrategy.OVERWRITE, description="写入冲突策略")

    # --- Payload ---
    # 1. Additions
    nodes_to_add: List[AnyNode] = Field(default_factory=list)
    edges_to_add: List[CPGEdge] = Field(default_factory=list)
    
    # 2. Deletions
    nodes_to_remove: Set[int] = Field(default_factory=set)
    edges_to_remove: List[EdgeRemovalRequest] = Field(default_factory=list)
    
    # 3. Updates
    node_property_updates: List[NodePropertyUpdate] = Field(default_factory=list)

    # 4. Atomic List Operations
    node_list_updates: List[NodeListUpdate] = Field(default_factory=list)

    # 5. Pruning
    prune_actions: List[PruneRequest] = Field(default_factory=list)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # --- Fluent Builders (链式调用) ---

    def add_node(self, node: AnyNode) -> 'GraphPatch':
        self.nodes_to_add.append(node)
        return self

    def add_edge(self, src: Union[int, AnyNode], dst: Union[int, AnyNode], edge_type: EdgeType, **props) -> 'GraphPatch':
        """
        添加边。支持传入 Node 对象或直接传入 ID。
        """
        src_id = getattr(src, 'id', src)
        dst_id = getattr(dst, 'id', dst)

        # 简单的类型守卫
        if not isinstance(src_id, int) or not isinstance(dst_id, int):
            raise ValueError(f"Edge source/target must resolve to int ID. Got: {src}, {dst}")

        # Propagate patch created_by to edge if not explicitly overridden
        created_by = props.pop("created_by", self.created_by or "static")
        edge = CPGEdge(src=src_id, dst=dst_id, type=edge_type, properties=props, created_by=created_by)
        self.edges_to_add.append(edge)
        return self

    def remove_node(self, node_id: int) -> 'GraphPatch':
        self.nodes_to_remove.add(node_id)
        return self

    def remove_edge(self, src: int, dst: int, edge_type: EdgeType) -> 'GraphPatch':
        req = EdgeRemovalRequest(src=src, dst=dst, edge_type=edge_type)
        self.edges_to_remove.append(req)
        return self

    def remove_outgoing_neighbors(self, src_id: int, edge_type: EdgeType) -> 'GraphPatch':
        """
        [Optimization] 声明式删除：删除 src_id 通过 edge_type 连接的所有目标节点。
        不需要知道目标节点的 ID。
        """
        self.prune_actions.append(PruneRequest(src_id=src_id, edge_type=edge_type))
        return self

    def update_node(self, node_id: int, **properties) -> 'GraphPatch':
        """添加属性更新请求"""
        if not properties: return self
        update = NodePropertyUpdate(id=node_id, properties=properties)
        self.node_property_updates.append(update)
        return self

    def property_list_append(self, node_id: int, key: str, value: Any) -> 'GraphPatch':
        """
        [Atomic] 向列表属性追加值。
        """
        self.node_list_updates.append(NodeListUpdate(
            id=node_id, 
            key=key, 
            value=value, 
            op=ListOpType.APPEND
        ))
        return self

    def property_list_remove(self, node_id: int, key: str, value: Any) -> 'GraphPatch':
        """
        [Atomic] 从列表属性移除值。
        """
        self.node_list_updates.append(NodeListUpdate(
            id=node_id, 
            key=key, 
            value=value, 
            op=ListOpType.REMOVE
        ))
        return self

    # --- Utilities ---

    @property
    def is_empty(self) -> bool:
        """检查 Patch 是否为空操作"""
        return not (self.nodes_to_add or self.edges_to_add or 
                    self.nodes_to_remove or self.edges_to_remove or 
                    self.node_property_updates or self.node_list_updates or
                    self.prune_actions)

    def merge(self, other: 'GraphPatch') -> 'GraphPatch':
        """
        将另一个 Patch 合并入当前 Patch。
        注意：Strategy 以当前 Patch 为准。
        """
        self.prune_actions.extend(other.prune_actions)
        self.nodes_to_add.extend(other.nodes_to_add)
        self.edges_to_add.extend(other.edges_to_add)
        self.nodes_to_remove.update(other.nodes_to_remove)
        self.edges_to_remove.extend(other.edges_to_remove)
        self.node_property_updates.extend(other.node_property_updates)
        self.node_list_updates.extend(other.node_list_updates)
        return self

    @classmethod
    def merge_all(cls, patches: List['GraphPatch'], strategy: PatchStrategy = PatchStrategy.OVERWRITE) -> 'GraphPatch':
        """
        将多个 Patch 合并为一个大的原子 Patch。
        """
        if not patches:
            return cls(strategy=strategy)
        
        # 创建一个新的大 Patch
        merged = cls(
            created_by=f"MergedBatch({len(patches)})",
            strategy=strategy
        )

        for p in patches:
            if p.is_empty: continue
            
            # 列表扩展 (List Extension)
            merged.prune_actions.extend(p.prune_actions)
            merged.nodes_to_add.extend(p.nodes_to_add)
            merged.edges_to_add.extend(p.edges_to_add)
            merged.nodes_to_remove.update(p.nodes_to_remove)
            merged.edges_to_remove.extend(p.edges_to_remove)
            merged.node_property_updates.extend(p.node_property_updates)
            merged.node_list_updates.extend(p.node_list_updates)

        return merged

    def summary(self) -> str:
        """返回简短的统计字符串，用于日志记录"""
        return (f"Patch[+{len(self.nodes_to_add)}n, +{len(self.edges_to_add)}e, "
                f"-{len(self.nodes_to_remove)}n, -{len(self.edges_to_remove)}e, "
                f"~{len(self.node_property_updates)}u, !{len(self.prune_actions)}p]")

        