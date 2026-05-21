# codedmap/features/rag/bridge.py

import logging
from typing import Optional, Dict, Any

# LlamaIndex Core Schemas
try:
    from llama_index.core.schema import TextNode, NodeWithScore
except ImportError:
    TextNode = None
    NodeWithScore = Any

# CPG Core Schemas
from codedmap.core.schema.graph.nodes import CPGNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

class GraphBridge:
    """
    [Core] CPG Node <-> LlamaIndex Node 转换器。
    
    职责：
    1. 将图数据库中的异构节点 (Method, Chunk, Struct) 转换为 LLM 可读的统一文本节点。
    2. 格式化 Prompt 上下文 (例如：给代码片段加上文件路径头)。
    3. 透传元数据 (Metadata) 供后续 RAG 流程使用。
    """
    
    def __init__(self, store: CPGStore):
        if TextNode is None:
            raise ImportError(
                "RAG features require optional dependencies. Install the 'rag' extra "
                "(for example: `pip install .[rag]`)."
            )
        self.store = store

    def cpg_node_to_llama_node(self, cpg_node: CPGNode, score: float = 1.0) -> NodeWithScore:
        """
        将 CPG 节点转换为 LlamaIndex 的 NodeWithScore。
        支持 Graph-RAG 的分层语义结构 (Intent vs Implementation)。
        """
        
        # 1. 基础元数据提取
        # 这些信息会被 LlamaIndex 索引，有的 Retriever 可能会用到
        metadata: Dict[str, Any] = {
            "node_id": cpg_node.id,
            "label": cpg_node.label,
            "name": getattr(cpg_node, "name", "unknown"),
            # 优先取 fileName 属性，没有则尝试 full_name
            "file_path": getattr(cpg_node, "fileName", getattr(cpg_node, "full_name", "unknown")),
        }

        # 2. 合并由 Indexer 注入的额外元数据
        # (例如 Neo4jChunkIndexer 回溯查询时注入的 source_method, source_file)
        if hasattr(cpg_node, "metadata") and isinstance(cpg_node.metadata, dict):
            metadata.update(cpg_node.metadata)

        # 3. 生成 LLM 可读的文本内容 (Prompt Engineering)
        # 根据节点类型，决定展示什么内容给 LLM
        text_content = self._format_node_text(cpg_node, metadata)

        # 4. 构造 LlamaIndex 节点
        # excluded_llm_metadata_keys: 指定哪些 metadata 不需要塞进 Prompt 文本里 (节省 Token)
        # 这里我们把 id 和 label 排除，因为它们对 LLM 语义理解帮助不大，主要用于程序逻辑
        llama_node = TextNode(
            text=text_content, 
            metadata=metadata,
            excluded_llm_metadata_keys=["node_id", "label", "chunk_index"] 
        )
        
        return NodeWithScore(node=llama_node, score=score)

    def _format_node_text(self, node: CPGNode, metadata: Dict[str, Any]) -> str:
        """
        [Internal] 根据节点类型格式化 Prompt 文本。
        """
        label = node.label
        text_parts = []

        # --- Case A: 代码切片 (EmbeddingChunkNode) ---
        # 场景: 细粒度代码搜索
        if label == NodeLabel.EMBEDDING_CHUNK:
            # 从 metadata 中获取上下文 (由 Indexer 回溯填充)
            source_method = metadata.get("source_method", "Unknown Function")
            source_file = metadata.get("source_file", "Unknown File")
            
            # 标题
            text_parts.append(f"[Code Fragment] inside `{source_method}`")
            text_parts.append(f"File: {source_file}")
            
            # 代码内容
            content = getattr(node, "content", "")
            text_parts.append(f"```python\n{content}\n```")

        # --- Case B: 函数意图 (MethodNode) ---
        # 场景: 宏观功能搜索
        elif label == NodeLabel.METHOD:
            name = getattr(node, "name", "unknown")
            signature = getattr(node, "signature", "")
            summary = getattr(node, "summary", "")
            
            text_parts.append(f"[Function Intent] `{name}`")
            
            # 如果有 AI 摘要，优先展示摘要
            if summary:
                text_parts.append(f"Summary: {summary}")
            
            # 补充签名信息作为技术细节
            if signature:
                text_parts.append(f"Signature: {signature}")
            
            # 如果没有摘要，尝试展示部分代码 (兜底)
            if not summary:
                code = getattr(node, "code", "")
                if code:
                    # 截断一下防止过长
                    snippet = code[:300] + "..." if len(code) > 300 else code
                    text_parts.append(f"Preview:\n{snippet}")

        # --- Case C: 数据结构 (TypeDeclNode) ---
        # 场景: 实体/模型搜索
        elif label == NodeLabel.TYPE_DECL:
            name = getattr(node, "name", "unknown")
            text_parts.append(f"[Data Structure] class/struct `{name}`")
            
            if hasattr(node, "summary") and node.summary:
                text_parts.append(f"Description: {node.summary}")
            
            # 如果有成员变量信息 (需要 AST 支持，这里假设 code 包含定义)
            code = getattr(node, "code", "")
            if code:
                 text_parts.append(f"Definition:\n{code[:500]}")

        # --- Case D: 模块/目录 (DirectoryNode) ---
        # 场景: 架构探索 / 高层定位
        elif label == NodeLabel.DIRECTORY:
            path = getattr(node, "path", "unknown")
            text_parts.append(f"[Module/Directory] `{path}`")
            
            summary = getattr(node, "summary", "")
            readme = getattr(node, "readme", "")
            
            # 优先展示结构化的 Summary
            if summary:
                # 假设 summary 已经是 markdown 格式，我们只取前几行核心描述
                # 或者直接展示，因为 Module 数量少，Token 消耗可控
                text_parts.append(f"Summary:\n{summary}")
            
            # 如果没有 Summary 但有 Readme
            elif readme:
                text_parts.append(f"Readme Extract:\n{readme[:500]}...")

        # --- Case E: 默认兜底 ---
        else:
            name = getattr(node, "name", "unknown")
            code = getattr(node, "code", getattr(node, "content", ""))
            text_parts.append(f"[{label}] {name}")
            if code:
                text_parts.append(f"Content: {code[:300]}")

                

        return "\n".join(text_parts)

    def retrieve_cpg_node(self, node_id: int) -> Optional[CPGNode]:
        """
        辅助方法: 根据 ID 从 Store 回溯完整的 CPG 节点对象。
        用于在 RAG 后处理阶段获取更多上下文 (如 AST 遍历)。
        """
        try:
            # 使用 Query DSL 查找
            nodes = self.store.query.by_id(node_id).to_list()
            return nodes[0] if nodes else None
        except Exception as e:
            logger.warning(f"Failed to retrieve CPG node {node_id}: {e}")
            return None