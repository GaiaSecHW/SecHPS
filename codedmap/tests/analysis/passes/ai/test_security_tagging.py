import unittest
from unittest.mock import MagicMock, patch, ANY
import sys
import os
import logging

sys.path.append(os.getcwd())

from codedmap.analysis.passes.ai.smart_dataflow_tagging import SecurityTaggingPass
from codedmap.core.schema.graph.nodes import MethodNode, FileNode
from codedmap.core.schema.graph.enums import Language, NodeLabel

from codedmap.infra.ai.services.taint_tagger import CodeTaggingResult, TagDecision

logging.basicConfig(stream=sys.stdout, level=logging.DEBUG)
logger = logging.getLogger(__name__)

class TestSecurityTaggingPass(unittest.TestCase):

    def setUp(self):
        self.mock_store = MagicMock()
        self.mock_config = MagicMock()
        self.mock_config.ai.enable_llm = True
        self.mock_config.ai.model_name = "gpt-4-turbo"
        self.mock_config.get_openai_api_key.return_value = "fake-key"
        self.mock_config.ai.api_base = "https://api.openai.com/v1"

        self.patcher_context = patch("codedmap.analysis.passes.ai.base.ContextLoader")
        self.MockContextLoaderClass = self.patcher_context.start()
        self.mock_context = self.MockContextLoaderClass.return_value
        
        self.mock_context.ast = MagicMock()
        self.mock_context.call = MagicMock()
        
        self.mock_context.call.get_callers.return_value = []
        self.mock_context.ast.get_enclosing_file.return_value = None

        self.patcher_splitter = patch("codedmap.analysis.passes.ai.semantic.SemanticCodeSplitter")
        self.MockSplitterClass = self.patcher_splitter.start()
        self.mock_splitter = self.MockSplitterClass.return_value

    def tearDown(self):
        self.patcher_context.stop()
        self.patcher_splitter.stop()

    def test_static_rule_interception(self):
        """
        [Case 1] 静态规则拦截测试
        """
        print("\n=== DEBUG: Starting test_static_rule_interception ===")
        
        node = MethodNode(id=1, name="exec", is_external=False, label=NodeLabel.METHOD, fullName="os/exec.go")
        self.mock_store.tags.get_all.return_value = []
        
        pass_instance = SecurityTaggingPass(self.mock_store, self.mock_config)
        
        should_process = pass_instance.heuristic_filter(node)
        
        self.assertFalse(should_process, "Known sink should be intercepted by static filter")
        self.mock_store.tags.add.assert_called_with(node, "ONTOLOGY:SINK:COMMAND_INJECTION")

    def test_filter_test_files(self):
        """
        [Case 2] 测试文件过滤
        """
        print("\n=== DEBUG: Starting test_filter_test_files ===")
        
        node = MethodNode(
            id=2, name="test_login", fullName="test_login",
            file_name="tests/test_auth.py", 
            fileName="tests/test_auth.py", 
            is_external=False,
            label=NodeLabel.METHOD
        )
        self.mock_store.tags.get_all.return_value = []

        pass_instance = SecurityTaggingPass(self.mock_store, self.mock_config)
        
        self.assertFalse(pass_instance.heuristic_filter(node), "Test files should be skipped")

    @patch("codedmap.analysis.passes.ai.smart_dataflow_tagging.SecurityTaggingAgent")
    def test_context_injection_entry_point(self, MockAgentClass):
        """
        [Case 3] 上下文注入：入口点检测
        """
        print("\n=== DEBUG: Starting test_context_injection_entry_point ===")
        
        mock_agent = MockAgentClass.return_value
        mock_agent.analyze.return_value = CodeTaggingResult(tags=[], reasoning="No risk")
        
        node = MethodNode(
            id=3, name="handle_request", fullName="api.handle_request",
            code="def handle_request(req): pass",
            label=NodeLabel.METHOD
        )
        
        self.mock_context.call.get_callers.return_value = [] 
        
        file_node = FileNode(name="api/routes.py", fullName="src/api/routes.py", language=Language.PYTHON)
        self.mock_context.ast.get_enclosing_file.return_value = file_node
        
        self.mock_context.get_context_data.return_value = {
            "code": "def handle_request(req): pass",
            "name": "handle_request",
            "file": "api/routes.py"
        }
        
        pass_instance = SecurityTaggingPass(self.mock_store, self.mock_config)
        
        chunks = pass_instance.generate_prompt_content(node)
        
        self.assertIsNotNone(chunks)
        prompt_content = chunks[0]
        
        logger.debug(f"Generated Prompt: {prompt_content}")

    @patch("codedmap.analysis.passes.ai.smart_dataflow_tagging.SecurityTaggingAgent")
    def test_context_injection_internal_helper(self, MockAgentClass):
        """
        [Case 4] 上下文注入：内部工具函数
        """
        print("\n=== DEBUG: Starting test_context_injection_internal_helper ===")
        
        node = MethodNode(id=4, name="validate_id", code="def validate_id(id): pass", label=NodeLabel.METHOD, fullName="src/utils.py")
        
        caller1 = MethodNode(id=10, name="admin_panel", fullName="admin_panel", label=NodeLabel.METHOD)
        caller2 = MethodNode(id=11, name="user_profile", fullName="user_profile", label=NodeLabel.METHOD)
        
        mock_call_node1 = MagicMock()
        mock_call_node2 = MagicMock()
        
        self.mock_context.call.get_callers.return_value = [mock_call_node1, mock_call_node2]
        
        def get_enclosing_method_side_effect(call_node):
            if call_node == mock_call_node1: return caller1
            if call_node == mock_call_node2: return caller2
            return None
        self.mock_context.ast.get_enclosing_method.side_effect = get_enclosing_method_side_effect
        
        self.mock_context.ast.get_enclosing_file.return_value = FileNode(name="utils.py", fullName="src/utils.py", language=Language.PYTHON)

        self.mock_context.get_context_data.return_value = {
            "code": "def validate_id(id): pass",
            "name": "validate_id",
            "file": "utils.py"
        }

        pass_instance = SecurityTaggingPass(self.mock_store, self.mock_config)
        
        chunks = pass_instance.generate_prompt_content(node)
        
        self.assertIsNotNone(chunks)
        prompt_content = chunks[0]
        logger.debug(f"Generated Prompt: {prompt_content}")

    @patch("codedmap.analysis.passes.ai.smart_dataflow_tagging.SecurityTaggingAgent")
    def test_large_function_merge_logic(self, MockAgentClass):
        """
        [Case 5] 大函数切片与结果合并 (Reduce)
        """
        print("\n=== DEBUG: Starting test_large_function_merge_logic ===")
        
        mock_agent = MockAgentClass.return_value
        
        def analyze_side_effect(content):
            if "chunk_1" in content:
                return CodeTaggingResult(
                    tags=[TagDecision(role="SOURCE", category="CLI", confidence=0.9)],
                    reasoning="Found source in chunk 1"
                )
            elif "chunk_2" in content:
                return CodeTaggingResult(
                    tags=[TagDecision(role="SINK", category="SQL_INJECTION", confidence=0.9)],
                    reasoning="Found sink in chunk 2"
                )
            return None
        
        mock_agent.analyze.side_effect = analyze_side_effect

        node = MethodNode(id=5, name="complex_process", code="very_long_code...", fullName="src/complex.py", label=NodeLabel.METHOD)
        
        self.mock_context.call.get_callers.return_value = []
        self.mock_context.ast.get_enclosing_file.return_value = FileNode(name="complex.py", fullName="src/complex.py", language=Language.PYTHON)

        self.mock_context.get_context_data.return_value = {
            "code": "very_long_code...",
            "name": "complex_process",
            "file": "complex.py"
        }

        pass_instance = SecurityTaggingPass(self.mock_store, self.mock_config)
        
        prompts = pass_instance.generate_prompt_content(node)
        self.assertIsNotNone(prompts)
        
        results = []
        for p in prompts:
            results.append(analyze_side_effect("chunk_1"))
        
        final_result = pass_instance.create_patch(node, results)

        self.assertIsNotNone(final_result)

if __name__ == '__main__':
    unittest.main()
