# codedmap/infra/ai/services/resolver.py

from typing import List
from pydantic import BaseModel, Field

from codedmap.infra.ai.client import BaseAgent
# [New] 引入 Prompt 管理
from codedmap.infra.ai.prompts.manager import prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

class PotentialTarget(BaseModel):
    method_name: str = Field(..., description="The concrete method name (e.g. ClassName::Method).")
    confidence: float = Field(..., description="Confidence score (0.0-1.0).")
    reasoning: str = Field(..., description="Brief technical reasoning based on types or flow.")

class ResolverDecision(BaseModel):
    targets: List[PotentialTarget] = Field(default_factory=list)

class DynamicResolverAgent(BaseAgent):
    """
    [Topology Repairman] 动态调用解析 Agent。
    
    职责：
    根据上下文代码，推断动态调用 (Dynamic Dispatch) 的具体目标。
    """
    
    def resolve(self, 
                call_code: str, 
                context_code: str,
                static_hint: str = "",
                receiver_trace: str = "") -> ResolverDecision:
        """
        解析动态调用目标。
        
        Args:
            call_code: 调用点代码 (e.g. "handler->process()")
            context_code: 周围的物理代码上下文
            static_hint: [Optional] 静态类型推断提示
            receiver_trace: [Optional] 接收者定义的追踪路径
        """
        
        # 1. Render System Prompt
        sys_content = prompt_manager.render(PromptTemplate.RESOLVER_SYSTEM)
        
        # 2. Render User Prompt (通过模板处理所有可选字段的展示逻辑)
        # 注意：我们需要确保 resolver_user.j2 模板能处理这些新增字段
        # 假设模板逻辑是:
        # Call: {{ call_code }}
        # {{ static_hint }}
        # ... Evidence ...
        user_content = prompt_manager.render(
            PromptTemplate.RESOLVER_USER,
            call_code=call_code,
            context_code=context_code,
            static_hint=static_hint,
            receiver_trace=receiver_trace
        )
        
        messages = [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content}
        ]
        
        try:
            result = self.predict(messages, response_model=ResolverDecision)
            if result: 
                return result
        except Exception:
            pass
            
        return ResolverDecision(targets=[])