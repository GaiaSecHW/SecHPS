# codedmap/analysis/passes/ai/smart_summary.py

import logging
from typing import Optional, Iterable, List, Dict, Any, Tuple, Set, Iterator

# Schema Imports
from codedmap.core.schema.graph.nodes import InsightNode, MethodNode, CallNode, Expression, VectorNode
from codedmap.core.schema.graph import AnyNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, EdgeDirection
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy

# Infra & Storage
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.ai.services.summarizer import LibrarySummaryAgent, LibrarySummary, TaintRule, FlowType
from codedmap.infra.executor.messages.analysis import AnalysisTask
from codedmap.infra.executor.messages.base import TaskResult
from codedmap.utils.id_generator import generate_id

# Base & Rules
from .base import AIEnhancedPass
from codedmap.core.schema.security import StaticSecurityRules


logger = logging.getLogger(__name__)


class SmartSummaryPass(AIEnhancedPass[MethodNode, LibrarySummary]):
    """
    [Refactored v3.1 - Fully Lazy] 智能第三方库摘要 Pass.
    适配 Lazy Storage，并解决了大规模 Caller 更新的内存问题。
    """

    def __init__(self, store: CPGStore, config=None, runner=None, agent: LibrarySummaryAgent = None):
        super().__init__(store, config, runner)
        self.agent_instance = agent
        if not self.agent_instance:
            self._init_agent()

    def _init_agent(self):
        if self.config and hasattr(self.config, 'ai') and self.config.ai.enable_llm:
            api_key = self.config.get_openai_api_key()
            if api_key:
                try:
                    self.agent_instance = LibrarySummaryAgent(
                        model=self.config.ai.model_name,
                        api_key=api_key,
                        api_base=self.config.ai.api_base
                    )
                    logger.info(f"LibrarySummaryAgent initialized with model {self.config.ai.model_name}")
                except Exception as e:
                    logger.error(f"Failed to initialize LibrarySummaryAgent: {e}")

    # --- Template Implementation ---

    def get_agent(self):
        return self.agent_instance

    def find_candidates(self) -> Iterable[MethodNode]:
        """[Step 1] Source: 查找所有外部方法 (Lazy)"""
        # 使用 DSL 的 limit，底层是流式的
        return self.store.query.methods().limit(10000)

    def heuristic_filter(self, node: MethodNode) -> bool:
        """[Step 2] Filter"""
        if not getattr(node, 'is_external', False): return False

        name = getattr(node, 'name', "").lower()
        if StaticSecurityRules.is_obvious_safe(name): return False

        # In-Use Check
        # count() 默认是流式计数的，比较安全
        callers_count = self.store.query.by_id(node.id).in_(EdgeType.CALL).count()
        if callers_count == 0: return False

        return True

    # --- Step 3: Map ---
    def generate_prompt_content(self, node: MethodNode) -> Optional[List[Dict[str, Any]]]:
        """[Step 3] 组装数据"""
        sig = getattr(node, "signature", node.name)

        # 获取 Callers (Lazy Iterator)
        # 我们只需要前 3 个，使用 islice 或手动 break
        callers_iter = self.context_loader.call.get_callers(node)

        usage_cases = []
        count = 0
        for call in callers_iter:
            count += 1
            if count > 3: break

            case_str = self._build_usage_case(call, index=count)
            if case_str:
                usage_cases.append(case_str)

        if not usage_cases: return None

        full_usage_context = "\n".join(usage_cases)
        full_usage_context += "\n\n(Analyze the argument history above to determine SINK/SOURCE roles.)"

        return [{
            "signature": sig,
            "documentation": full_usage_context
        }]

    def _build_usage_case(self, call_node: CallNode, index: int) -> str:
        try:
            code_ctx = self.context_loader.ast.get_context_code(call_node, max_lines=4,
                                                                window_strategy=True) or "<code>"
            dataflow_insights = self._analyze_argument_dataflow(call_node)

            return f"""
--- USAGE CASE {index} ---
[CODE SNIPPET]
{code_ctx}

[DATA FLOW INSIGHTS]
{dataflow_insights}
----------------------
"""
        except Exception as e:
            logger.warning(f"Failed to build usage case for call {call_node.id}: {e}")
            return ""

    def _analyze_argument_dataflow(self, call_node: CallNode) -> str:
        """对 Call 的参数进行切片分析"""
        insights = []
        # Lazy fetch arguments
        args_iter = self.store.query.by_id(call_node.id).out(EdgeType.ARGUMENT)

        # Sort in memory (Arguments count is small per call)
        sorted_args = sorted(args_iter, key=lambda x: getattr(x, 'argument_index', 99))

        for arg in sorted_args:
            if not isinstance(arg, Expression): continue

            idx = getattr(arg, 'argument_index', '?')
            slice_text = self.context_loader.dataflow.get_data_slice(arg, max_depth=3)

            if slice_text:
                compact_slice = slice_text.replace('\n', ' -> ')
                if len(compact_slice) > 200: compact_slice = compact_slice[:200] + "..."
                insights.append(f"Arg {idx}: {compact_slice}")
            else:
                code = getattr(arg, 'code', None)
                if code and (code.startswith('"') or code.isdigit()):
                    insights.append(f"Arg {idx}: Literal Value '{code}'")

        if not insights:
            return "No specific data flow history found (likely local variables)."
        return "\n".join(insights)

    # --- Step 4: Worker Execution ---
    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> TaskResult:
        # Worker 逻辑保持不变，因为只处理纯数据
        try:
            cfg = task.agent_config
            agent = LibrarySummaryAgent(
                model=cfg.get("model_name", "gpt-4"),
                api_base=cfg.get("api_base"),
                api_key=cfg.get("api_key")
            )
            partial_results = []
            for inputs in task.prompt_inputs:
                res = agent.summarize(**inputs)
                if res and res.summary != "Analysis Failed":
                    partial_results.append(res)

            if not partial_results: return TaskResult(task.task_id, "SKIPPED")

            return TaskResult(
                task_id=task.task_id,
                status="SUCCESS",
                payload={"node_id": task.target_node_id, "data": partial_results}
            )
        except Exception as e:
            return TaskResult(task.task_id, "FAILED", error=str(e))

    def merge_results(self, results: List[LibrarySummary]) -> Optional[LibrarySummary]:
        if not results: return None
        return results[0]

    # --- Step 6: Create Patch (Hybrid Approach) ---
    def create_patch(self, node: MethodNode, result: LibrarySummary) -> Optional[GraphPatch]:
        """
        [Hybrid Strategy]
        1. 返回 Patch 用于更新 Method 自身 (Insight, Vector)。
        2. [Side Effect] 直接流式写入 Taint Rules 到 Callers，避免 Patch 对象爆炸。
        """
        if not result: return None

        patch = GraphPatch(created_by="SmartSummaryPass", strategy=PatchStrategy.OVERWRITE)
        has_changes = False

        # --- A. Method Self Updates (Insight & Vector) ---
        try:
            old_insights = self.store.insights.get_attached_insights(node.id, category="VULNERABILITY")
            if old_insights:
                for old_i in old_insights:
                    if old_i.id is not None:
                        patch.remove_outgoing_neighbors(old_i.id, EdgeType.HAS_VECTOR)
                        patch.remove_node(old_i.id)
                        has_changes = True
        except Exception:
            pass

        embedding_vec = None
        if hasattr(self.agent_instance, "get_embedding"):
            try:
                text_to_embed = f"Security Analysis for {node.name}: {result.summary}"
                embedding_vec = self.agent_instance.get_embedding(text_to_embed)
            except Exception:
                pass

        new_insight_id = generate_id()
        insight_node = InsightNode(
            id=new_insight_id, name=f"insight_security_{node.id}_SmartSummaryPass",
            label=NodeLabel.INSIGHT, category="VULNERABILITY", content=result.summary, source="SmartSummaryPass"
        )
        patch.add_node(insight_node)
        patch.add_edge(node.id, new_insight_id, EdgeType.HAS_INSIGHT)
        has_changes = True

        if embedding_vec:
            vec_id = generate_id()
            vec_node = VectorNode(
                id=vec_id, name=f"vec_insight_{node.name}_{new_insight_id}",
                embedding=embedding_vec, label=NodeLabel.VECTOR
            )
            patch.add_node(vec_node)
            patch.add_edge(new_insight_id, vec_id, EdgeType.HAS_VECTOR)

        # --- B. Caller Updates (Direct Stream Write) ---
        if result.rules:
            self._apply_taint_rules_streaming(node, result.rules)

        return patch if has_changes else None

    def _apply_taint_rules_streaming(self, node: MethodNode, rules: List[TaintRule]):
        """
        [Stream Writer] 直接流式处理 Callers 并写入，绕过 Patch 对象的大小限制。
        """
        try:
            # 1. 创建临时的 Builder 或 Patch 批次
            # 使用 iter_batch 批量处理 Callers
            callers_batch_iter = self.store.query.by_id(node.id).in_(EdgeType.CALL).iter_batch(batch_size=2000)

            for batch in callers_batch_iter:
                temp_patch = GraphPatch(created_by="SmartSummaryPass_Rules", strategy=PatchStrategy.APPEND)
                has_batch_changes = False

                for call_site in batch:
                    if isinstance(call_site, CallNode):
                        args_map = self._get_call_arguments_map(call_site)
                        if self._apply_rules_to_patch(temp_patch, call_site, rules, args_map):
                            has_batch_changes = True

                # 立即提交批次
                if has_batch_changes:
                    self.store.apply_patch(temp_patch)

        except Exception as e:
            logger.warning(f"Failed to apply rules to call sites for {node.name}: {e}")

    # --- Rule Application Helpers (Unchanged Logic) ---

    def _get_call_arguments_map(self, call: CallNode) -> Dict[int, AnyNode]:
        # [Lazy] Iterator -> Map
        mapping = {}
        # arguments per call is small, safe to iterate
        args_iter = self.store.query.by_id(call.id).out(EdgeType.ARGUMENT)
        for arg in args_iter:
            if hasattr(arg, 'argument_index') and arg.argument_index is not None:
                mapping[arg.argument_index] = arg

        receivers = self.store.query.by_id(call.id).out(EdgeType.RECEIVER).limit(1)
        # first() or loop
        for r in receivers:
            mapping[0] = r
            break

        return mapping

    def _apply_rules_to_patch(self,
                              patch: GraphPatch,
                              call_site: CallNode,
                              rules: List[TaintRule],
                              args_map: Dict[int, AnyNode]) -> bool:
        changed = False
        for rule in rules:
            if rule.flow_type in [FlowType.PASSTHROUGH, FlowType.SIDE_EFFECT]:
                src_node = self._resolve_target_node(call_site, args_map, rule.input_index)
                dst_node = self._resolve_target_node(call_site, args_map, rule.output_index)

                if src_node and dst_node and src_node.id != dst_node.id:
                    patch.add_edge(
                        src=src_node.id, dst=dst_node.id,
                        edge_type=EdgeType.DDG, variable=f"ImplicitFlow: {rule.description}"
                    )
                    changed = True

            elif rule.flow_type == FlowType.SOURCE:
                target = self._resolve_target_node(call_site, args_map, rule.output_index)
                if target:
                    patch.property_list_append(target.id, "tags", "TAINT_SOURCE")
                    changed = True

            elif rule.flow_type == FlowType.SINK:
                target = self._resolve_target_node(call_site, args_map, rule.input_index)
                if target:
                    patch.property_list_append(target.id, "tags", "TAINT_SINK")
                    changed = True
        return changed

    def _resolve_target_node(self, call_site: CallNode, args_map: Dict[int, AnyNode], index: Optional[int]) -> Optional[
        AnyNode]:
        if index is None: return None
        if index == -1: return call_site
        return args_map.get(index)