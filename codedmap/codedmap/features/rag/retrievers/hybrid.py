# codedmap/features/rag/retrievers/hybrid.py

import logging
from typing import List, Optional, Any

try:
    from llama_index.core.embeddings import BaseEmbedding
    from llama_index.core.schema import NodeWithScore
    HAS_LLAMA_INDEX = True
except ImportError:
    BaseEmbedding = Any
    NodeWithScore = Any
    HAS_LLAMA_INDEX = False

from codedmap.infra.storage.store import CPGStore
from codedmap.features.rag.bridge import GraphBridge
from codedmap.features.rag.indexers.base import BaseIndexer

logger = logging.getLogger(__name__)

class HybridRetriever:
    """
    [Level 2] 混合检索 (Keyword + Vector)。
    完全解耦：不依赖 Neo4jBackend，不写 Raw Cypher。
    """
    def __init__(
        self, 
        store: CPGStore, 
        embed_model: BaseEmbedding,
        indexers: List[BaseIndexer]
    ):
        if not HAS_LLAMA_INDEX:
            raise ImportError(
                "RAG features require optional dependencies. Install the 'rag' extra "
                "(for example: `pip install .[rag]`)."
            )
        self.store = store
        self.embed_model = embed_model
        self.indexers = indexers
        self.bridge = GraphBridge(store)

    def search(self, query: str, top_k: int = 5) -> List[NodeWithScore]:
        all_results = []
        
        # 1. Embedding
        try:
            query_embedding = self.embed_model.get_query_embedding(query)
        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            return []

        for indexer in self.indexers:
            # 2. 向量检索 (Delegate to Indexer)
            # Indexer 返回的是 [{"node": CPGNode, "score": float}]
            raw_vectors = indexer.search(query_embedding, top_k)
            for item in raw_vectors:
                l_node = self.bridge.cpg_node_to_llama_node(item["node"], item["score"])
                all_results.append(l_node)
            
            # 3. 关键词检索 (使用 Store DSL!)
            # 逻辑：查找指定 Label，且 name/fullName 包含 query
            # 利用我们刚刚添加的 where_contains 算子
            label = indexer.get_filter_label()
            
            # 搜索 name
            nodes_name = (self.store.query
                          .all_nodes(label)
                          .where_contains("name", query)
                          .limit(top_k)
                          .to_list())
            
            # 搜索 fullName (可选，取决于 DSL 是否支持 OR，如果不支持则分开查)
            nodes_fullname = (self.store.query
                              .all_nodes(label)
                              .where_contains("fullName", query)
                              .limit(top_k)
                              .to_list())
            
            for node in nodes_name + nodes_fullname:
                # Keyword search score default to 1.0 or heuristic
                l_node = self.bridge.cpg_node_to_llama_node(node, score=0.8)
                all_results.append(l_node)

        # 4. 去重与排序
        all_results.sort(key=lambda x: x.score or 0.0, reverse=True)
        return self._deduplicate(all_results, top_k)

    def _deduplicate(self, results: List[NodeWithScore], top_k: int) -> List[NodeWithScore]:
        seen = set()
        unique = []
        for r in results:
            if not r.node.metadata or "node_id" not in r.node.metadata:
                continue
            nid = r.node.metadata["node_id"]
            if nid not in seen:
                seen.add(nid)
                unique.append(r)
        return unique[:top_k]