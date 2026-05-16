"""Shared contracts/utilities used across adapters (CLI/API)."""

from codedmap.app.contracts.service import (
    CommandNotFoundError,
    CommandRequest,
    CommandResponse,
    ExecutionContext,
    ServiceError,
    ValidationError,
)

__all__ = [
    "CommandRequest",
    "ExecutionContext",
    "CommandResponse",
    "ServiceError",
    "CommandNotFoundError",
    "ValidationError",
]
