# codedmap/analysis/detection/entrypoint_detector.py
"""
EntryPointDetector - Core detection engine for entry point discovery.

Canonical location (moved from app/entrypoints/detector.py).
Performs L1 (raw pattern-based) and L2 (wrapped handler) detection
using the EntryPointCatalog rules.

Performance:
- Batch queries: uses all_nodes_in() and all_nodes_containing_any() for efficient
  batch property matching instead of per-pattern queries
- Batch parent resolution: uses AstContextNavigator.batch_get_enclosing_methods()
  for efficient ancestor resolution
"""

import logging
import re
from typing import List, Optional, Set, Any, Dict, Tuple

from codedmap.core.schema.graph.base import CPGNode
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.ast import AstContextNavigator

from codedmap.core.schema.security import (
    EntryPoint, EntryPointLevel, EntryPointCategory,
    EntryPointRule, RulePattern,
    EntryPointCatalog,
)

logger = logging.getLogger(__name__)


class EntryPointDetector:
    """
    Detects entry points in a CPG using pattern matching and call graph analysis.

    Detection Levels:
    - L1 (Raw): Direct pattern match from catalog rules
    - L2 (Wrapped): Entry point traced to wrapper function via call graph

    Usage:
        detector = EntryPointDetector(store)
        entry_points = detector.detect_all()
        for ep in entry_points:
            print(f"{ep.name} at {ep.file}:{ep.line} [{ep.level.value}]")
    """

    def __init__(self, store: CPGStore, config: Optional[Any] = None, catalog: Optional[EntryPointCatalog] = None):
        """
        Initialize the detector.

        Args:
            store: CPGStore instance for graph queries
            config: Optional configuration object with entry_point_trace_depth setting
            catalog: Optional pre-built EntryPointCatalog (e.g., from RuleRegistry).
                     If None, loads default catalog from YAML.
        """
        self.store = store
        self.config = config
        self.catalog = catalog or EntryPointCatalog.load_default()
        self._ast = AstContextNavigator(store)
        self._max_trace_depth = (
            getattr(config, 'entry_point_trace_depth', 10)
            if config else 10
        )
        self._wrapper_patterns = [
            'handle_', 'process_', 'on_', 'callback_', 'handler_',
            'recv_', 'receive_', 'dispatch_', 'event_', 'request_'
        ]

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

    def detect_all(self) -> List[EntryPoint]:
        """
        Detect all entry points (L1 + L2).

        Returns:
            List of EntryPoint objects with duplicates removed.
        """
        logger.info("Starting entry point detection...")
        l1_points = self._detect_l1()
        logger.info(f"Found {len(l1_points)} L1 entry points")

        l2_points = self._trace_l2(l1_points)
        logger.info(f"Found {len(l2_points)} L2 entry points")

        all_points = self._deduplicate(l1_points + l2_points)
        logger.info(f"Total unique entry points: {len(all_points)}")
        return all_points

    def detect_by_category(self, category: EntryPointCategory) -> List[EntryPoint]:
        """
        Detect entry points of a specific category.

        Args:
            category: Entry point category to filter by

        Returns:
            List of EntryPoint objects matching the category.
        """
        all_points = self.detect_all()
        return [ep for ep in all_points if ep.category == category]

    def detect_by_level(self, level: EntryPointLevel) -> List[EntryPoint]:
        """
        Detect entry points of a specific level.

        Args:
            level: Entry point level to filter by (L1, L2, or L3)

        Returns:
            List of EntryPoint objects matching the level.
        """
        all_points = self.detect_all()
        return [ep for ep in all_points if ep.level == level]

    # =========================================================================
    # L1 Detection (Pattern Matching) - Batch Optimized
    # =========================================================================

    def _detect_l1(self) -> List[EntryPoint]:
        """
        Perform L1 (raw) pattern-based detection using batch queries.

        Builds reverse indexes from catalog patterns and issues batch queries
        instead of per-pattern iteration.
        """
        call_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]] = {}
        method_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]] = {}
        ident_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]] = {}

        for rule in self.catalog.rules:
            for pattern in rule.patterns:
                if pattern.type == "call" and pattern.function:
                    call_exact.setdefault(pattern.function, []).append((rule, pattern))
                elif pattern.type == "method" and pattern.name:
                    method_exact.setdefault(pattern.name, []).append((rule, pattern))
                elif pattern.type == "identifier" and pattern.name:
                    ident_exact.setdefault(pattern.name, []).append((rule, pattern))

        matched: List[Tuple[Dict, List[Tuple[EntryPointRule, RulePattern]]]] = []

        if call_exact:
            matched.extend(self._fetch_call_nodes_exact(call_exact))

        if method_exact:
            matched.extend(self._fetch_method_nodes(method_exact))

        if ident_exact:
            matched.extend(self._fetch_identifier_nodes(ident_exact))

        if not matched:
            return []

        node_ids = [n.get("id") for n, _ in matched if n.get("id") is not None]
        language_map = self._batch_get_node_languages(node_ids)

        seen_pairs: Set[Tuple[int, str, str]] = set()
        results: List[EntryPoint] = []

        for node_dict, rp_list in matched:
            nid = node_dict.get("id")
            if nid is None:
                continue

            node_language = language_map.get(nid)

            for rule, pattern in rp_list:
                pkey = pattern.function or pattern.name or ""
                pair = (nid, rule.name, pkey)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                if node_language and not rule.matches_language(node_language):
                    continue

                if pattern.code_pattern:
                    code = node_dict.get("code", "") or ""
                    if not self._matches_code_pattern(code, pattern.code_pattern):
                        continue

                ep = self._create_entry_point_from_dict(
                    node_dict=node_dict,
                    level=EntryPointLevel.L1,
                    category=rule.category,
                    rule_name=rule.name,
                    protocol=getattr(rule, "protocol", None),
                )
                if ep:
                    results.append(ep)

        return results

    def _fetch_call_nodes_exact(
        self, call_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]]
    ) -> List[Tuple[Dict, List[Tuple[EntryPointRule, RulePattern]]]]:
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

    def _fetch_method_nodes(
        self, method_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]]
    ) -> List[Tuple[Dict, List[Tuple[EntryPointRule, RulePattern]]]]:
        """
        Fetch METHOD nodes by exact name match using batch query API.
        """
        names = list(method_exact.keys())
        results = []

        try:
            for node_dict in self.store.query.all_nodes_in("METHOD", "name", names).raw():
                name = node_dict.get("name", "")
                if name in method_exact:
                    results.append((node_dict, method_exact[name]))
        except Exception as exc:
            logger.debug(f"Error in batch method query: {exc}")

        return results

    def _fetch_identifier_nodes(
        self, ident_exact: Dict[str, List[Tuple[EntryPointRule, RulePattern]]]
    ) -> List[Tuple[Dict, List[Tuple[EntryPointRule, RulePattern]]]]:
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

    # =========================================================================
    # L2 Detection (Call Graph Tracing)
    # =========================================================================

    def _trace_l2(self, l1_points: List[EntryPoint]) -> List[EntryPoint]:
        """
        Trace L1 entry points to their wrapper functions.

        Uses call graph analysis to find functions that call the L1 entry points
        and match wrapper naming patterns.

        Args:
            l1_points: List of L1 entry points to trace

        Returns:
            List of L2 entry points (wrapper functions).
        """
        if not l1_points:
            return []

        results = []
        seen_wrappers: Set[int] = set()

        l1_node_ids = [ep.node_id for ep in l1_points]
        l1_nodes = list(self.store.query.by_ids(l1_node_ids).to_list())
        l1_node_map = {n.id: (n, ep) for n, ep in zip(l1_nodes, l1_points) if n}

        for node_id, (node, l1) in l1_node_map.items():
            wrapper = self._find_wrapper(node, l1)
            if wrapper and wrapper.id not in seen_wrappers:
                seen_wrappers.add(wrapper.id)
                ep = self._create_entry_point(
                    node=wrapper,
                    level=EntryPointLevel.L2,
                    category=l1.category,
                    rule_name=f"wrapper:{l1.rule_name}"
                )
                if ep:
                    results.append(ep)

        return results

    def _find_wrapper(self, node: CPGNode, l1: EntryPoint) -> Optional[CPGNode]:
        """
        Find the L2 wrapper for an L1 entry point.

        Traces the call chain backward from the L1 entry point to find
        a function that matches wrapper naming patterns.

        Args:
            node: The L1 entry point node (already fetched)
            l1: L1 EntryPoint for context

        Returns:
            CPGNode of the wrapper function, or None if not found.
        """
        visited: Set[int] = set()
        queue = [(node, 0)]

        while queue:
            current, depth = queue.pop(0)
            current_id = getattr(current, 'id', None)
            if current_id is None:
                continue

            if depth >= self._max_trace_depth:
                continue

            if current_id in visited:
                continue
            visited.add(current_id)

            callers = self._get_callers(current)

            if not callers:
                if self._is_wrapper_pattern(current):
                    return current
                continue

            for caller in callers:
                caller_id = getattr(caller, 'id', None)
                if caller_id is not None and caller_id not in visited:
                    queue.append((caller, depth + 1))

        return None

    def _get_callers(self, node: CPGNode) -> List[CPGNode]:
        """
        Get all functions that call this node.

        Uses incoming CALL edges to find callers.

        Args:
            node: CPGNode to find callers for

        Returns:
            List of caller METHOD nodes.
        """
        node_id = getattr(node, 'id', None)
        if node_id is None:
            return []

        try:
            caller_ids = self.store.get_neighbors(
                node_id,
                direction="IN",
                edge_types=["CALL"]
            )

            if not caller_ids:
                return []

            caller_ids = list(set(caller_ids))

            call_nodes = list(self.store.query.by_ids(caller_ids).to_list())
            call_node_ids = [n.id for n in call_nodes]

            method_map = self._ast.batch_get_enclosing_methods(call_node_ids)

            callers = []
            seen_caller_ids: Set[int] = set()
            for call_node in call_nodes:
                method_node = method_map.get(call_node.id)
                if method_node is not None and method_node.id not in seen_caller_ids:
                    seen_caller_ids.add(method_node.id)
                    callers.append(method_node)

            return callers
        except Exception as e:
            logger.debug(f"Error getting callers for node {node_id}: {e}")
            return []

    def _is_wrapper_pattern(self, node: CPGNode) -> bool:
        """
        Check if node matches wrapper naming patterns.

        Wrapper patterns: handle_*, process_*, on_*, callback_*, etc.

        Args:
            node: CPGNode to check

        Returns:
            True if node matches wrapper pattern.
        """
        name = getattr(node, 'name', '')
        if not name:
            return False

        name_lower = name.lower()

        for pattern in self._wrapper_patterns:
            if name_lower.startswith(pattern) or f"_{pattern}" in name_lower:
                return True

        return False

    # =========================================================================
    # Deduplication
    # =========================================================================

    def _deduplicate(self, points: List[EntryPoint]) -> List[EntryPoint]:
        """
        Remove duplicate entry points, preferring higher levels.

        If the same node_id appears multiple times, the entry point with
        the higher level (L3 > L2 > L1) is kept.

        Args:
            points: List of EntryPoint objects with potential duplicates

        Returns:
            Deduplicated list of EntryPoint objects.
        """
        seen: dict = {}

        for ep in points:
            existing = seen.get(ep.node_id)
            if existing is None:
                seen[ep.node_id] = ep
            elif ep.level.value > existing.level.value:
                seen[ep.node_id] = ep

        return list(seen.values())

    # =========================================================================
    # Helper Methods
    # =========================================================================

    def _create_entry_point(
        self,
        node: CPGNode,
        level: EntryPointLevel,
        category: EntryPointCategory,
        rule_name: str
    ) -> Optional[EntryPoint]:
        """
        Create an EntryPoint from a CPGNode.

        Args:
            node: CPGNode to create entry point for
            level: Detection level (L1, L2, L3)
            category: Entry point category
            rule_name: Name of the rule that matched

        Returns:
            EntryPoint object, or None if node is invalid.
        """
        node_id = getattr(node, 'id', None)
        if node_id is None:
            return None

        name = getattr(node, 'name', '')
        file_name = getattr(node, 'fileName', '') or getattr(node, 'file_name', '')
        line_number = getattr(node, 'lineNumber', 0) or getattr(node, 'line_number', 0)

        return EntryPoint(
            node_id=node_id,
            name=name,
            file=file_name,
            line=line_number,
            level=level,
            category=category,
            rule_name=rule_name
        )

    def _create_entry_point_from_dict(
        self,
        node_dict: Dict,
        level: EntryPointLevel,
        category: EntryPointCategory,
        rule_name: str,
        protocol: Optional[str] = None,
    ) -> Optional[EntryPoint]:
        """
        Create an EntryPoint from a node dictionary.

        Args:
            node_dict: Node dictionary with id, name, etc.
            level: Detection level (L1, L2, L3)
            category: Entry point category
            rule_name: Name of the rule that matched
            protocol: Optional protocol string from rule (e.g. "http", "websocket")

        Returns:
            EntryPoint object, or None if node is invalid.
        """
        node_id = node_dict.get("id")
        if node_id is None:
            return None

        name = node_dict.get("name", "") or ""
        file_name = node_dict.get("fileName", "") or node_dict.get("file_name", "") or ""
        line_number = node_dict.get("lineNumber", 0) or node_dict.get("line_number", 0) or 0

        return EntryPoint(
            node_id=node_id,
            name=name,
            file=file_name,
            line=line_number,
            level=level,
            category=category,
            rule_name=rule_name,
            protocol=protocol,
        )

    def _matches_code_pattern(self, code: str, pattern: str) -> bool:
        """
        Check if code matches a regex pattern.

        Args:
            code: Source code to check
            pattern: Regex pattern to match

        Returns:
            True if pattern matches code.
        """
        if not code or not pattern:
            return True

        try:
            return bool(re.search(pattern, code, re.IGNORECASE))
        except re.error as e:
            logger.warning(f"Invalid regex pattern '{pattern}': {e}")
            return False
