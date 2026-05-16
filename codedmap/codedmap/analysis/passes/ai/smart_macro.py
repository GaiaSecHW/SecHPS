# codedmap/analysis/passes/ai/smart_macro.py

import logging
from typing import Any, Dict, List, Optional, Iterable, Iterator
from codedmap.analysis.traversal.context import ContextStrategy

from codedmap.core.schema.graph.nodes import CallNode, ControlStructureNode, InsightNode
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType, NodeLabel
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy
from codedmap.core.configs.c_cpp_macros import MacroRegistry
from codedmap.analysis.passes.ai.base import AIEnhancedPass
from codedmap.infra.ai.services.MacroAnalysis import MacroAnalysisAgent
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.messages.analysis import AnalysisTask
from codedmap.infra.executor.messages.base import TaskResult
from codedmap.utils.id_generator import generate_id


logger = logging.getLogger(__name__)


class SmartMacroPass(AIEnhancedPass[CallNode, dict]):
    """
    [AI Phase] 智能宏语义识别与图修补.
    [Refactored v3.0] 适配 Lazy Storage。
    """

    def __init__(self, store: CPGStore, config=None, runner=None, agent=None):
        super().__init__(store, config, runner)
        self._agent_config_cache = self.get_agent_config()

    def get_agent_config(self) -> Dict[str, Any]:
        if self.config and hasattr(self.config, 'ai'):
            return {
                "model": self.config.ai.model_name,
                "api_base": self.config.ai.api_base,
                "api_key": self.config.get_openai_api_key(),
            }
        return {}

    # --- Step 1: Source (Lazy) ---
    def find_candidates(self) -> Iterable[CallNode]:
        """
        [Source] 查找 Suspicious 宏调用。
        Changed: 返回惰性迭代器。
        """
        # 使用流式查询
        return self.store.query.all_nodes(NodeLabel.CALL).filter(suspicious_macro=True)

    # --- Step 2: Map (Main Process) ---
    def generate_prompt_content(self, node: CallNode) -> Optional[List[Dict[str, Any]]]:
        """[Map] 准备数据字典"""
        # ContextLoader 已经重构为惰性的，这里调用安全
        ctx_data = self.context_loader.get_context_data(node, strategy=ContextStrategy.SUMMARY)
        code_context = ctx_data.get("code", "")

        if not code_context: return None

        return [{
            "macro_name": getattr(node, "name", "unknown"),
            "context": code_context
        }]

    # --- Step 3: Worker Execution (Unchanged) ---
    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> TaskResult:
        try:
            cfg = task.agent_config
            agent = MacroAnalysisAgent(
                model=cfg.get("model", "gpt-4"),
                api_base=cfg.get("api_base"),
                api_key=cfg.get("api_key")
            )
            partial_results = []
            for inputs in task.prompt_inputs:
                result = agent.analyze(**inputs)
                partial_results.append(result)

            return TaskResult(
                task_id=task.task_id, status="SUCCESS",
                payload={"node_id": task.target_node_id, "data": partial_results}
            )
        except Exception as e:
            return TaskResult(task.task_id, "FAILED", error=str(e))

    # --- Step 4: Reduce (Unchanged) ---
    def merge_results(self, results: List[dict]) -> Optional[dict]:
        if not results: return None
        return results[0]

    # --- Step 5: Patch Creation (Main Process) ---
    def create_patch(self, node: CallNode, result: dict) -> Optional[GraphPatch]:
        if not result or not result.get("is_loop"):
            return None

        patch = GraphPatch(created_by="SmartMacroPass", strategy=PatchStrategy.OVERWRITE)

        cfg_success = self._build_loop_patch(patch, node)

        if cfg_success:
            self._add_insight_to_patch(patch, node, result.get("confidence", 1.0))
            # Side Effect: Update global registry (Memory only)
            MacroRegistry.register_loop(node.name)
            logger.debug(f"[AI] Generated loop patch for {node.name}")
            return patch
        else:
            logger.warning(f"[AI] Skipped patching {node.name}: structure analysis failed.")
            return None

    # --- Core Logic: Graph Patching ---

    def _build_loop_patch(self, patch: GraphPatch, node: CallNode) -> bool:
        """
        分析图结构，构建循环补丁。
        """
        # A. 获取 AST 子节点 (Ordered)
        # 虽然 children 数量通常不大，但使用 order_by 保持一致性
        children_iter = (self.store.query.by_id(node.id)
                         .out(EdgeType.AST)
                         .order_by("order"))

        # 必须转列表以获取 first/last 索引
        children = list(children_iter)

        if not children: return False
        first_child = children[0]
        last_child = children[-1]

        # B. 寻找 Loop Exit
        # limit(1) 优化
        loop_exit_node = (self.store.query.by_id(last_child.id)
                          .out(EdgeType.CFG)
                          .limit(1)
                          .first())

        # --- Fill Patch Operations ---

        # 1. 入口: Node -> FirstChild (TRUE)
        patch.remove_edge(node.id, first_child.id, EdgeType.CFG)
        patch.add_edge(node, first_child, EdgeType.CFG, label="TRUE")

        # 2. 回边: LastChild -> Node (LOOP_BACK)
        if loop_exit_node:
            patch.remove_edge(last_child.id, loop_exit_node.id, EdgeType.CFG)

        patch.add_edge(last_child, node, EdgeType.CFG, label="LOOP_BACK")

        # 3. 出口: Node -> Exit (FALSE)
        if loop_exit_node:
            patch.remove_edge(node.id, loop_exit_node.id, EdgeType.CFG)
            patch.add_edge(node, loop_exit_node, EdgeType.CFG, label="FALSE")

            # 4. 处理 Break
            # 使用更健壮的查找逻辑
            breaks = self._find_orphan_breaks(node)
            for brk in breaks:
                patch.add_edge(brk, loop_exit_node, EdgeType.CFG)

        return True

    def _add_insight_to_patch(self, patch: GraphPatch, node: CallNode, confidence: float):
        insight_id = generate_id()
        insight = InsightNode(
            id=insight_id,
            name=f"insight_loop_{node.id}",
            label=NodeLabel.INSIGHT,
            category="CONTROL_FLOW",
            content=f"Identified as LOOP by AI (Conf: {confidence}). CFG patched.",
            source="SmartMacroPass"
        )
        patch.add_node(insight)
        patch.add_edge(node.id, insight_id, EdgeType.HAS_INSIGHT)

    def _find_orphan_breaks(self, root: CallNode) -> Iterator[ControlStructureNode]:
        """
        [Improved] 查找子树下的 Break 节点。
        使用 descendants + filter，范围更准。
        """
        return (self.store.query.by_id(root.id)
                .descendants(EdgeType.AST, max_depth=10, target_label=NodeLabel.CONTROL_STRUCTURE)
                .filter(controlStructureType=ControlStructureType.BREAK))