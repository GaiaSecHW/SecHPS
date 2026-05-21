# codedmap/infra/storage/driver_sqlite/serializer.py

import json
from typing import Any, Dict, Tuple, Optional
from codedmap.core.schema.graph import CPGNode, CPGEdge, AnyNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.infra.storage.base.converter import DataConverter
from codedmap.infra.storage.base.edge_identity import edge_semantic_identity


class SqliteSerializer:
    """
    [Helper] 负责 Python 对象与 SQLite存储格式(Flat) 之间的转换。
    """

    @staticmethod
    def node_to_row(node: AnyNode) -> Tuple[int, str, str]:
        """
        Input: CPGNode
        Output: (id, label, properties_json)
        """
        # 1. 提取基础属性
        node_id = int(node.id)

        # 2. 提取 Label
        raw_label = getattr(node, "label", NodeLabel.UNKNOWN)
        label_str = raw_label.value if hasattr(raw_label, 'value') else str(raw_label)

        # 3. 序列化属性
        data = node.model_dump(exclude_none=True, by_alias=True)
        if 'id' in data: del data['id']
        if 'label' in data: del data['label']

        # 处理 properties 嵌套
        if 'properties' in data:
            data.update(data.pop('properties'))

        return (node_id, label_str, json.dumps(data, ensure_ascii=False))

    @staticmethod
    def edge_to_row(edge: CPGEdge) -> Tuple[int, int, str, Optional[str], str, Optional[str], Optional[str]]:
        """
        Input: CPGEdge
        Output: (src, dst, type, properties_json_or_none, created_by, semantic_slot, semantic_value)

        Semantic columns enable SQLite to store parallel edges that differ by semantic property:
        - DDG edges with different 'variable' values
        - CFG edges with different 'label' values
        """
        src = int(edge.src)
        dst = int(edge.dst)

        raw_type = edge.type
        type_str = raw_type.value if hasattr(raw_type, 'value') else str(raw_type)

        created_by = edge.created_by

        # Compute semantic identity
        semantic_slot, semantic_value = edge_semantic_identity(type_str, edge.properties)

        # [Optimization] If no properties, store None (SQLite NULL)
        if not edge.properties:
            return (src, dst, type_str, None, created_by, semantic_slot, semantic_value)

        return (src, dst, type_str, json.dumps(edge.properties, ensure_ascii=False), created_by, semantic_slot, semantic_value)

    @staticmethod
    def row_to_edge(row: Tuple) -> CPGEdge:
        """
        Input: (src, dst, type, properties_json, created_by, semantic_slot, semantic_value)
        Output: CPGEdge

        Note: semantic_slot and semantic_value are storage-only columns used by the
        UNIQUE constraint for semantic dedup. They are not carried into CPGEdge
        because the semantic properties are already in the properties JSON.
        """
        src, dst, type_str, props_json, created_by, semantic_slot, semantic_value = row

        props = json.loads(props_json) if props_json else {}

        return CPGEdge(
            src=src,
            dst=dst,
            type=type_str,
            properties=props,
            created_by=created_by
        )

    @staticmethod
    def row_to_node(row: Tuple, model_class=None) -> AnyNode:
        """
        Input: (id, label, properties_json)
        Output: CPGNode (Pydantic)
        """
        node_id, label, props_json = row
        data = json.loads(props_json) if props_json else {}
        data['id'] = node_id
        data['label'] = label

        # 复用 driver_neo4j 中的转换逻辑 (通用转换器)
        return DataConverter.to_pydantic(data, model_class=model_class)

    @staticmethod
    def row_to_dict(row: Tuple) -> Dict[str, Any]:
        """
        [Lightweight] 仅返回字典，用于内部处理或流式传输
        Input: (id, label, properties_json)
        """
        node_id, label, props_json = row
        data = json.loads(props_json) if props_json else {}
        data['id'] = node_id
        data['label'] = label
        return data