# codedmap/infra/storage/base/converter.py

from typing import Dict, Type, TypeVar, Any, Optional, List, Tuple
import logging

from codedmap.core.schema.graph.base import CPGNode, GenericNode
from codedmap.core.schema.graph.edges import CPGEdge
import codedmap.core.schema.graph.nodes

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=CPGNode)


def _load_neo4j_types() -> Tuple[Any, Any, Any]:
    """Import neo4j types lazily so non-Neo4j backends stay importable."""
    try:
        from neo4j import Record
        from neo4j.graph import Node as Neo4jNode
        from neo4j.graph import Relationship as Neo4jRelationship
        return Record, Neo4jNode, Neo4jRelationship
    except ImportError:
        return None, None, None


class DataConverter:
    """
    Neo4j 数据转换层 (Converter Layer).
    """

    @classmethod
    def to_pydantic(cls, data: Any, model_class: Type[T] = None, partial: bool = False) -> Optional[T]:
        """
        将 Neo4j 节点数据转换为 Pydantic 对象。

        Args:
            data: Neo4j 返回的数据 (Record, Node, or Dict)
            model_class: 目标 Pydantic 模型类
            partial: [New] 是否允许部分构建。如果为 True，将跳过必填字段校验。
                     用于 Batch Pass 的投影查询 (e.g. RETURN n.id, n.name)。
        """
        if data is None:
            return None

        props: Dict[str, Any] = {}
        labels: List[str] = []
        Record, Neo4jNode, _ = _load_neo4j_types()

        # 1. 数据解包 (Unpacking)
        if Record is not None and isinstance(data, Record):
            # Case A: 包含完整 Node 对象 (RETURN n)
            target = data.get('n') or data.get('node') or data.get('chunk')

            if Neo4jNode is not None and target and isinstance(target, Neo4jNode):
                data = target

            # Case B: 可能是投影查询 (RETURN n.id, n.name)
            # 这种情况下 data 依然是 Record，表现类似 Dict
            else:
                # 尝试寻找值里的 Node (兼容旧逻辑)
                found_node = False
                for val in data.values():
                    if Neo4jNode is not None and isinstance(val, Neo4jNode):
                        data = val
                        found_node = True
                        break

                # [Fix] 如果没找到 Node 对象，说明这是扁平的投影数据，直接转 dict
                if not found_node:
                    data = dict(data)

        # 2. 提取属性与标签
        if Neo4jNode is not None and isinstance(data, Neo4jNode):
            props = dict(data)
            labels = list(data.labels)
        elif isinstance(data, dict):
            # 处理嵌套情况 (RETURN {id:..., props:...})
            if 'n' in data and isinstance(data['n'], (Neo4jNode, dict)):
                return cls.to_pydantic(data['n'], model_class, partial=partial)

            props = data.copy()
            # 尝试提取 Label (如果是投影查询，可能没有 label 字段，这是允许的)
            if 'label' in props: labels.append(props.pop('label'))
            if 'labels' in props: labels.extend(props.pop('labels'))
        else:
            # 无法识别的数据类型
            return None

        # 3. ID 校验 (Strict Mode)
        if 'id' in props:
            try:
                props['id'] = int(props['id'])
            except (ValueError, TypeError):
                logger.warning(f"Invalid ID format: {props.get('id')}")
                return None
        else:
            # 只有在非 partial 模式下才严格拒绝无 ID 数据
            # 在 partial 模式下，如果我们查询的是 property("name") 而没查 id，也应该允许
            if not partial:
                logger.warning("Node missing 'id'. Refusing to convert.")
                return None

        # 4. Label 注入与类型推断
        if labels and 'label' not in props:
            props['label'] = labels[0]

        target_cls = model_class
        # 如果未指定类型，或者指定的是基类，尝试根据 Label 推断
        if target_cls is None or target_cls is CPGNode:
            inferred_cls = None
            for l in labels:
                candidate = CPGNode.get_class_by_label(l)
                if candidate and candidate is not GenericNode and candidate is not CPGNode:
                    inferred_cls = candidate
                    break
            target_cls = inferred_cls if inferred_cls else GenericNode

        # 5. 实例化 (Instantiation) - [Critical Fix]
        try:
            if partial:
                # [Optimization] 极速构建，绕过 Pydantic 校验
                # 适用于 Batch Pass，因为我们知道字段可能不全
                return target_cls.model_construct(**props)
            else:
                # [Standard] 标准构建，执行严格校验
                return target_cls.model_validate(props)

        except Exception as e:
            node_id = props.get('id', 'Unknown')
            logger.debug(f"Mapping failed. Target: {target_cls.__name__}, ID: {node_id}, Error: {e}")
            # Fallback to GenericNode (mirrors importer's fallback behavior)
            if target_cls is not GenericNode:
                try:
                    return GenericNode.model_validate(props)
                except Exception:
                    pass
            return None

    @staticmethod
    def to_cpg_edge(data: Any) -> Optional[CPGEdge]:
        """
        将数据转换为 CPGEdge。
        [Fix] 显式提取 created_by 字段，保持模型一致性。
        """
        if data is None: return None

        src_id = None
        dst_id = None
        edge_type = None
        props = {}
        Record, Neo4jNode, Neo4jRelationship = _load_neo4j_types()

        if Neo4jRelationship is not None and isinstance(data, Neo4jRelationship):
            try:
                src_id = data.start_node.get('id')
                dst_id = data.end_node.get('id')
            except Exception:
                pass
            edge_type = data.type
            # 复制属性，避免修改原始对象
            if hasattr(data, 'items'): props = dict(data)

        else:
            row = dict(data) if Record is not None and isinstance(data, Record) else data
            src_id = row.get('src') or row.get('src_id')
            dst_id = row.get('dst') or row.get('dst_id')

            if Neo4jNode is not None and isinstance(src_id, Neo4jNode):
                src_id = src_id.get('id')
            if Neo4jNode is not None and isinstance(dst_id, Neo4jNode):
                dst_id = dst_id.get('id')

            edge_type = row.get('type')
            props = row.get('props', {})
            if not isinstance(props, dict) and hasattr(props, 'items'):
                props = dict(props)
            # 如果是 Record 且 created_by 在顶层 (视查询语句而定)
            # 如果 created_by 在 props 里，下面会处理

        if src_id is None or dst_id is None: return None

        # [Phase 19] Strip reserved internal semantic identity keys.
        # These are backend-only fields used by Neo4j merge patterns and must
        # not leak into public CPGEdge.properties.
        _RESERVED_SEMANTIC_KEYS = {"__semantic_slot", "__semantic_value"}
        if isinstance(props, dict):
            props = {k: v for k, v in props.items() if k not in _RESERVED_SEMANTIC_KEYS}

        # [Fix Start] 提取 created_by
        # 默认 'static'，如果数据库里有则覆盖
        created_by = 'static'
        if 'created_by' in props:
            created_by = props.pop('created_by')
        # [Fix End]

        try:
            return CPGEdge(
                src=int(src_id),
                dst=int(dst_id),
                type=edge_type,
                properties=props,
                created_by=created_by  # 显式传递
            )
        except Exception as e:
            logger.error(f"Edge conversion failed: {e}")
            return None
