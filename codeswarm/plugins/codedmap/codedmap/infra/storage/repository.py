# -*- coding: utf-8 -*-
# codedmap/infra/storage/repository.py

from datetime import datetime, timezone
from typing import Any, List, Optional, Type, TypeVar, Generic, Union, Iterator, Dict
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.base import AstNode
from codedmap.core.schema.graph.nodes import CPGNode, InsightNode, MethodNode, FileNode, VectorNode, ModuleNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

from codedmap.infra.storage.interfaces import TraversalInterface, TraversalSourceProtocol, GraphWriter
from codedmap.utils.id_generator import generate_id

T = TypeVar("T", bound=CPGNode)

class GenericRepository(Generic[T]):
    """
    [Unified] 通用仓储基类。
    不再依赖具体的 Backend，而是依赖抽象的 TraversalSource。
    """
    def __init__(self, source: TraversalSourceProtocol, model_class: Type[T], label: NodeLabel):
        self.source = source
        self.model_class = model_class
        self.label = label

    def get_by_id(self, node_id: int) -> Optional[T]:
        """通过 ID 精确查找"""
        # source.by_id 返回的是 Traversal[CPGNode]，需要 cast
        results = self.source.by_id(node_id).to_list()
        if not results:
            return None
        
        node = results[0]
        # 类型安全检查
        if isinstance(node, self.model_class):
            return node
        return None

    def find_all(self, limit: int = 100) -> List[T]:
        """查找指定 Label 的所有节点"""
        # source.all_nodes 返回 Traversal
        return self.source.all_nodes(self.label).limit(limit).to_list() # type: ignore

    def count(self) -> int:
        return self.source.all_nodes(self.label).count()

    def iter_all(self, batch_size: int = 1000) -> Iterator[List[T]]:
        """
        [High Performance] 批量迭代所有节点。
        """
        return self.source.all_nodes(self.label).iter_batch(batch_size)  # type: ignore

class ModuleRepository(GenericRepository[ModuleNode]):
    def __init__(self, source: TraversalSourceProtocol):
        super().__init__(source, ModuleNode, NodeLabel.MODULE)

    def find_by_name(self, name: str, exact_match: bool = True) -> List[ModuleNode]:
        if exact_match:
            return self.source.modules(name).to_list()
        else:
            return self.source.modules().where_contains("name", name).to_list()

    def find_by_full_name(self, full_name: str) -> List[ModuleNode]:
        return self.source.modules().filter(fullName=full_name).to_list()


class MethodRepository(GenericRepository[MethodNode]):
    """
    [Unified] 方法仓储。
    无论是 Memory 还是 Neo4j，查询逻辑都是一样的 DSL。
    """
    def __init__(self, source: TraversalSourceProtocol):
        super().__init__(source, MethodNode, NodeLabel.METHOD)

    def find_by_name(self, name: str, exact_match: bool = True) -> List[MethodNode]:
        if exact_match:
            # 精确匹配 (利用底层索引优化)
            return self.source.methods(name).to_list()
        else:
            # [Refactor] 模糊匹配现在下推到 DSL 层
            # Memory: 延迟过滤
            # Neo4j: WHERE n.name CONTAINS 'foo' (数据库层过滤)
            return self.source.methods().where_contains("name", name).to_list()

    def find_by_full_name(self, full_name: str) -> List[MethodNode]:
        # 使用 filter 算子: .filter(fullName=...)
        return self.source.methods().filter(fullName=full_name).to_list()

    def find_by_file(self, filename: str) -> List[MethodNode]:
        """
        查找定义在特定文件中的方法。
        Path: File(name) -[CONTAINS]-> Method
        """
        # 这里的 source.files(filename) 返回 File 的 Traversal
        # .out("CONTAINS", MethodNode) 跳转到 Method
        return self.source.files(filename).out("CONTAINS", MethodNode).to_list()

    def iter_by_name_pattern(self, name_pattern: str, batch_size: int = 1000) -> Iterator[List[MethodNode]]:
        """
        支持过滤条件的批量迭代
        Usage: store.methods.iter_by_name_pattern("sys_*")
        """
        return (self.source.methods()
                .where_contains("name", name_pattern)
                .iter_batch(batch_size))  # type: ignore

class FileRepository(GenericRepository[FileNode]):
    def __init__(self, source: TraversalSourceProtocol):
        super().__init__(source, FileNode, NodeLabel.FILE)
        
    def find_by_name(self, name: str) -> List[FileNode]:
        return self.source.files(name).to_list()


class AstRepository(GenericRepository[AstNode]):
    """
    [Core] AST 节点专用仓储。
    负责处理细粒度的代码结构查询，如行列定位、层级包含关系等。
    """
    def __init__(self, source: TraversalSourceProtocol):
        # AstNode 是 MethodNode, BlockNode, CallNode 等的基类
        super().__init__(source, AstNode, NodeLabel.UNKNOWN) 

    def find_by_location(self, file_path: str, line: int, column: Optional[int] = None) -> List[AstNode]:
        """
        [Precision Search] 查找指定文件和行号的所有 AST 节点。
        """
        # [Fix] 使用 .filter() 替代不存在的 .where()
        # filter 接受 **kwargs，语义为精确匹配 (Equality Check)
        query = (self.source.files(file_path)
                 .ast() 
                 .filter(lineNumber=line))
        
        if column is not None:
            query = query.filter(columnNumber=column)
            
        # 返回列表
        results: List[AstNode] = query.to_list()
        
        # 排序逻辑保持不变
        results.sort(key=lambda x: (x.column_number if x.column_number is not None else -1, 
                                    x.order if x.order is not None else -1))
        
        return results

    def get_enclosing_method(self, node_id: int) -> Optional[MethodNode]:
        """
        [Context Awareness] 查找给定节点所属的方法。
        """
        methods = self.source.by_id(node_id).method().to_list()
        if methods:
            return methods[0]
        return None

    def get_enclosing_file(self, node_id: int) -> Optional[FileNode]:
        """
        [Context Awareness] 查找给定节点所属的文件。
        """
        files = self.source.by_id(node_id).file().to_list()
        return files[0] if files else None

    def get_children(self, node_id: int) -> List[AstNode]:
        """
        获取直接 AST 子节点。
        """
        return self.source.by_id(node_id).ast_children().to_list()

    def find_in_file(self, filename: str, label_filter: Optional[str] = None) -> List[AstNode]:
        """
        获取文件内的所有 AST 节点 (可选 Label 过滤)。
        """
        q = self.source.files(filename).ast()
        if label_filter:
            q = q.has_label(label_filter)
        return q.to_list()


class TagRepository:
    """
    [Tagging Service] 标签管理仓储。
    完全利用 Writer 的多态能力，屏蔽了 Backend 差异。
    """
    def __init__(self, writer: GraphWriter, source: TraversalSourceProtocol, reader):
        self.writer = writer
        self.source = source
        self.reader = reader

    def add(self, node_or_id: Union[CPGNode, int], tag: str):
        """原子添加标签"""
        # 1. 提取 ID
        node_id = getattr(node_or_id, 'id', node_or_id)
        if node_id is None:
            raise ValueError("Cannot tag a node without an ID")
            
        tag = tag.upper()

        # 2. 持久化写入 (DB)
        # 依赖 Writer 的 property_list_append 实现原子操作 (CASE WHEN...)
        self.writer.property_list_append(
            node_id=node_id, 
            key="tags", 
            value=tag, 
            unique=True
        )

        # 3. 内存同步 (Cache Coherence)
        if isinstance(node_or_id, CPGNode):
            self._sync_obj(node_or_id, tag, "add")

    def add_batch(self, tag_map: Dict[int, List[str]]):
        """
        [Batch Write] 批量为多个节点添加标签。
        Args:
            tag_map: {node_id: ["TAG_A", "TAG_B"], node_id_2: ["TAG_C"]}
        """
        if not tag_map:
            return

        # 转换为列表结构供 UNWIND 使用
        # data = [{id: 1, tags: ["A", "B"]}, {id: 2, tags: ["C"]}]
        batch_data = [{"id": k, "tags": v} for k, v in tag_map.items()]

        # 动态构建 Cypher
        # 逻辑：找到节点 -> 遍历标签 -> 添加 (去重)
        # 注意：这里假设 writer 暴露了 execute_write 或者我们直接调用底层的 batch update
        # 既然 TagRepo 持有 writer，我们可以在 Writer 接口增加 add_tags_batch

        # 委托给 Writer 实现 (保持架构分层)
        self.writer.add_tags_batch(batch_data)

    def remove(self, node_or_id: Union[CPGNode, int], tag: str):
        """原子移除标签"""
        node_id = getattr(node_or_id, 'id', node_or_id)
        if node_id is None:
            return 
            
        tag = tag.upper()

        self.writer.property_list_remove(
            node_id=node_id,
            key="tags",
            value=tag
        )

        if isinstance(node_or_id, CPGNode):
            self._sync_obj(node_or_id, tag, "remove")

    def get_all(self, node_or_id: Union[CPGNode, int]) -> List[str]:
        """获取指定节点的所有标签"""
        # 1. 内存快读
        if isinstance(node_or_id, CPGNode):
            # 这里的 getattr 是防御性的，如果 Schema 修改生效，可以直接访问 node_or_id.tags
            return list(getattr(node_or_id, "tags", []) or [])

        # 2. DB 读取
        try:
            # 使用 by_id 获取节点，然后读取其 tags 属性
            # 注意：这依赖于 reader/converter 能正确将 DB 里的 tags 数组填充到 CPGNode 中
            nodes = self.source.by_id(node_or_id).to_list()
            if nodes:
                return list(getattr(nodes[0], "tags", []) or [])
        except Exception:
            pass
            
        return []

    def find_nodes(self, tag: str) -> List[CPGNode]:
        """查找包含指定标签的节点"""
        return self.source.all_nodes().has_tag(tag.upper()).to_list()

    def list_all(self, prefix: str = None) -> List[str]:
        """
        List all unique tags in the database.

        Args:
            prefix: Optional prefix filter (e.g., 'security:entry_point').

        Returns:
            List of unique tag strings.
        """
        return self.reader.list_tags(prefix=prefix)

    def _sync_obj(self, node: CPGNode, tag: str, action: str):
        """
        [Helper] 内存对象同步。
        """
        # 1. 确保 tags 列表存在
        if not hasattr(node, "tags") or node.tags is None:
            node.tags = []
            
        # 2. 确保类型安全 (防止 None 或 Tuple)
        if not isinstance(node.tags, list):
            node.tags = list(node.tags)
            
        # 3. 执行动作
        if action == "add":
            if tag not in node.tags:
                node.tags.append(tag)
        elif action == "remove":
            if tag in node.tags:
                node.tags.remove(tag)


class InsightRepository(GenericRepository[InsightNode]):
    """
    [Unified] 洞察节点仓储 (Full Lifecycle Management).
    
    职责:
    1. Query: 提供按类别、宿主查找 Insight 的能力。
    2. Command: 封装 Insight 的创建与挂载逻辑 (Node + Edge 的原子写入)。
    3. Maintenance: 提供 Insight 的清理与更新能力。
    """
    
    @staticmethod
    def _matches_layer_filters(
        insight: InsightNode,
        scope: Optional[str] = None,
        campaign_id: Optional[str] = None,
        knowledge_class: Optional[str] = None,
    ) -> bool:
        if scope is not None and getattr(insight, "scope", None) != scope:
            return False
        if campaign_id is not None and getattr(insight, "campaign_id", None) != campaign_id:
            return False
        if knowledge_class is not None and getattr(insight, "knowledge_class", None) != knowledge_class:
            return False
        return True

    def __init__(self, writer: GraphWriter, source: TraversalSourceProtocol):
        # 注入 writer 以支持写操作
        self.writer = writer
        super().__init__(source, InsightNode, NodeLabel.INSIGHT)

    # ==========================================
    #  Read Interfaces (Query Side)
    # ==========================================

    def find_by_category(self, category: str, limit: int = 100) -> List[InsightNode]:
        """按类别查找 (e.g., 'VULNERABILITY')"""
        return (self.source.all_nodes(self.label)
                .filter(category=category)
                .limit(limit)
                .to_list()) # type: ignore

    def find_all_insights(
        self,
        category: Optional[str] = None,
        limit: int = 500,
        scope: Optional[str] = None,
        campaign_id: Optional[str] = None,
        knowledge_class: Optional[str] = None,
    ) -> List[InsightNode]:
        """List all insights across the graph, optionally filtered by category."""
        query = self.source.all_nodes(self.label)
        if category:
            query = query.filter(category=category)
        insights = query.limit(limit).to_list()  # type: ignore
        return [
            insight
            for insight in insights
            if self._matches_layer_filters(
                insight,
                scope=scope,
                campaign_id=campaign_id,
                knowledge_class=knowledge_class,
            )
        ]

    def get_attached_insights(
        self,
        node_id: int,
        category: Optional[str] = None,
        scope: Optional[str] = None,
        campaign_id: Optional[str] = None,
        knowledge_class: Optional[str] = None,
    ) -> List[InsightNode]:
        """
        获取挂载在指定节点上的所有 Insight。
        Path: HostNode(id) --[HAS_INSIGHT]--> InsightNode
        """
        # 利用 DSL 的 .insights() 扩展
        query = self.source.by_id(node_id).insights()
        if category:
            query = query.filter(category=category)
        insights = query.to_list() # type: ignore
        return [
            insight
            for insight in insights
            if self._matches_layer_filters(
                insight,
                scope=scope,
                campaign_id=campaign_id,
                knowledge_class=knowledge_class,
            )
        ]

    # ==========================================
    #  Write Interfaces (Command Side)
    # ==========================================

    def create_and_attach(self,
                          host_nodes: Optional[Union[int, List[int]]] = None,
                          category: str = None,
                          content: str = None,
                          source: str = None,
                          title: str = None,
                          confidence: Optional[float] = None,
                          embedding: Optional[List[float]] = None,
                          scope: str = "campaign",
                          knowledge_class: str = "assessment",
                          campaign_id: Optional[str] = None,
                          review_state: str = "unreviewed",
                          visibility: str = "default",
                          evidence_bundle: Optional[Dict[str, Any]] = None,
                          promoted_from: Optional[str] = None) -> InsightNode:
        """
        [Atomic Write] 创建一个 InsightNode 并挂载到 0..N 目标节点。

        If host_nodes is None or []: auto-mount to MetaDataNode (global/free-floating note).
        Atomic validation: ALL node IDs must exist before any edge is created.
        """
        builder = CPGBuilder()

        # 1. Normalize host_nodes
        if host_nodes is None or host_nodes == []:
            # Free-floating: mount to MetaDataNode
            meta_results = self.source.all_nodes(NodeLabel.META_DATA).first()
            if meta_results is None:
                raise ValueError(
                    "No MetaDataNode found — cannot create global note. Build the graph first."
                )
            resolved_hosts = [meta_results]
            ids_str = "meta"
        else:
            if isinstance(host_nodes, int):
                host_nodes = [host_nodes]
            # Atomic validation: resolve ALL IDs first
            resolved_hosts = []
            for nid in host_nodes:
                found = self.source.by_id(nid).to_list()
                if not found:
                    raise ValueError(
                        f"Node ID {nid} not found. No note created (atomic validation)."
                    )
                resolved_hosts.append(found[0])
            sorted_ids = sorted(h.id for h in resolved_hosts)
            ids_str = "_".join(str(i) for i in sorted_ids)

        # 2. Normalize category string
        category_lower = str(category).lower()

        # 3. Build InsightNode
        name = f"insight_{category_lower}_{ids_str}_{source}"
        insight_id = generate_id()
        insight = InsightNode(
            id=insight_id,
            name=name,
            label=NodeLabel.INSIGHT,
            category=category,
            title=title,
            content=content,
            source=source,
            confidence=confidence,
            scope=scope,
            knowledge_class=knowledge_class,
            campaign_id=campaign_id,
            review_state=review_state,
            visibility=visibility,
            evidence_bundle=evidence_bundle or {},
            promoted_from=promoted_from,
            created_at=datetime.now(timezone.utc).isoformat()
        )

        # 4. Add node + one HAS_INSIGHT edge per resolved host
        builder.graph.add_node(insight)
        for host in resolved_hosts:
            builder.graph.add_edge(host, insight, EdgeType.HAS_INSIGHT)

        # 5. Optional vector node
        if embedding:
            vec_id = generate_id()
            vec_node = VectorNode(
                id=vec_id,
                name=f"vec_{insight_id}",
                embedding=embedding,
                label=NodeLabel.VECTOR
            )
            builder.graph.add_node(vec_node)
            builder.graph.add_edge(insight, vec_node, EdgeType.HAS_VECTOR)

        # 6. Persist
        self.writer.save_graph(builder.get_graph())

        return insight

    def delete_insight_by_id(self, insight_id: int) -> bool:
        """
        Delete an InsightNode and all its HAS_INSIGHT edges by ID.

        Returns True if deleted, False if not found.
        """
        found = self.source.by_id(insight_id).to_list()
        if not found:
            return False
        node = found[0]
        if getattr(node, "label", None) != NodeLabel.INSIGHT:
            return False
        self.writer.delete_nodes([insight_id])
        return True

    def unbind_nodes(self, insight_id: int, node_ids: List[int]) -> bool:
        """
        Remove HAS_INSIGHT edges from the given node_ids to insight_id.

        If no hosts remain after unbinding (and the insight is not mounted on
        MetaDataNode), the orphan InsightNode is deleted automatically.

        Returns True if the operation succeeded.
        """
        from codedmap.core.schema.graph.patch import GraphPatch

        patch = GraphPatch(created_by="InsightRepository.unbind_nodes")
        for nid in node_ids:
            patch.remove_edge(nid, insight_id, EdgeType.HAS_INSIGHT)
        self.writer.apply_patch(patch)

        # Check remaining hosts
        remaining = self.source.by_id(insight_id).in_("HAS_INSIGHT").to_list()
        if not remaining:
            self.writer.delete_nodes([insight_id])
        else:
            # If only MetaDataNode hosts remain, keep the note (it's a global note)
            pass

        return True

    def delete_by_category(self, host_node_id: int, category: str):
        """
        [Cleanup] 删除指定节点下特定类别的所有 Insight。
        通常用于 Pass 重跑前的清理 (Idempotency)。
        """
        # 1. 查找目标 Insight IDs
        insights = self.get_attached_insights(host_node_id, category)
        if not insights:
            return

        ids_to_delete = [n.id for n in insights if n.id is not None]
        
        # 2. 批量删除节点 (边会自动级联删除，取决于 DB 实现，但通常显式删除更安全)
        # 这里假设 delete_nodes 会处理关联边的清理 (Neo4j DETACH DELETE)
        if ids_to_delete:
            self.writer.delete_nodes(ids_to_delete)

    def delete_by_source(self, source_value: str):
        """
        [Global Cleanup] 删除由特定 Pass 生成的所有 Insight。
        例如: 清理所有 'SmartSummaryPass' 生成的数据。
        """
        # 这需要 Traversal 支持按属性过滤
        insights = self.source.all_nodes(self.label).filter(source=source_value).to_list()
        ids = [n.id for n in insights if n.id is not None]

        if ids:
            # 分批删除，防止大事务
            batch_size = 1000
            for i in range(0, len(ids), batch_size):
                self.writer.delete_nodes(ids[i : i + batch_size])

    def update(self, insight_id: int, **kwargs) -> Optional[InsightNode]:
        """
        Update an existing InsightNode's properties.
        Automatically sets updated_at timestamp.

        Args:
            insight_id: The ID of the InsightNode to update.
            **kwargs: Properties to update (e.g., content="new", status="archived").

        Returns:
            Refreshed InsightNode, or None if not found.
        """
        kwargs["updated_at"] = datetime.now(timezone.utc).isoformat()
        update_payload = {"id": insight_id, **kwargs}
        self.writer.update_nodes_properties(
            label="INSIGHT",
            updates=[update_payload],
            match_key="id",
        )
        # Refresh from storage
        return self.get_by_id(insight_id)

    def upsert(
        self,
        host_ids: Optional[Union[int, List[int]]] = None,
        category: str = None,
        source: str = None,
        content: str = None,
        title: str = None,
        confidence: Optional[float] = None,
        status: str = "active",
        scope: str = "campaign",
        knowledge_class: str = "assessment",
        campaign_id: Optional[str] = None,
        review_state: str = "unreviewed",
        visibility: str = "default",
        evidence_bundle: Optional[Dict[str, Any]] = None,
        promoted_from: Optional[str] = None,
    ) -> InsightNode:
        """
        Create-or-update an InsightNode for a set of host nodes.

        Dedup key: (tuple(sorted(host_ids)), category, title, source).
        If a matching insight is found, updates content/status/confidence.
        If not found, creates a new InsightNode via create_and_attach.

        Returns:
            The created or updated InsightNode.
        """
        # Normalize host_ids: dedupe + sort for order-insensitive identity matching
        if host_ids is None:
            normalized_ids: List[int] = []
        elif isinstance(host_ids, int):
            normalized_ids = [host_ids]
        else:
            normalized_ids = sorted(set(host_ids))

        # Normalize category string for comparison
        category_str = str(category).strip().upper()

        # Find existing insight matching (host_ids, category, title, source)
        candidates = (
            self.source.all_nodes(NodeLabel.INSIGHT)
            .filter(source=source)
            .to_list()
        )
        for insight in candidates:
            if getattr(insight, "title", "") != title:
                continue
            insight_cat = getattr(insight, "category", "")
            if str(insight_cat).upper() != category_str:
                continue
            # Resolve host IDs of this insight — normalize with set semantics too
            hosts = self.source.by_id(insight.id).in_("HAS_INSIGHT").to_list()
            host_ids_of_existing = sorted(set(h.id for h in hosts))
            if tuple(host_ids_of_existing) == tuple(normalized_ids):
                # Match found — full replacement (PUT-like) including confidence
                update_kwargs: Dict = {
                    "title": title,
                    "content": content,
                    "status": status,
                    "confidence": confidence,
                    "scope": scope,
                    "knowledge_class": knowledge_class,
                    "campaign_id": campaign_id,
                    "review_state": review_state,
                    "visibility": visibility,
                    "evidence_bundle": evidence_bundle or {},
                    "promoted_from": promoted_from,
                }
                return self.update(insight.id, **update_kwargs)

        # No match — create new (pass normalized_ids, not raw host_ids)
        return self.create_and_attach(
            host_nodes=normalized_ids,
            category=category,
            content=content,
            source=source,
            title=title,
            confidence=confidence,
            scope=scope,
            knowledge_class=knowledge_class,
            campaign_id=campaign_id,
            review_state=review_state,
            visibility=visibility,
            evidence_bundle=evidence_bundle,
            promoted_from=promoted_from,
        )


# [New] 新增向量专用仓储
class VectorRepository(GenericRepository[VectorNode]):
    """
    [Cold Storage Access] 向量节点仓储。
    负责处理 VectorNode 的查找与挂载。
    """
    def __init__(self, writer: GraphWriter, source: TraversalSourceProtocol):
        # 注入 writer 用于写操作
        self.writer = writer
        super().__init__(source, VectorNode, NodeLabel.VECTOR)

    def get_vector_by_host(self, host_id: int) -> Optional[VectorNode]:
        """
        查找宿主节点关联的向量节点。
        Path: Host(id) -[HAS_VECTOR]-> VectorNode
        """
        # 假设 DSL 支持 .out(EdgeType.HAS_VECTOR, VectorNode)
        results = self.source.by_id(host_id).out(EdgeType.HAS_VECTOR, VectorNode).to_list()
        return results[0] if results else None

    def attach_vector(self, host_id: int, embedding: List[float], model: str = "v1"):
        """
        [Atomic] 为指定节点创建并挂载向量。
        主要用于后续的补全操作。
        """
        builder = CPGBuilder()
        
        vec_id = generate_id()
        vec_node = VectorNode(
            id=vec_id,
            name=f"vec_{host_id}",
            embedding=embedding,
            model_version=model,
            label=NodeLabel.VECTOR
        )
        
        builder.graph.add_node(vec_node)
        # 添加边: Host(id) -> Vector
        # 注意：这里 host 是一个仅包含 ID 的 proxy，Builder 会处理 ID 引用
        host_proxy = CPGNode(id=host_id, label=NodeLabel.UNKNOWN) 
        builder.graph.add_edge(host_proxy, vec_node, EdgeType.HAS_VECTOR)
        
        self.writer.save_graph(builder.get_graph())                
