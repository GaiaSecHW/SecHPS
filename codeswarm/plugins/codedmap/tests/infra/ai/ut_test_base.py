import unittest
import logging
from pydantic import BaseModel, Field
from typing import Optional

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())



# 导入被测类
from codedmap.agents.base import BaseAgent

# 屏蔽无关的 litellm 日志，保持测试输出整洁
logging.getLogger("litellm").setLevel(logging.WARNING)

class SimpleResponse(BaseModel):
    """用于测试结构化输出的简单模型"""
    answer: str = Field(description="The direct answer to the question")
    confidence: float = Field(description="Confidence score between 0 and 1")

class TestBaseAgent(unittest.TestCase):
    def setUp(self):
        # 1. 配置测试环境
        # 建议从环境变量读取，如果没有则使用默认值（通常是 mock 或报错）
        os.environ['NO_PROXY'] = 'api.openai.rnd.huawei.com'
        os.environ['no_proxy'] = 'api.openai.rnd.huawei.com'

        self.model = 'openai/qwen3-14b'
        self.api_key = 'sk-1234'
        self.api_base = 'http://api.openai.rnd.huawei.com/v1'

    

        # 2. 实例化 Agent
        # 这里我们创建一个具体的子类，因为 BaseAgent 是抽象类 (ABC)
        class ConcreteAgent(BaseAgent):
            pass
            
        self.agent = ConcreteAgent(
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
            temperature=0.0
        )

    def test_predict_success(self):
        """
        验证 Agent 是否可以连接 LLM 并返回结构化输出。
        注意：这通常是一个集成测试，需要真实的网络连接。
        """
        # 如果没有 API Key，跳过真实测试
        if self.api_key.startswith("sk-."):
            self.skipTest("Skipping real LLM test: No API Key provided.")

        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is 1 + 1? Respond with a score of 1.0."}
        ]

        # 执行预测
        result = self.agent.predict(
            messages=messages,
            response_model=SimpleResponse
        )

        # 验证结果
        self.assertIsNotNone(result, "LLM returned None, possibly a connection or parsing error.")
        self.assertIsInstance(result, SimpleResponse)
        self.assertEqual(result.answer, "2")
        self.assertGreaterEqual(result.confidence, 0.9)
        print(f"\n[Test Result] Answer: {result.answer}, Confidence: {result.confidence}")

    def test_predict_error_handling(self):
        """
        验证当模型名称错误或 API 失败时的错误处理。
        """
        self.agent.model = "non-existent-model"
        
        messages = [{"role": "user", "content": "hello"}]
        result = self.agent.predict(messages=messages, response_model=SimpleResponse, retries=0)
        
        self.assertIsNone(result, "Agent should return None on failure.")

if __name__ == "__main__":
    unittest.main()