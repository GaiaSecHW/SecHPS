# codedmap/features/rag/indexers/neo4j_indexers.py

import logging
from typing import List, Dict, Any, Optional
from .base import BaseIndexer
from codedmap.core.schema.graph.enums import NodeLabel, VectorIndexName

try:
    from codedmap.infra.storage.base.converter import DataConverter
except ImportError:
    DataConverter = None

logger = logging.getLogger(__name__)

class Neo4jVectorIndexer(BaseIndexer):
    """Neo4j 向量索引通用实现 (Template Base Class)"""
    
    GLOBAL_INDEX_NAME = "global_vector_index"

    def __init__(self, store, label: str):
        super().__init__(store)
        self.label = label

    def get_filter_label(self) -> str:
        return self.label

    def search(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        cypher = self._get_search_cypher()
        
        params = {
            "index_name": self.GLOBAL_INDEX_NAME,
            "k": top_k,
            "embedding": query_embedding
        }
        
        try:
            records = self.store.run_cypher(cypher, params)
            return self._process_results(records)
        except Exception as e:
            logger.warning(f"Neo4j vector search failed: {e}")
            return []

    def _get_search_cypher(self) -> str:
        """
        两跳查询: VectorNode -> HostNode
        """
        # 这里的 self.label 是构造时传入的 (e.g. "METHOD")
        # 我们利用它来过滤回溯的宿主类型
        return f"""
        CALL db.index.vector.queryNodes($index_name, $k, $embedding)
        YIELD node AS vec_node, score
        
        // Backtrack to Host
        MATCH (host:`{self.label}`)-[:HAS_VECTOR]->(vec_node)
        
        RETURN host AS node, score
        """

    def _process_results(self, records) -> List[Dict[str, Any]]:
        """[Hook] 默认处理: 转换 node 和 score"""
        results = []
        for r in records:
            raw_node = r.get("node")
            score = r.get("score")
            
            if DataConverter:
                # 注意：to_pydantic 内部现在是严格 ID 校验，可能会返回 None
                cpg_node = DataConverter.to_pydantic(raw_node)
                if cpg_node:
                    results.append({"node": cpg_node, "score": score})
        return results


class Neo4jChunkIndexer(Neo4jVectorIndexer):
    """
    [Graph-RAG] 针对 Chunk 的索引器。
    特点：查询 Chunk，但同时返回 Parent Method 信息 (Graph Traversal)。
    """
    def __init__(self, store):
        super().__init__(store, NodeLabel.EMBEDDING_CHUNK.value)

    def _get_search_cypher(self) -> str:
        """
        查询路径: 
        1. Index -> VectorNode
        2. VectorNode <-[:HAS_VECTOR]- Chunk
        3. Chunk <-[:HAS_CHUNK]- Method
        """
        return f"""
        CALL db.index.vector.queryNodes($index_name, $k, $embedding)
        YIELD node AS vec_node, score
        
        // 1. Backtrack to Chunk
        MATCH (chunk:`{self.label}`)-[:HAS_VECTOR]->(vec_node)
        
        // 2. Backtrack to Method (Context)
        OPTIONAL MATCH (method)-[:HAS_CHUNK]->(chunk)
        
        RETURN chunk AS node, score, method
        """

    def _process_results(self, records) -> List[Dict[str, Any]]:
        """
        重写处理逻辑，注入 Context Metadata
        """
        results = []
        for r in records:
            raw_chunk = r.get("node")
            raw_method = r.get("method")
            score = r.get("score")

            if DataConverter:
                chunk_node = DataConverter.to_pydantic(raw_chunk)
                
                if chunk_node:
                    # [Safety Check] 确保 method 存在
                    method_name = "Unknown"
                    method_file = "Unknown"
                    method_id = -1
                    
                    if raw_method:
                        # Neo4j Node 对象通常像 Dict 一样访问
                        method_name = raw_method.get("name", "Unknown")
                        method_file = raw_method.get("fileName", raw_method.get("full_name", "Unknown"))
                        method_id = raw_method.get("id", -1)

                    # [Context Injection]
                    # 如果 Pydantic 模型不支持动态 setattr，这里会失败。
                    # 建议方案：如果 CPGNode 没有 metadata 字段，则依赖 Bridge.py 的外部组装。
                    # 这里我们假设 CPGNode 定义了 metadata: Optional[Dict] = Field(default_factory=dict)
                    
                    # 为了规避 Pydantic "Frozen" 或 "Extra Forbidden" 问题，
                    # 我们先检查是否有 metadata 属性，如果没有，我们可能需要 wrapper
                    if hasattr(chunk_node, "metadata"):
                        if chunk_node.metadata is None:
                            chunk_node.metadata = {}
                        
                        chunk_node.metadata.update({
                            "source_method": method_name,
                            "source_file": method_file,
                            "method_id": method_id
                        })
                    else:
                        # Fallback: 如果 Node 定义不支持 metadata，我们可以把这些信息
                        # 临时挂载到对象上的 _temp_metadata (不做校验)
                        # 或者在返回的 dict 中不仅仅返回 node，还返回 context
                        chunk_node._temp_metadata = {
                             "source_method": method_name,
                             "source_file": method_file,
                             "method_id": method_id
                        }
                        # Bridge 需要适配读取 _temp_metadata
                    
                    results.append({"node": chunk_node, "score": score})
        return results


# 工厂类调整 (不再传 Index Name)
class Neo4jFuncIndexer(Neo4jVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.METHOD.value)

class Neo4jStructIndexer(Neo4jVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.TYPE_DECL.value)

class Neo4jFileIndexer(Neo4jVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.FILE.value)

class Neo4jModuleIndexer(Neo4jVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.DIRECTORY.value)

class Neo4jLiteralIndexer(Neo4jVectorIndexer):
    def __init__(self, store):
        super().__init__(store, NodeLabel.LITERAL.value)    