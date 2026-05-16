import unittest
from unittest.mock import MagicMock, patch, ANY
import sys
import os

sys.path.append(os.getcwd())

from codedmap.analysis.passes.ai.smart_summary import SmartSummaryPass
from codedmap.core.schema.graph.nodes import MethodNode, IdentifierNode
from codedmap.core.schema.graph.enums import NodeLabel

class TestSmartSummaryPass(unittest.TestCase):

    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.ai.enable_llm = True
        self.mock_config.ai.model_name = "gpt-4-turbo"
        self.mock_config.get_openai_api_key.return_value = "sk-fake-key"

        self.mock_store = MagicMock()
        self.mock_store.tags.get_all.return_value = []

        self.patcher_context = patch("codedmap.analysis.passes.ai.base.ContextLoader")
        self.MockContextLoaderClass = self.patcher_context.start()
        self.mock_context = self.MockContextLoaderClass.return_value
        
        self.mock_context.ast = MagicMock()
        self.mock_context.call = MagicMock()
        self.mock_context.dataflow = MagicMock()

    def tearDown(self):
        self.patcher_context.stop()

    @patch("codedmap.analysis.passes.ai.smart_summary.LibrarySummaryAgent")
    def test_pass_initialization(self, MockAgentClass):
        """Test that SmartSummaryPass initializes correctly."""
        print("\n=== DEBUG: Starting test_pass_initialization ===")
        
        pass_instance = SmartSummaryPass(self.mock_store, self.mock_config)
        
        self.assertIsNotNone(pass_instance)

    def test_heuristic_filter_external(self):
        """Test that external methods are processed."""
        print("\n=== DEBUG: Starting test_heuristic_filter_external ===")
        
        pass_instance = SmartSummaryPass(self.mock_store, self.mock_config)
        
        node = MethodNode(id=1, name="external_func", is_external=True, label=NodeLabel.METHOD, fullName="lib.external_func")
        
        result = pass_instance.heuristic_filter(node)
        self.assertTrue(result)

    def test_heuristic_filter_internal(self):
        """Test that internal methods may be filtered."""
        print("\n=== DEBUG: Starting test_heuristic_filter_internal ===")
        
        pass_instance = SmartSummaryPass(self.mock_store, self.mock_config)
        
        node = MethodNode(id=2, name="internal_func", is_external=False, label=NodeLabel.METHOD, fullName="app.internal_func")
        
        result = pass_instance.heuristic_filter(node)
        self.assertFalse(result)

if __name__ == '__main__':
    unittest.main()
