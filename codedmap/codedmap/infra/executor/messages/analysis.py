# codedmap/pipeline/messages/analysis.py

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple
from .base import BaseTask, TaskResult


@dataclass(kw_only=True)
class AnalysisTask(BaseTask):
    """
    [AI Analysis Context]
    专用于 AIEnhancedPass 的任务包。
    """
    pass_name: str
    target_node_id: int
    target_label: str
    
    # 核心载荷: 预生成的 Prompt 列表
    # 主进程负责生成 Prompt (利用 ContextLoader)，Worker 负责发送请求
    prompt_inputs: List[Dict[str, Any]] = field(default_factory=list)
    
    # Agent 配置 (用于在 Worker 端重建 Agent)
    # e.g. {"model": "gpt-4", "api_base": "..."}
    agent_config: Dict[str, Any] = field(default_factory=dict)


# 定义紧凑的类型别名
# EdgeTuple: (src_id, dst_id, type_str, properties_dict_or_None)
EdgeTuple = Tuple[int, int, str, Optional[Dict[str, Any]]]

# UpdateTuple: (node_id, properties_dict)
UpdateTuple = Tuple[int, Dict[str, Any]]


@dataclass
class AIAnalysisResult(TaskResult):
    """
    [AI Result Envelope]
    专用于 AI Pass 的结果回传。

    设计原则：
    Worker 只负责返回"语义数据" (Semantic Data)，不负责生成 GraphPatch。
    GraphPatch 的生成逻辑保留在主进程 (Coordinator)，以便利用 ContextLoader 访问图数据库。
    """
    # 核心回传数据 (对应 R 类型)
    # 可以是 Pydantic 模型对象、Dict 或 JSON 字符串，取决于具体 Pass 的实现
    model_response: Any = None

    # 上下文回溯 (用于 Cache Write-back 和 Patch 生成)
    # 必须回传 node_id 和 hash，因为异步执行是乱序的
    target_node_id: Optional[int] = None
    prompt_hash: Optional[str] = None

    # 辅助元数据
    token_usage: Dict[str, int] = field(default_factory=dict)  # e.g. {"prompt": 100, "completion": 50}
    finish_reason: Optional[str] = None

@dataclass
class BatchAnalysisResult(TaskResult):
    """
    [Optimized] 仅作为传输信封，内部负载使用原生元组以加速 IPC。
    """
    # 极速传输通道
    new_edges: List[EdgeTuple] = field(default_factory=list)
    node_updates: List[UpdateTuple] = field(default_factory=list)

    # 统计信息
    metrics: Dict[str, int] = field(default_factory=dict)