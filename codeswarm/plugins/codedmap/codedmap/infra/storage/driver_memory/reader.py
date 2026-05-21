# codedmap/infra/storage/driver_memory/reader.py

import json
import math
import pickle
from collections import defaultdict
from typing import List, Dict, Optional, Any, Tuple

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.nodes import VectorNode

from codedmap.infra.storage.interfaces import GraphReader
from codedmap.infra.storage.driver_memory.store import MemoryDatabase


class MemoryReader(GraphReader):
    def __init__(self, db: MemoryDatabase):
        self.db = db

    def get_node(self, node_id: int) -> Optional[Any]:
        # 直接利用 Indexer O(1) 查找
        return self.db.indexer.get_node(node_id)

    def get_nodes_batch(self, node_ids: List[int]) -> List[Any]:
        """
        [Lightweight] 批量获取节点对象（不包含任何边）。
        内存模式下直接查索引，速度极快 (O(N) 字典查找)。
        """
        if not node_ids:
            return []

        indexer = self.db.indexer
        result = []

        # 去重
        unique_ids = set(node_ids)

        for nid in unique_ids:
            # 直接从内存索引获取引用
            node = indexer.get_node(nid)
            if node:
                result.append(node)

        return result

    def get_neighbors(self, node_id: int, direction: str, edge_types: Optional[List[str]]) -> List[int]:
        # 简单起见，直接操作 graph._out_index
        # 这比通过 Indexer 获取 Node 对象再取 ID 要快
        graph = self.db.graph
        adj = graph._out_index.get(node_id, []) if direction == "OUT" else graph._in_index.get(node_id, [])

        target_type_set = set(t for t in edge_types) if edge_types else None

        res = []
        for edge in adj:
            # 兼容 Enum/Str
            etype = edge.type.value if hasattr(edge.type, 'value') else edge.type
            if target_type_set and etype not in target_type_set:
                continue
            res.append(edge.dst if direction == "OUT" else edge.src)
        return res

    def get_neighbors_batch(self, node_ids: List[int], direction: str, edge_types: Optional[List[str]]) -> Dict[
        int, List[int]]:
        """
        内存模式的简单实现：循环调用 get_neighbors。
        由于是纯内存操作，循环的开销可以忽略不计。
        """
        result = {}
        # 去重，避免重复计算
        unique_ids = set(node_ids)

        for nid in unique_ids:
            neighbors = self.get_neighbors(nid, direction, edge_types)
            if neighbors:
                result[nid] = neighbors
        return result

    def get_neighbor_nodes_batch(self,
                                 node_ids: List[int],
                                 direction: str,
                                 edge_types: Optional[List[str]],
                                 target_labels: Optional[List[str]] = None) -> Dict[int, List[CPGNode]]:
        """
        [In-Memory Implementation]
        纯内存过滤和对象获取。速度极快，无需 IO。
        """
        result = defaultdict(list)
        if not node_ids: return dict(result)

        # 1. 预处理过滤条件 (Set Lookup is O(1))
        edge_type_set = set(edge_types) if edge_types else None
        target_label_set = set(target_labels) if target_labels else None

        # 2. 获取图引用
        graph = self.db.graph
        indexer = self.db.indexer

        # 3. 确定遍历方向的索引
        # _out_index: src -> List[Edge]
        # _in_index: dst -> List[Edge]
        adj_index = graph._out_index if direction == "OUT" else graph._in_index

        unique_ids = set(node_ids)

        for src_id in unique_ids:
            edges = adj_index.get(src_id)
            if not edges: continue

            target_nodes = []

            for edge in edges:
                # --- Filter 1: Edge Type ---
                if edge_type_set:
                    # 兼容 Enum 和 String
                    etype = edge.type.value if hasattr(edge.type, 'value') else edge.type
                    if etype not in edge_type_set:
                        continue

                # Resolve Target
                target_id = edge.dst if direction == "OUT" else edge.src

                # --- Object Lookup ---
                node_obj = indexer.get_node(target_id)
                if not node_obj: continue  # Should not happen in consistent graph

                # --- Filter 2: Node Label ---
                if target_label_set:
                    lbl = getattr(node_obj, 'label', None)
                    # 兼容 Enum 和 String
                    lbl_str = lbl.value if hasattr(lbl, 'value') else str(lbl)
                    if lbl_str not in target_label_set:
                        continue

                target_nodes.append(node_obj)

            if target_nodes:
                result[src_id] = target_nodes

        return dict(result)

    def get_subgraph(self, node_ids: List[int]) -> Any:
        return self.db.graph.get_subgraph(node_ids)

    def export_to_file(self, path: str, format: str = "json"):
        """直接序列化内存图对象"""
        if format == "pickle":
            with open(path, "wb") as f:
                pickle.dump(self.db.graph, f)
        else:
            # 假设 CPGGraph 有 export 方法
            graph_data = self.db.graph.model_dump(mode='json', by_alias=True)

            with open(path, 'w', encoding='utf-8') as f:
                json.dump(graph_data, f, ensure_ascii=False, indent=2)

    def search_similar_nodes(self,
                             label: str,
                             property: str,
                             query_vector: List[float],
                             top_k: int = 5,
                             min_score: float = 0.0) -> List[Tuple[Any, float]]:
        """
        [Vector Search - In-Memory Brute Force]

        执行逻辑：
        1. 遍历所有 VectorNode。
        2. 计算 Cosine Similarity。
        3. 如果 Score 达标，反向查找 Host Node。
        4. 过滤 Host Node 的 Label。
        """
        candidates = []
        indexer = self.db.indexer

        # 1. 遍历所有 VectorNode (而不是 target label)
        vector_nodes = indexer.get_nodes_by_label(NodeLabel.VECTOR)

        # 预计算 Query Vector 的 Norm
        query_norm = math.sqrt(sum(x * x for x in query_vector))
        if query_norm == 0: return []

        for v_node in vector_nodes:
            # 安全检查
            if not isinstance(v_node, VectorNode): continue

            target_vector = v_node.embedding
            if not target_vector: continue

            # 维度检查
            if len(target_vector) != len(query_vector): continue

            # 2. 计算相似度
            score = self._cosine_similarity(query_vector, target_vector, query_norm)

            if score >= min_score:
                # 3. 反向查找 Host Node
                # Path: (Host) -[:HAS_VECTOR]-> (VectorNode)
                # 所以我们要找 VectorNode 的入边 (IN)
                hosts = list(indexer.get_neighbors(v_node.id, EdgeType.HAS_VECTOR, "IN"))

                if hosts:
                    host = hosts[0]  # 理论上是一对一

                    # 4. 过滤 Host Label
                    h_lbl = getattr(host, 'label', '')
                    h_lbl_str = h_lbl.value if hasattr(h_lbl, 'value') else str(h_lbl)

                    target_lbl_str = label.value if hasattr(label, 'value') else str(label)

                    if h_lbl_str == target_lbl_str:
                        candidates.append((host, score))

        # 5. Sort & TopK
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[:top_k]

    def list_tags(self, prefix: str = None) -> List[str]:
        all_tags: set = set()
        upper_prefix = prefix.upper() if prefix is not None else None
        for node in self.db.graph.nodes.values():
            tags = getattr(node, 'tags', None)
            if not tags:
                continue
            for tag in tags:
                if not tag:
                    continue
                if upper_prefix is None or tag.upper().startswith(upper_prefix):
                    all_tags.add(tag)
        return sorted(all_tags)

    def count_edges(self, edge_type: Optional[str] = None) -> int:
        """
        Count edges in the memory graph.
        O(N) scan but fast in memory.
        """
        if edge_type is None:
            return len(self.db.graph.edges)
        
        count = 0
        for edge in self.db.graph.edges:
            etype = edge.type.value if hasattr(edge.type, 'value') else edge.type
            if etype == edge_type:
                count += 1
        return count

    def find_edge(self, src: int, dst: int, edge_type: str) -> Optional[Any]:
        """
        Find a specific edge by source, destination, and type.
        O(E_src) scan of outgoing edges from src.
        """
        for edge in self.db.graph._out_index.get(src, []):
            etype = edge.type.value if hasattr(edge.type, 'value') else edge.type
            if edge.dst == dst and etype == edge_type:
                return edge
        return None

    def _cosine_similarity(self, v1: List[float], v2: List[float], norm_v1: float = None) -> float:
        """纯 Python 计算余弦相似度"""
        dot_product = sum(a * b for a, b in zip(v1, v2))

        if norm_v1 is None:
            norm_a = math.sqrt(sum(a * a for a in v1))
        else:
            norm_a = norm_v1

        norm_b = math.sqrt(sum(b * b for b in v2))

        if norm_a == 0 or norm_b == 0:
            return 0.0

        return dot_product / (norm_a * norm_b)