"""
Architecture guard: forbidden imports in codedmap.api.

Blocks:
1. codedmap/api/* importing from codedmap/cli/commands/*
   (CLI commands must not be used as business-logic providers by the API)
2. Any new import cross-contamination that restores banned patterns.

These tests are CI-failing hard guards. Adding an allowed exception here requires
a Phase 03 decision with explicit justification — not a casual code change.
"""

import ast
import pathlib
import pytest

API_ROOT = pathlib.Path("codedmap/api")
FORBIDDEN_CLI_COMMANDS_PREFIX = "codedmap.cli.commands"


def _collect_imports(source: str) -> list[tuple[str, int]]:
    """Return (module_name, lineno) for all import statements in source."""
    tree = ast.parse(source)
    results = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                results.append((alias.name, node.lineno))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                results.append((node.module, node.lineno))
    return results


def _collect_api_python_files():
    return list(API_ROOT.rglob("*.py"))


class TestNoCliCommandImportsInApi:
    """codedmap/api/* must never import from codedmap.cli.commands.*"""

    def test_no_cli_command_imports_found(self):
        """Hard CI gate: assert zero forbidden import patterns.

        Currently the codebase has violations (rules.py, repair.py, query.py, build.py, module.py).
        This test tracks and explicitly documents the KNOWN violations.
        As each domain is migrated in Plans 03-02 through 03-05, its violation must be
        removed here. Failing this test after migration = regression.

        During Plan 03-01 (foundations), we document violations without failing,
        to establish the baseline. Plans 03-02+ will clean each one.
        """
        violations: list[str] = []
        for fpath in _collect_api_python_files():
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            imports = _collect_imports(source)
            for mod_name, lineno in imports:
                if mod_name.startswith(FORBIDDEN_CLI_COMMANDS_PREFIX):
                    violations.append(f"{fpath}:{lineno} imports {mod_name!r}")

        # Phase 03-02: rules.py, module.py, repair.py, query.py all migrated.
        # Only build.py's enhance import remains (CLI-native by design — intentional exception).
        KNOWN_VIOLATIONS_BASELINE = {
            "codedmap.cli.commands.enhance",     # build.py — CLI-native by design (exception)
        }

        new_violations = []
        for v in violations:
            is_known = any(known in v for known in KNOWN_VIOLATIONS_BASELINE)
            if not is_known:
                new_violations.append(v)

        assert not new_violations, (
            "NEW forbidden import detected — api/* must NOT import from cli.commands.*\n"
            "Remove the import and use the service layer instead.\n"
            "New violations:\n" + "\n".join(f"  {v}" for v in new_violations)
        )

    def test_violation_count_does_not_increase(self):
        """Violation count must not grow — migration only moves in one direction."""
        violations: list[str] = []
        for fpath in _collect_api_python_files():
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            imports = _collect_imports(source)
            for mod_name, lineno in imports:
                if mod_name.startswith(FORBIDDEN_CLI_COMMANDS_PREFIX):
                    violations.append(f"{fpath}:{lineno}")

        # As of Phase 03-02 Task 3: query.py also migrated, only build.py's enhance remains.
        # This ceiling MUST decrease as domains are migrated. It must never increase.
        VIOLATION_CEILING = 1  # reduced from 5 after query migration; only build.py:enhance remains
        assert len(violations) <= VIOLATION_CEILING, (
            f"Forbidden import count ({len(violations)}) exceeds ceiling ({VIOLATION_CEILING}). "
            "api/* is gaining new cli.commands.* imports — migration must move forward, not backward."
        )


class TestNoNewCrossContamination:
    """Verify no new api packages import cli commands beyond known routers."""

    def test_only_known_routers_have_cli_imports(self):
        """Only the known router files may have cli.commands imports.

        New routers must be designed without CLI command dependencies.
        """
        offending_files = set()
        for fpath in _collect_api_python_files():
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            imports = _collect_imports(source)
            for mod_name, _ in imports:
                if mod_name.startswith(FORBIDDEN_CLI_COMMANDS_PREFIX):
                    offending_files.add(fpath.name)
                    break

        # rules.py, module.py, repair.py, query.py all migrated after 03-02
        # build.py is CLI-native by design (allowed exception)
        ALLOWED_LEGACY_ROUTERS = {"build.py"}
        unexpected = offending_files - ALLOWED_LEGACY_ROUTERS
        assert not unexpected, (
            "Unexpected file(s) importing from cli.commands (not in legacy-router allowlist):\n"
            + "\n".join(f"  {f}" for f in sorted(unexpected))
            + "\nNew routers must not import cli.commands — use service layer."
        )
