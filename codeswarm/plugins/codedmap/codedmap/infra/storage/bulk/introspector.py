# codedmap/infra/storage/bulk/introspector.py

from dataclasses import dataclass
from typing import List, Type, Any, Optional, get_origin, get_args, Union, Dict
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType


@dataclass
class PropertyMeta:
    """
    [Metadata] 描述一个属性的元数据。

    attr_name: Python 对象上的属性名 (用于 getattr)
    export_name: 导出到 CSV Header 的名称 (通常是 Pydantic 的 alias，如果无 alias 则等于 attr_name)
    py_type: 清洗后的 Python 类型 (去除了 Optional 等包装)，用于 Driver 决定数据库类型
    """
    attr_name: str
    export_name: str
    py_type: Any


class SchemaIntrospector:
    """
    [Generic Service] 模式内省服务。
    负责从 Pydantic 模型或预定义规则中提取属性元数据，供 Writer 生成 Header 和 Row。
    """

    # 预定义边属性映射 (EdgeType string -> Dict[prop_name, type])
    # 如果未来 Edge 也实现了 Pydantic 模型，可以像 Node 一样反射
    _EDGE_PROPS_MAP: Dict[str, List[PropertyMeta]] = {
        EdgeType.AST.value: [PropertyMeta("order", "order", int)],
        EdgeType.CFG.value: [PropertyMeta("label", "label", str)],
        EdgeType.ARGUMENT.value: [PropertyMeta("argumentIndex", "argumentIndex", int)],
        EdgeType.DDG.value: [PropertyMeta("variable", "variable", str)],
    }

    @classmethod
    def get_node_properties(cls, label: str) -> List[PropertyMeta]:
        """
        反射获取节点的属性列表。
        """
        model_cls = CPGNode.get_class_by_label(label)
        if not model_cls:
            return []

        props = []
        for field_name, field_info in model_cls.model_fields.items():
            # 1. 排除系统保留字段
            if field_name in ('id', 'label', 'metadata'):
                continue

            # 2. 业务规则排除 (例如: IDENTIFIER/LITERAL 的 code 字段过大且冗余)
            if field_name == 'code' and label in ['IDENTIFIER', 'LITERAL']:
                continue

            # 3. 解析导出名 (Alias)
            # Neo4j/CSV 通常使用 alias 作为列名
            export_name = field_info.alias or field_name

            # 4. 类型清洗 (Optional[int] -> int)
            clean_type = cls._unwrap_type(field_info.annotation)

            props.append(PropertyMeta(
                attr_name=field_name,
                export_name=export_name,
                py_type=clean_type
            ))

        return props

    @classmethod
    def get_edge_properties(cls, type_str: str) -> List[PropertyMeta]:
        """
        获取边的属性列表。
        目前基于静态映射，未来可扩展。
        """
        return cls._EDGE_PROPS_MAP.get(type_str, [])

    @staticmethod
    def _unwrap_type(py_type: Any) -> Any:
        """
        [Helper] 解包 Type Hint，获取核心类型。
        Optional[List[int]] -> List[int]
        Union[str, None] -> str
        """
        origin = get_origin(py_type)
        args = get_args(py_type)

        # 处理 Union / Optional
        if origin is Union:
            # 过滤掉 NoneType
            valid_args = [a for a in args if a is not type(None)]
            if len(valid_args) == 1:
                # 递归解包 (处理 Optional[List[...]])
                return SchemaIntrospector._unwrap_type(valid_args[0])
            # 如果是 Union[int, str]，通常视为 str 兼容
            return str

        # List 不解包，保留 List[int] 结构，
        # 因为 Neo4j 区分 :int 和 :int[]

        return py_type