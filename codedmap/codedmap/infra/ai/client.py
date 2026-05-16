# codedmap/infra/ai/client.py

from abc import ABC
from typing import Any, Type, TypeVar, Optional, List
import os
import logging
from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

class BaseAgent(ABC):
    """
    所有 LLM Agent 的基类。
    
    Capabilities:
    1. Chat Completion (via Instructor)
    2. Text Embedding (via OpenAI Raw Client) [New]
    """
    def __init__(self, 
                 model: str = "qwen3-8b", 
                 embed_model: str = "qwen3-embedding-4b", # [New] 默认嵌入模型
                 temperature: float = 0.0,
                 api_base: Optional[str] = None,
                 api_key: Optional[str] = None):
        
        self.model = model
        self.embed_model = embed_model # [New]
        self.temperature = temperature
        self.api_base = api_base
        self.api_key = api_key

        try:
            from openai import OpenAI
            import instructor
        except ImportError as exc:
            raise ImportError(
                "AI features require optional dependencies. Install the 'ai' extra "
                "(for example: `pip install .[ai]`)."
            ) from exc
        
        # 2. 初始化 OpenAI 客户端
        self._raw_client = OpenAI(
            api_key=api_key or os.environ.get("OPENAI_API_KEY"),
            base_url=api_base or os.environ.get("OPENAI_BASE_URL")
        )
        
        # 3. 初始化 Instructor Client
        self.client = instructor.from_openai(self._raw_client)

    def predict(self, 
                messages: list, 
                response_model: Type[T], 
                retries: int = 2) -> Optional[T]:
        """通用 Chat 预测方法"""
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_model=response_model,
                temperature=self.temperature,
                parallel_tool_calls=False,
                max_retries=retries,
            )
            return resp
            
        except Exception as e:
            logger.error(f"LLM Agent failed: {e}")
            return None

    # 通用的 Embedding 能力
    def get_embedding(self, text: str) -> List[float]:
        """
        调用底层 Embedding API。
        """
        try:
            # 简单的清洗
            cleaned = text.replace("\n", " ").strip()
            if not cleaned: 
                return []
            
            # 使用 _raw_client 调用 embeddings 接口
            # 注意：这不经过 instructor，直接走 openai 原生接口
            response = self._raw_client.embeddings.create(
                model=self.embed_model,
                input=[cleaned]
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding failed (Model: {self.embed_model}): {e}")
            return []