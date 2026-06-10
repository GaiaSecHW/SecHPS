# codedmap/core/schema/graph/nodes/declarations.py
# Names, definitions, signatures

from typing import Optional, List
from pydantic import Field

from ..base import AstNode
from ..categories import Declaration
from ..enums import ModifierType, NodeLabel

# Note: CommentNode and ModifierNode extend AstNode, not Declaration.
# They are grouped here as they are declaration-adjacent in the CPG model.


class CommentNode(AstNode):
    """注释节点。"""
    label: NodeLabel = NodeLabel.COMMENT
    is_docstring: bool = Field(
        default=False,
        description="是否为文档字符串 (Docstring)"
    )


class ModifierNode(AstNode):
    """访问控制修饰符"""
    label: NodeLabel = NodeLabel.MODIFIER
    modifier_type: ModifierType = Field(default=ModifierType.PUBLIC, alias="modifierType")


class MethodNode(Declaration):
    label: NodeLabel = NodeLabel.METHOD
    signature: Optional[str] = Field(default="<unknown>")

    summary: Optional[str] = Field(default=None, description="LLM generated logic summary")


class MethodReturnNode(Declaration):
    """方法的出口节点 (数据流汇聚点)"""
    label: NodeLabel = NodeLabel.METHOD_RETURN
    type_full_name: str = Field(alias="typeFullName")


class MethodParameterInNode(Declaration):
    label: NodeLabel = NodeLabel.METHOD_PARAMETER_IN
    type_full_name: str = Field(alias="typeFullName")
    order: int


class MethodParameterOutNode(Declaration):
    """方法的出参节点。"""
    label: NodeLabel = NodeLabel.METHOD_PARAMETER_OUT
    type_full_name: str = Field(alias="typeFullName")
    order: int


class LocalNode(Declaration):
    """局部变量声明 (栈上变量)"""
    label: NodeLabel = NodeLabel.LOCAL
    type_full_name: str = Field(alias="typeFullName")


class MemberNode(Declaration):
    """类成员变量声明"""
    label: NodeLabel = NodeLabel.MEMBER
    type_full_name: str = Field(alias="typeFullName")


class TypeDeclNode(Declaration):
    """类/结构体定义"""
    label: NodeLabel = NodeLabel.TYPE_DECL
    inherits_from_type_full_name: List[str] = Field(default_factory=list, alias="inheritsFromTypeFullName")
    alias_type_full_name: Optional[str] = Field(default=None, alias="aliasTypeFullName")

    summary: Optional[str] = Field(None)
