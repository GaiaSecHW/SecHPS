import pytest
from unittest.mock import MagicMock
from typing import List

import sys
import os

sys.path.append(os.getcwd())

# 导入被测类和相关模型
from codedmap.infra.storage.repository import AstRepository
from codedmap.core.schema.graph.nodes import AstNode, MethodNode, FileNode
from codedmap.core.schema.graph.enums import Language, NodeLabel

# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def mock_traversal_source():
    """
    Mock 底层的 DSL 遍历源。
    AstRepository 严重依赖 source.files().ast()... 这种链式调用，
    我们需要模拟这个 Chain。
    """
    source = MagicMock()
    return source

@pytest.fixture
def ast_repo(mock_traversal_source):
    return AstRepository(mock_traversal_source)

@pytest.fixture
def sample_ast_nodes():
    """准备一组乱序的 AST 节点，用于测试排序"""
    # 节点 A: col 10
    node_a = AstNode(id=1, label="CALL", name="func_a", lineNumber=50, columnNumber=10, order=2)
    # 节点 B: col 5 (应该排在 A 前面)
    node_b = AstNode(id=2, label="IDENTIFIER", name="var_b", lineNumber=50, columnNumber=5, order=1)
    # 节点 C: col 10, order 1 (应该排在 A 前面，因为 order 更小)
    node_c = AstNode(id=3, label="IDENTIFIER", name="var_c", lineNumber=50, columnNumber=10, order=1)
    
    return [node_a, node_b, node_c]

# =============================================================================
# Test Cases
# =============================================================================

class TestAstRepository:

    def test_find_by_location_basic(self, ast_repo, mock_traversal_source, sample_ast_nodes):
        """
        场景：根据文件和行号查找，验证基础流程和结果排序。
        预期：返回节点列表，且按照 (column, order) 排序。
        """
        # 1. 模拟 DSL 返回乱序列表
        # 链式: source.files(path).ast().where(line).to_list()
        mock_query = mock_traversal_source.files.return_value.ast.return_value.where.return_value
        mock_query.to_list.return_value = sample_ast_nodes # [A, B, C]

        # 2. 调用方法
        results = ast_repo.find_by_location(file_path="main.c", line=50)

        # 3. 验证调用链参数
        mock_traversal_source.files.assert_called_with("main.c")
        mock_traversal_source.files.return_value.ast.assert_called_once()
        # 验证第一次 where 调用了 lineNumber
        args, kwargs = mock_traversal_source.files.return_value.ast.return_value.where.call_args
        assert kwargs.get('lineNumber') == 50

        # 4. 验证排序逻辑
        # 期望顺序: 
        # 1. Node B (col=5)
        # 2. Node C (col=10, order=1)
        # 3. Node A (col=10, order=2)
        assert len(results) == 3
        assert results[0].id == 2 # Node B
        assert results[1].id == 3 # Node C
        assert results[2].id == 1 # Node A

    def test_find_by_location_with_column(self, ast_repo, mock_traversal_source):
        """
        场景：指定了列号进行更精确的查找。
        预期：DSL 链中应包含对 columnNumber 的过滤调用。
        """
        # 1. Setup Mock
        mock_chain = mock_traversal_source.files.return_value.ast.return_value.where.return_value
        mock_chain.where.return_value.to_list.return_value = [] # 模拟返回空

        # 2. Call
        ast_repo.find_by_location("main.c", line=50, column=12)

        # 3. Verify
        # 第一次 where (lineNumber)
        mock_traversal_source.files.return_value.ast.return_value.where.assert_called_with(lineNumber=50)
        # 第二次 where (columnNumber) - 注意：这是链式调用的第二环
        mock_chain.where.assert_called_with(columnNumber=12)

    def test_find_by_location_no_results(self, ast_repo, mock_traversal_source):
        """
        场景：查找不到节点。
        预期：返回空列表，不报错。
        """
        # Mock 返回空列表
        mock_traversal_source.files.return_value.ast.return_value.where.return_value.to_list.return_value = []
        
        results = ast_repo.find_by_location("ghost.c", 999)
        assert results == []

    def test_get_enclosing_method_found(self, ast_repo, mock_traversal_source):
        """
        场景：查找节点所属的方法 (成功)。
        """
        mock_method = MethodNode(id=100, label="METHOD", name="main", fullName="main")
        # source.by_id(node_id).method().to_list()
        mock_traversal_source.by_id.return_value.method.return_value.to_list.return_value = [mock_method]

        result = ast_repo.get_enclosing_method(node_id=1)
        
        assert result is not None
        assert result.name == "main"
        assert isinstance(result, MethodNode)
        
        # Verify call
        mock_traversal_source.by_id.assert_called_with(1)
        mock_traversal_source.by_id.return_value.method.assert_called_once()

    def test_get_enclosing_method_not_found(self, ast_repo, mock_traversal_source):
        """
        场景：节点是孤立的或不在方法内 (例如全局变量)。
        预期：返回 None。
        """
        mock_traversal_source.by_id.return_value.method.return_value.to_list.return_value = []
        
        result = ast_repo.get_enclosing_method(node_id=1)
        assert result is None

    def test_get_enclosing_file_found(self, ast_repo, mock_traversal_source):
        """
        场景：查找节点所属文件。
        """
        mock_file = FileNode(id=200, label="FILE", name="test.c", fullName="path/to/test.c", language=Language.C)
        # source.by_id(node_id).file().to_list()
        mock_traversal_source.by_id.return_value.file.return_value.to_list.return_value = [mock_file]

        result = ast_repo.get_enclosing_file(node_id=1)
        
        assert result is not None
        assert result.name == "test.c"
        assert isinstance(result, FileNode)

    def test_get_children(self, ast_repo, mock_traversal_source):
        """
        场景：获取 AST 子节点。
        """
        children = [AstNode(id=2, label="CALL"), AstNode(id=3, label="LITERAL")]
        # source.by_id(id).ast_children().to_list()
        mock_traversal_source.by_id.return_value.ast_children.return_value.to_list.return_value = children
        
        results = ast_repo.get_children(1)
        assert len(results) == 2
        assert results[0].label == "CALL"

    def test_find_in_file_all(self, ast_repo, mock_traversal_source):
        """
        场景：获取文件内所有节点 (无 Label 过滤)。
        """
        # source.files(name).ast().to_list()
        mock_traversal_source.files.return_value.ast.return_value.to_list.return_value = [AstNode(id=1, label="A")]
        
        ast_repo.find_in_file("main.c")
        
        # Verify: has_label 应该没被调用
        mock_ast_query = mock_traversal_source.files.return_value.ast.return_value
        mock_ast_query.has_label.assert_not_called()

    def test_find_in_file_filtered(self, ast_repo, mock_traversal_source):
        """
        场景：获取文件内特定类型的节点 (有 Label 过滤)。
        """
        # source.files(name).ast().has_label(label).to_list()
        
        ast_repo.find_in_file("main.c", label_filter="CALL")
        
        mock_ast_query = mock_traversal_source.files.return_value.ast.return_value
        mock_ast_query.has_label.assert_called_with("CALL")