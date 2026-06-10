# codedmap/analysis/passes/ai/smart_type_inference.py

import logging
from typing import Optional, Iterable, List, Dict, Any, Set, Iterator
from itertools import chain

from codedmap.core.schema.graph.nodes import LocalNode, CallNode, IdentifierNode
from codedmap.core.schema.graph import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy

from codedmap.infra.storage.store import CPGStore
from codedmap.infra.ai.services.type_inferencer import TypeInferenceAgent, TypeInferenceResult
from codedmap.infra.executor.messages.analysis import AnalysisTask
from codedmap.infra.executor.messages.base import TaskResult

from .base import AIEnhancedPass

logger = logging.getLogger(__name__)

# 定义我们要处理的节点类型
TypeableNode = CPGNode


class SmartTypeInferencePass(AIEnhancedPass[TypeableNode, TypeInferenceResult]):
    """
    [Industrial Grade] 智能类型推导 Pass.
    [Refactored] 适配 Lazy Storage。
    """

    def __init__(self, store: CPGStore, config=None, runner=None):
        super().__init__(store, config, runner)

    # --- Step 1: Source (Broad Candidates - Lazy) ---
    def find_candidates(self) -> Iterable[TypeableNode]:
        """
        [Lazy] 查找所有潜在的类型缺失节点。
        Strategy: 使用 chain 组合多个惰性迭代器。
        """
        # 1. Parameters (e.g. void *data in callbacks)
        # 过滤逻辑：包含 "ANY" 或 ("void" 且 "*")

        # 优化：在 Python 侧做逻辑或过滤比多次 DB 查询要灵活，
        # 但考虑到数据量，我们还是利用 DB 侧过滤能力 (filter is pushed down if possible)

        # Iterator 1: ANY Params
        p1 = self.store.query.all_nodes("METHOD_PARAMETER_IN").filter(typeFullName__contains="ANY")
        # Iterator 2: void* Params
        p2 = self.store.query.all_nodes("METHOD_PARAMETER_IN").filter(typeFullName__contains="void").filter(
            typeFullName__contains="*")

        # Iterator 3: ANY Locals
        l1 = self.store.query.all_nodes("LOCAL").filter(typeFullName__contains="ANY")
        # Iterator 4: void* Locals
        l2 = self.store.query.all_nodes("LOCAL").filter(typeFullName__contains="void").filter(
            typeFullName__contains="*")

        # 使用 chain 串联所有迭代器
        return chain(p1, p2, l1, l2)

    # --- Step 2: Filter (The "Need-to-Know" Strategy) ---
    def heuristic_filter(self, node: TypeableNode) -> bool:
        """
        [Critical Optimization]
        只有当该变量 "阻塞 "了调用图的构建时，才进行推导。
        """
        # 1. 基础类型检查 (Double Check)
        curr_type = getattr(node, 'typeFullName', 'ANY')
        # 简单的字符串包含检查
        type_str = str(curr_type)
        is_unknown = curr_type in ["ANY", "<unknown>", "auto", ""] or ("void" in type_str and "*" in type_str)
        if not is_unknown:
            return False

        # 2. 检查是否涉及 "Unresolved Calls"
        try:
            # 找到引用该变量的所有 Identifier (Lazy Iterator)
            refs_iter = self.store.query.by_id(node.id).in_(EdgeType.REF)

            for ref in refs_iter:
                # 检查该 Identifier 是否作为 RECEIVER 参与了调用
                # limit(1) 优化：只要找到一个阻塞的调用，就认为该变量值得推导
                call_nodes_iter = self.store.query.by_id(ref.id).in_(EdgeType.RECEIVER)

                for call in call_nodes_iter:
                    # 检查这个 Call 是否已经解析成功
                    # 使用 count() > 0 检查边是否存在
                    # 注意：count() 在 interface 中已有默认实现
                    has_call_edge = self.store.query.by_id(call.id).out(EdgeType.CALL).count() > 0

                    if not has_call_edge:
                        # 发现 Blocked Call
                        return True

        except Exception:
            pass

        return False

    # --- Step 3: Map (Usage Slicing) ---
    def generate_prompt_content(self, node: TypeableNode) -> Optional[List[Dict[str, Any]]]:
        """
        生成 "变量生命周期切片"。
        """
        # 1. 收集使用行
        usage_lines = self._collect_usage_lines(node)
        if not usage_lines:
            return None

        # 2. 排序并去重
        sorted_lines = sorted(list(usage_lines))
        usage_slice = "\n".join(sorted_lines)

        # 3. 返回结构化任务输入
        return [{
            "variable_name": getattr(node, 'name', 'unknown'),
            "usage_slice": usage_slice
        }]

    def _collect_usage_lines(self, node: TypeableNode) -> Set[str]:
        """
        [Helper] 收集该变量的所有定义、赋值和使用处的代码行。
        """
        lines = set()

        try:
            # 1. 定义处 (Declaration)
            code = getattr(node, 'code', None)
            if code:
                lines.add(f"// Declaration\n{code}")

            # 2. 引用处 (References - Lazy Fetch)
            refs_iter = self.store.query.by_id(node.id).in_(EdgeType.REF)

            for ref in refs_iter:
                # 获取 Identifier 所在的 Statement
                stmt = self.context_loader.ast.get_enclosing_statement(ref)

                # 安全访问 code 属性
                stmt_code = getattr(stmt, 'code', None)
                if stmt_code:
                    lines.add(stmt_code.strip())

        except Exception as e:
            logger.warning(f"Error collecting usage lines for {node.id}: {e}")

        return lines

    # --- Step 4: Worker (Infer - Unchanged) ---
    @staticmethod
    def execute_worker_task(task: AnalysisTask) -> TaskResult:
        try:
            cfg = task.agent_config
            agent = TypeInferenceAgent(
                model=cfg.get("model_name", "gpt-4"),
                api_base=cfg.get("api_base"),
                api_key=cfg.get("api_key")
            )

            partial_results = []
            for inputs in task.prompt_inputs:
                res = agent.infer(**inputs)
                if res and res.confidence >= 0.7:
                    if "ANY" not in res.inferred_type and "unknown" not in res.inferred_type:
                        partial_results.append(res)

            return TaskResult(
                task_id=task.task_id,
                status="SUCCESS",
                payload={"node_id": task.target_node_id, "data": partial_results}
            )
        except Exception as e:
            return TaskResult(task.task_id, "FAILED", error=str(e))

    # --- Step 5: Reduce (Patch - Optimized) ---
    def create_patch(self, node: TypeableNode, result: TypeInferenceResult) -> Optional[GraphPatch]:
        if not result: return None

        patch = GraphPatch(created_by="SmartTypeInferencePass", strategy=PatchStrategy.OVERWRITE)

        new_type = result.inferred_type.strip()

        # 1. 更新节点本身
        patch.update_node(node.id, typeFullName=new_type)

        # 2. 级联更新 Identifier (Batch Update)
        # 这里使用 iterate 获取所有引用该变量的地方，统一更新
        try:
            refs_iter = self.store.query.by_id(node.id).in_(EdgeType.REF)
            for ref in refs_iter:
                patch.update_node(ref.id, typeFullName=new_type)
        except Exception:
            pass

        return patch

    # Agent getter implementation required by abstract base class
    def get_agent(self) -> Any:
        return None  # TypeInferenceAgent is stateless/created in worker