# codedmap/frontend/integrations/joern/id_bridge.py

"""
Joern ID <-> codedmap ID 翻译桥接器。

三种策略：
- passthrough: 直接使用 Joern 的 Long ID（最快，零额外内存）
- regenerate: 从属性重新计算 SHA-256 确定性 ID（与原生解析 ID 一致）
- hybrid: 全局节点 regenerate，AST 节点 passthrough（默认推荐）
"""

import logging
from typing import Dict, Literal, Optional

from codedmap.utils.id_generator import generate_deterministic_id

from .constants import GLOBAL_NODE_LABELS

logger = logging.getLogger(__name__)

IdStrategy = Literal["passthrough", "regenerate", "hybrid"]


class JoernIdBridge:
    """
    Joern ID -> codedmap ID 的翻译层。

    在节点阶段填充映射表，边阶段查表翻译 src/dst。
    """

    def __init__(self, strategy: IdStrategy = "hybrid"):
        self.strategy = strategy
        # joern_id -> cpg_id 映射表
        self._id_map: Dict[int, int] = {}
        self._stats = {"passthrough": 0, "regenerated": 0, "total": 0}

    def translate_node_id(
        self,
        joern_id: int,
        label: str,
        properties: Dict,
    ) -> int:
        """
        为节点生成 codedmap ID 并记录映射。

        Args:
            joern_id: Joern 原始 ID
            label: 已映射后的 codedmap label 字符串
            properties: 已映射后的 codedmap 属性（camelCase 键名）

        Returns:
            codedmap 中使用的 ID
        """
        self._stats["total"] += 1

        if self.strategy == "passthrough":
            cpg_id = joern_id
            self._stats["passthrough"] += 1

        elif self.strategy == "regenerate":
            cpg_id = self._regenerate_id(label, properties)
            self._stats["regenerated"] += 1

        else:  # hybrid
            if label in GLOBAL_NODE_LABELS:
                cpg_id = self._regenerate_id(label, properties)
                self._stats["regenerated"] += 1
            else:
                cpg_id = joern_id
                self._stats["passthrough"] += 1

        self._id_map[joern_id] = cpg_id
        return cpg_id

    def translate_edge_id(self, joern_id: int) -> Optional[int]:
        """
        查表翻译边的 src 或 dst ID。

        Args:
            joern_id: Joern 原始节点 ID

        Returns:
            codedmap ID，如果找不到返回 None
        """
        return self._id_map.get(joern_id)

    def _regenerate_id(self, label: str, properties: Dict) -> int:
        """
        根据节点属性重新计算确定性 ID。
        复用 codedmap 的 auto_generate_id 逻辑。
        """
        # --- 全局声明节点 (METHOD, TYPE_DECL) ---
        if label in ("METHOD", "TYPE_DECL", "TYPE", "META_DATA"):
            full_name = properties.get("fullName") or properties.get("name")
            file_name = properties.get("fileName")

            extra_sig = ""
            if label == "METHOD":
                extra_sig = properties.get("signature", "") or "NOSIG"

            if file_name and full_name:
                return generate_deterministic_id(file_name, label, full_name, extra_sig)
            elif full_name:
                return generate_deterministic_id("GLOBAL", label, full_name)

        # --- FILE 节点 ---
        if label == "FILE":
            path = properties.get("fullName") or properties.get("name")
            if path:
                return generate_deterministic_id("FILE", path)

        # --- NAMESPACE_BLOCK ---
        if label == "NAMESPACE_BLOCK":
            full_name = properties.get("fullName") or properties.get("name")
            file_name = properties.get("fileName")
            if file_name and full_name:
                return generate_deterministic_id(file_name, label, full_name, "")
            elif full_name:
                return generate_deterministic_id("GLOBAL", label, full_name)

        # --- 其他 AST 节点：基于位置信息 ---
        file_name = properties.get("fileName")
        if file_name:
            def _int_or(val, default=-1):
                return val if val is not None else default

            order_val = _int_or(properties.get("order"), -1)
            arg_idx = _int_or(properties.get("argumentIndex"), -1)
            line_num = _int_or(properties.get("lineNumber"), -1)
            col_num = _int_or(properties.get("columnNumber"), -1)
            start = _int_or(properties.get("offsetStart"), -1)
            end = _int_or(properties.get("offsetEnd"), -1)
            code = properties.get("code", "")
            code_hint = code[:32] if code else ""

            return generate_deterministic_id(
                file_name, label,
                str(line_num), str(col_num),
                str(order_val), str(arg_idx),
                str(start), str(end),
                code_hint,
            )

        # --- Fallback：基于 Joern 属性哈希 ---
        # 没有足够信息重建确定性 ID，使用关键属性组合
        full_name = properties.get("fullName") or properties.get("name") or ""
        return generate_deterministic_id("JOERN", label, full_name)

    @property
    def id_map(self) -> Dict[int, int]:
        """返回 ID 映射表的只读视图。"""
        return self._id_map

    @property
    def stats(self) -> Dict[str, int]:
        return self._stats.copy()

    def get_stats_summary(self) -> str:
        s = self._stats
        return (
            f"ID Bridge Stats: total={s['total']}, "
            f"passthrough={s['passthrough']}, regenerated={s['regenerated']}"
        )
