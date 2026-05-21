# codedmap/infra/ai/services/semantic.py

import logging
from typing import List, Optional, Union
from enum import Enum
from pydantic import BaseModel, Field

from codedmap.infra.ai.client import BaseAgent
from codedmap.infra.ai.prompts.manager import prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

logger = logging.getLogger(__name__)

class AnalysisType(str, Enum):
    FUNCTION = "FUNCTION"
    STRUCT = "STRUCT"
    FILE = "FILE"
    NAMESPACE = "NAMESPACE"

class SemanticAnalysisResult(BaseModel):
    """
    [For RAG] 语义检索元数据。
    """
    summary: str = Field(..., description="High-level purpose for humans.")
    tags: List[str] = Field(default_factory=list, description="Keywords/Topics for vector search indexing.")
    category: str = Field(..., description="Conceptual category (e.g. 'Auth', 'Utils').")

class SemanticRetrievalAgent(BaseAgent):
    """
    [Knowledge Graph Builder] 语义检索 Agent。
    
    职责：
    生成面向人类理解的摘要和向量 (Embedding)，用于 RAG 问答系统。
    """

    def __init__(self, embed_model: str = "qwen3-embedding-4b", **kwargs):
        super().__init__(**kwargs)
        self.embed_model = embed_model

    def analyze(self, 
                code: str, 
                name: str, 
                target_type: Union[AnalysisType, str], 
                context_info: str = "") -> SemanticAnalysisResult:
        """
        生成语义摘要。
        
        Args:
            code: 代码片段
            name: 函数/类名
            target_type: 分析类型 (Enum 或 String)
            context_info: 额外的上下文信息字符串
        """
        # 兼容 String 输入 (Worker 反序列化后可能是 Str)
        if isinstance(target_type, str):
            # 尝试转换回 Enum，如果不在 Enum 中则保留原值供模板 fallback
            try:
                target_type = AnalysisType(target_type)
            except ValueError:
                pass

        target_type_str = target_type.value if hasattr(target_type, 'value') else str(target_type)

        # 1. Render System Prompt
        sys_content = prompt_manager.render(
            PromptTemplate.SEMANTIC_SYSTEM,
            target_type=target_type_str
        )

        # 2. Render User Prompt
        user_content = prompt_manager.render(
            PromptTemplate.SEMANTIC_USER,
            target_type=target_type_str,
            name=name,
            context_info=context_info,
            code=code
        )

        messages = [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content}
        ]

        try:
            result = self.predict(messages, response_model=SemanticAnalysisResult)
            if result: 
                return result
        except Exception as e:
            logger.warning(f"Semantic analysis failed for {name}: {e}")

        # Fallback
        return SemanticAnalysisResult(summary="Analysis failed", tags=[], category="Unknown")
