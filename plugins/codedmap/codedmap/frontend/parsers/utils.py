# codedmap/frontend/parsers/utils.py
from typing import Optional
from tree_sitter import Node
import re
import os
from pathlib import Path

def clean_type_string(text: str) -> str:
    """[新增] 清洗类型字符串，去除多余空白和换行"""
    # 将连续的空白字符(包括换行)替换为单个空格，并去除首尾空格
    return re.sub(r'\s+', ' ', text).strip()

def get_node_text(node: Node, source_code: bytes) -> str:
    """提取节点的源代码文本"""
    return source_code[node.start_byte : node.end_byte].decode("utf8")

def get_node_location(node: Node):
    """提取行号信息 (Tree-sitter 是 0-based，Joern 通常习惯 1-based)"""
    return {
        "line_number": node.start_point[0] + 1,
        "column_number": node.start_point[1] + 1,
        "offset_start": node.start_byte,
        "offset_end": node.end_byte        
    }

def get_child_by_type(node: Node, type_name: str) -> Optional[Node]:
        """查找特定类型的直接子节点"""
        for child in node.children:
            if child.type == type_name:
                return child
        return None