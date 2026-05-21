"""Canonical visualization service for graph-backed CALL_GRAPH responses."""

from __future__ import annotations

from collections import deque
from typing import Any, Optional

from codedmap.analysis.traversal.call import CallGraphNavigator
from codedmap.app.query.root import CPG
from codedmap.app.services.matcher import run_matcher
from codedmap.core.schema.common import normalize_file_path
from codedmap.core.schema.visualize import (
    GraphLens,
    VisEdge,
    VisNode,
    VisualizeRequest,
    VisualizeResponse,
)


class VisualizeServiceError(Exception):
    """Transport-agnostic visualization service error."""

    def __init__(self, code: str, message: str, details: Optional[dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class VisualizeService:
    """Build visualization DTOs from the live graph store."""

    def build(self, *, store, request: VisualizeRequest) -> VisualizeResponse:
        if request.lens is not GraphLens.CALL_GRAPH:
            raise VisualizeServiceError(
                code="UNSUPPORTED_LENS",
                message=(
                    f"Visualization lens '{request.lens.value}' is not implemented; "
                    "only CALL_GRAPH is supported."
                ),
            )

        entry_methods = self._resolve_entry_methods(store=store, request=request)
        navigator = CallGraphNavigator(store)

        nodes_by_id: dict[int, VisNode] = {}
        edges_by_id: dict[str, VisEdge] = {}
        queued: set[int] = set()
        queue: deque[tuple[Any, int]] = deque()

        for method in entry_methods:
            nodes_by_id[method.id] = self._to_vis_node(method)
            if method.id not in queued:
                queue.append((method, 0))
                queued.add(method.id)

        while queue:
            method, depth = queue.popleft()
            if depth >= request.depth:
                continue

            callees = sorted(
                navigator.get_callees(method),
                key=lambda node: int(node.id),
            )
            for callee in callees:
                nodes_by_id.setdefault(callee.id, self._to_vis_node(callee))
                edge = self._to_vis_edge(method.id, callee.id)
                edges_by_id.setdefault(edge.id, edge)
                if callee.id not in queued:
                    queue.append((callee, depth + 1))
                    queued.add(callee.id)

        return VisualizeResponse(
            nodes=list(nodes_by_id.values()),
            edges=list(edges_by_id.values()),
        )

    def _resolve_entry_methods(self, *, store, request: VisualizeRequest) -> list[Any]:
        if request.entry_node_ids:
            return self._resolve_entry_methods_by_id(store=store, entry_node_ids=request.entry_node_ids)
        if request.entry_points:
            return self._resolve_entry_methods_by_signature(store=store, request=request)

        raise VisualizeServiceError(
            code="INVALID_REQUEST",
            message="Visualization request must provide entry_node_ids or entry_points.",
        )

    def _resolve_entry_methods_by_id(self, *, store, entry_node_ids: list[str]) -> list[Any]:
        resolved_methods: list[Any] = []
        for index, raw_node_id in enumerate(entry_node_ids):
            try:
                node_id = int(raw_node_id)
            except (TypeError, ValueError):
                raise VisualizeServiceError(
                    code="INVALID_REQUEST",
                    message="Visualization entry_node_ids must be decimal string node IDs.",
                    details={
                        "artifact_index": index,
                        "status": "INVALID_NODE_ID",
                        "diagnostics": [f"entry node id {raw_node_id!r} is not a valid decimal string"],
                    },
                ) from None

            method = store.get_node(node_id)
            if method is None:
                raise VisualizeServiceError(
                    code="ENTRYPOINT_RESOLUTION_FAILED",
                    message="Failed to resolve visualization entry points.",
                    details={
                        "artifact_index": index,
                        "status": "ORPHANED",
                        "diagnostics": [f"entry node id {node_id} is missing from store"],
                    },
                )

            if self._label_value(method) != "METHOD":
                raise VisualizeServiceError(
                    code="ENTRYPOINT_RESOLUTION_FAILED",
                    message="Failed to resolve visualization entry points.",
                    details={
                        "artifact_index": index,
                        "status": "INVALID_NODE_TYPE",
                        "diagnostics": [f"entry node id {node_id} is {self._label_value(method)}, expected METHOD"],
                    },
                )

            resolved_methods.append(method)

        return resolved_methods

    def _resolve_entry_methods_by_signature(self, *, store, request: VisualizeRequest) -> list[Any]:
        methods = CPG(store).method().to_list()
        candidates = [
            {
                "node_id": int(method.id),
                "node_label": self._label_value(method),
                "name": self._semantic_name(method),
                "file_path": normalize_file_path(self._file_path(method) or ""),
                "content_hash": getattr(method, "code_hash", None),
            }
            for method in methods
        ]

        resolved_methods: list[Any] = []
        for artifact_index, signature in enumerate(request.entry_points or []):
            result = run_matcher(
                artifact_index=artifact_index,
                signature=signature,
                candidates=candidates,
            )
            if result.status != "MATCHED" or result.matched_node_id is None:
                raise VisualizeServiceError(
                    code="ENTRYPOINT_RESOLUTION_FAILED",
                    message="Failed to resolve visualization entry points.",
                    details={
                        "artifact_index": artifact_index,
                        "status": result.status,
                        "diagnostics": result.diagnostics,
                    },
                )

            method = store.get_node(result.matched_node_id)
            if method is None:
                raise VisualizeServiceError(
                    code="ENTRYPOINT_RESOLUTION_FAILED",
                    message="Failed to resolve visualization entry points.",
                    details={
                        "artifact_index": artifact_index,
                        "status": "ORPHANED",
                        "diagnostics": [f"resolved node {result.matched_node_id} is missing from store"],
                    },
                )
            resolved_methods.append(method)

        return resolved_methods

    def _to_vis_node(self, method) -> VisNode:
        return VisNode(
            id=f"method:{int(method.id)}",
            label=self._node_label(method),
            node_type=self._label_value(method),
            file_path=self._file_path(method),
            line_start=self._line_start(method),
            line_end=self._line_end(method),
            tags=[],
            notes_summary=[],
            is_federation_gateway=False,
        )

    def _to_vis_edge(self, source_method_id: int, target_method_id: int) -> VisEdge:
        return VisEdge(
            id=f"edge:{source_method_id}:{target_method_id}:CALLS",
            source=f"method:{source_method_id}",
            target=f"method:{target_method_id}",
            relation="CALLS",
        )

    @staticmethod
    def _label_value(node) -> str:
        label = getattr(node, "label", "")
        return label.value if hasattr(label, "value") else str(label)

    @staticmethod
    def _semantic_name(node) -> str:
        return getattr(node, "full_name", None) or getattr(node, "name", "")

    @staticmethod
    def _node_label(node) -> str:
        return getattr(node, "full_name", None) or getattr(node, "name", "")

    @staticmethod
    def _file_path(node) -> Optional[str]:
        file_path = getattr(node, "file_name", None) or getattr(node, "file_path", None)
        if not file_path:
            return None
        return normalize_file_path(file_path)

    @staticmethod
    def _line_start(node) -> Optional[int]:
        return getattr(node, "line_number", None) or getattr(node, "line_start", None)

    @staticmethod
    def _line_end(node) -> Optional[int]:
        return getattr(node, "line_number_end", None) or getattr(node, "line_end", None)
