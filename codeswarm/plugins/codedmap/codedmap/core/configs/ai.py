"""AI enhancement configuration for CPG SDK."""
import os
from typing import Optional, Literal
from pydantic import BaseModel, Field, SecretStr


class AIConfig(BaseModel):
    """AI 增强功能配置"""
    enable_llm: bool = Field(default=False, description="Master switch for AI features")
    provider: Literal["openai", "azure", "deepseek"] = "openai"

    # --- Model Settings ---
    # 生成式模型 (Chat/Reasoning)
    model_name: str = Field(default="gpt-oss-120b", description="Main LLM for reasoning (e.g. gpt-4, qwen)")
    # 嵌入模型 (Embedding) - 用于 SemanticPass 和 RAG 检索
    embed_model: str = Field(default="qwen3-embedding-4b", description="Embedding model name")

    api_key: Optional[SecretStr] = Field(default=SecretStr("sk-1234"), description="API Key")
    api_base: Optional[str] = Field(default="http://api.openai.rnd.huawei.com/v1", description="Custom API Base URL")

    # --- Execution Settings (Runner Pattern) ---
    # 使用 Literal 约束类型，对应 Orchestrator 中的判断逻辑
    runner_type: Literal["thread", "process", "sequential"] = Field(
        default="thread",
        description="Execution strategy for AI passes. 'thread' for IO-bound, 'process' for CPU-bound."
    )
    max_workers: int = Field(default=4, description="Max concurrency for AI Runner")

    # AI Pass 专用批处理大小 (Patch Buffer)
    # 用于控制 AIEnhancedPass 在 Reduce 阶段聚合多少个 Patch 后再提交给 DB
    batch_size: int = Field(default=500, description="Batch size for AI Patch application")

    # --- Feature Flags ---
    embedding_dim: int = 1536
    enable_smart_dispatcher: bool = True
    enable_smart_resolver: bool = True
    enable_smart_summary: bool = True
    enable_embedding: bool = True
    enable_security_tagging: bool = True

    # --- Thresholds ---
    confidence_threshold: float = 0.7

    def get_openai_api_key(self) -> Optional[str]:
        """Return the OpenAI API key from config or environment variable."""
        if self.api_key:
            return self.api_key.get_secret_value()
        return os.environ.get("OPENAI_API_KEY")
