"""
Architecture guard: adapter -> service one-way dependency direction.

Enforces:
1. codedmap/app/services/* must NOT import codedmap.api.* or codedmap.cli.*
2. codedmap/api/* must NOT import codedmap.cli.commands.* except the
   explicit build->enhance CLI-native exception.
"""

import ast
import pathlib

APP_SERVICES_ROOT = pathlib.Path("codedmap/app/services")
API_ROOT = pathlib.Path("codedmap/api")


def _collect_imports(source: str) -> list[tuple[str, int]]:
    tree = ast.parse(source)
    imports: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append((alias.name, node.lineno))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append((node.module, node.lineno))
    return imports


class TestServiceLayerDirection:
    def test_app_services_has_no_api_or_cli_imports(self):
        violations: list[str] = []
        for fpath in APP_SERVICES_ROOT.rglob("*.py"):
            source = fpath.read_text(encoding="utf-8")
            for mod_name, lineno in _collect_imports(source):
                if mod_name.startswith("codedmap.api") or mod_name.startswith("codedmap.cli"):
                    violations.append(f"{fpath}:{lineno} -> {mod_name}")

        assert not violations, (
            "app/services must be adapter-agnostic (no imports from api/cli).\n"
            "Violations:\n" + "\n".join(f"  {v}" for v in violations)
        )

    def test_api_does_not_import_cli_commands_except_build_enhance(self):
        violations: list[str] = []
        for fpath in API_ROOT.rglob("*.py"):
            source = fpath.read_text(encoding="utf-8")
            for mod_name, lineno in _collect_imports(source):
                if not mod_name.startswith("codedmap.cli.commands"):
                    continue
                # Explicit exception: codedmap/api/routers/build.py imports enhance.
                if (
                    fpath.as_posix().endswith("codedmap/api/routers/build.py")
                    and mod_name == "codedmap.cli.commands.enhance"
                ):
                    continue
                violations.append(f"{fpath}:{lineno} -> {mod_name}")

        assert not violations, (
            "api must not depend on cli.commands (except build->enhance exception).\n"
            "Violations:\n" + "\n".join(f"  {v}" for v in violations)
        )
