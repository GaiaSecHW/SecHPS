"""
Adapter-agnostic response envelope and graph serialization helpers.

This module is intentionally independent from CLI/API adapter layers so both can
share one contract without cross-importing each other.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional, TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from codedmap.core.schema.graph.base import CPGNode


CLI_SCHEMA_VERSION = "1.0.0"


class WitnessHop(BaseModel):
    node_id: int
    name: str = "?"
    file: Optional[str] = None
    line: Optional[int] = None
    label: str = "UNKNOWN"
    depth: int = 0
    edge_type: str = ""
    in_module: Optional[bool] = None
    module_name: Optional[str] = None


def _node_to_witness_hop(
    node: "CPGNode",
    depth: int = 0,
    edge_type: str = "",
    store=None,
    module_scope=None,
    edge=None,
) -> dict:
    label = getattr(node, "label", "UNKNOWN")
    if hasattr(label, "value"):
        label = label.value

    file = getattr(node, "fileName", None) or getattr(node, "file_name", None)
    file_node = None
    if file is None and store is not None:
        node_id = getattr(node, "id", None)
        if node_id is not None:
            try:
                file_node = store.ast.get_enclosing_file(node_id)
                if file_node is not None:
                    file = getattr(file_node, "name", None)
            except Exception:
                pass

    hop = {
        "node_id": getattr(node, "id", 0),
        "name": getattr(node, "name", "?"),
        "file": file,
        "line": getattr(node, "lineNumber", None) or getattr(node, "line_number", None),
        "label": str(label),
        "depth": depth,
        "edge_type": edge_type,
    }

    if edge is not None:
        created_by = getattr(edge, "created_by", "")
        if created_by == "agent:repair" or (created_by and "@repair:" in created_by):
            hop["repaired"] = True
            hop["repair_id"] = edge.properties.get("repair_id", "?")

    if module_scope is not None and store is not None:
        node_id = getattr(node, "id", None)
        if node_id is not None:
            if file_node is None:
                try:
                    file_node = store.ast.get_enclosing_file(node_id)
                except Exception:
                    file_node = None
            if file_node is not None and file_node.id in module_scope.file_ids:
                hop["in_module"] = True
                hop["module_name"] = module_scope.name
            elif file_node is not None:
                hop["in_module"] = False
                hop["module_name"] = None
            else:
                hop["in_module"] = None
                hop["module_name"] = None
    return hop


def _find_call_edge(store, src_id: int, dst_id: int):
    try:
        return store.find_edge(src_id, dst_id, "CALL")
    except Exception:
        return None


class ErrorCode(str, Enum):
    NODE_NOT_FOUND = "NODE_NOT_FOUND"
    DB_CONNECTION_ERROR = "DB_CONNECTION_ERROR"
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    NO_RESULTS = "NO_RESULTS"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    AMBIGUOUS_TARGET = "AMBIGUOUS_TARGET"
    MODULE_NOT_FOUND = "MODULE_NOT_FOUND"
    AMBIGUOUS_MODULE = "AMBIGUOUS_MODULE"


class CLIError(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class CLIMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    total: int = 0
    has_more: bool = False
    limit: int = 50
    truncated: bool = False


class CLIResponse(BaseModel):
    model_config = ConfigDict(use_enum_values=True, ser_json_exclude_none=True)

    schema_version: str = CLI_SCHEMA_VERSION
    command: str
    target: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    metadata: CLIMetadata = Field(default_factory=CLIMetadata)
    success: bool = True
    error: Optional[CLIError] = None

    @model_validator(mode="after")
    def _validate_result_shape(self):
        """Strict mode: all non-null result payloads must use kind/content."""
        if self.result is None:
            return self
        if not isinstance(self.result, dict):
            raise ValueError("CLIResponse.result must be a dict with {'kind','content'} or null.")
        if not isinstance(self.result.get("kind"), str) or "content" not in self.result:
            raise ValueError("CLIResponse.result must include string 'kind' and 'content' fields.")
        return self

    def to_json(self) -> str:
        return self.model_dump_json(indent=2, exclude_none=True)

    @classmethod
    def success_response(
        cls,
        command: str,
        nodes: list[dict],
        metadata: Optional[CLIMetadata] = None,
        target: Optional[dict] = None,
    ) -> "CLIResponse":
        if metadata is None:
            metadata = CLIMetadata(total=len(nodes))
        return cls(
            command=command,
            target=target,
            result={"kind": "nodes", "content": nodes},
            metadata=metadata,
            success=True,
        )

    @classmethod
    def error_response(
        cls,
        command: str,
        code: str,
        message: str,
        target: Optional[dict] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> "CLIResponse":
        return cls(
            command=command,
            target=target,
            result=None,
            metadata=CLIMetadata(),
            success=False,
            error=CLIError(code=code, message=message, details=details),
        )

    @classmethod
    def ambiguous_response(
        cls,
        command: str,
        query: str,
        candidates: list[dict],
    ) -> "CLIResponse":
        return cls(
            command=command,
            target={"raw": query},
            result={"kind": "object", "content": {"candidates": candidates, "total": len(candidates)}},
            metadata=CLIMetadata(total=len(candidates)),
            success=False,
            error=CLIError(
                code=ErrorCode.AMBIGUOUS_TARGET,
                message=(
                    f"Ambiguous target: '{query}' matches {len(candidates)} nodes. "
                    "Use --node-id to disambiguate."
                ),
            ),
        )


def _node_to_dict(node: "CPGNode", store=None) -> dict:
    label = getattr(node, "label", "?")
    if hasattr(label, "value"):
        label = label.value

    file = getattr(node, "fileName", None) or getattr(node, "file_name", None)
    line = getattr(node, "lineNumber", None) or getattr(node, "line_number", None)

    if file is None and store is not None:
        node_id = getattr(node, "id", None)
        if node_id is not None:
            try:
                file_node = store.ast.get_enclosing_file(node_id)
                if file_node is not None:
                    file = getattr(file_node, "name", None)
            except Exception:
                pass

    return {
        "id": getattr(node, "id", None),
        "name": getattr(node, "name", "?"),
        "file": file,
        "line": line,
        "label": label,
    }
