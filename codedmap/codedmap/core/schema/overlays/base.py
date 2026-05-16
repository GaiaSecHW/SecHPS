from typing import Dict, Any
from pydantic import Field, ConfigDict

from codedmap.core.schema.graph.base import CPGNode


class OverlayNode(CPGNode):
    """
    [Extension Base] 所有扩展层节点的抽象基类。

    作用：
    1. 在类型系统中将 Extension 节点与 Core 节点区分开。
    2. 提供扩展节点通用的元数据字段。
    """
    tool_info: Dict[str, Any] = Field(
        default_factory=dict,
        description="工具特定的持久化元数据 (Will be saved to DB)"
    )

    model_config = ConfigDict(extra='allow')
