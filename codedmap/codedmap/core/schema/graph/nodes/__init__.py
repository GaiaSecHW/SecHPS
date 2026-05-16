# codedmap/core/schema/graph/nodes/__init__.py
# Re-export all node classes for backward-compatible imports.

# Base classes re-exported for backward compatibility (originally accessible via nodes.py)
from ..base import CPGNode, AstNode
from ..categories import Declaration, Expression, Statement

from .structure import (
    MetaDataNode, FileNode, DirectoryNode, ModuleNode,
    ModuleMetrics, NamespaceBlockNode, DependencyNode, ImportNode,
)
from .declarations import (
    MethodNode, MethodReturnNode, MethodParameterInNode, MethodParameterOutNode,
    LocalNode, MemberNode, TypeDeclNode, CommentNode, ModifierNode,
)
from .expressions import (
    CallNode, IdentifierNode, LiteralNode, BlockNode,
    ControlStructureNode, FieldIdentifierNode, MethodRefNode,
    ClosureBindingNode, AnnotationNode, AnnotationLiteralNode,
    AnnotationParameterNode, AnnotationParameterAssignNode,
    ArrayInitializerNode, UnknownNode,
)
from .statements import ReturnNode, JumpTargetNode, JumpLabelNode
from .types import TypeNode, TypeRefNode, BindingNode
from .extensions import VectorNode, EmbeddingChunkNode, InsightNode
from .interop import TagNode, FindingNode, KeyValuePairNode, TagNodePairNode, LocationNode

__all__ = [
    # base classes (re-exported for backward compatibility)
    "CPGNode", "AstNode", "Declaration", "Expression", "Statement",
    # structure
    "MetaDataNode", "FileNode", "DirectoryNode", "ModuleNode",
    "ModuleMetrics", "NamespaceBlockNode", "DependencyNode", "ImportNode",
    # declarations
    "MethodNode", "MethodReturnNode", "MethodParameterInNode", "MethodParameterOutNode",
    "LocalNode", "MemberNode", "TypeDeclNode", "CommentNode", "ModifierNode",
    # expressions
    "CallNode", "IdentifierNode", "LiteralNode", "BlockNode",
    "ControlStructureNode", "FieldIdentifierNode", "MethodRefNode",
    "ClosureBindingNode", "AnnotationNode", "AnnotationLiteralNode",
    "AnnotationParameterNode", "AnnotationParameterAssignNode",
    "ArrayInitializerNode", "UnknownNode",
    # statements
    "ReturnNode", "JumpTargetNode", "JumpLabelNode",
    # types
    "TypeNode", "TypeRefNode", "BindingNode",
    # extensions
    "VectorNode", "EmbeddingChunkNode", "InsightNode",
    # interop
    "TagNode", "FindingNode", "KeyValuePairNode", "TagNodePairNode", "LocationNode",
]
