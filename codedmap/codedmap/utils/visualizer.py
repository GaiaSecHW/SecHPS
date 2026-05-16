import os
from typing import List, Optional, Set, Dict, Any, Union
from collections import defaultdict

# 导入你的 Schema 定义
from codedmap.core.schema.graph import CPGGraph, CPGNode, AnyNode
from codedmap.core.schema.graph.edges import CPGEdge
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

class GraphVisualizer:
    """
    CPG 可视化调试工具 (Schema-Aware Version)。
    提供基于控制台的树状/列表视图，以及基于 Graphviz 的复杂图导出功能。
    """

    # --- 配置：边类型可视化样式 (颜色, 线型) ---
    _EDGE_STYLE_MAP = {
        # 基础结构
        "AST":          {"color": "black",     "style": "solid",  "weight": 1},
        "CONTAINS":     {"color": "gray",      "style": "dotted", "weight": 0},
        
        # 控制流
        "CFG":          {"color": "blue",      "style": "bold",   "weight": 2},
        
        # 依赖 (PDG)
        "CDG":          {"color": "orange",    "style": "dashed", "weight": 1},
        "DDG":          {"color": "darkgreen", "style": "solid",  "weight": 1},
        
        # 调用与引用
        "CALL":         {"color": "red",       "style": "solid",  "weight": 1},
        "REF":          {"color": "purple",    "style": "dashed", "weight": 0},
        "PARAMETER_LINK":{"color": "brown",    "style": "dotted", "weight": 0},
        
        # 其他
        "ARGUMENT":     {"color": "gray",      "style": "solid",  "weight": 1},
        "RECEIVER":     {"color": "gray",      "style": "dotted", "weight": 1},
    }

    # =========================================================================
    # 1. Console Views (AST & Call Graph)
    # =========================================================================

    @staticmethod
    def print_ast_tree(graph: CPGGraph, root_id: Optional[int] = None):
        """
        [Console] 打印 AST 树状结构。
        如果不指定 root_id，自动查找所有 FILE 和 METHOD 节点作为根进行打印。
        """
        if not graph.nodes:
            print("[Visualizer] Graph is empty.")
            return

        # 1. 确定根节点列表
        roots: List[AnyNode] = []
        if root_id is not None:
            node = graph.get_node_by_id(root_id)
            if node: roots = [node]
        else:
            # 自动查找根: FILE, METHOD, NAMESPACE_BLOCK
            target_labels = {NodeLabel.FILE.value, NodeLabel.METHOD.value, NodeLabel.NAMESPACE_BLOCK.value}
            for n in graph.nodes.values():
                if GraphVisualizer._safe_label(n) in target_labels:
                    # 简单的启发式：如果没有入边是 AST 类型的，或者是 FILE，则视为树根
                    in_edges = graph.get_in_edges(n.id)
                    is_child = any(GraphVisualizer._safe_type(e) == "AST" for e in in_edges)
                    if not is_child or GraphVisualizer._safe_label(n) == NodeLabel.FILE.value:
                        roots.append(n)
        
        if not roots:
            print("[Visualizer] No AST roots found.")
            return

        # 2. 构建 AST 邻接表 (父 -> 子列表)
        ast_children = defaultdict(list)
        for edge in graph.edges:
            if GraphVisualizer._safe_type(edge) == "AST":
                ast_children[edge.src].append(edge.dst)

        # 3. 递归打印
        # 按 ID 排序保证输出稳定
        roots.sort(key=lambda n: n.id)
        for root in roots:
            display_name = GraphVisualizer._get_node_display_text(root, is_root=True)
            print(f"\n--- AST Tree for {display_name} ---")
            GraphVisualizer._print_node_recursive(graph, root.id, ast_children, "", True)

    @staticmethod
    def print_call_graph(graph: CPGGraph):
        """
        [Console] 打印调用图 (Call Graph)。
        显示格式: Caller Method -> [CallSite] -> Callee Method
        """
        print("\n=== Call Graph (Caller -> Callee) ===")
        
        # 1. 识别所有 Method 节点
        methods = {n.id: n for n in graph.nodes.values() 
                   if GraphVisualizer._safe_label(n) == NodeLabel.METHOD.value}
        
        if not methods:
            print("No methods found.")
            return

        # 2. 建立 Method -> CallSite 的归属关系
        # 我们需要知道一个 CallNode 属于哪个 Method。通常通过 AST 父指针查找。
        callsite_owner = {} # call_id -> method_id
        
        # 构建 AST 父指针 map
        ast_parent = {}
        for edge in graph.edges:
            if GraphVisualizer._safe_type(edge) == "AST":
                ast_parent[edge.dst] = edge.src
        
        # 辅助函数：向上查找最近的 Method
        def find_parent_method(node_id):
            curr = node_id
            seen = {curr}
            while curr in ast_parent:
                curr = ast_parent[curr]
                if curr in seen: break # 防止环
                seen.add(curr)
                node = graph.nodes.get(curr)
                if node and GraphVisualizer._safe_label(node) == NodeLabel.METHOD.value:
                    return curr
            return None

        # 3. 收集调用关系
        # Map: Caller_ID -> List[(CallSiteNode, CalleeName)]
        call_relations = defaultdict(list)

        for edge in graph.edges:
            if GraphVisualizer._safe_type(edge) == "CALL":
                call_site_id = edge.src
                callee_method_id = edge.dst
                
                # 确定 Caller
                caller_method_id = find_parent_method(call_site_id)
                if caller_method_id:
                    call_site_node = graph.nodes.get(call_site_id)
                    callee_node = graph.nodes.get(callee_method_id)
                    
                    callee_name = "<unknown>"
                    if callee_node:
                        # 尝试获取全名
                        callee_name = getattr(callee_node, 'full_name', getattr(callee_node, 'name', ''))
                    
                    if not callee_name and hasattr(call_site_node, 'method_full_name'):
                        callee_name = call_site_node.method_full_name

                    call_relations[caller_method_id].append((call_site_node, callee_name))

        # 4. 打印
        sorted_method_ids = sorted(methods.keys())
        for m_id in sorted_method_ids:
            method = methods[m_id]
            display = GraphVisualizer._get_node_display_text(method, is_root=True)
            print(f"Function: {display}")
            
            calls = call_relations.get(m_id, [])
            if not calls:
                print("  (no outgoing calls)")
            else:
                # 按行号排序
                calls.sort(key=lambda x: (getattr(x[0], 'line_number', 0) or 0))
                for call_node, callee_name in calls:
                    line = getattr(call_node, 'line_number', '?') or '?'
                    code = GraphVisualizer._safe_get_code(call_node)
                    print(f"  -> calls {callee_name} (at line {line}: `{code}`)")

    # =========================================================================
    # 2. Graphviz DOT Exporters (Complex Graphs)
    # =========================================================================

    @staticmethod
    def export_dot(graph: CPGGraph, output_file: str = "cpg.dot", 
                   include_edges: Optional[Set[str]] = None,
                   exclude_nodes: Optional[Set[str]] = None):
        """
        [File] 导出 DOT 文件。
        
        Args:
            graph: CPGGraph 对象
            output_file: 输出路径
            include_edges: 包含的边类型集合 (e.g. {"CFG", "AST"}). None 表示全部。
            exclude_nodes: 排除的节点 Label 集合 (e.g. {"META_DATA", "FILE"}).
        """
        lines = []
        lines.append("digraph CPG {")
        lines.append('  node [shape=box, fontname="Consolas", fontsize=10, style="filled", fillcolor="white"];')
        lines.append('  edge [fontname="Consolas", fontsize=8];')
        lines.append('  compound=true;') # 允许复杂的子图连接
        
        # 记录实际出现的节点，避免画出孤立点（可选，这里暂不处理孤立点过滤）
        
        # 1. 绘制节点
        for node in graph.nodes.values():
            lbl = GraphVisualizer._safe_label(node)
            
            if exclude_nodes and lbl in exclude_nodes:
                continue

            # 获取显示文本
            display_text = GraphVisualizer._get_node_display_text(node)
            
            # 转义 DOT 特殊字符
            label_esc = display_text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\l')
            
            # 样式定制
            attrs = 'shape=box'
            fillcolor = 'white'
            
            if lbl == NodeLabel.METHOD.value:
                fillcolor = '#E3F2FD' # Light Blue
                attrs = 'shape=component'
            elif lbl == NodeLabel.CALL.value:
                fillcolor = '#F5F5F5' # Light Gray
            elif lbl == NodeLabel.BLOCK.value:
                fillcolor = '#FFF3E0' # Light Orange
            elif lbl == NodeLabel.CONTROL_STRUCTURE.value:
                fillcolor = '#FFF8E1' # Light Yellow
                attrs = 'shape=diamond'
            elif lbl == NodeLabel.LITERAL.value:
                fillcolor = '#E8F5E9' # Light Green
            elif lbl == NodeLabel.IDENTIFIER.value:
                attrs = 'shape=ellipse'
            elif lbl == NodeLabel.METHOD_RETURN.value:
                attrs = 'shape=Msquare'

            lines.append(f'  {node.id} [label="{label_esc}", fillcolor="{fillcolor}", {attrs}];')

        # 2. 绘制边
        for edge in graph.edges:
            etype = GraphVisualizer._safe_type(edge)

            # 过滤
            if include_edges and etype not in include_edges:
                continue
            
            # 检查节点是否被排除
            src_node = graph.get_node_by_id(edge.src)
            dst_node = graph.get_node_by_id(edge.dst)
            if not src_node or not dst_node: continue
            
            src_lbl = GraphVisualizer._safe_label(src_node)
            dst_lbl = GraphVisualizer._safe_label(dst_node)
            
            if exclude_nodes and (src_lbl in exclude_nodes or dst_lbl in exclude_nodes):
                continue

            # 样式
            style_cfg = GraphVisualizer._EDGE_STYLE_MAP.get(etype, {"color": "gray", "style": "solid"})
            color = style_cfg["color"]
            style = style_cfg["style"]
            
            # 边标签 (显示重要属性)
            edge_text = etype
            if "variable" in edge.properties:
                edge_text += f"\\n({edge.properties['variable']})"
            if "label" in edge.properties: # CFG True/False
                edge_text += f"\\n[{edge.properties['label']}]"
            if "argumentIndex" in edge.properties:
                edge_text += f"\\narg:{edge.properties['argumentIndex']}"
            
            lines.append(f'  {edge.src} -> {edge.dst} [label="{edge_text}", color="{color}", style="{style}", fontcolor="{color}"];')

        lines.append("}")
        
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            print(f"[Visualizer] DOT exported to: {os.path.abspath(output_file)}")
        except Exception as e:
            print(f"[Visualizer] Error exporting DOT: {e}")

    # =========================================================================
    # Helpers
    # =========================================================================

    @staticmethod
    def _safe_label(node: AnyNode) -> str:
        """安全获取 Label 字符串 (处理 Enum/str)"""
        if hasattr(node.label, 'value'): return node.label.value
        return str(node.label)

    @staticmethod
    def _safe_type(edge: CPGEdge) -> str:
        """安全获取 Edge Type 字符串"""
        if hasattr(edge.type, 'value'): return edge.type.value
        return str(edge.type)

    @staticmethod
    def _safe_get_code(node: AnyNode) -> str:
        """安全获取 Code，优先使用 get_code()"""
        code = ""
        # 1. 尝试 get_code 方法
        if hasattr(node, 'get_code') and callable(node.get_code):
            try: 
                code = node.get_code()
            except: 
                pass
        
        # 2. 尝试 code 属性
        if not code:
            val = getattr(node, 'code', None)
            if val is not None:
                code = str(val)
        
        return code or ""

    @staticmethod
    def _get_node_display_text(node: AnyNode, is_root: bool = False) -> str:
        """
        生成节点的显示文本。
        策略:
        - METHOD: fullName > name
        - FILE/TYPE/MEMBER: name
        - CALL/EXPR: code
        """
        label = GraphVisualizer._safe_label(node)
        
        # 策略 A: 结构性实体显示名称
        if label == NodeLabel.METHOD.value:
            # 优先 Full Name
            if hasattr(node, "full_name") and node.full_name:
                return f"[{label}] {node.full_name} (ID:{node.id})"
            if hasattr(node, "name") and node.name:
                return f"[{label}] {node.name} (ID:{node.id})"

        structural_labels = {
            NodeLabel.FILE.value, 
            NodeLabel.TYPE_DECL.value, 
            NodeLabel.MEMBER.value, 
            NodeLabel.NAMESPACE_BLOCK.value,
            NodeLabel.TAG.value
        }
        
        if label in structural_labels:
            name = getattr(node, "name", "<anon>")
            return f"[{label}] {name} (ID:{node.id})"

        # 策略 B: 语句/表达式显示代码
        code = GraphVisualizer._safe_get_code(node)
        code_display = code.replace('\n', '\\n')
        
        # 截断长代码 (仅针对非根节点)
        if not is_root and len(code_display) > 40:
            code_display = code_display[:37] + "..."
            
        return f"[{label}] {code_display} (ID:{node.id})"

    @staticmethod
    def _print_node_recursive(graph: CPGGraph, node_id: int, children_map: Dict, prefix: str, is_last: bool):
        node = graph.get_node_by_id(node_id)
        if not node: return

        display_text = GraphVisualizer._get_node_display_text(node)
        connector = "└── " if is_last else "├── "
        print(f"{prefix}{connector}{display_text}")

        children = children_map.get(node_id, [])
        # 过滤掉不在图中的子节点 ID
        children_nodes = []
        for cid in children:
            child_node = graph.get_node_by_id(cid)
            if child_node:
                children_nodes.append(child_node)
        
        # [Sort] 按照 order 排序，None 值当作 0 处理
        children_nodes.sort(key=lambda x: (getattr(x, 'order', None) or 0))
        sorted_children_ids = [n.id for n in children_nodes]

        new_prefix = prefix + ("    " if is_last else "│   ")
        
        for i, child_id in enumerate(sorted_children_ids):
            is_last_child = (i == len(sorted_children_ids) - 1)
            GraphVisualizer._print_node_recursive(graph, child_id, children_map, new_prefix, is_last_child)