"""
Architecture guard: assets domain teardown regression protection.

Phase 02.1 tore down the legacy 'assets' domain (CLI commands, API router,
catalog registration). This test ensures that no future code reintroduces it.

Protects against:
- Re-adding 'assets' CLI command registration
- Re-adding 'assets' API router
- Re-adding 'assets' to the command catalog
- Re-creating codedmap/cli/commands/assets.py or codedmap/api/routers/assets.py

References: Phase 02.1-03-PLAN.md — hard teardown, no shims, no re-exports.
"""

import pathlib
import ast
import pytest

PROJECT_ROOT = pathlib.Path("codedmap")
CLI_COMMANDS_DIR = PROJECT_ROOT / "cli" / "commands"
API_ROUTERS_DIR = PROJECT_ROOT / "api" / "routers"
CATALOG_PATH = PROJECT_ROOT / "core" / "schema" / "catalog.py"


class TestAssetsFilesDeleted:
    """The assets module files must not exist anywhere in codedmap/."""

    def test_no_assets_cli_command_file(self):
        assets_file = CLI_COMMANDS_DIR / "assets.py"
        assert not assets_file.exists(), (
            f"{assets_file} must not exist — 'assets' CLI command was torn down in Phase 02.1. "
            "Do not reintroduce it."
        )

    def test_no_assets_api_router_file(self):
        assets_file = API_ROUTERS_DIR / "assets.py"
        assert not assets_file.exists(), (
            f"{assets_file} must not exist — 'assets' API router was torn down in Phase 02.1. "
            "Do not reintroduce it."
        )

    def test_no_assets_directory_under_codedmap(self):
        """No directory named 'assets' should exist under codedmap/ (shim directories forbidden)."""
        for d in PROJECT_ROOT.rglob("assets"):
            if d.is_dir():
                pytest.fail(
                    f"Directory '{d}' must not exist — 'assets' domain was torn down. "
                    "See No Shim Directories rule in CLAUDE.md."
                )


class TestAssetsCatalogNotRegistered:
    """'assets' must not appear as a domain or command name in the catalog."""

    def test_no_assets_domain_in_catalog(self):
        from codedmap.core.schema.catalog import get_catalog
        catalog = get_catalog()
        assets_commands = [cmd for cmd in catalog if cmd.domain == "assets"]
        assert not assets_commands, (
            f"Found {len(assets_commands)} 'assets' domain command(s) in catalog — "
            "assets domain was torn down in Phase 02.1 and must not be re-registered.\n"
            f"Commands: {[c.name for c in assets_commands]}"
        )

    def test_no_assets_command_names_in_catalog(self):
        from codedmap.core.schema.catalog import get_catalog
        catalog = get_catalog()
        assets_commands = [cmd for cmd in catalog if cmd.name.startswith("assets_")]
        assert not assets_commands, (
            f"Found command(s) with 'assets_' prefix in catalog — forbidden after Phase 02.1 teardown.\n"
            f"Commands: {[c.name for c in assets_commands]}"
        )


class TestAssetsCliNotRegisteredInEntrypoint:
    """'assets' must not be registered in the CLI command dispatcher."""

    def _collect_python_sources(self, root: pathlib.Path) -> list[pathlib.Path]:
        return [p for p in root.rglob("*.py") if "__pycache__" not in str(p)]

    def test_no_assets_import_in_cli(self):
        """No CLI module may import an 'assets' command module."""
        cli_root = PROJECT_ROOT / "cli"
        for fpath in self._collect_python_sources(cli_root):
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            # Check for import patterns that would register assets
            if (
                "from codedmap.cli.commands.assets" in source
                or "import codedmap.cli.commands.assets" in source
                or "commands.assets" in source
            ):
                pytest.fail(
                    f"{fpath}: imports assets CLI command — this domain was torn down in Phase 02.1.\n"
                    "Remove the import immediately."
                )

    def test_no_assets_api_import(self):
        """No API module may import an 'assets' router module."""
        api_root = PROJECT_ROOT / "api"
        for fpath in self._collect_python_sources(api_root):
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if (
                "from codedmap.api.routers.assets" in source
                or "routers.assets" in source
            ):
                pytest.fail(
                    f"{fpath}: imports assets API router — this domain was torn down in Phase 02.1.\n"
                    "Remove the import immediately."
                )


class TestKnowledgeReplacementIntact:
    """Verify the Phase 02.1 replacement API surfaces (knowledge/federation) are present."""

    def test_knowledge_router_exists(self):
        knowledge_router = API_ROUTERS_DIR / "knowledge.py"
        assert knowledge_router.exists(), (
            "codedmap/api/routers/knowledge.py must exist — it replaced the assets domain."
        )

    def test_federation_router_exists(self):
        federation_router = API_ROUTERS_DIR / "federation.py"
        assert federation_router.exists(), (
            "codedmap/api/routers/federation.py must exist — it replaced part of the assets domain."
        )
