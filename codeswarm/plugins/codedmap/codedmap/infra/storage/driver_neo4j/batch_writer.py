import random
import time
from collections import defaultdict
import json
from typing import Dict, List, Any, Iterable, Literal, Union
import logging

from neo4j.exceptions import ConstraintError, TransientError

from codedmap.core.schema.graph import CPGGraph, AnyNode, CPGEdge
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, EdgeDirection
from .client import Neo4jClient
from .cypher import CypherTemplates, DataPrep

from codedmap.infra.storage.base.edge_identity import edge_semantic_identity

logger = logging.getLogger(__name__)


class BatchGraphWriter:
    """
    [Utility] Neo4j 批量写入缓冲器。
    用于初始化导入或大规模数据写入。
    """

    def __init__(self, client: Neo4jClient, batch_size: int = 2000, mode: Literal["merge", "create"] = "merge"):
        self.client = client
        self.batch_size = batch_size
        self.mode = mode

        # Buffer: { label_or_type: [props_dict] }
        self._node_buffers: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._edge_buffers: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.flush()

    def write_graph(self, graph: CPGGraph):
        if graph.nodes: self.add_nodes(graph.nodes.values())
        if graph.edges: self.add_edges(graph.edges)
        self.flush()

    def add_nodes(self, nodes: Iterable[AnyNode]):
        for node in nodes:
            props, label = DataPrep.node_to_dict(node)
            self._node_buffers[label].append(props)

            if len(self._node_buffers[label]) >= self.batch_size:
                self._flush_nodes_by_label(label)

    def add_edges(self, edges: Iterable[CPGEdge]):
        for edge in edges:
            data, type_str = DataPrep.edge_to_dict(edge)
            self._edge_buffers[type_str].append(data)

            if len(self._edge_buffers[type_str]) >= self.batch_size:
                self._flush_edges_by_type(type_str)

    def update_nodes_properties(self, label: Union[str, NodeLabel], updates: List[Dict[str, Any]],
                                match_key: str = "id"):
        """批量属性更新 (立即执行，不缓冲)"""
        if not updates: return

        # 处理 Label
        label_str = label.value if hasattr(label, 'value') else str(label)

        # 动态构建 MATCH 子句
        if label_str == "ANY" or not label_str:
            target_label = NodeLabel.BASE_LABEL.value
        else:
            target_label = label_str

        match_clause = f"MATCH (n:`{target_label}` {{{match_key}: row.{match_key}}})"

        query = f"""
        UNWIND $batch AS row
        {match_clause}
        SET n += row
        """
        self.client.execute_write(query, {"batch": updates})

    def add_edges_batch(self, edges: List[Dict[str, Any]]):
        """
        [Bulk Insert] 极速批量插入边 (Immediate Execution)。
        直接利用 UNWIND 语法，跳过 CPGEdge 对象构建和 DataPrep 开销。

        Args:
            edges: [{'src': 1, 'dst': 2, 'type': 'CALL', 'properties': {...}}, ...]
        """
        if not edges: return

        # 1. Group by Edge Type to minimize query compilation overhead
        # Neo4j 不支持动态参数化 Edge Type (e.g. MERGE (a)-[r:$type]->(b))，只能拼接字符串
        grouped = defaultdict(list)
        for e in edges:
            etype = e.get('type')
            if not etype: continue

            # 预处理数据以匹配 CypherTemplates.EDGE_MERGE 的输入格式
            # 模板期望: {s: src_id, d: dst_id, p: properties}
            props = e.get('properties', {})

            # [Phase 19] Inject semantic identity fields for merge pattern compat
            semantic_slot, semantic_value = edge_semantic_identity(etype, props)
            props_with_id = props.copy() if isinstance(props, dict) else dict(props)
            props_with_id["__semantic_slot"] = semantic_slot or ""
            props_with_id["__semantic_value"] = semantic_value if semantic_value is not None else ""

            row = {
                "s": int(e['src']),
                "d": int(e['dst']),
                "p": props_with_id
            }
            grouped[etype].append(row)

        # 2. Execute Batch
        tpl = CypherTemplates.EDGE_CREATE if self.mode == "create" else CypherTemplates.EDGE_MERGE

        for etype, batch in grouped.items():
            # 分块执行以防止内存溢出 (Neo4j heap limit)
            for i in range(0, len(batch), self.batch_size):
                chunk = batch[i: i + self.batch_size]
                query = tpl.format(type=etype)
                try:
                    self.client.execute_write(query, {"batch": chunk})
                except Exception as e:
                    logger.error(f"Failed to add edge batch for type {etype}: {e}")
                    raise

    def add_tags_batch(self, batch_data: List[Dict[str, Any]]):
        """
        [New] 批量添加标签 (立即执行)。

        Args:
            batch_data: 包含 id 和 tags 的字典列表。
                        e.g. [{'id': 1, 'tags': ['A', 'B']}, {'id': 2, 'tags': ['C']}]
        Logic:
            使用 Pure Cypher 实现集合并集 (Set Union)，避免重复添加。
        """
        if not batch_data:
            return

        # 分块执行以避免大事务
        for i in range(0, len(batch_data), self.batch_size):
            chunk = batch_data[i: i + self.batch_size]
            self.client.execute_write(CypherTemplates.ADD_TAGS_BATCH, {"batch": chunk})

    def delete_nodes(self, node_ids: List[int]):
        """批量删除 (立即执行，不缓冲)"""
        if not node_ids: return
        # 分块删除
        chunk_size = 5000
        for i in range(0, len(node_ids), chunk_size):
            chunk = [int(uid) for uid in node_ids[i:i + chunk_size]]
            self.client.execute_write(CypherTemplates.DELETE_NODES_BY_ID, {"ids": chunk})

    def delete_neighbor_nodes_batch(self, source_node_ids: List[int], edge_type: Union[str, EdgeType],
                                    direction: EdgeDirection):
        """
        批量删除指定节点通过特定边连接的邻居。
        """
        type_str = edge_type.value if hasattr(edge_type, 'value') else str(edge_type)

        if direction == EdgeDirection.OUT:
            query = CypherTemplates.DELETE_OUTGOING_NEIGHBORS.format(type=type_str)
        else:
            raise NotImplementedError("Currently only OUT direction is supported for neighbor deletion")

        # 将 ids 转换为 set 去重，防止重复操作
        ids = list(set(map(int, source_node_ids)))
        if not ids: return

        self.client.execute_write(query, {"batch": ids})

    def flush(self):
        """强制提交所有缓冲区"""
        for label in list(self._node_buffers.keys()):
            self._flush_nodes_by_label(label)
        for etype in list(self._edge_buffers.keys()):
            self._flush_edges_by_type(etype)

    def _flush_nodes_by_label(self, label: str):
        batch = self._node_buffers[label]
        if not batch: return

        # 1. 内存去重 (保留最后一份)
        unique_batch_map = {item['id']: item for item in batch}
        deduped_batch = list(unique_batch_map.values())

        # 强制使用 MERGE 模式
        tpl = CypherTemplates.NODE_MERGE_OVERWRITE
        query = tpl.format(label=label)

        # [Strategy] 指数退避重试 (Exponential Backoff)
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.client.execute_write(query, {"batch": deduped_batch})
                batch.clear()
                return  # 成功则退出

            except (ConstraintError, TransientError) as e:
                # 只有当是 Constraint 错误（可能是竞争）或 Transient 错误（死锁/超时）时才重试
                if attempt < max_retries - 1:
                    sleep_time = random.uniform(0.1, 0.5) * (2 ** attempt)
                    logger.warning(f"Merge race detected for {label}. Retrying in {sleep_time:.2f}s... (Attempt {attempt + 1})")
                    time.sleep(sleep_time)
                else:
                    # 重试耗尽，记录详细诊断日志并抛出
                    self._log_batch_failure(label, deduped_batch, e)
                    raise
            except Exception as e:
                # 其他错误直接抛出
                logger.error(f"Flush failed for {label} with unexpected error: {e}")
                raise

    def _flush_edges_by_type(self, edge_type: str):
        batch = self._edge_buffers[edge_type]
        if not batch: return

        tpl = CypherTemplates.EDGE_CREATE if self.mode == "create" else CypherTemplates.EDGE_MERGE
        query = tpl.format(type=edge_type)

        try:
            self.client.execute_write(query, {"batch": batch})
            batch.clear()
        except Exception as e:
            # [Cleanup] 简化日志
            logger.error(f"Flush edges failed for type '{edge_type}'. Count: {len(batch)}. Error: {e}")
            # 如果需要调试，可以使用 logger.debug 打印 query
            logger.debug(f"Failed Query Template: {query}")
            raise

    def _log_batch_failure(self, label: str, batch: list, error: Exception):
        """
        [Debug Helper] 当写入彻底失败时，采样打印冲突的 ID，帮助定位是否是哈希碰撞。
        """
        sample_ids = [item.get('id') for item in batch[:5]]
        logger.error(
            f"!!! FLUSH FAILED PERMANENTLY !!!\n"
            f"Label: {label}\n"
            f"Batch Size: {len(batch)}\n"
            f"Error: {error}\n"
            f"Sample IDs: {sample_ids}\n"
            f"Hint: If IDs match different node types, check ID generation logic."
        )