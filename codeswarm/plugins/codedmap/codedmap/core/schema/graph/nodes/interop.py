# codedmap/core/schema/graph/nodes/interop.py
# Joern analysis result interop

from typing import Optional
from pydantic import ConfigDict, Field, model_validator

from ..base import CPGNode
from ..enums import NodeLabel
from codedmap.utils.id_generator import generate_deterministic_id


class TagNode(CPGNode):
    """
    Tag node from Joern CPG.

    In codedmap's own pipeline, tags are stored as node properties (node.tags list).
    This class exists to properly import Joern TAG nodes via CSV without losing data.
    """
    label: NodeLabel = NodeLabel.TAG
    name: str = Field(..., description="Tag name")
    value: Optional[str] = Field(default=None, description="Tag value")

    @model_validator(mode='after')
    def generate_tag_id(self):
        if self.id is None and self.name:
            self.id = generate_deterministic_id("TAG", self.name, self.value or "")
        return self


class FindingNode(CPGNode):
    """Joern analysis finding."""
    label: NodeLabel = NodeLabel.FINDING
    model_config = ConfigDict(extra='allow')


class KeyValuePairNode(CPGNode):
    """Key-value pair node used in Joern FINDING evidence."""
    label: NodeLabel = NodeLabel.KEY_VALUE_PAIR
    key: str = Field(default="", description="Key")
    value: Optional[str] = Field(default=None, description="Value")


class TagNodePairNode(CPGNode):
    """Container linking an arbitrary node to a TAG."""
    label: NodeLabel = NodeLabel.TAG_NODE_PAIR
    model_config = ConfigDict(extra='allow')


class LocationNode(CPGNode):
    """Joern source code location summary."""
    label: NodeLabel = NodeLabel.LOCATION
    symbol: Optional[str] = Field(default=None, description="Symbol name")
    package_name: Optional[str] = Field(default=None, alias="packageName")
    class_name: Optional[str] = Field(default=None, alias="className")
    class_short_name: Optional[str] = Field(default=None, alias="classShortName")
    method_short_name: Optional[str] = Field(default=None, alias="methodShortName")
    node_label: Optional[str] = Field(default=None, alias="nodeLabel")
    file_name: Optional[str] = Field(default=None, alias="fileName")
    line_number: Optional[int] = Field(default=None, alias="lineNumber")
    method_full_name: Optional[str] = Field(default=None, alias="methodFullName")
    model_config = ConfigDict(extra='allow')
