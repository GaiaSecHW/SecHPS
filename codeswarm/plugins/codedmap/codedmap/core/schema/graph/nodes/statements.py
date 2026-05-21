# codedmap/core/schema/graph/nodes/statements.py
# Control flow targets

from pydantic import Field

from ..base import AstNode
from ..categories import Statement
from ..enums import NodeLabel


class ReturnNode(Statement):
    label: NodeLabel = NodeLabel.RETURN


class JumpTargetNode(AstNode):
    """goto label, case, default"""
    label: NodeLabel = NodeLabel.JUMP_TARGET
    name: str = Field(..., description="Label名")


class JumpLabelNode(AstNode):
    """Jump label specifying BREAK/CONTINUE targets"""
    label: NodeLabel = NodeLabel.JUMP_LABEL
    name: str = Field(..., description="Label名")
    parser_type_name: str = Field(default="", alias="parserTypeName")
