# codedmap\core\schema\categories.py

from typing import Optional
from pydantic import Field

from .base import AstNode

class Declaration(AstNode):
    """声明类: 定义名称的实体"""
    name: str = Field(..., description="定义的名称")
    full_name: Optional[str] = Field(default=None, alias="fullName", description="全限定名")
    is_external: bool = Field(default=False, alias="isExternal", description="是否为外部依赖")

class Expression(AstNode):
    """表达式类: 可求值，有类型"""
    argument_index: Optional[int] = Field(default=None, alias="argumentIndex")
    type_full_name: str = Field(default="ANY", alias="typeFullName", description="计算结果类型")
    dynamic_type_hint_full_name: Optional[str] = Field(default=None, alias="dynamicTypeHintFullName")

class Statement(AstNode):
    """语句类: 控制流"""
    pass