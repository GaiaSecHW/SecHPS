# codedmap\infra\ai\services\taint_tagger.py

from typing import Any, List, Literal
from pydantic import BaseModel, Field

from codedmap.infra.ai.client import BaseAgent
from codedmap.infra.ai.prompts.manager import PromptManager, prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate

# 定义允许的安全角色
SecurityRole = Literal["SOURCE", "SINK", "SANITIZER", "NONE"]

class TagDecision(BaseModel):
    """单个标签决策"""
    role: SecurityRole = Field(..., description="The security role based on code logic.")
    category: str = Field(..., description="The specific vulnerability category (e.g., 'SQL Injection', 'Buffer Overflow').")
    confidence: float = Field(..., description="Confidence score between 0.0 and 1.0.")

class CodeTaggingResult(BaseModel):
    """LLM 对代码片段的完整打标结果"""
    tags: List[TagDecision] = Field(default_factory=list, description="List of identified security roles.")
    reasoning: str = Field(..., description="Concise technical reasoning.")

class SecurityTaggingAgent(BaseAgent):
    """
    [Internal Code Scanner] 内部代码安全打标 Agent。
    
    职责：
    扫描项目源代码 (White-box)，识别显式的 Sources, Sinks 和 Sanitizers。
    """

    def analyze(self, 
                code: str, 
                language: str = "c/c++",
                file_path: str = "unknown", 
                insights: List[str] = None, 
                similar_vulnerabilities: List[str] = None,
                **kwargs: Any) -> CodeTaggingResult:
        """
        Args:
            code: 切片后的代码文本
            language: 语言
            file_path: 文件路径
            insights: 上游数据流的安全 Insight 列表
            similar_vulnerabilities: 相似漏洞列表 (RAG)
            **kwargs: 吸收掉 ContextLoader 可能返回的其他非必要字段 (保持健壮性)
        """

        # 1. 渲染 System Prompt (无变量)
        sys_content = prompt_manager.render(PromptTemplate.SECURITY_TAGGING_SYSTEM)
        
        # 2. 准备 Template Context
        # 根据 User Template 的定义: {{ ctx.language }}, {{ ctx.code }} 等
        # 我们需要构造一个名为 ctx 的字典
        template_ctx = {
            "code": code,
            "language": language,
            "file_path": file_path,
            "insights": insights or [],
            "similar_vulnerabilities": similar_vulnerabilities or []
        }

        # 3. 渲染 User Prompt
        # 注意：这里传递的是 ctx=template_ctx，因为模板里是 {{ ctx.xxx }}
        user_content = prompt_manager.render(
            PromptTemplate.SECURITY_TAGGING_USER,
            ctx=template_ctx
        )

        messages = [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content}
        ]
        
        try:
            return self.predict(messages, response_model=CodeTaggingResult)
        except Exception:
            pass
        
        return CodeTaggingResult(tags=[], reasoning="Analysis Failed")