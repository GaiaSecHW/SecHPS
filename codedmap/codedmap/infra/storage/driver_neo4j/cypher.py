# codedmap/infra/storage/driver_neo4j/cypher.py

from typing import Dict, Any, Tuple

from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph import AnyNode, CPGEdge
from codedmap.infra.storage.base.edge_identity import edge_semantic_identity


class CypherTemplates:

    # 逻辑：直接创建新节点，并打上 Base Label
    CREATE_NODE = f"""
    UNWIND $batch AS data
    CREATE (n:`{{label}}`:{NodeLabel.BASE_LABEL.value})
    SET n = data
    """

    NODE_MERGE_OVERWRITE = f"""
    UNWIND $batch AS data
    MERGE (n:{NodeLabel.BASE_LABEL.value} {{{{id: data.id}}}})
    ON CREATE SET n = data, n:`{{label}}`
    ON MATCH SET n:`{{label}}`
    """

    NODE_MERGE_SKIP = f"""
    UNWIND $batch AS data
    MERGE (n:`{{label}}` {{{{id: data.id}}}})
    ON CREATE SET n = data, n:{NodeLabel.BASE_LABEL.value}
    ON MATCH SET n:{NodeLabel.BASE_LABEL.value} 
    """

    NODE_CREATE_FAIL = f"""
    UNWIND $batch AS data
    CREATE (n:`{{label}}`:{NodeLabel.BASE_LABEL.value})
    SET n = data
    """

    EDGE_MERGE = f"""
    UNWIND $batch AS row
    MATCH (a:{NodeLabel.BASE_LABEL.value} {{{{id: row.s}}}})
    MATCH (b:{NodeLabel.BASE_LABEL.value} {{{{id: row.d}}}})
    MERGE (a)-[r:`{{type}}` {{{{__semantic_value: row.p.__semantic_value}}}}]->(b)
    SET r += row.p
    """

    EDGE_CREATE = f"""
    UNWIND $batch AS row
    MATCH (a:{NodeLabel.BASE_LABEL.value} {{{{id: row.s}}}})
    MATCH (b:{NodeLabel.BASE_LABEL.value} {{{{id: row.d}}}})
    CREATE (a)-[r:`{{type}}`]->(b)
    SET r = row.p
    """

    UPDATE_NODES_BY_ID = f"""
    UNWIND $batch as row
    MATCH (n:{NodeLabel.BASE_LABEL.value} {{id: row.id}})
    SET n += row
    """

    # 批量标签追加 (Set Union Logic)
    # 逻辑：n.tags = old_tags + [t IN new_tags WHERE NOT t IN old_tags]
    # 包含了对 n.tags 为 NULL 的初始化处理
    ADD_TAGS_BATCH = f"""
    UNWIND $batch as row
    MATCH (n:{NodeLabel.BASE_LABEL.value} {{id: row.id}})
    SET n.tags = CASE 
        WHEN n.tags IS NULL THEN row.tags
        ELSE n.tags + [t IN row.tags WHERE NOT t IN n.tags]
    END
    """

    DELETE_NODES_BY_ID = f"""
    UNWIND $ids AS i
    MATCH (n:{NodeLabel.BASE_LABEL.value}) WHERE n.id = i
    DETACH DELETE n
    """

    DELETE_EDGES_BY_ENDPOINTS = f"""
    UNWIND $batch as row
    MATCH (s:{NodeLabel.BASE_LABEL.value} {{id: row.src}})-[r:`{{type}}`]->(d:{NodeLabel.BASE_LABEL.value} {{id: row.dst}})
    DELETE r
    """

    DELETE_OUTGOING_NEIGHBORS = f"""
    UNWIND $batch AS src_id
    MATCH (s:{NodeLabel.BASE_LABEL.value} {{id: src_id}})-[r:`{{type}}`]->(t)
    DETACH DELETE t
    """


LIST_ALL_TAGS = (
    "MATCH (n) WHERE n.tags IS NOT NULL "
    "UNWIND n.tags AS tag "
    "WITH DISTINCT tag "
    "WHERE tag IS NOT NULL AND tag <> '' "
    "RETURN tag ORDER BY tag"
)

LIST_TAGS_WITH_PREFIX = (
    "MATCH (n) WHERE n.tags IS NOT NULL "
    "UNWIND n.tags AS tag "
    "WITH DISTINCT tag "
    "WHERE tag IS NOT NULL AND tag <> '' "
    "  AND toUpper(tag) STARTS WITH $prefix "
    "RETURN tag ORDER BY tag"
)


class DataPrep:
    @staticmethod
    def node_to_dict(node: AnyNode) -> Tuple[Dict[str, Any], str]:
        props = node.model_dump(exclude_none=True, by_alias=True)
        raw_label = props.get('label', 'UNKNOWN')
        label_str = raw_label.value if hasattr(raw_label, 'value') else str(raw_label)

        if 'properties' in props:
            props.update(props.pop('properties'))

        if 'id' in props:
            props['id'] = int(props['id'])

        # props['label'] = label_str

        # 我们需要在返回值里单独返回 label_str 给模板用的 {label} 占位符
        # 但 props (即 data) 里不需要包含它
        if 'label' in props:
            del props['label']

        return props, label_str

    @staticmethod
    def edge_to_dict(edge: CPGEdge) -> Tuple[Dict[str, Any], str]:
        type_str = edge.type.value if hasattr(edge.type, 'value') else str(edge.type)

        # [Fix] 防御性处理 properties
        raw_props = edge.properties if edge.properties else {}

        # 深度清洗：如果 raw_props 包含 'properties' 键且是字典，则解包
        if 'properties' in raw_props and isinstance(raw_props['properties'], dict):
            flat_props = raw_props.copy()
            inner = flat_props.pop('properties')
            flat_props.update(inner)
            raw_props = flat_props

        # [Phase 19] Inject semantic identity fields for Neo4j relationship merge.
        # These reserved __semantic_* keys become part of the MERGE pattern so that
        # same-endpoint edges with different semantic properties are not collapsed.
        semantic_slot, semantic_value = edge_semantic_identity(type_str, raw_props)
        props_with_identity = raw_props.copy()
        props_with_identity["__semantic_slot"] = semantic_slot or ""
        props_with_identity["__semantic_value"] = semantic_value if semantic_value is not None else ""

        data = {
            "s": int(edge.src),
            "d": int(edge.dst),
            "p": props_with_identity
        }
        return data, type_str