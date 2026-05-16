# codedmap\pipeline\dispatch\critic.py

import logging
from typing import List, Optional
from codedmap.infra.ai.prompts.manager import PromptManager, prompt_manager
from codedmap.infra.ai.prompts.registry import PromptTemplate
from pydantic import BaseModel, Field

# 导入基类和策略定义
from codedmap.core.schema.graph.enums import FileRiskLevel, ParseStrategy
from codedmap.infra.ai.client import BaseAgent

logger = logging.getLogger(__name__)

# --- 结构化输出定义 (Response Model) ---
class SecurityAssessment(BaseModel):
    """
    LLM 对文件安全风险的评估结果
    """
    chain_of_thought: str = Field(..., description="Brief analysis...")
    risk_level: FileRiskLevel = Field(..., description="Estimated risk level.")
    strategy: ParseStrategy = Field(..., description="Recommended strategy.")
    confidence: float = Field(..., ge=0.0, le=1.0)

# --- 评审员实现 ---
class SecurityCritic(BaseAgent):
    """
    L3 决策层：利用 LLM 判断代码文件的攻击面属性。
    """


    def judge(self, file_path: str, includes: List[str], signatures: List[str]) -> ParseStrategy:
        """
        核心判定方法。
        
        Args:
            file_path: 文件路径 (非常有用的上下文信息)
            includes: 文件引用的头文件列表 (前10-20个)
            signatures: 文件中导出的函数签名列表 (前20-50个)
        
        Returns:
            ParseStrategy: FULL or SKELETON
        """
        # 1. 渲染 System Prompt
        sys_content = prompt_manager.render(PromptTemplate.DISPATCH_CRITIC_SYSTEM)
        includes_str = ', '.join(includes[:15])
        sigs_str = ', '.join(signatures[:30])
        
        # 2. 渲染 User Prompt
        # 直接传入列表数据，由 Jinja2 负责格式化 (或在 Python 端预处理为字符串)
        # 为了模板简洁，我们在 Python 端做简单的切片和 join，或者传 raw list 给模板
        # 这里维持原有逻辑，传字符串给模板更可控
        user_content = prompt_manager.render(
            PromptTemplate.DISPATCH_CRITIC_USER,
            file_path=file_path,
            includes=includes_str,
            signatures=sigs_str
        )

        messages = [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content}
        ]

        # 3. 调用 LLM
        try:
            assessment: Optional[SecurityAssessment] = self.predict(
                messages=messages,
                response_model=SecurityAssessment,
                retries=2
            )

            # 3. 解析结果
            if assessment:
                logger.info(
                    f"[Critic] {file_path} -> {assessment.strategy} "
                    f"(Risk: {assessment.risk_level}, Conf: {assessment.confidence:.2f})"
                )
                logger.debug(f"Reason: {assessment.chain_of_thought}")
                return assessment.strategy
            
            else:
                logger.warning(f"[Critic] Failed to get structured response for {file_path}. Fallback to FULL.")
                return ParseStrategy.FULL

        except Exception as e:
            logger.error(f"[Critic] LLM Error judging {file_path}: {e}")
            # 4. 故障安全 (Fail-Safe): 遇到错误默认进行全量分析，防止漏报
            return ParseStrategy.FULL