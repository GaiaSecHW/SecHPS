"""
CLI validation: build and serve CLI-local boundary.

'build' and 'serve' are designated CLI-native operational commands.
They remain as direct CLI implementations (not service-layer candidates)
because they manage long-running processes and local filesystem state.

These tests verify:
1. build and serve CLI commands exist and are correctly registered
2. They do NOT go through CommandExecutor (they bypass the service layer)
3. Their catalog entries exist for metadata/schema purposes
4. They are not accidentally migrated to the service layer (which would break
   their process-management semantics)

References:
  - 03-CONTEXT.md — "build/serve stay CLI-local"
  - test_cli_catalog_registration.py — build/serve are allowed exceptions
"""

import pathlib
import argparse
import pytest

CLI_COMMANDS_DIR = pathlib.Path("codedmap/cli/commands")


class TestBuildCommandExists:
    """build CLI command must exist as a CLI-native command."""

    def test_build_file_exists(self):
        assert (CLI_COMMANDS_DIR / "build.py").exists(), (
            "codedmap/cli/commands/build.py must exist — build is a CLI-native operation"
        )

    def test_enhance_file_exists(self):
        assert (CLI_COMMANDS_DIR / "enhance.py").exists(), (
            "codedmap/cli/commands/enhance.py must exist — build enhance is a CLI-native operation"
        )

    def test_build_has_register_function(self):
        """build.py must have a register() function for CLI arg parsing."""
        import importlib.util
        fpath = CLI_COMMANDS_DIR / "build.py"
        source = fpath.read_text(encoding="utf-8")
        assert "def register(" in source, (
            "build.py must have a register(subparsers) function for argparse setup"
        )

    def test_build_catalog_entry_exists(self):
        """build must have catalog entries for metadata/schema purposes."""
        from codedmap.core.schema.catalog import get_command
        assert get_command("build_start") is not None, (
            "build_start must be in catalog for schema/help purposes"
        )
        assert get_command("build_enhance") is not None, (
            "build_enhance must be in catalog for schema/help purposes"
        )

    def test_build_parser_accepts_debug_flag(self):
        from codedmap.cli.commands import build as cmd_build
        parser = argparse.ArgumentParser(prog="cdm")
        subparsers = parser.add_subparsers(dest="command")
        cmd_build.register(subparsers)
        ns = parser.parse_args(["build", "example", "--debug"])
        assert ns.command == "build"
        assert ns.debug is True


class TestServeCommandExists:
    """serve CLI command must exist as a CLI-native command."""

    def test_serve_file_exists(self):
        assert (CLI_COMMANDS_DIR / "serve.py").exists(), (
            "codedmap/cli/commands/serve.py must exist — serve is a CLI-native operation"
        )

    def test_serve_has_register_function(self):
        """serve.py must have a register() function for CLI arg parsing."""
        fpath = CLI_COMMANDS_DIR / "serve.py"
        source = fpath.read_text(encoding="utf-8")
        assert "def register(" in source, (
            "serve.py must have a register(subparsers) function for argparse setup"
        )

    def test_serve_catalog_entry_exists(self):
        """serve must have catalog entry for metadata/schema purposes."""
        from codedmap.core.schema.catalog import get_command
        assert get_command("serve") is not None, (
            "serve must be in catalog for schema/help purposes"
        )

    def test_serve_parser_accepts_debug_flag(self):
        from codedmap.cli.commands import serve as cmd_serve
        parser = argparse.ArgumentParser(prog="cdm")
        subparsers = parser.add_subparsers(dest="command")
        cmd_serve.register(subparsers)
        ns = parser.parse_args(["serve", "--db", "test.db", "--debug"])
        assert ns.command == "serve"
        assert ns.debug is True


class TestBuildServeNotInServiceLayer:
    """build and serve must not be registered as service handler targets."""

    def test_build_not_registered_in_executor_by_default(self):
        """CommandExecutor should have no default handler for build commands.

        build/serve are CLI-native — they manage processes and must not
        be routed through the service layer dispatch chain.
        """
        from codedmap.app.services.command_executor import CommandExecutor
        executor = CommandExecutor()
        # No build handlers should be registered by default
        assert "build_start" not in executor.registered_commands(), (
            "build_start must not be pre-registered in CommandExecutor — "
            "build is CLI-native and must not go through service dispatch"
        )
        assert "serve" not in executor.registered_commands(), (
            "serve must not be pre-registered in CommandExecutor — "
            "serve is CLI-native and must not go through service dispatch"
        )

    def test_build_serve_catalog_coverage_shows_unregistered(self):
        """CommandExecutor coverage must show build/serve as unregistered."""
        from codedmap.app.services.command_executor import CommandExecutor
        executor = CommandExecutor()
        coverage = executor.coverage()
        # build and serve commands must be in catalog (for metadata)
        # but not registered in executor (CLI-native)
        build_serve_commands = [
            name for name in coverage
            if name.startswith("build_") or name == "serve"
        ]
        assert build_serve_commands, (
            "build/serve commands must appear in catalog coverage dict"
        )
        for cmd_name in build_serve_commands:
            assert not coverage[cmd_name], (
                f"'{cmd_name}' is registered in CommandExecutor — "
                "build/serve must remain CLI-native and unregistered in service executor"
            )


@pytest.mark.skip(reason="Scaffold only — build/serve integration tests are future work")
class TestBuildServeFunctional:
    """Integration tests for build and serve CLI-local execution.

    These are intentionally not implemented here — build/serve require
    actual compilation toolchains and network ports. They are tested
    separately in integration environments.
    """

    def test_build_local_path(self):
        raise NotImplementedError("Build integration test — requires compiler toolchain")

    def test_serve_local_path(self):
        raise NotImplementedError("Serve integration test — requires available port")
