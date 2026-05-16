import logging
from typing import Dict, List, Type, Optional, ClassVar, Any, Union
from enum import Enum

from pydantic import BaseModel, Field, ConfigDict, model_validator
from pydantic.fields import FieldInfo, PydanticUndefined

from codedmap.utils.id_generator import generate_deterministic_id, generate_id
from codedmap.utils.source_manager import source_manager as _global_source_manager

logger = logging.getLogger(__name__)


class CPGNode(BaseModel):
    """CPG 核心基类"""
    id: Optional[int] = Field(default=None, description="Global ID")
    label: Union[str, Enum]
    is_stub: bool = Field(default=False)
    tags: List[str] = Field(default_factory=list)
    tags_provenance: Dict[str, Any] = Field(
        default_factory=dict,
        description="Provenance metadata for L2/L3 tags. Keys are tag strings, values are Provenance dicts."
    )

    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        exclude=True,
        description="Transient per-run scratch space. Never persisted to storage. Use top-level Pydantic fields for data that must survive storage round-trips."
    )

    _node_registry: ClassVar[Dict[str, Type['CPGNode']]] = {}

    model_config = ConfigDict(
        validate_assignment=True,
        populate_by_name=True,
        extra='ignore'
    )

    def __hash__(self):
        if self.id is not None:
            return hash(self.id)
        return hash(id(self))

    def __eq__(self, other):
        if isinstance(other, CPGNode):
            if self.id is not None and other.id is not None:
                return self.id == other.id
        return self is other

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls.__name__ in ("CPGNode", "GenericNode", "AstNode", "Declaration"):
            return
        try:
            label_str = cls._extract_label_from_class()
            if label_str:
                cls._node_registry[label_str] = cls
        except Exception as e:
            logger.error(f"Failed to register CPG node class {cls.__name__}: {e}")

    @classmethod
    def _extract_label_from_class(cls) -> Optional[str]:
        raw_value = getattr(cls, 'label', None)
        if isinstance(raw_value, FieldInfo):
            raw_value = raw_value.default
            if raw_value is PydanticUndefined:
                return None
        if isinstance(raw_value, Enum):
            return raw_value.value
        if isinstance(raw_value, str):
            return raw_value
        return None

    @classmethod
    def get_class_by_label(cls, label: str) -> Type['CPGNode']:
        return cls._node_registry.get(label, GenericNode)


class AstNode(CPGNode):
    """
    抽象语法树 (AST) 节点基类。
    """
    code: Optional[str] = Field(default=None)
    code_hash: Optional[str] = Field(default=None)

    # 位置信息
    line_number: Optional[int] = Field(default=None, alias="lineNumber")
    column_number: Optional[int] = Field(default=None, alias="columnNumber")
    line_number_end: Optional[int] = Field(default=None, alias="lineNumberEnd")
    column_number_end: Optional[int] = Field(default=None, alias="columnNumberEnd")

    offset_start: Optional[int] = Field(default=None, alias="offsetStart")
    offset_end: Optional[int] = Field(default=None, alias="offsetEnd")

    order: Optional[int] = Field(default=None, description="AST 中的子节点顺序")
    file_name: Optional[str] = Field(default=None, alias="fileName")

    alias_names: List[str] = Field(default_factory=list, alias="aliasNames", description="存储源码中出现的原始名字列表")
    mangled_name: Optional[str] = Field(default=None, alias="mangledName", description="C++ 符号修饰名 (用于精确链接)")
    ast_parent_type: Optional[str] = Field(default=None, alias="astParentType", description="父节点的 Label 类型")
    ast_parent_full_name: Optional[str] = Field(default=None, alias="astParentFullName", description="父节点的全名")

    model_config = ConfigDict(extra='allow')

    def get_code(self, source_manager=None) -> Optional[str]:
        if self.code is not None:
            return self.code

        mgr = source_manager or _global_source_manager
        if not mgr:
            return None

        if not (self.file_name and self.offset_start is not None and self.offset_end is not None):
            return None

        try:
            fetched_code = mgr.get_code(self.file_name, self.offset_start, self.offset_end)
            if fetched_code:
                self.code = fetched_code
            return fetched_code
        except Exception as e:
            logging.getLogger(__name__).error(f"Unexpected error in get_code for node {self.id}: {e}")
            return None

    @model_validator(mode='after')
    def auto_generate_id(self):
        if self.id is not None:
            return self

        label_str = self.label.value if hasattr(self.label, 'value') else str(self.label)

        # ---------------------------------------------------------
        # Logic 1: Global Declarations (Type, Method)
        # 这些节点跨文件链接时需要稳定的 ID (Signature-based)
        # ---------------------------------------------------------
        if label_str in ("METHOD", "TYPE_DECL", "TYPE", "META_DATA"):
            full_name = getattr(self, "full_name", None) or getattr(self, "name", None)

            extra_sig = ""
            if label_str == "METHOD":
                extra_sig = getattr(self, "signature", "") or "NOSIG"

            if self.file_name and full_name:
                self.id = generate_deterministic_id(self.file_name, label_str, full_name, extra_sig)
            elif full_name:
                self.id = generate_deterministic_id("GLOBAL", label_str, full_name)
            return self

        # ---------------------------------------------------------
        # Logic 2: File Node
        # ---------------------------------------------------------
        if label_str == "FILE":
            path = getattr(self, "full_name", None) or getattr(self, "name", None)
            if path:
                self.id = generate_deterministic_id("FILE", path)
            return self

        # ---------------------------------------------------------
        # Logic 3: AST Nodes (Local structure)
        # ID 完全基于构造时已知的静态属性，不依赖运行时 IO
        # ---------------------------------------------------------
        if self.file_name:
            order_val = self.order if self.order is not None else -1
            arg_idx = getattr(self, "argument_index", -1)
            arg_idx = arg_idx if arg_idx is not None else -1

            line_num = self.line_number if self.line_number is not None else -1
            col_num = self.column_number if self.column_number is not None else -1

            # 使用 offset 区间 + 已有的 code 字段（如果构造时显式传入了的话）作为 salt
            # 不调用 get_code() 以避免在 validator 中产生 IO 副作用
            start = self.offset_start if self.offset_start is not None else -1
            end = self.offset_end if self.offset_end is not None else -1
            code_hint = self.code[:32] if self.code else ""

            self.id = generate_deterministic_id(
                self.file_name,
                label_str,
                str(line_num),
                str(col_num),
                str(order_val),
                str(arg_idx),
                str(start),
                str(end),
                code_hint
            )
        else:
            # 没有文件归属的游离节点，使用 Snowflake ID
            self.id = generate_id()

        return self


class GenericNode(CPGNode):
    label: str = "UNKNOWN"
    model_config = ConfigDict(extra='allow')