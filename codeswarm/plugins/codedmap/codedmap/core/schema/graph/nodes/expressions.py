# codedmap/core/schema/graph/nodes/expressions.py
# Evaluable AST nodes

from typing import Optional
from pydantic import Field

from ..base import CPGNode, AstNode
from ..categories import Expression
from ..enums import ControlStructureType, DispatchType, EvaluationStrategy, NodeLabel


class CallNode(Expression):
    """函数调用 / 宏调用"""
    label: NodeLabel = NodeLabel.CALL
    name: str = Field(..., description="函数名或操作符名")
    method_full_name: Optional[str] = Field(default=None, alias="methodFullName")
    signature: Optional[str] = Field(default=None)
    dispatch_type: DispatchType = Field(default=DispatchType.STATIC_DISPATCH, alias="dispatchType")


class ControlStructureNode(Expression):
    """高级控制流: if, while, try"""
    label: NodeLabel = NodeLabel.CONTROL_STRUCTURE
    control_structure_type: ControlStructureType = Field(..., alias="controlStructureType")
    parser_type_name: str = Field(default="CAST", alias="parserTypeName")


class IdentifierNode(Expression):
    """变量使用 (REF -> Local)"""
    label: NodeLabel = NodeLabel.IDENTIFIER
    name: str = Field(..., description="变量名")


class LiteralNode(Expression):
    label: NodeLabel = NodeLabel.LITERAL


class BlockNode(Expression):
    label: NodeLabel = NodeLabel.BLOCK


class FieldIdentifierNode(Expression):
    """字段标识符"""
    label: NodeLabel = NodeLabel.FIELD_IDENTIFIER
    canonical_name: str = Field(..., alias="canonicalName")


class MethodRefNode(Expression):
    """方法引用 / 函数指针"""
    label: NodeLabel = NodeLabel.METHOD_REF
    method_full_name: str = Field(..., alias="methodFullName", description="被引用的方法全名")


class ClosureBindingNode(CPGNode):
    """闭包捕获"""
    label: NodeLabel = NodeLabel.CLOSURE_BINDING
    closure_original_name: str = Field(..., alias="closureOriginalName", description="被捕获的变量原名")
    evaluation_strategy: EvaluationStrategy = Field(..., alias="evaluationStrategy")


class AnnotationNode(AstNode):
    """Python Decorator / Java Annotation"""
    label: NodeLabel = NodeLabel.ANNOTATION
    name: str = Field(..., description="注解名")
    full_name: str = Field(..., alias="fullName")


class AnnotationLiteralNode(Expression):
    """Literal value assigned to an annotation parameter"""
    label: NodeLabel = NodeLabel.ANNOTATION_LITERAL
    name: str = Field(default="", description="Literal name")


class AnnotationParameterNode(AstNode):
    """Formal annotation parameter declaration"""
    label: NodeLabel = NodeLabel.ANNOTATION_PARAMETER


class AnnotationParameterAssignNode(AstNode):
    """Assignment of annotation argument to annotation parameter"""
    label: NodeLabel = NodeLabel.ANNOTATION_PARAMETER_ASSIGN


class ArrayInitializerNode(Expression):
    """Array/struct initialization construct: {1, 2, 3}"""
    label: NodeLabel = NodeLabel.ARRAY_INITIALIZER


class UnknownNode(Expression):
    """无法解析的语法结构"""
    label: NodeLabel = NodeLabel.UNKNOWN
    parser_type_name: str = Field(..., alias="parserTypeName", description="Tree-sitter 的原始节点类型")
