from abc import ABC, abstractmethod
import hashlib
from typing import Dict, Optional, TypeVar

from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import FileNode, MethodNode
from codedmap.core.schema.graph.enums import NodeLabel

class BaseIntegration(ABC):
    """
    [Integration Contract] 所有外部数据集成器的基类。
    增强了 Anchor (锚点) 管理能力。
    """
    
    def __init__(self, name: str):
        self.name = name
        # 本地缓存：防止在同一次运行中重复创建同一个 Anchor
        self._anchor_cache: Dict[str, int] = {}

    @abstractmethod
    def run(self, store: CPGStore, **kwargs) -> CPGGraph:
        """执行集成逻辑"""
        pass

    # --- Anchor Management ---

    def get_or_create_file_anchor(self, graph: CPGGraph, file_path: str) -> FileNode:
        """
        [Helper] 获取或创建一个文件锚点节点。
        
        策略：
        1. 使用确定性 ID (基于路径哈希)，确保不同插件生成的 Anchor ID 一致。
        2. 自动添加到传入的 graph 中。
        """
        # 1. 检查本地缓存
        if file_path in self._anchor_cache:
            node_id = self._anchor_cache[file_path]
            # 我们需要从 graph 中把对象取出来返回，或者重新构建一个轻量对象
            # 简单起见，如果缓存命中，说明 graph 里已经有了
            return graph.nodes[node_id]

        # 2. 生成确定性 ID (Deterministic ID)
        # 这样即使 Fuzzing 和 Trace 分别运行，生成的 ID 也是一样的，Merge 时会自动合并
        anchor_id = self._generate_deterministic_id(f"FILE:{file_path}")
        
        # 3. 创建节点
        # 注意：这里我们创建一个最小化的 FileNode
        anchor = FileNode(
            id=anchor_id,
            name=file_path,
            fullName=file_path,
            label=NodeLabel.FILE,
            order=0  # 默认值
        )
        
        # 4. 加入图和缓存
        graph.add_node(anchor)
        self._anchor_cache[file_path] = anchor_id
        
        return anchor

    def get_or_create_method_anchor(self, graph: CPGGraph, method_name: str, file_path: str = "") -> MethodNode:
        """
        [Helper] 获取或创建一个方法锚点节点。
        """
        key = f"METHOD:{file_path}:{method_name}"
        if key in self._anchor_cache:
            return graph.nodes[self._anchor_cache[key]]
            
        anchor_id = self._generate_deterministic_id(key)
        
        anchor = MethodNode(
            id=anchor_id,
            name=method_name,
            fullName=method_name, # 简化的全名
            label=NodeLabel.METHOD,
            signature="<unknown>",
            isExternal=True # 标记为外部/未知
        )
        
        graph.add_node(anchor)
        self._anchor_cache[key] = anchor_id
        return anchor

    def _generate_deterministic_id(self, key: str) -> int:
        """
        生成基于字符串内容的唯一 ID (64-bit int)。
        用于确保 Anchor 的跨层一致性。
        """
        # 使用 SHA256 取前 8 字节转为 int
        hash_bytes = hashlib.sha256(key.encode('utf-8')).digest()
        # 限制在 63位 整数范围内 (避免 Java/Neo4j 溢出)
        return int.from_bytes(hash_bytes[:8], byteorder='big') & 0x7FFFFFFFFFFFFFFF