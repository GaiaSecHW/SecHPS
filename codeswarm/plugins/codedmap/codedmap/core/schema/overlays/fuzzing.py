from pydantic import Field

from .base import OverlayNode

class FuzzCampaignNode(OverlayNode):  # [Change] 继承变化
    """表示一次 Fuzzing 测试战役"""
    label: str = Field(default="FUZZ_CAMPAIGN", frozen=True)
    
    campaign_id: str
    tool_name: str
    start_time: str
    # metadata 字段已由 OverlayNode 继承

class FuzzInputNode(OverlayNode):
    """表示导致特定状态的输入样本"""
    label: str = Field(default="FUZZ_INPUT", frozen=True)
    file_path: str
    content_hash: str
    is_crash: bool = False