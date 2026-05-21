# codedmap/parsers/cpp_parser.py

import logging
import tree_sitter_cpp
from tree_sitter import Language, Node
from typing import Tuple, Optional, Any, List

from .c_parser import CParser
from codedmap.frontend.parsers.utils import get_node_text, clean_type_string

from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.nodes import (
    AstNode, ClosureBindingNode, MethodNode, FileNode,
    TypeDeclNode, NamespaceBlockNode, TypeNode
)
from codedmap.core.schema.graph.enums import ControlStructureType, DispatchType, EdgeType, Language, NodeLabel, EvaluationStrategy, ModifierType, ParseStrategy

logger = logging.getLogger("cpg.CppParser")

class CppParser(CParser):
    def __init__(self,
                 builder: CPGBuilder,
                 project_root: str = None):
        super().__init__(builder, project_root)
        
        self._language_enum = Language.CPP
        self.parser.language = Language(tree_sitter_cpp.language())
        
        self.known_functions: set[str] = set()
        self.access_modifier_stack: List[str] = []
        
        self._dispatch_table.update({
            # --- 容器透传 ---
            "declaration_list": self.handle_translation_unit,
            "field_declaration_list": self.handle_translation_unit,
            "linkage_specification": self.handle_translation_unit,

            # --- 结构定义 ---
            "namespace_definition": self.handle_namespace,
            "class_specifier": self.handle_cpp_class,
            "access_specifier": self.handle_access_specifier,
            "field_declaration": self.handle_field_declaration,
            "template_declaration": self.handle_template_declaration,
            
            # --- 异常处理 ---
            "try_statement": self.handle_try_statement,
            "throw_statement": self.handle_throw_statement,
            
            # --- 内存管理 ---
            "new_expression": self.handle_new_expression,
            "delete_expression": self.handle_delete_expression,
            
            # --- 类型转换 ---
            "static_cast_expression": lambda n, **k: self.handle_cpp_cast(n, "<operator>.cast", **k),
            "dynamic_cast_expression": lambda n, **k: self.handle_cpp_cast(n, "<operator>.cast", **k),
            "reinterpret_cast_expression": lambda n, **k: self.handle_cpp_cast(n, "<operator>.cast", **k),
            "const_cast_expression": lambda n, **k: self.handle_cpp_cast(n, "<operator>.cast", **k),

            # --- Lambda & 别名 ---
            "lambda_expression": self.handle_lambda,
            "alias_declaration": self.handle_alias_declaration,
            "using_declaration": self.handle_using_declaration,
            
            # --- 函数与循环 ---
            "range_based_for_statement": self.handle_range_based_for_loop,
            "for_range_loop": self.handle_range_based_for_loop,
            
            # --- 标识符增强 ---
            "qualified_identifier": self.handle_qualified_identifier,
            "template_function": self.handle_identifier,
            "template_type": self.handle_identifier,
        })

    # ==========================================================
    # Debug 工具
    # ==========================================================
    def _debug_print_node(self, node: Node, depth=0):
        """递归打印节点结构，用于调试 AST"""
        if not logger.isEnabledFor(logging.DEBUG):
            return
        indent = "  " * depth
        text = get_node_text(node, self.source_code).replace("\n", "\\n")[:50]
        field = node.type
        logger.debug(f"[AST] {indent}{field} [named={node.is_named}] : '{text}'")
        for child in node.children:
            self._debug_print_node(child, depth + 1)

    # ==========================================================
    # Visit (复用逻辑)
    # ==========================================================
    
    def visit(self, node: Node, attach_to_parent: bool = True) -> Optional[Any]:
        if not node: return None
        # 过滤 C++ 常见标点，减少 AST 噪音
        if node.type in [":", "::", "<", ">", "...", "virtual", "public", "private", "protected"]:
            return None
        return super().visit(node, attach_to_parent)

    # ==========================================================
    # 声明提取 (Declarator Extraction)
    # ==========================================================

    def _extract_declarator_info(self, declarator_node: Node) -> Tuple[str, str]:
        if not declarator_node: return "anonymous", ""
        node_type = declarator_node.type

        if node_type == "qualified_identifier":
            return get_node_text(declarator_node, self.source_code), ""
        
        # 引用类型 (&)
        if node_type == "reference_declarator":
            inner = declarator_node.child_by_field_name("declarator")
            name, suffix = self._extract_declarator_info(inner)
            return name, "&" + suffix
        
        # 右值引用 (&&)
        if node_type == "rvalue_reference_declarator": 
            inner = declarator_node.child_by_field_name("declarator")
            name, suffix = self._extract_declarator_info(inner)
            return name, "&&" + suffix

        # 析构函数 / 结构绑定 / 操作符
        if node_type in ["destructor_name", "structured_binding_declarator", "operator_name"]:
            return get_node_text(declarator_node, self.source_code), ""

        # 模板函数
        if node_type in ["template_function", "template_type"]:
            name_node = declarator_node.child_by_field_name("name")
            args_node = declarator_node.child_by_field_name("arguments")
            name = get_node_text(name_node, self.source_code)
            args_text = get_node_text(args_node, self.source_code) if args_node else ""
            return f"{name}{args_text}", ""

        return super()._extract_declarator_info(declarator_node)

    def _split_qualified_name(self, raw_name: str) -> Tuple[str, str]:
        if "::" in raw_name:
            parts = raw_name.rsplit("::", 1)
            return parts[1], parts[0]
        return raw_name, ""

    # ==========================================================
    # Handlers: 结构与定义
    # ==========================================================

    def handle_namespace(self, node: Node, **kwargs):
        name_node = node.child_by_field_name("name")
        name = get_node_text(name_node, self.source_code) if name_node else "anonymous_namespace"
        with self.builder.namespace_block(name) as ns_node:
            self._set_loc(ns_node, node)
            body = node.child_by_field_name("body")
            if body: self.visit(body)
        return ns_node

    def handle_qualified_identifier(self, node: Node, **kwargs):
        full_name = get_node_text(node, self.source_code)
        # 如果是已知变量，父类逻辑会处理；否则创建 Identifier
        if self.builder.is_variable_defined(full_name): pass 
        return self.builder.identifier(full_name, "ANY", **kwargs)

    def handle_cpp_cast(self, node: Node, operator_name: str, **kwargs):
        type_node = node.child_by_field_name("type")
        val_node = node.child_by_field_name("value") or node.child_by_field_name("argument")
        
        type_name = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "ANY"
        val = self.visit(val_node, attach_to_parent=False)
        
        type_lit = self.builder.literal(type_name, "TYPE", auto_ast=False)
        args = [type_lit]
        if val: args.append(val)
        else: args.append(self.builder.unknown_statement("cast_val?", auto_ast=False))

        return self.builder.call(
            name=operator_name, 
            method_full_name=operator_name, 
            args=args, 
            code=get_node_text(node, self.source_code), 
            **kwargs
        )

    def handle_cpp_class(self, node: Node, **kwargs):
        name_node = node.child_by_field_name("name")
        name = get_node_text(name_node, self.source_code) if name_node else "anonymous_class"
        full_name = self.builder._get_scope_prefix() + name

        # 调试日志
        logger.debug(f"Parsing class: {name}")
        # self._debug_print_node(node) # 仅在深度调试时打开

        bases = self._extract_base_classes(node)
        logger.debug(f"Extracted bases for {name}: {bases}")

        with self.builder.type_decl(name, full_name, inherits=bases) as type_decl:
            self._set_loc(type_decl, node)

            # 建立继承边
            for base_name in bases:
                type_node = TypeNode(name=base_name, fullName=base_name, typeDeclFullName=base_name)
                self.builder.graph.add_node(type_node)
                self.builder.graph.add_edge(type_decl, type_node, EdgeType.INHERITS_FROM)

            default_access = ModifierType.PRIVATE if node.type == "class_specifier" else ModifierType.PUBLIC
            self.access_modifier_stack.append(default_access)
            try:
                body = node.child_by_field_name("body")
                if body: self.visit(body) 
            finally:
                self.access_modifier_stack.pop()
        return type_decl

    def _extract_base_classes(self, node: Node) -> List[str]:
        """
        [Enhanced] 提取基类
        策略 A: 标准 AST 遍历 (Type Identifier)
        策略 B: 文本兜底 (Fallback)
        """
        bases = []
        base_clause = node.child_by_field_name("bases")
        # 兼容性查找
        if not base_clause:
            for child in node.children:
                if child.type == "base_class_clause":
                    base_clause = child; break
        
        if not base_clause: return bases

        # --- Strategy A: AST Traversal ---
        for child in base_clause.children:
            if child.type == "base_class_specifier":
                found = False
                for gc in child.children:
                    # 增加 "identifier" 类型，防止 Base 被误判
                    if gc.type in ["type_identifier", "qualified_identifier", "template_type", "identifier"]:
                        # 排除关键字
                        if get_node_text(gc, self.source_code) in ["public", "private", "protected", "virtual"]:
                            continue
                        bases.append(get_node_text(gc, self.source_code))
                        found = True
                        break
                
                # Fallback: 取最后一个命名节点
                if not found:
                    for gc in reversed(child.children):
                         if gc.is_named and gc.type not in ["access_specifier", "virtual"]:
                             bases.append(get_node_text(gc, self.source_code))
                             break

        # --- Strategy B: Text Fallback ---
        if not bases:
            clause_text = get_node_text(base_clause, self.source_code).strip()
            if clause_text.startswith(":"): clause_text = clause_text[1:]
            
            raw_bases = clause_text.split(",")
            for raw in raw_bases:
                clean = raw.replace("public", "").replace("private", "").replace("protected", "").replace("virtual", "").strip()
                if clean:
                    bases.append(clean)
                    logger.warning(f"Fallback extracted base: {clean}")

        return bases

    def handle_access_specifier(self, node: Node, **kwargs):
        code = get_node_text(node, self.source_code).upper()
        if self.access_modifier_stack:
            if "PUBLIC" in code: self.access_modifier_stack[-1] = ModifierType.PUBLIC
            elif "PRIVATE" in code: self.access_modifier_stack[-1] = ModifierType.PRIVATE
            elif "PROTECTED" in code: self.access_modifier_stack[-1] = ModifierType.PROTECTED
        return None 

    def handle_field_declaration(self, node: Node, **kwargs):
        type_node = node.child_by_field_name("type")
        base_type = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "auto"
        generated = []

        # 检测 static 修饰符
        is_static = False
        for child in node.children:
            if child.type == "storage_class_specifier" and "static" in get_node_text(child, self.source_code):
                is_static = True; break

        for child in node.children:
            # 忽略类型节点和修饰符
            if child == type_node or child.type in [";", ",", "access_specifier", "attribute_declaration", "comment", "storage_class_specifier"]: continue
            
            if child.is_named and (child.type.endswith("declarator") or child.type in ["field_identifier", "identifier"]):
                decl_node = child
                val_node = None
                
                if child.type == "init_declarator":
                    decl_node = child.child_by_field_name("declarator")
                    val_node = child.child_by_field_name("value")

                name, suffix = self._extract_declarator_info(decl_node)
                full_type = base_type + suffix
                
                member = self.builder.add_member(name, full_type)
                code_str = f"{full_type} {name}" + (f" = ..." if val_node else "") + ";"
                member.code = code_str
                self._set_loc(member, child)
                
                # 附加访问控制修饰符
                if self.access_modifier_stack:
                    self.builder.attach_modifier(member, self.access_modifier_stack[-1])
                
                # 附加 static 修饰符
                if is_static:
                    self.builder.attach_modifier(member, "STATIC")
                
                generated.append(member)
        return generated

    def handle_function_definition(self, node: Node, **kwargs):
        type_node = node.child_by_field_name('type')
        declarator = node.child_by_field_name("declarator")
        body = node.child_by_field_name("body")
        
        # 查找 init_list
        init_list = self._find_child_robust(node, "field_initializer_list", ["field_initializer_list"])

        raw_func_name, type_suffix = self._extract_declarator_info(declarator)
        short_name, scope_qualifier = self._split_qualified_name(raw_func_name)

        is_member_function = False
        current_scope = self.builder.scope_stack[-1] if self.builder.scope_stack else None
        
        if isinstance(current_scope, TypeDeclNode) or scope_qualifier:
            is_member_function = True

        ret_type = "auto"
        if type_node:
            ret_type = clean_type_string(get_node_text(type_node, self.source_code))
        elif short_name == scope_qualifier or short_name.startswith("~"):
            ret_type = "void" # Ctor/Dtor
            
        if type_suffix.startswith("*"): ret_type += type_suffix

        is_static = False
        for child in node.children:
            if child.type == "storage_class_specifier" and "static" in get_node_text(child, self.source_code):
                is_static = True; break

        sig = f"{ret_type} {short_name}(...)"
        method_full_name = f"{scope_qualifier}::{short_name}" if scope_qualifier else short_name
        
        if not scope_qualifier and isinstance(current_scope, TypeDeclNode):
             method_full_name = f"{current_scope.full_name}::{short_name}"

        with self.builder.method(short_name, signature=sig, code=None, return_type_full_name=ret_type) as method_node:
            method_node.full_name = method_full_name 
            self._set_loc(method_node, node)
            
            if self.access_modifier_stack:
                self.builder.attach_modifier(method_node, self.access_modifier_stack[-1])
            if is_static:
                self.builder.attach_modifier(method_node, "STATIC")
            
            # 注入 'this' 参数 (接口的一部分，必须保留)
            if is_member_function and not is_static:
                this_type = f"{scope_qualifier}*" if scope_qualifier else "ANY"
                if isinstance(current_scope, TypeDeclNode): 
                    this_type = f"{current_scope.full_name}*"
                self.builder.parameter(name="this", type_full_name=this_type, order=0)

            # 处理参数 (接口的一部分，必须保留)
            self._process_parameters(declarator)
            
            if self.strategy == ParseStrategy.SKELETON:
                # 骨架模式：
                # 1. 标记为 Stub
                method_node.is_stub = True
                
                # 2. 跳过 init_list 和 body 的解析
                # 初始化列表本质上是成员变量赋值，属于实现细节，因此在 Skeleton 模式下忽略
                pass
            
            elif self.strategy == ParseStrategy.FULL:
                # 全量模式：解析初始化列表和函数体
                child_order = 1
                
                # 构造函数初始化列表
                if init_list:
                    for child in init_list.children:
                        if child.type == "field_initializer":
                            assign_node = self._handle_field_initializer(child)
                            if assign_node:
                                assign_node.order = child_order
                                self.builder.graph.add_ast_edge(method_node, assign_node)
                                child_order += 1
                
                if body:
                    body_cpg = self.visit(body)
                    if body_cpg: 
                        body_cpg.order = child_order
            else: 
                logger.warning(f"Unsupported strategy for function_definition: {self.strategy}")

        return method_node

    def _handle_field_initializer(self, node: Node):
        """处理 x(10) 形式的初始化"""
        # 1. 字段名查找
        member_node = node.child_by_field_name("name")
        value_node = node.child_by_field_name("value") or node.child_by_field_name("arguments")

        # 2. 鲁棒性回退
        if not member_node:
            for child in node.children:
                if child.type in ["field_identifier", "identifier"]:
                    member_node = child; break
        
        if not value_node:
            for child in node.children:
                if child.type in ["argument_list", "initializer_list"]:
                    value_node = child; break

        if not member_node: 
            for child in node.children:
                if child.type == "type_identifier": # Base(0)
                    member_node = child; break
            
            if not member_node: return None

        member_name = get_node_text(member_node, self.source_code)

        this_node = self.builder.identifier("this", "ANY", auto_ast=False)
        lhs = self.builder.field_access(this_node, member_name, code=f"this->{member_name}", auto_ast=False)

        rhs = None
        if value_node:
             children = [c for c in value_node.children if c.type not in ["(", ")", ",", "comment"]]
             if children:
                 rhs = self.visit(children[0], attach_to_parent=False)
        
        if not rhs: rhs = self.builder.literal("UNKNOWN", "ANY", auto_ast=False)
        return self.builder.assignment(lhs, rhs, code=get_node_text(node, self.source_code), auto_ast=False)

    def handle_call_expression(self, node: Node, **kwargs):
        func_node = node.child_by_field_name("function")
        args_node = node.child_by_field_name("arguments")
        
        if not func_node:
            if node.child_count > 0:
                func_node = node.children[0]
            else:
                return None

        raw_name = get_node_text(func_node, self.source_code)
        
        # 语义优化：忽略预处理指令 (#error, #pragma 等)
        if raw_name.startswith("#"):
            return None

        method_name = raw_name
        dispatch_type = DispatchType.STATIC_DISPATCH
        receiver_ast = None

        # 成员调用 obj.method()
        # 需要防御 func_node 类型判断，因为它可能是 Identifier
        if func_node.type == "field_expression":
            obj_node = func_node.child_by_field_name("argument")
            field_node = func_node.child_by_field_name("field")
            
            if field_node:
                method_name = get_node_text(field_node, self.source_code)
                dispatch_type = DispatchType.DYNAMIC_DISPATCH
            
            if obj_node:
                receiver_ast = self.visit(obj_node, attach_to_parent=False)

        args_exprs = []
        if args_node:
            for child in args_node.children:
                if child.type not in ["(", ")", ",", "comment"]:
                    expr = self.visit(child, attach_to_parent=False)
                    if expr: args_exprs.append(expr)

        # 名称归一化 (去除 . ->)
        if "." in method_name:
            method_name = method_name.split(".")[-1]
        elif "->" in method_name:
            method_name = method_name.split("->")[-1]

        call_node = self.builder.call(
            name=method_name, 
            method_full_name=method_name, 
            args=args_exprs, 
            code=get_node_text(node, self.source_code),
            dispatch_type=dispatch_type, 
            receiver=receiver_ast, 
            **kwargs
        )
        self._set_loc(call_node, node)
        return call_node

    def handle_lambda(self, node: Node, **kwargs):
        captures = node.child_by_field_name("captures")
        declarator = node.child_by_field_name("declarator")
        body = node.child_by_field_name("body")

        lambda_name = f"lambda_{node.start_point[0]}_{node.start_point[1]}"
        full_name = self.builder._get_scope_prefix() + lambda_name
        ref_node = self.builder.method_ref(lambda_name, full_name, get_node_text(node, self.source_code), **kwargs)
        self._set_loc(ref_node, node)

        parent_scope = None
        for scope in reversed(self.builder.scope_stack):
            if isinstance(scope, (FileNode, TypeDeclNode, NamespaceBlockNode)):
                parent_scope = scope; break
        
        sig = "auto " + lambda_name + "(...)"
        method_node = MethodNode(name=lambda_name, fullName=full_name, signature=sig, code="[lambda]")
        self.builder.graph.add_node(method_node)
        self._set_loc(method_node, node)

        if parent_scope:
            self.builder.graph.add_ast_edge(parent_scope, method_node)
            self.builder.graph.add_edge(parent_scope, method_node, EdgeType.CONTAINS)

        self.builder.enter_scope(method_node)
        try:
            if declarator: self._process_parameters(declarator)
            if body: self.visit(body)
        finally:
            self.builder.exit_scope()

        if captures:
            self._process_captures(captures, ref_node)

        return ref_node

    def _process_captures(self, captures_node: Node, method_ref_node: AstNode):
        for child in captures_node.children:
            if child.type in ["[", "]", ",", "comment"]: continue
            
            cap_text = get_node_text(child, self.source_code)
            if cap_text in ["=", "&"]: continue 

            is_ref = "&" in cap_text or cap_text == "this"
            ref_var = cap_text.replace("&", "").strip()
            if "=" in ref_var: ref_var = ref_var.split("=")[0].strip()
            if not ref_var: continue

            binding = ClosureBindingNode(
                closureOriginalName=ref_var,
                evaluationStrategy=EvaluationStrategy.BY_REFERENCE if is_ref else EvaluationStrategy.BY_VALUE,
                label=NodeLabel.CLOSURE_BINDING
            )
            self.builder.graph.add_node(binding)
            self.builder.graph.add_edge(method_ref_node, binding, EdgeType.CAPTURE)
            
            defined_var = self.builder._resolve_symbol(ref_var)
            if defined_var:
                self.builder.graph.add_edge(binding, defined_var, EdgeType.REF)

    def handle_range_based_for_loop(self, node: Node, **kwargs):
        decl = node.child_by_field_name("declarator") or node.child_by_field_name("type") 
        iterable = node.child_by_field_name("right") or node.child_by_field_name("initializer")
        body = node.child_by_field_name("body")
        
        with self.builder.control_structure(ControlStructureType.FOR, get_node_text(node, self.source_code)) as f:
            self._set_loc(f, node)
            if decl: 
                d = self.visit(decl); self._set_order(d, 1)
            if iterable:
                r = self.visit(iterable); self._set_order(r, 2)
            if body:
                b = self.visit(body); self._set_order(b, 3)
        return f

    def handle_new_expression(self, node: Node, **kwargs):
        type_node = node.child_by_field_name("type")
        args_node = node.child_by_field_name("arguments")
        
        type_name = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "ANY"
        
        args = [self.builder.literal(type_name, "TYPE", auto_ast=False)]
        
        if args_node:
            for child in args_node.children:
                if child.type not in ["(", ")", ",", "{", "}", "comment"]:
                    args.append(self.visit(child, attach_to_parent=False))

        return self.builder.call(
            name="<operator>.new", 
            method_full_name="<operator>.new", 
            args=args, 
            code=get_node_text(node, self.source_code), 
            **kwargs
        )

    def handle_delete_expression(self, node: Node, **kwargs):
        operand = None
        for child in node.children:
            if child.type not in ["delete", "[", "]", "comment"]:
                operand = self.visit(child, attach_to_parent=False); break
        
        if not operand: operand = self.builder.literal("UNKNOWN", "ANY", auto_ast=False)
        return self.builder.unary_op(operand, "<operator>.delete", get_node_text(node, self.source_code), **kwargs)

    def handle_template_declaration(self, node: Node, **kwargs):
        decl = node.child_by_field_name("declaration")
        return self.visit(decl, attach_to_parent=kwargs.get("auto_ast", True))
    
    def handle_alias_declaration(self, node: Node, **kwargs):
        name_node = node.child_by_field_name("name")
        type_node = node.child_by_field_name("type")
        name = get_node_text(name_node, self.source_code)
        target = get_node_text(type_node, self.source_code)
        with self.builder.type_decl(name, name) as t:
            self._set_loc(t, node)
            t.alias_type_full_name = target
        return t
    
    def handle_using_declaration(self, node: Node, **kwargs):
        name = get_node_text(node, self.source_code).replace("using", "").strip().rstrip(";")
        return self.builder.add_import(name, is_system=False)

    def handle_try_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.TRY, "try") as t:
            self._set_loc(t, node)
            body = node.child_by_field_name("body")
            if body: 
                b = self.visit(body); 
                if b: b.order = 1
            
            order = 2
            for child in node.children:
                if child.type == "catch_clause":
                    self._handle_catch(child, order)
                    order += 1
        return t

    def _handle_catch(self, node: Node, order: int):
        params = node.child_by_field_name("parameters")
        body = node.child_by_field_name("body")
        with self.builder.block(get_node_text(node, self.source_code)) as b:
            b.order = order
            self.builder.attach_tag(b, "CATCH")
            self._set_loc(b, node)
            if params:
                 for child in params.children:
                     if child.type == "parameter_declaration":
                         self._handle_catch_param(child)
            if body: self.visit(body)

    def _handle_catch_param(self, node: Node):
        type_node = node.child_by_field_name("type")
        decl = node.child_by_field_name("declarator")
        type_name = get_node_text(type_node, self.source_code)
        name = "anon"
        if decl:
             name = get_node_text(decl, self.source_code)
        self.builder.local_variable(name, type_name)

    def handle_throw_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.THROW, get_node_text(node, self.source_code)) as t:
            self._set_loc(t, node)
            for child in node.children:
                if child.type not in ["throw", ";"]:
                    val = self.visit(child); 
                    if val: val.order = 1; break
        return t
    
    def _find_child_robust(self, node: Node, field_name: str, candidate_types: List[str]) -> Optional[Node]:
        child = node.child_by_field_name(field_name)
        if child: return child
        for c in node.children:
            if c.type in candidate_types:
                return c
        return None