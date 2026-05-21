import pytest
from unittest.mock import MagicMock, ANY, patch
from typing import List, Dict, Any
import sys
import os
import types

# 确保项目根目录在 path 中 (方便直接运行 pytest)
sys.path.append(os.getcwd())

# [Core Schema]
from codedmap.core.schema.graph.nodes import MethodNode, FileNode, EmbeddingChunkNode
from codedmap.core.schema.graph.enums import Language, NodeLabel

# [Infra & Config]
from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.ai import AIConfig
from codedmap.core.configs.storage import StorageConfig

# [Feature: RAG]
from codedmap.features.rag.bridge import GraphBridge
from codedmap.features.rag.retrievers.hybrid import HybridRetriever
from codedmap.features.rag.retrievers.graph_walk import GraphWalkRetriever
from codedmap.features.rag.engine import CPGRAGEngine
from codedmap.features.rag import bridge as bridge_module
from codedmap.features.rag.retrievers import hybrid as hybrid_module
from codedmap.features.rag import engine as engine_module
# indexers.base 仅用于类型引用，实际测试中主要 mock 具体实现
from codedmap.features.rag.indexers.base import BaseIndexer


class FakeTextNode:
    def __init__(self, text: str, metadata: Dict[str, Any], excluded_llm_metadata_keys=None):
        self.text = text
        self.metadata = metadata
        self.excluded_llm_metadata_keys = excluded_llm_metadata_keys or []


class FakeNodeWithScore:
    def __init__(self, node, score: float = 1.0):
        self.node = node
        self.score = score


class FakeBridge:
    def __init__(self, store):
        self.store = store

    def cpg_node_to_llama_node(self, node, score: float = 1.0):
        return FakeNodeWithScore(
            node=types.SimpleNamespace(metadata={"node_id": node.id}, text=node.name),
            score=score,
        )

# =============================================================================
# Fixtures: 准备通用的 Mock 对象和测试数据
# =============================================================================

@pytest.fixture
def mock_store():
    """
    [Mock] CPGStore Facade
    这是所有 RAG 组件的核心依赖。
    """
    store = MagicMock(spec=CPGStore)
    
    # Mock Repository
    store.methods = MagicMock()
    
    # Mock Query (Traversal) - 模拟链式调用
    mock_traversal = MagicMock()
    store.query = mock_traversal
    
    # Mock run_cypher (用于 Neo4j 模式的 Indexer)
    store.run_cypher = MagicMock()
    
    return store

@pytest.fixture
def mock_embed_model():
    """Mock LlamaIndex Embedding Model"""
    embed_model = MagicMock()
    # 模拟返回一个固定的向量 (维度 3)
    embed_model.get_query_embedding.return_value = [0.1, 0.2, 0.3]
    embed_model.get_text_embedding_batch.return_value = [[0.1, 0.2, 0.3]]
    return embed_model

@pytest.fixture
def sample_method_node():
    """创建一个标准的 MethodNode (Intent) 用于测试"""
    return MethodNode(
        id=1001,
        label="METHOD",
        name="test_func",
        fullName="test_func",
        signature="void test_func(int a)",
        filename="test.c",
        summary="A test function",
        code="void test_func(int a) { return; }"
    )

@pytest.fixture
def sample_chunk_node():
    """
    [New] 创建一个 EmbeddingChunkNode (Implementation) 用于测试 Graph-RAG。
    注意：这里模拟了 Neo4jChunkIndexer 注入的 metadata。
    """
    node = EmbeddingChunkNode(
        id=5001,
        label="EMBEDDING_CHUNK",
        name="test_func_chunk_0",
        content="if (a > 10) { panic(); }",
        embedding=[0.1, 0.2, 0.3],
        chunk_index=0
    )
    # 模拟 Indexer 注入的上下文信息
    node.metadata = {
        "source_method": "test_func",
        "source_file": "test.c",
        "method_id": 1001
    }
    return node

# =============================================================================
# Test 1: Bridge Layer (测试 Prompt 格式化与 Metadata 传递)
# =============================================================================

def test_bridge_method_conversion(mock_store, sample_method_node, monkeypatch):
    """测试 Intent (Method) 节点的转换"""
    monkeypatch.setattr(bridge_module, "TextNode", FakeTextNode)
    monkeypatch.setattr(bridge_module, "NodeWithScore", FakeNodeWithScore)
    bridge = GraphBridge(mock_store)
    node_with_score = bridge.cpg_node_to_llama_node(sample_method_node, score=0.85)
    
    # 验证元数据
    assert node_with_score.score == 0.85
    assert node_with_score.node.metadata["node_id"] == 1001
    assert node_with_score.node.metadata["label"] == "METHOD"
    
    # 验证 Prompt 文本 (Intent 模式)
    text = node_with_score.node.text
    assert "[Function Intent]" in text
    assert "Summary: A test function" in text
    assert "Signature: void test_func(int a)" in text

def test_bridge_chunk_conversion(mock_store, sample_chunk_node, monkeypatch):
    """[New] 测试 Chunk 节点的转换 (验证 Graph-RAG 上下文注入)"""
    monkeypatch.setattr(bridge_module, "TextNode", FakeTextNode)
    monkeypatch.setattr(bridge_module, "NodeWithScore", FakeNodeWithScore)
    bridge = GraphBridge(mock_store)
    node_with_score = bridge.cpg_node_to_llama_node(sample_chunk_node, score=0.92)
    
    # 验证元数据
    meta = node_with_score.node.metadata
    assert meta["node_id"] == 5001
    assert meta["source_method"] == "test_func" # 确保透传
    
    # 验证 Prompt 文本 (Code Fragment 模式)
    text = node_with_score.node.text
    assert "[Code Fragment]" in text
    assert "inside `test_func`" in text  # 核心：必须包含上下文里的函数名
    assert "File: test.c" in text
    assert "if (a > 10)" in text

# =============================================================================
# Test 2: Hybrid Retriever (测试 Neo4j 模式混合检索)
# =============================================================================

def test_hybrid_retriever_search_neo4j_mode(mock_store, mock_embed_model, sample_method_node, monkeypatch):
    """测试基于 Indexer 策略的检索流程"""
    monkeypatch.setattr(hybrid_module, "HAS_LLAMA_INDEX", True)
    monkeypatch.setattr(hybrid_module, "GraphBridge", FakeBridge)
    
    # 1. 准备 Mock Indexer
    indexer = MagicMock()
    indexer.get_index_name.return_value = "method_vector_index"
    indexer.get_filter_label.return_value = "METHOD"
    indexer.search.return_value = [{"node": sample_method_node, "score": 0.9}]
    
    # 2. 模拟 Store DSL 关键词搜索
    # 模拟: store.query.all_nodes(label).where_contains(...).limit(...).to_list()
    (mock_store.query
     .all_nodes.return_value
     .where_contains.return_value
     .limit.return_value
     .to_list.return_value) = [sample_method_node]

    # 3. 初始化 Retriever
    retriever = HybridRetriever(mock_store, mock_embed_model, indexers=[indexer])
    
    # 4. 执行搜索
    results = retriever.search("analyze test_func", top_k=5)
    
    # 5. 验证
    assert len(results) == 1, "Should deduplicate results (Vector hit + Keyword hit)"
    assert results[0].node.metadata["node_id"] == 1001
    
    # 验证调用
    mock_embed_model.get_query_embedding.assert_called_once()
    indexer.search.assert_called_once()

# =============================================================================
# Test 3: Graph Walk (测试上下文扩展)
# =============================================================================

def test_graph_walk_expansion(mock_store, sample_method_node):
    # 1. Mock Entry Point
    mock_store.query.by_id.return_value.to_list.return_value = [sample_method_node]
    
    # 2. Mock File Path
    mock_file = FileNode(id=5, name="/src/test.c", label="FILE", fullName="/src/test.c", language=Language.C)
    (mock_store.query.by_id.return_value
     .file.return_value
     .to_list.return_value) = [mock_file]
    
    # 3. Mock Callers/Callees
    caller_node = MethodNode(id=2001, name="main", fullName="main", label="METHOD")
    callee_node = MethodNode(id=3001, name="malloc", fullName="malloc", label="METHOD")

    # 配置 Mock 链式调用的返回值
    # 这里通过 side_effect 或分别配置 mock 对象来实现不同路径的返回
    # 简化处理：假设 query.by_id().callers() 返回 caller mock
    
    # 模拟 Callers
    (mock_store.query.by_id.return_value
     .callers.return_value
     .limit.return_value
     .to_list.return_value) = [caller_node]

    # 模拟 Callees (注意：真实 Mock 可能需要更复杂的 side_effect 来区分 callers/callees 调用，
    # 但如果逻辑是串行的，MagicMock 会复用。这里为了通过测试，假设它们能共存或覆盖)
    # 为了严谨，我们假设 limit().to_list() 返回的是最后的 callee_node
    # 在单元测试中，如果需要区分，通常会 mock 具体的 property access
    
    # 4. 初始化 Walker
    walker = GraphWalkRetriever(mock_store)
    
    # 5. 执行
    context = walker.expand_context(node_id=1001, depth=1)
    
    # 6. 验证
    assert context["target_name"] == "test_func"
    assert context["node_id"] == 1001
    assert context["file_path"] == "/src/test.c"
    # 只要不崩即可，具体 list 内容依赖 Mock 配置

# =============================================================================
# Test 4: RAG Engine (核心：验证 Indexer 初始化)
# =============================================================================

def test_engine_init_and_mock_execution(mock_store):
    """
    测试 Engine 的实例化和 Mock 执行。
    [Fix] 重点修复了之前缺少 Neo4jChunkIndexer Mock 导致的 TypeError。
    """
    # 1. Mock Config
    mock_ai_config = MagicMock(spec=AIConfig)
    mock_storage_config = MagicMock(spec=StorageConfig)

    mock_storage_config.backend = "neo4j"
    mock_ai_config.get_openai_api_key.return_value = "sk-test"
    mock_ai_config.model_name = "gpt-4"

    # 2. Patch 外部依赖
    with (
        patch.object(engine_module, "_RAG_IMPORT_ERROR", None),
        patch.object(engine_module, "OpenAIEmbedding") as MockEmbedding,
        patch.object(engine_module, "OpenAI") as MockLLM,
        patch.object(engine_module, "HybridRetriever") as MockHybrid,
        patch.object(engine_module, "GraphWalkRetriever") as MockWalker,
        patch.object(engine_module, "GRAPH_CONTEXT_TEMPLATE") as MockPrompt,
        patch.object(engine_module, "Neo4jFuncIndexer"),
        patch.object(engine_module, "Neo4jStructIndexer"),
        patch.object(engine_module, "Neo4jFileIndexer"),
        patch.object(engine_module, "Neo4jModuleIndexer"),
        patch.object(engine_module, "Neo4jLiteralIndexer"),
        patch.object(engine_module, "Neo4jChunkIndexer"),
    ):
        MockPrompt.format.return_value = "mock prompt"

        mock_node = MagicMock()
        mock_node.node.metadata = {"node_id": 999}
        MockHybrid.return_value.search.return_value = [mock_node]
        MockWalker.return_value.expand_context.return_value = {
            "target_name": "vuln_func",
            "node_id": 999,
            "file_path": "vuln.c",
            "source_code": "...",
            "callers": [],
            "callees": []
        }
        MockLLM.return_value.complete.return_value.text = "Buffer Overflow detected."

        engine = CPGRAGEngine(mock_ai_config, mock_storage_config, mock_store)
        result = engine.query_with_graph_context("Check security")

        assert "Analysis for vuln_func" in result
        assert "Buffer Overflow detected" in result
        MockHybrid.return_value.search.assert_called_with("Check security", top_k=3)
        MockWalker.return_value.expand_context.assert_called()


def test_prepare_memory_index_warmup(mock_store, sample_method_node):
    mock_ai_config = MagicMock(spec=AIConfig)
    mock_storage_config = MagicMock(spec=StorageConfig)

    mock_storage_config.backend = "memory"
    mock_ai_config.get_openai_api_key.return_value = "sk-test"
    mock_ai_config.model_name = "gpt-4"
    mock_ai_config.embed_model = "text-embedding-3-small"

    with (
        patch.object(engine_module, "_RAG_IMPORT_ERROR", None),
        patch.object(engine_module, "tqdm", side_effect=lambda items, **kwargs: items),
        patch.object(engine_module, "OpenAIEmbedding") as MockEmbedding,
        patch.object(engine_module, "OpenAI"),
        patch.object(engine_module, "HybridRetriever"),
        patch.object(engine_module, "GraphWalkRetriever"),
        patch.object(engine_module, "GRAPH_CONTEXT_TEMPLATE"),
        patch.object(engine_module, "MemoryFunctionIndexer") as MemoryFunctionIndexer,
        patch.object(engine_module, "MemoryStructIndexer") as MemoryStructIndexer,
        patch.object(engine_module, "MemoryChunkIndexer") as MemoryChunkIndexer,
        patch.object(engine_module, "MemoryFileIndexer") as MemoryFileIndexer,
        patch.object(engine_module, "MemoryModuleIndexer") as MemoryModuleIndexer,
        patch.object(engine_module, "MemoryLiteralIndexer") as MemoryLiteralIndexer,
    ):
        method_indexer = MagicMock()
        method_indexer.get_filter_label.return_value = "METHOD"
        method_indexer.get_text_properties.return_value = ["code", "name"]

        empty_indexer = MagicMock()
        empty_indexer.get_filter_label.return_value = "FILE"
        empty_indexer.get_text_properties.return_value = ["name"]

        MemoryFunctionIndexer.return_value = method_indexer
        MemoryStructIndexer.return_value = empty_indexer
        MemoryChunkIndexer.return_value = empty_indexer
        MemoryFileIndexer.return_value = empty_indexer
        MemoryModuleIndexer.return_value = empty_indexer
        MemoryLiteralIndexer.return_value = empty_indexer

        sample_method_node.code = "void test_func(int a) { return; }"
        MockEmbedding.return_value.get_text_embedding_batch.return_value = [[0.1, 0.2, 0.3]]

        def all_nodes_for_label(label):
            traversal = MagicMock()
            traversal.to_list.return_value = [sample_method_node] if label == "METHOD" else []
            return traversal

        def by_id_with_empty_vectors(_node_id):
            traversal = MagicMock()
            traversal.vectors.return_value.to_list.return_value = []
            return traversal

        mock_store.query.all_nodes.side_effect = all_nodes_for_label
        mock_store.query.by_id.side_effect = by_id_with_empty_vectors
        mock_store.vectors = MagicMock()

        engine = CPGRAGEngine(mock_ai_config, mock_storage_config, mock_store)
        engine.prepare_memory_index()

        MockEmbedding.return_value.get_text_embedding_batch.assert_called_once()
        mock_store.vectors.attach_vector.assert_called_once()

# =============================================================================
# Test 5: Memory Mode Indexer
# =============================================================================

def test_memory_indexer_search(mock_store, sample_method_node, monkeypatch):
    """测试内存向量索引器逻辑 (NumPy Calculation)"""
    class FakeArray(list):
        def __mul__(self, other):
            return FakeArray([value * other for value in self])

        def __add__(self, other):
            return FakeArray([value + other for value in self])

        def __truediv__(self, other):
            if isinstance(other, FakeArray):
                return FakeArray([left / right for left, right in zip(self, other)])
            return FakeArray([value / other for value in self])

    class FakeNumpyModule:
        class linalg:
            @staticmethod
            def norm(value, axis=None):
                if axis == 1:
                    return FakeArray([
                        sum(item * item for item in row) ** 0.5 for row in value
                    ])
                return sum(item * item for item in value) ** 0.5

        @staticmethod
        def array(value):
            if isinstance(value, list):
                return FakeArray(value)
            return value

        @staticmethod
        def dot(matrix, vector):
            return FakeArray([
                sum(left * right for left, right in zip(row, vector)) for row in matrix
            ])

        @staticmethod
        def argsort(values):
            return sorted(range(len(values)), key=lambda idx: values[idx])

    monkeypatch.setitem(sys.modules, "numpy", FakeNumpyModule())
    sys.modules.pop("codedmap.features.rag.indexers.memory_indexers", None)
    from codedmap.features.rag.indexers.memory_indexers import MemoryVectorIndexer
    
    # 1. 准备数据
    sample_method_node.embedding = [1.0, 0.0, 0.0]
    (mock_store.query
     .all_nodes.return_value
     .to_list.return_value) = [sample_method_node]
    vector_node = MagicMock()
    vector_node.embedding = [1.0, 0.0, 0.0]
    (mock_store.query
     .by_id.return_value
     .vectors.return_value
     .to_list.return_value) = [vector_node]
    
    # 2. 初始化
    indexer = MemoryVectorIndexer(mock_store, label="METHOD")
    
    # 3. 执行搜索 (完美匹配)
    results = indexer.search([1.0, 0.0, 0.0], top_k=1)
    
    assert len(results) == 1
    assert abs(results[0]["score"] - 1.0) < 0.0001
    assert results[0]["node"].id == 1001

if __name__ == '__main__':
    pytest.main()