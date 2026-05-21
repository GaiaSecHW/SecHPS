# codedmap/infra/storage/driver_memory/writer.py

from typing import List, Dict, Any, Set, Union
from codedmap.core.schema.graph.enums import EdgeDirection, EdgeType
from codedmap.core.schema.graph.patch import ListOpType, NodeListUpdate, PruneRequest
from codedmap.infra.storage.base.writer import BaseGraphWriter
from codedmap.infra.storage.base.edge_identity import compute_semantic_edge_hash
from codedmap.infra.storage.driver_memory.store import MemoryDatabase
from codedmap.infra.storage.driver_memory.connection import MemoryTransaction

class MemoryWriter(BaseGraphWriter):
    def __init__(self, db: MemoryDatabase):
        self.db = db

    def save_graph(self, graph: Any):
        self.db.merge_graph(graph)

    # =========================================================================
    # Implement GraphWriter Public Interface
    # =========================================================================

    def delete_nodes(self, node_ids: List[int]):
        """批量删除节点"""
        with self.db.lock:
            self._remove_nodes_atomic(None, set(node_ids))

    def delete_neighbor_nodes(self, source_node_ids: List[int], edge_type: str, direction: EdgeDirection = EdgeDirection.OUT):
        """
        [Atomic] 批量查找指定节点的邻居，并将其删除。
        """
        with self.db.lock:
            graph = self.db.graph
            target_ids_to_delete = set()

            for src_id in source_node_ids:
                if src_id not in graph.nodes:
                    continue

                if direction == EdgeDirection.OUT:
                    edges = graph.get_out_edges(src_id)
                elif direction == EdgeDirection.IN:
                    edges = graph.get_in_edges(src_id)
                else:
                    continue

                for edge in edges:
                    curr_type = edge.type.value if hasattr(edge.type, 'value') else str(edge.type)
                    
                    if curr_type == edge_type:
                        target_id = edge.dst if direction == EdgeDirection.OUT else edge.src
                        target_ids_to_delete.add(target_id)

            if target_ids_to_delete:
                self._remove_nodes_atomic(None, target_ids_to_delete)

    def update_nodes_properties(self, label: str, updates: List[Dict[str, Any]], match_key: str = "id"):
        """[Memory Optimized] 批量更新"""
        with self.db.lock:
            graph = self.db.graph
            
            for row in updates:
                node_id = row.get(match_key)
                if node_id is None: continue
                
                # 仅支持 ID 快速查找
                if match_key == "id":
                    node = graph.get_node_by_id(int(node_id))
                else:
                    # Memory Scan: 如果不是 ID，则需要遍历所有节点查找，性能较差
                    # 简化处理：暂时只支持 ID 更新，或者后续增加索引支持
                    continue

                if not node: continue

                # Label Check
                if label != "ANY":
                    n_label = getattr(node, "label", None)
                    n_label_str = n_label.value if hasattr(n_label, 'value') else str(n_label)
                    if n_label_str != label:
                        continue

                # Apply
                self._apply_properties_to_node(node, row, exclude_key=match_key)

    def add_edges_batch(self, edges: List[Dict[str, Any]]):
        """
        [Implementation] Direct insert into memory graph.
        Args: edges=[{'src': 1, 'dst': 2, 'type': 'CALL', 'properties': {...}}]

        Note: Uses semantic identity for deduplication. DDG edges with different
        'variable' values and CFG edges with different 'label' values are NOT duplicates.
        """
        if not edges: return

        with self.db.lock:
            graph = self.db.graph
            for e in edges:
                src = e.get('src')
                dst = e.get('dst')
                etype = e.get('type')

                if src is None or dst is None or not etype:
                    continue

                props = e.get('properties', {})

                # Use semantic identity hash for deduplication
                # This ensures DDG edges with different variables and CFG edges with different labels
                # are treated as distinct edges
                edge_hash = compute_semantic_edge_hash(src, dst, etype, props)

                # Check if edge already exists using semantic hash
                if edge_hash in graph._edge_dedup_set:
                    continue  # Semantic duplicate, skip

                # add_edge handles node creation if they don't exist (stub nodes)
                # Use check_duplicates=False since we already checked
                graph.add_edge(src, dst, etype, check_duplicates=False, **props)

    def add_tags_batch(self, tags: List[Dict[str, Any]]):
        """
        [Implementation] Bulk append tags.
        Args: [{'id': 1, 'tags': ['A', 'B']}]
        """
        if not tags: return

        with self.db.lock:
            graph = self.db.graph
            for row in tags:
                node_id = row.get('id')
                new_tags = row.get('tags', [])
                if node_id is None or not new_tags: continue

                node = graph.get_node_by_id(int(node_id))
                if not node: continue

                # 获取旧标签 (处理 None 或 list)
                current_tags = getattr(node, "tags", []) or []
                if not isinstance(current_tags, list):
                    current_tags = list(current_tags)

                # 集合去重合并
                merged_tags = list(set(current_tags) | set(new_tags))

                # 写回
                if hasattr(node, "tags"):
                    node.tags = merged_tags
                else:
                    self._set_node_attr(node, "tags", merged_tags)

    # --- List Property Atomic Operations ---

    def property_list_append(self, node_id: int, key: str, value: Any, unique: bool = True):
        with self.db.lock:
            graph = self.db.graph
            node = graph.get_node_by_id(node_id)
            if not node: return

            current_list = self._get_node_attr(node, key)
            if current_list is None: current_list = []
            elif not isinstance(current_list, list): current_list = list(current_list)
            
            if unique and value in current_list: return

            new_list = current_list + [value]
            self._set_node_attr(node, key, new_list)

    def property_list_remove(self, node_id: int, key: str, value: Any):
        with self.db.lock:
            graph = self.db.graph
            node = graph.get_node_by_id(node_id)
            if not node: return

            current_list = self._get_node_attr(node, key)
            if not current_list or not isinstance(current_list, list): return

            if value in current_list:
                new_list = [x for x in current_list if x != value]
                self._set_node_attr(node, key, new_list)

    # =========================================================================
    # Helpers
    # =========================================================================

    def _get_node_attr(self, node: Any, key: str) -> Any:
        if hasattr(node, key): return getattr(node, key)
        if hasattr(type(node), "model_fields"):
            for fname, finfo in type(node).model_fields.items():
                if finfo.alias == key: return getattr(node, fname)
        if hasattr(node, "properties") and node.properties:
            return node.properties.get(key)
        return None

    def _set_node_attr(self, node: Any, key: str, value: Any):
        if hasattr(node, key):
            setattr(node, key, value)
            return
        if hasattr(type(node), "model_fields"):
            for fname, finfo in type(node).model_fields.items():
                if finfo.alias == key:
                    setattr(node, fname, value)
                    return
        if not hasattr(node, "properties") or node.properties is None:
            try: node.properties = {}
            except AttributeError: return
        node.properties[key] = value

    def _apply_properties_to_node(self, node: Any, properties: Dict[str, Any], exclude_key: str):
        for k, v in properties.items():
            if k == exclude_key: continue
            self._set_node_attr(node, k, v)

    # =========================================================================
    # Abstract Atomic Operations Implementation
    # =========================================================================

    def _transaction_context(self):
        return MemoryTransaction(self.db.lock)

    # [New] 实现盲删逻辑
    def _prune_neighbors_atomic(self, tx: Any, prunes: List[PruneRequest]):
        """
        [Memory Optimized] 批量执行盲删。
        遍历每个请求，查找并删除邻居。
        """
        graph = self.db.graph
        nodes_to_delete = set()

        for req in prunes:
            src_id = req.src_id
            if src_id not in graph.nodes: continue
            
            # 兼容类型比较
            target_type_str = req.edge_type.value if hasattr(req.edge_type, 'value') else str(req.edge_type)

            # 获取所有出边
            out_edges = graph.get_out_edges(src_id)
            for edge in out_edges:
                curr_type = edge.type.value if hasattr(edge.type, 'value') else str(edge.type)
                
                if curr_type == target_type_str:
                    nodes_to_delete.add(edge.dst)

        # 批量执行节点删除 (会自动清理边)
        if nodes_to_delete:
            self._remove_nodes_atomic(tx, nodes_to_delete)

    def _remove_edges_atomic(self, tx: Any, edges: list):
        # edges: List[EdgeRemovalRequest]
        graph = self.db.graph
        for req in edges:
            if req.src not in graph.nodes: continue
            
            out_edges = graph.get_out_edges(req.src)
            target_type = req.edge_type.value if hasattr(req.edge_type, 'value') else str(req.edge_type)
            
            to_remove = []
            for e in out_edges:
                curr_type = e.type.value if hasattr(e.type, 'value') else str(e.type)
                # 如果 dst 为 None，则删除所有该类型的边 (Wildcard Delete)
                # 如果 dst 有值，则精确匹配
                match_dst = (req.dst is None) or (e.dst == req.dst)
                
                if match_dst and curr_type == target_type:
                    to_remove.append(e)
            
            for e in to_remove:
                if e in graph.edges: graph.edges.remove(e)
                if e in graph._out_index[e.src]: graph._out_index[e.src].remove(e)
                if e in graph._in_index[e.dst]: graph._in_index[e.dst].remove(e)

    def _remove_nodes_atomic(self, tx: Any, node_ids: Set[int]):
        graph = self.db.graph
        for nid in node_ids:
            if nid in graph.nodes:
                # 级联删除关联边
                related = graph.get_out_edges(nid) + graph.get_in_edges(nid)
                for e in related:
                    if e in graph.edges: 
                        try: graph.edges.remove(e) 
                        except ValueError: pass
                    
                    if e.src in graph._out_index and e in graph._out_index[e.src]:
                        graph._out_index[e.src].remove(e)
                    if e.dst in graph._in_index and e in graph._in_index[e.dst]:
                        graph._in_index[e.dst].remove(e)
                
                del graph.nodes[nid]

    def _add_nodes_atomic(self, tx: Any, nodes: list, strategy: str):
        graph = self.db.graph
        for node in nodes:
            if node.id in graph.nodes:
                if strategy == "FAIL_ON_EXIST":
                    raise ValueError(f"Node {node.id} exists")
                elif strategy == "SKIP_ON_EXIST":
                    continue
                # OVERWRITE is default
            
            graph.add_node(node)
        
        self.db._rebuild_index()

    def _add_edges_atomic(self, tx: Any, edges: list, strategy: str):
        graph = self.db.graph
        for edge in edges:
            edge_type_val = edge.type.value if hasattr(edge.type, 'value') else str(edge.type)
            props = edge.properties if edge.properties else {}

            # Use semantic identity for deduplication
            edge_hash = compute_semantic_edge_hash(edge.src, edge.dst, edge_type_val, props)

            # Check if semantic duplicate exists
            if edge_hash in graph._edge_dedup_set:
                if strategy == "FAIL_ON_EXIST":
                    raise ValueError(f"Edge {edge.src}->{edge.dst} with semantic identity exists")
                continue  # SKIP / OVERWRITE logic: skip if semantically same

            graph.add_edge(edge.src, edge.dst, edge.type, **props)

    def _update_nodes_atomic(self, tx: Any, updates: list):
        # updates: List[NodePropertyUpdate]
        graph = self.db.graph
        for up in updates:
            node = graph.get_node_by_id(up.id)
            if node:
                self._apply_properties_to_node(node, up.properties, exclude_key="id")

    def _update_node_lists_atomic(self, tx: Any, updates: List[NodeListUpdate]):
        graph = self.db.graph
        for up in updates:
            node = graph.get_node_by_id(up.id)
            if not node: continue

            current_list = self._get_node_attr(node, up.key)
            if current_list is None: current_list = []
            elif not isinstance(current_list, list): current_list = list(current_list)
            
            if up.op == ListOpType.APPEND:
                if up.value not in current_list:
                    new_list = current_list + [up.value]
                    self._set_node_attr(node, up.key, new_list)
            
            elif up.op == ListOpType.REMOVE:
                if up.value in current_list:
                    new_list = [x for x in current_list if x != up.value]
                    self._set_node_attr(node, up.key, new_list)