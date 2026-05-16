# codedmap/analysis/detection/sink_detector.py
"""
SinkDetector - Batch detection engine for dangerous sink function discovery.

Key difference from SourceDetector:
- SinkDetector: one result per ENCLOSING METHOD, with CALL matches grouped as triggers
  - Multiple CALL matches within the same METHOD -> single Sink with multiple triggers
  - Each trigger = {"node": call_node_as_dict, "sink_name": sink_def.name}
  - NO taint_target field (SinkDefinition has no taints/patterns)

Detection approach:
1. Build name index from catalog.sinks (flat list of SinkDefinition, each with single .name)
2. Fetch CALL nodes by exact name match via batch query API
3. Language filter via _batch_get_node_languages() + sink_def.matches_language()
4. Batch-resolve parent METHOD via AstContextNavigator
5. Assemble Sink objects grouped by METHOD node_id (Smart Wrapper pattern)

Usage:
    detector = SinkDetector(store)
    sinks = detector.detect_all()
    for sink in sinks:
        print(f"{sink.name} at {sink.file}:{sink.line} [{sink.category.value}]")
        for trigger in sink.triggers:
            print(f"  -> {trigger['node']['code']} (sink: {trigger['sink_name']})")
"""

import logging
from typing import Dict, List, Optional, Any, Set, Tuple

from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.ast import AstContextNavigator

from codedmap.core.schema.security.sink_models import Sink, SinkCategory
from codedmap.core.schema.security.sink_catalog import SinkCatalog
from codedmap.core.schema.security.sink_models import SinkDefinition

logger = logging.getLogger(__name__)


class SinkDetector:
    """
    Detects dangerous sink call sites in a CPG using catalog-driven name matching.

    Unlike SourceDetector (which uses pattern rules with taints), SinkDetector
    matches CALL nodes by exact function name against SinkCatalog.sinks.

    Groups all matching CALL nodes by their enclosing METHOD. One Sink per METHOD.
    """

    def __init__(
        self,
        store: CPGStore,
        config: Optional[Any] = None,
        catalog: Optional[SinkCatalog] = None,
    ):
        self.store = store
        self.config = config
        self.catalog = catalog or SinkCatalog.load_default()
        self._ast = AstContextNavigator(store)

    def _batch_get_node_languages(self, node_ids: List[int]) -> Dict[int, Optional[str]]:
        """
        Batch get languages for multiple nodes via enclosing FILE nodes.

        Args:
            node_ids: List of node IDs to resolve

        Returns:
            Dict mapping node_id -> language string (or None)
        """
        if not node_ids:
            return {}

        file_map = self._ast.batch_get_enclosing_files(node_ids)

        result: Dict[int, Optional[str]] = {}
        for node_id, file_node in file_map.items():
            if file_node and hasattr(file_node, 'language') and file_node.language:
                lang = file_node.language
                result[node_id] = lang.lower() if isinstance(lang, str) else lang.value.lower()
            else:
                result[node_id] = None

        return result

    # =========================================================================
    # Public API
    # =========================================================================

    def detect_all(self) -> List[Sink]:
        """
        Detect all dangerous sink call sites.

        Returns Sink objects grouped by enclosing METHOD (Smart Wrapper pattern).
        Multiple CALL matches in the same METHOD are collapsed into one Sink
        with multiple trigger entries.
        """
        return self._batch_detect()

    def detect_by_category(self, category: SinkCategory) -> List[Sink]:
        """Detect sinks of a specific category."""
        return [s for s in self.detect_all() if s.category == category]

    # =========================================================================
    # Batch Detection
    # =========================================================================

    def _batch_detect(self) -> List[Sink]:
        """
        Batch detection using abstract storage APIs.

        Phase 1: Build name index from catalog.sinks (flat list, each with single .name)
        Phase 2: Fetch CALL nodes by exact name match
        Phase 3: Language filter via sink_def.matches_language()
        Phase 4: Batch-resolve parent METHOD via AstContextNavigator
        Phase 5: Assemble Sink objects (with trigger deduplication)
        """
        # Phase 1: Build reverse index — name -> SinkDefinition
        call_exact: Dict[str, SinkDefinition] = {}
        for sink_def in self.catalog.sinks:
            call_exact[sink_def.name] = sink_def

        if not call_exact:
            return []

        # Phase 2: Fetch matching CALL nodes
        matched: List[Tuple[Dict, SinkDefinition]] = self._fetch_call_nodes_exact(call_exact)

        if not matched:
            return []

        # Phase 3: Language filtering
        node_ids = [n.get("id") for n, _ in matched if n.get("id") is not None]
        language_map = self._batch_get_node_languages(node_ids)

        seen_pairs: Set[Tuple[int, str]] = set()
        deduped: List[Tuple[Dict, SinkDefinition]] = []
        for node_dict, sink_def in matched:
            nid = node_dict.get("id")
            if nid is None:
                continue
            node_language = language_map.get(nid)
            if node_language and not sink_def.matches_language(node_language):
                continue
            pair = (nid, sink_def.name)
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                deduped.append((node_dict, sink_def))

        if not deduped:
            return []

        # Phase 4: Batch-resolve enclosing METHOD for each CALL node
        all_node_ids = list({nd.get("id") for nd, _ in deduped if nd.get("id") is not None})
        method_map = self._batch_resolve_methods(all_node_ids)

        # Phase 5: Assemble Sink objects grouped by METHOD node_id
        results: Dict[int, Sink] = {}

        for node_dict, sink_def in deduped:
            nid = node_dict.get("id")
            method_dict = method_map.get(nid)
            if method_dict is None:
                continue

            method_id = method_dict.get("id")
            if method_id is None:
                continue

            trigger = {
                "node": {
                    "id": nid,
                    "label": node_dict.get("label", "CALL"),
                    "code": node_dict.get("code", "") or "",
                    "name": node_dict.get("name", "") or "",
                },
                "sink_name": sink_def.name,
            }

            if method_id in results:
                existing_keys = {
                    (t["node"]["id"], t["sink_name"])
                    for t in results[method_id].triggers
                }
                trigger_key = (nid, sink_def.name)
                if trigger_key not in existing_keys:
                    results[method_id].triggers.append(trigger)
            else:
                results[method_id] = Sink(
                    node_id=method_id,
                    name=method_dict.get("name", "") or "",
                    file=method_dict.get("fileName", "") or method_dict.get("file_name", "") or "",
                    line=method_dict.get("lineNumber", 0) or method_dict.get("line_number", 0) or 0,
                    category=sink_def.category,
                    sink_name=sink_def.name,
                    tags=[],
                    triggers=[trigger],
                )

        return list(results.values())

    def _fetch_call_nodes_exact(
        self, call_exact: Dict[str, SinkDefinition]
    ) -> List[Tuple[Dict, SinkDefinition]]:
        """
        Fetch CALL nodes by exact name match using batch query API.
        """
        names = list(call_exact.keys())
        results = []

        try:
            for node_dict in self.store.query.all_nodes_in("CALL", "name", names).raw():
                name = node_dict.get("name", "")
                if name in call_exact:
                    results.append((node_dict, call_exact[name]))
        except Exception as exc:
            logger.debug(f"Error in batch call query: {exc}")

        return results

    def _batch_resolve_methods(self, node_ids: List[int]) -> Dict[int, Optional[Dict]]:
        """
        Batch-resolve the enclosing METHOD for each node_id.

        Uses AstContextNavigator.batch_get_enclosing_methods() for efficient
        batch ancestor resolution.
        """
        if not node_ids:
            return {}

        method_nodes = self._ast.batch_get_enclosing_methods(node_ids)

        result: Dict[int, Optional[Dict]] = {}
        for node_id, method_node in method_nodes.items():
            if method_node is not None:
                result[node_id] = {
                    "id": getattr(method_node, "id", None),
                    "name": getattr(method_node, "name", "") or "",
                    "fileName": getattr(method_node, "fileName", "") or getattr(method_node, "file_name", "") or "",
                    "lineNumber": getattr(method_node, "lineNumber", 0) or getattr(method_node, "line_number", 0) or 0,
                    "label": "METHOD",
                }

        return result
