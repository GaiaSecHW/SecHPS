"""
codedmap.app.services.command_executor — Catalog-driven execution boundary.

CommandExecutor is the single dispatch gate between adapters (CLI, API) and
service handlers. It:
1. Looks up the command definition from the catalog (SSOT).
2. Validates params against the catalog input_model.
3. Delegates to a registered handler (or raises NotImplementedError for stubs).

Architecture contract:
- API routers and CLI commands MUST NOT implement business logic directly.
- All business logic lives in service handlers registered with CommandExecutor.
- The catalog (codedmap.core.schema.catalog) is the ONLY source for command
  metadata, input schemas, and routing keys.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from codedmap.core.schema.catalog import get_catalog, get_command
from codedmap.app.contracts.service import (
    CommandNotFoundError,
    CommandRequest,
    CommandResponse,
    ExecutionContext,
    ServiceError,
    ValidationError,
)

logger = logging.getLogger(__name__)

# Type alias for service handler callables.
# Handlers receive (validated_input: BaseModel, context: ExecutionContext) -> Any
HandlerFn = Callable[..., Any]


class CommandExecutor:
    """Catalog-driven command dispatcher.

    Usage (local execution):
        executor = CommandExecutor()
        executor.register("query_search", my_search_handler)
        response = executor.execute(CommandRequest(
            tool_name="query_search",
            params={"pattern": "malloc", "type": "method"},
            context=ExecutionContext(db="graph.db"),
        ))

    The execute() method:
    1. Validates tool_name against the catalog.
    2. Validates params against the catalog input_model.
    3. Calls the registered handler (or returns a stub response during migration).
    """

    def __init__(self) -> None:
        self._handlers: Dict[str, HandlerFn] = {}
        self._catalog_index: Dict[str, Any] = {
            cmd.name: cmd for cmd in get_catalog()
        }

    # ------------------------------------------------------------------
    # Handler registration
    # ------------------------------------------------------------------

    def register(self, tool_name: str, handler: HandlerFn) -> None:
        """Register a service handler for a catalog command.

        Args:
            tool_name: Must match a CommandDefinition.name in CATALOG.
            handler:   Callable(validated_input, context) -> Any

        Raises:
            ValueError: If tool_name is not in the catalog.
        """
        cmd = get_command(tool_name)
        if cmd is None:
            raise ValueError(
                f"Cannot register handler for unknown command '{tool_name}'. "
                "Command must be defined in the catalog first."
            )
        self._handlers[tool_name] = handler
        logger.debug("Registered handler for '%s'", tool_name)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def execute(
        self,
        request: CommandRequest,
    ) -> CommandResponse:
        """Dispatch a CommandRequest to the appropriate service handler.

        Args:
            request: Validated CommandRequest with tool_name, params, context.

        Returns:
            CommandResponse with success/error status and result payload.

        The method never raises — all errors are captured in CommandResponse.
        """
        tool_name = request.tool_name
        context = request.context

        # Step 1: catalog lookup (SSOT for routing)
        cmd_def = get_command(tool_name)
        if cmd_def is None:
            logger.warning("Unknown command requested: %s", tool_name)
            return CommandResponse.err(
                tool_name=tool_name,
                error=f"Command '{tool_name}' not found in catalog",
                error_code="COMMAND_NOT_FOUND",
            )

        # Step 2: validate params against catalog input_model
        try:
            validated_input = cmd_def.input_model(**request.params)
        except Exception as exc:
            logger.debug("Param validation failed for '%s': %s", tool_name, exc)
            return CommandResponse.err(
                tool_name=tool_name,
                error=f"Parameter validation failed: {exc}",
                error_code="VALIDATION_ERROR",
            )

        # Step 3: dispatch to handler or return migration stub
        handler = self._handlers.get(tool_name)
        if handler is None:
            # During Phase 03 migration, handlers are registered incrementally.
            # Return a clear stub response instead of raising.
            logger.debug("No handler registered for '%s' (migration stub)", tool_name)
            return CommandResponse.err(
                tool_name=tool_name,
                error=(
                    f"Handler for '{tool_name}' not yet registered. "
                    "Migration in progress — use CLI local path or API router."
                ),
                error_code="HANDLER_NOT_REGISTERED",
            )

        # Step 4: call handler
        try:
            result = handler(validated_input, context)
            return CommandResponse.ok(tool_name=tool_name, result=result)
        except ServiceError as exc:
            return CommandResponse.err(
                tool_name=tool_name,
                error=str(exc),
                error_code=exc.error_code,
            )
        except Exception as exc:
            # Keep default CLI/API output concise; emit traceback only at debug level.
            logger.debug("Unhandled error in handler for '%s'", tool_name, exc_info=True)
            return CommandResponse.err(
                tool_name=tool_name,
                error=f"Internal service error: {exc}",
                error_code="INTERNAL_ERROR",
            )

    # ------------------------------------------------------------------
    # Introspection helpers
    # ------------------------------------------------------------------

    def registered_commands(self) -> list[str]:
        """Return list of tool_names with registered handlers."""
        return list(self._handlers.keys())

    def catalog_commands(self) -> list[str]:
        """Return list of all tool_names defined in the catalog."""
        return list(self._catalog_index.keys())

    def coverage(self) -> dict[str, bool]:
        """Return dict mapping each catalog command to handler registration status."""
        return {
            name: name in self._handlers
            for name in self._catalog_index
        }
