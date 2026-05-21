from typing import Optional, Dict, Any, List
from pydantic import Field

from .base import OverlayNode

# 定义 Trace 专用的边类型常量，避免修改核心 EdgeType 枚举
# 这样保持核心 Schema 的纯净
EDGE_EXECUTED_IN = "EXECUTED_IN"      # Event -> Session
EDGE_NEXT_EVENT = "NEXT_EVENT"        # Event -> Event (时序链)
EDGE_MAPPED_TO = "MAPPED_TO"          # Event -> Static Node (AST/CFG)
EDGE_HAS_VALUE = "HAS_VALUE"          # Event -> RuntimeValue

class TraceSessionNode(OverlayNode):
    """
    [Overlay] 动态调试会话。
    代表一次程序的执行记录 (如一次 GDB 调试或 Sandbox 运行)。
    """
    label: str = Field(default="TRACE_SESSION", frozen=True)
    
    session_id: str = Field(..., description="唯一的会话标识")
    tool: str = Field(default="GDB", description="采集工具名称")
    start_time: str
    command_line: str = ""

class TraceEventNode(OverlayNode):
    """
    [Overlay] 调试事件节点。
    代表执行流中的一个时间点 (Snapshot)。
    """
    label: str = Field(default="TRACE_EVENT", frozen=True)
    
    seq_id: int = Field(..., description="全局递增的时序 ID")
    thread_id: int = 0
    file_path: str
    line_number: int
    function_name: Optional[str] = None
    
    # 指令指针，用于反汇编映射
    pc_address: Optional[str] = None 

class RuntimeValueNode(OverlayNode):
    """
    [Overlay] 运行时变量值。
    """
    label: str = Field(default="RUNTIME_VALUE", frozen=True)
    
    var_name: str
    var_type: str
    value_content: str  # 值的字符串表示，如 "0x7fffffffe4" 或 "User{id=1}"
    memory_address: Optional[str] = None