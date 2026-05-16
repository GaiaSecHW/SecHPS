# codedmap/infra/storage/driver_neo4j/reader.py
import json
import logging
from typing import List, Dict, Optional, Any, Tuple
from collections import defaultdict

from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import NodeLabel, VectorIndexName

from codedmap.core.schema.graph import CPGGraph
from codedmap.infra.storage.interfaces import GraphReader
from codedmap.infra.storage.driver_neo4j.client import Neo4jClient
from codedmap.infra.storage.base.converter import DataConverter

logger = logging.getLogger(__name__)


class Neo4jReader(GraphReader):
    NEO4J_BATCH_SIZE = 5000

    def __init__(self, client: Neo4jClient):
        self.client = client
        self._loader = SubgraphLoader(client)

    def get_node(self, node_id: int) -> Optional[Any]:
        query = "MATCH (n) WHERE n.id = $id RETURN n"
        results = self.client.execute_read(query, {"id": int(node_id)})
        if not results:
            return None
        return DataConverter.to_pydantic(results[0])

    # [Mapping Logic] 定义 (Label, Property) -> IndexName 的映射表
    # 这确保了我们总是查询正确的索引
    _GLOBAL_VECTOR_INDEX = VectorIndexName.GLOBAL.value  # 需与 SchemaManager 中创建的索引名一致

    def get_nodes_batch(self, node_ids: List[int]) -> List[Any]:
        """
        批量获取节点对象

        Best Practices:
        1. 使用 IN 查询减少网络往返 (RTT)。
        2. 应用 Client 端分批 (Batching) 防止单次 Result Set 过大导致 OOM。
        3. 利用 Neo4j 的 ID 索引查找 (Index Seek)。
        """
        # 1. 快速返回
        if not node_ids:
            return []

        # 2. 去重与类型安全转换
        unique_ids = list(set(map(int, node_ids)))
        result_nodes = []
        total_count = len(unique_ids)

        # 定义查询模板
        # Neo4j 会自动缓存此 Execution Plan
        query = "MATCH (n) WHERE n.id IN $batch_ids RETURN n"

        # 3. 分批执行
        # 使用类定义的 NEO4J_BATCH_SIZE (通常 5000)
        for i in range(0, total_count, self.NEO4J_BATCH_SIZE):
            batch = unique_ids[i: i + self.NEO4J_BATCH_SIZE]

            try:
                # 使用 execute_read 以获得读写分离支持和自动重试
                records = self.client.execute_read(query, {"batch_ids": batch})

                for r in records:
                    # 复用转换器逻辑
                    node = DataConverter.to_pydantic(r['n'])
                    if node:
                        result_nodes.append(node)

            except Exception as e:
                logger.error(f"Failed to fetch nodes batch (Offset {i}, Size {len(batch)}): {e}")
                raise e

        return result_nodes

    def search_similar_nodes(self,
                             label: str,
                             property: str,
                             query_vector: List[float],
                             top_k: int = 5,
                             min_score: float = 0.0) -> List[Tuple[Any, float]]:
        """
        [Vector Search - Node Separation Adapted]
        执行两跳查询：Index(VectorNode) -> HAS_VECTOR -> HostNode
        """

        # 1. 解析 Label (用于过滤宿主类型)
        target_label = label
        if hasattr(label, 'value'):
            target_label = label.value

        # 2. 构造查询
        # 注意：这里我们忽略了 property 参数，因为在分离架构下，
        # 我们总是去查 VectorNode 的 embedding 属性，而不是宿主的属性。

        query = f"""
        // 1. 在全局向量索引上搜索 VectorNode
        CALL db.index.vector.queryNodes($index_name, $top_k, $query_vector)
        YIELD node AS vec_node, score
        WHERE score >= $min_score

        // 2. 回溯查找宿主节点 (Host)
        // 沿着 HAS_VECTOR 边反向查找
        MATCH (host)-[:HAS_VECTOR]->(vec_node)

        // 3. 过滤宿主类型 (根据传入的 label)
        // 使用 Cypher 动态标签过滤语法
        WHERE host:`{target_label}`

        RETURN host, score
        """

        try:
            results = self.client.execute_read(query, {
                "index_name": self._GLOBAL_VECTOR_INDEX,
                "top_k": top_k,
                "query_vector": query_vector,
                "min_score": min_score
            })

            # 4. 转换结果
            # 注意：Neo4j 返回的 'host' 节点可能不包含向量数据（这正是我们要的）
            return [
                (DataConverter.to_pydantic(r['host']), r['score'])
                for r in results if r['host']
            ]

        except Exception as e:
            # 容错：如果索引不存在，或者类型错误
            logger.error(f"Vector search failed (Index: {self._GLOBAL_VECTOR_INDEX}): {e}")
            # 尝试回退到旧逻辑？通常不需要，直接返回空
            return []

    def get_neighbors(self, node_id: int, direction: str, edge_types: Optional[List[str]]) -> List[int]:
        arrow = self._build_arrow(direction, edge_types)
        query = f"MATCH (n){arrow}(m) WHERE n.id = $id RETURN m.id as nid"
        results = self.client.execute_read(query, {"id": int(node_id)})
        return [r["nid"] for r in results]

    def get_neighbors_batch(self, node_ids: List[int], direction: str, edge_types: Optional[List[str]]) -> Dict[
        int, List[int]]:
        if not node_ids: return {}
        arrow = self._build_arrow(direction, edge_types)

        query = f"""
        MATCH (n){arrow}(m)
        WHERE n.id IN $ids
        RETURN n.id as src, m.id as dst
        """
        ids = list(set(map(int, node_ids)))
        records = self.client.execute_read(query, {"ids": ids})

        result = defaultdict(list)
        for r in records:
            result[r['src']].append(r['dst'])
        return dict(result)

    def get_neighbor_nodes_batch(self,
                                 node_ids: List[int],
                                 direction: str,
                                 edge_types: Optional[List[str]],
                                 target_labels: Optional[List[str]] = None) -> Dict[int, List[CPGNode]]:
        """
        [Implementation] Neo4j 高性能批量邻居获取。
        利用 Cypher Pattern Matching 和 Label Filtering 实现服务端过滤。
        """
        if not node_ids:
            return {}

        # 1. 准备查询模板
        # 构造箭头方向和边类型
        # e.g., -[:AST|CALL]->
        arrow = self._build_arrow(direction, edge_types)

        # 构造目标节点 Label 过滤
        # e.g., WHERE (m:`METHOD_PARAMETER_IN` OR m:`METHOD_RETURN`)
        label_clause = ""
        if target_labels:
            # 安全转义 Label，防止注入或特殊字符报错
            safe_labels = [f"`{lbl}`" for lbl in target_labels if lbl]
            if safe_labels:
                # Cypher 语法: (m:L1 OR m:L2)
                predicates = [f"m:{lbl}" for lbl in safe_labels]
                label_clause = f"AND ({' OR '.join(predicates)})"

        # 构造 Cypher 查询
        # n 是源节点 (由 ID 锁定)，m 是目标节点
        query = f"""
        MATCH (n){arrow}(m)
        WHERE n.id IN $batch_ids
        {label_clause}
        RETURN n.id as src_id, m as target_node
        """

        # 2. 执行分批查询
        result = defaultdict(list)
        unique_ids = list(set(node_ids))
        total_count = len(unique_ids)

        for i in range(0, total_count, self.NEO4J_BATCH_SIZE):
            batch = unique_ids[i: i + self.NEO4J_BATCH_SIZE]

            try:
                records = self.client.execute_read(query, {"batch_ids": batch})

                for r in records:
                    src_id = r["src_id"]
                    neo4j_node = r["target_node"]

                    # 转换 Neo4j Node -> Pydantic CPGNode
                    pydantic_node = DataConverter.to_pydantic(neo4j_node)
                    if pydantic_node:
                        result[src_id].append(pydantic_node)

            except Exception as e:
                logger.error(f"Failed to fetch neighbor nodes batch (Offset {i}): {e}")
                # 策略：根据需求决定是抛出异常还是记录日志后继续。
                # 在 Analysis 场景下，通常希望 Fail Fast 以免数据不一致，这里选择抛出
                raise e

        return dict(result)

    def get_subgraph(self, node_ids: List[int]) -> CPGGraph:
        subgraph = CPGGraph()
        if not node_ids: return subgraph
        ids = list(set(map(int, node_ids)))

        # 1. Fetch Nodes
        node_recs = self.client.execute_read("MATCH (n) WHERE n.id IN $ids RETURN n", {"ids": ids})
        for r in node_recs:
            p_node = DataConverter.to_pydantic(r['n'])
            if p_node: subgraph.add_node(p_node)

        # 2. Fetch Internal Edges
        q_edges = """
        MATCH (a)-[r]->(b) WHERE a.id IN $ids AND b.id IN $ids
        RETURN a.id as src, b.id as dst, type(r) as type, properties(r) as props
        """
        edge_recs = self.client.execute_read(q_edges, {"ids": ids})
        for r in edge_recs:
            edge = DataConverter.to_cpg_edge(r)
            if edge: subgraph.add_edge(edge.src, edge.dst, edge.type, **edge.properties)

        return subgraph

    def get_context_subgraph(self, root_id: int) -> Optional[CPGGraph]:
        """
        [Optimization] 使用 Loader 的单次查询策略加载方法上下文。
        Override 了基类的默认行为。
        """
        # 委托给 SubgraphLoader.load_function_ast
        # 这里的逻辑是针对 Neo4j 特优化的 (单次 RTT)
        graph = self._loader.load_function_ast(root_id)

        # 如果图为空（未找到或无内容），返回 None 以便上层处理
        if not graph or (not graph.nodes and not graph.edges):
            return None

        return graph

    def list_tags(self, prefix: str = None) -> List[str]:
        from codedmap.infra.storage.driver_neo4j import cypher as Q
        if prefix is None:
            records = self.client.execute_read(Q.LIST_ALL_TAGS, {})
        else:
            records = self.client.execute_read(
                Q.LIST_TAGS_WITH_PREFIX, {"prefix": prefix.upper()}
            )
        return [rec["tag"] for rec in records]

    def count_edges(self, edge_type: Optional[str] = None) -> int:
        """
        Count edges in the database.
        Uses Neo4j's count store optimization for O(1) performance.
        """
        if edge_type is None:
            query = "MATCH ()-[r]->() RETURN count(r) as cnt"
            records = self.client.execute_read(query, {})
        else:
            query = f"MATCH ()-[r:`{edge_type}`]->() RETURN count(r) as cnt"
            records = self.client.execute_read(query, {})
        return records[0]['cnt'] if records else 0

    def find_edge(self, src: int, dst: int, edge_type: str) -> Optional[Any]:
        """
        Find a specific edge by source, destination, and type.
        Uses indexed node lookup for performance.
        """
        query = f"""
        MATCH (a)-[r:`{edge_type}`]->(b)
        WHERE a.id = $src AND b.id = $dst
        RETURN a.id as src, b.id as dst, type(r) as type, properties(r) as props
        LIMIT 1
        """
        records = self.client.execute_read(query, {"src": src, "dst": dst})
        if not records:
            return None
        return DataConverter.to_cpg_edge(records[0])

    def _build_arrow(self, direction: str, edge_types: Optional[List[str]]) -> str:
        """Helper: 构造 Cypher 箭头"""
        rel_str = ""
        if edge_types:
            safe = [t for t in edge_types if t.isidentifier() or t.replace("_", "").isalnum()]
            if safe: rel_str = ":" + "|".join(safe)
        return f"-[{rel_str}]->" if direction == "OUT" else f"<-[{rel_str}]-"

    def export_to_file(self, path: str, format: str = "json"):
        """
        [Scalable] Neo4j 流式导出。
        使用游标 (Cursor) 分批拉取数据并写入文件，内存占用恒定。
        """
        if format != "json":
            raise NotImplementedError("Neo4j export currently only supports JSON")

        logger.info(f"Starting stream export from Neo4j to {path}...")

        query_nodes = "MATCH (n) RETURN n"
        query_edges = "MATCH ()-[r]->() RETURN startNode(r).id as src, endNode(r).id as dst, type(r) as type, properties(r) as props"

        with open(path, 'w', encoding='utf-8') as f:
            # 1. 写入 Header / Metadata
            f.write('{"nodes": [\n')

            # 2. 流式导出节点
            with self.client._driver.session(database=self.client._database) as session:
                # 使用显式事务以获取流式结果
                with session.begin_transaction() as tx:
                    result = tx.run(query_nodes)
                    first = True
                    for record in result:
                        if not first: f.write(',\n')
                        node_data = DataConverter.to_pydantic(record['n'])  # 或者直接转 dict
                        if node_data:
                            # 序列化为 JSON 行
                            f.write(node_data.model_dump_json(exclude_none=True))
                        first = False

            f.write('\n], "edges": [\n')

            # 3. 流式导出边
            with self.client._driver.session(database=self.client._database) as session:
                with session.begin_transaction() as tx:
                    result = tx.run(query_edges)
                    first = True
                    for record in result:
                        if not first: f.write(',\n')
                        # [Phase 19] Strip reserved semantic identity keys from export
                        raw_props = record["props"] or {}
                        clean_props = {
                            k: v for k, v in raw_props.items()
                            if not k.startswith("__semantic_")
                        }
                        edge_dict = {
                            "src": record["src"],
                            "dst": record["dst"],
                            "type": record["type"],
                            "properties": clean_props
                        }
                        f.write(json.dumps(edge_dict))
                        first = False

            f.write('\n]}')

        logger.info("Export complete.")    