"""
Architecture guard: stdout-capture anti-pattern ban.

The pattern:
    buf = io.StringIO()
    sys.stdout = buf
    run_fn(args)
    sys.stdout = old_stdout
    output = buf.getvalue()

...is fully banned inside codedmap/api/. It was used as a shortcut to bridge
API routers to CLI commands before a service layer existed. It causes:
- Non-deterministic output encoding
- No structured error handling
- Silent swallowing of exceptions
- Hidden coupling to argparse.Namespace-style argument objects

This test documents known violations and hard-fails on any new ones.
"""

import pathlib
import pytest

API_ROOT = pathlib.Path("codedmap/api")

# Patterns that identify stdout-capture anti-pattern usage
STDOUT_CAPTURE_PATTERNS = [
    "sys.stdout =",       # direct stdout reassignment
    "io.StringIO()",      # creating string buffer for capture
    "_capture_run",       # the explicit helper function name used in rules.py
    "buf.getvalue()",     # reading captured output buffer
]


def _file_has_stdout_capture(source: str) -> list[str]:
    """Return list of matching patterns found in source."""
    matches = []
    for pattern in STDOUT_CAPTURE_PATTERNS:
        if pattern in source:
            matches.append(pattern)
    return matches


def _collect_api_python_files():
    return list(API_ROOT.rglob("*.py"))


class TestNoStdoutCaptureInApi:
    """API layer must not use stdout-capture to execute business commands."""

    def test_no_new_stdout_capture_files(self):
        """Hard gate: only known legacy files may contain stdout-capture patterns.

        Known violators are documented below. Adding a new file with these patterns
        is a regression and must fail CI immediately.
        """
        # rules.py and repair.py both migrated in 03-02 — no more known violators
        KNOWN_VIOLATORS: set = set()

        new_violators = []
        for fpath in _collect_api_python_files():
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            matches = _file_has_stdout_capture(source)
            if matches and fpath.name not in KNOWN_VIOLATORS:
                new_violators.append(
                    f"{fpath}: patterns found = {matches}"
                )

        assert not new_violators, (
            "NEW stdout-capture pattern detected in api/ — this is banned.\n"
            "Replace with service layer calls.\nNew violations:\n"
            + "\n".join(f"  {v}" for v in new_violators)
        )

    def test_capture_run_helper_not_in_new_files(self):
        """_capture_run helper pattern must not appear in any non-legacy router."""
        # all routers migrated in 03-02 — no legacy allowed
        ALLOWED_LEGACY: set = set()
        violators = []
        for fpath in _collect_api_python_files():
            if fpath.name in ALLOWED_LEGACY:
                continue
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if "_capture_run" in source:
                violators.append(str(fpath))

        assert not violators, (
            "_capture_run pattern found in non-legacy files (banned):\n"
            + "\n".join(f"  {v}" for v in violators)
        )

    def test_legacy_violator_count_stable(self):
        """The number of violating files must not grow — only decrease as migration proceeds."""
        violating_files = set()
        for fpath in _collect_api_python_files():
            try:
                source = fpath.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if _file_has_stdout_capture(source):
                violating_files.add(fpath.name)

        VIOLATION_CEILING = 0  # rules.py and repair.py both migrated in 03-02
        assert len(violating_files) <= VIOLATION_CEILING, (
            f"stdout-capture violator count ({len(violating_files)}) exceeds ceiling ({VIOLATION_CEILING}).\n"
            f"Violators: {sorted(violating_files)}\n"
            "This anti-pattern must be removed, not added."
        )
