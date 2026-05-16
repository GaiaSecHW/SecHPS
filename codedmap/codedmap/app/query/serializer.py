# codedmap/app/query/serializer.py
# Merged from features/slicing/serializer.py + features/export/subgraph.py

from typing import List, Dict, Any, Optional
from collections import defaultdict
import json
import logging

from codedmap.core.schema.graph import CPGGraph, CPGNode
from codedmap.core.schema.graph.nodes import MethodNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

logger = logging.getLogger(__name__)


class SliceSerializer:
    """
    将切片子图转换为 LLM Prompt 友好的文本格式。
    负责将离散的图节点重新组织为按文件、按行号排序的代码上下文。
    """

    @staticmethod
    def to_code_context(subgraph: CPGGraph) -> str:
        if not subgraph.nodes:
            return "Empty Slice."

        # 1. 准备数据结构
        lines_by_file: Dict[str, Dict[int, List[Any]]] = defaultdict(lambda: defaultdict(list))
        orphan_nodes = []

        # 2. 构建 AST 父子索引 (用于向上查找文件名)
        child_to_parent = {}
        for edge in subgraph.edges:
            if edge.type == EdgeType.AST or edge.type == EdgeType.AST.value:
                child_to_parent[edge.dst] = edge.src

        # 3. 遍历节点并分组
        for node in subgraph.nodes.values():
            code = ""
            try:
                code = node.get_code()
            except:
                pass
            if not code:
                code = f"<{node.label}>"

            node_info = {
                "id": node.id,
                "code": code,
                "label": node.label,
                "order": getattr(node, "order", -1)
            }

            filename = SliceSerializer._resolve_filename(node, subgraph, child_to_parent)

            line_num = getattr(node, 'line_number', None)
            if line_num is None:
                line_num = getattr(node, 'lineNumber', None)

            if filename and line_num:
                lines_by_file[filename][line_num].append(node_info)
            else:
                orphan_nodes.append(node_info)

        # 4. 拼接输出
        output = []

        for fname in sorted(lines_by_file.keys()):
            lines = lines_by_file[fname]
            output.append(f"--- File: {fname} ---")

            for line_num, nodes in sorted(lines.items()):
                nodes.sort(key=lambda x: x["order"])
                line_content = " ".join([f"⟪ID:{n['id']}⟫ {n['code']}" for n in nodes])
                output.append(f"{line_num:4d} | {line_content}")
            output.append("")

        if orphan_nodes:
            output.append("--- Structural/Synthetic Nodes (No Line Info) ---")
            orphan_nodes.sort(key=lambda x: x['id'])
            for n in orphan_nodes:
                output.append(f"⟪ID:{n['id']}⟫ <{n['label']}> {n['code']}")

        return "\n".join(output)

    @staticmethod
    def _resolve_filename(node: CPGNode, graph: CPGGraph, child_to_parent: Dict[int, int]) -> Optional[str]:
        """
        [Helper] 尝试找到节点所属的文件名。
        策略优先级：
        1. 向上遍历 AST 找到 FileNode (最准确)。
        2. 读取节点自身的 filename 属性 (降级)。
        """
        curr_id = node.id
        for _ in range(20):
            if curr_id in child_to_parent:
                parent_id = child_to_parent[curr_id]
                parent = graph.get_node_by_id(parent_id)
                if parent:
                    label_str = parent.label.value if hasattr(parent.label, 'value') else str(parent.label)
                    if label_str == "FILE" or label_str == NodeLabel.FILE.value:
                        return getattr(parent, 'name', None)
                    curr_id = parent_id
                else:
                    break
            else:
                break

        if hasattr(node, 'filename') and node.filename:
            return node.filename
        if hasattr(node, 'file_name') and node.file_name:
            return node.file_name
        if hasattr(node, 'fileName') and node.fileName:
             return node.fileName

        return None

    @staticmethod
    def to_graph_summary(subgraph: CPGGraph) -> str:
        """生成图结构的文本描述，包含 ID"""
        summary = ["Graph Structure:"]
        sorted_edges = sorted(subgraph.edges, key=lambda e: (e.src, e.dst, e.type))

        for edge in sorted_edges:
            src = subgraph.get_node_by_id(edge.src)
            dst = subgraph.get_node_by_id(edge.dst)
            if src and dst:
                src_lbl = src.label.value if hasattr(src.label, 'value') else src.label
                dst_lbl = dst.label.value if hasattr(dst.label, 'value') else dst.label
                summary.append(f"  [{edge.type}] {src_lbl}({src.id}) -> {dst_lbl}({dst.id})")
        return "\n".join(summary)


class SubgraphExporter:
    """
    [Service Layer] 子图导出工具 (Formatter).
    负责将 CPGGraph 对象转换为各种交换格式。
    不直接与数据库交互。
    """

    @staticmethod
    def export_json(graph: CPGGraph) -> Dict[str, Any]:
        """导出为 JSON 格式。"""
        return graph.model_dump(mode='json', by_alias=True)

    @staticmethod
    def export_dot(graph: CPGGraph) -> str:
        """导出为 Graphviz DOT 格式。"""
        lines = ["digraph G {", "  rankdir=LR;", "  node [shape=box, fontname=\"Courier\"];"]

        for n in graph.nodes.values():
            label = getattr(n, "name", getattr(n, "code", str(n.id)))
            label = str(label).replace('"', '\\"').replace('\n', '\\n')
            type_label = n.label.value if hasattr(n.label, 'value') else str(n.label)
            display = f"[{type_label}]\\n{label}"
            lines.append(f'  {n.id} [label="{display}"];')

        for edge in graph.edges:
            lines.append(f'  {edge.src} -> {edge.dst} [label="{edge.type}"];')

        lines.append("}")
        return "\n".join(lines)

    @staticmethod
    def export_for_llm(graph: CPGGraph) -> str:
        """
        [RAG 核心] 导出为 LLM 易读的代码切片摘要。
        """
        if not graph.nodes:
            return "No context provided."

        grouped = defaultdict(lambda: defaultdict(list))

        for n in graph.nodes.values():
            filename = getattr(n, "filename", "unknown_file")

            if isinstance(n, MethodNode):
                method_name = n.name
            else:
                method_name = getattr(n, "methodFullName", getattr(n, "method_name", "global"))

            grouped[filename][method_name].append(n)

        lines = ["Code Slice Context:", "=" * 20]

        for filename, methods in grouped.items():
            lines.append(f"File: {filename}")
            for method_name, node_list in methods.items():
                lines.append(f"  Function: {method_name}")

                sorted_nodes = sorted(node_list, key=lambda x: getattr(x, "lineNumber", 0) or 0)
                seen_code = set()

                for node in sorted_nodes:
                    code = getattr(node, "code", None)
                    line_num = getattr(node, "lineNumber", None)

                    if code and code not in seen_code:
                        prefix = f"    [Line {line_num}]" if line_num else "    [-]"
                        lines.append(f"{prefix} {code}")
                        seen_code.add(code)
            lines.append("-" * 10)

        return "\n".join(lines)
