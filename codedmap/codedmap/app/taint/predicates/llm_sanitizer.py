# codedmap/app/taint/predicates/llm_sanitizer.py

from __future__ import annotations

from typing import Dict, Optional, TYPE_CHECKING
import logging

from codedmap.core.schema.graph import AnyNode
from codedmap.core.schema.graph.nodes import MethodNode, CallNode
from codedmap.infra.storage.store import CPGStore

if TYPE_CHECKING:
    from codedmap.infra.ai.services.taint_tagger import SanitizerAgent

logger = logging.getLogger(__name__)

class SmartSanitizerPredicate:
    """
    [适配器] 将 LLM SanitizerAgent 适配为 Engine 可用的 Callable。
    """

    def __init__(self, store: CPGStore, agent: SanitizerAgent, min_confidence: float = 0.7):
        self.store = store
        self.agent = agent
        self.min_confidence = min_confidence

        # 缓存分析结果：MethodFullName -> bool
        self._cache: Dict[str, bool] = {}

    def __call__(self, node: AnyNode) -> bool:
        """
        判断节点是否是 Sanitizer。
        """
        # 1. 确定目标函数名
        target_full_name = None
        if isinstance(node, CallNode):
            target_full_name = node.method_full_name
        elif isinstance(node, MethodNode):
            target_full_name = node.full_name
        else:
            return False

        if not target_full_name or target_full_name == "ANY":
            return False

        # 2. 检查缓存
        if target_full_name in self._cache:
            return self._cache[target_full_name]

        # 3. 查找源代码
        # 使用 Store 查找 Method 定义
        target_code = None
        methods = self.store.methods.find_by_full_name(target_full_name)
        if methods:
            target_code = methods[0].get_code()
        else:
            # 如果找不到源码（如库函数），仅凭名字分析
            target_code = f"Function Signature: {target_full_name} (Source code unavailable in CPG)"

        # 4. 调用 Agent
        logger.debug(f"[LLM] Analyzing potential sanitizer: {target_full_name}...")
        decision = self.agent.analyze(target_code)

        is_sanitizer = decision.is_sanitizer and decision.confidence >= self.min_confidence

        if is_sanitizer:
            logger.info(f"LLM Identified Sanitizer: {target_full_name}")

        # 5. 更新缓存
        self._cache[target_full_name] = is_sanitizer
        return is_sanitizer
