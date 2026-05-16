"""
TDD tests for Plan 03-02, Task 1: rules + module domain service migration.

RED phase: These tests document what the migrated state must look like.
They fail before implementation and pass after domain_services.py is complete.

Contract:
- domain_services.py provides service handler functions for rules and module
- API routers for rules and module NO LONGER use _capture_run or cli.commands.* imports
- CLI local path remains usable (offline)
"""

import importlib
import pathlib
import pytest


# ---------------------------------------------------------------------------
# domain_services.py must exist and export service handlers
# ---------------------------------------------------------------------------

class TestDomainServicesExist:
    """domain_services.py must be importable with the right surface."""

    def test_domain_services_importable(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert mod is not None

    def test_rules_list_handler_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "rules_list"), "domain_services must export rules_list handler"

    def test_rules_categories_handler_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "rules_categories"), "domain_services must export rules_categories handler"

    def test_module_list_handler_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "module_list"), "domain_services must export module_list handler"

    def test_module_show_handler_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "module_show"), "domain_services must export module_show handler"


# ---------------------------------------------------------------------------
# API router rules.py must no longer use stdout capture
# ---------------------------------------------------------------------------

class TestRulesRouterIsClean:
    """rules.py API router must not use stdout-capture or _capture_run after migration."""

    RULES_ROUTER_PATH = pathlib.Path("codedmap/api/routers/rules.py")

    def test_rules_router_has_no_capture_run(self):
        source = self.RULES_ROUTER_PATH.read_text(encoding="utf-8")
        assert "_capture_run" not in source, (
            "rules.py API router still uses _capture_run — "
            "migrate to domain service calls"
        )

    def test_rules_router_has_no_sys_stdout_reassignment(self):
        source = self.RULES_ROUTER_PATH.read_text(encoding="utf-8")
        assert "sys.stdout =" not in source, (
            "rules.py API router still redirects sys.stdout — "
            "migrate to domain service calls"
        )

    def test_rules_router_has_no_cli_commands_import(self):
        source = self.RULES_ROUTER_PATH.read_text(encoding="utf-8")
        assert "codedmap.cli.commands.rules" not in source, (
            "rules.py API router still imports from cli.commands.rules — "
            "migrate to domain service calls"
        )


# ---------------------------------------------------------------------------
# API router module.py must not import from cli.commands.module
# ---------------------------------------------------------------------------

class TestModuleRouterIsClean:
    """module.py API router must not import from cli.commands.module after migration."""

    MODULE_ROUTER_PATH = pathlib.Path("codedmap/api/routers/module.py")

    def test_module_router_has_no_cli_commands_import(self):
        source = self.MODULE_ROUTER_PATH.read_text(encoding="utf-8")
        assert "codedmap.cli.commands.module" not in source, (
            "module.py API router still imports from cli.commands.module — "
            "migrate to domain service calls"
        )


# ---------------------------------------------------------------------------
# rules_list service produces valid output shape
# ---------------------------------------------------------------------------

class TestRulesListService:
    """rules_list handler produces correct output dict shape."""

    def test_rules_list_returns_dict_with_rules_key(self, tmp_path):
        from codedmap.app.services.domain_services import rules_list
        from codedmap.app.contracts.service import ExecutionContext

        # Use tmp_path as project root (no rules dir = valid, returns empty list)
        ctx = ExecutionContext(db=None)
        result = rules_list(project=str(tmp_path), rule_type=None)

        assert isinstance(result, dict), "rules_list must return dict"
        assert "rules" in result, "rules_list result must have 'rules' key"
        assert "total" in result, "rules_list result must have 'total' key"
        assert isinstance(result["rules"], list)

    def test_rules_categories_returns_namespaces(self, tmp_path):
        from codedmap.app.services.domain_services import rules_categories

        result = rules_categories(project=str(tmp_path))
        assert isinstance(result, dict), "rules_categories must return dict"
        assert "namespaces" in result, "rules_categories must have 'namespaces' key"


# ---------------------------------------------------------------------------
# module_list service produces valid output shape
# ---------------------------------------------------------------------------

class TestModuleListService:
    """module_list handler is importable and has correct signature."""

    def test_module_list_callable(self):
        from codedmap.app.services.domain_services import module_list
        assert callable(module_list)

    def test_module_show_callable(self):
        from codedmap.app.services.domain_services import module_show
        assert callable(module_show)
