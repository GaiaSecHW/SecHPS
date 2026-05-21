# codedmap/features/rag/indexers/memory_indexer.py

import logging
import numpy as np
from typing import List, Dict, Any, Optional

from codedmap.features.rag.indexers.base import BaseIndexer
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, VectorIndexName

logger = logging.getLogger(__name__)

class MemoryVectorIndexer(BaseIndexer):
    """
    [In-Memory RAG] 内存向量索引器策略。
    
    原理:
    1. 从 Store (MemoryBackend) 拉取指定 Label 的所有节点。
    2. 提取节点上的 embedding 属性 (List[float])。
    3. 使用 NumPy 矩阵运算计算 Cosine Similarity。
    4. 返回 Top-K 结果。
    """

    def __init__(self, store, label: str):
        super().__init__(store)
        self.label = label

    def get_index_name(self) -> str:
        # 内存模式不需要真实的 DB 索引名，仅用于日志标识
        return f"memory_index_{self.label}"

    def get_filter_label(self) -> str:
        return self.label

    def get_text_properties(self) -> List[str]:
        return ["code", "signature", "name"]

    def get_embedding_property(self) -> str:
        """返回存储 Embedding 的属性名"""
        return "embedding"

    def search(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """
        执行基于 NumPy 的向量搜索。
        逻辑: HostNode -> HAS_VECTOR -> VectorNode -> Embedding
        """
        # 1. 获取候选宿主节点 (Host)
        # 例如: 获取所有 METHOD 节点
        candidates = self.store.query.all_nodes(self.label).to_list()
        
        valid_hosts = []
        vectors = []
        
        # 2. 遍历并解析向量
        for host in candidates:
            # [Consistency] 使用 DSL 跳转到 VectorNode
            # MemoryTraversal.out() 是基于内存引用的，速度非常快
            # Path: Host -> vectors() -> VectorNode
            vec_nodes = self.store.query.by_id(host.id).vectors().to_list()
            
            if vec_nodes:
                # 理论上 1:1，取第一个
                vec_node = vec_nodes[0]
                emb = getattr(vec_node, "embedding", None)
                
                if emb and isinstance(emb, list) and len(emb) > 0:
                    valid_hosts.append(host)
                    vectors.append(emb)
        
        if not valid_hosts:
            logger.debug(f"No embeddings found for label {self.label} (checked {len(candidates)} candidates)")
            return []

        # 3. 矩阵运算 (Cosine Similarity)
        try:
            vec_matrix = np.array(vectors)
            query_vec = np.array(query_embedding)
            
            dot_products = np.dot(vec_matrix, query_vec)
            norm_matrix = np.linalg.norm(vec_matrix, axis=1)
            norm_query = np.linalg.norm(query_vec)
            
            scores = dot_products / (norm_matrix * norm_query + 1e-9)
            
            # 4. 排序并返回 Host 节点
            k_actual = min(top_k, len(scores))
            if k_actual == 0: return []
            
            top_indices = np.argsort(scores)[-k_actual:][::-1]
            
            results = []
            for idx in top_indices:
                results.append({
                    "node": valid_hosts[idx], # 返回的是 Host 节点 (Method/File)，符合 Bridge 预期
                    "score": float(scores[idx])
                })
                
            return results

        except Exception as e:
            logger.error(f"Memory vector calculation failed: {e}")
            return []

# 具体实现类
class MemoryFunctionIndexer(MemoryVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.METHOD.value)

class MemoryStructIndexer(MemoryVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.TYPE_DECL.value)

class MemoryFileIndexer(MemoryVectorIndexer):
    """文件级摘要索引"""
    def __init__(self, store):
        # 假设 VectorIndexName 定义了 FILE_SUMMARY
        super().__init__(store, VectorIndexName.FILE_SUMMARY.value, NodeLabel.FILE.value)

class MemoryModuleIndexer(MemoryVectorIndexer):
    """
    [Graph-RAG] 针对 Directory 的模块级摘要索引。
    """
    def __init__(self, store):
        # 对应 VectorIndexName.MODULE_SUMMARY 和 NodeLabel.DIRECTORY
        super().__init__(store, VectorIndexName.MODULE_SUMMARY.value, NodeLabel.DIRECTORY.value)

class MemoryLiteralIndexer(MemoryVectorIndexer):
    """字面量索引 (用于查找硬编码、SQL等)"""
    def __init__(self, store):
        # 对应上一轮我们创建的 vector_index_literal_embedding
        super().__init__(store, VectorIndexName.LITERAL_VECTOR.value, NodeLabel.LITERAL.value)        

class MemoryChunkIndexer(MemoryVectorIndexer):
    """
    [Graph-RAG Memory] 内存版 Chunk 索引器。
    
    职责：
    1. 向量检索：找到最相似的 EmbeddingChunkNode。
    2. 图回溯 (Graph Traversal)：手动查找 Chunk 的父节点 (Method)，注入上下文元数据。
    """
    
    def __init__(self, store):
        # 对应 Label: EMBEDDING_CHUNK
        super().__init__(store, NodeLabel.EMBEDDING_CHUNK.value)

    def get_text_properties(self) -> List[str]:
        """
        Chunk 节点的文本内容存储在 'content' 字段，而不是 code/signature
        """
        return ["content"]

    def search(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        # 复用基类的 search，它现在会正确解析 Chunk -> Vector 关系
        raw_results = super().search(query_embedding, top_k)
        
        enriched_results = []
        for res in raw_results:
            chunk_node = res['node']
            score = res['score']
            
            # ... (保持原有的 Context Backtrack 逻辑: Chunk -> Method) ...
            try:
                parents = (self.store.query
                           .by_id(chunk_node.id)
                           .in_(EdgeType.HAS_CHUNK)
                           .to_list())
                
                if parents:
                    method_node = parents[0]
                    if not hasattr(chunk_node, "metadata") or chunk_node.metadata is None:
                        chunk_node.metadata = {}
                    
                    chunk_node.metadata.update({
                        "source_method": getattr(method_node, "name", "unknown"),
                        "source_file": getattr(method_node, "fileName", "unknown"),
                        "method_id": method_node.id
                    })
            except Exception:
                pass
            
            enriched_results.append(res)
            
        return enriched_results    