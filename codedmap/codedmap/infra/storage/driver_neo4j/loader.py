# codedmap\storage\driver_neo4j\importer.py

from typing import List, Dict, Set, Any
import logging

from codedmap.core.schema.graph import CPGGraph, CPGNode, CPGEdge
from codedmap.core.schema.graph.enums import EdgeType
from .client import Neo4jClient
from .converter import DataConverter

logger = logging.getLogger(__name__)

class SubgraphLoader:
    """
    [Industrial Grade] Neo4j 子图加载器。
    
    设计目标：
    1. 高性能：单次 RTT 加载完整子图 (Intra-procedural)。
    2. 健壮性：自动处理节点重复、边重复。
    3. 灵活性：兼容标准 Cypher 查询结果与 APOC 批量返回结果。
    """

    def __init__(self, client: Neo4jClient):
        self.client = client

    def load_function_ast(self, method_id: int) -> CPGGraph:
        """
        加载指定方法的完整上下文 (节点 + 内部边)。
        
        策略：
        使用单次查询获取该 Method 下属的所有 AST 节点，以及这些节点之间的所有关系。
        """
        method_id = int(method_id)

        # -----------------------------------------------------------
        # 高效查询语句 (Single Query Strategy)
        # -----------------------------------------------------------
        # 逻辑说明：
        # 1. 找到方法根节点及其所有 AST 子孙 (Anchor Set)。
        # 2. 收集这些节点为列表 `nodes`。
        # 3. 查找这些节点内部的所有关系 (r)。
        # 4. 同时返回节点列表和关系列表。
        #
        # 相比两次查询，这能减少一半的网络开销，并保证事务一致性。
        query = f"""
        MATCH (root:METHOD)-[:{EdgeType.AST.value}*0..]->(child)
        WHERE root.id = $id
        WITH collect(distinct child) as nodes
        UNWIND nodes as n
        MATCH (n)-[r]->(m)
        WHERE m in nodes
        RETURN nodes, collect(distinct r) as rels
        """
        
        # 备注：如果安装了 APOC 插件，可以使用更高效的：
        # CALL apoc.path.subgraphAll(root, {relationshipFilter: "AST>", labelFilter: "+*"}) YIELD nodes, relationships

        try:
            records = self.client.execute_read(query, {"id": method_id})
        except Exception as e:
            logger.error(f"Failed to execute subgraph query for method {method_id}: {e}")
            return CPGGraph()

        return self._parse_records_to_graph(records, context_id=str(method_id))

    def _parse_records_to_graph(self, records: List[Any], context_id: str) -> CPGGraph:
        """
        [Core Logic] 通用解析器。
        将 Neo4j 返回的各种奇形怪状的数据结构（单行、列表、嵌套）统一为 CPGGraph。
        """
        graph = CPGGraph()
        
        # 使用 Set 辅助去重，防止重复添加相同的对象
        # (CPGGraph 内部通常是用 dict 存 nodes，所以节点天然去重；但 edges 是 list，需要手动去重)
        seen_edge_signatures: Set[str] = set()

        for record in records:
            # === 1. 解析节点 (Nodes) ===
            # 情况 A: 批量返回 (e.g., RETURN collect(n) as nodes)
            if 'nodes' in record and record['nodes']:
                for node_obj in record['nodes']:
                    self._add_node_safe(graph, node_obj)
            
            # 情况 B: 单行返回 (e.g., RETURN n)
            if 'n' in record:
                self._add_node_safe(graph, record['n'])
            
            # === 2. 解析边 (Relationships) ===
            # 情况 A: 批量返回 (e.g., RETURN collect(r) as rels, 或 rels_list)
            # 兼容 rels, rels_list, relationships 等常见命名
            rel_keys = ['rels', 'rels_list', 'relationships']
            found_rels = []
            for k in rel_keys:
                if k in record and record[k]:
                    found_rels.extend(record[k])
            
            # 情况 B: 单行返回 (e.g., RETURN r)
            if 'r' in record:
                found_rels.append(record['r'])

            # 统一处理所有找到的边
            for rel_obj in found_rels:
                # 有时 APOC 会返回嵌套列表，做个扁平化防御
                if isinstance(rel_obj, list):
                    for sub_r in rel_obj:
                        self._add_edge_safe(graph, sub_r, seen_edge_signatures)
                else:
                    self._add_edge_safe(graph, rel_obj, seen_edge_signatures)

        # 日志摘要
        if len(graph.nodes) > 0:
            logger.info(f"Loaded subgraph ({context_id}): {len(graph.nodes)} nodes, {len(graph.edges)} edges.")
        else:
            logger.debug(f"Subgraph ({context_id}) is empty.")

        return graph

    def _add_node_safe(self, graph: CPGGraph, node_obj: Any):
        """异常安全的节点添加"""
        try:
            p_node = DataConverter.to_pydantic(node_obj)
            if p_node and p_node.id is not None:
                graph.add_node(p_node)
        except Exception as e:
            logger.warning(f"Failed to convert node during load: {e}")

    def _add_edge_safe(self, graph: CPGGraph, rel_obj: Any, seen_set: Set[str]):
        """异常安全的边添加 + 去重"""
        try:
            cpg_edge = DataConverter.to_cpg_edge(rel_obj)
            if not cpg_edge:
                return

            # 生成唯一签名用于去重 (src-type-dst)
            # 加上属性哈希会更严谨，但通常 src-type-dst 足够判定物理边的唯一性
            sig = f"{cpg_edge.src}-{cpg_edge.type}-{cpg_edge.dst}"
            
            if sig not in seen_set:
                graph.edges.append(cpg_edge)
                seen_set.add(sig)
                
        except Exception as e:
            logger.warning(f"Failed to convert edge during load: {e}")