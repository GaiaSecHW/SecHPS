import pytest
from unittest.mock import MagicMock, patch
from typing import List
import sys
import os

sys.path.append(os.getcwd())

from codedmap.infra.services.node_resolver import NodeResolver, LocationQuery, ResolvedContext
from codedmap.core.schema.graph.nodes import AstNode, MethodNode, FileNode
from codedmap.core.schema.graph.enums import Language, NodeLabel
from codedmap.infra.storage.store import CPGStore

# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def mock_store():
    store = MagicMock(spec=CPGStore)
    store.ast = MagicMock()
    store.methods = MagicMock()
    store.files = MagicMock()
    return store

@pytest.fixture
def resolver(mock_store):
    return NodeResolver(mock_store)

# =============================================================================
# Tests
# =============================================================================

class TestLocationResolution:
    # ... (这部分的测试逻辑保持不变，依然有效) ...
    
    def test_resolve_exact_path_success(self, resolver, mock_store):
        node = AstNode(id=1, label="UNKNOWN", code="x = 1")
        mock_store.ast.find_by_location.return_value = [node]
        query = LocationQuery(file_path="/src/main.c", line_number=10)
        assert resolver.resolve_location(query) == node

    def test_resolve_path_fallback(self, resolver, mock_store):
        node = AstNode(id=2, label="UNKNOWN")
        mock_store.ast.find_by_location.side_effect = [[], [node]]
        query = LocationQuery(file_path="/abs/path/utils.py", line_number=50)
        assert resolver.resolve_location(query) == node
        # 验证调用了两次：全路径 + 文件名
        assert mock_store.ast.find_by_location.call_count == 2

    def test_heuristic_selection_priority(self, resolver, mock_store):
        # 验证智能选优：Method > Call
        # 注意：补充必要的字段以符合 Pydantic 定义
        node_call = AstNode(id=2, label=NodeLabel.CALL, code="get_user()", order=2)
        node_method = MethodNode(id=3, label=NodeLabel.METHOD, name="main", fullName="main", code="def main():", order=1)
        
        mock_store.ast.find_by_location.return_value = [node_method, node_call]
        
        query = LocationQuery(file_path="test.py", line_number=10)
        result = resolver.resolve_location(query)
        
        assert result.id == 3 
        assert result.label == NodeLabel.METHOD

class TestFunctionResolution:
    # ... (保持不变) ...
    def test_resolve_exact_match(self, resolver, mock_store):
        method = MethodNode(id=1, label="METHOD", name="login", fullName="User.login")
        mock_store.methods.find_by_name.return_value = [method]
        results = resolver.resolve_function("login", fuzzy=True)
        assert results[0] == method

class TestContextRetrieval:
    """测试 get_node_context (包含新增的 surrounding_code 逻辑)"""

    def test_get_context_basic(self, resolver, mock_store):
        """场景：基础上下文获取 (不涉及 SourceManager)"""
        target_node = AstNode(id=100, label="CALL", code="auth()")
        parent_method = MethodNode(id=50, label="METHOD", name="handle", fullName="handle")
        
        mock_store.ast.get_by_id.return_value = target_node
        mock_store.ast.get_enclosing_method.return_value = parent_method
        mock_store.ast.get_enclosing_file.return_value = None # 没有文件节点
        
        context = resolver.get_node_context(100)
        
        assert context.node == target_node
        assert context.enclosing_method == parent_method
        assert context.surrounding_code is None # 因为没有 FileNode，无法查找上下文

    # [New] 关键测试：验证 SourceManager 集成
    @patch("codedmap.infra.services.node_resolver._global_source_manager")
    def test_get_context_with_surrounding_code(self, mock_source_manager, resolver, mock_store):
        """
        场景：成功获取周边代码上下文。
        我们需要 Mock 掉全局的 source_manager。
        """
        # 1. 准备数据
        # [Fix] 使用 alias "lineNumber" 而不是 "line_number"
        target_node = AstNode(id=100, label="CALL", code="risk()", lineNumber=10) 
        parent_file = FileNode(id=1, label="FILE", name="/src/vuln.c", fullName="/src/vuln.c", language=Language.C)

        mock_store.ast.get_by_id.return_value = target_node
        mock_store.ast.get_enclosing_file.return_value = parent_file
        mock_store.ast.get_enclosing_method.return_value = None

        # 2. Mock SourceManager 的行为
        # 模拟 get_surrounding_lines 返回格式化好的代码
        expected_context = """
           9 | int x = 0;
        > 10 | risk();
          11 | return;
        """
        mock_source_manager.get_surrounding_lines.return_value = expected_context.strip()

        # 3. 执行
        context = resolver.get_node_context(100, window_size=5)

        # 4. 验证
        assert context.node == target_node
        assert context.enclosing_file == parent_file
        # 核心验证点：surrounding_code 是否被正确填充
        assert context.surrounding_code == expected_context.strip()
        
        # 验证是否正确调用了 SourceManager
        mock_source_manager.get_surrounding_lines.assert_called_with(
            filename="/src/vuln.c", 
            center_line=10, 
            window=5
        )

    def test_get_context_fallback_code(self, resolver, mock_store):
        """场景：Lazy load code"""
        
        # 1. 实例化真实的 AstNode
        target_node = AstNode(id=101, label="UNKNOWN", code=None)
        
        # [Fix] 使用 object.__setattr__ 强制覆盖实例方法
        # 绕过 Pydantic 的 __setattr__ 拦截机制，直接修改底层 __dict__
        lazy_mock = MagicMock(return_value="lazy_code")
        object.__setattr__(target_node, "get_code", lazy_mock)
        
        # 2. 配置 Mock Store
        mock_store.ast.get_by_id.return_value = target_node
        mock_store.ast.get_enclosing_method.return_value = None
        mock_store.ast.get_enclosing_file.return_value = None
        
        # 3. 执行
        context = resolver.get_node_context(101)
        
        # 4. 验证
        assert context.source_code_snippet == "lazy_code"
        lazy_mock.assert_called_once()