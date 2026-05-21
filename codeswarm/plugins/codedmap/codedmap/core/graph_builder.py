# codedmap/core/graph_builder.py

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional, Union, Any

from .diagnostics import CollisionInvestigator
from .schema.graph.base import AstNode, CPGNode
from .schema.graph.container import CPGGraph, AnyNode
from .schema.graph.enums import ControlStructureType, DispatchType, EdgeType, Language, ModifierType, NodeLabel, safe_str_to_enum
from .schema.graph.operators import Operators

from .schema.graph.nodes import (
    CommentNode, DirectoryNode, ModuleNode, FieldIdentifierNode, FileNode, JumpTargetNode,
    MethodNode, MethodParameterOutNode,
    MethodRefNode, MethodReturnNode, BlockNode, CallNode, IdentifierNode, LiteralNode,
    LocalNode, NamespaceBlockNode, ReturnNode, MethodParameterInNode, Expression,
    ImportNode, TypeDeclNode, MemberNode, ModifierNode, ControlStructureNode,
    MetaDataNode, UnknownNode
)

logger = logging.getLogger(__name__)

# 定义可以被引用的节点类型 (用于符号表解析)
RefableNode = Union[LocalNode, MethodParameterInNode]


class CPGBuilder:
    """
    CPG 构建器 (Core Component)

    [Best Practices Adopted]:
    1. Immutable ID Awareness: 自动注入 file_name 到 kwargs，确保 Deterministic ID 能够生成。
    2. Lazy Loading Friendly: 'code' 字段默认为 None。除非 Parser 显式提供，否则不生成冗余代码字符串。
    3. Kwargs Passthrough: 允许 Parser 灵活传递 line, column, offset, order 等元数据。
    """

    def __init__(self, graph: Optional[CPGGraph] = None):
        self.graph = graph if graph else CPGGraph()
        self.scope_stack: List[AstNode] = []
        self.symbol_table_stack: List[Dict[str, RefableNode]] = []
        # 用于缓存 FileNode 和 TypeDecl 等，避免重复创建
        self._semantic_cache: Dict[str, AnyNode] = {}
        self._directory_cache: Dict[str, DirectoryNode] = {}
        self._module_cache: Dict[str, ModuleNode] = {}

    # =========================================================================
    # Lifecycle & IO
    # =========================================================================

    def reset(self):
        self.graph = CPGGraph()
        self.scope_stack = []
        self.symbol_table_stack = []
        self._semantic_cache.clear()
        self._directory_cache.clear()
        self._module_cache.clear()

    def get_graph(self) -> CPGGraph:
        return self.graph

    def to_json(self, indent: int = 2, exclude_none: bool = True) -> str:
        return self.graph.model_dump_json(
            indent=indent,
            exclude_none=exclude_none
        )

    def save_to_file(self, file_path: str, encoding: str = 'utf-8'):
        json_content = self.to_json()
        with open(file_path, 'w', encoding=encoding) as f:
            f.write(json_content)

    # =========================================================================
    # Core Logic
    # =========================================================================

    def _prepare_node_kwargs(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """
        自动注入上下文信息：
        1. file_name (用于 ID 生成)
        2. astParentType (用于 Linker 作用域判断)
        3. astParentFullName (用于调试和高级链接)
        """

        # 1. 注入 file_name (现有逻辑)
        if "file_name" not in kwargs and "fileName" not in kwargs:
            current_file = self._get_current_file()
            if current_file and current_file.full_name:
                kwargs["file_name"] = current_file.full_name

        # 2. 注入 astParentType
        # 只有当调用者没显式传，且当前有作用域时才注入
        if "astParentType" not in kwargs and self.scope_stack:
            parent = self.scope_stack[-1]

            # 处理 Label 可能是 Enum 的情况
            label_val = parent.label
            if hasattr(label_val, 'value'):
                label_val = label_val.value

            kwargs["astParentType"] = str(label_val)

            # 3. 注入 astParentFullName (Optional, 但对 C++ Linker 很有用)
            # 如果父节点有 fullName (如 Namespace, TypeDecl, Method)，传下去
            if "astParentFullName" not in kwargs:
                parent_full_name = getattr(parent, "fullName", None) or getattr(parent, "full_name", None)
                if parent_full_name:
                    kwargs["astParentFullName"] = parent_full_name

        return kwargs

    def _sanitize_kwargs(self, kwargs: Dict[str, Any], exclude_keys: List[str]) -> Dict[str, Any]:
        """
        清洗 kwargs，移除那些我们准备显式传递的参数，防止 Pydantic 报错。
        """
        for key in exclude_keys:
            if key in kwargs:
                kwargs.pop(key)
        return kwargs

    def _add_node(self, node: AnyNode, auto_ast: bool = True) -> AnyNode:
        """
        [Optimization] 幂等去重与防自环 (Fixed Version)
        """
        # 定义允许复用的全局节点类型 (白名单)
        # 这些节点如果在图中已存在，我们认为是同一个实体，返回旧对象是安全的
        MERGEABLE_LABELS = {
            NodeLabel.FILE,
            NodeLabel.NAMESPACE_BLOCK,
            NodeLabel.TYPE_DECL,
            NodeLabel.METHOD,
            NodeLabel.METHOD_RETURN,
            NodeLabel.META_DATA
        }

        # 1. 检查是否存在 (去重 vs 冲突)
        if node.id in self.graph.nodes:
            existing_node = self.graph.nodes[node.id]

            # [Check 1] Label 不一致 -> 严重哈希碰撞
            if existing_node.label != node.label:
                logger.error(f"[ID COLLISION] Critical Label Mismatch! ID: {node.id}")
                logger.error(f"  Existing: {existing_node.label} | New: {node.label}")
                raise RuntimeError(f"ID Collision: {existing_node.label} vs {node.label}")

            # [Check 2] 决定是 "复用" 还是 "强制分离"
            if node.label in MERGEABLE_LABELS:
                # 这是一个全局定义节点，允许复用 (Merge)
                # (可选) 检查参数顺序一致性
                if "PARAMETER" in str(node.label):
                    old_order = getattr(existing_node, 'order', -1)
                    new_order = getattr(node, 'order', -1)
                    if old_order != new_order:
                        raise RuntimeError(f"Param ID Collision: Order mismatch {old_order} vs {new_order}")

                return existing_node

            else:
                # 这是一个 AST 结构节点 (如 CALL, BLOCK)，严禁复用！
                # 如果 ID 撞了，说明是 Hash 碰撞 (Parent ID == Child ID)。
                # 必须生成新 ID，作为独立节点插入。

                new_id = CollisionInvestigator.generate_salted_id(
                    node,
                    salt_seed=f"AntiLoop_{len(self.graph.nodes)}"
                )
                #logger.warning(f"⚡ [Anti-Merge] Node {node.label} node.order: {node.order}  collided with ID {node.id}. Forcing New ID: {new_id}")

                # 修改当前节点 ID (使其成为一个全新的节点)
                node.id = new_id


        # 2. 检查父节点 (防自环 - 二次防线)
        parent = self.scope_stack[-1] if self.scope_stack else None

        # 如果经过上面的 Anti-Merge 处理，ID 居然还和 Parent 一样 (概率极低)，再修一次
        if parent and parent.id == node.id:
            new_id = CollisionInvestigator.generate_salted_id(node, salt_seed=f"ChildOf_{parent.id}")
            logger.warning(f"🔧 [Auto-Healing] Parent-Child ID Conflict. Mutating Child ID {node.id} -> {new_id}")
            node.id = new_id

        # 3. 添加节点 (此时 node 保证是唯一对象，且 ID 唯一)
        self.graph.add_node(node)

        # 4. 连 AST 边
        if auto_ast and isinstance(node, AstNode) and parent:
            # 这里的 remove_node 逻辑其实已经由上面的步骤涵盖了，但为了健壮性保留
            if parent.id == node.id:
                # 这段逻辑理论上不可达，除非 generate_salted_id 失效
                pass

            self.graph.add_ast_edge(parent, node)

        return node

    def _reassign_node_id(self, node: AnyNode, salt_seed: str) -> None:
        """
        [Safe] 重新分配节点 ID 以解决碰撞。

        如果该节点对象当前在图中，使用 relocate_node_id 保留所有已建立的边。
        如果该节点不在图中（或图中该 ID 对应的是另一个对象），仅更新 ID 属性。
        """
        new_id = CollisionInvestigator.generate_salted_id(node, salt_seed=salt_seed)
        if node.id is not None and node.id in self.graph.nodes and self.graph.nodes[node.id] is node:
            self.graph.relocate_node_id(node.id, new_id)
        else:
            node.id = new_id

    def enter_scope(self, node: AstNode):
        self.scope_stack.append(node)
        self.symbol_table_stack.append({})

    def exit_scope(self):
        if self.scope_stack:
            self.scope_stack.pop()
        if self.symbol_table_stack:
            self.symbol_table_stack.pop()

    def _resolve_symbol(self, name: str) -> Optional[RefableNode]:
        for table in reversed(self.symbol_table_stack):
            if name in table:
                return table[name]
        return None

    def _get_current_file(self) -> Optional[FileNode]:
        for node in reversed(self.scope_stack):
            if isinstance(node, FileNode):
                return node
        return None

    def _get_scope_prefix(self) -> str:
        if not self.scope_stack: return ""
        parent = self.scope_stack[-1]
        if isinstance(parent, TypeDeclNode):
            return parent.full_name + "."
        elif isinstance(parent, NamespaceBlockNode):
            if parent.name == "<global>": return parent.full_name + ":"
            return parent.full_name + "."
        elif isinstance(parent, FileNode):
            return parent.full_name + ":"
        return ""

    def is_variable_defined(self, name: str) -> bool:
        return self._resolve_symbol(name) is not None

    # =========================================================================
    # Context Managers
    # =========================================================================

    @contextmanager
    def program_root(self):
        # <global> 通常没有 order，也没有 file_name
        node = NamespaceBlockNode(name="<global>", fullName="<global>", code="<global>")
        node = self._add_node(node, auto_ast=False)
        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def file(self, name: str, language: Language, **kwargs):
        """
        文件作用域。
        
        Args:
            name: 文件路径
            language: 源文件语言类型 (C, CPP, PYTHON 等)
            **kwargs: 其他 FileNode 属性
        """
        path_obj = Path(name)
        file_path_str = path_obj.as_posix()
        display_name = path_obj.name

        if file_path_str in self._semantic_cache:
            node = self._semantic_cache[file_path_str]
            if node.id not in self.graph.nodes:
                self.graph.add_node(node)
        else:
            node = FileNode(
                name=display_name,
                fullName=file_path_str,
                language=language,
                **kwargs
            )
            node = self._add_node(node, auto_ast=False)
            self._ensure_directory_structure(name, node)
            self._semantic_cache[file_path_str] = node

        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def namespace_block(self, name: str, **kwargs):
        """命名空间"""
        current_file = self._get_current_file()
        if name == "<global>" and current_file:
            full_name = f"{current_file.full_name}:{name}"
        else:
            prefix = self._get_scope_prefix()
            full_name = prefix + name

        if full_name in self._semantic_cache:
            node = self._semantic_cache[full_name]
        else:
            # kwargs 注入 (file_name 等)
            kwargs = self._prepare_node_kwargs(kwargs)
            # Namespace code 默认为空或 name，通常不需要懒加载
            code = kwargs.pop('code', "")

            node = NamespaceBlockNode(name=name, fullName=full_name, code=code, **kwargs)
            node = self._add_node(node)
            if current_file:
                self.graph.add_edge(node, current_file, EdgeType.SOURCE_FILE)
            self._semantic_cache[full_name] = node

        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def method(self, name: str, signature: str = "", code: Optional[str] = None,
               return_type_full_name: str = "void", **kwargs):
        """
        方法定义。
        [ID Requirement]: Method ID 依赖 fullName, signature, fileName.
        """
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        kwargs.pop("name", None)

        prefix = self._get_scope_prefix()
        method_full_name = prefix + name

        kwargs.pop("signature", None)
        kwargs.pop("fullName", None)

        # Code 默认为 None，支持 SourceManager 懒加载
        node = MethodNode(
            name=name,
            fullName=method_full_name,
            signature=signature,
            code=code,
            **kwargs
        )

        node = self._add_node(node, auto_ast=auto_ast)

        # Modifiers
        if kwargs.get("is_static"): self.attach_modifier(node, ModifierType.STATIC)
        if kwargs.get("is_public", True): self.attach_modifier(node, ModifierType.PUBLIC)

        # MethodReturn (Formal Return Node)
        # 注意: MethodReturn 也需要 file_name 才能生成确定性 ID
        ret_kwargs = {"file_name": kwargs.get("file_name")}
        ret_kwargs.pop("name", None)
        ret_node = MethodReturnNode(
            name="RET",
            fullName=f"{method_full_name}.RET",
            typeFullName=return_type_full_name,
            code="RET",
            **ret_kwargs
        )
        self.graph.add_node(ret_node)
        self.graph.add_ast_edge(node, ret_node)

        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def type_decl(self, name: str, full_name: str, inherits: Optional[List[str]] = None, **kwargs):
        """类/结构体定义"""
        if inherits is None:
            inherits = []
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        if full_name in self._semantic_cache:
            node = self._semantic_cache[full_name]
            # 合并继承关系
            if inherits:
                existing = getattr(node, "inheritsFromTypeFullName", [])
                node.inheritsFromTypeFullName = list(set(existing + inherits))

            if node.id not in self.graph.nodes:
                self.graph.add_node(node)
        else:
            alias = kwargs.pop("alias_type_full_name", None)

            node = TypeDeclNode(
                name=name,
                fullName=full_name,
                inheritsFromTypeFullName=inherits,
                aliasTypeFullName=alias,
                **kwargs
            )

            node = self._add_node(node, auto_ast=auto_ast)

            current_file = self._get_current_file()
            if current_file:
                self.graph.add_edge(node, current_file, EdgeType.SOURCE_FILE, check_duplicates=True)
            self._semantic_cache[full_name] = node

        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def block(self, code: Optional[str] = None, **kwargs):
        """代码块"""
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        node = BlockNode(code=code, **kwargs)
        node = self._add_node(node, auto_ast=auto_ast)
        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    @contextmanager
    def control_structure(self, type_name: Union[str, ControlStructureType], code: Optional[str] = None, **kwargs):
        """控制流结构 (If, While, For...)"""
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        node = ControlStructureNode(
            controlStructureType=type_name,
            code=code,
            **kwargs
        )
        node = self._add_node(node, auto_ast=auto_ast)
        self.enter_scope(node)
        try:
            yield node
        finally:
            self.exit_scope()

    # =========================================================================
    # Helpers: 声明与依赖
    # =========================================================================

    def add_import(self, name: str, alias: str = None, is_system: bool = False, **kwargs):
        # Import 的 Code 通常比较短，可以直接生成，也可以 None
        code = kwargs.pop('code', None)
        if code is None:
            code = f"#include <{name}>" if is_system else f'#include "{name}"'
            if alias: code += f" as {alias}"

        kwargs = self._prepare_node_kwargs(kwargs)

        node = ImportNode(
            importedEntity=name,
            importedAs=alias,
            is_system_include=is_system,
            code=code,
            **kwargs
        )
        node = self._add_node(node, auto_ast=False)  # Import 手动连 INCLUDES

        if self.scope_stack and isinstance(self.scope_stack[-1], FileNode):
            self.graph.add_edge(self.scope_stack[-1], node, EdgeType.INCLUDES)
        return node

    def add_member(self, name: str, type_full_name: str, full_name: str = "", code: Optional[str] = None, **kwargs):
        if not full_name:
            full_name = self._get_scope_prefix() + name

        kwargs = self._prepare_node_kwargs(kwargs)

        node = MemberNode(
            name=name,
            fullName=full_name,
            typeFullName=type_full_name,
            code=code,  # Default None
            **kwargs
        )
        node = self._add_node(node, auto_ast=False)  # Member 手动连 AST/CONTAINS

        if self.scope_stack and isinstance(self.scope_stack[-1], TypeDeclNode):
            self.graph.add_edge(self.scope_stack[-1], node, EdgeType.AST)  # Member 应该是 AST 边
        return node

    def local_variable(self, name: str, type_full_name: str, code: Optional[str] = None, **kwargs):
        full_name = self._get_scope_prefix() + name
        kwargs = self._prepare_node_kwargs(kwargs)

        node = LocalNode(
            name=name,
            fullName=full_name,
            typeFullName=type_full_name,
            code=code,  # Default None
            **kwargs
        )
        node = self._add_node(node)

        if self.symbol_table_stack:
            self.symbol_table_stack[-1][name] = node
        return node

    def global_variable(self, name: str, type_full_name: str, code: Optional[str] = None, **kwargs):
        """定义全局变量"""
        kwargs = self._prepare_node_kwargs(kwargs)

        if self.scope_stack and isinstance(self.scope_stack[-1], FileNode):
            # 在 C/C++ 中，全局变量在 File 下表现为 AST 边连接的 Member 或者是 Global 标记的 Local?
            # 这里的实现视具体语言语义而定，Joern 通常将全局变量视为 Namespace 或 File 下的 Member/Local
            # 我们复用 MemberNode 但打上 GLOBAL 标签
            node = MemberNode(
                name=name,
                fullName=name,  # Global full name
                typeFullName=type_full_name,
                code=code,
                **kwargs
            )
            node = self._add_node(node, auto_ast=False)
            self.graph.add_ast_edge(self.scope_stack[-1], node)
        else:
            node = self.local_variable(name, type_full_name, code, **kwargs)

        self.attach_modifier(node, "STATIC")
        self.attach_modifier(node, "GLOBAL")
        return node

    def parameter(self, name: str, type_full_name: str, order: int, code: Optional[str] = None, **kwargs):
        full_name = self._get_scope_prefix() + name
        kwargs = self._prepare_node_kwargs(kwargs)

        kwargs.pop("order", None)
        kwargs.pop("name", None)

        # Node IN
        node_in = MethodParameterInNode(
            name=name,
            fullName=full_name,
            typeFullName=type_full_name,
            order=order,  # Order is crucial for ID
            code=code,
            **kwargs
        )
        node_in = self._add_node(node_in)

        # Node OUT
        node_out = MethodParameterOutNode(
            name=name,
            fullName=full_name,
            typeFullName=type_full_name,
            order=order,
            code=code,
            **kwargs
        )
        self.graph.add_node(node_out)

        #print(f"[DEBUG-ID] Checking Param '{name}' (Order {order})")
        #print(f"  > IN  Node: ID={node_in.id} | Label={getattr(node_in, 'label', 'N/A')} | FullName='{full_name}'")
        #print(f"  > OUT Node: ID={node_out.id} | Label={getattr(node_out, 'label', 'N/A')}")

        if node_in.id == node_out.id:
            print(f"  > [CRITICAL ERROR] ID COLLISION! IN and OUT have the same ID. They will overwrite each other!")

        self.graph.add_edge(node_in, node_out, EdgeType.PARAMETER_LINK)

        if self.scope_stack:
            # 参数挂在方法上
            self.graph.add_ast_edge(self.scope_stack[-1], node_out)

        if self.symbol_table_stack:
            self.symbol_table_stack[-1][name] = node_in
        return node_in

    def jump_target(self, name: str, code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        node = JumpTargetNode(name=name, code=code, **kwargs)
        return self._add_node(node, auto_ast=auto_ast)

    def jump_statement(self, name: str, code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        node = ControlStructureNode(controlStructureType=name.upper(), code=code, **kwargs)
        return self._add_node(node, auto_ast=auto_ast)

    def return_statement(self, code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        node = ReturnNode(code=code, **kwargs)
        return self._add_node(node, auto_ast=auto_ast)

    def comment(self, text: str, is_docstring: bool = False, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        # Comment 的 code 就是内容本身，通常不为 None
        node = CommentNode(
            code=text,
            is_docstring=is_docstring,
            label=NodeLabel.COMMENT,
            **kwargs
        )
        return self._add_node(node, auto_ast=auto_ast)

    def unknown_statement(self, code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)
        node = UnknownNode(code=code, parserTypeName="ANY", **kwargs)
        return self._add_node(node, auto_ast=auto_ast)

    # =========================================================================
    # Helpers: 表达式 (Expression)
    # [ID Note]: Expressions need (file_name + order + context) for ID.
    # =========================================================================

    def identifier(self, name: str, type_full_name: str = "ANY", code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        node = IdentifierNode(
            name=name,
            typeFullName=type_full_name,
            code=code,  # Parser should provide name as code if lazy loading unavailable
            **kwargs
        )
        node = self._add_node(node, auto_ast=auto_ast)

        definition = self._resolve_symbol(name)
        if definition:
            self.graph.add_ref_edge(node, definition)
        return node

    def literal(self, code: Optional[str] = None, type_full_name: str = "int", **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        # Literal 的 code 通常很短 (如 "10", "null")，建议 Parser 尽量显式赋值，否则 ID 生成可能受影响
        node = LiteralNode(code=code, typeFullName=type_full_name, **kwargs)
        return self._add_node(node, auto_ast=auto_ast)

    def call(self, name: str, method_full_name: str, args: Optional[List[Expression]] = None, code: Optional[str] = None,
             dispatch_type: Union[str, DispatchType] = DispatchType.STATIC_DISPATCH,
             receiver: Optional[Expression] = None, **kwargs):
        """
        """
        if args is None:
            args = []
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        self._sanitize_kwargs(kwargs, ["name", "methodFullName", "method_full_name"])
        final_dispatch_type = safe_str_to_enum(
            value=dispatch_type,
            enum_cls=DispatchType,
            default=DispatchType.STATIC_DISPATCH,
            context=f"CallNode({name})"
        )

        draft_node = CallNode(
            name=name,
            methodFullName=method_full_name,
            code=code,
            dispatchType=final_dispatch_type,
            **kwargs
        )

        # 1. 初次入库 (可能会自动建立 AST 边)
        node = self._add_node(draft_node, auto_ast=auto_ast)

        # [Phase 1] Receiver 冲突检测 (必须在 Argument 处理前)
        # 使用 _reassign_node_id 安全迁移，保留已建立的 AST 父边
        if receiver and receiver.id == node.id:
            self._reassign_node_id(node, salt_seed=f"ParentOfReceiver_{receiver.id}")

        valid_args = [arg for arg in args if arg is not None]

        # [Phase 2] Arguments 处理
        for i, arg in enumerate(valid_args):
            # ID Drift 修复: argument_index 赋值可能触发 Pydantic 重算 ID
            old_id = arg.id
            if getattr(arg, "argument_index", None) is None:
                arg.argument_index = i + 1
            if arg.id != old_id:
                self.graph.relocate_node_id(old_id, arg.id)

            # Argument-Call 碰撞修复: 保留 arg 的所有已有边 (REF 等)
            if arg.id == node.id:
                self._reassign_node_id(arg, salt_seed=f"ArgOf_{node.id}")
                # 如果 arg 不在图中 (被其他节点占用了该 ID)，重新入库
                if arg.id not in self.graph.nodes:
                    self.graph.add_node(arg)

            self.graph.add_edge(node, arg, EdgeType.ARGUMENT)
            self.graph.add_ast_edge(node, arg)

        # [Phase 3] 连接 Receiver
        if receiver:
            self.graph.add_edge(node, receiver, EdgeType.RECEIVER)
            self.graph.add_ast_edge(node, receiver)

        return node

    def method_ref(self, name: str, method_full_name: str, code: Optional[str] = None, **kwargs):
        auto_ast = kwargs.pop("auto_ast", True)
        kwargs = self._prepare_node_kwargs(kwargs)

        # [Fix 1] 清理显式字段冲突
        kwargs.pop("methodFullName", None)
        kwargs.pop("method_full_name", None)
        kwargs.pop("name", None)

        # [Fix 2] 智能处理类型
        # 这一行代码同时完成了"提取值"和"防止冲突"两个任务
        type_fn = kwargs.pop("type_full_name", kwargs.pop("typeFullName", "ANY"))

        node = MethodRefNode(
            code=code,
            methodFullName=method_full_name,
            typeFullName=type_fn,
            **kwargs
        )
        return self._add_node(node, auto_ast=auto_ast)

    def assignment(self, target: Expression, source: Expression, code: Optional[str] = None, **kwargs):
        # 赋值也是一个 Call，kwargs (包含 order) 直接透传
        kwargs.pop("name", None)
        return self.call(
            name=Operators.assignment,
            method_full_name=Operators.assignment,
            args=[target, source],
            code=code,
            **kwargs
        )

    # =========================================================================
    # Helpers: 特殊操作
    # =========================================================================

    def field_identifier(self, name: str, code: Optional[str] = None, **kwargs):
        # FieldIdentifier 是 Call 的一部分，但也需要 ID
        kwargs = self._prepare_node_kwargs(kwargs)
        node = FieldIdentifierNode(canonicalName=name, code=code, **kwargs)
        return self._add_node(node, auto_ast=False)

    def field_access(self, base: Expression, field_name: str, code: Optional[str] = None, **kwargs):
        kwargs.pop("name", None)

        # 注意: 这里创建了一个内部的 field_identifier 节点，
        # 我们通常不需要给它独立的 order，或者给它一个默认的 order?
        # 为了避免 ID 冲突，最好也给它传个 kwargs (复用父节点的 context)
        field_id_kwargs = self._prepare_node_kwargs({})
        field_id_node = self.field_identifier(field_name, **field_id_kwargs)

        return self.call(
            name=Operators.fieldAccess,
            method_full_name=Operators.fieldAccess,
            args=[base, field_id_node],
            code=code,
            **kwargs
        )

    def indirect_field_access(self, base: Expression, field_name: str, code: Optional[str] = None, **kwargs):
        kwargs.pop("name", None)
        field_id_kwargs = self._prepare_node_kwargs({})
        field_id_node = self.field_identifier(field_name, **field_id_kwargs)
        return self.call(
            name=Operators.indirectFieldAccess,
            method_full_name=Operators.indirectFieldAccess,
            args=[base, field_id_node],
            code=code,
            **kwargs
        )

    def index_access(self, base: Expression, index: Expression, code: Optional[str] = None, **kwargs):
        kwargs.pop("name", None)
        return self.call(
            name=Operators.indexAccess,
            method_full_name=Operators.indexAccess,
            args=[base, index],
            code=code,
            **kwargs
        )

    def binary_op(self, lhs: Expression, rhs: Expression, operator: str, code: Optional[str] = None, **kwargs):
        kwargs.pop("name", None)
        return self.call(name=operator, method_full_name=operator, args=[lhs, rhs], code=code, **kwargs)

    def unary_op(self, operand: Expression, operator: str, code: Optional[str] = None, **kwargs):
        kwargs.pop("name", None)
        return self.call(name=operator, method_full_name=operator, args=[operand], code=code, **kwargs)

    # =========================================================================
    # Helpers: 元数据
    # =========================================================================

    def attach_modifier(self, target_node: AstNode, modifier: str):
        # 1. [Inheritance] 继承父节点的位置信息
        # Modifier 本身没有独立的行号，它的位置等同于它修饰的节点 (target_node)
        kwargs = {}
        # 尝试从 target_node (如 MethodNode) 复制行号/列号
        # 注意：要检查属性是否存在且不为 None
        if getattr(target_node, "line_number", None) is not None:
            kwargs["line_number"] = target_node.line_number
        if getattr(target_node, "column_number", None) is not None:
            kwargs["column_number"] = target_node.column_number

        # 注入 file_name 等通用上下文
        kwargs = self._prepare_node_kwargs(kwargs)

        # 2. 创建节点
        mod_node = ModifierNode(modifierType=modifier, code=modifier, **kwargs)
        mod_node = self._add_node(mod_node, auto_ast=False)

        # 4. 连线
        # Modifier 确实是 AST 的一部分 (修饰关系)
        self.graph.add_ast_edge(target_node, mod_node)
        return mod_node

    def attach_tag(self, target_node: CPGNode, key: str, value: str = ""):
        """Add a tag to a node via property-based storage (no TagNode/TAGGED_BY edge)."""
        tag_str = f"{key}:{value}" if value else key
        if tag_str not in target_node.tags:
            target_node.tags.append(tag_str)

    def add_meta_data(self, language: str, root_path: str, version: str = "1.1"):
        node = MetaDataNode(language=language, version=version, root_path=root_path, label=NodeLabel.META_DATA)
        return self._add_node(node, auto_ast=False)

    # =========================================================================
    # Helpers: 模块 (Architecture-Level)
    # =========================================================================

    def module(self, name: str, full_name: str, **kwargs) -> ModuleNode:
        """
        创建或获取一个逻辑模块节点。

        模块是架构级抽象，与物理目录无关。一个模块可以包含多个目录/文件。
        通过 full_name 全局唯一标识，重复调用相同 full_name 返回已有节点。

        Args:
            name: 模块短名，例如 'ext4'
            full_name: 模块全名，例如 'fs.ext4'
            **kwargs: 可选字段 — description, subsystem, maintainers,
                      config_options, entry_points
        """
        if full_name in self._module_cache:
            existing = self._module_cache[full_name]
            # 增量合并列表字段
            for list_field in ("maintainers", "config_options", "entry_points"):
                new_vals = kwargs.pop(list_field, None)
                if new_vals:
                    old_vals = getattr(existing, list_field, [])
                    setattr(existing, list_field, list(dict.fromkeys(old_vals + new_vals)))
            # 覆盖标量字段（仅非 None 的新值）
            for scalar_field in ("description", "subsystem"):
                new_val = kwargs.pop(scalar_field, None)
                if new_val is not None:
                    setattr(existing, scalar_field, new_val)
            return existing

        node = ModuleNode(name=name, fullName=full_name, **kwargs)
        self.graph.add_node(node)
        self._module_cache[full_name] = node
        return node

    def module_contains(self, module: ModuleNode, target) -> None:
        """
        将文件、目录或子模块关联到模块。

        Args:
            module: 父模块节点
            target: FileNode, DirectoryNode, 或子 ModuleNode
        """
        self.graph.add_edge(module, target, EdgeType.CONTAINS)

    def _ensure_directory_structure(self, file_path_str: str, file_node: FileNode):
        path_obj = Path(file_path_str)
        parent_dir = path_obj.parent
        if str(parent_dir) == ".":
            dir_node = self._get_or_create_directory(Path("ROOT"))
        else:
            dir_node = self._get_or_create_directory(parent_dir)
        self.graph.add_edge(dir_node, file_node, EdgeType.CONTAINS)

    def _get_or_create_directory(self, path_obj: Path) -> DirectoryNode:
        path_str = path_obj.as_posix()
        if path_str in self._directory_cache:
            return self._directory_cache[path_str]

        parent_path = path_obj.parent
        parent_node = None
        if str(parent_path) != "." and parent_path != path_obj:
            parent_node = self._get_or_create_directory(parent_path)

        display_name = path_obj.name if path_obj.name else path_str

        dir_node = DirectoryNode(
            name=display_name,
            path=path_str
        )
        self.graph.add_node(dir_node)

        if parent_node:
            self.graph.add_edge(parent_node, dir_node, EdgeType.CONTAINS)

        self._directory_cache[path_str] = dir_node
        return dir_node