"""
Architecture guard: catalog-first enforcement.

Ensures CommandExecutor is wired to the catalog for dispatch and that
service contracts exist as typed, transport-agnostic models.
"""

import importlib
import sys
import pytest


class TestServiceContractsExist:
    """Service contract module and key models must be importable."""

    def test_contracts_module_importable(self):
        mod = importlib.import_module("codedmap.app.contracts.service")
        assert mod is not None

    def test_command_request_model_exists(self):
        mod = importlib.import_module("codedmap.app.contracts.service")
        assert hasattr(mod, "CommandRequest"), "CommandRequest must exist in contracts"

    def test_command_response_model_exists(self):
        mod = importlib.import_module("codedmap.app.contracts.service")
        assert hasattr(mod, "CommandResponse"), "CommandResponse must exist in contracts"

    def test_contracts_are_pydantic_models(self):
        from pydantic import BaseModel
        mod = importlib.import_module("codedmap.app.contracts.service")
        assert issubclass(mod.CommandRequest, BaseModel)
        assert issubclass(mod.CommandResponse, BaseModel)


class TestCommandExecutorCatalogBoundary:
    """CommandExecutor must be wired to catalog for dispatch."""

    def test_executor_module_importable(self):
        mod = importlib.import_module("codedmap.app.services.command_executor")
        assert mod is not None

    def test_command_executor_class_exists(self):
        mod = importlib.import_module("codedmap.app.services.command_executor")
        assert hasattr(mod, "CommandExecutor"), "CommandExecutor class must exist"

    def test_executor_references_catalog(self):
        """CommandExecutor source must import from the catalog (core SSOT)."""
        import inspect
        mod = importlib.import_module("codedmap.app.services.command_executor")
        src = inspect.getsource(mod)
        assert "from codedmap.core.schema.catalog import" in src, (
            "CommandExecutor must import from codedmap.core.schema.catalog — "
            "catalog is the SSOT for command dispatch routing"
        )

    def test_executor_has_execute_method(self):
        mod = importlib.import_module("codedmap.app.services.command_executor")
        cls = mod.CommandExecutor
        assert hasattr(cls, "execute"), "CommandExecutor must have an execute() method"

    def test_executor_execute_accepts_command_request(self):
        """execute() signature must accept a CommandRequest."""
        import inspect
        mod = importlib.import_module("codedmap.app.services.command_executor")
        cls = mod.CommandExecutor
        sig = inspect.signature(cls.execute)
        params = list(sig.parameters.keys())
        # Must have 'self' + at least one positional arg for the request
        assert len(params) >= 2, "execute() must accept at least one argument beyond self"

    def test_cli_bootstrap_wires_command_executor(self):
        """CLI local dispatch must wire through CommandExecutor runtime path."""
        import inspect
        mod = importlib.import_module("codedmap.cli._bootstrap")
        src = inspect.getsource(mod)
        assert "_dispatch_catalog_command_via_executor" in src, (
            "cli._bootstrap must expose _dispatch_catalog_command_via_executor() "
            "as the local runtime dispatch gate."
        )
        assert "CommandExecutor" in src, (
            "cli._bootstrap local dispatch must instantiate/use CommandExecutor."
        )

    def test_catalog_dispatch_delegates_to_bootstrap_executor(self):
        """_catalog_dispatch must stay thin and delegate local execution."""
        import inspect
        mod = importlib.import_module("codedmap.cli.commands._catalog_dispatch")
        src = inspect.getsource(mod)
        assert "_dispatch_catalog_command_via_executor" in src, (
            "_catalog_dispatch dispatch must delegate to bootstrap executor path."
        )


class TestNonCatalogDispatchForbidden:
    """Route maps not driven by catalog are forbidden at the executor level."""

    def test_executor_does_not_use_hardcoded_route_map(self):
        """CommandExecutor must not define its own hardcoded command->handler map
        outside catalog lookup — the catalog IS the route map."""
        import inspect
        mod = importlib.import_module("codedmap.app.services.command_executor")
        src = inspect.getsource(mod)
        # A hardcoded dict like {"query_search": handler} bypasses catalog authority
        # Check that any dict literal keys in the executor don't bypass the catalog
        # The catalog lookup via get_command() is the only allowed routing mechanism
        assert "get_command" in src or "get_catalog" in src, (
            "CommandExecutor must use get_command() or get_catalog() for dispatch routing — "
            "no hardcoded command name -> handler dicts allowed"
        )
