# codedmap/infra/ai/services/MacroAnalysis.py

from typing import Any, Dict
from pydantic import BaseModel, Field

from codedmap.infra.ai.client import BaseAgent
from codedmap.infra.ai.prompts.manager import prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

class MacroResult(BaseModel):
    is_loop: bool = Field(...)
    confidence: float = Field(...)

class MacroAnalysisAgent(BaseAgent):
    """
    [Micro-Agent] 专门用于分析宏语义的 Agent。
    输出结构化 JSON。
    """
    
    def analyze(self, macro_name: str, context: str) -> Dict[str, Any]:
        """
        执行宏分析。
        
        Args:
            macro_name: 宏名称
            context: 上下文代码片段
        """
        # 1. 渲染 System Prompt
        sys_content = prompt_manager.render(PromptTemplate.MACRO_ANALYSIS_SYSTEM)
        
        # 2. 渲染 User Prompt
        user_content = prompt_manager.render(
            PromptTemplate.MACRO_ANALYSIS_USER,
            macro_name=macro_name,
            context=context
        )

        try:
            return self.predict([
                {"role": "system", "content": sys_content},
                {"role": "user", "content": user_content}
            ], response_model=MacroResult).model_dump()
        except Exception:
            return {"is_loop": False, "confidence": 0.0}