# codedmap/parsers/c_parser.py
import logging
from pathlib import Path
import tree_sitter_c
from tree_sitter import Language, Node
from typing import List, Optional, Tuple, Any, Union, Dict, Callable

from .base import SourceCodeParser
from codedmap.frontend.parsers.utils import clean_type_string, get_node_text, get_node_location
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.operators import Operators
from codedmap.core.schema.graph.nodes import AstNode, NamespaceBlockNode, FileNode, TypeDeclNode
from codedmap.core.schema.graph.enums import ControlStructureType, DispatchType, EdgeType, Language, ParseStrategy

logger = logging.getLogger("cpg.CParser")

class CParser(SourceCodeParser):
    def __init__(self,
                 builder: CPGBuilder,
                 project_root: str = None):
        lang = Language(tree_sitter_c.language())
        super().__init__(builder, lang, Language.C, project_root)

        self.known_functions: set[str] = set()

        self._dispatch_table: Dict[str, Callable] = {
            # =========================================================
            # 1. 根与定义 (Root & Definitions)
            # =========================================================
            "translation_unit": self.handle_translation_unit,
            "function_definition": self.handle_function_definition,
            "declaration": self.handle_declaration,
            "type_definition": self.handle_typedef,
            "struct_specifier": self.handle_struct_specifier,
            "enum_specifier": self.handle_enum_specifier,
            "union_specifier": self.handle_struct_specifier, # Union 复用 Struct 逻辑

            # =========================================================
            # 2. 预处理 (Preprocessor - Pass Through Strategy)
            # =========================================================
            "preproc_include": self.handle_include,
            "preproc_def": self.handle_preproc_def,
            "preproc_function_def": self.handle_preproc_def,
            "preproc_call": self.handle_call_expression, 
            
            # 容器透传：分析宏内部的所有代码分支
            "preproc_if": self.handle_translation_unit,
            "preproc_ifdef": self.handle_translation_unit,
            "preproc_ifndef": self.handle_translation_unit, # 补充 ifndef
            "preproc_else": self.handle_translation_unit,
            "preproc_elif": self.handle_translation_unit,
            
            # 忽略宏条件表达式本身
            "preproc_defined": lambda n, **k: None,
            "preproc_argument_list": lambda n, **k: None, 

            # =========================================================
            # 3. 控制流 (Control Flow)
            # =========================================================
            "compound_statement": self.handle_compound_statement,
            # GCC 扩展：({ ... }) 语句表达式
            "compound_statement_expression": self.handle_compound_statement, 
            
            "if_statement": self.handle_if_statement,
            "while_statement": self.handle_while_statement,
            "do_statement": self.handle_do_statement,
            "for_statement": self.handle_for_statement,
            "switch_statement": self.handle_switch_statement,
            "return_statement": self.handle_return,
            
            # 包装层
            "expression_statement": self.handle_expression_statement,
            "parenthesized_expression": self.handle_parenthesized_expression,
            
            # 空语句 (while(1);) -> 忽略
            "null_statement": lambda n, **k: None,

            # =========================================================
            # 4. 跳转与标签 (Jumps & Labels)
            # =========================================================
            "else_clause": self.handle_translation_unit, # Else 是容器
            "break_statement": lambda n, **k: self.handle_jump(n, "BREAK", **k),
            "continue_statement": lambda n, **k: self.handle_jump(n, "CONTINUE", **k),
            "goto_statement": lambda n, **k: self.handle_jump(n, "GOTO", **k),
            
            "label_statement": lambda n, **k: self.handle_label(n, "LABEL"),
            "labeled_statement": lambda n, **k: self.handle_label(n, "LABEL"),
            "case_statement": lambda n, **k: self.handle_label(n, "CASE"),

            # =========================================================
            # 5. 表达式 (Expressions)
            # =========================================================
            "binary_expression": self.handle_binary_expression,
            "unary_expression": self.handle_unary_expression,
            "pointer_expression": self.handle_unary_expression,
            "update_expression": self.handle_update_expression,
            "call_expression": self.handle_call_expression,
            "assignment_expression": self.handle_assignment,
            "conditional_expression": self.handle_conditional_expression,
            "comma_expression": self.handle_comma_expression,
            "cast_expression": self.handle_cast_expression,
            "sizeof_expression": self.handle_sizeof_expression,

            # 访问操作
            "field_expression": self.handle_field_expression,
            "subscript_expression": self.handle_subscript_expression,
            "identifier": self.handle_identifier,
            "type_identifier": self.handle_identifier,
            "primitive_type": self.handle_identifier,

            # =========================================================
            # 6. 初始化与字面量 (Literals & Init)
            # =========================================================
            "initializer_list": self.handle_initializer_list,
            # C++ 风格初始化 int x(1) -> argument_list
            "argument_list": self.handle_initializer_list, 
            
            "number_literal": self.handle_literal,
            "string_literal": self.handle_literal,
            "char_literal": self.handle_literal,
            "true": self.handle_literal,
            "false": self.handle_literal,
            "null": self.handle_literal,
            "concatenated_string": self.handle_literal,

            # =========================================================
            # 7. 噪音过滤与扩展支持 (Noise Reduction)
            # =========================================================
            # GCC Attributes / Qualifiers
            "attribute_specifier": lambda n, **k: None,
            "attribute_declaration": lambda n, **k: None, # 独立的属性声明
            "gnu_asm_expression": lambda n, **k: None,
            "type_qualifier": lambda n, **k: None,
            "storage_class_specifier": lambda n, **k: None, # 已经在 handle_declaration 中处理

            # 预处理关键字 (作为子节点时忽略)
            "#if": lambda n, **k: None,
            "#ifdef": lambda n, **k: None,
            "#ifndef": lambda n, **k: None,
            "#else": lambda n, **k: None,
            "#elif": lambda n, **k: None,
            "#endif": lambda n, **k: None,
            "#define": lambda n, **k: None,
            "#include": lambda n, **k: None,
            
            "else": lambda n, **k: None, # else 关键字
            "\n": lambda n, **k: None,   # 换行符
            "comment": self.handle_comment,
        }

    # ==========================================================
    # 核心遍历逻辑 (Dispatcher)
    # ==========================================================

    def run(self, filename: str, root_node: Node):
        ns_name = Path(filename.replace("\\", "/")).stem

        with self.builder.file(filename, language=self._language_enum) as file_node:
            with self.builder.namespace_block(ns_name) as ns:
                self.visit(root_node)

    def visit(self, node: Node, attach_to_parent: bool = True) -> Union[AstNode, List[AstNode], None]:
        if not node:
            return None

        # 过滤掉不需要的语法标记
        if node.type in [";", ",", "(", ")", "{", "}", "[", "]"]:
            return None

        node_type = node.type
        if node_type == "ERROR":
            self._log_parse_error(node)
            # 尝试继续遍历 ERROR 内部，看能否挽救部分子节点
            # 通常 ERROR 节点内部会包含一些未被正确归约为语法的 identifier 或 literal
            # 这里我们选择继续深入，也许能发现导致错误的 token
            self._visit_children(node)
            return None

        kwargs = {"auto_ast": attach_to_parent}
        
        # [Refactor] 统一分发逻辑
        handler = self._dispatch_table.get(node_type)
        
        if handler:
            # 动态参数检测，支持 lambda 和普通方法
            # 简单起见，我们假设 handler 尽量都能接受 **kwargs，或者我们做个 try-catch
            try:
                # 检查 handler 签名是否接受 kwargs (lambda 通常需要显式写 **k)
                return handler(node, **kwargs)
            except TypeError as e:
                # Fallback: 有些 handler 可能没定义 **kwargs，尝试仅传 node
                # 这是一个鲁棒性保护，防止开发时漏写参数
                logger.debug(f"Fallback call for {node_type}: {e}")
                return handler(node)
        
        # 兜底逻辑: 未知节点 -> UNKNOWN
        # 仅当需要挂载到父节点时才创建 Unknown，避免表达式内部产生过多垃圾
        if attach_to_parent:
            code = get_node_text(node, self.source_code)
            logger.warning(f"[?] Unhandled node type '{node_type}'. Code: {code}")
            unknown = self.builder.unknown_statement(code, auto_ast=True)
            return self._set_loc(unknown, node)

        return None

    def _visit_children(self, node: Node):
        """遍历所有子节点并维护 order"""
        child_order = 1
        for child in node.children:
            # 递归调用 visit
            result = self.visit(child, attach_to_parent=True)
            
            # 处理返回单个节点或节点列表的情况
            nodes_to_order = []
            if isinstance(result, list):
                nodes_to_order = result
            elif result and hasattr(result, 'id'): # 检查是否是 Node 对象
                nodes_to_order = [result]

            # 自动维护 AST Order
            for cpg_node in nodes_to_order:
                if isinstance(cpg_node, AstNode) and cpg_node.order is None:
                    cpg_node.order = child_order
                    child_order += 1

    def _set_loc(self, cpg_node: Any, ts_node: Node):
        """统一设置位置信息"""
        if hasattr(cpg_node, "line_number"):
            loc = get_node_location(ts_node)
            cpg_node.line_number = loc["line_number"]
            cpg_node.column_number = loc["column_number"]
            cpg_node.offset_start = loc["offset_start"]
            cpg_node.offset_end = loc["offset_end"]
            cpg_node.file_name = self.current_filename
        return cpg_node

    # ==========================================================
    # Handlers: 根与结构包装
    # ==========================================================
    
    def handle_translation_unit(self, node: Node, **kwargs):
        # 根节点，直接遍历子节点
        self._visit_children(node)

    def handle_expression_statement(self, node: Node, **kwargs):
        # 表达式语句: a = 1; -> 去掉分号，处理内部表达式
        for child in node.children:
            if child.type != ";":
                return self.visit(child, attach_to_parent=kwargs.get("auto_ast", True))
        return None

    def handle_parenthesized_expression(self, node: Node, **kwargs):
        # ( a + b ) -> 提取内部表达式
        child = node.child_by_field_name("expression") or node.children[1]
        return self.visit(child, attach_to_parent=kwargs.get("auto_ast", True))

    # ==========================================================
    # Handlers: 声明与定义
    # ==========================================================

    def handle_function_definition(self, node: Node, **kwargs):
        type_node = node.child_by_field_name('type')
        declarator = node.child_by_field_name('declarator')
        body = node.child_by_field_name('body')

        ret_type = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "void"
        func_name, type_suffix = self._extract_declarator_info(declarator)
        
        self.known_functions.add(func_name)
        if type_suffix.startswith("*"):
            ret_type += type_suffix

        sig = f"{ret_type} {func_name}(...)"
        
        # 使用 Context Manager 构建 Method
        with self.builder.method(func_name, signature=sig, code=None, return_type_full_name=ret_type) as method_node:
            self._set_loc(method_node, node)
            self._handle_modifiers(node, method_node)
            self._process_parameters(declarator)
            
            # [SKELETON 适配]
            if self.strategy == ParseStrategy.SKELETON:
                # 1. 标记为 Stub，表示这是一个只有接口没有实现的节点
                method_node.is_stub = True
                
                # 2. 强制跳过 Body 遍历
                # 即使 body 存在，我们也不调用 self.visit(body)
                pass
            elif self.strategy == ParseStrategy.FULL:
                # FULL 模式：正常递归解析函数体
                if body:
                    self.visit(body)
            else:
                logger.warning(f"[!] Unsupported strategy for function: {self.strategy}")

        return method_node

    def handle_declaration(self, node: Node, **kwargs) -> List[AstNode]:
        """处理变量声明: int x, y = 1;"""
        type_node = node.child_by_field_name("type")
        base_type = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "auto"
        generated_nodes = []

        # 判断作用域: 全局/结构体 -> Member, 函数内 -> Local
        is_global_scope = False
        if self.builder.scope_stack:
            if isinstance(self.builder.scope_stack[-1], (NamespaceBlockNode, FileNode, TypeDeclNode)):
                is_global_scope = True

        # 检测是否有 static 修饰符
        is_static_storage = False
        for child in node.children:
            if child.type == "storage_class_specifier" and "static" in get_node_text(child, self.source_code):
                is_static_storage = True

        for child in node.children:
            if child.type in ["init_declarator", "pointer_declarator", "array_declarator", "identifier", "field_identifier"] or child.type.endswith("_declarator"):
                decl_node = child
                val_node = None
                
                # 分离声明与初始化
                if child.type == "init_declarator":
                    decl_node = child.child_by_field_name("declarator")
                    val_node = child.child_by_field_name("value")

                name, suffix = self._extract_declarator_info(decl_node)
                full_type = base_type + suffix

                if is_global_scope:
                    # 全局变量 / 成员变量
                    target_node = self.builder.add_member(name, full_type)
                    self.builder.attach_modifier(target_node, "GLOBAL")
                    if is_static_storage:
                         self.builder.attach_modifier(target_node, "STATIC")
                else:
                    # 局部变量
                    target_node = self.builder.local_variable(name, full_type, f"{full_type} {name};")
                    if is_static_storage:
                        self.builder.attach_modifier(target_node, "STATIC")

                self._set_loc(target_node, decl_node if decl_node else node)
                generated_nodes.append(target_node)

                # 处理初始化: int x = 1; -> x = 1
                if val_node:
                    lhs = self.builder.identifier(name, full_type, auto_ast=False)
                    self._set_loc(lhs, decl_node)
                    
                    rhs = self.visit(val_node, attach_to_parent=False)
                    if rhs is None: # 兜底
                        rhs = self.builder.unknown_statement(get_node_text(val_node, self.source_code), auto_ast=False)

                    # 生成赋值表达式
                    assign_node = self.builder.assignment(lhs, rhs, get_node_text(child, self.source_code), auto_ast=True)
                    self._set_loc(assign_node, child)
                    generated_nodes.append(assign_node)

        return generated_nodes

    def handle_include(self, node: Node, **kwargs):
        path_node = node.child_by_field_name("path")
        if not path_node: return None
        raw = get_node_text(path_node, self.source_code)
        is_system = raw.startswith("<")
        name = raw.strip('<>"')
        cpg_node = self.builder.add_import(name, is_system=is_system)
        return self._set_loc(cpg_node, node)
        
    def handle_preproc_def(self, node: Node, **kwargs):
        # name = get_node_text(node.child_by_field_name("name"), self.source_code)
        # code = get_node_text(node, self.source_code)

        # return self.builder.global_variable(name, "MACRO", code=code)
        # 简化处理...
        return None

    def handle_struct_specifier(self, node: Node, **kwargs):
        # 复用你原来的逻辑
        name_node = node.child_by_field_name("name")
        body = node.child_by_field_name("body")
        struct_name = get_node_text(name_node, self.source_code) if name_node else "anonymous_struct"
        with self.builder.type_decl(struct_name, struct_name) as type_decl:
            self._set_loc(type_decl, node)
            if body:
                # 仅遍历 field_declaration
                for child in body.children:
                    if child.type == "field_declaration":
                        # 这里为了简化，我们手动调用 declaration 逻辑的一部分，或者提取为 common
                        # 简单起见，这里手动处理 member
                        self._handle_struct_field_manual(child)
        return type_decl

    def _handle_struct_field_manual(self, node: Node):
        # 简单的结构体字段辅助函数
        type_node = node.child_by_field_name("type")
        base_type = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "void"
        for child in node.children:
            if child.type == "field_identifier" or child.type.endswith("declarator"):
                name, suffix = self._extract_declarator_info(child)
                member = self.builder.add_member(name, base_type + suffix)
                self._set_loc(member, child)

    def handle_enum_specifier(self, node: Node, **kwargs):
        # 复用原逻辑
        name_node = node.child_by_field_name("name")
        body = node.child_by_field_name("body")
        enum_name = get_node_text(name_node, self.source_code) if name_node else "anonymous_enum"
        with self.builder.type_decl(enum_name, enum_name) as type_decl:
            self._set_loc(type_decl, node)
            if body:
                for child in body.children:
                    if child.type == "enumerator":
                        m_name = get_node_text(child.child_by_field_name("name"), self.source_code)
                        member = self.builder.add_member(m_name, "int")
                        self.builder.attach_modifier(member, "STATIC")
                        self._set_loc(member, child)
        return type_decl

    def handle_typedef(self, node: Node, **kwargs):
        # 复用原逻辑
        type_node = node.child_by_field_name("type")
        declarator = node.child_by_field_name("declarator")
        base_type = clean_type_string(get_node_text(type_node, self.source_code))
        name, suffix = self._extract_declarator_info(declarator)
        with self.builder.type_decl(name, name) as type_decl:
            self._set_loc(type_decl, node)
            type_decl.alias_type_full_name = base_type + suffix
        return type_decl

    # ==========================================================
    # Handlers: 控制流
    # ==========================================================

    def handle_compound_statement(self, node: Node, **kwargs):
        with self.builder.block(get_node_text(node, self.source_code)) as block_node:
            self._set_loc(block_node, node)
            self._visit_children(node)
        return block_node

    def handle_if_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.IF, get_node_text(node, self.source_code)) as n:
            self._set_loc(n, node)
            # 按 Order 1,2,3 分别处理 cond, then, else
            if cond := node.child_by_field_name("condition"):
                 self._set_order(self.visit(cond), 1)
            if cons := node.child_by_field_name("consequence"):
                 self._set_order(self.visit(cons), 2)
            if alt := node.child_by_field_name("alternative"):
                 self._set_order(self.visit(alt), 3)
        return n

    def handle_while_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.WHILE, get_node_text(node, self.source_code)) as n:
            self._set_loc(n, node)
            if cond := node.child_by_field_name("condition"):
                self._set_order(self.visit(cond), 1)
            if body := node.child_by_field_name("body"):
                self._set_order(self.visit(body), 2)
        return n

    def handle_do_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.DO, get_node_text(node, self.source_code)) as n:
            self._set_loc(n, node)
            if body := node.child_by_field_name("body"):
                self._set_order(self.visit(body), 1)
            if cond := node.child_by_field_name("condition"):
                self._set_order(self.visit(cond), 2)
        return n

    def handle_for_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.FOR, get_node_text(node, self.source_code)) as n:
            self._set_loc(n, node)
            if init := node.child_by_field_name("initializer"):
                self._set_order(self.visit(init), 1)
            if cond := node.child_by_field_name("condition"):
                self._set_order(self.visit(cond), 2)
            if upd := node.child_by_field_name("update"):
                self._set_order(self.visit(upd), 3)
            if body := node.child_by_field_name("body"):
                self._set_order(self.visit(body), 4)
        return n

    def handle_switch_statement(self, node: Node, **kwargs):
        with self.builder.control_structure(ControlStructureType.SWITCH, get_node_text(node, self.source_code)) as n:
            self._set_loc(n, node)
            if cond := node.child_by_field_name("condition"):
                res = self.visit(cond)
                self._set_order(res, 1)
            
            if body := node.child_by_field_name("body"):
                # Switch body 是个 Block，但内部需要特殊处理 Case 标签
                with self.builder.block(get_node_text(body, self.source_code)) as b:
                    self._set_loc(b, body)
                    self._visit_switch_body_children(body)
        return n

    def _visit_switch_body_children(self, body_node: Node):
        child_order = 1
        for child in body_node.children:
            if child.type in ["{", "}"]: continue
            
            if child.type == "case_statement":
                # Case 标签
                self.handle_label(child, "CASE").order = child_order
                child_order += 1
                # Case 内容
                for inner in child.children:
                    if inner.type in ["case", "default", ":"] or inner == child.child_by_field_name("value"):
                        continue
                    stmts = self.visit(inner, attach_to_parent=True)
                    self._set_order(stmts, child_order)
                    child_order += 1
            else:
                stmts = self.visit(child, attach_to_parent=True)
                self._set_order(stmts, child_order)
                child_order += 1

    def handle_label(self, node: Node, label_type: str):
        name = "label"
        if label_type == "CASE":
            if node.children[0].type == "default":
                name = "default"
            else:
                val = node.child_by_field_name("value")
                name = f"case {get_node_text(val, self.source_code) if val else '?'}"
        else:
            ln = node.child_by_field_name("label")
            if ln: name = get_node_text(ln, self.source_code)
        
        target = self.builder.jump_target(name, code=None)
        self._set_loc(target, node)
        return target

    def handle_jump(self, node: Node, jump_type: str, **kwargs):
        n = self.builder.jump_statement(jump_type, code=None, **kwargs)
        return self._set_loc(n, node)

    def handle_return(self, node: Node, **kwargs):
        # 查找 return 表达式
        expr_node = None
        for i, child in enumerate(node.children):
            if child.type == "return":
                if i + 1 < len(node.children) and node.children[i+1].type != ";":
                    expr_node = node.children[i+1]
                break
        
        ret_node = self.builder.return_statement(code=None)
        self._set_loc(ret_node, node)

        if expr_node:
            val_cpg = self.visit(expr_node, attach_to_parent=False)
            if val_cpg:
                val_cpg.order = 1
                self.builder.graph.add_ast_edge(ret_node, val_cpg)
                self.builder.graph.add_edge(ret_node, val_cpg, EdgeType.ARGUMENT)
        
        return ret_node

    # ==========================================================
    # Handlers: 表达式 (关键重构区)
    # ==========================================================

    def handle_call_expression(self, node: Node, **kwargs):
        # 1. 适配不同的 Tree-sitter 节点类型获取函数名节点
        # call_expression 使用 "function"
        # preproc_call 使用 "directive"
        func_node = node.child_by_field_name("function")
        if not func_node:
            func_node = node.child_by_field_name("directive")

        # 2. 适配参数节点
        # call_expression 使用 "arguments"
        # preproc_call 使用 "argument"
        args_node = node.child_by_field_name("arguments")
        if not args_node:
            args_node = node.child_by_field_name("argument")

        # --- 异常处理 (保持原逻辑) ---
        if not func_node:
            if node.child_count > 0:
                # 尝试回退策略：取第一个子节点作为函数名
                # 对于 preproc_call，通常第一个 child 就是 identifier
                func_node = node.children[0]
            else:
                logger.warning(f"[Parser] Skipped malformed call expression at {node.start_point}")
                return None

        func_name = get_node_text(func_node, self.source_code)

        # --- 语义过滤 ---
        # 忽略 #include, #define 等被错误解析进来的情况 (防御性编程)
        # 但保留普通的宏调用 (如 ROL64, 它们通常没有 # 前缀，除非 text 包含了 #)
        if func_name.startswith("#") and func_name not in ["#define", "#include"]:
            # 注意：get_node_text 获取的是源码文本。
            # 对于 preproc_call，directive 节点通常只是 "ROL64"，不带 "#"。
            # 只有像 "#pragma" 这种才可能带 "#"。
            # 这里的判断逻辑根据你的需求保留，通常没问题。
            return None

        # --- 参数解析 ---
        args_exprs = []
        if args_node:
            for child in args_node.children:
                # 过滤括号和逗号，但要小心 preproc_argument_list 可能没有括号
                if child.type not in ["(", ")", ",", "preproc_arg"]:
                    # 注意：preproc_call 的参数可能包裹在 preproc_argument_list 中
                    # 如果 child 本身是 list，可能需要钻取。
                    # 但通常 Tree-sitter-c 的 preproc_argument_list 结构比较平铺。

                    # 关键点：不要在这里让 Identifier 创建 LOCAL！
                    # 确保 self.visit(child) 调用的 handle_identifier 不会 auto-create local
                    expr = self.visit(child, attach_to_parent=False)
                    if expr: args_exprs.append(expr)

        # --- 构建节点 ---
        call_node = self.builder.call(
            name=func_name, method_full_name=func_name,
            args=args_exprs, code=None,
            dispatch_type=DispatchType.STATIC_DISPATCH, receiver=None, **kwargs
        )
        return self._set_loc(call_node, node)

    def handle_subscript_expression(self, node: Node, **kwargs):
        """
        [Fix] 处理数组下标: arr[i]
        一定要 return！
        """
        base_node = node.child_by_field_name("argument")
        index_node = node.child_by_field_name("index")
        
        base = self.visit(base_node, attach_to_parent=False)
        index = self.visit(index_node, attach_to_parent=False)

        # 鲁棒性兜底
        if base is None: base = self.builder.unknown_statement("arr?", auto_ast=False)
        if index is None: index = self.builder.unknown_statement("idx?", auto_ast=False)

        n = self.builder.index_access(base, index, code=None, **kwargs)
        return self._set_loc(n, node) # [Fix] Added return

    def handle_field_expression(self, node: Node, **kwargs):
        arg = node.child_by_field_name("argument")
        field = node.child_by_field_name("field")
        op = get_node_text(node.child_by_field_name("operator"), self.source_code)

        base = self.visit(arg, attach_to_parent=False)
        fname = get_node_text(field, self.source_code)
        
        if base is None: # 兜底
            base = self.builder.unknown_statement("base?", auto_ast=False)

        if op == "->":
            n = self.builder.indirect_field_access(base, fname, None, **kwargs)
        else:
            n = self.builder.field_access(base, fname, None, **kwargs)
        return self._set_loc(n, node)

    def handle_update_expression(self, node: Node, **kwargs):
        """
        [New] 处理 i++, ++i
        """
        op_node = node.child_by_field_name("operator")
        arg_node = node.child_by_field_name("argument")
        op_symbol = get_node_text(op_node, self.source_code)
        
        # 判断前后缀: 比较 start_byte
        try:
            is_prefix = op_node.start_byte < arg_node.start_byte
        except:
            print(op_node)
            raise ValueError("Cannot determine prefix/postfix for ++/--")
        
        if op_symbol == "++":
            joern_op = Operators.preIncrement if is_prefix else Operators.postIncrement
        elif op_symbol == "--":
            joern_op = Operators.preDecrement if is_prefix else Operators.postDecrement
        else:
            joern_op = f"<operator>.{op_symbol}"

        arg = self.visit(arg_node, attach_to_parent=False)
        if arg is None: arg = self.builder.unknown_statement("arg?", auto_ast=False)

        n = self.builder.unary_op(arg, joern_op, code=None, **kwargs)
        return self._set_loc(n, node)

    def handle_unary_expression(self, node: Node, **kwargs):
        # 处理 !x, -x, *ptr, &ptr
        op_node = node.child_by_field_name("operator") or node.children[0]
        arg_node = node.child_by_field_name("argument") or node.children[1]
        op_text = get_node_text(op_node, self.source_code)
        
        # 1. 函数指针引用 (&func)
        if op_text == "&" and arg_node.type == "identifier":
             name = get_node_text(arg_node, self.source_code)
             if not self.builder.is_variable_defined(name):
                 n = self.builder.method_ref(name, name, None, **kwargs)
                 return self._set_loc(n, node)

        # 2. 标准一元运算
        joern_op = f"<operator>.{op_text}"
        if op_text == "*": joern_op = Operators.indirection
        elif op_text == "&": joern_op = Operators.addressOf
        elif op_text == "!": joern_op = Operators.logicalNot
        elif op_text == "~": joern_op = Operators.not_

        arg = self.visit(arg_node, attach_to_parent=False)
        if arg:
            n = self.builder.unary_op(arg, joern_op, None, **kwargs)
            return self._set_loc(n, node)
        return None

    def handle_binary_expression(self, node: Node, **kwargs):
        left = node.child_by_field_name("left")
        right = node.child_by_field_name("right")
        op = get_node_text(node.child_by_field_name("operator"), self.source_code)
        
        # 映射表
        op_map = {
            "+": Operators.addition, "-": Operators.subtraction, 
            "*": Operators.multiplication, "/": Operators.division, "%": Operators.modulo,
            "==": Operators.equals, "!=": Operators.notEquals, 
            ">": Operators.greaterThan, "<": Operators.lessThan, 
            ">=": Operators.greaterEqualsThan, "<=": Operators.lessEqualsThan,
            "&&": Operators.logicalAnd, "||": Operators.logicalOr, 
            "=": Operators.assignment, "+=": Operators.assignmentPlus, 
            "-=": Operators.assignmentMinus, "*=": Operators.assignmentMultiplication, 
            "/=": Operators.assignmentDivision,
            "&": Operators.and_, "|": Operators.or_, "^": Operators.xor, 
            "<<": Operators.shiftLeft, ">>": Operators.arithmeticShiftRight,
        }
        joern_op = op_map.get(op, f"<operator>.{op}")

        lhs = self.visit(left, attach_to_parent=False)
        rhs = self.visit(right, attach_to_parent=False)
        
        if lhs and rhs:
            n = self.builder.binary_op(lhs, rhs, joern_op, None, **kwargs)
            return self._set_loc(n, node)
        return None

    def handle_initializer_list(self, node: Node, **kwargs):
        """
        [Enhanced] 支持指定初始化 {.x=1}
        """
        args = []
        for child in node.children:
            if child.type in ["{", "}", ","]: continue
            
            if child.type == "initializer_pair":
                # 指定初始化: .x = 1
                key_node = child.child_by_field_name("designator")
                val_node = child.child_by_field_name("value")
                
                key_text = get_node_text(key_node, self.source_code).lstrip(".") # x
                key_expr = self.builder.literal(key_text, "String", auto_ast=False)
                val_expr = self.visit(val_node, attach_to_parent=False)
                
                # 构建 assignment(key, val) 代表 key=val
                if val_expr:
                    pair = self.builder.assignment(key_expr, val_expr, code=None, auto_ast=False)
                    args.append(pair)
            else:
                # 普通初始化
                arg = self.visit(child, attach_to_parent=False)
                if arg: args.append(arg)

        n = self.builder.call(name=Operators.arrayInitializer, method_full_name=Operators.arrayInitializer, args=args, code=None, **kwargs)
        return self._set_loc(n, node)

    def handle_identifier(self, node: Node, **kwargs):
        name = get_node_text(node, self.source_code)
        
        # 1. 局部变量 (Shadowing)
        if self.builder.is_variable_defined(name):
            pass 
        # 2. 已知函数引用
        elif name in self.known_functions:
            ref = self.builder.method_ref(name, name, code=None, **kwargs)
            return self._set_loc(ref, node)
        
        # 3. 默认
        type_full_name = "ANY"
        # 如果是 type_identifier，我们其实知道它本身就是个类型
        if node.type == "type_identifier":
             type_full_name = name # 自身即类型

        if self.builder.symbol_table_stack:
            defn = self.builder._resolve_symbol(name)
            if defn and hasattr(defn, "typeFullName"):
                type_full_name = defn.typeFullName # Use correct attr name
        
        n = self.builder.identifier(name, type_full_name, code=None, **kwargs)
        return self._set_loc(n, node)

    def handle_literal(self, node: Node, **kwargs):
        txt = get_node_text(node, self.source_code)
        t = "int"
        
        if node.type == "string_literal": t = "char*"
        elif node.type == "char_literal": t = "char"
        elif node.type in ["true", "false"]: t = "bool"
        elif node.type == "null": t = "void*"
        elif node.type == "number_literal":
            # 简单的启发式类型推断
            if "." in txt or "e" in txt.lower():
                t = "float"
            elif "0x" in txt.lower():
                t = "int" # Hex
            # 可以扩展 L, U 后缀判断
            
        n = self.builder.literal(code=txt, type_full_name=t, **kwargs)
        return self._set_loc(n, node)
    
    def handle_comment(self, node: Node, **kwargs):
        """
        [新增] 处理注释节点。
        """
        # 获取原始文本
        text = get_node_text(node, self.source_code)
        
        # 但为了保留原本的格式（比如 ASCII Art），这里只去除首尾空格，或者保留原样
        text = text.strip() 
        
        # Docstring 启发式判断
        is_doc = (
            text.startswith("/**") or 
            text.startswith("/*!") or 
            text.startswith("///") or
            text.startswith("//!")
        )

        comment_node = self.builder.comment(text, is_docstring=is_doc, **kwargs)
        
        return self._set_loc(comment_node, node)

    def handle_assignment(self, node: Node, **kwargs):
         lhs = self.visit(node.child_by_field_name("left"), attach_to_parent=False)
         rhs = self.visit(node.child_by_field_name("right"), attach_to_parent=False)
         if lhs and rhs:
             n = self.builder.assignment(lhs, rhs, None, **kwargs)
             return self._set_loc(n, node)
         return None

    def handle_conditional_expression(self, node: Node, **kwargs):
        cond_child = node.child_by_field_name("condition")
        cons_child = node.child_by_field_name("consequence")
        alt_child = node.child_by_field_name("alternative")

        # 1. 解析 Condition
        cond = self.visit(cond_child, attach_to_parent=False)
        if cond is None:
            # [Fix] 必须占位，否则后续参数索引会前移
            cond = self.builder.unknown_statement("missing_condition", auto_ast=False)

        # 2. 解析 Consequence (处理 GNU 扩展)
        if cons_child:
            cons = self.visit(cons_child, attach_to_parent=False)
        else:
            # GNU Extension: x ?: y
            # 语义上复用 cond。在图数据库中，这会产生两条边指向同一个 cond 节点，这是合法的 DAG 结构。
            cons = cond 
        
        # [Safety] 如果 cons 解析失败（且不是 GNU 扩展），也要占位
        if cons is None:
             cons = self.builder.unknown_statement("missing_consequence", auto_ast=False)

        # 3. 解析 Alternative
        alt = self.visit(alt_child, attach_to_parent=False)
        if alt is None:
            alt = self.builder.unknown_statement("missing_alternative", auto_ast=False)

        # 4. 构造参数列表
        # 此时不需要过滤 None，因为我们已经确保了所有槽位都有对象
        args = [cond, cons, alt]
        
        return self.builder.call(
            name=Operators.conditional, 
            method_full_name=Operators.conditional, 
            args=args, 
            code=None, 
            **kwargs
        )

    def handle_comma_expression(self, node: Node, **kwargs):
        # 逗号表达式 (a, b) 在语义上通常顺序执行，返回最后一个值。
        # 在 CPG 中，我们将其建模为一个 Block，包含所有子表达式。
        with self.builder.block(get_node_text(node, self.source_code)) as block_node:
            self._set_loc(block_node, node)
            # 遍历子节点 (left, right) 并挂载到 Block 下
            self._visit_children(node)
            
        # 必须返回 BlockNode 对象
        return block_node
    
    def handle_cast_expression(self, node: Node, **kwargs):
         type_node = node.child_by_field_name("type")
         val_node = node.child_by_field_name("value")
         type_name = clean_type_string(get_node_text(type_node, self.source_code))
         val = self.visit(val_node, attach_to_parent=False)
         type_lit = self.builder.literal(type_name, "TYPE", auto_ast=False)
         return self.builder.call(name=Operators.cast, method_full_name=Operators.cast, args=[type_lit, val], code=None, **kwargs)
    
    def handle_sizeof_expression(self, node: Node, **kwargs):
         type_node = node.child_by_field_name("type")
         val_node = node.child_by_field_name("value")
         target = None
         if val_node: target = self.visit(val_node, attach_to_parent=False)
         elif type_node: target = self.builder.literal(clean_type_string(get_node_text(type_node, self.source_code)), "TYPE", auto_ast=False)
         return self.builder.unary_op(target, Operators.sizeOf, get_node_text(node, self.source_code), **kwargs)

    # ... 辅助函数 ...
    def _extract_declarator_info(self, declarator_node: Node) -> Tuple[str, str]:
        if not declarator_node: return "anonymous", ""
        node_type = declarator_node.type
        
        if node_type in ["identifier", "field_identifier"]:
            return get_node_text(declarator_node, self.source_code), ""

        target_child = None
        current_suffix = ""
        
        if node_type == "pointer_declarator": current_suffix = "*"
        elif node_type == "array_declarator":
             size_node = declarator_node.child_by_field_name("size")
             size_str = get_node_text(size_node, self.source_code) if size_node else ""
             current_suffix = f"[{size_str}]"
        elif node_type == "function_declarator": current_suffix = "(...)"

        for child in declarator_node.children:
            if child.type in ["*", "(", ")", "[", "]", "=", "call_convention", "parameter_list"]: continue
            if node_type == "array_declarator" and child == declarator_node.child_by_field_name("size"): continue
            if child.is_named:
                target_child = child
                break
        
        if target_child:
            name, inner_suffix = self._extract_declarator_info(target_child)
            if node_type == "pointer_declarator": return name, "*" + inner_suffix
            else: return name, inner_suffix + current_suffix
        return "anonymous", current_suffix
    
    def _process_parameters(self, declarator_node: Node):
        if not declarator_node: return
        if declarator_node.type == "function_declarator":
            params = declarator_node.child_by_field_name("parameters")
            if params:
                for i, param in enumerate(params.children):
                    if param.type == "parameter_declaration":
                        self._handle_single_param(param, i + 1)
            next_decl = declarator_node.child_by_field_name("declarator")
            if next_decl: self._process_parameters(next_decl)
        else:
             for child in declarator_node.children:
                 if child.type.endswith("declarator"): self._process_parameters(child)

    def _handle_single_param(self, param_node: Node, order: int):
        type_node = param_node.child_by_field_name("type")
        decl_node = param_node.child_by_field_name("declarator")
        p_type = clean_type_string(get_node_text(type_node, self.source_code)) if type_node else "void"
        p_name = "anonymous"
        if decl_node:
            name, suffix = self._extract_declarator_info(decl_node)
            p_name = name
            p_type += suffix
        p_node = self.builder.parameter(p_name, p_type, order)
        self._set_loc(p_node, param_node)

    def _handle_modifiers(self, node: Node, target_cpg_node: AstNode):
        for child in node.children:
            if child.type in ["storage_class_specifier", "type_qualifier"]:
                mod_text = get_node_text(child, self.source_code).upper()
                self.builder.attach_modifier(target_cpg_node, mod_text)
    
    def _set_order(self, node_or_list: Union[AstNode, List[AstNode], None], order: int):
        if not node_or_list: return
        if isinstance(node_or_list, list):
            for n in node_or_list:
                if isinstance(n, AstNode): n.order = order
        elif isinstance(node_or_list, AstNode):
            node_or_list.order = order

    def _log_parse_error(self, node: Node):
        """
        [Debug Tool] 打印详细的语法错误上下文
        """
        start = node.start_point  # (row, col)
        end = node.end_point
        
        # 获取错误节点的文本
        error_text = get_node_text(node, self.source_code)
        if len(error_text) > 100: error_text = error_text[:100] + "..."
        
        # 获取前一个兄弟节点 (定位脱轨点)
        prev = node.prev_sibling
        prev_info = "None"
        if prev:
            prev_type = prev.type
            prev_text = get_node_text(prev, self.source_code)
            if len(prev_text) > 50: prev_text = prev_text[:50] + "..."
            prev_info = f"[{prev_type}] '{prev_text}'"

        logger.error(
            f"\n=== SYNTAX ERROR DETECTED ===\n"
            f"File: {self.current_filename}\n"
            f"Location: Line {start[0]+1}:{start[1]} to Line {end[0]+1}:{end[1]}\n"
            f"Previous Node: {prev_info}\n"
            f"Error Content Snippet: \n{error_text}\n"
            f"============================="
        )        