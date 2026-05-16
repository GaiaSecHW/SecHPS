# codedmap/analysis/passes/analysis_data.py

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ConstraintType(str, Enum):
    ADDR_OF = "ADDR_OF"  # p = &x
    COPY = "COPY"  # p = q
    LOAD = "LOAD"  # p = *q
    STORE = "STORE"  # *p = q
    # [New] 字段操作
    GEP = "GEP"  # p = &q->f (GetElementPtr)


@dataclass
class PtsConstraint:
    type: ConstraintType
    src_id: int  # RHS node ID
    dst_id: int  # LHS node ID

    # [New] Field Sensitivity Support
    field_offset: Optional[int] = 0  # 0 means base object

    def to_dict(self):
        return {
            "type": self.type,
            "src": self.src_id,
            "dst": self.dst_id,
            "offset": self.field_offset
        }