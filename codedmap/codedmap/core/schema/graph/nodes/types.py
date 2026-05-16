# codedmap/core/schema/graph/nodes/types.py
# Type system & binding

from typing import Optional
from pydantic import Field, model_validator

from ..base import CPGNode
from ..enums import NodeLabel
from codedmap.utils.id_generator import generate_deterministic_id


class TypeNode(CPGNode):
    """
    类型实体。
    TypeDecl 是代码中的类定义 (class A {})
    Type 是类型本身 (A)
    """
    label: NodeLabel = NodeLabel.TYPE
    name: str = Field(..., description="类型名, 如 int, vector")
    full_name: str = Field(..., alias="fullName")
    type_decl_full_name: Optional[str] = Field(default=None, alias="typeDeclFullName", description="指向定义的TypeDecl")

    @model_validator(mode='after')
    def generate_global_type_id(self):
        if self.id is None and self.full_name:
            self.id = generate_deterministic_id("TYPE", self.full_name)
        return self


class TypeRefNode(CPGNode):
    """类型引用。"""
    label: NodeLabel = NodeLabel.TYPE_REF
    type_full_name: str = Field(..., alias="typeFullName", description="引用的类型全名")
    dynamic_type_hint_full_name: Optional[str] = Field(default=None, alias="dynamicTypeHintFullName")


class BindingNode(CPGNode):
    """
    方法绑定。
    连接 TypeDecl 和 Method，表示"这个类拥有这个方法"。
    """
    label: NodeLabel = NodeLabel.BINDING
    name: str = Field(..., description="方法名")
    signature: str = Field(default="")
