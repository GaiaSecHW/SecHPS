# codedmap/features/rag/engine.py

from typing import List
import logging

from codedmap.core.configs.ai import AIConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.features.rag.retrievers.graph_walk import GraphWalkRetriever

try:
    from llama_index.embeddings.openai import OpenAIEmbedding
    from llama_index.llms.openai import OpenAI
    from codedmap.features.rag.retrievers.hybrid import HybridRetriever
    from codedmap.features.rag.prompts.security import GRAPH_CONTEXT_TEMPLATE
    from codedmap.features.rag.indexers.neo4j_indexers import (
        Neo4jFileIndexer,
        Neo4jFuncIndexer,
        Neo4jLiteralIndexer,
        Neo4jModuleIndexer,
        Neo4jStructIndexer,
        Neo4jChunkIndexer,
    )
    from codedmap.features.rag.indexers.memory_indexers import (
        MemoryFileIndexer,
        MemoryFunctionIndexer,
        MemoryLiteralIndexer,
        MemoryModuleIndexer,
        MemoryStructIndexer,
        MemoryChunkIndexer,
    )
    _RAG_IMPORT_ERROR = None
except ImportError as exc:
    OpenAIEmbedding = None
    OpenAI = None
    HybridRetriever = None
    GRAPH_CONTEXT_TEMPLATE = None
    Neo4jFileIndexer = None
    Neo4jFuncIndexer = None
    Neo4jLiteralIndexer = None
    Neo4jModuleIndexer = None
    Neo4jStructIndexer = None
    Neo4jChunkIndexer = None
    MemoryFileIndexer = None
    MemoryFunctionIndexer = None
    MemoryLiteralIndexer = None
    MemoryModuleIndexer = None
    MemoryStructIndexer = None
    MemoryChunkIndexer = None
    _RAG_IMPORT_ERROR = exc

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

logger = logging.getLogger(__name__)

class CPGRAGEngine:
    """
    RAG 模块 Facade。
    """
    def __init__(self, ai_config: AIConfig, storage_config: StorageConfig, store: CPGStore):
        if _RAG_IMPORT_ERROR is not None:
            raise ImportError(
                "RAG features require optional dependencies. Install the 'rag' extra "
                "(for example: `pip install .[rag]`)."
            ) from _RAG_IMPORT_ERROR

        self.ai_config = ai_config
        self.storage_config = storage_config
        self.store = store

        # 1. Init AI
        self.embed_model = OpenAIEmbedding(
            api_key=ai_config.get_openai_api_key(),
            model="source_code-embedding-3-small"
        )
        self.llm = OpenAI(
            model=ai_config.model_name,
            api_key=ai_config.get_openai_api_key(),
            temperature=0.1
        )

        # 2. Init Indexers (根据 Config 决定使用 Neo4j 还是 Memory Indexer)
        backend_type = storage_config.backend  # "neo4j" or "memory"
        if backend_type == "memory":
            logger.info("Initializing In-Memory RAG Indexers...")
            self.indexers = [
                MemoryFunctionIndexer(store),
                MemoryStructIndexer(store),
                MemoryChunkIndexer(store),
                MemoryFileIndexer(store),
                MemoryModuleIndexer(store),
                MemoryLiteralIndexer(store)
            ]
        else:
            logger.info("Initializing Neo4j RAG Indexers...")
            self.indexers = [
                Neo4jFuncIndexer(store),
                Neo4jStructIndexer(store),
                Neo4jChunkIndexer(store),
                Neo4jFileIndexer(store),
                Neo4jModuleIndexer(store),
                Neo4jLiteralIndexer(store)
            ]

        # 3. Init Retrievers
        self.hybrid_retriever = HybridRetriever(store, self.embed_model, self.indexers)
        self.graph_walker = GraphWalkRetriever(store)

    def query_with_graph_context(self, query: str, depth: int = 1) -> str:
        # Step 1: Retrieval
        entry_points = self.hybrid_retriever.search(query, top_k=3)
        if not entry_points:
            return "No relevant code entities found."

        final_response = []

        # Step 2: Context Expansion
        for entry in entry_points:
            node_id = entry.node.metadata["node_id"]
            graph_context = self.graph_walker.expand_context(node_id, depth)
            
            # Step 3: Generation
            prompt = GRAPH_CONTEXT_TEMPLATE.format(
                query_str=query,
                **graph_context
            )
            response = self.llm.complete(prompt)
            final_response.append(f"--- Analysis for {graph_context['target_name']} ---\n{response.text}")

        return "\n\n".join(final_response)


    # =========================================================
    # Memory Mode Warm-up Utilities
    # =========================================================

    def prepare_memory_index(self):
        """
        [Public API] 内存模式预热入口。
        """
        if tqdm is None:
            raise ImportError(
                "Memory index warm-up requires optional dependencies. Install the 'rag' extra "
                "(for example: `pip install .[rag]`)."
            )
        if self.storage_config.backend != "memory":
            logger.info("Skipping memory index preparation (Backend is not memory).")
            return

        logger.info("🔥 Warming up In-Memory Vector Index... (This implies OpenAI API costs)")
        
        total_processed = 0
        
        for indexer in self.indexers:
            label = indexer.get_filter_label()
            text_props = indexer.get_text_properties() 
            
            # 从 Store 获取所有节点
            nodes = self.store.query.all_nodes(label).to_list()
            if not nodes: continue
                
            logger.info(f"Generating embeddings for {len(nodes)} {label} nodes...")
            
            batch_nodes = []
            batch_texts = []
            batch_size = 16 
            
            for node in tqdm(nodes, desc=f"Embedding {label}"):
                # 检查是否已有向量 (避免重复预热)
                # 使用标准的 DSL 检查: Node -> HAS_VECTOR -> Vector
                existing_vecs = self.store.query.by_id(node.id).vectors().to_list()
                if existing_vecs:
                    continue

                # 1. 构建文本
                parts = []
                for prop in text_props:
                    val = getattr(node, prop, "")
                    if val:
                        str_val = str(val)[:1000] 
                        parts.append(str_val)
                
                text_content = "\n".join(parts)
                if not text_content.strip():
                    text_content = getattr(node, "name", "unknown")

                batch_nodes.append(node)
                batch_texts.append(text_content)
                
                if len(batch_texts) >= batch_size:
                    self._flush_embeddings(batch_nodes, batch_texts)
                    total_processed += len(batch_nodes)
                    batch_nodes, batch_texts = [], []
            
            # Flush 剩余
            if batch_nodes:
                self._flush_embeddings(batch_nodes, batch_texts)
                total_processed += len(batch_nodes)

        logger.info(f"✅ Memory Index Warm-up complete. Processed {total_processed} nodes.")

    def _flush_embeddings(self, nodes: List, texts: List[str]):
        """
        [Internal - Strict Consistency] 
        调用 Embedding 模型，并创建符合 Schema 的 VectorNode。
        """
        try:
            embeddings = self.embed_model.get_text_embedding_batch(texts)
            
            # 批量写入可能需要优化，这里为了逻辑清晰，逐个调用 attach_vector
            # 由于是 Memory Backend，save_graph 开销极小 (只是字典操作)，不会有 IO 瓶颈
            for node, emb in zip(nodes, embeddings):
                self.store.vectors.attach_vector(
                    host_id=node.id,
                    embedding=emb,
                    model=self.ai_config.embed_model
                )
                
        except Exception as e:
            logger.error(f"Failed to generate embeddings batch: {e}")    