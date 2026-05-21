# codedmap/pipeline/messages/parser.py

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List
from .base import BaseTask


@dataclass
class ParserTask(BaseTask):
    """
    [Architecture] 前端解析任务包 - Batch 模式
    """
    file_paths: List[str]
    languages: List[str]
    parse_strategies: List[str]

    config_dict: Dict[str, Any]

    def __post_init__(self):
        if not self.task_id:
            # 使用 batch 的第一个文件名作为 ID 的一部分，方便调试
            first = Path(self.file_paths[0]).name if self.file_paths else "empty"
            self.task_id = f"batch_{len(self.file_paths)}_{first}"