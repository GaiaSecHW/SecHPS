# codedmap/infra/ai/services/summarizer.py

from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field

from codedmap.infra.ai.client import BaseAgent
from codedmap.infra.ai.prompts.manager import prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

class FlowType(str, Enum):
    PASSTHROUGH = "PASSTHROUGH" # 参数 -> 返回值
    SIDE_EFFECT = "SIDE_EFFECT" # 参数 -> 另一个参数 (如 memcpy: src->dest)
    SINK = "SINK"               # 参数进入黑洞 (可能是危险点)
    SOURCE = "SOURCE"           # 返回值产生新数据

class TaintRule(BaseModel):
    """单条数据流规则"""
    flow_type: FlowType
    input_index: Optional[int] = None # 1-based, 0=this
    output_index: Optional[int] = None # 1-based, -1=return
    description: str = Field(..., description="Brief explanation of the flow.")

class LibrarySummary(BaseModel):
    """外部库函数行为摘要"""
    function_name: str
    summary: str = Field(..., description="Human readable summary.")
    rules: List[TaintRule] = Field(default_factory=list, description="Machine readable taint rules.")

class LibrarySummaryAgent(BaseAgent):
    """
    [External Behavior Modeler] 第三方库函数摘要 Agent。
    
    职责：
    为没有源码的 External Method 生成数据流传播规则 (Taint Rules)，用于 PDG 补全。
    """
    
    # [Refactor] SYSTEM_PROMPT removed. Now managed by PromptManager.

    def summarize(self, signature: str, documentation: str = "") -> LibrarySummary:
        """
        生成库函数摘要。

        Args:
            signature: 函数签名
            documentation: 相关文档或上下文（此处通常传入由 Pass 生成的使用案例上下文）
        """
        # 1. 渲染 System Prompt
        sys_content = prompt_manager.render(PromptTemplate.LIB_SUMMARY_SYSTEM)
        
        # 2. 渲染 User Prompt (传入变量)
        user_content = prompt_manager.render(
            PromptTemplate.LIB_SUMMARY_USER,
            signature=signature,
            documentation=documentation
        )
        
        messages = [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content}
        ]
        
        try:
            result = self.predict(messages, response_model=LibrarySummary)
            if result: 
                # 确保 function_name 被正确填充（有时 LLM 会忽略）
                if result.function_name == "unknown" or not result.function_name:
                    # 尝试从签名中提取简单的名称作为 fallback
                    result.function_name = signature.split('(')[0].strip().split(' ')[-1]
                return result
        except Exception:
            pass
            
        return LibrarySummary(function_name="unknown", summary="Analysis Failed", rules=[])