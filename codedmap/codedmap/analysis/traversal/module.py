# codedmap/analysis/traversal/module.py

from typing import Any, Dict, Iterator, List, Optional, Tuple, Union

from .base import BaseGraphNavigator
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.core.schema.graph.nodes import (
    ModuleNode, FileNode, MethodNode, ModuleMetrics
)
from codedmap.core.schema.graph.patch import GraphPatch
from codedmap.core.schema.tags.matcher import SecurityTagMatcher


class ModuleNavigator(BaseGraphNavigator):
    """Module-level graph navigator for file/method/submodule traversal and metric computation.

    Traversal:
      get_files(module)      -> Iterator[FileNode]   via Module -> CONTAINS -> FileNode
      get_methods(module)    -> Iterator[MethodNode] via Module -> CONTAINS -> File -> AST descendants -> METHOD
      get_submodules(module) -> Iterator[ModuleNode] via Module -> CONTAINS -> ModuleNode

    Metrics:
      get_metrics(module, compute=True)  -> freshly computed ModuleMetrics
      get_metrics(module, compute=False) -> cached ModuleMetrics from node fields, or None
      has_cached_metrics(module)         -> bool
    """

    def get_files(self, module: Union[ModuleNode, int]) -> Iterator[FileNode]:
        """Return FileNode instances directly contained in the module via CONTAINS edges."""
        module_id = self._ensure_node_id(module)
        return self.store.query.by_id(module_id).out(EdgeType.CONTAINS, target_class=FileNode)

    def get_methods(self, module: Union[ModuleNode, int]) -> Iterator[MethodNode]:
        """Return all MethodNode instances across all module files.

        Traversal path: Module -> CONTAINS -> File -> AST descendants -> METHOD
        Distinct() is applied to prevent duplicates from multi-path traversal.
        """
        module_id = self._ensure_node_id(module)
        return (
            self.store.query.by_id(module_id)
            .out(EdgeType.CONTAINS, target_class=FileNode)
            .descendants(target_label=NodeLabel.METHOD, max_depth=100)
            .distinct()
        )

    def get_submodules(self, module: Union[ModuleNode, int]) -> Iterator[ModuleNode]:
        """Return child ModuleNode instances via CONTAINS edges."""
        module_id = self._ensure_node_id(module)
        return self.store.query.by_id(module_id).out(EdgeType.CONTAINS, target_class=ModuleNode)

    def compute_metrics(
        self,
        module: Union[ModuleNode, int],
        cache: bool = True,
    ) -> ModuleMetrics:
        """Compute fresh metrics for a module. Optionally cache on ModuleNode via GraphPatch.

        Args:
            module: ModuleNode or its integer ID.
            cache:  If True, persist computed metrics to ModuleNode properties via GraphPatch.

        Returns:
            Freshly computed ModuleMetrics.
        """
        module_id = self._ensure_node_id(module)

        methods = list(self.get_methods(module_id))
        files = list(self.get_files(module_id))

        method_count = len(methods)
        file_count = len(files)

        entry_point_count = sum(
            1 for m in methods
            if any(
                SecurityTagMatcher.is_entry_point(t)
                for t in (getattr(m, 'tags', None) or [])
            )
        )
        sink_count = sum(
            1 for m in methods
            if any(
                SecurityTagMatcher.is_sink(t)
                for t in (getattr(m, 'tags', None) or [])
            )
        )
        density = entry_point_count / method_count if method_count > 0 else 0.0

        metrics = ModuleMetrics(
            entry_point_count=entry_point_count,
            method_count=method_count,
            sink_count=sink_count,
            density=density,
            file_count=file_count,
        )

        if cache:
            patch = GraphPatch(created_by="ModuleNavigator")
            patch.update_node(
                module_id,
                entry_point_count=entry_point_count,
                method_count=method_count,
                sink_count=sink_count,
                density=density,
                file_count=file_count,
            )
            self.store.apply_patch(patch)

        return metrics

    def get_metrics(
        self,
        module: Union[ModuleNode, int],
        compute: bool = False,
    ) -> Optional[ModuleMetrics]:
        """Compute or retrieve cached ModuleMetrics for the given module.

        Args:
            module:  ModuleNode or its integer ID.
            compute: If True, delegates to compute_metrics(cache=True).
                     If False, return cached values from node fields (or None if absent).

        Returns:
            ModuleMetrics if metrics are available, None otherwise.
        """
        if compute:
            return self.compute_metrics(module, cache=True)

        module_id = self._ensure_node_id(module)
        node = self.store.query.by_id(module_id).first()
        if node is not None and getattr(node, 'entry_point_count', None) is not None:
            return ModuleMetrics(
                entry_point_count=node.entry_point_count or 0,
                method_count=node.method_count or 0,
                sink_count=node.sink_count or 0,
                density=node.density or 0.0,
                file_count=node.file_count or 0,
            )
        return None

    def has_cached_metrics(self, module: Union[ModuleNode, int]) -> bool:
        """Return True if the module node has cached metric fields (entry_point_count is not None)."""
        node = self.store.query.by_id(self._ensure_node_id(module)).first()
        return node is not None and getattr(node, 'entry_point_count', None) is not None

    def get_file_assignments(self, module: Union[ModuleNode, int]) -> List[Tuple[FileNode, Dict[str, Any]]]:
        """Return list of (FileNode, edge_properties_dict) for files in module.

        Edge properties contain justification/confidence from cpg module assign.
        """
        module_id = self._ensure_node_id(module)
        files = list(self.get_files(module_id))
        result = []
        for f in files:
            props: Dict[str, Any] = {}
            try:
                edge = self.store.find_edge(module_id, f.id, EdgeType.CONTAINS.value)
                if edge and hasattr(edge, 'properties') and edge.properties:
                    props = dict(edge.properties)
            except Exception:
                pass  # graceful degradation — edge properties are optional
            result.append((f, props))
        return result

    def get_containing_modules(self, node: Union[Any, int]) -> List[Tuple[ModuleNode, Dict[str, Any]]]:
        """Return list of (ModuleNode, edge_properties) for modules containing the given node.

        Algorithm:
        1. Try direct: find modules with CONTAINS edge pointing to node_id.
        2. Fallback: find enclosing file, then find modules containing that file.
        3. If still empty (orphan), return [].
        For each module found, fetch edge properties (justification, confidence) via find_edge.
        """
        node_id = self._ensure_node_id(node)

        # Step 1: direct lookup — modules that CONTAINS this node
        direct_modules = self.store.query.by_id(node_id).in_(
            EdgeType.CONTAINS, target_class=ModuleNode
        ).to_list()

        if direct_modules:
            target_id = node_id
            modules = direct_modules
        else:
            # Step 2: fallback via enclosing file
            file_node = self.store.ast.get_enclosing_file(node_id)
            if file_node is None:
                return []
            modules = self.store.query.by_id(file_node.id).in_(
                EdgeType.CONTAINS, target_class=ModuleNode
            ).to_list()
            if not modules:
                return []
            target_id = file_node.id

        # Step 3: fetch edge properties for each module
        result = []
        for mod in modules:
            props: Dict[str, Any] = {}
            try:
                edge = self.store.find_edge(mod.id, target_id, EdgeType.CONTAINS.value)
                if edge is not None and hasattr(edge, "properties"):
                    props = dict(edge.properties or {})
            except Exception:
                pass
            result.append((mod, props))

        return result

    def get_dep_edges(self) -> List[Dict[str, Any]]:
        """Return global inter-module CALL edge aggregation.

        Returns list of {"from": src_name, "to": dst_name, "call_count": N}
        sorted by call_count descending.
        """
        all_modules = self.store.modules.find_all(limit=10000)
        if not all_modules:
            return []

        # Build method_id -> module_name index
        method_id_to_module: Dict[int, str] = {}
        for mod in all_modules:
            mod_name = getattr(mod, "name", str(mod.id))
            for method in self.get_methods(mod):
                if method.id is not None:
                    method_id_to_module[method.id] = mod_name

        # Count cross-module calls
        counts: Dict[Tuple[str, str], int] = {}
        for mod in all_modules:
            src_name = getattr(mod, "name", str(mod.id))
            for method in self.get_methods(mod):
                if method.id is None:
                    continue
                callees = self.store.query.by_id(method.id).out(EdgeType.CALL).to_list()
                for callee in callees:
                    callee_id = getattr(callee, "id", None)
                    if callee_id is None:
                        continue
                    dst_name = method_id_to_module.get(callee_id)
                    if dst_name and dst_name != src_name:
                        key = (src_name, dst_name)
                        counts[key] = counts.get(key, 0) + 1

        edges = [
            {"from": src, "to": dst, "call_count": cnt}
            for (src, dst), cnt in counts.items()
        ]
        edges.sort(key=lambda e: e["call_count"], reverse=True)
        return edges

    def get_focused_deps(self, module: Union[ModuleNode, int]) -> Dict[str, Any]:
        """Return focused dependency info for a single module.

        Returns:
            {
                "module": name,
                "depends_on": [{"name": str, "call_count": int, "sample_calls": [...]}],
                "depended_by": [{"name": str, "call_count": int, "sample_calls": [...]}],
            }
        """
        module_id = self._ensure_node_id(module)
        mod_node = self.store.query.by_id(module_id).first()
        mod_name = getattr(mod_node, "name", str(module_id)) if mod_node else str(module_id)

        all_modules = self.store.modules.find_all(limit=10000)

        # Build method_id -> (module_name, method_name) index
        method_id_to_info: Dict[int, Tuple[str, str]] = {}
        for m in all_modules:
            mname = getattr(m, "name", str(m.id))
            for method in self.get_methods(m):
                if method.id is not None:
                    method_id_to_info[method.id] = (mname, getattr(method, "name", str(method.id)))

        # Collect this module's method IDs and names
        this_methods = list(self.get_methods(module_id))
        this_method_ids = {m.id for m in this_methods if m.id is not None}
        this_method_names = {m.id: getattr(m, "name", str(m.id)) for m in this_methods if m.id is not None}

        # depends_on: outbound calls from this module to other modules
        depends_on_counts: Dict[str, int] = {}
        depends_on_samples: Dict[str, List[Dict]] = {}

        for method in this_methods:
            if method.id is None:
                continue
            caller_name = this_method_names.get(method.id, str(method.id))
            callees = self.store.query.by_id(method.id).out(EdgeType.CALL).to_list()
            for callee in callees:
                callee_id = getattr(callee, "id", None)
                if callee_id is None or callee_id in this_method_ids:
                    continue
                info = method_id_to_info.get(callee_id)
                if info is None:
                    continue
                dst_mod, callee_name = info
                if dst_mod == mod_name:
                    continue
                depends_on_counts[dst_mod] = depends_on_counts.get(dst_mod, 0) + 1
                samples = depends_on_samples.setdefault(dst_mod, [])
                if len(samples) < 3:
                    samples.append({"caller": caller_name, "callee": callee_name})

        # depended_by: inbound calls to this module from other modules
        depended_by_counts: Dict[str, int] = {}
        depended_by_samples: Dict[str, List[Dict]] = {}

        for method in this_methods:
            if method.id is None:
                continue
            callee_name = this_method_names.get(method.id, str(method.id))
            callers = self.store.query.by_id(method.id).in_(EdgeType.CALL).to_list()
            for caller in callers:
                caller_id = getattr(caller, "id", None)
                if caller_id is None or caller_id in this_method_ids:
                    continue
                info = method_id_to_info.get(caller_id)
                if info is None:
                    continue
                src_mod, caller_name = info
                if src_mod == mod_name:
                    continue
                depended_by_counts[src_mod] = depended_by_counts.get(src_mod, 0) + 1
                samples = depended_by_samples.setdefault(src_mod, [])
                if len(samples) < 3:
                    samples.append({"caller": caller_name, "callee": callee_name})

        depends_on = [
            {"name": name, "call_count": cnt, "sample_calls": depends_on_samples.get(name, [])}
            for name, cnt in sorted(depends_on_counts.items(), key=lambda x: -x[1])
        ]
        depended_by = [
            {"name": name, "call_count": cnt, "sample_calls": depended_by_samples.get(name, [])}
            for name, cnt in sorted(depended_by_counts.items(), key=lambda x: -x[1])
        ]

        return {"module": mod_name, "depends_on": depends_on, "depended_by": depended_by}

    def get_fan_in(self, module: Union[ModuleNode, int]) -> int:
        """Count distinct caller files outside this module (direct CALL edges only).

        Fan-in measures external interest in a module — a key attack surface signal.
        Only direct (non-transitive) CALL edges are considered.

        Returns:
            Number of distinct external files containing callers of module methods.
        """
        module_id = self._ensure_node_id(module)

        # Collect this module's file IDs for exclusion
        module_file_ids: set = {f.id for f in self.get_files(module_id)}

        # Collect all method IDs in module
        method_ids = [m.id for m in self.get_methods(module_id) if m.id is not None]
        if not method_ids:
            return 0

        # For each method, find inbound CALL edges -> walk up to FILE -> exclude module files
        caller_file_ids: set = set()
        for method_id in method_ids:
            caller_files = (
                self.store.query.by_id(method_id)
                .in_(EdgeType.CALL)
                .file()
                .distinct()
            )
            for f in caller_files:
                if f.id not in module_file_ids:
                    caller_file_ids.add(f.id)

        return len(caller_file_ids)
