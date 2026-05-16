# -*- coding: utf-8 -*-
from typing import Dict, List, Optional, Union, Any
from collections import Counter
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.tags.layer import TagLayer
from .step import QueryStep

class CPG:
    """
    [DSL Entry Point] 安全查询 DSL 入口。

    Usage:
        cpg = CPG(store)
        # Find all calls to 'memcpy'
        cpg.call("memcpy").to_list()

        # Find flows from HTTP params to SQL execution
        source = cpg.identifier().name_matches(".*request.*")
        sink = cpg.call("execute_query")
        sink.reachable_by(source)

        # Slicing (new)
        source = cpg.identifier("user_input")
        sink = cpg.call("sql_execute")
        slice_graph = source.slice_to(sink)

        # Project skeleton
        cpg.project_skeleton()
    """
    def __init__(self, store: CPGStore):
        self.store = store
        self._slicer = None
        self._extractor = None
        self._context = None
        self._tagger = None
        self._builder = None
        self._module_nav = None
        self._audit = None

    def method(self, name: str = None) -> QueryStep:
        """查找方法定义 (Method Declarations)"""
        t = self.store.query.methods(name)
        return QueryStep(t, self.store)

    def call(self, name: str = None) -> QueryStep:
        """查找函数调用 (Call Sites)"""
        t = self.store.query.all_nodes(NodeLabel.CALL)
        step = QueryStep(t, self.store)
        if name:
            step = step.name(name)
        return step

    def identifier(self, name: str = None) -> QueryStep:
        """查找变量标识符 (Variables)"""
        t = self.store.query.all_nodes(NodeLabel.IDENTIFIER)
        step = QueryStep(t, self.store)
        if name:
            step = step.name(name)
        return step

    def type_decl(self, name: str = None) -> QueryStep:
        """查找类/结构体定义 (Class/Struct)"""
        t = self.store.query.all_nodes(NodeLabel.TYPE_DECL)
        step = QueryStep(t, self.store)
        if name:
            step = step.name(name)
        return step

    def file(self, name: str = None) -> QueryStep:
        """查找文件 (Files)"""
        t = self.store.query.files(name)
        return QueryStep(t, self.store)

    def literal(self, value: str = None) -> QueryStep:
        """查找常量/字面量 (Literals)"""
        t = self.store.query.all_nodes(NodeLabel.LITERAL)
        step = QueryStep(t, self.store)
        if value:
            step = step.filter(code=value)
        return step

    def all(self) -> QueryStep:
        """查找图中的所有节点 (慎用)"""
        t = self.store.query.all_nodes(None)
        return QueryStep(t, self.store)

    # --- Service Accessors ---

    @property
    def slicer(self):
        """GraphSlicer 实例 — 图切片引擎"""
        if self._slicer is None:
            from codedmap.app.query.slicer import GraphSlicer
            self._slicer = GraphSlicer(self.store)
        return self._slicer

    @property
    def extractor(self):
        """SubgraphExtractor 实例 — 子图提取器"""
        if self._extractor is None:
            from codedmap.app.query.extractor import SubgraphExtractor
            self._extractor = SubgraphExtractor(self.store)
        return self._extractor

    @property
    def context(self):
        """ContextLoader 实例 — 统一上下文加载器"""
        if self._context is None:
            from codedmap.analysis.traversal import ContextLoader
            self._context = ContextLoader(self.store)
        return self._context

    @property
    def builder(self):
        """CPGBuildEngine — build engine (requires full CPGConfig)"""
        if self._builder is None:
            from codedmap.app.build import CPGBuildEngine
            config = getattr(self.store, '_full_config', None)
            if config is None:
                raise RuntimeError(
                    "CPG.builder requires a CPGConfig (not available in query-only mode)"
                )
            self._builder = CPGBuildEngine(config=config)
        return self._builder

    @property
    def tagger(self):
        """TagEngine 实例 — 统一标签管理"""
        if self._tagger is None:
            from codedmap.analysis.tagging.engine import TagEngine
            self._tagger = TagEngine(self.store)
        return self._tagger

    @property
    def module_nav(self):
        """ModuleNavigator 实例 — 模块导航与指标计算"""
        if self._module_nav is None:
            from codedmap.analysis.traversal.module import ModuleNavigator
            self._module_nav = ModuleNavigator(self.store)
        return self._module_nav

    @property
    def audit(self):
        """AuditFacade — task-oriented audit workflow for agents.

        Provides the canonical facade for the security audit pipeline:
        surface → trace → bundle → state writeback.

        Example:
            session = cpg.audit.collect_evidence()
            print(session.model_dump_json())
        """
        if self._audit is None:
            from codedmap.app.audit import AuditFacade
            self._audit = AuditFacade(self.store)
        return self._audit

    @property
    def insights(self):
        """Lazy accessor for the InsightRepository on the store."""
        return self.store.insights

    # --- Summary / Note Operations ---

    def set_summary(
        self,
        node_ids: Optional[Union[int, List[int]]] = None,
        content: str = None,
        title: str = None,
        category: str = "COORDINATION",
        source: str = "agent",
        confidence: Optional[float] = None,
        created_by: str = None,
        scope: str = "campaign",
        knowledge_class: str = "assessment",
        campaign_id: Optional[str] = None,
        review_state: str = "unreviewed",
        visibility: str = "default",
        evidence_bundle: Optional[Dict[str, Any]] = None,
        promoted_from: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """
        Create or update a summary/note on 0..N nodes.

        Uses upsert semantics: if an insight with the same (node_ids, category, title, source)
        exists it is updated; otherwise a new one is created.
        If node_ids is None, creates a global/free-floating note on MetaDataNode.

        Args:
            node_ids: Target node ID(s), or None for a global note.
            content: Markdown content of the summary.
            title: Short human-readable title (max 120 chars).
            category: Insight category (default COORDINATION).
            source: Origin identifier (default "agent").
            confidence: Optional confidence score 0-1.
            created_by: Optional created_by identifier (overrides source for provenance).

        Returns:
            InsightSummary DTO.
        """
        from codedmap.app.query.models import InsightSummary
        from codedmap.app.query.note_validation import (
            validate_and_canonicalize_note_content,
            NoteSchemaValidationError,
        )

        canonical_content = validate_and_canonicalize_note_content(
            category=category, content=content
        )

        insight = self.insights.upsert(
            host_ids=node_ids,
            category=category,
            source=created_by or source,
            content=canonical_content,
            title=title,
            confidence=confidence,
            scope=scope,
            knowledge_class=knowledge_class,
            campaign_id=campaign_id,
            review_state=review_state,
            visibility=visibility,
            evidence_bundle=metadata if metadata is not None else (evidence_bundle or {}),
            promoted_from=promoted_from,
        )
        # Resolve host IDs cross-backend safe (no .id_list())
        hosts = self.store.query.by_id(insight.id).in_("HAS_INSIGHT").to_list()
        host_ids = [h.id for h in hosts]
        return InsightSummary(
            id=insight.id,
            node_ids=host_ids,
            category=insight.category,
            title=insight.title,
            content=insight.content,
            source=getattr(insight, "source", "unknown"),
            confidence=getattr(insight, "confidence", None),
            status=getattr(insight, "status", "active"),
            metadata={
                "scope": getattr(insight, "scope", "campaign"),
                "knowledge_class": getattr(insight, "knowledge_class", "assessment"),
                "campaign_id": getattr(insight, "campaign_id", None),
                "review_state": getattr(insight, "review_state", "unreviewed"),
                "visibility": getattr(insight, "visibility", "default"),
                "evidence_bundle": getattr(insight, "evidence_bundle", {}) or {},
                "promoted_from": getattr(insight, "promoted_from", None),
            },
            created_at=getattr(insight, "created_at", None),
            updated_at=getattr(insight, "updated_at", None),
        )

    def get_summary(self, node_ids: Optional[Union[int, List[int]]] = None, category: Optional[str] = None) -> Optional[str]:
        """
        Get the content string of the first matching insight on a node (or global).

        Args:
            node_ids: Target node ID(s), or None for global (MetaDataNode) insights.
            category: Optional category filter.

        Returns:
            Content string, or None if no insight found.
        """
        if node_ids is None:
            from codedmap.core.schema.graph.enums import NodeLabel as _NL
            meta = self.store.query.all_nodes(_NL.META_DATA).first()
            if meta is None:
                return None
            insights = self.insights.get_attached_insights(meta.id, category=category)
        elif isinstance(node_ids, list):
            insights = self.insights.get_attached_insights(node_ids[0], category=category)
        else:
            insights = self.insights.get_attached_insights(node_ids, category=category)
        if insights:
            return insights[0].content
        return None

    def get_summaries(self, node_ids: Optional[Union[int, List[int]]] = None) -> list:
        """
        Get all insights attached to a node (or global) as InsightSummary DTOs.

        Args:
            node_ids: Target node ID(s), or None for global (MetaDataNode) insights.

        Returns:
            List[InsightSummary]
        """
        from codedmap.app.query.models import InsightSummary

        if node_ids is None:
            from codedmap.core.schema.graph.enums import NodeLabel as _NL
            meta = self.store.query.all_nodes(_NL.META_DATA).first()
            if meta is None:
                return []
            raw_insights = self.insights.get_attached_insights(meta.id)
        elif isinstance(node_ids, list):
            raw_insights = self.insights.get_attached_insights(node_ids[0])
        else:
            raw_insights = self.insights.get_attached_insights(node_ids)

        result = []
        for i in raw_insights:
            hosts = self.store.query.by_id(i.id).in_("HAS_INSIGHT").to_list()
            host_ids = [h.id for h in hosts]
            result.append(InsightSummary(
                id=i.id,
                node_ids=host_ids,
                category=i.category,
                title=i.title,
                content=i.content,
                source=getattr(i, "source", "unknown"),
                confidence=getattr(i, "confidence", None),
                status=getattr(i, "status", "active"),
                created_at=getattr(i, "created_at", None),
                updated_at=getattr(i, "updated_at", None),
            ))
        return result

    def delete_summary(self, node_ids: Optional[Union[int, List[int]]] = None, category: Optional[str] = None, insight_id: Optional[int] = None) -> None:
        """
        Delete insights by insight_id (cascade) or by node_ids + category.

        Args:
            node_ids: Target node ID(s) — used with category for single-node cleanup.
            category: Category filter for node-based deletion.
            insight_id: Direct insight ID for cascade delete.
        """
        if insight_id is not None:
            self.insights.delete_insight_by_id(insight_id)
        elif node_ids is not None and category is not None:
            nid = node_ids[0] if isinstance(node_ids, list) else node_ids
            self.insights.delete_by_category(nid, category)
        elif node_ids is not None:
            # Unbind only — requires insight_id to be meaningful; no-op without it
            pass

    # --- Agent Infrastructure APIs ---

    def describe(self):
        """
        Return a GraphOverview with graph-level statistics.

        Provides node counts per label, detected languages, top tags,
        and total node/edge counts for the cpg stats CLI and agent tooling.
        """
        from codedmap.app.query.models import GraphOverview

        # Count nodes by label
        node_counts: Dict[str, int] = {}
        for label in NodeLabel:
            count = self.store.query.all_nodes(label).count()
            if count > 0:
                node_counts[label.value] = count

        total_nodes = sum(node_counts.values())

        # Shortcut counts
        files_count = node_counts.get(NodeLabel.FILE.value, 0)
        methods_count = node_counts.get(NodeLabel.METHOD.value, 0)
        modules_count = node_counts.get(NodeLabel.MODULE.value, 0)
        insights_count = node_counts.get(NodeLabel.INSIGHT.value, 0)

        # Entry points: nodes with ONTOLOGY:ENTRY_POINT:* or SEMANTIC:ENTRY_POINT:* tags
        try:
            l1_nodes = self.tagger.find("ONTOLOGY:ENTRY_POINT:*")
            l2_nodes = self.tagger.find("SEMANTIC:ENTRY_POINT:*")
            entry_points_count = len(l1_nodes) + len(l2_nodes) if l1_nodes or l2_nodes else 0
        except Exception:
            entry_points_count = 0

        # Languages from file extensions
        languages: List[str] = []
        ext_map = {
            ".py": "Python", ".c": "C", ".cpp": "C++", ".h": "C/C++ Header",
            ".java": "Java", ".js": "JavaScript", ".ts": "TypeScript",
            ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
        }
        try:
            seen_langs = set()
            for file_node in self.store.query.all_nodes(NodeLabel.FILE):
                name = getattr(file_node, "name", "") or ""
                dot_idx = name.rfind(".")
                if dot_idx >= 0:
                    ext = name[dot_idx:].lower()
                    lang = ext_map.get(ext)
                    if lang and lang not in seen_langs:
                        seen_langs.add(lang)
                        languages.append(lang)
        except Exception:
            pass

        # Top tags
        top_tags: List[tuple] = []
        try:
            all_tags = self.tagger.list_all_tags()
            tag_counter: Counter = Counter()
            for tag in all_tags:
                # Count is 1 per unique tag string; we list unique tags with count 1
                tag_counter[tag] = 1
            # For a more useful count, iterate nodes — but that's expensive.
            # Instead, just list unique tags sorted alphabetically, limited to 20.
            top_tags = [(t, 1) for t in sorted(all_tags)[:20]]
        except Exception:
            pass

        # Edge count
        total_edges = self._compute_edge_count()

        return GraphOverview(
            total_nodes=total_nodes,
            total_edges=total_edges,
            node_counts=node_counts,
            files=files_count,
            methods=methods_count,
            modules=modules_count,
            entry_points=entry_points_count,
            insights=insights_count,
            languages=languages,
            top_tags=top_tags,
        )

    def tactical_stats(self, top_n: int = 5) -> "TacticalStats":
        """
        Return an agent-friendly tactical dashboard with attack surface,
        audit progress, and hot spot aggregation.

        Args:
            top_n: Maximum number of hot spot methods to return (default 5).

        Returns:
            TacticalStats Pydantic model.
        """
        from codedmap.app.query.models import (
            TacticalStats, CategoryBreakdown, AuditProgress, MethodHotSpot
        )
        from collections import Counter, defaultdict

        # ------------------------------------------------------------------
        # 1. Graph header (reuse describe() logic)
        # ------------------------------------------------------------------
        node_counts: Dict[str, int] = {}
        for label in NodeLabel:
            count = self.store.query.all_nodes(label).count()
            if count > 0:
                node_counts[label.value] = count

        total_nodes = sum(node_counts.values())
        files_count = node_counts.get(NodeLabel.FILE.value, 0)
        methods_count = node_counts.get(NodeLabel.METHOD.value, 0)
        modules_count = node_counts.get(NodeLabel.MODULE.value, 0)

        languages: List[str] = []
        ext_map = {
            ".py": "Python", ".c": "C", ".cpp": "C++", ".h": "C/C++ Header",
            ".java": "Java", ".js": "JavaScript", ".ts": "TypeScript",
            ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
        }
        try:
            seen_langs: set = set()
            for file_node in self.store.query.all_nodes(NodeLabel.FILE):
                name = getattr(file_node, "name", "") or ""
                dot_idx = name.rfind(".")
                if dot_idx >= 0:
                    ext = name[dot_idx:].lower()
                    lang = ext_map.get(ext)
                    if lang and lang not in seen_langs:
                        seen_langs.add(lang)
                        languages.append(lang)
        except Exception:
            pass

        total_edges = self._compute_edge_count()

        # ------------------------------------------------------------------
        # 2. Attack surface — tagger.find() sweeps
        # ------------------------------------------------------------------
        try:
            ep_nodes = self.tagger.find("ONTOLOGY:ENTRY_POINT:*")
        except Exception:
            ep_nodes = []
        try:
            src_nodes = self.tagger.find("ONTOLOGY:SOURCE:*")
        except Exception:
            src_nodes = []
        try:
            sink_nodes = self.tagger.find("ONTOLOGY:SINK:*")
        except Exception:
            sink_nodes = []
        try:
            guard_nodes = self.tagger.find("ONTOLOGY:GUARD:*")
            guards_count = len(guard_nodes)
        except Exception:
            guards_count = 0
        try:
            san_l1 = self.tagger.find("ONTOLOGY:SANITIZER:*")
            san_l2 = self.tagger.find("SEMANTIC:SANITIZER:*")
            sanitizers_count = len(san_l1) + len(san_l2)
        except Exception:
            sanitizers_count = 0

        # ------------------------------------------------------------------
        # 3. Category breakdown helper
        # ------------------------------------------------------------------
        def _category_breakdown(nodes: list, prefix: str) -> CategoryBreakdown:
            counter: Counter = Counter()
            for node in nodes:
                for tag in getattr(node, "tags", []):
                    if tag.startswith(prefix):
                        cat = tag.split(":")[-1]
                        counter[cat] += 1
            top3 = [{k: v} for k, v in counter.most_common(3)]
            return CategoryBreakdown(total=len(nodes), top_categories=top3)

        ep_breakdown = _category_breakdown(ep_nodes, "ONTOLOGY:ENTRY_POINT:")
        src_breakdown = _category_breakdown(src_nodes, "ONTOLOGY:SOURCE:")
        sink_breakdown = _category_breakdown(sink_nodes, "ONTOLOGY:SINK:")

        # ------------------------------------------------------------------
        # 4. Dual-signal audit helper
        # ------------------------------------------------------------------
        def _is_audited(node) -> bool:
            tags = getattr(node, "tags", [])
            if "STATE:AUDITED" in tags:
                return True
            try:
                neighbors = self.store.get_neighbors(node.id, "OUT", ["HAS_INSIGHT"])
                return len(neighbors) > 0
            except Exception:
                return False

        # ------------------------------------------------------------------
        # 5. Audit progress per node type
        # ------------------------------------------------------------------
        def _audit_progress(nodes: list) -> AuditProgress:
            total = len(nodes)
            audited = sum(1 for n in nodes if _is_audited(n))
            percent = round(audited / total * 100, 1) if total > 0 else 0.0
            return AuditProgress(total=total, audited=audited, percent=percent)

        ep_audit = _audit_progress(ep_nodes)
        src_audit = _audit_progress(src_nodes)
        sink_audit = _audit_progress(sink_nodes)

        # ------------------------------------------------------------------
        # 6. Notes — global insight count + category breakdown
        # ------------------------------------------------------------------
        notes_total = 0
        notes_by_category: Dict[str, int] = {}
        try:
            all_insights = self.store.insights.find_all_insights(limit=500)
            notes_total = len(all_insights)
            cat_counter: Counter = Counter()
            for insight in all_insights:
                cat = getattr(insight, "category", None)
                if cat is not None:
                    cat_str = str(cat)
                    cat_counter[cat_str] += 1
            notes_by_category = dict(cat_counter)
        except Exception:
            pass

        # ------------------------------------------------------------------
        # 7. Repairs — session-scoped singleton
        # ------------------------------------------------------------------
        repairs_total = 0
        try:
            from codedmap.app.services import domain_services as svc
            repairs_total = int(svc.repair_list(self.store).get("total", 0))
        except Exception:
            repairs_total = 0

        # ------------------------------------------------------------------
        # 8. Hot spot aggregation
        # ------------------------------------------------------------------
        method_sinks: Dict[int, int] = defaultdict(int)
        method_sources: Dict[int, int] = defaultdict(int)
        method_info: Dict[int, tuple] = {}

        for node in sink_nodes:
            if _is_audited(node):
                continue
            try:
                method_nodes = self.store.query.by_id(node.id).methods().to_list()
            except Exception:
                continue
            if not method_nodes:
                continue
            m = method_nodes[0]
            mid = m.id
            method_sinks[mid] += 1
            if mid not in method_info:
                method_info[mid] = (
                    getattr(m, "name", "?"),
                    getattr(m, "file_name", None),
                    getattr(m, "line_number", None),
                )

        for node in src_nodes:
            if _is_audited(node):
                continue
            try:
                method_nodes = self.store.query.by_id(node.id).methods().to_list()
            except Exception:
                continue
            if not method_nodes:
                continue
            m = method_nodes[0]
            mid = m.id
            method_sources[mid] += 1
            if mid not in method_info:
                method_info[mid] = (
                    getattr(m, "name", "?"),
                    getattr(m, "file_name", None),
                    getattr(m, "line_number", None),
                )

        all_method_ids = set(method_sinks.keys()) | set(method_sources.keys())
        scored: List[MethodHotSpot] = []
        for mid in all_method_ids:
            s = method_sinks[mid]
            r = method_sources[mid]
            score = (s * 2) + r
            name, file, line = method_info[mid]
            scored.append(MethodHotSpot(
                node_id=mid, name=name, file=file, line=line,
                score=score, unaudited_sinks=s, unaudited_sources=r,
            ))

        scored.sort(key=lambda x: x.score, reverse=True)
        hot_spots_total = len(scored)
        hot_spots = scored[:top_n]

        # ------------------------------------------------------------------
        # 9. Suggested commands
        # ------------------------------------------------------------------
        suggested: List[str] = []
        if hot_spots and sink_audit.audited < sink_audit.total:
            top = hot_spots[0]
            suggested.append(f"cpg query trace -f {top.name} --taint  # trace top hot spot")
        if ep_breakdown.total > 0 and len(suggested) < 3:
            suggested.append("cpg query entrypoints  # list all entry points")
        if notes_total > 0 and len(suggested) < 3:
            suggested.append("cpg annotate note list  # review audit notes")
        if not suggested:
            suggested.append("cpg query search <pattern>  # find nodes by name")
        suggested = suggested[:3]

        return TacticalStats(
            total_nodes=total_nodes,
            total_edges=total_edges,
            files=files_count,
            methods=methods_count,
            modules=modules_count,
            languages=languages,
            entry_points=ep_breakdown,
            sources=src_breakdown,
            sinks=sink_breakdown,
            guards=guards_count,
            sanitizers=sanitizers_count,
            entry_point_audit=ep_audit,
            source_audit=src_audit,
            sink_audit=sink_audit,
            notes_total=notes_total,
            notes_by_category=notes_by_category,
            repairs_total=repairs_total,
            hot_spots=hot_spots,
            hot_spots_total_methods=hot_spots_total,
            suggested_commands=suggested,
        )

    def _compute_edge_count(self) -> int:
        """Compute total edge count. Returns -1 if unavailable."""
        try:
            return self.store.stats.edge_count()
        except Exception:
            return -1

    def inspect(self, node_id: int):
        """
        Inspect a node by ID, returning full details as a NodeDetail.

        Raises ValueError if the node is not found.
        """
        from codedmap.app.query.models import NodeDetail

        node = self.store.get_node(node_id)
        if node is None:
            raise ValueError(f"Node not found: {node_id}")

        label = getattr(node, "label", "UNKNOWN")
        label_str = label.value if hasattr(label, "value") else str(label)
        name = getattr(node, "name", None)
        file_path = getattr(node, "file_name", None) or getattr(node, "fileName", None)
        line_start = getattr(node, "line_number", None) or getattr(node, "lineNumber", None)
        line_end = getattr(node, "line_number_end", None) or getattr(node, "lineNumberEnd", None)
        tags = getattr(node, "tags", []) or []

        # Properties: use model_dump if available
        properties = {}
        try:
            properties = node.model_dump(by_alias=True)
            # Remove internal fields already represented in NodeDetail
            for key in ("id", "label", "tags"):
                properties.pop(key, None)
        except Exception:
            pass

        # Parent: find AST parent
        parent_id = None
        try:
            parents = self.store.query.by_id(node_id).in_("AST").to_list()
            if parents:
                parent_id = getattr(parents[0], "id", None)
        except Exception:
            pass

        # Children count
        children_count = 0
        try:
            children_count = self.store.query.by_id(node_id).out("AST").count()
        except Exception:
            pass

        # Insights count
        node_insights_count = 0
        try:
            node_insights_count = self.store.query.by_id(node_id).out("HAS_INSIGHT").count()
        except Exception:
            pass

        return NodeDetail(
            id=node_id,
            label=label_str,
            name=name,
            properties=properties,
            file_path=file_path,
            line_start=line_start,
            line_end=line_end,
            tags=list(tags),
            parent_id=parent_id,
            children_count=children_count,
            insights_count=node_insights_count,
        )

    def source(self, node_id: int) -> Optional[str]:
        """
        Get source code for a node, using priority chain:
        1. node.code attribute
        2. AstContextNavigator.get_context_code()
        3. context_slice().source

        Returns None if no source could be obtained.
        """
        node = self.store.get_node(node_id)
        if node is None:
            return None

        # 1. Direct code attribute
        code = getattr(node, "code", None)
        if code:
            return code

        # 2. AstContextNavigator
        try:
            from codedmap.analysis.traversal import AstContextNavigator
            nav = AstContextNavigator(self.store)
            ctx_code = nav.get_context_code(node, max_lines=50, window_strategy=True)
            if ctx_code:
                return ctx_code
        except Exception:
            pass

        # 3. context_slice
        try:
            cs = self.context_slice(node)
            if cs and cs.source:
                return cs.source
        except Exception:
            pass

        return None

    def by_ids(self, ids: List[int]) -> QueryStep:
        """
        Create a QueryStep from an explicit list of node IDs.

        Args:
            ids: List of node IDs to look up.

        Returns:
            QueryStep containing the matched nodes.
        """
        if not ids:
            return self._empty_step()
        return QueryStep(self.store.query.by_ids(ids), self.store)

    def trace(
        self,
        source_id: int,
        sink_id: int,
        max_depth: int = 50,
        max_paths: int = 20,
    ) -> list:
        """
        Simplified backward trace from sink to source.

        Traces backward from sink_id using BackwardTracingNavigator,
        then filters returned paths to only those containing source_id.

        Args:
            source_id: ID of the source node to look for in traces.
            sink_id: ID of the sink node to trace backward from.
            max_depth: Maximum trace depth (default 50).
            max_paths: Maximum paths to explore (default 20).

        Returns:
            List[TracePath] — only paths that include source_id.
        """
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        navigator = BackwardTracingNavigator(self.store)
        result = navigator.trace_to_controllable(
            sink_id, max_depth=max_depth, max_paths=max_paths
        )

        # Filter to paths containing source_id
        filtered_paths = []
        for path in result.paths:
            hop_ids = set()
            for hop in path.hops:
                hop_node = hop.node if hasattr(hop, "node") else hop
                hop_id = getattr(hop_node, "id", None)
                if hop_id is not None:
                    hop_ids.add(hop_id)
            if source_id in hop_ids:
                filtered_paths.append(path)

        return filtered_paths

    def project_skeleton(self, max_depth: int = 5, style: str = "ascii") -> str:
        """生成项目骨架树状结构"""
        return self.context.get_project_skeleton()

    # --- Tag Registry ---

    def tag_registry(self) -> list:
        """Return L1 ontology as structured data for agent inspection (DSL-01).

        Returns list of TagDefinition objects describing all known L1 tag categories.
        Each TagDefinition has: layer, namespace, name, full_tag, description.
        Agents can call .model_dump() on each for JSON serialization.
        """
        from codedmap.core.schema.tags.registry import TagRegistry
        registry = TagRegistry()
        return registry.list_ontology()

    # --- Tag Operations ---

    def tag(self, node_id: int, tag: str) -> 'CPG':
        """
        Add a tag to a node (DSL method for agents).

        Args:
            node_id: The ID of the node to tag.
            tag: The tag to add (e.g., "ONTOLOGY:SOURCE:ENV_DATA").

        Returns:
            Self for method chaining.

        Raises:
            ValueError: If the node doesn't exist.
        """
        node = self.store.get_node(node_id)
        if node is None:
            raise ValueError(f"Node not found: {node_id}")
        self.tagger.add(node, tag)
        return self

    def untag(self, node_id: int, tag: str) -> 'CPG':
        """
        Remove a tag from a node (DSL method for agents).

        Args:
            node_id: The ID of the node to untag.
            tag: The tag to remove.

        Returns:
            Self for method chaining.

        Raises:
            ValueError: If the node doesn't exist.
        """
        node = self.store.get_node(node_id)
        if node is None:
            raise ValueError(f"Node not found: {node_id}")
        self.tagger.remove(node, tag)
        return self

    def node_tags(self, node_id: int) -> List[str]:
        """
        List all tags on a node (DSL method for agents).

        Args:
            node_id: The ID of the node.

        Returns:
            List of tag strings.

        Raises:
            ValueError: If the node doesn't exist.
        """
        node = self.store.get_node(node_id)
        if node is None:
            raise ValueError(f"Node not found: {node_id}")
        return self.tagger.list_tags(node)

    # Backward compatibility alias
    def _tags_for_node(self, node_id: int) -> List[str]:
        """Internal: Backward compatibility for tags(node_id) method."""
        return self.node_tags(node_id)

    def tags(self, prefix: str = None) -> QueryStep:
        """
        Query tags with fluent API (DSL method for agents).

        This method returns a QueryStep for querying tagged nodes.
        Use it to find nodes that have specific tag patterns.

        Args:
            prefix: Optional tag prefix/pattern to filter (e.g., 'ONTOLOGY:ENTRY_POINT:*').
                If None, returns all nodes with any tag.

        Returns:
            QueryStep for further chaining.

        Example:
            cpg.tags(prefix='ONTOLOGY:ENTRY_POINT:*').limit(10).to_list()
            cpg.tags().where(lambda n: 'HTTP' in n.tags).to_list()

        Note:
            To list tags on a specific node, use node_tags(node_id) instead.
        """
        if prefix:
            return self.find_tag(prefix)
        # Return all nodes with any tag
        return self.find_tag('*')

    def find_tag(self, pattern: str) -> QueryStep:
        """
        Find nodes by tag pattern (DSL method for agents).

        Args:
            pattern: Tag pattern to search for. Supports wildcards
                     (e.g., "ONTOLOGY:SOURCE:*", "ONTOLOGY:SINK:*").

        Returns:
            QueryStep for further chaining.
        """
        nodes = self.tagger.find(pattern)
        if not nodes:
            return self._empty_step()
        ids = [n.id for n in nodes if n.id is not None]
        return QueryStep(self.store.query.by_ids(ids), self.store)

    def _empty_step(self) -> QueryStep:
        """Internal: Create an empty QueryStep."""
        return QueryStep(self.store.query.by_id(-1), self.store)

    # --- Entry Point Operations ---

    def entry_points(self, level: str = None, category: str = None, type: str = None) -> QueryStep:
        """
        Query entry points by category, type, and layer (level).

        Levels:
            - 'L1' or 'ONTOLOGY': System-generated entry points (ONTOLOGY layer)
            - 'L2' or 'SEMANTIC': Agent/Human-discovered entry points (SEMANTIC layer)
            - None (Default): Returns ALL entry points (L1 + L2)

        Category resolution (dual-path per CONTEXT.md locked decision):
            - If category matches a V2 EntryPointCategory value → filter ONTOLOGY:ENTRY_POINT:{category}
            - Otherwise → treat as protocol filter: SEMANTIC:PROTOCOL:{category.upper()}
              e.g. category='http' → SEMANTIC:PROTOCOL:HTTP
                   category='NETWORK_LISTENER' → ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER

        Args:
            level: Filter by layer (L1/ONTOLOGY, L2/SEMANTIC, or None for all).
            category: Filter by V2 category or protocol string. Case-insensitive.
            type: Filter by rule type/name substring. Case-insensitive.

        Returns:
            QueryStep for further chaining.

        Example:
            cpg.entry_points().to_list()
            cpg.entry_points(category='NETWORK_LISTENER').to_list()  # V2 enum path
            cpg.entry_points(category='http').to_list()              # SEMANTIC:PROTOCOL:HTTP
        """
        from codedmap.core.schema.security.entrypoint_models import EntryPointCategory

        layers_to_search = []
        if level in ["L1", "ONTOLOGY"]:
            layers_to_search.append(TagLayer.ONTOLOGY.value)
        elif level in ["L2", "SEMANTIC"]:
            layers_to_search.append(TagLayer.SEMANTIC.value)
        else:
            layers_to_search = [TagLayer.ONTOLOGY.value, TagLayer.SEMANTIC.value]

        all_nodes = []
        seen_ids = set()

        if category is not None:
            upper = category.upper()
            v2_values = {e.value for e in EntryPointCategory}
            if upper in v2_values:
                # Standard V2 ontology filter: ONTOLOGY:ENTRY_POINT:{upper}
                pattern = f"ONTOLOGY:ENTRY_POINT:{upper}"
                for node in self.tagger.find(pattern):
                    if node.id not in seen_ids:
                        seen_ids.add(node.id)
                        all_nodes.append(node)
            else:
                # Protocol-based filter: SEMANTIC:PROTOCOL:{upper}
                # Handles legacy callers: category='http' → SEMANTIC:PROTOCOL:HTTP
                pattern = f"SEMANTIC:PROTOCOL:{upper}"
                for node in self.tagger.find(pattern):
                    if node.id not in seen_ids:
                        seen_ids.add(node.id)
                        all_nodes.append(node)
        else:
            # No category filter — return all entry points across requested layers
            for layer in layers_to_search:
                pattern = f"{layer}:ENTRY_POINT:*"
                for node in self.tagger.find(pattern):
                    if node.id not in seen_ids:
                        seen_ids.add(node.id)
                        all_nodes.append(node)

        if not all_nodes:
            return self._empty_step()

        step = QueryStep(self.store.query.by_ids([n.id for n in all_nodes]), self.store)

        if type:
            type_lower = type.lower()
            step = step.where(lambda n: any(
                type_lower in t.lower() for t in getattr(n, 'tags', [])
            ))

        return step

    def guards(self, category: str = None) -> "QueryStep":
        """
        Find nodes tagged as guards (ONTOLOGY:GUARD:*).

        Args:
            category: Optional guard category filter (e.g., 'NULL_CHECK', 'BOUNDS_CHECK').
                Case-insensitive.

        Returns:
            QueryStep for further chaining.
        """
        pattern = f"ONTOLOGY:GUARD:{category.upper()}" if category else "ONTOLOGY:GUARD:*"
        nodes = self.tagger.find(pattern)
        if not nodes:
            return self._empty_step()
        return QueryStep(self.store.query.by_ids([n.id for n in nodes if n.id is not None]), self.store)

    def sanitizers(self, category: str = None) -> "QueryStep":
        """
        Find nodes tagged as sanitizers (ONTOLOGY:SANITIZER:* or SEMANTIC:SANITIZER:*).

        Args:
            category: Optional sanitizer category filter (e.g., 'ESCAPE', 'ENCODE').
                Case-insensitive.

        Returns:
            QueryStep for further chaining.
        """
        all_nodes = []
        seen_ids: set = set()
        for layer in [TagLayer.ONTOLOGY.value, TagLayer.SEMANTIC.value]:
            pattern = f"{layer}:SANITIZER:{category.upper()}" if category else f"{layer}:SANITIZER:*"
            for node in self.tagger.find(pattern):
                if node.id not in seen_ids:
                    seen_ids.add(node.id)
                    all_nodes.append(node)
        if not all_nodes:
            return self._empty_step()
        return QueryStep(self.store.query.by_ids([n.id for n in all_nodes if n.id is not None]), self.store)

    def sinks(self, category: str = None) -> "QueryStep":
        """
        Find nodes tagged as sinks (ONTOLOGY:SINK:* or SEMANTIC:SINK:*).

        Searches both ONTOLOGY and SEMANTIC layers (like sanitizers).

        Args:
            category: Optional sink category filter (e.g., 'MEMORY_WRITE', 'OS_COMMAND').
                Case-insensitive.

        Returns:
            QueryStep for further chaining.
        """
        all_nodes = []
        seen_ids: set = set()
        for layer in [TagLayer.ONTOLOGY.value, TagLayer.SEMANTIC.value]:
            pattern = f"{layer}:SINK:{category.upper()}" if category else f"{layer}:SINK:*"
            for node in self.tagger.find(pattern):
                if node.id not in seen_ids:
                    seen_ids.add(node.id)
                    all_nodes.append(node)
        if not all_nodes:
            return self._empty_step()
        return QueryStep(self.store.query.by_ids([n.id for n in all_nodes if n.id is not None]), self.store)

    def roles(self, category: str = None) -> "QueryStep":
        """
        Find nodes tagged as roles (ONTOLOGY:ROLE:*). L1 only.

        Args:
            category: Optional role category filter (e.g., 'BOUNDARY', 'DRIVER').
                Case-insensitive.

        Returns:
            QueryStep for further chaining.
        """
        pattern = f"ONTOLOGY:ROLE:{category.upper()}" if category else "ONTOLOGY:ROLE:*"
        nodes = self.tagger.find(pattern)
        if not nodes:
            return self._empty_step()
        return QueryStep(self.store.query.by_ids([n.id for n in nodes if n.id is not None]), self.store)

    def sources(self, category=None, source_type=None, function=None) -> "QueryStep":
        """
        DSL convenience method: return METHOD nodes tagged as sources (ONTOLOGY:SOURCE:* tags).

        This method is for agents using the programmatic query chain (e.g., cpg.sources().limit(10)).
        The CLI command (cpg query sources) calls SourceDetector directly instead, for full trigger
        metadata via Source.to_dict().

        Args:
            category: SourceCategory value string to filter (e.g., "ENV_VAR") — UPPERCASE
            source_type: Pattern type filter ("call" or "identifier") — best-effort, not tag-indexed
            function: Function name substring filter applied to node name

        Returns:
            QueryStep with METHOD nodes tagged as sources (tags applied by SourcePass)
        """
        from codedmap.core.schema.tags.matcher import SecurityTagMatcher

        all_methods = self.method().to_list()
        results = []
        for node in all_methods:
            tags = getattr(node, "tags", [])
            if any(SecurityTagMatcher.is_source(t) for t in tags):
                if category:
                    # Match ONTOLOGY:SOURCE:{category} where category is uppercase
                    if not any(f"ONTOLOGY:SOURCE:{category.upper()}" == t for t in tags):
                        continue
                if function:
                    name = getattr(node, "name", "") or ""
                    if function.lower() not in name.lower():
                        continue
                results.append(node)

        if not results:
            return self._empty_step()

        return QueryStep(self.store.query.by_ids([n.id for n in results if n.id is not None]), self.store)

    def list_tags(self, prefix: str = None) -> List[str]:
        """
        List all unique tags in the database.

        Args:
            prefix: Optional prefix filter (e.g., 'ONTOLOGY:ENTRY_POINT').

        Returns:
            List of unique tag strings.

        Example:
            cpg.list_tags(prefix='ONTOLOGY:ENTRY_POINT')
            # Returns: ['ONTOLOGY:ENTRY_POINT:CLI', 'ONTOLOGY:ENTRY_POINT:HTTP', ...]
        """
        return self.tagger.list_all_tags(prefix=prefix)

    # --- Module Operations ---

    def modules(self, name: str = None) -> QueryStep:
        """
        Query modules in the CPG.

        Modules are logical groupings of files (ModuleNode) that represent
        architectural units. Use this to explore attack surface at the module level.

        Args:
            name: Optional module name filter (exact match).

        Returns:
            QueryStep for further chaining.

        Example:
            cpg.modules().to_list()                      # All modules
            cpg.modules(name='network').first()          # Find specific module
            cpg.modules().filter(subsystem='fs').to_list()  # Filter by subsystem
        """
        t = self.store.query.all_nodes(NodeLabel.MODULE)
        step = QueryStep(t, self.store)
        if name:
            step = step.name(name)
        return step

    def module_files(self, module_name: str) -> QueryStep:
        """
        Get all files contained in a specific module.

        Args:
            module_name: Name of the module to query.

        Returns:
            QueryStep containing FileNode instances, or empty step if module not found.

        Example:
            cpg.module_files('network').to_list()
        """
        modules = self.store.modules.find_by_name(module_name)
        if not modules:
            return self._empty_step()
        module = modules[0]
        files = list(self.module_nav.get_files(module))
        if not files:
            return self._empty_step()
        ids = [f.id for f in files if f.id is not None]
        return QueryStep(self.store.query.by_ids(ids), self.store)

    def module_methods(self, module_name: str) -> QueryStep:
        """
        Get all methods contained in a specific module.

        Args:
            module_name: Name of the module to query.

        Returns:
            QueryStep containing MethodNode instances, or empty step if module not found.

        Example:
            cpg.module_methods('network').to_list()
        """
        modules = self.store.modules.find_by_name(module_name)
        if not modules:
            return self._empty_step()
        module = modules[0]
        methods = list(self.module_nav.get_methods(module))
        if not methods:
            return self._empty_step()
        ids = [m.id for m in methods if m.id is not None]
        return QueryStep(self.store.query.by_ids(ids), self.store)

    # --- Backward Tracing Operations ---

    def trace_back(
        self,
        node: Union[CPGNode, int],
        max_depth: int = 10,
        max_paths: int = 10,
    ) -> 'TraceResult':
        """
        Trace backward from a sink node to find controllable input.

        This is the primary DSL method for backward tracing security analysis.
        It traces from a dangerous sink function backward through DDG edges
        to find where user input becomes controllable.

        Args:
            node: Sink node to trace from (CPGNode or node ID)
            max_depth: Maximum hops to trace (default: 10)
            max_paths: Maximum paths to return (default: 10)

        Returns:
            TraceResult with all paths found from sink to controllable inputs.

        Example:
            # Trace from a memcpy call
            sink = cpg.call("memcpy").first()
            result = cpg.trace_back(sink)
            print(result.to_json())

            # Check if controllable input was found
            if result.found_controllable:
                for path in result.paths:
                    print(f"Path depth: {path.depth}, terminated: {path.termination_reason}")

        Note:
            Uses BackwardTracingNavigator with default SinkCatalog.
            For custom sink catalog, use BackwardTracingNavigator directly.
        """
        from codedmap.analysis.traversal.tracing import BackwardTracingNavigator

        navigator = BackwardTracingNavigator(self.store)
        return navigator.trace_to_controllable(node, max_depth=max_depth, max_paths=max_paths)

    def context_slice(self, node: Union[CPGNode, int], **options) -> 'ContextSlice':
        """Return structured context slice for a node (DSL-02).

        This is the primary DSL method for agents to get structured context.
        Returns a typed Pydantic model that can be serialized with model_dump(mode='json').

        Args:
            node: CPGNode or node ID
            **options: Passed to SliceOptions (ddg_depth, include_source, etc.)

        Returns:
            ContextSlice Pydantic model with all context dimensions.

        Example:
            >>> slice = cpg.context_slice(method_node, ddg_depth=5)
            >>> slice.model_dump(mode='json')
        """
        from codedmap.analysis.traversal.context_slice import SliceOptions, ContextSlice
        node_obj = node if isinstance(node, CPGNode) else self.store.get_node(node)
        if node_obj is None:
            raise ValueError(f"Node not found: {node}")
        return self.context.get_context_slice(node_obj, SliceOptions(**options))
