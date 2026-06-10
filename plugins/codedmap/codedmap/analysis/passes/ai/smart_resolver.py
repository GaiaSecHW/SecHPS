# codedmap/analysis/passes/ai/smart_resolver.py

import logging
from typing import List, Optional, Iterable, Dict, Any, Union
from collections import defaultdict

# Schema Imports
from codedmap.core.schema.graph.nodes import MethodNode, CallNode, CPGNode
from codedmap.core.schema.graph.enums import EdgeType, DispatchType, NodeLabel
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy
from codedmap.infra.ai.services.semantic import SemanticRetrievalAgent

# Infra Imports
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.ai.services.resolver import DynamicResolverAgent, PotentialTarget, ResolverDecision
from codedmap.infra.executor.messages.analysis import AnalysisTask
from codedmap.infra.executor.messages.base import TaskResult

# Base Class
from .base import AIEnhancedPass

logger = logging.getLogger(__name__)


class SmartGraphResolver(AIEnhancedPass[CallNode, ResolverDecision]):
    """
    [Refactored v3.0 - Fully Lazy] 智能图修补 Pass (Resolver).
    适配惰性 Storage，优化内存占用。
    """

    def __init__(self, store: CPGStore, config=None, runner=None, agent: DynamicResolverAgent = None,
                 confidence_threshold: float = 0.7):
        super().__init__(store, config, runner)
        self.agent_instance = agent
        self.confidence_threshold = confidence_threshold
        self.embed_agent = self._init_embedding_agent()

        if not self.agent_instance:
            self._init_agent()

    def _init_agent(self):
        if self.config and hasattr(self.config, 'ai') and self.config.ai.enable_llm:
            api_key = self.config.get_openai_api_key()
            if api_key:
                try:
                    self.agent_instance = DynamicResolverAgent(
                        model=self.config.ai.model_name,
                        api_key=api_key,
                        api_base=self.config.ai.api_base
                    )
                    logger.info(f"DynamicResolverAgent initialized with model {self.config.ai.model_name}")
                except Exception as e:
                    logger.error(f"Failed to initialize DynamicResolverAgent: {e}")

    def _init_embedding_agent(self):
        if self.config and hasattr(self.config, 'ai') and self.config.ai.enable_llm:
            api_key = self.config.get_openai_api_key()
            if api_key:
                try:
                    return SemanticRetrievalAgent(
                        model=self.config.ai.model_name,
                        embed_model=self.config.ai.embed_model,
                        api_key=api_key,
                        api_base=self.config.ai.api_base
                    )
                except Exception:
                    pass
        return None

    def get_agent(self):
        return self.agent_instance

    # --- 步骤 1: 获取候选 (Lazy Source) ---
    def find_candidates(self) -> Iterable[CallNode]:
        """
        [Lazy] 查找动态分发的 Call。
        不再使用 .to_list()，直接返回迭代器。
        """
        # 注意: 这里的 filter 是流式的 (Python-side filtering in SqliteTraversal)
        calls_iter = (self.store.query.all_nodes(NodeLabel.CALL)
                      .filter(dispatchType=DispatchType.DYNAMIC_DISPATCH))
        return calls_iter

    # --- 步骤 2: 漏斗过滤 (Keep as is) ---
    def heuristic_filter(self, node: CallNode) -> bool:
        target_name = getattr(node, 'name', "")
        if not target_name: return False

        if not self.embed_agent:
            count = self.store.methods.find_by_name(target_name, exact_match=True)
            # find_by_name 返回 List，如果为空则 False
            if not count: return False

        return True

    # --- 步骤 3: 准备数据 (Map - Structured) ---
    def generate_prompt_content(self, node: CallNode) -> Optional[List[Dict[str, Any]]]:
        call_code = node.get_code() or getattr(node, 'name', "unknown_call")

        receiver_trace = self._trace_receiver_definition(node)
        static_hint = self._get_static_type_hint(node)

        context_code = self.context_loader.ast.get_context_code(node, max_lines=40, window_strategy=True)
        if not context_code:
            context_code = "No source code available."

        input_data = {
            "call_code": call_code,
            "context_code": context_code,
            "static_hint": static_hint,
            "receiver_trace": receiver_trace
        }

        return [input_data]

    # --- 逻辑增强 Helper Methods (Optimized) ---

    def _trace_receiver_definition(self, call_node: CallNode) -> Optional[str]:
        """
        利用 DDG 向上回溯，找到 Receiver 变量是在哪里定义的。
        [Optimized] 使用惰性接口 first() 和 islice。
        """
        try:
            # 1. 找到 Receiver 节点 (limit 1)
            # 优化：Receiver 只有 1 个，使用 first()
            receiver_node = (self.store.query.by_id(call_node.id)
                             .out(EdgeType.RECEIVER)
                             .first())

            if not receiver_node or not isinstance(receiver_node, CPGNode):
                return None

            # 2. 利用 DataFlowNavigator 查找定义 (已重构为返回 Iterator)
            definitions_iter = self.context_loader.dataflow.get_definitions(receiver_node)

            # 3. 提取定义点的代码 (仅取前 2 个)
            trace_logs = []
            import itertools
            for def_node in itertools.islice(definitions_iter, 2):
                def_line = getattr(def_node, 'line_number', '?')
                def_code = self.context_loader.ast.get_context_code(def_node, max_lines=5, window_strategy=False)

                if def_code:
                    enclosing_type = self.context_loader.ast.get_enclosing_type(def_node)
                    type_info = f" (in Class: {enclosing_type.name})" if enclosing_type else ""

                    trace_logs.append(
                        f"- Variable '{getattr(receiver_node, 'code', '?')}' defined at Line {def_line}{type_info}:\n{def_code}")

            if not trace_logs:
                return None

            return "\n".join(trace_logs)

        except Exception as e:
            logger.warning(f"Receiver trace failed for call {call_node.id}: {e}")
            return None

    def _get_static_type_hint(self, call_node: CallNode) -> str:
        """
        [Optimized] 使用 first() 获取接收者。
        """
        hints = []
        receiver = self.store.query.by_id(call_node.id).out(EdgeType.RECEIVER).first()

        if receiver:
            type_full_name = getattr(receiver, 'type_full_name', None) or getattr(receiver, 'typeFullName', None)
            if type_full_name and type_full_name != "ANY":
                hints.append(f"Static Type Hint: Receiver is likely of type '{type_full_name}'")

        return "\n".join(hints)

    # --- Step 4: Worker Execution (Unchanged) ---
    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> TaskResult:
        try:
            cfg = task.agent_config
            agent = DynamicResolverAgent(
                model=cfg.get("model_name", "gpt-4"),
                api_base=cfg.get("api_base"),
                api_key=cfg.get("api_key")
            )
            results = []
            for inputs in task.prompt_inputs:
                decision = agent.resolve(**inputs)
                if decision and decision.targets:
                    results.append(decision)

            if not results: return TaskResult(task.task_id, "SKIPPED")

            return TaskResult(
                task_id=task.task_id,
                status="SUCCESS",
                payload={"node_id": task.target_node_id, "data": results}
            )
        except Exception as e:
            return TaskResult(task.task_id, "FAILED", error=str(e))

    # --- Step 5: Merge Results (Unchanged) ---
    def merge_results(self, results: List[ResolverDecision]) -> Optional[ResolverDecision]:
        if not results: return None
        all_targets = []
        for res in results: all_targets.extend(res.targets)
        if not all_targets: return None
        all_targets.sort(key=lambda x: x.confidence, reverse=True)
        return ResolverDecision(targets=all_targets)

    # --- Step 6: Create Patch (Unchanged Logic) ---
    def create_patch(self, node: CallNode, result: ResolverDecision) -> Optional[GraphPatch]:
        if not result or not result.targets: return None

        patch = GraphPatch(created_by="SmartGraphResolver", strategy=PatchStrategy.OVERWRITE)
        has_changes = False

        context_preview = f"Call: {node.name}. " + (
                    self.context_loader.ast.get_context_code(node, max_lines=5, window_strategy=False) or "")

        for target in result.targets:
            if target.confidence < self.confidence_threshold: continue

            # [Hybrid Search]
            candidates = self._match_candidates(target.method_name, context_preview)

            if candidates:
                best_match: MethodNode = candidates[0]

                patch.add_edge(node.id, best_match.id, EdgeType.CALL)
                patch.update_node(
                    node.id,
                    methodFullName=best_match.full_name,
                    ai_reasoning=target.reasoning
                )
                has_changes = True
                break

        return patch if has_changes else None

    # --- Helpers ---

    def _match_candidates(self, target_name: str, context_text: str = "") -> List[MethodNode]:
        """Hybrid Search"""
        short_name = target_name.split(".")[-1].split("->")[-1]

        # 1. Exact Match (Fast)
        # find_by_name 返回 List[MethodNode]，直接使用
        exact_matches = self.store.methods.find_by_name(short_name, exact_match=True)
        if exact_matches:
            return exact_matches

        # 2. Vector Search (Semantic)
        if self.embed_agent and context_text:
            try:
                query_vec = self.embed_agent.get_embedding(
                    f"function definition for {target_name}. Context: {context_text}")

                if query_vec:
                    # search_similar_nodes 返回 List[Node]，符合预期
                    results = self.store.search_similar_nodes(
                        label="METHOD",
                        query_vector=query_vec,
                        top_k=5
                    )
                    return results
            except Exception as e:
                logger.warning(f"Vector search failed for {target_name}: {e}")

        return []