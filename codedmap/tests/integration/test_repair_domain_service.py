"""
TDD tests for Plan 03-02, Task 2: repair domain service migration.

RED phase: These tests document the migrated state for repair domain.
They fail before implementation and pass after repair.py router is cleaned.

Contract:
- API repair router does NOT use io.StringIO() stdout capture
- API repair router does NOT import from codedmap.cli.commands.repair
- domain_services.py exposes repair_list, repair_suggest, repair_link, repair_undo
"""

import pathlib
import pytest


class TestRepairRouterIsClean:
    """repair.py API router must not use stdout-capture or cli.commands.repair imports."""

    REPAIR_ROUTER_PATH = pathlib.Path("codedmap/api/routers/repair.py")

    def test_repair_router_has_no_stringio_capture(self):
        source = self.REPAIR_ROUTER_PATH.read_text(encoding="utf-8")
        assert "io.StringIO()" not in source, (
            "repair.py still uses io.StringIO() stdout capture — "
            "migrate to domain service calls"
        )

    def test_repair_router_has_no_sys_stdout_reassignment(self):
        source = self.REPAIR_ROUTER_PATH.read_text(encoding="utf-8")
        assert "sys.stdout =" not in source, (
            "repair.py still redirects sys.stdout — "
            "migrate to domain service calls"
        )

    def test_repair_router_has_no_cli_commands_import(self):
        source = self.REPAIR_ROUTER_PATH.read_text(encoding="utf-8")
        assert "codedmap.cli.commands.repair" not in source, (
            "repair.py still imports from codedmap.cli.commands.repair — "
            "migrate to domain service calls"
        )


class TestRepairServiceHandlersExist:
    """domain_services.py must export repair service handlers."""

    def test_repair_list_callable(self):
        from codedmap.app.services.domain_services import repair_list
        assert callable(repair_list)

    def test_repair_suggest_callable(self):
        from codedmap.app.services.domain_services import repair_suggest
        assert callable(repair_suggest)

    def test_repair_link_callable(self):
        from codedmap.app.services.domain_services import repair_link
        assert callable(repair_link)

    def test_repair_undo_callable(self):
        from codedmap.app.services.domain_services import repair_undo
        assert callable(repair_undo)
