#codedmap/frontend/parsers/source_code/python_parser.py

import tree_sitter_python
from tree_sitter import Language, Node
from typing import Optional, Any, Dict, Callable

from .base import SourceCodeParser
from codedmap.frontend.parsers.utils import get_node_text, get_node_location
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.operators import Operators
from codedmap.core.schema.graph.nodes import AstNode
from codedmap.core.schema.graph.enums import ControlStructureType, EdgeType, Language


class PythonCodeParser(SourceCodeParser):
    def __init__(self, builder: CPGBuilder, project_root: str = None):
        try:
            lang_ptr = tree_sitter_python.language()
            lang = Language(lang_ptr)
        except:
            lang = Language(tree_sitter_python.language())
        super().__init__(builder, lang, Language.PYTHON, project_root)

        # [架构核心] 分发映射表
        # 将节点类型映射到处理函数，实现 O(1) 查找，消除巨型 if-else
        self._dispatch_table: Dict[str, Callable] = {
            # --- 根与块结构 ---
            "module": lambda n, **k: self._visit_children(n),
            "block": self.handle_block,              # 处理缩进块
            
            # --- 包装结构 (else, except, finally) ---
            "else_clause": self.handle_wrapper,      
            "elif_clause": self.handle_if,           # elif 结构与 if 相同
            "except_clause": self.handle_wrapper,    
            "finally_clause": self.handle_wrapper,

            # --- 定义 ---
            "function_definition": self.handle_function_definition,
            "class_definition": self.handle_class_definition,
            "decorated_definition": self.handle_decorated_definition,
            
            # --- 导入 ---
            "import_statement": self.handle_import,
            "import_from_statement": self.handle_import_from,

            # --- 语句 ---
            "expression_statement": self.handle_expression_statement,
            "assignment": self.handle_assignment,
            "augmented_assignment": self.handle_augmented_assignment,
            "return_statement": self.handle_return,
            "raise_statement": self.handle_raise,
            "assert_statement": self.handle_assert,
            "pass_statement": lambda n, **k: None, 
            "break_statement": lambda n, **k: self.builder.jump_statement("BREAK", "break", **k),
            "continue_statement": lambda n, **k: self.builder.jump_statement("CONTINUE", "continue", **k),

            # --- 控制流 ---
            "if_statement": self.handle_if,
            "for_statement": self.handle_for,
            "while_statement": self.handle_while,
            "try_statement": self.handle_try,

            # --- 表达式 ---
            "call": self.handle_call,
            "binary_operator": self.handle_binary_operator,
            "unary_operator": self.handle_unary_operator,
            "boolean_operator": self.handle_boolean_operator, 
            "not_operator": self.handle_unary_operator,       
            "comparison_operator": self.handle_comparison,
            "attribute": self.handle_attribute,
            "subscript": self.handle_subscript,
            "identifier": self.handle_identifier,
            "lambda": self.handle_lambda,
            "parenthesized_expression": self.handle_parenthesized,

            # --- 字面量 ---
            "string": self.handle_literal,
            "integer": self.handle_literal,
            "float": self.handle_literal,
            "true": self.handle_literal,
            "false": self.handle_literal,
            "none": self.handle_literal,
            "list": self.handle_collection_literal,
            "tuple": self.handle_collection_literal,
            "set": self.handle_collection_literal,
            "dictionary": self.handle_dictionary_literal,
            "comment": self.handle_comment,
        }

    # ==========================================================
    # 核心遍历逻辑
    # ==========================================================

    def run(self, filename: str, root_node: Node, source_code: bytes):
        self.source_code = source_code
        ns_name = filename.split("/")[-1].rsplit(".", 1)[0]
        
        with self.builder.file(filename, language=self._language_enum) as file_node:
            with self.builder.namespace_block(ns_name) as ns:
                self._visit_children(root_node)

    def _visit_children(self, node: Node):
        """遍历子节点并维护 order"""
        child_order = 1
        for child in node.children:
            # if child.type == "comment": continue
            
            result = self.visit(child, attach_to_parent=True)
            
            nodes_to_order = []
            if isinstance(result, list):
                nodes_to_order = result
            elif result:
                nodes_to_order = [result]

            for cpg_node in nodes_to_order:
                if isinstance(cpg_node, AstNode) and cpg_node.order is None:
                    cpg_node.order = child_order
                    child_order += 1

    def _set_loc(self, cpg_node: Any, ts_node: Node):
        if hasattr(cpg_node, "line_number"):
            loc = get_node_location(ts_node)
            cpg_node.line_number = loc["line_number"]
            cpg_node.column_number = loc["column_number"]
        return cpg_node
    
    def _set_order(self, node: Optional[AstNode], order: int):
        if node and isinstance(node, AstNode):
            node.order = order

    def visit(self, node: Node, attach_to_parent: bool = True) -> Optional[Any]:
        if not node: return None
        node_type = node.type
        kwargs = {"auto_ast": attach_to_parent}

        # [防御性] 强制拦截 Identifier，防止被误判为 Literal
        if node_type == "identifier":
            return self.handle_identifier(node, **kwargs)

        # [核心] 查表分发
        handler = self._dispatch_table.get(node_type)
        if handler:
            if 'kwargs' in handler.__code__.co_varnames:
                return handler(node, **kwargs)
            else:
                return handler(node)

        # 兜底逻辑：未知节点转为 Unknown Statement
        if attach_to_parent:
            code = get_node_text(node, self.source_code)
            return self._set_loc(self.builder.unknown_statement(code, auto_ast=True), node)
        
        return None

    # ==========================================================
    # 结构处理 (Blocks & Wrappers)
    # ==========================================================

    def handle_block(self, node: Node, **kwargs):
        """处理缩进块，确保递归访问内部语句"""
        with self.builder.block(get_node_text(node, self.source_code)) as block_node:
            self._set_loc(block_node, node)
            self._visit_children(node)
        return block_node

    def handle_wrapper(self, node: Node, **kwargs):
        """
        处理 else, except, finally 等包装节点。
        自动查找内部的 block 并提升访问。
        """
        # 1. 尝试标准字段
        body = node.child_by_field_name("body")
        
        # 2. 兜底查找 block (针对 except/finally)
        if not body:
            for child in node.children:
                if child.type == "block":
                    body = child; break
        
        if body:
            return self.visit(body, attach_to_parent=kwargs.get("auto_ast", True))
        return None

    # ==========================================================
    # Definitions (定义)
    # ==========================================================

    def handle_function_definition(self, node: Node):
        name_node = node.child_by_field_name("name")
        params_node = node.child_by_field_name("parameters")
        body_node = node.child_by_field_name("body")
        return_type_node = node.child_by_field_name("return_type")

        name = get_node_text(name_node, self.source_code)
        code = get_node_text(node, self.source_code)
        
        ret_type = "ANY"
        if return_type_node:
            ret_type = get_node_text(return_type_node, self.source_code)

        prefix = self.builder._get_scope_prefix()
        # full_name = prefix + name 
        signature = f"{ret_type} {name}(...)"

        with self.builder.method(name, signature=signature, code=code, return_type_full_name=ret_type) as method:
            self._set_loc(method, node)
            if params_node: self._handle_parameters(params_node)
            if body_node: self._visit_children(body_node)
        
        return method

    def _handle_parameters(self, params_node: Node):
        param_order = 1
        for child in params_node.children:
            if child.type in ["(", ")", ",", "comment"]: continue
            
            p_name = "anonymous"
            p_type = "ANY"
            real_param = child

            # 解析各类参数格式
            if child.type == "default_parameter": 
                real_param = child.child_by_field_name("name")
            elif child.type == "typed_parameter":
                real_param = child.child_by_field_name("name")
                type_n = child.child_by_field_name("type")
                if type_n: p_type = get_node_text(type_n, self.source_code)
            elif child.type == "typed_default_parameter":
                real_param = child.child_by_field_name("name")
                type_n = child.child_by_field_name("type")
                if type_n: p_type = get_node_text(type_n, self.source_code)
            elif child.type == "list_splat_pattern": # *args
                real_param = child.children[1] 
            elif child.type == "dictionary_splat_pattern": # **kwargs
                real_param = child.children[2]

            if real_param: p_name = get_node_text(real_param, self.source_code)
            
            p_node = self.builder.parameter(p_name, p_type, order=param_order)
            self._set_loc(p_node, child)
            param_order += 1

    def handle_class_definition(self, node: Node):
        name_node = node.child_by_field_name("name")
        body_node = node.child_by_field_name("body")
        superclasses_node = node.child_by_field_name("superclasses")

        name = get_node_text(name_node, self.source_code)
        full_name = self.builder._get_scope_prefix() + name
        
        bases = []
        if superclasses_node:
            for child in superclasses_node.children:
                if child.type not in ["(", ")", ","]:
                    bases.append(get_node_text(child, self.source_code))

        with self.builder.type_decl(name, full_name, inherits=bases) as type_decl:
            self._set_loc(type_decl, node)
            if body_node: self._visit_children(body_node)
        return type_decl

    def handle_decorated_definition(self, node: Node):
        definition = node.child_by_field_name("definition")
        return self.visit(definition, attach_to_parent=True)

    # ==========================================================
    # Imports
    # ==========================================================
    
    def handle_import(self, node: Node):
        for child in node.children:
            if child.type == "dotted_name": 
                name = get_node_text(child, self.source_code)
                self._set_loc(self.builder.add_import(name), node)
            elif child.type == "aliased_import":
                self._handle_aliased_import(child)
    
    def handle_import_from(self, node: Node):
        module_name_node = node.child_by_field_name("module_name")
        module_name = get_node_text(module_name_node, self.source_code) if module_name_node else ""
        
        if not module_name_node: # 相对导入处理
            relative_dots = [c for c in node.children if c.type == "."]
            if relative_dots: module_name = "." * len(relative_dots)

        for child in node.children:
            if child.type == "dotted_name":
                name = get_node_text(child, self.source_code)
                full_import = f"{module_name}.{name}" if module_name else name
                self._set_loc(self.builder.add_import(full_import), child)
            elif child.type == "aliased_import":
                 name_node = child.child_by_field_name("name")
                 alias_node = child.child_by_field_name("alias")
                 if name_node:
                    entity = get_node_text(name_node, self.source_code)
                    full = f"{module_name}.{entity}" if module_name else entity
                    alias = get_node_text(alias_node, self.source_code) if alias_node else None
                    self._set_loc(self.builder.add_import(full, alias=alias), child)

    def _handle_aliased_import(self, node: Node):
        name_node = node.child_by_field_name("name")
        alias_node = node.child_by_field_name("alias")
        name = get_node_text(name_node, self.source_code)
        alias = get_node_text(alias_node, self.source_code)
        self._set_loc(self.builder.add_import(name, alias=alias), node)

    # ==========================================================
    # Statements & Control Flow
    # ==========================================================

    def handle_expression_statement(self, node: Node, **kwargs):
        # 检查是否为 Docstring: 
        # 1. 只有唯一子节点且是 string
        # 2. 它是 Block 的第一个语句 (可以通过 check parent & sibling 判断，这里简化处理)
        if node.child_count == 1 and node.children[0].type == "string":
            text = get_node_text(node.children[0], self.source_code)
            # 简单的启发式：三引号开头
            if text.startswith('"""') or text.startswith("'''"):
                # 将其作为特殊的 Docstring Comment 处理
                comment_node = self.builder.comment(text, is_docstring=True, **kwargs)
                return self._set_loc(comment_node, node)

        # 原有逻辑
        if len(node.children) > 0:
            return self.visit(node.children[0], attach_to_parent=kwargs.get("auto_ast", True))
        return None

    def handle_assignment(self, node: Node, **kwargs):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        
        rhs_cpg = self.visit(right, attach_to_parent=False)
        if not rhs_cpg: rhs_cpg = self.builder.literal("UNKNOWN", "UNKNOWN", auto_ast=False)

        lhs_cpg = self._process_lhs(left)
        assign = self.builder.assignment(lhs_cpg, rhs_cpg, get_node_text(node, self.source_code), **kwargs)
        return self._set_loc(assign, node)

    def _process_lhs(self, node: Node):
        """处理左值，自动创建 Local 定义"""
        if node.type == "identifier":
            name = get_node_text(node, self.source_code)
            if not self.builder._resolve_symbol(name):
                 self.builder.local_variable(name, "ANY", code=f"{name}")
            return self.builder.identifier(name, "ANY", auto_ast=False)
        elif node.type == "attribute": return self.handle_attribute(node, auto_ast=False)
        elif node.type == "subscript": return self.handle_subscript(node, auto_ast=False)
        return self.builder.literal(get_node_text(node, self.source_code), "UNKNOWN", auto_ast=False)

    def handle_augmented_assignment(self, node: Node, **kwargs):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        op_text = get_node_text(node.child_by_field_name("operator"), self.source_code)
        op_map = { "+=": Operators.assignmentPlus, "-=": Operators.assignmentMinus, "*=": Operators.assignmentMultiplication, "/=": Operators.assignmentDivision }
        joern_op = op_map.get(op_text, Operators.assignment)
        
        lhs = self._process_lhs(left)
        rhs = self.visit(right, attach_to_parent=False)
        return self.builder.call(name=joern_op, method_full_name=joern_op, args=[lhs, rhs], code=get_node_text(node, self.source_code), **kwargs)

    def handle_return(self, node: Node):
        expr = node.children[1] if len(node.children) > 1 else None
        ret_node = self.builder.return_statement(code=None)
        self._set_loc(ret_node, node)
        
        if expr:
            val_cpg = self.visit(expr, attach_to_parent=False)
            if val_cpg:
                val_cpg.order = 1
                self.builder.graph.add_ast_edge(ret_node, val_cpg)
                self.builder.graph.add_edge(ret_node, val_cpg, EdgeType.ARGUMENT) # Return ARGUMENT
        return ret_node
    
    def handle_raise(self, node: Node, **kwargs):
        """处理 raise 语句，必须使用上下文管理器"""
        with self.builder.control_structure(ControlStructureType.THROW, get_node_text(node, self.source_code), **kwargs) as n:
            self._set_loc(n, node)
            for child in node.children:
                if child.type not in ["raise", "comment"]: self.visit(child)
            return n

    def handle_assert(self, node: Node, **kwargs):
        return self.builder.call("assert", "<operator>.assert", [], get_node_text(node, self.source_code), **kwargs)

    def handle_if(self, node: Node):
        cond = node.child_by_field_name("condition")
        cons = node.child_by_field_name("consequence")
        alt = node.child_by_field_name("alternative")
        with self.builder.control_structure(ControlStructureType.IF, get_node_text(node, self.source_code)) as if_n:
            self._set_loc(if_n, node)
            if cond: self._set_order(self.visit(cond), 1)
            if cons: self._set_order(self.visit(cons), 2)
            if alt: self._set_order(self.visit(alt), 3)
        return if_n

    def handle_for(self, node: Node):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        body = node.child_by_field_name("body")
        with self.builder.control_structure(ControlStructureType.FOR, get_node_text(node, self.source_code)) as for_n:
            self._set_loc(for_n, node)
            if left and right:
                l = self._process_lhs(left)
                r = self.visit(right, attach_to_parent=False)
                in_call = self.builder.call("IN", "IN", [l, r], f"{l.name} in ...")
                self._set_order(in_call, 1)
            if body: self._set_order(self.visit(body), 2)
        return for_n

    def handle_while(self, node: Node):
        cond = node.child_by_field_name("condition")
        body = node.child_by_field_name("body")
        with self.builder.control_structure(ControlStructureType.WHILE, get_node_text(node, self.source_code)) as while_n:
            self._set_loc(while_n, node)
            if cond: self._set_order(self.visit(cond), 1)
            if body: self._set_order(self.visit(body), 2)
        return while_n
    
    def handle_try(self, node: Node):
        # 优化后：直接遍历子节点，依赖 dispatch table 处理 body (block) 和 except/finally
        body = node.child_by_field_name("body")
        with self.builder.control_structure(ControlStructureType.TRY, "try") as try_n:
            self._set_loc(try_n, node)
            # Body 是第一个 AST 子节点
            if body: self._set_order(self.visit(body), 1)
            
            # 遍历后续子节点 (except, finally 等)
            order = 2
            for child in node.children:
                if child.type in ["except_clause", "finally_clause"]:
                     c = self.visit(child)
                     self._set_order(c, order)
                     order += 1
        return try_n

    # ==========================================================
    # Expressions
    # ==========================================================

    def handle_call(self, node: Node, **kwargs):
        func = node.child_by_field_name("function")
        args = node.child_by_field_name("arguments")
        func_name = get_node_text(func, self.source_code)
        
        arg_exprs = []
        if args:
            for child in args.children:
                if child.type in ["(", ")", ",", "comment"]: continue
                val = child.child_by_field_name("value") if child.type == "keyword_argument" else child
                c = self.visit(val, attach_to_parent=False)
                if c: arg_exprs.append(c)
        
        call_n = self.builder.call(
            name=func_name, method_full_name=func_name, args=arg_exprs, 
            code=get_node_text(node, self.source_code), receiver=None, **kwargs
        )
        return self._set_loc(call_n, node)

    def handle_binary_operator(self, node: Node, **kwargs):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        op_text = get_node_text(node.child_by_field_name("operator"), self.source_code)
        op_map = { "+": Operators.addition, "-": Operators.subtraction, "*": Operators.multiplication, "/": Operators.division, "%": Operators.modulo }
        joern_op = op_map.get(op_text, f"<operator>.{op_text}")
        return self.builder.binary_op(self.visit(left, attach_to_parent=False), self.visit(right, attach_to_parent=False), joern_op, get_node_text(node, self.source_code), **kwargs)

    def handle_unary_operator(self, node: Node, **kwargs):
        op = node.child_by_field_name("operator")
        arg = node.child_by_field_name("argument")
        op_text = get_node_text(op, self.source_code)
        joern_op = Operators.logicalNot if op_text == "not" else f"<operator>.{op_text}"
        return self.builder.unary_op(self.visit(arg, attach_to_parent=False), joern_op, get_node_text(node, self.source_code), **kwargs)

    def handle_boolean_operator(self, node: Node, **kwargs):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        op_text = get_node_text(node.child_by_field_name("operator"), self.source_code)
        joern_op = Operators.logicalAnd if op_text == "and" else Operators.logicalOr
        return self.builder.binary_op(self.visit(left, attach_to_parent=False), self.visit(right, attach_to_parent=False), joern_op, get_node_text(node, self.source_code), **kwargs)

    def handle_comparison(self, node: Node, **kwargs):
        return self.builder.literal(get_node_text(node, self.source_code), "BOOL", **kwargs)

    def handle_attribute(self, node: Node, **kwargs):
        obj = node.child_by_field_name("object")
        attr = node.child_by_field_name("attribute")
        base = self.visit(obj, attach_to_parent=False)
        field = get_node_text(attr, self.source_code)
        return self.builder.field_access(base, field, get_node_text(node, self.source_code), **kwargs)

    def handle_subscript(self, node: Node, **kwargs):
        val = node.child_by_field_name("value")
        sub = node.child_by_field_name("subscript")
        return self.builder.index_access(self.visit(val, attach_to_parent=False), self.visit(sub, attach_to_parent=False), get_node_text(node, self.source_code))

    def handle_identifier(self, node: Node, **kwargs):
        name = get_node_text(node, self.source_code)
        return self._set_loc(self.builder.identifier(name, "ANY", **kwargs), node)

    def handle_literal(self, node: Node, **kwargs):
        text = get_node_text(node, self.source_code)
        type_name = "ANY"
        if node.type == "string": type_name = "str"
        elif node.type == "integer": type_name = "int"
        elif node.type == "float": type_name = "float"
        elif node.type in ["true", "false"]: type_name = "bool"
        return self._set_loc(self.builder.literal(text, type_name, **kwargs), node)

    def handle_comment(self, node: Node, **kwargs):
        """
        处理 Python 注释 (# ...)
        注意：Python 的 Docstrings (文档字符串) 在 Tree-sitter 中通常被解析为 
        expression_statement -> string，不走这里。这里只处理 # 开头的注释。
        """
        text = get_node_text(node, self.source_code)
        
        # 简单的特殊注释识别
        # Python 常用: # TODO:, # type:, #! (Shebang)
        is_doc = (
            text.startswith("#:") or  # Sphinx 风格变量文档
            text.startswith("#!")     # Shebang
        )

        # 使用 Builder 封装的方法创建 (假设上一轮你已经更新了 CPGBuilder)
        # 如果没更新 Builder，可以使用 self.builder._add_node(CommentNode(...), auto_ast=True)
        comment_node = self.builder.comment(
            text=text, 
            is_docstring=is_doc, 
            **kwargs
        )
        
        return self._set_loc(comment_node, node)

    def handle_collection_literal(self, node: Node, **kwargs):
        args = []
        for child in node.children:
            if child.type in ["[", "]", "(", ")", "{", "}", ",", ":"]: continue
            c = self.visit(child, attach_to_parent=False)
            if c: args.append(c)
        return self.builder.call(Operators.arrayInitializer, Operators.arrayInitializer, args, get_node_text(node, self.source_code), **kwargs)

    def handle_dictionary_literal(self, node: Node, **kwargs):
        return self.builder.literal(get_node_text(node, self.source_code), "dict", **kwargs)

    def handle_lambda(self, node: Node, **kwargs):
        params = node.child_by_field_name("parameters")
        body = node.child_by_field_name("body")
        name = f"lambda_{node.start_point[0]}"
        full_name = self.builder._get_scope_prefix() + name
        
        ref = self.builder.method_ref(name, full_name, get_node_text(node, self.source_code), **kwargs)
        self._set_loc(ref, node)
        
        with self.builder.method(name, signature="lambda", code="lambda") as m:
            if params: self._handle_parameters(params)
            if body: self.visit(body)
        return ref
    
    def handle_parenthesized(self, node: Node, **kwargs):
        child = node.child_by_field_name("expression") or node.children[1]
        return self.visit(child, attach_to_parent=kwargs.get("auto_ast", True))