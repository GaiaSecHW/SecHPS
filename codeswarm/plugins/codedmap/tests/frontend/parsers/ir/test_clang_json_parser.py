import sys
import os
import logging
from collections import defaultdict

# --- 环境设置 ---
sys.path.append(os.getcwd())

# 导入核心组件
from codedmap.core.graph_builder import CPGBuilder
from codedmap.frontend.parsers.source_code.c_parser import CParser
from codedmap.frontend.parsers.ir.clang_json_parser import ClangJSONParser
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType, ModifierType

# 配置日志
logging.basicConfig(level=logging.ERROR)  # 只看 Error，避免干扰输出


def print_separator(title):
    print(f"\n{'=' * 30} {title} {'=' * 30}")


def format_node_info(node):
    """
    格式化节点信息，展示所有关键元数据
    """
    # 1. 基础信息
    label = f"[{node.label}]"
    name = getattr(node, 'name', '') or ''

    # 2. 位置信息 (关键校验点)
    line = getattr(node, 'line_number', '?')
    off_start = getattr(node, 'offset_start', None)
    off_end = getattr(node, 'offset_end', None)

    loc_str = f"L:{line}"
    if off_start is not None and off_end is not None:
        loc_str += f" Offset:[{off_start}-{off_end}]"
    else:
        loc_str += " Offset: N/A"

    # 3. 代码与类型
    code = getattr(node, 'code', 'None')
    if code and len(code) > 30: code = code[:27] + "..."

    type_name = getattr(node, 'type_full_name', '')
    if not type_name: type_name = getattr(node, 'return_type_full_name', '')

    # 4. 修饰符 (IR Parser 特有)
    modifiers = []
    if hasattr(node, 'modifiers') and node.modifiers:
        # 假设 modifiers 是 ModifierNode 的列表或字符串列表
        # 这里简化处理，视具体实现而定
        pass

    info = f"{label:<15} {name:<20} | {loc_str:<30} | Type: {type_name:<15} | Code: {code}"
    return info


def print_ast_tree(graph, root_node, depth=0):
    """
    递归打印 AST 树
    """
    indent = "  " * depth
    print(f"{indent}{format_node_info(root_node)}")

    # 获取 AST 子节点
    children = []
    for e in graph.edges:
        if e.src == root_node.id and e.type == EdgeType.AST:
            child = graph.nodes.get(e.dst)
            if child: children.append(child)

    # 按 order 排序 (保证输出顺序与源码一致)
    children.sort(key=lambda x: getattr(x, 'order', 0) or 0)

    for child in children:
        print_ast_tree(graph, child, depth + 1)


def run_deep_compare(json_path, project_root, target_function="KeccakF1600Step"):
    """
    主对比函数
    """
    print_separator("LOADING GRAPHS")

    # 1. Load Source (Tree-sitter)
    print("Parsing Source Code (Tree-sitter)...")
    src_builder = CPGBuilder()
    src_parser = CParser(src_builder, project_root=project_root)
    # 假设 src-verify.c 在 project_root/tool/ 下，根据你的实际路径调整
    src_file_path = os.path.join(project_root, "tool", "src-verify.c")
    if not os.path.exists(src_file_path):
        # 尝试直接在 root 下找
        src_file_path = os.path.join(project_root, "src-verify.c")

    src_parser.parse_file(src_file_path)
    src_graph = src_builder.get_graph()

    # 2. Load IR (LibClang)
    print("Parsing IR JSON (LibClang)...")
    ir_builder = CPGBuilder()
    ir_parser = ClangJSONParser(ir_builder, project_root=project_root)
    ir_parser.parse_file(json_path)
    ir_graph = ir_builder.get_graph()

    # 3. 查找目标函数
    print_separator(f"DEEP INSPECTION: Function '{target_function}'")

    def find_method(graph, name):
        return next((n for n in graph.nodes.values()
                     if n.label == NodeLabel.METHOD and getattr(n, 'name', '') == name), None)

    src_method = find_method(src_graph, target_function)
    ir_method = find_method(ir_graph, target_function)

    # 4. 打印对比
    print(f"\n>>> SOURCE PARSER (Tree-sitter) Structure:")
    if src_method:
        print_ast_tree(src_graph, src_method)
    else:
        print(f"Method '{target_function}' not found in Source Graph.")

    print(f"\n>>> IR PARSER (LibClang) Structure:")
    if ir_method:
        print_ast_tree(ir_graph, ir_method)
    else:
        print(f"Method '{target_function}' not found in IR Graph.")

    # 5. 关键元数据校验 (Validation Checklist)
    print_separator("METADATA VALIDATION CHECK")

    if ir_method:
        print(f"Checking IR Method: {ir_method.name}")

        # Check A: File Name
        print(f"  [File Name]   : {getattr(ir_method, 'file_name', 'MISSING')}")

        # Check B: Offsets
        off_start = getattr(ir_method, 'offset_start', None)
        off_end = getattr(ir_method, 'offset_end', None)
        status = "OK" if (off_start is not None and off_end is not None) else "FAIL"
        print(f"  [Offsets]     : {off_start} - {off_end} ({status})")

        # Check C: Modifiers (Static?)
        # 查找连接到该 Method 的 Modifier 节点
        modifiers = []
        for e in ir_graph.edges:
            if e.dst == ir_method.id and e.type == EdgeType.AST:  # Modifier 通常是 AST 子节点
                child = ir_graph.nodes.get(e.src)  # 注意方向，视 schema 而定，通常 Modifier 是子节点
                # 这里假设 Modifier 是 AST 边挂在 Method 下
                pass

        # 简单检查是否有 static 局部变量
        locals = [n for n in ir_graph.nodes.values() if n.label == NodeLabel.LOCAL]
        static_locals = [l for l in locals if "static" in (getattr(l, 'code', '') or "")]
        print(f"  [Static Local]: Found {len(static_locals)} static locals globally.")
        if static_locals:
            print(f"    Sample: {static_locals[0].name} | Code: {static_locals[0].code}")

        # Check D: Enum Values (如果有)
        members = [n for n in ir_graph.nodes.values() if n.label == NodeLabel.MEMBER]
        print(f"  [Members]     : Found {len(members)} members (Fields/EnumConsts).")
        # 打印几个看看有没有赋值
        for m in members[:3]:
            print(f"    - {m.name} | Code: {getattr(m, 'code', 'N/A')}")


if __name__ == "__main__":
    # 配置你的路径
    JSON_PATH = r"/mnt/c/Users/d00647530/Desktop/atest/sqlite-ast/tool/src-verify.c_48069cc0.json"
    PROJECT_ROOT = r"/mnt/c/Users/d00647530/Desktop/atest/sqlite-master"

    # 建议测试 KeccakF1600Step (有复杂计算) 或 SHA1Update (有控制流)
    run_deep_compare(JSON_PATH, PROJECT_ROOT, "SHA1Update")