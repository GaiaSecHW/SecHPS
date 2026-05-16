import unittest
from unittest.mock import MagicMock, patch, call, ANY
import sys
import os
import logging
import hashlib

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.analysis.passes.ai.semantic import SemanticEmbeddingPass
from codedmap.core.schema.graph.nodes import MethodNode, TypeDeclNode, FileNode
from codedmap.core.schema.graph.enums import Language, NodeLabel, EdgeType

# 模拟 AI 服务返回结构
from codedmap.infra.ai.services.semantic import SemanticAnalysisResult

# 配置 logging 输出到控制台
logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)
logger = logging.getLogger(__name__)

class TestSemanticEmbeddingPass(unittest.TestCase):

    def setUp(self):
        # 1. Mock Store
        self.mock_store = MagicMock()
        
        # 2. Mock Config
        self.mock_config = MagicMock() 
        self.mock_config.ai = MagicMock()
        self.mock_config.ai.enable_llm = True
        self.mock_config.ai.model_name = "gpt-4o"
        self.mock_config.get_openai_api_key.return_value = "fake-key"
        self.mock_config.storage.backend = "neo4j"
        self.mock_config.ai.api_base = "https://api.openai.com/v1" 
        
        # 3. Patch ContextLoader
        self.patcher_context = patch("codedmap.analysis.passes.ai.base.ContextLoader")
        self.MockContextLoaderClass = self.patcher_context.start()
        self.mock_context = self.MockContextLoaderClass.return_value
        
        # 配置 Navigators
        self.mock_context.ast = MagicMock()
        self.mock_context.call = MagicMock()
        self.mock_context.structure = MagicMock() 
        
        # Mock 架构相关返回值
        self.mock_context.structure.generate_repo_skeleton.return_value = "src/\n  main.py"
        self.mock_context.structure.get_module_dependencies.return_value = ["src/utils.py"]

        # 4. Patch Splitter
        self.patcher_splitter = patch("codedmap.analysis.passes.ai.semantic.SemanticCodeSplitter")
        self.MockSplitterClass = self.patcher_splitter.start()
        self.mock_splitter = self.MockSplitterClass.return_value

    def tearDown(self):
        self.patcher_context.stop()
        self.patcher_splitter.stop()

    @patch("codedmap.analysis.passes.ai.semantic.SemanticRetrievalAgent")
    def test_standard_flow_small_function(self, MockAgentClass):
        """
        [Case 1] 标准流程测试 (小函数)
        """
        print("\n=== DEBUG: Starting test_standard_flow_small_function ===")
        
        # --- Arrange ---
        mock_agent = MockAgentClass.return_value
        
        # Mock LLM Responses
        mock_agent.analyze.return_value = SemanticAnalysisResult(
            summary="Standard function summary.", 
            tags=["standard"], 
            category="Logic"
        )
        mock_agent.get_embedding.return_value = [0.1, 0.2]

        code_content = "def small_func():\n    pass # short code"
        expected_hash = hashlib.md5(code_content.encode('utf-8')).hexdigest()

        method_node = MethodNode(
            id=10, name="small_func", fullName="test.small_func", 
            code=code_content, label=NodeLabel.METHOD,
            file_name="src/test.py"
        )
        
        # Mock Store Query
        self.mock_store.query.all_nodes.return_value.to_list.return_value = [method_node]
        
        # Mock Context & Splitter
        self.mock_context.ast.get_context_code.return_value = code_content
        self.mock_splitter.split.return_value = [code_content]

        # --- Act ---
        # 显式指定 targets 为 METHOD，模拟第一阶段
        pass_instance = SemanticEmbeddingPass(self.mock_store, self.mock_config, targets=[NodeLabel.METHOD])
        
        with patch("codedmap.analysis.passes.ai.semantic.ai_token_counter", return_value=100):
            pass_instance.run()

        # --- Assert ---
        # 验证 Intent Update
        self.mock_store.update_node_properties.assert_called_with(10, {
            "embedding": [0.1, 0.2],
            "summary": "Standard function summary.",
            "code_hash": expected_hash 
        })

    @patch("codedmap.analysis.passes.ai.semantic.SemanticRetrievalAgent")
    def test_large_function_deep_analysis(self, MockAgentClass):
        """
        [Case 2] 大函数深度分析测试 (Map-Reduce)
        """
        print("\n=== DEBUG: Starting test_large_function_deep_analysis ===")
        
        # --- Arrange ---
        mock_agent = MockAgentClass.return_value
        
        # Mock LLM Responses
        def analyze_side_effect(code, name, **kwargs):
            if "part_0" in name:
                return SemanticAnalysisResult(summary="Chunk 0 logic.", tags=["init"], category="Part")
            elif "part_1" in name:
                return SemanticAnalysisResult(summary="Chunk 1 logic.", tags=["process"], category="Part")
            else:
                return SemanticAnalysisResult(summary="Head Intent.", tags=["head"], category="Head")
        
        mock_agent.analyze.side_effect = analyze_side_effect
        mock_agent.get_embedding.return_value = [0.9, 0.9]

        code_content = "long_code..." * 500
        method_node = MethodNode(
            id=20, name="large_func", fullName="test.large_func", 
            code=code_content, label=NodeLabel.METHOD
        )
        
        self.mock_store.query.all_nodes.return_value.to_list.return_value = [method_node]
        self.mock_context.ast.get_context_code.return_value = code_content
        self.mock_splitter.split.return_value = ["chunk_code_0", "chunk_code_1"]

        # --- Act ---
        pass_instance = SemanticEmbeddingPass(self.mock_store, self.mock_config, targets=[NodeLabel.METHOD])
        
        with patch("codedmap.analysis.passes.ai.semantic.ai_token_counter", return_value=5000):
            pass_instance.run()

        # --- Assert ---
        # 验证 Merge & Re-Embedding 是否被调用
        embed_calls = mock_agent.get_embedding.call_args_list
        re_calc_called = False
        for call_args in embed_calls:
            text_arg = call_args[0][0]
            if "High Level Intent: Head Intent." in text_arg and \
               "- Part 0: Chunk 0 logic." in text_arg:
                re_calc_called = True
                break
        
        self.assertTrue(re_calc_called, "Should trigger re-embedding with aggregated summary")

    @patch("codedmap.analysis.passes.ai.semantic.SemanticRetrievalAgent")
    def test_file_level_summary(self, MockAgentClass):
        """
        [Case 3] 文件级摘要测试 (File Summary of Summaries)
        验证：
        1. ContextLoader 正确获取文件内的方法列表。
        2. Prompt 正确聚合了 Method Summary。
        3. 结果正确写入 FileNode 的 summary 和 topics 字段。
        """
        print("\n=== DEBUG: Starting test_file_level_summary ===")

        # --- Arrange ---
        mock_agent = MockAgentClass.return_value
        
        # Mock LLM Response for File Analysis
        mock_agent.analyze.return_value = SemanticAnalysisResult(
            summary="This file handles user authentication and session management.",
            tags=["Auth", "Session", "Security"], # 这些应该被写入 topics
            category="Module"
        )
        mock_agent.get_embedding.return_value = [0.8, 0.8, 0.8]

        # 构造文件节点
        file_node = FileNode(id=99, name="src/auth.py", fullName="/abs/src/auth.py", label=NodeLabel.FILE, language=Language.PYTHON)
        
        # 构造文件内的函数节点 (模拟 Stage A 已完成，summary 已存在)
        m1 = MethodNode(name="login", fullName="login", summary="Verifies user credentials.")
        m2 = MethodNode(name="logout", fullName="logout", summary="Invalidates session.")
        # 模拟一个没有 summary 的函数 (测试回退逻辑)
        m3 = MethodNode(name="helper", fullName="helper", signature="def helper(x):") 

        # Mock Store Query (只返回 FileNode)
        self.mock_store.query.all_nodes.return_value.to_list.return_value = [file_node]

        # Mock ContextLoader (获取文件内方法)
        self.mock_context.ast.get_methods_in_file.return_value = [m1, m2, m3]

        # --- Act ---
        # 模拟第二阶段：只处理 FILE
        pass_instance = SemanticEmbeddingPass(self.mock_store, self.mock_config, targets=[NodeLabel.FILE])
        pass_instance.run()

        # --- Assert ---

        # 1. 验证 Prompt 构建 (Summary of Summaries)
        # 检查 agent.analyze 被调用，且 context_info 包含了函数摘要
        analyze_call = mock_agent.analyze.call_args
        self.assertIsNotNone(analyze_call, "Agent.analyze should be called for File")
        
        # 检查参数
        kwargs = analyze_call[1]
        context_info = kwargs.get('context_info', '')
        
        self.assertIn("TARGET:FILE", context_info)
        self.assertIn("Verifies user credentials", context_info, "Should include m1 summary")
        self.assertIn("Invalidates session", context_info, "Should include m2 summary")
        self.assertIn("helper", context_info, "Should include m3 name")
        self.assertIn("(No details)", context_info, "Should handle missing summary for m3")

        # 2. 验证结果写入
        # FileNode 特殊处理：tags -> topics
        self.mock_store.update_node_properties.assert_called_with(99, {
            "embedding": [0.8, 0.8, 0.8],
            "summary": "This file handles user authentication and session management.",
            "topics": ["Auth", "Session", "Security"], # 关键：验证 tags 映射到了 topics
            "code_hash": ANY # Hash 会基于方法签名计算，这里忽略具体值
        })

    def test_filter_logic_incremental(self):
        """
        [Case 4] 增量更新逻辑测试
        """
        print("\n=== DEBUG: Starting test_filter_logic_incremental ===")
        
        code_stable = "def stable(): pass"
        hash_stable = hashlib.md5(code_stable.encode('utf-8')).hexdigest()
        code_changed = "def changed(): return 1"
        hash_new = hashlib.md5(code_changed.encode('utf-8')).hexdigest()
        hash_old = "old_hash_value"

        node_stable = MethodNode(
            id=1, name="stable", fullName="stable", 
            embedding=[0.1], code_hash=hash_stable 
        )
        node_changed = MethodNode(
            id=2, name="changed", fullName="changed", 
            embedding=[0.1], code_hash=hash_old 
        )

        def get_code_side_effect(node, **kwargs):
            if node.id == 1: return code_stable
            if node.id == 2: return code_changed
            return ""
            
        self.mock_context.ast.get_context_code.side_effect = get_code_side_effect

        pass_instance = SemanticEmbeddingPass(self.mock_store, self.mock_config)
        
        # Test Stable
        self.assertFalse(pass_instance.heuristic_filter(node_stable))

        # Test Changed
        self.assertTrue(pass_instance.heuristic_filter(node_changed))
        self.assertEqual(node_changed.metadata["_new_code_hash"], hash_new)

if __name__ == '__main__':
    unittest.main()