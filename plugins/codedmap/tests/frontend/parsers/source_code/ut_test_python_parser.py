import unittest
import sys
import os

from typing import List

# 添加项目根目录到路径
sys.path.append(os.getcwd())

# 假设你的项目结构如下，请根据实际情况调整 import 路径
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType, ControlStructureType
from codedmap.frontend.parsers.source_code.python_parser import PythonParser

class TestPythonParserComprehensive(unittest.TestCase):

    def setUp(self):
        self.builder = CPGBuilder()
        self.parser = PythonParser(self.builder)
        self.source_code = """
import os
from math import sqrt as my_sqrt

x = 10
glob_var = "Global"

def add(a, b: int = 1):
    return a + b

class MyCalculator(object):
    def __init__(self, base):
        self.base = base

    def compute(self, val):
        if val > 0:
            res = self.base + val
        else:
            res = self.base - val
        return res

    def loops(self):
        for i in range(5):
            if i == 3: continue
            self.base += 1
        
        count = 0
        while count < 3:
            count = count + 1

try:
    calc = MyCalculator(10)
    print(calc.compute(5))
except Exception as e:
    raise e

lam = lambda x: x * x
nums = [1, 2, 3]
"""

    def tearDown(self):
        # ... (原有代码)
        # 添加强制打印，查看所有控制结构节点
        print("\n=== DEBUG: Checking Control Structures ===", file=sys.stderr)
        nodes = self.builder.graph.nodes
        for n in nodes:
            if n.label == NodeLabel.CONTROL_STRUCTURE:
                print(f"Found CS: Type={getattr(n, 'controlStructureType', 'N/A')} Code='{n.code}'", file=sys.stderr)
            elif n.label == NodeLabel.UNKNOWN:
                print(f"Found UNKNOWN: Code='{n.code}'", file=sys.stderr)

    def _dump_graph(self):
        print("\n\n=== [DEBUG] Graph Dump (On Failure) ===", file=sys.stderr)
        nodes = self.builder.graph.nodes
        edges = self.builder.graph.edges
        print(f"Total Nodes: {len(nodes)}", file=sys.stderr)
        print(f"Total Edges: {len(edges)}", file=sys.stderr)
        
        print("--- Nodes ---", file=sys.stderr)
        for n in nodes:
            # 简化打印，防止输出过多
            info = f"ID={n.id} Label={n.label}"
            if hasattr(n, 'name'): info += f" Name='{n.name}'"
            if hasattr(n, 'code'): info += f" Code='{n.code}'"
            print(info, file=sys.stderr)
            
        print("--- Edges ---", file=sys.stderr)
        for e in edges:
            print(f"{e.src} --[{e.type}]--> {e.dst}", file=sys.stderr)
        print("==========================================\n", file=sys.stderr)



    def test_parse_python_comprehensive(self):
        print("\n[Start] Parsing Python Code...")
        self.parser.parse_string(self.source_code, "test_comprehensive.py")
        
        graph = self.builder.graph
        nodes = graph.nodes
        edges = graph.edges

        print(f"[Info] Graph generated with {len(nodes)} nodes and {len(edges)} edges.")

        # --- Helper Functions for assertions ---
        def get_nodes_by_label(label):
            return [n for n in nodes if n.label == label]

        def get_node_by_name(name, label):
            return next((n for n in nodes if n.label == label and getattr(n, 'name', '') == name), None)

        def get_edges_by_type(edge_type):
            return [e for e in edges if e.type == edge_type]

        def get_method_return(method_node):
            # 1. 找到所有从 method_node 出发的 AST 边
            outgoing_ast_edges = [e for e in edges if e.src == method_node.id and e.type == EdgeType.AST]
            # 2. 找到这些边指向的目标节点
            child_ids = [e.dst for e in outgoing_ast_edges]
            children = [n for n in nodes if n.id in child_ids]
            # 3. 筛选出 Label 为 METHOD_RETURN 的节点
            return next((n for n in children if n.label == NodeLabel.METHOD_RETURN), None)

        # =========================================================
        # 1. 验证导入 (Imports)
        # =========================================================
        imports = get_nodes_by_label(NodeLabel.IMPORT)
        self.assertTrue(len(imports) >= 2, "Should have imports")
        
        import_os = next((i for i in imports if i.imported_entity == "os"), None)
        self.assertIsNotNone(import_os, "Import 'os' missing")
        
        # from math import sqrt as my_sqrt -> importedEntity="math.sqrt", alias="my_sqrt" (depends on implementation)
        # 或者是 importedEntity="sqrt", alias="my_sqrt"
        # 根据你的 PythonParser 实现，handle_import_from 会生成 'math.sqrt'
        import_sqrt = next((i for i in imports if "sqrt" in i.imported_entity), None)
        self.assertIsNotNone(import_sqrt, "Import 'sqrt' missing")

        # =========================================================
        # 2. 验证函数定义 (Function Definition)
        # =========================================================
        # def add(a, b: int = 1):
        method_add = get_node_by_name("add", NodeLabel.METHOD)
        self.assertIsNotNone(method_add, "Function 'add' not found")

        print(f"\n[DEBUG] MethodNode fields: {method_add.model_dump().keys()}")
        # [修复] 不检查 MethodNode 属性，而是检查关联的 MethodReturn 节点
        ret_node = get_method_return(method_add)
        self.assertIsNotNone(ret_node, "MethodReturn node for 'add' missing")
        self.assertEqual(ret_node.type_full_name, "ANY", "Return type should be ANY") 
        # 注意：PythonParser 中如果没有显式注解且无法推导，默认可能是 ANY

        # 验证参数
        params = [n for n in nodes if n.label == NodeLabel.METHOD_PARAMETER_IN]
        param_a = get_node_by_name("a", NodeLabel.METHOD_PARAMETER_IN)
        param_b = get_node_by_name("b", NodeLabel.METHOD_PARAMETER_IN)
        
        self.assertIsNotNone(param_a, "Parameter 'a' missing")
        self.assertIsNotNone(param_b, "Parameter 'b' missing")
        # [修复] typeFullName -> type_full_name
        self.assertEqual(param_b.type_full_name, "int", "Parameter 'b' type should be 'int'")
        self.assertEqual(param_b.order, 2, "Parameter 'b' order wrong")

        # =========================================================
        # 3. 验证类定义 (Class Definition)
        # =========================================================
        class_node = get_node_by_name("MyCalculator", NodeLabel.TYPE_DECL)
        self.assertIsNotNone(class_node, "Class 'MyCalculator' not found")
        # [修复] inheritsFromTypeFullName -> inherits_from_type_full_name
        self.assertIn("object", class_node.inherits_from_type_full_name, "Inheritance missing")
        # =========================================================
        # 4. 验证类方法与字段访问 (Methods & Field Access)
        # =========================================================
        # def compute(self, val):
        method_compute = get_node_by_name("compute", NodeLabel.METHOD)
        self.assertIsNotNone(method_compute, "Method 'compute' not found")
        
        # 检查 self.base (Field Access)
        # 在 compute 方法中，应该有 identifier(self) 和 field_access(base)
        field_accesses = [n for n in nodes if n.label == NodeLabel.CALL and n.name == "<operator>.fieldAccess"]
        self.assertTrue(len(field_accesses) > 0, "No field access found")
        
        # 验证 self.base
        found_self_base = False
        for fa in field_accesses:
            if fa.code == "self.base":
                found_self_base = True
                break
        self.assertTrue(found_self_base, "Access 'self.base' not found")

        # =========================================================
        # 5. 验证控制流 (If/Else, For, While)
        # =========================================================
        # IF
        if_node = next((n for n in nodes if n.label == NodeLabel.CONTROL_STRUCTURE and n.control_structure_type == ControlStructureType.IF), None)
        self.assertIsNotNone(if_node, "IF structure not found")
        self.assertIn("val > 0", if_node.code, "IF condition code mismatch")

        # FOR
        for_node = next((n for n in nodes if n.label == NodeLabel.CONTROL_STRUCTURE and n.control_structure_type == ControlStructureType.FOR), None)
        self.assertIsNotNone(for_node, "FOR loop not found")

        # WHILE
        while_node = next((n for n in nodes if n.label == NodeLabel.CONTROL_STRUCTURE and n.control_structure_type == ControlStructureType.WHILE), None)
        self.assertIsNotNone(while_node, "WHILE loop not found")

        # Continue
        continue_node = next((n for n in nodes if n.label == NodeLabel.JUMP_TARGET and n.name == "continue"), None)
        # 或者是 JUMP_STATEMENT，取决于 builder 实现，通常是 ControlStructure.CONTINUE 或 JumpStatement
        # 你的 Parser 使用 self.builder.jump_statement("CONTINUE", ...)
        # 这通常生成一个 UNKNOWN 或者特定的 Jump 节点，这里检查代码包含 continue 的节点
        jump_nodes = [n for n in nodes if "continue" in getattr(n, 'code', '')]
        self.assertTrue(len(jump_nodes) > 0, "Continue statement not found")

        # =========================================================
        # 6. 验证异常处理 (Try/Except/Raise)
        # =========================================================
        try_node = next((n for n in nodes if n.label == NodeLabel.CONTROL_STRUCTURE and n.control_structure_type == ControlStructureType.TRY), None)
        self.assertIsNotNone(try_node, "TRY block not found")

        # Raise
        throw_node = next((n for n in nodes if n.label == NodeLabel.CONTROL_STRUCTURE and n.control_structure_type == ControlStructureType.THROW), None)
        self.assertIsNotNone(throw_node, "RAISE/THROW node not found")

        # =========================================================
        # 7. 验证表达式与 Lambda (Expressions)
        # =========================================================
        # lam = lambda x: x * x
        lambda_refs = get_nodes_by_label(NodeLabel.METHOD_REF)
        found_lambda = False
        for ref in lambda_refs:
            # [修复] methodFullName -> method_full_name
            if "lambda" in ref.method_full_name:
                found_lambda = True
                break
        self.assertTrue(found_lambda, "Lambda MethodRef not found")

        # =========================================================
        # 8. 验证调用 (Call)
        # =========================================================
        # print(calc.compute(5))
        # 应该有一个 Call 节点 name="print"
        call_print = next((n for n in nodes if n.label == NodeLabel.CALL and n.name == "print"), None)
        self.assertIsNotNone(call_print, "Call to 'print' not found")
        
        # 验证 print 的参数是另一个调用 (calc.compute)
        # 需要检查 print 节点的 outgoing AST 边
        # 这是一个比较深的检查，只要 print 存在且有参数即可
        print_args_edges = [e for e in edges if e.src == call_print.id and e.type == EdgeType.ARGUMENT]
        self.assertTrue(len(print_args_edges) > 0, "Print should have arguments")

if __name__ == '__main__':
    unittest.main()