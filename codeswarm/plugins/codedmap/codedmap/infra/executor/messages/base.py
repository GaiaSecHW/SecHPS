# codedmap/pipeline/messages/base.py

from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import time

@dataclass(kw_only=True)
class BaseTask:
    """所有分布式任务的基类"""
    task_id: str
    created_at: float = field(default_factory=time.time)
    meta: Dict[str, Any] = field(default_factory=dict) # 链路追踪信息等
    payload: Any = None # 用于承载任务数据 (如 id 列表)

@dataclass
class TaskResult:
    """任务执行结果"""
    task_id: str
    status: str # SUCCESS, FAILED, RETRY
    payload: Any = None
    error: Optional[str] = None
    execution_time: float = 0.0