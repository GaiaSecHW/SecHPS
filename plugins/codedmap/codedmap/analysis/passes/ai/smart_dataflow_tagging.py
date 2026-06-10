# codedmap/analysis/passes/ai/smart_dataflow_tagging.py

import logging
import json
from typing import Any, Dict, Optional, Iterable, List, Union, Iterator

# Schema & Context
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.context import ContextStrategy

# Agent Services
from codedmap.infra.ai.services.taint_tagger import SecurityTaggingAgent, CodeTaggingResult, TagDecision

# Pipeline Messages
from codedmap.infra.executor.runner import BaseRunner
from codedmap.infra.executor.messages.analysis import AnalysisTask, AIAnalysisResult

# Base & Rules
from .base import AIEnhancedPass
from codedmap.core.schema.security import StaticSecurityRules
from codedmap.core.schema.tags.layer import TagLayer

logger = logging.getLogger(__name__)


class SecurityTaggingPass(AIEnhancedPass[MethodNode, List[CodeTaggingResult]]):
    """
    [Refactored v3.1 - Industrial Grade] 安全语义打标增强 Pass.

    Architecture V3 适配:
    1. 继承自 AIEnhancedPass (ThreadPool + DiskMap Cache).
    2. 使用 AIAnalysisResult 进行强类型通信.
    3. 支持静态规则 "Fast Path" 旁路写入.
    """

    def __init__(self, store: CPGStore, runner: BaseRunner, config=None, agent: SecurityTaggingAgent = None):
        # [Fix] 参数顺序修正: (store, runner, config)
        super().__init__(store, runner, config)
        self.agent_instance = agent

        if not self.agent_instance:
            self._init_agent()

    def _init_agent(self):
        """初始化主进程 Agent (用于调试或非 Worker 环境)"""
        # 优先使用 config 中的配置
        if self.config and hasattr(self.config, 'ai') and getattr(self.config.ai, 'enable_llm', True):
            api_key = self.config.get_openai_api_key()
            if api_key:
                try:
                    self.agent_instance = SecurityTaggingAgent(
                        model=getattr(self.config.ai, 'model_name', 'gpt-4'),
                        api_key=api_key,
                        api_base=getattr(self.config.ai, 'api_base', None)
                    )
                    logger.debug(f"SecurityTaggingAgent initialized.")
                except Exception as e:
                    logger.error(f"Failed to initialize SecurityTaggingAgent: {e}")

    @property
    def _tag_navigator(self):
        """Lazily initialized TagNavigator for validated tag writes."""
        if not hasattr(self, '_tag_navigator_instance') or self._tag_navigator_instance is None:
            from codedmap.analysis.tagging.navigator import TagNavigator
            self._tag_navigator_instance = TagNavigator(self.store)
        return self._tag_navigator_instance

    def get_agent(self):
        return self.agent_instance

    # =========================================================================
    # Serialization (Handling Pydantic Lists)
    # =========================================================================

    def serialize_result(self, result: List[CodeTaggingResult]) -> str:
        """[Override] 序列化 Pydantic 模型列表"""
        # CodeTaggingResult 是 Pydantic 模型
        return json.dumps([r.model_dump() for r in result], ensure_ascii=False)

    def deserialize_result(self, data: str) -> List[CodeTaggingResult]:
        """[Override] 反序列化"""
        raw_list = json.loads(data)
        return [CodeTaggingResult(**item) for item in raw_list]

    # =========================================================================
    # Step 1: Source (Predicate Pushdown)
    # =========================================================================

    def find_candidates(self) -> Iterator[MethodNode]:
        """
        [Step 1] Source: 扫描候选 Method。
        利用 Query 对象的惰性特性，将过滤条件下推到存储层。
        """
        return self.store.query.methods().filter(is_external=False)

    # =========================================================================
    # Step 2: Filter (Hybrid Static/Dynamic)
    # =========================================================================

    def heuristic_filter(self, node: MethodNode) -> bool:
        """[Step 2] Filter: 漏斗过滤 + 静态规则 Fast Path"""
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher

        # 1. Double Check External
        if getattr(node, 'is_external', False):
            return False

        # 2. 过滤测试/Mock代码
        filename = getattr(node, 'file_name', '') or getattr(node, 'fileName', '') or ''
        if 'test' in filename.lower() or 'mock' in filename.lower():
            return False

        # 3. 增量检查 (避免重复打标)
        tags = getattr(node, 'tags', []) or []
        has_security_tag = any(
            SecurityTagMatcher.is_security_tag(t)
            for t in tags
        )
        if has_security_tag:
            return False

        # 4. 静态规则 (Zero Cost Pre-check & Fast Path)
        # 这里的逻辑略有副作用：如果命中静态规则，直接写入并跳过 LLM。
        # 这种 "Fast Path" 在工业级分析中是为了节省 Token 的常用手段。
        name = getattr(node, 'name', "").lower()

        if StaticSecurityRules.is_obvious_sink(name):
            category = StaticSecurityRules.get_sink_category(name) or name.upper()
            tag_name = f"{TagLayer.ONTOLOGY.value}:SINK:{category}"
            # [Side Effect Warning] 直接写库。
            # 在单机 SQLite/Neo4j 场景下，只要主线程是串行的，这里是安全的。
            try:
                self._tag_navigator.add_tag(node, tag_name)
            except Exception as e:
                logger.warning(f"Static tag add failed for {node.id}: {e}")
            return False  # Skip LLM

        if StaticSecurityRules.is_obvious_safe(name):
            return False  # Skip LLM

        return True

    # =========================================================================
    # Step 3: Prompt Generation
    # =========================================================================

    def generate_prompt_content(self, node: MethodNode) -> Optional[List[Dict[str, Any]]]:
        """
        [Step 3] Map: 生成上下文数据。
        """
        # 使用 Precise Slice 获取更精准的数据流上下文
        context_data = self.context_loader.get_context_data(node, strategy=ContextStrategy.PRECISE_SLICE)

        # 校验数据有效性 (Too short code is useless)
        code = context_data.get("code", "")
        if not code or len(code.strip()) < 10:
            return None

        # 返回列表 (虽然只有一个 Context，但为了接口一致性)
        return [context_data]

    # =========================================================================
    # Step 4: Execution (Worker) - [Updated for AIAnalysisResult]
    # =========================================================================

    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> AIAnalysisResult:
        """
        Worker 进程入口。
        返回强类型的 AIAnalysisResult。
        """
        try:
            cfg = task.agent_config
            # 重建 Agent
            agent = SecurityTaggingAgent(
                model=cfg.get("model_name", "gpt-4"),
                api_base=cfg.get("api_base"),
                api_key=cfg.get("api_key")
            )

            partial_results: List[CodeTaggingResult] = []

            for input_data in task.prompt_inputs:
                # SecurityTaggingAgent.analyze 接收 code, name 等参数
                res = agent.analyze(**input_data)
                if res and res.tags:
                    partial_results.append(res)

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
    # Step 5: Patch Creation
    # =========================================================================

    def create_patch(self, node: MethodNode, results: List[CodeTaggingResult]) -> Optional[GraphPatch]:
        """
        [Patching] 生成 Tags 更新补丁。
        无需显式的 merge_results，在此处直接遍历合并即可。
        """
        if not results: return None

        # Flatten logic (equivalent to old merge_results)
        # 将多个 Result 中的 tags 合并，并简单拼接 reasoning
        valid_tags = []

        # 1. Collect Valid Tags
        min_confidence = 0.8

        for res in results:
            if not res.tags: continue
            for tag_decision in res.tags:
                if tag_decision.role == "NONE": continue
                if tag_decision.confidence < min_confidence: continue
                valid_tags.append(tag_decision)

        if not valid_tags:
            return None

        patch = GraphPatch(
            created_by="SecurityTaggingPass",
            strategy=PatchStrategy.OVERWRITE
        )
        has_changes = False

        # 2. Apply Tags
        # 使用 set 去重 tag string
        applied_tag_strings = set()

        for tag_decision in valid_tags:
            tag_name = self._format_tag_name(tag_decision)

            if tag_name not in applied_tag_strings:
                patch.property_list_append(
                    node_id=node.id,
                    key="tags",
                    value=tag_name
                )
                applied_tag_strings.add(tag_name)
                has_changes = True

        return patch if has_changes else None

    def _format_tag_name(self, decision: TagDecision) -> str:
        """
        Format: SEMANTIC:{ROLE}:{CATEGORY} (e.g., SEMANTIC:SINK:SQL_INJECTION)
        
        This method is called only for LLM-inferred tags (not Fast Path).
        Fast Path tags are written directly in heuristic_filter() as ONTOLOGY format.
        """
        category_slug = decision.category.upper().replace(" ", "_").replace("-", "_")
        return f"{TagLayer.SEMANTIC.value}:{decision.role}:{category_slug}"