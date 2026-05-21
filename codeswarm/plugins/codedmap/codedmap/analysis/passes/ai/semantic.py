# codedmap/analysis/passes/ai/semantic.py

import logging
import hashlib
import json
from typing import Optional, Iterable, List, Tuple, Union, Dict, Any, Iterator

# Schema Imports
from codedmap.core.schema.graph.nodes import (
    LiteralNode, MethodNode, TypeDeclNode, FileNode, NamespaceBlockNode, EmbeddingChunkNode, VectorNode, CPGNode
)
from codedmap.core.schema.graph.enums import EdgeDirection, NodeLabel, EdgeType
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy

# Infra Imports
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.ai.services.semantic import SemanticRetrievalAgent, AnalysisType, SemanticAnalysisResult

# Analysis Utils
from codedmap.analysis.utils.semantic_splitter import SemanticCodeSplitter
from codedmap.infra.executor.runner import BaseRunner
from codedmap.infra.executor.messages.analysis import AnalysisTask, AIAnalysisResult
from codedmap.utils.id_generator import generate_id
from .base import AIEnhancedPass

# Traversal
from codedmap.analysis.traversal.context import ContextStrategy

logger = logging.getLogger(__name__)

# Tokenizer Helper
try:
    import tiktoken

    _enc = tiktoken.get_encoding("cl100k_base")


    def ai_token_counter(t):
        return len(_enc.encode(t))
except:
    def ai_token_counter(t):
        return len(t) // 4

# 定义支持的节点联合类型
SemanticNode = Union[MethodNode, TypeDeclNode, FileNode, NamespaceBlockNode, LiteralNode]

# Result Type Definition: (Index, Vector, Metadata)
# Index: -1 表示 Intent/Summary, >=0 表示 Chunk Index
ResultType = Tuple[int, List[float], Optional[SemanticAnalysisResult]]


class SemanticEmbeddingPass(AIEnhancedPass[SemanticNode, List[ResultType]]):
    """
    [Refactored v4.1 - Industrial Grade] 语义向量化 Pass.
    适配 AIEnhancedPass V3 架构，支持流式处理、断点续传与批量 Patch。
    """

    def __init__(self, store: CPGStore, runner: BaseRunner, config=None, targets: List[str] = None):
        # [Fix] 参数顺序修正：(store, runner, config)
        super().__init__(store, runner, config)

        self.agent_instance = None
        self._init_agent()

        # Splitter (用于大函数切分)
        self.splitter = SemanticCodeSplitter(
            store=self.store,
            cost_fn=ai_token_counter,
            max_cost=6000
        )

        self.target_labels = targets if targets else [
            NodeLabel.METHOD, NodeLabel.TYPE_DECL, NodeLabel.FILE
        ]

    def _init_agent(self):
        """初始化主进程 Agent (用于 Patch 阶段的 Refinement)"""
        cfg = self.get_agent_config()
        if cfg:
            try:
                self.agent_instance = SemanticRetrievalAgent(
                    model=cfg.get("model_name"),
                    embed_model=cfg.get("embed_model"),
                    api_key=cfg.get("api_key"),
                    api_base=cfg.get("api_base")
                )
            except Exception as e:
                logger.error(f"Failed to initialize Main Process Agent: {e}")

    def get_agent(self):
        return self.agent_instance

    def get_agent_config(self) -> Dict[str, Any]:
        """为 Worker 提供配置"""
        if self.config and hasattr(self.config, 'ai') and getattr(self.config.ai, 'enable_llm', True):
            return {
                "model_name": getattr(self.config.ai, 'model_name', 'gpt-4'),
                "embed_model": getattr(self.config.ai, 'embed_model', 'text-embedding-3-small'),
                "api_base": getattr(self.config.ai, 'api_base', None),
                "api_key": self.config.get_openai_api_key(),
            }
        return {}

    # =========================================================================
    # Step 1: Serialization Strategy (Custom for Tuple Logic)
    # =========================================================================

    def serialize_result(self, result: List[ResultType]) -> str:
        """
        [Override] 自定义序列化逻辑。
        因为 ResultType 是 (int, list, PydanticModel)，默认 json.dumps 搞不定 Pydantic。
        """
        serializable_list = []
        for idx, vec, meta in result:
            meta_dict = meta.model_dump() if meta else None
            serializable_list.append((idx, vec, meta_dict))
        return json.dumps(serializable_list, ensure_ascii=False)

    def deserialize_result(self, data: str) -> List[ResultType]:
        """[Override] 反序列化，重建 Pydantic 对象"""
        raw_list = json.loads(data)
        restored = []
        for item in raw_list:
            idx, vec, meta_dict = item
            meta_obj = SemanticAnalysisResult(**meta_dict) if meta_dict else None
            restored.append((idx, vec, meta_obj))
        return restored

    # =========================================================================
    # Step 2: Source & Filter
    # =========================================================================

    def find_candidates(self) -> Iterable[SemanticNode]:
        """[Lazy] 扫描代码实体，完全基于迭代器"""
        for label in self.target_labels:
            node_iterator = self.store.query.all_nodes(label)

            if label == NodeLabel.LITERAL:
                # 针对 Literal 的特殊过滤，避免传递太多垃圾数据
                for node in node_iterator:
                    code = getattr(node, 'code', '')
                    if 4 < len(code) < 1000 and ('"' in code or "'" in code):
                        yield node
            else:
                yield from node_iterator

    def heuristic_filter(self, node: SemanticNode) -> bool:
        """
        [Filter] 静态规则过滤。
        主要检查：
        1. 是否是存根/模板代码。
        2. 代码是否发生变化 (Code Hash check)。
        """
        if isinstance(node, MethodNode):
            if getattr(node, 'is_stub', False) or node.name.startswith("<"): return False
        elif isinstance(node, TypeDeclNode):
            if not node.name or "<" in node.name: return False
        elif isinstance(node, FileNode):
            name = getattr(node, 'name', '')
            if not name or name == '<unknown>': return False
            valid_exts = ('.c', '.cc', '.cpp', '.h', '.hpp', '.py', '.java', '.go', '.rs', '.js', '.ts')
            if not name.endswith(valid_exts): return False

        # --- Content Hash Logic ---
        content_for_hash = ""
        if isinstance(node, FileNode):
            # 仅使用方法签名计算 Hash，避免读取整个大文件内容
            methods = self.context_loader.ast.get_methods_in_file(node)
            if methods:
                content_for_hash = "".join([getattr(m, 'signature', '') or getattr(m, 'name', '') for m in methods])
            else:
                # Fallback: 读取文件前 N 行
                content_for_hash = self.context_loader.ast.get_context_code(node, max_lines=500, window_strategy=False)
        else:
            content_for_hash = self.context_loader.ast.get_context_code(node, max_lines=0, window_strategy=False)

        if not content_for_hash or len(content_for_hash) < 5:
            return False

        current_hash = hashlib.md5(content_for_hash.encode('utf-8')).hexdigest()

        # Check existing property (增量分析关键)
        stored_hash = getattr(node, "code_hash", None)
        # 如果已有 hash 且匹配，且已有 embedding，则跳过
        # 注意：这里我们假设如果有 code_hash，说明之前跑过分析
        if stored_hash == current_hash and self.store.query.get_neighbors(node.id, EdgeType.HAS_VECTOR,
                                                                          direction=EdgeDirection.OUT):
            return False

        # Store for patch creation later
        if not hasattr(node, "metadata") or node.metadata is None:
            node.metadata = {}
        node.metadata["_new_code_hash"] = current_hash

        return True

    # =========================================================================
    # Step 3: Prompt Generation
    # =========================================================================

    def generate_prompt_content(self, node: SemanticNode) -> Optional[List[Dict[str, Any]]]:
        """生成任务输入数据"""
        inputs = []
        name = getattr(node, "name", "unknown")

        # === A. Method / TypeDecl ===
        if isinstance(node, (MethodNode, TypeDeclNode)):
            full_code = self.context_loader.ast.get_context_code(node, max_lines=0, window_strategy=False)
            if not full_code: return None

            # 使用 ai_token_counter
            is_large = ai_token_counter(full_code) > 2000

            # 1. Intent Task (Summary)
            if isinstance(node, MethodNode):
                ctx_data = self.context_loader.get_context_data(node, strategy=ContextStrategy.SUMMARY)
                context_parts = []
                if ctx_data.get("arch_context"): context_parts.append(f"Architecture:\n{ctx_data['arch_context']}")
                if ctx_data.get("callees"): context_parts.append(f"Calls: {', '.join(ctx_data['callees'])}")

                inputs.append({
                    "task_type": "INTENT",
                    "index": -1,
                    "code": ctx_data["code"],
                    "name": name,
                    "target_type": AnalysisType.FUNCTION.value,
                    "context_info": "\n".join(context_parts),
                    "is_large": is_large
                })
            elif isinstance(node, TypeDeclNode):
                inputs.append({
                    "task_type": "INTENT",
                    "index": -1,
                    "code": full_code[:3000],  # 截断保护
                    "name": name,
                    "target_type": AnalysisType.STRUCT.value,
                    "context_info": "",
                    "is_large": is_large
                })

            # 2. Chunk Tasks (Implementation Details)
            chunks = self._generate_chunks(node, full_code)
            for i, chunk in enumerate(chunks):
                inputs.append({
                    "task_type": "CHUNK",
                    "index": i,
                    "code": chunk,
                    "name": f"{name}_part_{i}",
                    "target_type": AnalysisType.FUNCTION.value,
                    "context_info": "",
                    "is_large": is_large
                })

        # === B. File ===
        elif isinstance(node, FileNode):
            summary_task = self._generate_file_summary_input(node)
            if summary_task:
                inputs.append(summary_task)

        # === C. Literal ===
        elif isinstance(node, LiteralNode):
            raw_text = getattr(node, 'code', '')
            if raw_text:
                clean_text = raw_text.strip().strip('"').strip("'")
                if clean_text:
                    inputs.append({
                        "task_type": "DIRECT_EMBEDDING",
                        "index": -1,
                        "code": clean_text,
                        "name": "literal",
                        "target_type": "LITERAL",
                        "context_info": ""
                    })

        return inputs

    def _generate_chunks(self, node: SemanticNode, full_code: str) -> List[str]:
        """适配 Iterator Splitter，返回 List[str]"""
        if ai_token_counter(full_code) > 2000:
            try:
                # 显式转换迭代器为列表
                return list(self.splitter.split(node))
            except Exception as e:
                logger.warning(f"Splitter failed for {node.id}: {e}")
        return [full_code]

    def _generate_file_summary_input(self, file_node: FileNode) -> Optional[Dict[str, Any]]:
        # ... (保持原有的逻辑，这部分没有用到不兼容 API) ...
        try:
            methods = self.context_loader.ast.get_methods_in_file(file_node)
            if not methods: return None

            summaries = []
            max_methods = 50
            # 这里简化逻辑，不再做二次查询，假设 methods 对象已经足够用
            for m in methods[:max_methods]:
                m_sum = getattr(m, 'summary', getattr(m, 'name', 'unknown'))
                summaries.append(f"- {getattr(m, 'name', '?')}: {m_sum}")

            summary_block = "\n".join(summaries)
            file_name = getattr(file_node, 'name', 'unknown')
            skeleton = self.context_loader.get_project_skeleton()

            return {
                "task_type": "INTENT",
                "index": -1,
                "code": f"(Meta-analysis of {len(summaries)} functions)",
                "name": file_name,
                "target_type": AnalysisType.FILE.value,
                "context_info": f"Project Structure:\n{skeleton}\n\nFunction Summaries:\n{summary_block}",
                "is_large": False
            }
        except Exception:
            return None

    # =========================================================================
    # Step 4: Execution (Worker) - [Updated for AIAnalysisResult]
    # =========================================================================

    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> AIAnalysisResult:
        """
        Worker 静态方法。
        Args:
            task: AnalysisTask，包含 agent_config 和 prompt_inputs
        Returns:
            AIAnalysisResult: 强类型的 AI 结果
        """
        try:
            # 1. 重建 Agent
            cfg = task.agent_config
            agent = SemanticRetrievalAgent(
                model=cfg.get("model_name"),
                embed_model=cfg.get("embed_model"),
                api_key=cfg.get("api_key"),
                api_base=cfg.get("api_base")
            )

            # 2. 执行分析
            partial_results: List[ResultType] = []
            total_tokens = 0  # 简单统计

            for input_data in task.prompt_inputs:
                task_type = input_data.get("task_type", "CHUNK")
                idx = input_data.get("index", 0)
                code = input_data.get("code", "")

                agent_kwargs = {
                    "code": code,
                    "name": input_data.get("name", "unknown"),
                    "target_type": input_data.get("target_type", AnalysisType.FUNCTION.value),
                    "context_info": input_data.get("context_info", "")
                }

                if task_type == "INTENT":
                    analysis = agent.analyze(**agent_kwargs)
                    # 组合 summary 和 keywords 进行 embedding
                    text_to_embed = f"{analysis.summary} Keywords: {', '.join(analysis.tags)}"
                    vector = agent.get_embedding(text_to_embed)
                    partial_results.append((-1, vector, analysis))

                elif task_type == "CHUNK":
                    vector = agent.get_embedding(code)
                    chunk_analysis = None
                    if input_data.get("is_large"):
                        # 对于大 Chunk，额外做一次摘要
                        try:
                            agent_kwargs["context_info"] = "Focus: Summarize implementation details."
                            chunk_analysis = agent.analyze(**agent_kwargs)
                        except:
                            pass
                    partial_results.append((idx, vector, chunk_analysis))

                elif task_type == "DIRECT_EMBEDDING":
                    vector = agent.get_embedding(code)
                    partial_results.append((-1, vector, None))

            # 3. 返回强类型结果
            return AIAnalysisResult(
                task_id=task.task_id,
                status="SUCCESS",
                model_response=partial_results,  # 赋值给 model_response
                target_node_id=task.target_node_id,
                prompt_hash=task.payload.get("hash") if task.payload else None,
                finish_reason="STOP"
            )

        except Exception as e:
            return AIAnalysisResult(
                task_id=task.task_id,
                status="FAILED",
                error=str(e),
                target_node_id=task.target_node_id
            )

    # =========================================================================
    # Step 5: Reduce & Patch Creation
    # =========================================================================

    def _refine_results(self, results: List[ResultType]) -> List[ResultType]:
        """
        [Replaces merge_results]
        在主进程中对结果进行 refine。
        主要是为了合并 Intent Summary 和 Chunk Summary。
        """
        valid_results = [r for r in results if r is not None]
        if not valid_results: return []

        intent_res = next((r for r in valid_results if r[0] == -1), None)
        chunk_results = sorted([r for r in valid_results if r[0] != -1], key=lambda x: x[0])

        if not intent_res: return chunk_results

        # 解包: (index, vector, SemanticAnalysisResult)
        intent_idx, intent_vec, intent_meta = intent_res

        # 如果有 Chunk 的详细分析结果，合并到 Intent Summary 中
        if intent_meta and chunk_results:
            has_chunk_details = any(meta is not None for _, _, meta in chunk_results)
            if has_chunk_details:
                summary_parts = [f"High Level Intent: {intent_meta.summary}", "Implementation Details:"]
                all_tags = set(intent_meta.tags)

                for c_idx, _, c_meta in chunk_results:
                    if c_meta:
                        summary_parts.append(f"- Part {c_idx}: {c_meta.summary}")
                        all_tags.update(c_meta.tags)

                combined_summary = "\n".join(summary_parts)
                intent_meta.summary = combined_summary
                intent_meta.tags = list(all_tags)

                # Re-embedding using Main Process Agent
                # 这是低频操作，在主线程做是可以接受的
                try:
                    agent = self.get_agent()
                    if agent:
                        new_vec = agent.get_embedding(f"{combined_summary} Keywords: {', '.join(intent_meta.tags)}")
                        if new_vec:
                            intent_res = (-1, new_vec, intent_meta)
                except Exception as e:
                    logger.warning(f"Failed to re-embed combined summary: {e}")

        # 返回合并后的列表
        final_list = [intent_res] + chunk_results
        return final_list

    def create_patch(self, node: SemanticNode, results: List[ResultType]) -> Optional[GraphPatch]:
        """
        [Patching] 生成图变更补丁。
        """
        if not results: return None

        # 1. Refine results (Merge Intent & Chunks)
        # 这一步取代了原先 base class 的 reduce hook
        refined_results = self._refine_results(results)
        if not refined_results: return None

        patch = GraphPatch(created_by="SemanticEmbeddingPass", strategy=PatchStrategy.OVERWRITE)
        has_changes = False

        intent_data = None
        valid_vectors = {}

        for idx, vec, meta in refined_results:
            if idx == -1:
                intent_data = (vec, meta)
            else:
                valid_vectors[idx] = vec

        # --- A. Update Host Node (Summary & Tags) ---
        updates = {}
        # 从 metadata 中取出之前计算的 hash
        if hasattr(node, "metadata") and node.metadata and "_new_code_hash" in node.metadata:
            updates["code_hash"] = node.metadata["_new_code_hash"]

        if intent_data:
            vec, meta = intent_data
            if meta:
                updates["summary"] = meta.summary
                # 只有 FileNode 才有 topics 属性吗？这取决于 Schema 定义
                # 假设都支持，或者仅 FileNode 支持
                if isinstance(node, FileNode):
                    updates["topics"] = meta.tags

            if vec:
                # 删除旧的 Vector 节点
                patch.remove_outgoing_neighbors(node.id, EdgeType.HAS_VECTOR)

                vec_id = generate_id()
                # VectorNode 的 name 最好唯一
                vec_node = VectorNode(
                    id=vec_id,
                    name=f"vec_host_{node.name}_{node.id}",
                    embedding=vec,
                    label=NodeLabel.VECTOR
                )
                patch.add_node(vec_node)
                patch.add_edge(node.id, vec_id, EdgeType.HAS_VECTOR)
                has_changes = True

        if updates:
            patch.update_node(node.id, **updates)
            has_changes = True

        # --- B. Update Chunks (If method split) ---
        if valid_vectors and isinstance(node, MethodNode):
            # 清理旧 Chunk
            patch.remove_outgoing_neighbors(node.id, EdgeType.HAS_CHUNK)
            has_changes = True

            # 重新切分以获取 Content (这里为了获取对应的文本，需要再次读取/切分)
            full_code = self.context_loader.ast.get_context_code(node, max_lines=0, window_strategy=False)
            if full_code:
                # 确保和 generate_prompt 时切分逻辑一致
                text_chunks = self._generate_chunks(node, full_code)

                for i, text in enumerate(text_chunks):
                    if i in valid_vectors:
                        new_chunk_id = generate_id()
                        chunk_node = EmbeddingChunkNode(
                            id=new_chunk_id,
                            name=f"{node.name}_chunk_{i}",
                            content=text,
                            chunk_index=i,
                            source=node.name,
                            label=NodeLabel.EMBEDDING_CHUNK
                        )
                        patch.add_node(chunk_node)
                        patch.add_edge(node.id, new_chunk_id, EdgeType.HAS_CHUNK)

                        # Attach Vector to Chunk
                        vec_id = generate_id()
                        vec_node = VectorNode(
                            id=vec_id,
                            name=f"vec_chunk_{node.name}_{new_chunk_id}",
                            embedding=valid_vectors[i],
                            label=NodeLabel.VECTOR
                        )
                        patch.add_node(vec_node)
                        patch.add_edge(new_chunk_id, vec_id, EdgeType.HAS_VECTOR)
                        has_changes = True

        return patch if has_changes else None