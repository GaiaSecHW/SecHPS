# codedmap/analysis/traversal/context.py

from enum import Enum
from typing import Any, Optional, Union, List, Dict, Set, Iterator
from itertools import chain
import logging

from codedmap.analysis.utils.code_cleaner import CodeSlicer
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.nodes import MethodNode, FileNode, DirectoryNode, InsightNode

from codedmap.infra.storage.store import CPGStore

# 保持原有 Navigator 引用，它们已经是惰性化的了
from .ast import AstContextNavigator
from .dataflow import DataFlowNavigator
from .call import CallGraphNavigator
from .cfg import ControlFlowNavigator
from .structure import RepoStructureNavigator
from .formatter import ChainFormatter, FocusStrategy
from .module import ModuleNavigator

logger = logging.getLogger(__name__)


class ContextStrategy(str, Enum):
    """上下文组装策略"""
    SUMMARY = "SUMMARY"  # 宽视窗 + 签名 + 架构摘要
    PRECISE_SLICE = "SLICE"  # 数据流切片 + 现有 Insight
    HIERARCHY = "HIERARCHY"  # 类型继承树


class ContextLoader:
    """
    [Facade] 统一上下文数据加载器 (Pure Model Layer).
    [Refactored v3.0] 适配 Lazy Storage DSL。
    """

    def __init__(self, store: CPGStore):
        self.store = store
        self.ast = AstContextNavigator(store)
        self.dataflow = DataFlowNavigator(store)
        self.call = CallGraphNavigator(store)
        self.cfg = ControlFlowNavigator(store)
        self.structure = RepoStructureNavigator(store)
        self.module = ModuleNavigator(store)
        self.formatter = ChainFormatter(self.ast, self.dataflow)

    def get_context_data(self, node: CPGNode, strategy: ContextStrategy) -> Dict[str, Any]:
        """
        [Main Entry] 获取结构化上下文数据。
        """
        data = {
            "strategy": strategy.value,
            "node_name": getattr(node, "name", "unknown"),
            "node_id": getattr(node, "id", -1),
            "language": "c/c++",
            "file_path": "unknown"
        }

        try:
            f = self.ast.get_enclosing_file(node)
            if f:
                if hasattr(f, "language"): data["language"] = f.language
                if hasattr(f, "name"): data["file_path"] = f.name
        except:
            pass

        if strategy == ContextStrategy.PRECISE_SLICE:
            self._enrich_slice_data(node, data)
        elif strategy == ContextStrategy.SUMMARY:
            self._enrich_summary_data(node, data)
        elif strategy == ContextStrategy.HIERARCHY:
            self._enrich_hierarchy_data(node, data)

        return data

    # =========================================================================
    # Data Enrichment
    # =========================================================================

    def _enrich_slice_data(self, node: CPGNode, data: Dict[str, Any]):
        """
        填充切片相关数据。
        """
        # 1. 收集切片节点 (返回 Set，已在内部处理好去重和 Materialization)
        slice_nodes = self._collect_slice_nodes(node)

        # 2. 重组代码
        # CodeSlicer 需要列表输入
        slice_nodes_list = list(slice_nodes)
        highlight_lines = {getattr(node, 'line_number', -1)}
        data["code"] = CodeSlicer.rebuild_slice(slice_nodes_list, highlight_lines)

        # 3. 结构化 Insight
        data["insights"] = self._fetch_insights_list(slice_nodes_list, category="VULNERABILITY")

        # 4. 相似漏洞
        data["similar_vulnerabilities"] = self._fetch_similar_vulns_list(node)

    def _enrich_summary_data(self, node: CPGNode, data: Dict[str, Any]):
        """
        填充摘要相关数据。
        """
        # 1. 物理代码窗口
        data["code"] = self.ast.get_context_code(node, max_lines=50, window_strategy=True) or ""

        # 2. 架构上下文
        data["architecture"] = self._fetch_architectural_info(node)

        # 3. 自身历史摘要
        data["existing_summary"] = getattr(node, 'summary', None)

        # 4. 外部依赖 (Callees) - 优化查询
        # 使用 limit(15) 避免拉取太多
        callees_iter = (self.store.query.by_id(node.id)
                        .out(EdgeType.CONTAINS)
                        .out(EdgeType.CALL)
                        .limit(15))

        callee_sigs = set()
        for call in callees_iter:
            name = getattr(call, 'name', '')
            if name and not name.startswith("<"):
                callee_sigs.add(name)
        data["callees"] = list(callee_sigs)

    def _enrich_hierarchy_data(self, node: CPGNode, data: Dict[str, Any]):
        """
        填充继承树相关数据。
        """
        type_decl = self.ast.get_enclosing_type(node)
        if not type_decl:
            data["class_info"] = None
            return

        # ast Navigator 已经重构为返回 Iterator，需要 list() 转换
        base_types = list(self.ast.get_base_types(type_decl))
        methods = list(self.ast.get_methods_in_type(type_decl))

        data["class_info"] = {
            "name": type_decl.name,
            "base_types": [b.name for b in base_types],
            "methods": [m.name for m in methods]
        }

    # =========================================================================
    # Internal Helpers (Optimized)
    # =========================================================================

    def _collect_slice_nodes(self, node: CPGNode) -> Set[CPGNode]:
        """
        [Optimized] 收集切片涉及的所有节点。
        """
        slice_nodes = {node}

        # 1. Data Flow (Forward & Backward)
        # 使用 chain 组合两个惰性迭代器
        defs_iter = self.store.query.by_id(node.id).repeat(EdgeType.DDG, "IN", max_depth=5)
        uses_iter = self.store.query.by_id(node.id).repeat(EdgeType.DDG, "OUT", max_depth=5)

        for n in chain(defs_iter, uses_iter):
            slice_nodes.add(n)

        # 2. Control Flow Context (Batch Query)
        # 提取当前所有 slice nodes 的 ID 进行一次批量查询
        node_ids = [n.id for n in slice_nodes if n.id is not None]

        if node_ids:
            parents_iter = (self.store.query.by_ids(node_ids)
                            .repeat(EdgeType.AST, "IN", max_depth=3, target_label=NodeLabel.CONTROL_STRUCTURE))

            for p in parents_iter:
                slice_nodes.add(p)

        return slice_nodes

    def _fetch_architectural_info(self, node: CPGNode) -> Dict[str, Any]:
        """
        获取结构化的架构信息。
        """
        info = {
            "file_name": None,
            "file_summary": None,
            "module_path": None,
            "module_summary": None
        }

        file_node = self.ast.get_enclosing_file(node)
        if file_node:
            info["file_name"] = getattr(file_node, 'name', None)
            info["file_summary"] = getattr(file_node, 'summary', None)

            try:
                # 查找所属目录 (limit 1)
                dir_node = (self.store.query.by_id(file_node.id)
                            .in_(EdgeType.CONTAINS, target_class=DirectoryNode)
                            .first())

                if dir_node:
                    info["module_path"] = getattr(dir_node, 'path', None)
                    info["module_summary"] = getattr(dir_node, 'summary', None)
            except Exception:
                pass
        return info

    def _fetch_insights_list(self, nodes: List[CPGNode], category: str = "VULNERABILITY") -> List[str]:
        """获取 Insight 内容列表"""
        if not nodes: return []
        node_ids = [n.id for n in nodes if n.id is not None]
        if not node_ids: return []

        try:
            # Batch Query
            insights_iter = (self.store.query.by_ids(node_ids)
                             .out(EdgeType.HAS_INSIGHT, target_class=InsightNode)
                             .filter(category=category))

            seen = set()
            result = []
            for i in insights_iter:
                content = getattr(i, 'content', '').strip()
                if content and content not in seen:
                    result.append(content)
                    seen.add(content)
            return result
        except Exception as e:
            logger.warning(f"Failed to fetch insights: {e}")
            return []

    def _fetch_similar_vulns_list(self, node: CPGNode) -> List[str]:
        """获取相似漏洞描述列表"""
        if not isinstance(node, MethodNode): return []
        node_embedding = getattr(node, 'embedding', None)
        if not node_embedding: return []

        try:
            # search_similar_nodes_with_score 是原子的，暂不涉及流式优化
            results = self.store.search_similar_nodes_with_score(
                label="METHOD",
                query_vector=node_embedding,
                top_k=10
            )

            examples = []
            for candidate, score in results:
                if candidate.id == node.id: continue

                # 使用专门的 Insight Loader 方法，或者复用 DSL
                # 这里假设 insights 挂在 candidate 上
                insight_iter = (self.store.query.by_id(candidate.id)
                                .out(EdgeType.HAS_INSIGHT, target_class=InsightNode)
                                .filter(category="VULNERABILITY")
                                .limit(1))  # 只取第一条

                insight = insight_iter.first()
                if insight:
                    vuln_desc = insight.content
                    pct = int(score * 100)
                    examples.append(f"Function `{candidate.name}` (Similarity: {pct}%): {vuln_desc}")

            return examples[:2]
        except Exception:
            return []

    # =========================================================================
    # Utilities
    # =========================================================================
    def get_project_skeleton(self) -> str:
        return self.structure.generate_repo_skeleton()

    def format_trace(self, trace_nodes: list[MethodNode], strategy: Union[str, FocusStrategy] = FocusStrategy.SINK,
                     focus_index: Optional[int] = None) -> str:
        if isinstance(strategy, str):
            try:
                strategy = FocusStrategy(strategy.lower())
            except ValueError:
                strategy = FocusStrategy.SINK

        return self.formatter.format_call_chain(trace_nodes, strategy=strategy, focus_index=focus_index)
    # =========================================================================
    # Context Slice API (CTX-05)
    # =========================================================================

    _slice_builder = None

    @property
    def slice_builder(self):
        """Lazy ContextSliceBuilder instance."""
        if self._slice_builder is None:
            from .context_slice import ContextSliceBuilder
            self._slice_builder = ContextSliceBuilder(self.store, self.ast, self.call)
        return self._slice_builder

    def get_context_slice(self, node: 'CPGNode', options=None) -> 'ContextSlice':
        """Return a structured ContextSlice for the given node (CTX-05).

        This is the new agent-first API that coexists with get_context_data().
        Returns a typed Pydantic model suitable for model_dump(mode='json').

        Args:
            node: Target CPG node to build context for
            options: SliceOptions instance (uses defaults if None)

        Returns:
            ContextSlice Pydantic model with all requested context dimensions.
        """
        from .context_slice import SliceOptions
        return self.slice_builder.build(node, options or SliceOptions())
