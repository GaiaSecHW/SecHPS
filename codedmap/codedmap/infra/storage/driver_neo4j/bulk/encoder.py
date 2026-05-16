import json
from typing import Any
from codedmap.infra.storage.bulk.encoder import ValueEncoder

class Neo4jValueEncoder(ValueEncoder):
    """
    [Dialect] Neo4j Import Tool 专用编码器。
    """
    ARRAY_DELIMITER = "\x1F"

    @classmethod
    def encode(cls, val: Any) -> str:
        if val is None:
            return ""

        if isinstance(val, bool):
            return "true" if val else "false"

        if isinstance(val, (int, float)):
            return str(val)

        # [Fix] String 清洗逻辑增强
        if isinstance(val, str):
            # 1. 移除 NULL 字节
            val = val.replace('\0', '')
            # 2. [关键] 将物理换行符转义为字面量，允许关闭 multiline-fields
            # 这样 Neo4j 导入时每行对应一个节点，极大提升稳定性和速度
            val = val.replace('\n', '\\n').replace('\r', '')
            return val

        if isinstance(val, (list, tuple, set)):
            items = []
            for v in val:
                if v is None: continue
                s = str(v).replace(cls.ARRAY_DELIMITER, "")
                items.append(s)
            return cls.ARRAY_DELIMITER.join(items)

        if isinstance(val, dict):
            return json.dumps(val, ensure_ascii=False)

        return str(val)