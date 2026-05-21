# codedmap/frontend/parsers/ir/clang_json_parser.py

import logging
from pathlib import Path
from typing import Dict, Callable, Any, Optional, List, Union

from codedmap.core.schema.graph import AnyNode
from codedmap.frontend.parsers.ir.base import IRParser
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.operators import Operators
from codedmap.core.schema.graph.enums import ControlStructureType, DispatchType, EdgeType, Language, ModifierType
from codedmap.core.schema.graph.nodes import AstNode

logger = logging.getLogger("cpg.parser.clang")


CPP_EXTENSIONS = {'.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.cppm', '.ixx'}


class ClangJSONParser(IRParser):
    """
    [Layer 2] 解析由 ast_exporter.py 生成的 Clang AST JSON。
    Status: Production Ready
    """

    def __init__(self, builder: CPGBuilder, project_root: str = None):
        super().__init__(builder, project_root)

        # [架构核心] 分发映射表: Clang Kind -> Handler
        self._dispatch_table: Dict[str, Callable] = {
            # --- Root & Containers ---
            "TRANSLATION_UNIT": self.handle_translation_unit,
            "NAMESPACE": self.handle_namespace,
            "LINKAGE_SPEC": self.handle_translation_unit,  # extern "C"

            # --- Declarations ---
            "FUNCTION_DECL": self.handle_function_decl,
            "CXX_METHOD": self.handle_function_decl,
            "CONSTRUCTOR": self.handle_function_decl,
            "DESTRUCTOR": self.handle_function_decl,

            "PARM_DECL": self.handle_parameter,
            "VAR_DECL": self.handle_variable_decl,
            "FIELD_DECL": self.handle_field_decl,

            "STRUCT_DECL": self.handle_type_decl,
            "CLASS_DECL": self.handle_type_decl,
            "UNION_DECL": self.handle_type_decl,
            "TYPEDEF_DECL": self.handle_typedef_decl,
            "TYPE_ALIAS_DECL": self.handle_typedef_decl,  # using A = B;
            "ENUM_DECL": self.handle_enum_decl,
            "ENUM_CONSTANT_DECL": self.handle_enum_const,

            # --- Statements ---
            "ASM_STMT": self.handle_asm,
            "GCC_ASM_STMT": self.handle_asm,
            "NULL_STMT": lambda n, **k: None,

            "COMPOUND_STMT": self.handle_block,
            "DECL_STMT": self.handle_decl_stmt,
            "RETURN_STMT": self.handle_return,
            "IF_STMT": self.handle_if,
            "FOR_STMT": self.handle_for,
            "WHILE_STMT": self.handle_while,
            "DO_STMT": self.handle_do_while,
            "SWITCH_STMT": self.handle_switch,
            "CASE_STMT": self.handle_case,
            "DEFAULT_STMT": self.handle_default,
            "BREAK_STMT": lambda n, **k: self.builder.jump_statement("BREAK", "break", **k),
            "CONTINUE_STMT": lambda n, **k: self.builder.jump_statement("CONTINUE", "continue", **k),
            "GOTO_STMT": self.handle_goto,
            "LABEL_STMT": self.handle_label,

            # GCC Statement Expression ({ int x = 1; x; }) -> 透传
            "STMT_EXPR": self.handle_wrapper_pass_through,

            # --- Expressions ---
            # 各种 Cast，统一透传
            "C_STYLE_CAST_EXPR": self.handle_wrapper_pass_through,
            "CXX_STATIC_CAST_EXPR": self.handle_wrapper_pass_through,
            "CXX_DYNAMIC_CAST_EXPR": self.handle_wrapper_pass_through,
            "CXX_REINTERPRET_CAST_EXPR": self.handle_wrapper_pass_through,
            "CXX_CONST_CAST_EXPR": self.handle_wrapper_pass_through,
            "CXX_FUNCTIONAL_CAST_EXPR": self.handle_wrapper_pass_through,
            "IMPLICIT_CAST_EXPR": self.handle_wrapper_pass_through,

            "CALL_EXPR": self.handle_call,
            "CXX_MEMBER_CALL_EXPR": self.handle_call,  # [Critical] 别漏了 Member Call
            "CXX_OPERATOR_CALL_EXPR": self.handle_call,  # [Critical] 别漏了 Operator Call

            "BINARY_OPERATOR": self.handle_binary_operator,
            "UNARY_OPERATOR": self.handle_unary_operator,
            "COMPOUND_ASSIGNMENT_OPERATOR": self.handle_binary_operator,
            "CONDITIONAL_OPERATOR": self.handle_conditional,

            "INIT_LIST_EXPR": self.handle_init_list,
            "COMPOUND_LITERAL_EXPR": self.handle_init_list,  # (struct A){1,2} 类似 InitList
            "DESIGNATED_INIT_EXPR": self.handle_wrapper_pass_through,

            "UNARY_EXPR_OR_TYPE_TRAIT": self.handle_sizeof,  # sizeof/alignof

            "DECL_REF_EXPR": self.handle_decl_ref,
            "MEMBER_REF_EXPR": self.handle_member_expr,
            "ARRAY_SUBSCRIPT_EXPR": self.handle_array_access,

            "PAREN_EXPR": self.handle_wrapper_pass_through,

            # [Fix] 重要的兜底逻辑
            "UNEXPOSED_EXPR": self.handle_wrapper_pass_through,  # 必须有！
            "UNEXPOSED_STMT": self.handle_wrapper_pass_through,  # 必须有！
            "LAMBDA_EXPR": self.handle_wrapper_pass_through,  # 暂时透传 Lambda Body

            # --- Literals ---
            "INTEGER_LITERAL": self.handle_literal,
            "FLOATING_LITERAL": self.handle_literal,
            "STRING_LITERAL": self.handle_literal,
            "CHARACTER_LITERAL": self.handle_literal,
            "CXX_BOOL_LITERAL_EXPR": self.handle_literal,
            "CXX_NULL_PTR_LITERAL_EXPR": self.handle_literal,  # nullptr
        }

    # ==========================================================
    # 1. Traversal Engine (遍历引擎)
    # ==========================================================

    def run(self, filename: str, root_node: Dict[str, Any]):
        """
        入口点。
        """
        loc = root_node.get("location", {})
        src_file = loc.get("file")

        if not src_file:
            src_file = root_node.get("spelling", filename)

        self.current_filename = src_file
        self._language_enum = self._detect_language(src_file)
        logger.info(f"Parsing IR for: {src_file} (language={self._language_enum.value})")

        with self.builder.file(src_file, language=self._language_enum) as file_node:
            self.visit(root_node)

    def _detect_language(self, filename: str) -> Language:
        """根据文件后缀判断语言类型。"""
        ext = Path(filename).suffix.lower()
        if ext in CPP_EXTENSIONS:
            return Language.CPP
        return Language.C

    def visit(self, node_dict: Dict[str, Any], attach_to_parent: bool = True) -> Optional[AnyNode]:
        """
        核心遍历函数。
        不再接收 order/index 参数，而是直接从 node_dict 中读取 Exporter 提供的权威数据。
        """
        if not node_dict: return None

        kind = node_dict.get("kind", "UNKNOWN")

        # [Strict Extraction] 直接提取 Exporter 数据
        # 这些数据决定了 ID 的生成 (Deterministic ID)
        kwargs = self._extract_metadata(node_dict)
        kwargs["auto_ast"] = attach_to_parent

        handler = self._dispatch_table.get(kind)

        # Handler 缺失时的兜底：尝试透传子节点 (Wrapper Pass-through)
        if not handler:
            # logger.debug(f"Unhandled kind: {kind}, passing through.")
            return self.handle_wrapper_pass_through(node_dict, **kwargs)

        try:
            # Invoke Handler
            result = handler(node_dict, **kwargs)
            return result
        except Exception as e:
            logger.error(f"Error handling {kind} in {self.current_filename}: {e}", exc_info=True)
            return None

    def _visit_children(self, node_dict: Dict[str, Any]) -> List[AnyNode]:
        """
        简单的递归遍历。
        不再计算 order，完全信任子节点自带的 order 属性。
        """
        children = node_dict.get("children", [])
        results = []
        for child in children:
            res = self.visit(child, attach_to_parent=True)
            if res:
                if isinstance(res, list): results.extend(res)
                else: results.append(res)
        return results

    def _extract_metadata(self, node_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        [The Engine Room] 从 JSON 映射到 CPG Schema。
        支持 'extra' 字段的自动透传 (offset_bytes, type_size 等)。
        """
        kwargs = {}

        # 1. Order & Index (ID 生成的关键)
        if "order" in node_dict:
            kwargs["order"] = node_dict["order"]+ 1 # Joern/CPG 官方规范明确 order 从 1 开始
        if "argument_index" in node_dict:
            kwargs["argument_index"] = node_dict["argument_index"]+ 1 # Joern/CPG 官方规范明确 argument_index 从 1 开始

        # 2. Location
        loc = node_dict.get("location", {})
        if loc:
            kwargs["line_number"] = loc.get("line")
            kwargs["column_number"] = loc.get("col")
            kwargs["line_number_end"] = loc.get("line_end")
            kwargs["column_number_end"] = loc.get("col_end")
            kwargs["offset_start"] = loc.get("offset_start")
            kwargs["offset_end"] = loc.get("offset_end")

            # File name extraction (Trust relative path from exporter)
            if loc.get("file"):
                kwargs["file_name"] = loc.get("file")
            else:
                kwargs["file_name"] = getattr(self, 'current_filename', "unknown")

        # 3. Type System (Kernel Memory Layout)
        # 将 type.size 等扁平化放入 kwargs，利用 Node 的 extra='allow' 特性存储
        type_info = node_dict.get("type", {})
        if type_info:
            kwargs["type_full_name"] = type_info.get("canonical") or type_info.get("fullname", "ANY")
            # [Extension] 内存布局元数据
            if "size" in type_info: kwargs["type_size"] = type_info["size"]
            if "align" in type_info: kwargs["type_align"] = type_info["align"]

        # [Extension] Member/Field Offset
        if "offset_bytes" in node_dict:
            kwargs["offset_bytes"] = node_dict["offset_bytes"]

        # 4. Code / Value
        # 优先使用 value (Literal) 或 opcode (Operator)
        if "value" in node_dict:
            kwargs["code"] = str(node_dict["value"])
        elif "opcode" in node_dict:
            kwargs["code"] = str(node_dict["opcode"])
        # 如果都没有，Builder 稍后会尝试 SourceManager 懒加载，或者在 Handler 里用 spelling 兜底

        # 5. Semantic Properties
        if "alias_name" in node_dict:
            kwargs["alias_names"] = [node_dict["alias_name"]]
        if "mangled_name" in node_dict:
            kwargs["mangled_name"] = node_dict["mangled_name"]
        if "signature" in node_dict:
            kwargs["signature"] = node_dict["signature"]
        if "usr" in node_dict:
            # USR 用于 Linker，存入 property
            kwargs["usr"] = node_dict["usr"]
        if "ref_usr" in node_dict:
            kwargs["ref_usr"] = node_dict["ref_usr"]

        return kwargs

    def _sanitize_kwargs(self, kwargs: Dict[str, Any], exclude_keys: List[str]) -> Dict[str, Any]:
        """Helper to prevent duplicated arguments in Builder calls"""
        for key in exclude_keys:
            if key in kwargs:
                kwargs.pop(key)
        return kwargs

    def _get_type_fullname(self, node_dict: Dict[str, Any]) -> str:
        type_info = node_dict.get("type", {})
        return type_info.get("canonical") or type_info.get("fullname") or "ANY"

    # ==========================================================
    # Handlers: Structure & Declarations
    # ==========================================================

    def handle_translation_unit(self, node: Dict[str, Any], **kwargs):
        self._visit_children(node)

    def handle_namespace(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "<anon>")
        kwargs.pop("name", None)

        with self.builder.namespace_block(name, **kwargs):
            self._visit_children(node)

    def handle_type_decl(self, node: Dict[str, Any], **kwargs):
        """
        增加了对 C++ 继承关系 (Inheritance) 的支持。
        """
        name = node.get("spelling", "<anon>")
        extracted_full_name = kwargs.pop("type_full_name", None)
        full_name = extracted_full_name or (self.builder._get_scope_prefix() + name)

        # 1. 处理 Typedef 别名
        underlying = node.get("underlying_type", {}).get("fullname")
        if underlying:
            kwargs["alias_type_full_name"] = underlying

        # 2. 提取继承列表
        inherits = node.get("inherits_from", [])

        kwargs.pop("name", None)
        with self.builder.type_decl(name, full_name, inherits=inherits, **kwargs) as td:
            self._visit_children(node)
        return td

    def handle_typedef_decl(self, node: Dict[str, Any], **kwargs):
        return self.handle_type_decl(node, **kwargs)

    def handle_enum_decl(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "<anon_enum>")
        full_name = self.builder._get_scope_prefix() + name

        kwargs.pop("name", None)
        kwargs.pop("type_full_name", None)

        with self.builder.type_decl(name, full_name, **kwargs) as td:
            self._visit_children(node)
        return td

    def handle_enum_const(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "")

        kwargs.setdefault("code", name)

        kwargs.pop("name", None)
        t_name = kwargs.pop("type_full_name", "int")

        # Enum Constant is treated as a Member of the Enum Type
        return self.builder.add_member(name, t_name, **kwargs)

    def handle_function_decl(self, node: Dict[str, Any], **kwargs):
        """
        [Finalized] 融合版本：Zero-Inference 架构 + 全量元数据保留
        """
        # 1. 提取显式参数
        name = node.get("spelling", "")
        ret_type = node.get("type", {}).get("return_type", "void")

        # 2. Signature 策略
        signature = kwargs.pop("signature", None)

        if not signature:
            # 简单的兜底
            signature = f"{ret_type} {name}(...)"

        # 3. 清理冲突参数
        # MethodNode 不需要 order/argument_index，防止污染
        kwargs.pop("name", None)
        kwargs.pop("order", None)
        kwargs.pop("argument_index", None)

        # 4. 调用 Builder
        with self.builder.method(name, signature=signature, return_type_full_name=ret_type, **kwargs) as method:

            # ---------------------------------------------------
            # 5. Modifiers (全量映射)
            # ---------------------------------------------------
            # Static
            if node.get("is_static") or node.get("storage_class") == "STATIC":
                self.builder.attach_modifier(method, ModifierType.STATIC)

            # Virtual family
            if node.get("is_pure_virtual"):
                self.builder.attach_modifier(method, "PURE_VIRTUAL")
                self.builder.attach_modifier(method, ModifierType.VIRTUAL)
            elif node.get("is_virtual_method"):
                self.builder.attach_modifier(method, ModifierType.VIRTUAL)

            # C++ specifics
            if node.get("is_explicit"):
                self.builder.attach_modifier(method, "EXPLICIT")
            if node.get("is_inline"):
                self.builder.attach_modifier(method, "INLINE")

            # Visibility
            access = node.get("access_specifier", "PUBLIC")
            if access == "PRIVATE":
                self.builder.attach_modifier(method, ModifierType.PRIVATE)
            elif access == "PROTECTED":
                self.builder.attach_modifier(method, ModifierType.PROTECTED)
            else:
                self.builder.attach_modifier(method, ModifierType.PUBLIC)

            # ---------------------------------------------------
            # 6. Semantic Tags
            # ---------------------------------------------------
            sem_parent = node.get("semantic_parent_usr")
            if sem_parent:
                self.builder.attach_tag(method, f"semantic_parent:{sem_parent}")

            # ---------------------------------------------------
            # 7. Children 遍历
            # ---------------------------------------------------
            self._visit_children(node)

        return method

    def handle_parameter(self, node: Dict[str, Any], **kwargs):
        """
        处理函数参数及默认值。
        """
        # 1. 确定 Name
        name = node.get("spelling")
        if not name:
            # 匿名参数或变长参数
            name = "..." if node.get("is_variadic") else f"p{kwargs.get('argument_index', '?')}"

        # 2. 确定 Order (优先 argument_index)
        order = kwargs.get("argument_index", 0)
        if order == 0 and "order" in kwargs:
            order = kwargs["order"]

        # 3. 确定 Type
        type_name = kwargs.get("type_full_name", "ANY")

        # 4. 清理 kwargs 防止冲突
        kwargs.pop("name", None)
        kwargs.pop("order", None)
        kwargs.pop("type_full_name", None)
        kwargs.pop("code", None)

        # 准备 code
        code_val = name  # 默认 code 为参数名

        # 5. 创建参数节点
        # 返回的是 MethodParameterInNode
        param_node = self.builder.parameter(name, type_name, order=int(order), code=code_val, **kwargs)

        # 6. 处理默认参数 (Default Arguments)
        # Clang AST: PARM_DECL -> [IntegerLiteral(10)] 表示 int x = 10
        children = node.get("children", [])
        if children:
            # 这里的子节点是表达式，属于 AST 的一部分
            # 因为 builder.parameter 没有 enter_scope，所以 visit(attach_to_parent=True) 会失败或挂错地方
            # 必须 attach_to_parent=False 然后手动连线
            for child in children:
                default_val = self.visit(child, attach_to_parent=False)
                if default_val:
                    # 将默认值表达式挂载到参数节点下 (AST 边)
                    self.builder.graph.add_ast_edge(param_node, default_val)

        return param_node

    # ==========================================================
    # Handlers: Variables & Fields
    # ==========================================================

    def handle_variable_decl(self, node: Dict[str, Any], **kwargs):
        """
        处理变量声明
        """
        name = node.get("spelling", "")
        type_name = kwargs.get("type_full_name", "ANY")

        # 1. 准备代码 Code string
        if "code" not in kwargs:
            kwargs["code"] = f"{type_name} {name}"

        # 2. 创建 Local/Global 节点
        # 必须清理 kwargs 防止参数污染
        var_kwargs = kwargs.copy()
        var_kwargs.pop("name", None)
        var_kwargs.pop("type_full_name", None)

        current_scope = self.builder.scope_stack[-1] if self.builder.scope_stack else None
        is_global = False
        if hasattr(current_scope, 'label') and current_scope.label in ["FILE", "NAMESPACE_BLOCK", "TYPE_DECL"]:
            is_global = True

        var_node = None
        if is_global:
            var_node = self.builder.global_variable(name, type_name, **var_kwargs)
        else:
            var_node = self.builder.local_variable(name, type_name, **var_kwargs)

        # 处理 Static/Extern 修饰符
        storage = node.get("storage_class", "NONE")
        is_static = (storage == "STATIC") or node.get("is_static", False)
        if is_static: self.builder.attach_modifier(var_node, ModifierType.STATIC)
        if storage == "EXTERN": self.builder.attach_modifier(var_node, "EXTERN")

        # 3. 处理初始化表达式
        result_list = [var_node]
        children = node.get("children", [])

        # 寻找初始化节点 (过滤掉类型引用等杂项)
        init_expr_node = None
        if children:
            for child in children:
                if child.get("kind") not in ["TYPE_REF", "PARM_DECL", "ALIGNED_ATTR"]:
                    init_expr_node = child
                    break

        if init_expr_node:
            # A. 生成主赋值: var = init_expr (AST 完整性)
            rhs = self.visit(init_expr_node, attach_to_parent=False)
            if rhs:
                rhs.argument_index = 2
                lhs = self.builder.identifier(name, type_name, code=name, auto_ast=False)
                lhs.argument_index = 1
                self.builder.graph.add_ref_edge(lhs, var_node)

                assign_code = f"{name} = {getattr(rhs, 'code', '...')}"
                assign_kwargs = kwargs.copy()
                assign_kwargs["code"] = assign_code
                assign_kwargs.pop("name", None)
                if "order" in kwargs: assign_kwargs["order"] = kwargs["order"]

                main_assign = self.builder.assignment(lhs, rhs, **assign_kwargs)
                result_list.append(main_assign)

            # B. 结构体展开逻辑 (Data Flow Enhancement)
            if init_expr_node.get("kind") == "INIT_LIST_EXPR":
                field_assignments = self._unfold_init_list(
                    base_var_name=name,
                    base_var_node=var_node,
                    init_node=init_expr_node,
                    base_order=kwargs.get("order", 0)
                )
                if field_assignments:
                    result_list.extend(field_assignments)

        return result_list

    def _unfold_init_list(self, base_var_name: str, base_var_node, init_node: Dict[str, Any], base_order: int):
        """
        将 INIT_LIST_EXPR 拆解为 my_ops.read = func_ptr 形式的赋值。
        """
        assignments = []
        children = init_node.get("children", [])
        current_order = base_order + 1

        for child in children:
            # 只处理显式指定字段的初始化 (.field = value)
            if child.get("kind") == "DESIGNATED_INIT_EXPR":

                # 1. 提取字段名和值
                field_name, value_node = self._extract_designator_and_value(child)

                if not field_name or not value_node:
                    continue

                # 2. 构建 RHS (值)
                rhs = self.visit(value_node, attach_to_parent=False)
                if not rhs: continue
                rhs.argument_index = 2

                # 3. 构建 LHS (字段访问: base.field)
                lhs_code = f"{base_var_name}.{field_name}"

                # 3.1 Base Identifier
                base_id = self.builder.identifier(base_var_name, "ANY", code=base_var_name, auto_ast=False)
                base_id.argument_index = 1
                self.builder.graph.add_ref_edge(base_id, base_var_node)

                # 3.2 Field Identifier
                field_id = self.builder.field_identifier(field_name, code=field_name)
                field_id.argument_index = 2

                # 3.3 Field Access Call
                lhs = self.builder.call(
                    name=Operators.fieldAccess,
                    method_full_name=Operators.fieldAccess,
                    args=[base_id, field_id],
                    code=lhs_code,
                    dispatch_type=DispatchType.STATIC_DISPATCH,
                    auto_ast=False
                )
                lhs.argument_index = 1

                # 4. 构建赋值 Assignment
                assign_code = f"{lhs_code} = {getattr(rhs, 'code', '...')}"
                assign_node = self.builder.assignment(
                    lhs, rhs,
                    code=assign_code,
                    order=current_order
                )

                assignments.append(assign_node)
                current_order += 1

        return assignments

    def _extract_designator_and_value(self, node: Dict[str, Any]):
        """
        提取字段名和值。
        如果这不是一个结构体字段初始化 (即找不到 .field)，返回 field_name=None。
        """
        children = node.get("children", [])
        if not children: return None, None  # 安全检查

        # 1. 尝试从 Exporter 增强数据获取 (这是处理结构体字段的主力)
        field_name = node.get("designator_field")

        # 2. 兜底 (仅当 Exporter 漏了且 spelling 确实以点开头时生效)
        if not field_name:
            raw_spelling = node.get("spelling", "")
            if raw_spelling and raw_spelling.startswith("."):
                field_name = raw_spelling[1:]

        # 3. 获取值
        value_node = children[-1]

        return field_name, value_node

    def handle_field_decl(self, node: Dict[str, Any], **kwargs):
        """Struct/Class Member"""
        name = node.get("spelling", "")
        # 优先取 kwargs 里的 type (来自 metadata extraction)，没有则 ANY
        type_name = kwargs.get("type_full_name", "ANY")

        is_bitfield = node.get("is_bitfield", False)
        if is_bitfield and "code" not in kwargs:
            width = node.get("bitfield_width")
            if width is not None:
                kwargs["code"] = f"{type_name} {name} : {width}"

        kwargs.pop("name", None)
        kwargs.pop("type_full_name", None)

        member = self.builder.add_member(name, type_name, **kwargs)

        # Access Modifier 处理
        access = node.get("access_specifier", "PUBLIC")
        mod = ModifierType.PUBLIC
        if access == "PRIVATE":
            mod = ModifierType.PRIVATE
        elif access == "PROTECTED":
            mod = ModifierType.PROTECTED
        self.builder.attach_modifier(member, mod)

        return member

    # ==========================================================
    # Handlers: Statements
    # ==========================================================

    def handle_block(self, node: Dict[str, Any], **kwargs):
        kwargs.setdefault("code", "{ ... }")
        kwargs.pop("name", None)

        with self.builder.block(**kwargs) as block:
            self._visit_children(node)
        return block

    def handle_decl_stmt(self, node: Dict[str, Any], **kwargs):
        # 容器节点，透传
        self._visit_children(node)
        return None

    def handle_asm(self, node: Dict[str, Any], **kwargs):
        kwargs.setdefault("code", "asm(...)")
        kwargs.pop("name", None)

        # 3. 调用 Call
        return self.builder.call(
            name=Operators.asm,
            method_full_name=Operators.asm,
            args=[],
            **kwargs
        )

    def handle_return(self, node: Dict[str, Any], **kwargs):
        kwargs.setdefault("code", "return ...")
        kwargs.pop("name", None)

        ret = self.builder.return_statement(**kwargs)

        children = node.get("children", [])
        if children:
            # 3. 访问返回值表达式
            # 注意：Attach=False，因为我们要手动控制连边类型
            val = self.visit(children[0], attach_to_parent=False)

            if val:
                # 4. 手动连线
                # AST 边：表示语法包含关系
                self.builder.graph.add_ast_edge(ret, val)

                # ARGUMENT 边：表示数据流向 (Ret 使用了 Val)
                self.builder.graph.add_edge(ret, val, EdgeType.ARGUMENT)

                # 确保 argument_index 存在
                # 这对 Dataflow Tracker 很重要，它通常追踪 index=1 的数据流出
                if getattr(val, "argument_index", None) is None:
                    val.argument_index = 1

        return ret

    def handle_if(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "if (...)")
        kwargs.setdefault("code", f"{name}")
        kwargs.pop("name", None)

        with self.builder.control_structure(ControlStructureType.IF, **kwargs) as if_n:
            self._visit_children(node)
        return if_n

    def handle_for(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "for (...)")
        kwargs.setdefault("code", f"{name}")
        kwargs.pop("name", None)
        with self.builder.control_structure(ControlStructureType.FOR, **kwargs) as for_n:
            self._visit_children(node)
        return for_n

    def handle_while(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "while (...)")
        kwargs.setdefault("code", f"{name}")
        kwargs.pop("name", None)

        with self.builder.control_structure(ControlStructureType.WHILE, **kwargs) as while_n:
            self._visit_children(node)
        return while_n

    def handle_do_while(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "do ... while (...)")
        kwargs.setdefault("code", f"{name}")
        kwargs.pop("name", None)

        with self.builder.control_structure(ControlStructureType.DO, **kwargs) as do_n:
            self._visit_children(node)
        return do_n

    def handle_switch(self, node: Dict[str, Any], **kwargs):
        name = node.get("spelling", "switch (...)")
        kwargs.setdefault("code", f"{name}")
        kwargs.pop("name", None)

        with self.builder.control_structure(ControlStructureType.SWITCH, **kwargs) as sw_n:
            self._visit_children(node)
        return sw_n

    def handle_case(self, node: Dict[str, Any], **kwargs):
        # 1. 准备 Code
        kwargs.setdefault("code", "case...")

        # 2. [Critical] 清理 name
        # Builder.jump_target 需要 name 参数，我们手动指定为 "case" 或具体的 value
        # 防止 kwargs['name'] 冲突
        kwargs.pop("name", None)

        # 3. 创建节点
        # name 建议包含具体值以区分不同的 case (如 "case 1"), 但如果没有值，"case" 也行
        target = self.builder.jump_target("case", **kwargs)

        # 4. 遍历子节点 (Case 的执行体)
        self._visit_children(node)
        return target

    def handle_default(self, node: Dict[str, Any], **kwargs):
        kwargs.setdefault("code", "default")

        # [Critical] 清理 name
        kwargs.pop("name", None)

        target = self.builder.jump_target("default", **kwargs)
        self._visit_children(node)
        return target

    def handle_goto(self, node: Dict[str, Any], **kwargs):
        # Goto 的 spelling 通常是它要跳转的 Label 名字
        label_name = "<unknown>"
        children = node.get("children", [])
        if children:
            label_name = children[0].get("spelling", "<unknown>")

        # 1. 准备 Code
        kwargs.setdefault("code", f"goto {label_name}")

        # 2. [Critical] 移除 name
        # builder.jump_statement(name, ...) 中的 name 是 ControlStructureType (即 GOTO)
        # 如果不移除 kwargs['name'] (也就是 label_name)，会引发冲突
        kwargs.pop("name", None)

        return self.builder.jump_statement(ControlStructureType.GOTO, **kwargs)

    def handle_label(self, node: Dict[str, Any], **kwargs):
        # Label 的 spelling 就是标签名，如 "error_exit"
        name = node.get("spelling", "<anon>")

        kwargs.setdefault("code", f"{name}:")

        # [Critical] 虽然这里 name 就是我们想要的，
        # 但为了适配 Builder 的显式位置参数，还是 pop 出来传给位置参数更安全
        kwargs.pop("name", None)

        target = self.builder.jump_target(name, **kwargs)
        self._visit_children(node)
        return target

    # ==========================================================
    # Handlers: Expressions
    # ==========================================================

    def handle_call(self, node: Dict[str, Any], **kwargs):
        """
        [Corrected] 标准函数调用处理逻辑。
        遵循 Zero-Inference: 信任 children[0] 是 Callee, children[1:] 是 Args。
        """
        children = node.get("children", [])
        if not children: return None

        # ---------------------------------------------------------
        # 1. 结构分离 & 访问子节点
        # ---------------------------------------------------------
        # Child[0]: 永远是 Callee (函数引用 / 成员访问 / 指针)
        # 必须 visit 它！否则图中会缺少 "被调用者" 节点
        callee_node = self.visit(children[0], attach_to_parent=False)

        # Child[1:]: 参数列表
        cpg_args = []
        for arg_dict in children[1:]:
            # visit 会自动处理 argument_index (如果 Exporter 提供了)
            arg = self.visit(arg_dict, attach_to_parent=False)
            if arg:
                cpg_args.append(arg)

        # ---------------------------------------------------------
        # 2. 准备元数据
        # ---------------------------------------------------------
        # 优先取 CallExpr 自身的 spelling (函数名)
        # 如果没有，尝试从 Callee 节点取 name/code
        name = node.get("spelling")
        if not name:
            if callee_node:
                name = getattr(callee_node, "name", None) or getattr(callee_node, "code", None)

            if not name:
                name = "<indirect>"

        if "code" not in kwargs:
            callee_code = getattr(callee_node, "code", None) or name
            arg_codes = []
            for a in cpg_args:
                c = getattr(a, "code", None)
                arg_codes.append(c if c is not None else "...")

            args_str = ", ".join(arg_codes)
            kwargs["code"] = f"{callee_code}({args_str})"

        # ---------------------------------------------------------
        # 3. 确定 Dispatch Type & Receiver
        # ---------------------------------------------------------
        dispatch_type = node.get("dispatch_type", DispatchType.STATIC_DISPATCH)

        receiver = None
        callee_kind = children[0].get("kind", "")

        # 简单的启发式：如果是成员访问，它就是 Receiver 边指向的对象
        if "MEMBER" in callee_kind:
            receiver = callee_node
            # 如果 Exporter 明确标记了 dispatch_type，这里应该已经是 DYNAMIC_DISPATCH
            if "dispatch_type" not in node:
                dispatch_type = DispatchType.DYNAMIC_DISPATCH

        # ---------------------------------------------------------
        # 4. 构建 Call Node
        # ---------------------------------------------------------

        safe_name = name if name is not None else "<unknown>"
        call_node = self.builder.call(
            name=safe_name,
            method_full_name=name,
            args=cpg_args,
            dispatch_type=dispatch_type,
            receiver=receiver,
            **kwargs
        )

        # [Edge Case Correction]
        # 如果 callee_node 存在，但没有被设为 receiver (例如普通函数调用 foo())，
        # 那么它目前是游离的（没有连到 Call Node）。我们需要手动连 AST 边。
        if callee_node and receiver is not callee_node:
            self.builder.graph.add_ast_edge(call_node, callee_node)
            # 对于 C++ Functor 或函数指针调用，这很重要

        return call_node

    def handle_binary_operator(self, node: Dict[str, Any], **kwargs):
        children = node.get("children", [])
        if len(children) < 2: return None

        # 访问子节点 (Zero-Inference: 信任 Exporter 的顺序)
        lhs = self.visit(children[0], attach_to_parent=False)
        rhs = self.visit(children[1], attach_to_parent=False)

        if not lhs or not rhs: return None

        op_code = node.get("opcode", "<op>")

        # 映射表
        op_map = {
            "=": Operators.assignment,
            "+": Operators.addition,
            "-": Operators.subtraction,
            "*": Operators.multiplication,
            "/": Operators.division,
            "%": Operators.modulo,
            "==": Operators.equals,
            "!=": Operators.notEquals,
            "<": Operators.lessThan,
            ">": Operators.greaterThan,
            "<=": Operators.lessEqualsThan,
            ">=": Operators.greaterEqualsThan,
            "&&": Operators.logicalAnd,
            "||": Operators.logicalOr,
            "&": Operators.and_,
            "|": Operators.or_,
            "^": Operators.xor,
            "<<": Operators.shiftLeft,
            ">>": Operators.arithmeticShiftRight,
            ",": Operators.comma,  # 建议给逗号表达式一个明确的名字
        }
        method_name = op_map.get(op_code, op_code)

        # 使用 setdefault 设置默认 code
        # 如果 Metadata 里没有 code，我们用 "lhs op rhs" 作为兜底
        # 注意：这里 lhs.code 可能是 None，所以要做防空处理
        l_code = getattr(lhs, 'code', '...')
        r_code = getattr(rhs, 'code', '...')
        kwargs.setdefault("code", f"{l_code} {op_code} {r_code}")

        return self.builder.binary_op(lhs, rhs, operator=method_name, **kwargs)

    def handle_unary_operator(self, node: Dict[str, Any], **kwargs):
        children = node.get("children", [])
        if not children: return None

        operand = self.visit(children[0], attach_to_parent=False)
        if not operand: return None

        op_code = node.get("opcode", "<op>")

        # 精确映射表
        op_map = {
            "&": Operators.addressOf,
            "*": Operators.indirection,
            "!": Operators.logicalNot,
            "~": Operators.not_,
            "+": Operators.plus,
            "-": Operators.minus,
            "++": Operators.preIncrement,
            "--": Operators.preDecrement,
            "++(post)": Operators.postIncrement,
            "--(post)": Operators.postDecrement
        }

        # 映射逻辑简化：优先查表，查不到用原值
        # 如果 op_code 是 "++" 且没有 (post) 后缀，默认视为前缀
        method_name = op_map.get(op_code, op_code)

        # [Optimization] Code 生成兜底
        op_c = getattr(operand, 'code', '...')
        # 简单的启发式 Code 生成
        if "post" in str(method_name).lower():
            default_code = f"{op_c}{op_code.replace('(post)', '')}"
        else:
            default_code = f"{op_code}{op_c}"

        kwargs.setdefault("code", default_code)

        return self.builder.unary_op(operand, operator=method_name, **kwargs)

    def handle_conditional(self, node: Dict[str, Any], **kwargs):
        """
        Ternary: a ? b : c
        Elvis:   a ?: c  (GNU Extension)
        """
        # 1. 移除 kwargs 中的 name
        kwargs.pop("name", None)

        children = node.get("children", [])
        args = []

        # 2. 收集参数
        for child in children:
            res = self.visit(child, attach_to_parent=False)
            if res:
                args.append(res)

        # 3. [Logic]
        # Elvis 操作符 (x ?: y) -> 缺少 True Branch
        if len(args) == 2:
            # args[0] 是 Condition (Index 1)
            # args[1] 是 False Branch (默认 Index 2 -> 修正为 3)
            if getattr(args[1], "argument_index", None) is None:
                args[1].argument_index = 3

        # 4. 简单的代码生成兜底
        if "code" not in kwargs:
            # 简单的启发式生成，方便调试
            if len(args) == 3:
                kwargs["code"] = "cond ? true : false"
            elif len(args) == 2:
                kwargs["code"] = "cond ?: false"
            else:
                kwargs["code"] = Operators.conditional

        return self.builder.call(
            name=Operators.conditional,
            method_full_name=Operators.conditional,
            args=args,
            **kwargs
        )

    def handle_init_list(self, node: Dict[str, Any], **kwargs):
        """
        初始化列表: int a[] = {1, 2} 或 struct p = {.x=1};
        映射为 <operator>.arrayInitializer Call
        """
        # 1. 访问所有子节点
        # 信任 Exporter：子节点 (DesignatedInitExpr 或 Literal)
        # 已经自带了 argument_index，Builder 会自动保留它。
        children = node.get("children", [])
        args = [self.visit(c, attach_to_parent=False) for c in children]
        args = [a for a in args if a] # 过滤无效节点

        # 2. 默认 Code
        kwargs.setdefault("code", "{...}")

        # 3. 调用 Builder
        return self.builder.call(
            name=Operators.arrayInitializer,
            method_full_name=Operators.arrayInitializer,
            args=args,
            **kwargs
        )

    def handle_sizeof(self, node: Dict[str, Any], **kwargs):
        """
        处理 sizeof(expression) 或 sizeof(type)
        """
        children = node.get("children", [])
        if not children: return None

        child = children[0]
        arg_node = None

        # 1. 判定子节点是"类型"还是"表达式"
        # 这种简单的字符串判定在 Clang JSON 中是足够健壮的
        child_kind = child.get("kind", "")

        if "TYPE" in child_kind or "DECL" in child_kind:
            # Case A: sizeof(int), sizeof(struct A) -> 子节点是 Type
            # 我们需要提取类型名，并将其封装为一个 Literal 节点
            type_info = child.get("type", {})
            type_name = type_info.get("canonical") or type_info.get("fullname") or child.get("spelling", "unknown_type")

            # 创建代表类型的 Literal (CPG 中 Expression 必须是节点)
            arg_node = self.builder.literal(
                code=type_name,
                type_full_name="<meta>",
                auto_ast=False
            )
        else:
            # Case B: sizeof(var), sizeof(1+1) -> 子节点是 Expression
            # 正常递归访问
            arg_node = self.visit(child, attach_to_parent=False)

        # 2. 组装参数
        args = [arg_node] if arg_node else []

        # 3. 默认 Code
        kwargs.setdefault("code", "sizeof(...)")

        # 4. 调用 Builder
        return self.builder.call(
            name=Operators.sizeOf,
            method_full_name=Operators.sizeOf,
            args=args,
            **kwargs
        )

    def handle_literal(self, node: Dict[str, Any], **kwargs):
        # type_full_name and code are already in kwargs
        return self.builder.literal(**kwargs)

    def handle_decl_ref(self, node: Dict[str, Any], **kwargs):
        """处理 DECL_REF_EXPR -> 生成 IDENTIFIER 节点"""

        kwargs.setdefault("type_full_name", "ANY")
        kwargs.setdefault("name", node.get("spelling", ""))
        kwargs.setdefault("code", kwargs["name"])

        return self.builder.identifier(**kwargs)

    def handle_member_expr(self, node: Dict[str, Any], **kwargs):
        """
        处理 MEMBER_EXPR -> x.y 或 x->y
        """
        # 1. 获取显式参数
        # 注意：field_name 虽然也在 kwargs['name'] 里，但作为位置参数提取出来更清晰
        field_name = node.get("spelling", "<anon>")

        # 2. 访问 Base (第一个子节点)
        children = node.get("children", [])
        base = None
        if children:
            base = self.visit(children[0], attach_to_parent=False)

        if base:
            is_arrow = node.get("is_arrow", False)

            # 3. 准备 Code (仅当上游未提供时)
            # 这里的 base.code 可能还不可用，暂用占位符
            op = "->" if is_arrow else "."
            kwargs.setdefault("code", f"base{op}{field_name}")

            # 4. 调用 Builder
            # 此时 kwargs 里依然包含 {'name': field_name}，
            if is_arrow:
                return self.builder.indirect_field_access(base, field_name, **kwargs)
            else:
                return self.builder.field_access(base, field_name, **kwargs)

        return None

    def handle_array_access(self, node: Dict[str, Any], **kwargs):
        """
        处理 ARRAY_SUBSCRIPT_EXPR -> a[i]
        """
        children = node.get("children", [])

        # 1. 检查子节点完整性
        if len(children) >= 2:
            # 2. 访问 Base 和 Index
            base = self.visit(children[0], attach_to_parent=False)
            idx = self.visit(children[1], attach_to_parent=False)

            if base and idx:
                # 3. 准备 Code
                kwargs.setdefault("code", "base[idx]")
                return self.builder.index_access(base, idx, **kwargs)

        return None

    def handle_wrapper_pass_through(self, node: Dict[str, Any], **kwargs):
        """
        [Final Strategy] 智能透传与逗号表达式算子。

        策略:
        1. Single Child (1:1): 完美透传，继承 Order/Index，消除 Wrapper。
        2. Multi Children (1:N): 构造 <operator>.comma，保留副作用，返回最后一个值。
        """
        children = node.get("children", [])
        if not children:
            return None

        # ---------------------------------------------------------
        # Case A: 1:1 完美透传 (保持你原有的逻辑)
        # ---------------------------------------------------------
        if len(children) == 1:
            child_dict = children[0]

            # Context Injection: 继承 Wrapper 的位置信息
            wrapper_idx = kwargs.get("argument_index")
            if wrapper_idx is not None and "argument_index" not in child_dict:
                child_dict["argument_index"] = wrapper_idx

            wrapper_order = kwargs.get("order")
            if wrapper_order is not None:
                child_dict["order"] = wrapper_order

            # 递归访问，保持原本的 attach 意图
            return self.visit(child_dict, attach_to_parent=kwargs.get("auto_ast", True))

        # ---------------------------------------------------------
        # Case B: 1:N 容器 -> <operator>.comma
        # ---------------------------------------------------------
        # 场景：Statement Expression 或 复杂宏展开 ({ A; B; C; })
        # 目标：生成一个 CallNode，表示 (A, B, C)
        else:
            comma_args = []

            # 1. 收集所有子节点作为参数
            # [关键] attach_to_parent=False
            # 我们不希望这些子节点直接挂在 Wrapper 的父节点下，
            # 而是希望它们挂在即将创建的 Comma CallNode 下作为 ARGUMENT。
            for child_dict in children:
                # 注意：这里我们不注入 Wrapper 的 Order，让子节点保持自己的相对顺序
                # visit 返回的是 CPG Node
                arg_node = self.visit(child_dict, attach_to_parent=False)
                if arg_node:
                    comma_args.append(arg_node)

            if not comma_args:
                return None

            # 2. 准备 Comma Operator 的属性
            # 继承 Wrapper 的所有元数据 (Order, Index, Line Number 等)
            # 因为这个 Comma Node 将在 AST 中由 Wrapper 的位置
            call_kwargs = kwargs.copy()

            # 设置兜底 Code (如果 Exporter 没提供)
            call_kwargs.setdefault("code", "(...)")

            # 清理可能冲突的字段
            call_kwargs.pop("name", None)
            call_kwargs.pop("method_full_name", None)

            # 3. 创建 <operator>.comma 节点
            # 这个节点代表了整个 Wrapper 表达式
            comma_node = self.builder.call(
                name=Operators.comma,
                method_full_name=Operators.comma,
                args=comma_args,
                **call_kwargs
            )

            # 注意：self.builder.call 内部通常会处理 auto_ast (attach_to_parent)
            # 如果你的 builder.call 没有利用 kwargs['auto_ast'] 自动挂载，
            # 并且 visit 的调用方期望返回后手动挂载，那么返回 comma_node 即可。

            return comma_node