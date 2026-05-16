# codedmap/infra/storage/driver_neo4j/writer.py

from collections import defaultdict
import logging
from typing import List, Dict, Any, Set, Optional
from neo4j import Transaction

from codedmap.core.schema.graph.enums import EdgeDirection, NodeLabel
from codedmap.core.schema.graph.patch import NodeListUpdate, PruneRequest
from codedmap.infra.storage.base.writer import BaseGraphWriter
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.infra.storage.driver_neo4j.connection import Neo4jTransactionContext
from codedmap.infra.storage.driver_neo4j.batch_writer import BatchGraphWriter
from codedmap.infra.storage.driver_neo4j.cypher import CypherTemplates, DataPrep

logger = logging.getLogger(__name__)


class Neo4jWriter(BaseGraphWriter):
    """
    Neo4j 原子写入器。
    [Fix] 实现了基于 created_by 的精确清理逻辑。
    """

    def __init__(self, client: Neo4jClient, batch_size: int = 2000):
        self.client = client
        self.batch_size = batch_size

    # --- Public API Delegates ---

    def save_graph(self, graph):
        with BatchGraphWriter(self.client, batch_size=self.batch_size, mode="merge") as bw:
            bw.write_graph(graph)

    def update_nodes_properties(self, label: str, updates: List[Dict[str, Any]], match_key: str = "id"):
        with BatchGraphWriter(self.client, batch_size=self.batch_size) as bw:
            bw.update_nodes_properties(label, updates, match_key)

    def add_edges_batch(self, edges: List[Dict[str, Any]]):
        with BatchGraphWriter(self.client, batch_size=self.batch_size, mode="merge") as bw:
            bw.add_edges_batch(edges)

    def add_tags_batch(self, tags: List[Dict[str, Any]]):
        with BatchGraphWriter(self.client, batch_size=self.batch_size) as bw:
            bw.add_tags_batch(tags)

    def property_list_append(self, node_id: int, key: str, value: Any, unique: bool = True):
        op = "CASE WHEN NOT $val IN n.`{k}` THEN n.`{k}` + $val ELSE n.`{k}` END" if unique else "n.`{k}` + $val"
        query = f"""
        MATCH (n:{NodeLabel.BASE_LABEL.value}) WHERE n.id = $id
        SET n.`{key}` = CASE 
            WHEN n.`{key}` IS NULL THEN [$val]
            ELSE {op.format(k=key)}
        END
        """
        self.client.execute_write(query, {"id": node_id, "val": value})

    def property_list_remove(self, node_id: int, key: str, value: Any):
        query = f"""
        MATCH (n:{NodeLabel.BASE_LABEL.value}) WHERE n.id = $id AND n.`{key}` IS NOT NULL
        SET n.`{key}` = [x IN n.`{key}` WHERE x <> $val]
        """
        self.client.execute_write(query, {"id": node_id, "val": value})

    def delete_nodes(self, node_ids: List[int]):
        with BatchGraphWriter(self.client, batch_size=self.batch_size) as bw:
            bw.delete_nodes(node_ids)

    def delete_neighbor_nodes(self, source_node_ids: List[int], edge_type: str, direction: EdgeDirection):
        with BatchGraphWriter(self.client, batch_size=self.batch_size) as bw:
            bw.delete_neighbor_nodes_batch(source_node_ids, edge_type, direction)

    # --- Transaction Context ---

    def _transaction_context(self):
        return Neo4jTransactionContext(self.client)

    # --- Atomic Operations Implementation (In Transaction) ---

    def _prune_neighbors_atomic(self, tx: Transaction, prunes: List[PruneRequest]):
        """
        [Critical Fix] 执行带有来源过滤的清理。
        区分四种情况：
        1. 指定源节点 + 指定来源 (Prune Neighbors Scoped)
        2. 指定源节点 + 所有来源 (Prune Neighbors All)
        3. 全局类型 + 指定来源 (Prune Global Scoped)
        4. 全局类型 + 所有来源 (Prune Global All - PDG Mode)
        """

        # 分组策略：Key = (edge_type, created_by)
        # Value = List[src_id] (如果为None则代表全局)
        grouped = defaultdict(list)
        global_flags = set()  # 记录哪些 (type, creator) 是全局删除

        for req in prunes:
            type_str = req.edge_type.value if hasattr(req.edge_type, 'value') else str(req.edge_type)
            key = (type_str, req.created_by)

            if req.src_id is None:
                # 标记为全局删除
                global_flags.add(key)
            else:
                grouped[key].append(req.src_id)

        # 执行删除
        # 我们需要遍历所有出现的 (type, creator) 组合
        all_keys = set(grouped.keys()) | global_flags

        for (edge_type, creator) in all_keys:
            # 构建 WHERE 子句
            where_clauses = [f"type(r) = '{edge_type}'"]
            params = {}

            if creator is not None:
                where_clauses.append("r.created_by = $creator")
                params["creator"] = creator

            is_global = (edge_type, creator) in global_flags

            if is_global:
                # Case 3 & 4: 全局删除该类型的边 (可能带 creator 过滤)
                # 使用高效的边扫描
                # OPTIONAL MATCH ()-[r]->() WHERE ... DELETE r
                query = f"""
                MATCH ()-[r]->() 
                WHERE {' AND '.join(where_clauses)}
                DELETE r
                """
                logger.info(f"[Neo4j] Global Prune: Type={edge_type}, Creator={creator}")
                tx.run(query, params)

            else:
                # Case 1 & 2: 指定源节点列表
                src_ids = list(set(grouped[(edge_type, creator)]))
                if not src_ids: continue

                # 使用 UNWIND 优化 ID 列表匹配
                # MATCH (n)-[r]->() WHERE n.id IN $ids AND ... DELETE r
                params["ids"] = src_ids

                query = f"""
                UNWIND $ids as src_id
                MATCH (n {{id: src_id}})-[r]->()
                WHERE {' AND '.join(where_clauses)}
                DELETE r
                """
                tx.run(query, params)

    def _remove_edges_atomic(self, tx: Transaction, edges: list):
        grouped = defaultdict(list)
        for req in edges:
            type_str = req.edge_type.value if hasattr(req.edge_type, 'value') else req.edge_type
            grouped[type_str].append({"src": req.src, "dst": req.dst})

        for type_str, batch in grouped.items():
            query = CypherTemplates.DELETE_EDGES_BY_ENDPOINTS.format(type=type_str)
            tx.run(query, batch=batch)

    def _remove_nodes_atomic(self, tx: Transaction, node_ids: Set[int]):
        tx.run(CypherTemplates.DELETE_NODES_BY_ID, ids=list(node_ids))

    def _add_nodes_atomic(self, tx: Transaction, nodes: list, strategy: str):
        grouped = defaultdict(list)
        for node in nodes:
            props, label = DataPrep.node_to_dict(node)
            grouped[label].append(props)

        strategy_val = self._get_strategy_value(strategy)

        for label_str, batch in grouped.items():
            if strategy_val == "FAIL_ON_EXIST":
                tpl = CypherTemplates.NODE_CREATE_FAIL
            elif strategy_val == "SKIP_ON_EXIST":
                tpl = CypherTemplates.NODE_MERGE_SKIP
            else:
                tpl = CypherTemplates.NODE_MERGE_OVERWRITE

            query = tpl.format(label=label_str)
            tx.run(query, batch=batch)

    def _add_edges_atomic(self, tx: Transaction, edges: list, strategy: str):
        grouped = defaultdict(list)
        for edge in edges:
            # 确保 created_by 字段被持久化
            # edge 是 CPGEdge 对象
            data, type_str = DataPrep.edge_to_dict(edge)

            # 显式添加 created_by (如果 DataPrep 没处理)
            if edge.created_by:
                data['created_by'] = edge.created_by

            grouped[type_str].append(data)

        strategy_val = self._get_strategy_value(strategy)

        for type_str, batch in grouped.items():
            if strategy_val == "FAIL_ON_EXIST":
                tpl = CypherTemplates.EDGE_CREATE
            else:
                tpl = CypherTemplates.EDGE_MERGE

            query = tpl.format(type=type_str)
            tx.run(query, batch=batch)

    def _update_nodes_atomic(self, tx: Transaction, updates: list):
        batch = []
        for u in updates:
            row = u.properties.copy()
            row['id'] = int(u.id)
            batch.append(row)
        tx.run(CypherTemplates.UPDATE_NODES_BY_ID, batch=batch)

    def _update_node_lists_atomic(self, tx: Transaction, updates: List[NodeListUpdate]):
        groups = defaultdict(lambda: defaultdict(list))
        for u in updates:
            groups[u.key][u.op].append({"id": u.id, "val": u.value})

        for key, ops_map in groups.items():
            # Append
            append_batch = ops_map.get("APPEND")
            if append_batch:
                query = f"""
                UNWIND $batch AS row
                MATCH (n:{NodeLabel.BASE_LABEL.value}) WHERE n.id = row.id
                SET n.`{key}` = CASE
                    WHEN n.`{key}` IS NULL THEN [row.val]
                    WHEN NOT row.val IN n.`{key}` THEN n.`{key}` + row.val
                    ELSE n.`{key}`
                END
                """
                tx.run(query, batch=append_batch)

            # Remove
            remove_batch = ops_map.get("REMOVE")
            if remove_batch:
                query = f"""
                UNWIND $batch AS row
                MATCH (n:{NodeLabel.BASE_LABEL.value}) WHERE n.id = row.id AND n.`{key}` IS NOT NULL
                SET n.`{key}` = [x IN n.`{key}` WHERE x <> row.val]
                """
                tx.run(query, batch=remove_batch)

    def _get_strategy_value(self, strategy) -> str:
        if hasattr(strategy, 'value'):
            return strategy.value
        return str(strategy)