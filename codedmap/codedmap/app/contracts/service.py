"""
codedmap.app.contracts.service — Typed, transport-agnostic service I/O contracts.

These models are the shared boundary between:
- CLI adapters (local execution path)
- API routers (HTTP transport path)
- CommandExecutor (dispatch engine)

Design principles:
- Zero transport knowledge (no HTTP status codes, no argparse.Namespace)
- Fully typed via Pydantic V2
- Domain-agnostic: one request/response envelope for all commands
- Catalog-driven: tool_name maps directly to CommandDefinition.name in catalog
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class CommandRequest(BaseModel):
    """Unified request envelope for any catalog-defined command.

    Attributes:
        tool_name:  Catalog command name, e.g. "query_search", "module_create".
                    Must match a CommandDefinition.name in CATALOG.
        params:     Command-specific parameters matching the command's input_model schema.
                    Passed as a plain dict; executor validates against input_model.
        context:    Execution context (db path, backend, agent_id, etc.).
                    Injected by the adapter layer (CLI or API router), not by callers.
    """

    model_config = ConfigDict(extra="forbid")

    tool_name: str = Field(..., description="Catalog command name (e.g. 'query_search')")
    params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Command parameters matching the catalog input_model schema",
    )
    context: "ExecutionContext" = Field(
        default_factory=lambda: ExecutionContext(),
        description="Execution context injected by the adapter layer",
    )


class ExecutionContext(BaseModel):
    """Adapter-injected execution context — not part of business params.

    Contains connection/output details that are stripped before command execution:
    - db: Path to the CPG database file
    - backend: Storage backend name ('sqlite', 'neo4j', 'memory')
    - agent_id: Agent identifier for write-operation attribution
    - output_format: 'json' | 'text' (CLI display mode)
    """

    model_config = ConfigDict(extra="allow")

    db: Optional[str] = None
    backend: str = "sqlite"
    agent_id: Optional[str] = None
    output_format: str = "json"


class CommandResponse(BaseModel):
    """Unified response envelope for any catalog-defined command.

    Attributes:
        success:    Whether the command completed without error.
        tool_name:  Echoes the originating CommandRequest.tool_name.
        result:     Command output payload. Shape is command-specific.
        error:      Error message if success=False.
        error_code: Machine-readable error type (e.g. 'NOT_FOUND', 'VALIDATION_ERROR').
    """

    model_config = ConfigDict(extra="forbid")

    success: bool
    tool_name: str
    result: Optional[Any] = None
    error: Optional[str] = None
    error_code: Optional[str] = None

    @classmethod
    def ok(cls, tool_name: str, result: Any = None) -> "CommandResponse":
        """Construct a successful response."""
        return cls(success=True, tool_name=tool_name, result=result)

    @classmethod
    def err(
        cls,
        tool_name: str,
        error: str,
        error_code: Optional[str] = None,
    ) -> "CommandResponse":
        """Construct an error response."""
        return cls(
            success=False,
            tool_name=tool_name,
            result=None,
            error=error,
            error_code=error_code,
        )


class ServiceError(Exception):
    """Base exception for service-layer errors.

    Raised by CommandExecutor and service handlers.
    Adapters (CLI, API) translate this to their transport-specific error format.
    """

    def __init__(
        self,
        message: str,
        error_code: str = "SERVICE_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.details = details or {}


class CommandNotFoundError(ServiceError):
    """Raised when tool_name does not match any catalog entry."""

    def __init__(self, tool_name: str) -> None:
        super().__init__(
            f"Command '{tool_name}' not found in catalog",
            error_code="COMMAND_NOT_FOUND",
        )
        self.tool_name = tool_name


class ValidationError(ServiceError):
    """Raised when params fail validation against the catalog input_model."""

    def __init__(self, tool_name: str, detail: str) -> None:
        super().__init__(
            f"Validation failed for '{tool_name}': {detail}",
            error_code="VALIDATION_ERROR",
        )
