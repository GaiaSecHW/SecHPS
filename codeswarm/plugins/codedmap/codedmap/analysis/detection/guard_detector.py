# codedmap/analysis/detection/guard_detector.py
"""
GuardDetector - Batch detection engine for guard (defensive check) discovery.

Mirrors SourceDetector's five-phase batch detection with dual call+identifier
pattern matching. One Guard result per enclosing METHOD.

Each trigger = {"node": node_dict, "guard_name": rule.name, "condition": code}

Usage:
    detector = GuardDetector(store)
    guards = detector.detect_all()
    for guard in guards:
        print(f"{guard.name} at {guard.file}:{guard.line} [{guard.category.value}]")
        for trigger in guard.triggers:
            print(f"  -> {trigger['node']['code']} (guard: {trigger['guard_name']})")
"""

import logging
from typing import Dict, List, Optional, Any, Set, Tuple

from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.ast import AstContextNavigator

from codedmap.core.schema.security.guard_models import Guard, GuardCategory, GuardRule
from codedmap.core.schema.security.guard_catalog import GuardCatalog

logger = logging.getLogger(__name__)


class GuardDetector:
    """
    Detects guard (defensive check) call sites in a CPG using catalog-driven
    dual call+identifier pattern matching.

    Groups all matching nodes by their enclosing METHOD. One Guard per METHOD.

    Detection approach:
    1. Build reverse index from catalog patterns (call_exact + ident_exact)
    2. Fetch CALL and IDENTIFIER nodes via batch query APIs
    3. Language filter via enclosing FILE node language
    4. Batch-resolve parent METHOD via AstContextNavigator
    5. Assemble Guard objects grouped by METHOD node_id
    """

    def __init__(
        self,
        store: CPGStore,
        config: Optional[Any] = None,
        catalog: Optional[GuardCatalog] = None,
    ):
        self.store = store
        self.config = config
        self.catalog = catalog or GuardCatalog.load_default()
        self._ast = AstContextNavigator(store)

    def _batch_get_node_languages(self, node_ids: List[int]) -> Dict[int, Optional[str]]:
        """Batch get languages for multiple nodes via enclosing FILE nodes."""
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

    def detect_all(self) -> List[Guard]:
        """
        Detect all guard call sites.

        Returns Guard objects grouped by enclosing METHOD.
        Multiple matches within the same METHOD are collapsed into one Guard
        with multiple trigger entries.
        """
        return self._batch_detect()

    def detect_by_category(self, category: GuardCategory) -> List[Guard]:
        """Detect guards of a specific category."""
        return [g for g in self.detect_all() if g.category == category]

    # =========================================================================
    # Batch Detection
    # =========================================================================

    def _batch_detect(self) -> List[Guard]:
        """
        Five-phase batch detection.

        Phase 1: Build reverse index from catalog patterns
        Phase 2: Fetch matching CALL and IDENTIFIER nodes
        Phase 3: Language filter
        Phase 4: Batch-resolve parent METHOD
        Phase 5: Assemble Guard objects with trigger deduplication
        """
        # Phase 1: Build reverse index
        # GuardRule.patterns is List[dict] — raw dicts, not typed objects
        call_exact: Dict[str, List[Tuple[GuardRule, dict]]] = {}
        ident_exact: Dict[str, List[Tuple[GuardRule, dict]]] = {}

        for rule in self.catalog.rules:
            for pattern in rule.patterns:
                ptype = pattern.get("type")
                if ptype == "call":
                    fname = pattern.get("function")
                    if fname:
                        call_exact.setdefault(fname, []).append((rule, pattern))
                elif ptype == "identifier":
                    iname = pattern.get("name")
                    if iname:
                        ident_exact.setdefault(iname, []).append((rule, pattern))

        matched: List[Tuple[Dict, List[Tuple[GuardRule, dict]]]] = []

        if call_exact:
            matched.extend(self._fetch_call_nodes_exact(call_exact))

        if ident_exact:
            matched.extend(self._fetch_identifier_nodes(ident_exact))

        if not matched:
            return []

        # Phase 3: Language filter + dedup
        node_ids = [n.get("id") for n, _ in matched if n.get("id") is not None]
        language_map = self._batch_get_node_languages(node_ids)

        seen_pairs: Set[Tuple[int, str]] = set()
        deduped: List[Tuple[Dict, GuardRule, dict]] = []
        for node_dict, rp_list in matched:
            nid = node_dict.get("id")
            if nid is None:
                continue
            node_language = language_map.get(nid)
            for rule, pattern in rp_list:
                if node_language and not (node_language in [l.lower() for l in rule.languages]):
                    continue
                pair = (nid, rule.name)
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    deduped.append((node_dict, rule, pattern))

        if not deduped:
            return []

        # Phase 4: Batch-resolve enclosing METHOD
        all_node_ids = list({nd.get("id") for nd, _, _ in deduped if nd.get("id") is not None})
        method_map = self._batch_resolve_methods(all_node_ids)

        # Phase 5: Assemble Guard objects grouped by METHOD node_id
        results: Dict[int, Guard] = {}

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
                "guard_name": rule.name,
                "condition": node_dict.get("code", "") or "",
            }

            if method_id in results:
                existing_keys = {
                    (t["node"]["id"], t["guard_name"])
                    for t in results[method_id].triggers
                }
                if (nid, rule.name) not in existing_keys:
                    results[method_id].triggers.append(trigger)
            else:
                guard = Guard(
                    node_id=method_id,
                    name=method_dict.get("name", "") or "",
                    file=method_dict.get("fileName", "") or method_dict.get("file_name", "") or "",
                    line=method_dict.get("lineNumber", 0) or method_dict.get("line_number", 0) or 0,
                    category=rule.category,
                    rule_id=rule.name,
                    tags=[],
                    condition=None,
                    triggers=[trigger],
                )
                results[method_id] = guard

        return list(results.values())

    def _fetch_call_nodes_exact(
        self, call_exact: Dict[str, List[Tuple[GuardRule, dict]]]
    ) -> List[Tuple[Dict, List[Tuple[GuardRule, dict]]]]:
        """Fetch CALL nodes by exact name match using batch query API."""
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

    def _fetch_identifier_nodes(
        self, ident_exact: Dict[str, List[Tuple[GuardRule, dict]]]
    ) -> List[Tuple[Dict, List[Tuple[GuardRule, dict]]]]:
        """Fetch IDENTIFIER nodes by exact name match using batch query API."""
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
        """Batch-resolve the enclosing METHOD for each node_id."""
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
