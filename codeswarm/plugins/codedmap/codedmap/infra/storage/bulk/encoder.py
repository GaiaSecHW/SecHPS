# codedmap/infra/storage/bulk/encoder.py

import json
from typing import Any
from abc import ABC, abstractmethod


class ValueEncoder(ABC):
    """
    [Abstract] 编码器基类。
    """

    @classmethod
    @abstractmethod
    def encode(cls, val: Any) -> str:
        pass


class StandardJsonEncoder(ValueEncoder):
    """
    [Standard] 通用编码器 (SQLite/Pandas 友好)。

    策略:
    1. None -> "" (CSV 空值)
    2. List/Dict/Tuple/Set -> JSON String (保证结构完整性)
    3. Bool -> "True"/"False" (Python str 默认行为) 或 "1"/"0"
    """

    @classmethod
    def encode(cls, val: Any) -> str:
        if val is None:
            return ""

        # 1. 字符串: 处理 NULL 字节，防止 C 语言 CSV 解析器截断
        if isinstance(val, str):
            return val.replace('\0', '')

        # 2. 基础数值: 直接转字符串
        if isinstance(val, (int, float, bool)):
            return str(val)

        # 3. 复杂结构 (List, Dict, Tuple, Set): 统一转 JSON
        # 这是 SQLite 存储结构化数据的最佳实践
        if isinstance(val, (list, dict, tuple, set)):
            # Set 需要转 list 才能被 JSON 序列化
            if isinstance(val, set):
                val = list(val)
            return json.dumps(val, ensure_ascii=False)

        # 4. Fallback
        return str(val)