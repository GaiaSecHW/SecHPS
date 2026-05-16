"""
TDD: Tag/note domain service migration guards.

These tests verify the target state after Plan 03-03 Task 1 (tag/note migration):
1. Tag/note service functions exist in codedmap.app.services.domain_services
2. Tag/note API routers import from codedmap.app.services (not directly from TagEngine)
3. API tag/note routers have no direct TagEngine/CPG imports at module top-level

RED phase: will fail before implementation, pass after.
"""

import importlib
import inspect
import pathlib
import pytest


class TestTagNoteDomainServicesExist:
    """Tag/note service functions must exist in the shared domain_services module."""

    def test_tag_list_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "tag_list"), (
            "domain_services must have a tag_list() function — "
            "tag list business logic belongs in shared services"
        )

    def test_tag_find_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "tag_find"), (
            "domain_services must have a tag_find() function"
        )

    def test_tag_add_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "tag_add"), (
            "domain_services must have a tag_add() function"
        )

    def test_tag_remove_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "tag_remove"), (
            "domain_services must have a tag_remove() function"
        )

    def test_note_list_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "note_list"), (
            "domain_services must have a note_list() function"
        )

    def test_note_add_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "note_add"), (
            "domain_services must have a note_add() function"
        )

    def test_note_show_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "note_show"), (
            "domain_services must have a note_show() function"
        )

    def test_note_remove_service_exists(self):
        mod = importlib.import_module("codedmap.app.services.domain_services")
        assert hasattr(mod, "note_remove"), (
            "domain_services must have a note_remove() function"
        )


class TestTagNoteRouterUsesSharedServices:
    """Tag/note API routers must import from codedmap.app.services.*"""

    def test_tag_router_imports_from_app_services(self):
        tag_router = pathlib.Path("codedmap/api/routers/tag.py")
        source = tag_router.read_text(encoding="utf-8")
        assert "from codedmap.app.services" in source or "codedmap.app.services" in source, (
            "codedmap/api/routers/tag.py must import from codedmap.app.services — "
            "the router must delegate to shared service functions"
        )

    def test_note_router_imports_from_app_services(self):
        note_router = pathlib.Path("codedmap/api/routers/note.py")
        source = note_router.read_text(encoding="utf-8")
        assert "from codedmap.app.services" in source or "codedmap.app.services" in source, (
            "codedmap/api/routers/note.py must import from codedmap.app.services — "
            "the router must delegate to shared service functions"
        )


class TestTagNoteRouterNotImportingDirectly:
    """Tag/note routers must not import TagEngine directly at module top-level.

    TagEngine is an implementation detail that belongs in service functions.
    Routers that import TagEngine directly are implementing business logic in
    the adapter layer — a policy violation.
    """

    def test_tag_router_no_direct_tagengine_import(self):
        """tag.py router must not do 'from codedmap.analysis.tagging.engine import TagEngine'
        at module top level — it should call tag service functions instead."""
        import ast
        tag_router = pathlib.Path("codedmap/api/routers/tag.py")
        source = tag_router.read_text(encoding="utf-8")
        tree = ast.parse(source)

        direct_tagengine_imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if "tagging.engine" in mod or "TagEngine" in mod:
                    # Check if this is at module top level (not inside a function)
                    # We check by looking at parent context — top-level imports have col_offset=0
                    if node.col_offset == 0:
                        direct_tagengine_imports.append(f"line {node.lineno}")

        assert not direct_tagengine_imports, (
            "codedmap/api/routers/tag.py has top-level TagEngine imports. "
            "This means the router is doing business logic directly. "
            "Move to domain_services.tag_* functions instead.\n"
            f"Found at: {direct_tagengine_imports}"
        )
