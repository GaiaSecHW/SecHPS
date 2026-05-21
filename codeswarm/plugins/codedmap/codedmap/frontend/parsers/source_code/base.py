# codedmap/frontend/parsers/source_code/base.py
import logging
from abc import ABC, abstractmethod
from tree_sitter import Language, Parser, Node, QueryCursor, Query

from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import Language as LanguageEnum, ParseStrategy
from codedmap.core.schema.graph import AnyNode
from codedmap.frontend.parsers.base import AbstractParser
from codedmap.utils.source_manager import source_manager

from codedmap.utils.path_utils import normalize_path

logger = logging.getLogger("cpg.parser")

class SourceCodeParser(AbstractParser):
    def __init__(
        self, 
        builder: CPGBuilder, 
        language: Language, 
        language_enum: LanguageEnum,
        project_root: str = None
    ):
        super().__init__(builder, project_root)
        self.language = language
        self._language_enum = language_enum
        self.parser = Parser(language)
        self.source_code: bytes = b""


    def _parse_implementation(self, file_path: str):
        """实现从文件读源码并解析为 AST"""
        try:
            with open(file_path, "rb") as f:
                self.source_code = f.read()
        except Exception as e:
            logger.error(f"Failed to read file {file_path}: {e}")
            return None

        # 调用核心解析逻辑
        return self._perform_parse(self.source_code, f"file: {file_path}")

    def _perform_parse(self, source: bytes, source_name: str):
        """
        默认的 Tree-sitter 解析逻辑。
        """
        tree = self.parser.parse(source)
        if tree.root_node.has_error:
            logger.warning(f"Syntax errors detected in {source_name} (Standard Parse)")
        return tree.root_node

    @abstractmethod
    def run(self, filename: str, root_node: Node):
        """
        重写 run 签名以适配 Text Parser 的特性 (通常需要 source_code 切片)
        注意：Python 不支持严格的方法签名重载，这里利用 kwargs 或者默契约定
        为了严谨，我们可以在这里直接调用 `self.source_code`
        """
        pass


    def parse_string(self, code: str, file_name: str = "<string>", strategy: ParseStrategy = ParseStrategy.FULL) -> AnyNode:
        """解析字符串入口"""
        self.current_filename = normalize_path(file_name)
        self.source_code = code.encode("utf8")
        self.strategy = strategy # [New]

        source_manager.file_cache[self.current_filename] = self.source_code

        root_node = self._perform_parse(self.source_code, f"string: {file_name}")

        if root_node:
            self.run(self.current_filename, root_node, self.source_code)

        return root_node

    def parse_comments_only(self, file_path: str):
        """
        使用 Tree-sitter 提取注释，具备版本兼容性和降级策略。
        """
        root_node = self._parse_implementation(file_path)
        if not root_node:
            return

        with self.builder.file(file_path, language=self._language_enum):
            try:
                self._extract_comments_via_query(root_node)
            except Exception as e:
                logger.debug(f"Query extraction failed for {file_path} ({e}), falling back to recursive traversal.")
                self._extract_comments_recursive(root_node)

    def _extract_comments_via_query(self, root_node: Node):
        """适配 tree-sitter 最新版本 (v0.22+) 的 Query API"""

        # 1. 准备 Query String
        query_str = "(comment) @c"
        if self.language.name == 'cpp':
            query_str = "[(comment) (line_comment) (block_comment)] @c"

        try:
            # 构造 Query 对象
            query = Query(self.language, query_str)
        except Exception:
            # 如果当前语法的节点类型（如 line_comment）不存在，可能会抛错
            return

        # 构造 QueryCursor 对象
        cursor = QueryCursor(query)

        # 2. 执行查询
        # 返回字典: {'c': [Node, Node, ...], ...}
        captures = cursor.captures(root_node)

        # 3. 处理结果
        # captures.values() 是节点列表的集合 (list[list[Node]])
        for nodes_list in captures.values():
            for node in nodes_list:
                self._create_comment_node(node)

    def _extract_comments_recursive(self, node: Node):
        """[Fallback] 手动递归查找注释节点"""
        # 检查当前节点类型是否包含 'comment'
        # 这种模糊匹配能同时处理 'comment', 'line_comment', 'block_comment'
        if "comment" in node.type:
            self._create_comment_node(node)

        # 递归子节点
        # 注意：不要递归进入注释节点内部（虽然它们通常是叶子节点）
        if node.child_count > 0:
            for child in node.children:
                self._extract_comments_recursive(child)

    def _create_comment_node(self, node: Node):
        """创建单个 Comment 节点并挂载位置信息 (逻辑保持不变)"""
        # 提取文本
        # 注意：tree-sitter 0.22+ get_node_text 可能会有变动，建议直接用切片
        text = ""
        if hasattr(node, 'text'):
            # New API: node.text 返回 bytes (如果是 bytes parse)
            text = node.text.decode('utf-8', errors='replace')
        else:
            # Fallback
            start = node.start_byte
            end = node.end_byte
            text = self.source_code[start:end].decode('utf-8', errors='replace')

        text = text.strip()
        if not text: return

        # 判断是否是文档注释
        is_doc = (
                text.startswith("/**") or
                text.startswith("/*!") or
                text.startswith("///") or
                text.startswith("//!") or
                text.startswith('"""') or
                text.startswith("'''")
        )

        comment_node = self.builder.comment(text, is_docstring=is_doc)

        # 设置位置
        # 注意：get_node_location 需要外部 import，这里假设你已经有这个工具函数
        # 如果没有，可以直接用 node.start_point (row, col)
        from codedmap.frontend.parsers.utils import get_node_location  # Ensure import

        try:
            loc = get_node_location(node)
            comment_node.line_number = loc["line_number"]
            comment_node.column_number = loc["column_number"]
            comment_node.offset_start = loc["offset_start"]
            comment_node.offset_end = loc["offset_end"]
        except:
            # Fallback if util fails
            comment_node.line_number = node.start_point[0] + 1
            comment_node.column_number = node.start_point[1] + 1
            comment_node.offset_start = node.start_byte
            comment_node.offset_end = node.end_byte

        comment_node.file_name = self.current_filename