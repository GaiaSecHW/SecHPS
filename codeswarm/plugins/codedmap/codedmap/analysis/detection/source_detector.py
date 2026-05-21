# codedmap/analysis/detection/source_detector.py
"""
SourceDetector - Smart Wrapper detection engine for taint source discovery.

Key difference from EntryPointDetector:
- EntryPointDetector: one result per CALL or METHOD node matched
- SourceDetector: one result per ENCLOSING METHOD, with CALL matches grouped as triggers
  - Multiple CALL matches within the same METHOD -> single Source with multiple triggers
  - Each trigger = {"node": call_node_as_dict, "taint_target": pattern.taints}

Performance:
- Batch queries: uses all_nodes_in() and all_nodes_containing_any() for efficient
  batch property matching instead of per-pattern queries
- Batch parent resolution: uses AstContextNavigator.batch_get_enclosing_methods()
  for efficient ancestor resolution

Usage:
    detector = SourceDetector(store)
    sources = detector.detect_all()
    for src in sources:
        print(f"{src.name} at {src.file}:{src.line} [{src.category.value}]")
        for trigger in src.triggers:
            print(f"  -> {trigger['node']['code']} (taint: {trigger['taint_target']})")
"""

import logging
from typing import Dict, List, Optional, Any, Set, Tuple

from codedmap.core.schema.graph.base import CPGNode
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.ast import AstContextNavigator

from codedmap.core.schema.security.source_models import Source, SourceCategory
from codedmap.core.schema.security.source_catalog import SourceCatalog
from codedmap.core.schema.security.source_rules import SourceRule, SourcePattern

logger = logging.getLogger(__name__)


class SourceDetector:
    """
    Detects taint source call sites in a CPG using catalog-driven pattern matching.

    Unlike EntryPointDetector (one result per CALL/METHOD match), SourceDetector
    groups all matching CALL nodes by their enclosing METHOD. One Source per METHOD.

    Detection approach:
    1. Collect all call/identifier pattern names from catalog upfront
    2. Use batch query APIs (all_nodes_in, all_nodes_containing_any)
    3. Batch-resolve parent METHOD via AstContextNavigator
    4. Assemble Source objects grouped by METHOD node_id
    """

    def __init__(
        self,
        store: CPGStore,
        config: Optional[Any] = None,
        catalog: Optional[SourceCatalog] = None,
    ):
        self.store = store
        self.config = config
        self.catalog = catalog or SourceCatalog.load_default()
        self._ast = AstContextNavigator(store)

    def _batch_get_node_languages(self, node_ids: List[int]) -> Dict[int, Optional[str]]:
        """
        Batch get languages for multiple nodes.

        Uses batch_find_ancestor to efficiently resolve FILE nodes,
        then extracts language from each FILE node.

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

    def detect_all(self) -> List[Source]:
        """
        Detect all taint source call sites.

        Returns Source objects grouped by enclosing METHOD (Smart Wrapper pattern).
        Multiple CALL matches in the same METHOD are collapsed into one Source
        with multiple trigger entries.
        """
        return self._batch_detect()

    def detect_by_category(self, category: SourceCategory) -> List[Source]:
        """Detect sources of a specific category."""
        return [s for s in self.detect_all() if s.category == category]

    # =========================================================================
    # Batch Detection (Unified Path)
    # =========================================================================

    def _batch_detect(self) -> List[Source]:
        """
        Batch detection using abstract storage APIs.

        Phase 1: Build reverse index from catalog patterns
        Phase 2: Fetch matching nodes using batch query APIs
        Phase 3: Batch-resolve parent METHOD via AstContextNavigator
        Phase 4: Assemble Source objects (with trigger deduplication)
        """
        call_exact: Dict[str, List[Tuple[SourceRule, SourcePattern]]] = {}
        ident_exact: Dict[str, List[Tuple[SourceRule, SourcePattern]]] = {}

        for rule in self.catalog.rules:
            for pattern in rule.patterns:
                if pattern.type == "call" and pattern.function:
                    call_exact.setdefault(pattern.function, []).append((rule, pattern))
                elif pattern.type == "identifier" and pattern.name:
                    ident_exact.setdefault(pattern.name, []).append((rule, pattern))

        matched: List[Tuple[Dict, List[Tuple[SourceRule, SourcePattern]]]] = []

        if call_exact:
            matched.extend(self._fetch_call_nodes_exact(call_exact))

        if ident_exact:
            matched.extend(self._fetch_identifier_nodes(ident_exact))

        if not matched:
            return []

        node_ids = [n.get("id") for n, _ in matched if n.get("id") is not None]
        language_map = self._batch_get_node_languages(node_ids)

        seen_pairs: Set[Tuple[int, str, str]] = set()
        deduped: List[Tuple[Dict, SourceRule, SourcePattern]] = []
        for node_dict, rp_list in matched:
            nid = node_dict.get("id")
            if nid is None:
                continue
            node_language = language_map.get(nid)
            for rule, pattern in rp_list:
                if node_language and not rule.matches_language(node_language):
                    continue
                pair = (nid, rule.name, pattern.taints)
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    deduped.append((node_dict, rule, pattern))

        all_node_ids = list({nd.get("id") for nd, _, _ in deduped if nd.get("id") is not None})
        method_map = self._batch_resolve_methods(all_node_ids)

        results: Dict[int, Source] = {}

        for node_dict, rule, pattern in deduped:
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
                "taint_target": pattern.taints,
            }

            if method_id in results:
                existing_keys = {
                    (t["node"]["id"], t["taint_target"])
                    for t in results[method_id].triggers
                }
                trigger_key = (nid, pattern.taints)
                if trigger_key not in existing_keys:
                    results[method_id].triggers.append(trigger)
            else:
                results[method_id] = Source(
                    node_id=method_id,
                    name=method_dict.get("name", "") or "",
                    file=method_dict.get("fileName", "") or method_dict.get("file_name", "") or "",
                    line=method_dict.get("lineNumber", 0) or method_dict.get("line_number", 0) or 0,
                    category=rule.category,
                    rule_name=rule.name,
                    tags=[],
                    triggers=[trigger],
                    origin=getattr(rule, "origin", None),
                )

        return list(results.values())

    def _fetch_call_nodes_exact(
        self, call_exact: Dict[str, List[Tuple[SourceRule, SourcePattern]]]
    ) -> List[Tuple[Dict, List[Tuple[SourceRule, SourcePattern]]]]:
        """
        Fetch CALL nodes by exact name match using batch query API.
        Two-phase matching: Fast Path (exact name) + Precision Path (fullname regex).
        """
        names = list(call_exact.keys())
        results = []

        try:
            for node_dict in self.store.query.all_nodes_in("CALL", "name", names).raw():
                name = node_dict.get("name", "")
                if name not in call_exact:
                    continue

                for rule, pattern in call_exact[name]:
                    if pattern.matches_fullname(node_dict.get("methodFullName", "") or ""):
                        results.append((node_dict, [(rule, pattern)]))
        except Exception as exc:
            logger.debug(f"Error in batch call query: {exc}")

        return results

    def _fetch_identifier_nodes(
        self, ident_exact: Dict[str, List[Tuple[SourceRule, SourcePattern]]]
    ) -> List[Tuple[Dict, List[Tuple[SourceRule, SourcePattern]]]]:
        """
        Fetch IDENTIFIER nodes by exact name match using batch query API.
        """
        names = list(ident_exact.keys())
        results = []

        try:
            for node_dict in self.store.query.all_nodes_in("IDENTIFIER", "name", names).raw():
                name = node_dict.get("name", "")
                if name in ident_exact:
                    results.append((node_dict, ident_exact[name]))
        except Exception as exc:
            logger.debug(f"Error in batch identifier query: {exc}")

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
