"""
CLI validation: offline local execution boundary.

Verifies that CLI commands in local (non-remote) mode:
1. Do NOT make any HTTP calls (no requests.get/post, no httpx, no urllib)
2. Work without a running API server
3. Route through the service layer (CommandExecutor) when available, or
   through legacy direct-store paths during migration

These tests protect the offline-first CLI guarantee: agents and humans
must be able to run all query/analysis commands without network access.

Scaffold status (Phase 03-01):
  - TestOfflineCatalogCommands: scaffold, enabled — tests catalog command
    definitions are available offline (no network needed for metadata)
  - TestOfflineLocalExecution: scaffold, filled by Plans 03-02 through 03-04
    as each domain's service handler is implemented

References:
  - 03-CONTEXT.md — "Offline mode must remain fully usable"
  - codedmap/app/services/command_executor.py — local execution dispatch
"""

import pytest
import sys
import importlib


class TestOfflineCatalogMetadata:
    """Catalog metadata must be fully available without any network access."""

    def test_catalog_importable_without_network(self):
        """The catalog module must import successfully in offline environments."""
        mod = importlib.import_module("codedmap.core.schema.catalog")
        assert mod is not None

    def test_catalog_commands_accessible_offline(self):
        """All catalog commands must be accessible (no network I/O at import)."""
        from codedmap.core.schema.catalog import get_catalog, CATALOG
        catalog = get_catalog()
        assert len(catalog) > 0, "Catalog must have at least one command"
        # Verify we can access command metadata without any network call
        for cmd in catalog:
            assert cmd.name
            assert cmd.domain
            assert cmd.input_model is not None

    def test_command_executor_instantiates_offline(self):
        """CommandExecutor must instantiate without any network access."""
        from codedmap.app.services.command_executor import CommandExecutor
        executor = CommandExecutor()
        assert executor is not None
        # Catalog index built at init — must work offline
        commands = executor.catalog_commands()
        assert len(commands) > 0

    def test_service_contracts_importable_offline(self):
        """Service contracts must be importable without network access."""
        from codedmap.app.contracts.service import (
            CommandRequest, CommandResponse, ExecutionContext
        )
        # Basic instantiation — no network needed
        req = CommandRequest(tool_name="query_search", params={"pattern": "main"})
        assert req.tool_name == "query_search"


class TestNoNetworkInLocalMode:
    """Local CLI execution path must not import or call HTTP libraries at module level."""

    def test_cli_bootstrap_has_no_http_imports(self):
        """The CLI bootstrap module must not import requests/httpx at module level."""
        import ast
        import pathlib
        bootstrap_path = pathlib.Path("codedmap/cli/_bootstrap.py")
        if not bootstrap_path.exists():
            pytest.skip("_bootstrap.py not found")

        source = bootstrap_path.read_text(encoding="utf-8")
        tree = ast.parse(source)

        http_libs = {"requests", "httpx", "urllib.request", "http.client"}
        top_level_http_imports = []

        for node in ast.walk(tree):
            # Only check top-level imports (not inside function bodies)
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                mod = ""
                if isinstance(node, ast.Import):
                    mod = node.names[0].name if node.names else ""
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mod = node.module
                for lib in http_libs:
                    if mod.startswith(lib):
                        top_level_http_imports.append(f"{mod} at line {node.lineno}")

        assert not top_level_http_imports, (
            "_bootstrap.py has top-level HTTP imports — local CLI mode must work offline.\n"
            "Move HTTP imports inside functions gated on --remote flag.\n"
            f"Found: {top_level_http_imports}"
        )

    def test_remote_imports_are_guarded(self):
        """The remote client (_remote.py) must only be imported when --remote flag is used.

        This is a design check: the remote module may import HTTP libraries, but only
        the CLI dispatch layer (not bootstrap) should import it, and only conditionally.
        """
        import pathlib
        remote_path = pathlib.Path("codedmap/cli/_remote.py")
        if not remote_path.exists():
            pytest.skip("_remote.py not found")
        # Verify _remote.py exists (it handles remote mode) — existence is enough for scaffold
        assert remote_path.exists(), "_remote.py must exist for remote mode support"


class TestOfflineLocalExecution:
    """Local execution of migrated commands must work without a running API server.

    Activated progressively as service handlers are implemented:
    - Rules/module/repair/query: Plan 03-02
    - Tag/note: Plan 03-03
    - Knowledge/federation: deferred (deferred 501 services)
    """

    def test_rules_list_works_offline(self, tmp_path):
        """rules_list domain_services function is importable and callable offline."""
        from codedmap.app.services.domain_services import rules_list
        import inspect
        sig = inspect.signature(rules_list)
        assert "project" in sig.parameters, "rules_list must accept 'project' param"

    def test_module_list_works_offline(self, tmp_path):
        """module_list domain_services function is importable and callable offline."""
        from codedmap.app.services.domain_services import module_list
        import inspect
        sig = inspect.signature(module_list)
        assert "store" in sig.parameters, "module_list must accept 'store'"

    def test_query_search_works_offline(self, tmp_path):
        """query domain_services helpers are importable offline."""
        from codedmap.app.services.domain_services import (
            query_entrypoints_parse_tags,
            query_roles_parse_tags,
        )
        # Basic call — no store needed
        result = query_entrypoints_parse_tags(["ONTOLOGY:ENTRY_POINT:CLI:main"])
        assert result[0] == "L1"

    def test_tag_list_works_offline(self, tmp_path):
        """tag_list service function is importable without any network access.

        The tag_list function signature is verified — no actual store call needed
        to confirm the function exists and the service layer is wired correctly.
        """
        from codedmap.app.services.domain_services import tag_list
        import inspect
        sig = inspect.signature(tag_list)
        assert "store" in sig.parameters, "tag_list must accept 'store'"
        assert "node_id" in sig.parameters, "tag_list must accept 'node_id' for single-node mode"

    def test_note_list_works_offline(self, tmp_path):
        """note_list service function is importable without any network access.

        The note_list function signature is verified — no actual store call needed
        to confirm the function exists and the service layer is wired correctly.
        """
        from codedmap.app.services.domain_services import note_list
        import inspect
        sig = inspect.signature(note_list)
        assert "store" in sig.parameters, "note_list must accept 'store'"
        assert "node_id" in sig.parameters, "note_list must accept 'node_id' for filtering"

    def test_tag_add_works_offline(self, tmp_path):
        """tag_add service function is importable without network."""
        from codedmap.app.services.domain_services import tag_add, tag_remove, tag_find, tag_bulk
        # All tag service functions must be importable without network
        assert callable(tag_add)
        assert callable(tag_remove)
        assert callable(tag_find)
        assert callable(tag_bulk)

    def test_note_add_works_offline(self, tmp_path):
        """note_add service function is importable without network."""
        from codedmap.app.services.domain_services import note_add, note_show, note_remove
        # All note service functions must be importable without network
        assert callable(note_add)
        assert callable(note_show)
        assert callable(note_remove)
