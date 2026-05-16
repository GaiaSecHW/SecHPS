import unittest
from unittest.mock import MagicMock, patch

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.agents.semantic import SemanticAgent, SemanticAnalysisResult, AnalysisType

class TestSemanticAgent(unittest.TestCase):

    def setUp(self):
        # 初始化 Agent
        self.agent = SemanticAgent(api_key="fake-key")

    @patch("codedmap.agents.base.BaseAgent.predict")
    def test_analyze_function_success(self, mock_predict):
        """测试 1: 分析函数语义 (FUNCTION模式)"""
        # 1. 模拟 LLM 返回
        mock_response = SemanticAnalysisResult(
            summary="Validates user password.",
            security_note="Uses raw comparison.",
            tags=["auth", "security"],
            category="Security Logic"
        )
        mock_predict.return_value = mock_response

        # 2. 调用新接口 analyze
        code_snippet = "bool check_pass(char* p) { ... }"
        result = self.agent.analyze(
            code=code_snippet, 
            name="check_pass", 
            target_type=AnalysisType.FUNCTION,
            context_info="Caller: main"
        )

        # 3. 验证
        self.assertEqual(result.summary, "Validates user password.")
        self.assertIn("auth", result.tags)
        # 验证是否使用了 FUNCTION 对应的 Prompt
        call_args = mock_predict.call_args
        messages = call_args[0][0] # messages list
        system_prompt = messages[0]['content']
        self.assertIn("Behavior", system_prompt) # FUNCTION prompt 特征词

    @patch("codedmap.agents.base.BaseAgent.predict")
    def test_analyze_struct_success(self, mock_predict):
        """测试 2: 分析结构体语义 (STRUCT模式)"""
        mock_response = SemanticAnalysisResult(
            summary="Represents a network packet.",
            tags=["network", "data"],
            category="Data Model"
        )
        mock_predict.return_value = mock_response

        result = self.agent.analyze(
            code="struct Packet { int id; };", 
            name="Packet", 
            target_type=AnalysisType.STRUCT
        )

        self.assertEqual(result.summary, "Represents a network packet.")
        # 验证是否使用了 STRUCT 对应的 Prompt
        messages = mock_predict.call_args[0][0]
        system_prompt = messages[0]['content']
        self.assertIn("data architect", system_prompt) # STRUCT prompt 特征词

    @patch("codedmap.agents.base.BaseAgent.predict")
    def test_analyze_fallback(self, mock_predict):
        """测试 3: LLM 失败时的兜底逻辑"""
        mock_predict.return_value = None

        result = self.agent.analyze("void foo(){}", "foo", AnalysisType.FUNCTION)

        # 验证兜底返回值
        self.assertTrue(result.summary.startswith("FUNCTION foo"))
        self.assertEqual(result.tags, ["function"])

    @patch("litellm.embedding")
    def test_get_embedding(self, mock_embedding):
        """测试 4: 向量生成"""
        mock_embedding.return_value = {"data": [{"embedding": [0.1, 0.9]}]}
        
        vector = self.agent.get_embedding("source_code")
        self.assertEqual(vector, [0.1, 0.9])

if __name__ == '__main__':
    unittest.main()