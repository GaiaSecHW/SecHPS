"""
Architecture guard: CLI command registration/help policy.

Policy (Plan 03-05 terminal state):
- Migrated domains (query, note, tag, module, repair, rules) MUST be registered
  through _catalog_dispatch.py, NOT through individual per-domain wrapper files.
- __main__.py must use register_catalog_domain() from _catalog_dispatch for all
  migrated domains.
- 'build' and 'serve' are explicitly allowed as hand-written CLI-native exceptions.
- Per-domain wrapper files for migrated domains must NOT exist (anti-pattern guard).

This guard enforces the cli_shell_convergence terminal state from Phase 03.
"""

import ast
import pathlib
import pytest

CLI_COMMANDS_DIR = pathlib.Path("codedmap/cli/commands")
CLI_DIR = pathlib.Path("codedmap/cli")

# Migrated domains — must be registered via _catalog_dispatch, NOT per-domain files.
MIGRATED_DOMAINS = {
    "query",
    "module",
    "repair",
    "rules",
    "tag",
    "note",
}

# Domains explicitly allowed as hand-written CLI exceptions.
# 'build' and 'serve' are CLI-native operational commands (not service-layer backed).
HAND_WRITTEN_EXCEPTIONS = {
    "build",
    "serve",
}

# Optional helper modules that are not migrated-domain wrappers.
NON_DOMAIN_HELPERS = {
    "enhance",
}


class TestCatalogDispatcherExists:
    """The generic catalog-driven dispatcher must exist and expose the required API."""

    def test_catalog_dispatch_file_exists(self):
        dispatch_file = CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        assert dispatch_file.exists(), (
            "codedmap/cli/commands/_catalog_dispatch.py must exist — "
            "this is the generic catalog-driven CLI dispatcher created in Plan 03-05."
        )

    def test_catalog_dispatch_provides_register_function(self):
        """_catalog_dispatch.py must expose register_catalog_domain."""
        dispatch_file = CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        if not dispatch_file.exists():
            pytest.skip("_catalog_dispatch.py not found")
        source = dispatch_file.read_text(encoding="utf-8")
        assert "register_catalog_domain" in source, (
            "_catalog_dispatch.py must define register_catalog_domain() — "
            "this is the primary registration function used by __main__.py."
        )

    def test_catalog_dispatch_provides_dispatch_function(self):
        """_catalog_dispatch.py must expose dispatch_catalog_command."""
        dispatch_file = CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        if not dispatch_file.exists():
            pytest.skip("_catalog_dispatch.py not found")
        source = dispatch_file.read_text(encoding="utf-8")
        assert "dispatch_catalog_command" in source, (
            "_catalog_dispatch.py must define dispatch_catalog_command() — "
            "this is the execution dispatch function."
        )

    def test_catalog_dispatch_uses_catalog(self):
        """_catalog_dispatch.py must import from the catalog SSOT."""
        dispatch_file = CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        if not dispatch_file.exists():
            pytest.skip("_catalog_dispatch.py not found")
        source = dispatch_file.read_text(encoding="utf-8")
        assert "catalog" in source, (
            "_catalog_dispatch.py must import from codedmap.core.schema.catalog."
        )
        assert "DOMAIN_DESCRIPTIONS" in source or "get_catalog" in source or "CATALOG" in source, (
            "_catalog_dispatch.py must use catalog SSOT for domain descriptions or command routing."
        )

    def test_catalog_dispatch_is_thin_local_adapter(self):
        """_catalog_dispatch must not embed local business/store logic."""
        dispatch_file = CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        source = dispatch_file.read_text(encoding="utf-8")
        forbidden = ["create_store(", "GraphPatch", "TagEngine(", "CPGStore("]
        violations = [token for token in forbidden if token in source]
        assert not violations, (
            "_catalog_dispatch.py should be thin adapter-only registration/dispatch.\n"
            f"Forbidden local business tokens found: {violations}"
        )


class TestMainUsesGenericDispatcher:
    """__main__.py must use register_catalog_domain for all migrated domains."""

    def test_main_imports_catalog_dispatch(self):
        main_file = CLI_DIR / "__main__.py"
        assert main_file.exists(), "__main__.py must exist"
        source = main_file.read_text(encoding="utf-8")
        assert "_catalog_dispatch" in source, (
            "__main__.py must import _catalog_dispatch — "
            "all migrated domains are registered via the generic dispatcher."
        )

    def test_main_uses_register_catalog_domain(self):
        main_file = CLI_DIR / "__main__.py"
        source = main_file.read_text(encoding="utf-8")
        assert "register_catalog_domain" in source, (
            "__main__.py must call register_catalog_domain() for migrated domains."
        )

    def test_main_does_not_import_migrated_domain_wrappers(self):
        """__main__.py must NOT import per-domain command modules for migrated domains."""
        main_file = CLI_DIR / "__main__.py"
        source = main_file.read_text(encoding="utf-8")
        forbidden_imports = [
            f"from codedmap.cli.commands import {d}" for d in MIGRATED_DOMAINS
        ] + [
            f"commands import {d}" for d in MIGRATED_DOMAINS
        ]
        violations = []
        for pattern in forbidden_imports:
            if pattern in source:
                violations.append(pattern)
        assert not violations, (
            f"__main__.py imports migrated-domain wrapper modules directly: {violations}\n"
            "Migrated domains must use register_catalog_domain() from _catalog_dispatch, "
            "not individual per-domain wrapper imports."
        )

    def test_main_still_registers_build_and_serve(self):
        """__main__.py must explicitly register build and serve as CLI-native exceptions."""
        main_file = CLI_DIR / "__main__.py"
        source = main_file.read_text(encoding="utf-8")
        assert "build" in source, "__main__.py must register 'build' as explicit CLI exception"
        assert "serve" in source, "__main__.py must register 'serve' as explicit CLI exception"


class TestMigratedDomainWrappersDeleted:
    """Per-domain wrapper files for migrated domains must NOT exist (anti-regression)."""

    def test_query_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "query.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/query.py must be deleted — "
            "'query' domain is now registered via _catalog_dispatch (Plan 03-05). "
            "Reintroducing this file violates the cli_shell_convergence terminal state."
        )

    def test_note_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "note.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/note.py must be deleted — "
            "'note' domain is now registered via _catalog_dispatch (Plan 03-05)."
        )

    def test_tag_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "tag.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/tag.py must be deleted — "
            "'tag' domain is now registered via _catalog_dispatch (Plan 03-05)."
        )

    def test_module_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "module.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/module.py must be deleted — "
            "'module' domain is now registered via _catalog_dispatch (Plan 03-05)."
        )

    def test_repair_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "repair.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/repair.py must be deleted — "
            "'repair' domain is now registered via _catalog_dispatch (Plan 03-05)."
        )

    def test_rules_wrapper_deleted(self):
        fpath = CLI_COMMANDS_DIR / "rules.py"
        assert not fpath.exists(), (
            "codedmap/cli/commands/rules.py must be deleted — "
            "'rules' domain is now registered via _catalog_dispatch (Plan 03-05)."
        )


class TestBuildAndServeExceptions:
    """build and serve are the allowed non-catalog hand-written CLI exceptions."""

    def test_build_exists_as_cli_command(self):
        build_file = CLI_COMMANDS_DIR / "build.py"
        assert build_file.exists(), "build.py CLI command must exist (it's a CLI-native operation)"

    def test_serve_exists_as_cli_command(self):
        serve_file = CLI_COMMANDS_DIR / "serve.py"
        assert serve_file.exists(), "serve.py CLI command must exist (it's a CLI-native operation)"


class TestQuerySubcommandsRemoved:
    """Query leaf command files should be removed after full service-layer convergence."""

    def test_query_subcommand_files_deleted(self):
        removed = {
            "search", "inspect", "trace", "entrypoints", "tree",
            "sources", "sinks", "guards", "sanitizers", "roles", "stats",
        }
        violations = []
        for name in removed:
            fpath = CLI_COMMANDS_DIR / f"{name}.py"
            if fpath.exists():
                violations.append(str(fpath))
        assert not violations, (
            "Query leaf command files should be deleted after catalog/service convergence:\n"
            + "\n".join(f"  {f}" for f in violations)
        )


class TestNoDomainWrapperRegression:
    """No new per-domain wrapper file may be introduced for migrated domains."""

    def test_no_unknown_non_catalog_wrapper_files(self):
        """Every CLI command file must be either: a known exception, non-domain helper,
        the generic dispatcher, or NOT a migrated-domain name."""
        all_known = (
            HAND_WRITTEN_EXCEPTIONS
            | NON_DOMAIN_HELPERS
            | {"_catalog_dispatch"}
        )
        violations = []
        for fpath in CLI_COMMANDS_DIR.glob("*.py"):
            if fpath.name.startswith("_") or fpath.name == "__init__.py":
                continue
            stem = fpath.stem
            if stem in all_known:
                continue
            # New file that is a migrated-domain name is forbidden
            if stem in MIGRATED_DOMAINS:
                violations.append(str(fpath))

        assert not violations, (
            "Per-domain wrapper file(s) found for migrated domains:\n"
            + "\n".join(f"  {f}" for f in violations)
            + "\nMigrated domains must use register_catalog_domain() from _catalog_dispatch. "
            "Per-domain wrappers were removed in Plan 03-05 and must not be reintroduced."
        )
