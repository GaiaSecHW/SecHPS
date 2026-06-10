# codedmap\core\schema\edges.py

from typing import Dict, Any, Optional, Union
from pydantic import BaseModel, Field, ConfigDict

from .enums import EdgeType


class CPGEdge(BaseModel):
    """图的边，包含类型和属性"""
    src: int = Field(..., description="源节点ID")
    dst: int = Field(..., description="目标节点ID")
    type: Union[EdgeType, str] = Field(..., description="Edge Type (Core Enum or Extension String)")
    properties: Dict[str, Any] = Field(default_factory=dict)
    created_by: str = Field(default="static", description="创建该边的组件名称")

    model_config = ConfigDict(use_enum_values=True)

    @classmethod
    def ast(cls, parent_id: int, child_id: int):
        return cls(src=parent_id, dst=child_id, type=EdgeType.AST)

    @classmethod
    def cfg(cls, from_id: int, to_id: int, label: Optional[str] = None):
        props = {"label": label} if label else {}
        return cls(src=from_id, dst=to_id, type=EdgeType.CFG, properties=props)

    @classmethod
    def ddg(cls, def_id: int, use_id: int, variable: str):
        return cls(src=def_id, dst=use_id, type=EdgeType.DDG, properties={"variable": variable})

    @classmethod
    def ref(cls, usage_id: int, def_id: int):
        return cls(src=usage_id, dst=def_id, type=EdgeType.REF)

    @classmethod
    def call(cls, site_id: int, method_id: int):
        return cls(src=site_id, dst=method_id, type=EdgeType.CALL)

    @classmethod
    def points_to(cls, pointer_id: int, location_id: int):
        """指针指向关系"""
        return cls(src=pointer_id, dst=location_id, type=EdgeType.POINTS_TO)
        
    @classmethod
    def includes(cls, src_file_id: int, dst_file_id: int):
        """文件包含关系"""
        return cls(src=src_file_id, dst=dst_file_id, type=EdgeType.INCLUDES)        

    @classmethod
    def argument(cls, call_id: int, arg_id: int, index: int):
        """
        连接 CALL 节点和参数节点。
        Joern 规范: 必须带 explicit argument index。
        """
        return cls(
            src=call_id, 
            dst=arg_id, 
            type=EdgeType.ARGUMENT, 
            properties={"argumentIndex": index}  # Joern 属性 key: ARGUMENT_INDEX
        )

    @classmethod
    def receiver(cls, call_id: int, receiver_id: int):
        """
        连接 CALL 节点和接收者 (对象)。
        例如: x.method() -> 连接 call 和 x
        """
        return cls(src=call_id, dst=receiver_id, type=EdgeType.RECEIVER)

    @classmethod
    def condition(cls, control_struct_id: int, expr_id: int):
        """
        连接控制结构 (IF/WHILE) 和条件表达式。
        """
        return cls(src=control_struct_id, dst=expr_id, type=EdgeType.CONDITION)

    @classmethod
    def contains(cls, parent_id: int, child_id: int):
        """
        宏观包含关系 (File -> Method, TypeDecl -> Method)
        """
        return cls(src=parent_id, dst=child_id, type=EdgeType.CONTAINS)

    @classmethod
    def parameter_link(cls, param_in_id: int, param_out_id: int):
        """
        连接入参和出参
        """
        return cls(src=param_in_id, dst=param_out_id, type=EdgeType.PARAMETER_LINK)
    
    @classmethod
    def source_file(cls, node_id: int, file_id: int):
        """
        将节点关联到源文件
        """
        return cls(src=node_id, dst=file_id, type=EdgeType.SOURCE_FILE)        