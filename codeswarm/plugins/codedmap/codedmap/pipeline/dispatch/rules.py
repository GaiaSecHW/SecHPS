# codedmap\pipeline\dispatch\rules.py

import re
import logging
from pathlib import Path
from typing import List, Optional, Pattern

from codedmap.core.schema.graph.enums import ParseStrategy  # 导入配置模型
from codedmap.core.configs.dispatch import DispatchConfig

logger = logging.getLogger(__name__)

class RuleEngine:
    """
    L1 & L2 规则引擎。
    基于路径正则 (L1) 和 内容特征 (L2) 进行快速判定。
    """
    def __init__(self, config: DispatchConfig):
        self.config = config
        
        # 1. 路径白名单 (高价值目标)
        self.critical_paths: List[Pattern] = []
        for p in config.critical_paths:
            try:
                self.critical_paths.append(re.compile(p))
            except re.error as e:
                logger.warning(f"Invalid critical_path regex '{p}': {e}")
        
        # 2. 路径黑名单 (噪音)
        self.ignore_paths: List[Pattern] = []
        for p in config.ignore_paths:
            try:
                self.ignore_paths.append(re.compile(p))
            except re.error as e:
                logger.warning(f"Invalid ignore_path regex '{p}': {e}")

        # 3. 敏感关键词 (二进制匹配，速度极快)
        # 将配置中的字符串转为 bytes
        self.sensitive_keywords: List[bytes] = [
            kw.encode('utf-8') for kw in config.sensitive_keywords
        ]

    def scan(self, file_path: Path, content_head: bytes) -> Optional[ParseStrategy]:
        """
        执行快速扫描。
        """
        path_str = str(file_path)

        # L1: 路径黑名单 (优先级最高)
        for p in self.ignore_paths:
            if p.search(path_str):
                return ParseStrategy.IGNORE

        # L1: 路径白名单
        for p in self.critical_paths:
            if p.search(path_str):
                # logger.debug(f"Rule Hit (Critical Path): {path_str}")
                return ParseStrategy.FULL

        # L2: 内容关键词扫描 (仅扫描头部)
        for kw in self.sensitive_keywords:
            if kw in content_head:
                # logger.debug(f"Rule Hit (Keyword '{kw.decode()}'): {path_str}")
                return ParseStrategy.FULL

        # 未命中任何规则
        return None