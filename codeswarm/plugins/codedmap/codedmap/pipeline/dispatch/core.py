# codedmap\pipeline\dispatch\core.py

import logging
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, List, Tuple

from codedmap.core.schema.graph.enums import ParseStrategy
from codedmap.core.configs.dispatch import DispatchConfig
from codedmap.core.configs.ai import AIConfig
from codedmap.utils.source_manager import source_manager as _global_source_manager

from .rules import RuleEngine
from .critic import SecurityCritic

logger = logging.getLogger(__name__)

# =============================================================================
# Context Object
# =============================================================================

class DecisionContext:
    """
    决策上下文：在 Pipeline 各阶段传递的数据对象。
    负责按需加载数据，避免过早计算。
    """
    def __init__(self, file_path: Path, source_mgr):
        self.file_path = file_path
        self.path_str = str(file_path)
        self.source_mgr = source_mgr
        
        # Lazy Loading 属性
        self._head_content: Optional[bytes] = None
        self._features: Optional[Tuple[List[str], List[str]]] = None

    @property
    def head_content(self) -> bytes:
        """获取文件头 (Cached)"""
        if self._head_content is None:
            # 读取 4KB
            self._head_content = self.source_mgr.get_file_head(self.path_str, size=4096)
        return self._head_content

    def extract_lightweight_features(self) -> Tuple[List[str], List[str]]:
        """
        正则提取特征 (Includes, Signatures)。
        """
        if self._features:
            return self._features

        content_str = self.head_content.decode('utf-8', errors='ignore')
        
        # 1. Includes
        includes = re.findall(r'^\s*#\s*include\s+[<"]([^>"]+)[>"]', content_str, re.MULTILINE)
        
        # 2. Signatures (Heuristic)
        keywords_block = r'\b(?:if|while|for|switch|return|else|case)\b'
        signatures = re.findall(
            r'^\s*(?:[a-zA-Z0-9_]+\s+(?:\*\s*)?)+([a-zA-Z0-9_]+)\s*\(', 
            content_str, 
            re.MULTILINE
        )
        filtered_sigs = [s for s in signatures if not re.match(keywords_block, s)]

        self._features = (includes, filtered_sigs)
        return self._features


# =============================================================================
# Pipeline Stages
# =============================================================================

class DecisionStage(ABC):
    @abstractmethod
    def decide(self, ctx: DecisionContext) -> Optional[ParseStrategy]:
        pass


class RuleBasedStage(DecisionStage):
    """
    Stage 1: L1/L2 规则引擎 (正则, 关键词)
    """
    def __init__(self, config: DispatchConfig):
        # 传入 DispatchConfig 对象而非 dict
        self.engine = RuleEngine(config)

    def decide(self, ctx: DecisionContext) -> Optional[ParseStrategy]:
        return self.engine.scan(ctx.file_path, ctx.head_content)


class AICriticStage(DecisionStage):
    """
    Stage 2: L3 LLM 评审
    """
    def __init__(self, ai_config: AIConfig):
        self.critic = None
        if ai_config.enable_llm and ai_config.enable_smart_dispatcher:
            try:
                self.critic = SecurityCritic(
                    model=ai_config.model_name,
                    api_key=ai_config.get_openai_api_key(),
                    api_base=ai_config.api_base,
                    temperature=0.1
                )
            except Exception as e:
                logger.error(f"Failed to initialize SecurityCritic: {e}")

    def decide(self, ctx: DecisionContext) -> Optional[ParseStrategy]:
        if not self.critic:
            return None

        # 提取特征
        includes, sigs = ctx.extract_lightweight_features()
        if not includes and not sigs:
            return None

        # LLM 决策
        return self.critic.judge(str(ctx.file_path), includes, sigs)


# =============================================================================
# Smart Dispatcher (Facade)
# =============================================================================

class SmartParseDispatcher:
    """
    智能调度器 (Facade)。
    """
    def __init__(self, dispatch_config: DispatchConfig, ai_config: AIConfig):
        self.pipeline: List[DecisionStage] = []

        # 1. 注册规则引擎阶段
        self.pipeline.append(RuleBasedStage(dispatch_config))

        # 2. 注册 AI 评审阶段
        self.pipeline.append(AICriticStage(ai_config))

    def decide(self, file_path: Path, source_mgr=None) -> ParseStrategy:
        """核心决策 API"""
        mgr = source_mgr or _global_source_manager
        ctx = DecisionContext(file_path, mgr)

        for stage in self.pipeline:
            try:
                decision = stage.decide(ctx)
                if decision:
                    return decision
            except Exception as e:
                logger.warning(f"Stage {type(stage).__name__} failed for {file_path}: {e}")
                continue

        # Default Fallback: FULL
        return ParseStrategy.FULL