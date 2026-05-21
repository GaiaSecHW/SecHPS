# codedmap/frontend/integrations/joern/mapper.py

"""
Joern -> codedmap 节点/边映射器。

职责：
1. 节点 label 映射（直接 / 别名 / GenericNode fallback）
2. 属性名标准化（FULL_NAME -> fullName）
3. 枚举值安全转换
4. 边类型映射和属性提取
"""

import logging
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Type

from codedmap.core.schema.graph.base import CPGNode, GenericNode
from codedmap.core.schema.graph.enums import (
    EdgeType, NodeLabel, safe_str_to_enum,
    DispatchType, ControlStructureType, ModifierType, EvaluationStrategy, Language,
)

from .constants import (
    PROPERTY_NAME_MAP,
    NODE_LABEL_ALIAS,
    EDGE_TYPE_ALIAS,
    EDGE_PROPERTY_KEYS,
    LANGUAGE_ALIAS,
)

logger = logging.getLogger(__name__)


CPP_EXTENSIONS = {'.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.cppm', '.ixx'}
PYTHON_EXTENSIONS = {'.py', '.pyw'}
JAVA_EXTENSIONS = {'.java'}


class JoernNodeMapper:
    """将 Joern CSV 行映射为 codedmap 节点构造参数。"""

    def __init__(self, skip_unknown_labels: bool = False):
        self.skip_unknown_labels = skip_unknown_labels
        self._unknown_labels_seen: set = set()

    def map_node(
        self, joern_label: str, joern_properties: Dict[str, Any]
    ) -> Optional[Tuple[Type[CPGNode], Dict[str, Any]]]:
        """
        将 Joern 节点数据映射为 (node_class, kwargs) 元组。

        Args:
            joern_label: Joern 的原始 label 字符串
            joern_properties: Joern CSV 行的属性字典（UPPER_SNAKE_CASE 键名）

        Returns:
            (node_class, kwargs) 或 None（如果应该跳过）
        """
        # 1. Label 映射
        mapped_label = NODE_LABEL_ALIAS.get(joern_label, joern_label)

        # 2. 获取对应的节点类
        node_class = CPGNode.get_class_by_label(mapped_label)

        if node_class is GenericNode and self.skip_unknown_labels:
            if mapped_label not in self._unknown_labels_seen:
                self._unknown_labels_seen.add(mapped_label)
                logger.warning(f"Skipping unknown label: {mapped_label}")
            return None

        # 3. 属性名标准化
        kwargs = self._map_properties(joern_properties, mapped_label)

        # 4. 设置 label
        # 尝试将 label 转为 NodeLabel 枚举
        label_enum = safe_str_to_enum(
            mapped_label, NodeLabel, NodeLabel.UNKNOWN,
            log_warning=False
        )
        kwargs["label"] = label_enum

        # 5. 枚举字段转换
        self._convert_enum_fields(kwargs)

        # 6. 特殊字段处理
        self._handle_special_fields(kwargs, mapped_label)

        return node_class, kwargs

    def _map_properties(
        self, joern_props: Dict[str, Any], label: str
    ) -> Dict[str, Any]:
        """将 Joern UPPER_SNAKE_CASE 属性名映射到 codedmap camelCase。"""
        result: Dict[str, Any] = {}

        for joern_key, value in joern_props.items():
            # 查找映射
            mapped_key = PROPERTY_NAME_MAP.get(joern_key)
            if mapped_key:
                result[mapped_key] = value
            else:
                # 未映射的属性保留原名（camelCase 或原始名），
                # 由 Pydantic extra='allow'/'ignore' 处理
                result[joern_key] = value

        return result

    def _convert_enum_fields(self, kwargs: Dict[str, Any]) -> None:
        """将字符串值转换为 codedmap 枚举类型。"""
        if "dispatchType" in kwargs:
            kwargs["dispatchType"] = safe_str_to_enum(
                kwargs["dispatchType"],
                DispatchType,
                DispatchType.STATIC_DISPATCH,
                context="JoernImport.dispatchType",
            )

        if "controlStructureType" in kwargs:
            kwargs["controlStructureType"] = safe_str_to_enum(
                kwargs["controlStructureType"],
                ControlStructureType,
                ControlStructureType.IF,
                context="JoernImport.controlStructureType",
            )

        if "modifierType" in kwargs:
            kwargs["modifierType"] = safe_str_to_enum(
                kwargs["modifierType"],
                ModifierType,
                ModifierType.PUBLIC,
                context="JoernImport.modifierType",
            )

        if "evaluationStrategy" in kwargs:
            kwargs["evaluationStrategy"] = safe_str_to_enum(
                kwargs["evaluationStrategy"],
                EvaluationStrategy,
                EvaluationStrategy.BY_VALUE,
                context="JoernImport.evaluationStrategy",
            )

        if "language" in kwargs:
            # Apply Joern language alias (e.g., NEWC -> C) before enum conversion
            raw_lang = kwargs["language"]
            kwargs["language"] = safe_str_to_enum(
                LANGUAGE_ALIAS.get(raw_lang, raw_lang),
                Language,
                Language.C,
                context="JoernImport.language",
            )

    def _handle_special_fields(self, kwargs: Dict[str, Any], label: str) -> None:
        """处理需要特殊转换的字段。"""
        # inheritsFromTypeFullName: Joern 可能存为分号分隔字符串
        if "inheritsFromTypeFullName" in kwargs:
            val = kwargs["inheritsFromTypeFullName"]
            if isinstance(val, str):
                kwargs["inheritsFromTypeFullName"] = [
                    s.strip() for s in val.split(";") if s.strip()
                ]

        # isExternal: 可能是字符串 "true"/"false"
        if "isExternal" in kwargs:
            val = kwargs["isExternal"]
            if isinstance(val, str):
                kwargs["isExternal"] = val.lower() in ("true", "1", "yes")

        # order: 确保为 int
        if "order" in kwargs and kwargs["order"] is not None:
            try:
                kwargs["order"] = int(kwargs["order"])
            except (ValueError, TypeError):
                kwargs["order"] = None

        # argumentIndex: 确保为 int
        if "argumentIndex" in kwargs and kwargs["argumentIndex"] is not None:
            try:
                kwargs["argumentIndex"] = int(kwargs["argumentIndex"])
            except (ValueError, TypeError):
                kwargs["argumentIndex"] = None

        # FILE 节点: 如果没有 language，根据文件后缀推断
        if label == "FILE" and "language" not in kwargs:
            full_name = kwargs.get("fullName", "") or kwargs.get("name", "")
            kwargs["language"] = self._infer_language_from_path(full_name)

    def _infer_language_from_path(self, path: str) -> Language:
        """根据文件后缀推断语言类型。"""
        ext = Path(path).suffix.lower()
        if ext in CPP_EXTENSIONS:
            return Language.CPP
        elif ext in PYTHON_EXTENSIONS:
            return Language.PYTHON
        elif ext in JAVA_EXTENSIONS:
            return Language.JAVA
        return Language.C


class JoernEdgeMapper:
    """将 Joern CSV 边数据映射为 codedmap 格式。"""

    def __init__(self, skip_edge_types: Optional[list] = None):
        self._skip_types = set(skip_edge_types or [])

    def map_edge(
        self, joern_type: str, joern_properties: Dict[str, Any]
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        """
        将 Joern 边数据映射为 (edge_type_str, properties)。

        Args:
            joern_type: Joern 原始边类型字符串
            joern_properties: Joern CSV 边属性

        Returns:
            (edge_type, properties) 或 None（如果应该跳过）
        """
        # 1. 检查是否需要跳过
        if joern_type in self._skip_types:
            return None

        # 2. 类型映射
        mapped_type = EDGE_TYPE_ALIAS.get(joern_type, joern_type)

        # 3. 尝试转为 EdgeType 枚举值
        edge_type_str = mapped_type
        try:
            edge_enum = EdgeType(mapped_type)
            edge_type_str = edge_enum.value
        except ValueError:
            # 不在枚举中的边类型，保留原始字符串
            # CPGEdge.type 支持 Union[EdgeType, str]
            pass

        # 4. 提取语义属性
        properties: Dict[str, Any] = {}

        # DDG 边的 VARIABLE 属性
        variable_key = EDGE_PROPERTY_KEYS.get(joern_type) or EDGE_PROPERTY_KEYS.get(mapped_type)
        if variable_key and variable_key in joern_properties:
            prop_name = "variable" if variable_key == "VARIABLE" else variable_key.lower()
            properties[prop_name] = joern_properties[variable_key]

        # CFG 边可能有条件标签
        if mapped_type == "CFG" and "CONDITION" in joern_properties:
            properties["label"] = str(joern_properties["CONDITION"])

        # ARGUMENT 边的 INDEX
        if mapped_type == "ARGUMENT" and "ARGUMENT_INDEX" in joern_properties:
            try:
                properties["argumentIndex"] = int(joern_properties["ARGUMENT_INDEX"])
            except (ValueError, TypeError):
                pass

        return edge_type_str, properties
