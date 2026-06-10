# codedmap/core/diagnostics.py

import logging
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from codedmap.core.schema.graph.base import AstNode
from codedmap.utils.id_generator import generate_deterministic_id

logger = logging.getLogger(__name__)


@dataclass
class CollisionReport:
    reason: str
    identical_fields: List[str]
    diff_fields: Dict[str, str]  # field -> "parent_val vs child_val"


class CollisionInvestigator:
    """
    冲突调查员：用于在构建阶段实时分析 ID 冲突的根因。
    """

    @staticmethod
    def investigate(parent: AstNode, child: AstNode) -> CollisionReport:
        """
        对比父子节点，找出导致 ID 相同的罪魁祸首。
        """
        # 参与 ID 生成的核心字段
        fields_to_check = [
            "file_name", "label",
            "line_number", "column_number",
            "offset_start", "offset_end",
            "order", "argument_index",
            "name", "code", "method_full_name", "type_full_name"
        ]

        identical = []
        diffs = {}

        for field in fields_to_check:
            # 使用 getattr 安全获取，因为不同节点字段可能不同
            p_val = getattr(parent, field, None)
            c_val = getattr(child, field, None)

            # 简单的转字符串比较
            if str(p_val) == str(c_val):
                identical.append(field)
            else:
                diffs[field] = f"Parent='{p_val}' vs Child='{c_val}'"

        # 判定结论
        if not diffs:
            reason = "PERFECT_OVERLAP (Macro Recursion)"
        elif "order" in diffs and "offset_start" in identical:
            reason = "ORDER_MISMATCH (Same Location, Diff Order)"
        else:
            reason = "PARTIAL_OVERLAP"

        return CollisionReport(reason, identical, diffs)

    @staticmethod
    def print_report(report: CollisionReport, parent: AstNode, child: AstNode):
        """打印详细的验尸报告"""
        logger.warning(f"🔍 [Collision Investigation] Reason: {report.reason}")
        logger.warning(f"   Conflict Node: {parent.label} (Parent) <-> {child.label} (Child)")

        if report.diff_fields:
            logger.warning("   Differences (Why ID should have been different but wasn't?):")
            for k, v in report.diff_fields.items():
                logger.warning(f"     - {k}: {v}")
        else:
            logger.warning("   ⚠️ FATAL: All ID-generation fields are IDENTICAL!")
            logger.warning(
                f"     - Shared Location: Line {parent.line_number}, Offset {parent.offset_start}-{parent.offset_end}")
            logger.warning(f"     - Shared Order: {parent.order}")
            logger.warning(f"     - Shared ArgIndex: {getattr(parent, 'argument_index', 'N/A')}")

    @staticmethod
    def generate_salted_id(original_node: AstNode, salt_seed: Any) -> int:
        """
        [Dynamic Repair] 生成确定性的修复 ID。
        不使用随机数，而是混合父子特征。
        """
        # 构造一个新的指纹：原指纹 + Salt
        # 既然原 ID 是根据属性生成的，我们直接用原 ID 作为基底
        base_id = original_node.id

        # 混合 Salt (通常是冲突对方的 ID 或 特征)
        new_fingerprint = f"{base_id}::{salt_seed}::REPAIRED"

        # 重新走确定性 Hash 算法
        return generate_deterministic_id(new_fingerprint)