# codedmap/analysis/utils/code_cleaner.py

from typing import List, Set, Dict, Any
from codedmap.core.schema.graph.base import AstNode

class CodeSlicer:
    """
    [Utility] 将离散的 AST 节点重组为可读的代码切片。
    """
    
    @staticmethod
    def rebuild_slice(nodes: List[AstNode], highlight_lines: Set[int] = None) -> str:
        """
        输入: 一堆无序的 AST 节点 (来自 DDG/CDG 遍历)。
        输出: 按行号排序、去重、并标注关键行的代码文本。
        """
        if not nodes: return ""
        
        # 1. 去重与清洗
        # 过滤掉没有行号或代码内容的节点
        valid_nodes = []
        seen_lines = set()
        
        # 按行号排序，保证阅读顺序
        sorted_nodes = sorted(
            [n for n in nodes if getattr(n, 'line_number', None) is not None],
            key=lambda x: x.line_number
        )

        lines_buffer = []
        
        for node in sorted_nodes:
            line_num = node.line_number
            code = getattr(node, 'code', '').strip()
            
            # 简单的去重策略：同一行只保留第一个出现的节点代码 
            # (通常 AST 遍历会返回父节点和子节点，父节点通常包含完整行的代码)
            if line_num in seen_lines:
                continue
            
            if not code: continue

            seen_lines.add(line_num)
            
            # 2. 格式化
            prefix = ""
            if highlight_lines and line_num in highlight_lines:
                prefix = ">> " # 高亮关键节点
            else:
                prefix = "   "
            
            lines_buffer.append(f"{line_num:4d} | {prefix}{code}")

        # 3. 添加省略号 (Visual Gap)
        # 如果行号跳跃太大 (如从 10 行直接跳到 50 行)，插入 "..."
        final_output = []
        prev_line = -1
        
        for i, line_str in enumerate(lines_buffer):
            # 解析回行号 (这有点hacky，但在纯文本处理中很有效)
            current_line = int(line_str.split('|')[0])
            
            if prev_line != -1 and (current_line - prev_line > 1):
                final_output.append("   ... | ...")
            
            final_output.append(line_str)
            prev_line = current_line

        return "\n".join(final_output)