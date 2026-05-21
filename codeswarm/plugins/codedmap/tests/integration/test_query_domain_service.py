"""
TDD tests for Plan 03-02, Task 3: query domain migration.

RED phase: These tests document the migrated state for query domain.
They fail before implementation and pass after query.py router is cleaned.

Contract:
- API query router does NOT import from codedmap.cli.commands.entrypoints
- API query router does NOT import from codedmap.cli.commands.roles
- domain_services.py exposes query_entrypoints_parse_tags, query_roles_parse_tags
"""

import pathlib
import pytest


class TestQueryRouterIsClean:
    """query.py API router must not import from cli.commands.entrypoints or cli.commands.roles."""

    QUERY_ROUTER_PATH = pathlib.Path("codedmap/api/routers/query.py")

    def test_query_router_has_no_entrypoints_import(self):
        source = self.QUERY_ROUTER_PATH.read_text(encoding="utf-8")
        assert "codedmap.cli.commands.entrypoints" not in source, (
            "query.py still imports from codedmap.cli.commands.entrypoints — "
            "use domain_services.query_entrypoints_parse_tags instead"
        )

    def test_query_router_has_no_roles_import(self):
        source = self.QUERY_ROUTER_PATH.read_text(encoding="utf-8")
        assert "codedmap.cli.commands.roles" not in source, (
            "query.py still imports from codedmap.cli.commands.roles — "
            "use domain_services.query_roles_parse_tags instead"
        )


class TestQueryServiceHelpersExist:
    """domain_services.py must export query helper functions."""

    def test_query_entrypoints_parse_tags_callable(self):
        from codedmap.app.services.domain_services import query_entrypoints_parse_tags
        assert callable(query_entrypoints_parse_tags)

    def test_query_roles_parse_tags_callable(self):
        from codedmap.app.services.domain_services import query_roles_parse_tags
        assert callable(query_roles_parse_tags)

    def test_query_entrypoints_parse_tags_l1_ontology(self):
        from codedmap.app.services.domain_services import query_entrypoints_parse_tags
        tags = ["ONTOLOGY:ENTRY_POINT:HTTP:route_handler"]
        level, category, rule = query_entrypoints_parse_tags(tags)
        assert level == "L1"
        assert category == "HTTP"
        assert rule == "route_handler"

    def test_query_entrypoints_parse_tags_l2_semantic(self):
        from codedmap.app.services.domain_services import query_entrypoints_parse_tags
        tags = ["SEMANTIC:ENTRY_POINT:CLI:main_func"]
        level, category, rule = query_entrypoints_parse_tags(tags)
        assert level == "L2"
        assert category == "CLI"
        assert rule == "main_func"

    def test_query_entrypoints_parse_tags_empty(self):
        from codedmap.app.services.domain_services import query_entrypoints_parse_tags
        level, category, rule = query_entrypoints_parse_tags([])
        assert level is None
        assert category is None
        assert rule is None

    def test_query_roles_parse_tags_ontology(self):
        from codedmap.app.services.domain_services import query_roles_parse_tags
        tags = ["ONTOLOGY:ROLE:BOUNDARY"]
        role = query_roles_parse_tags(tags)
        assert role == "BOUNDARY"

    def test_query_roles_parse_tags_semantic(self):
        from codedmap.app.services.domain_services import query_roles_parse_tags
        tags = ["SEMANTIC:ROLE:DRIVER"]
        role = query_roles_parse_tags(tags)
        assert role == "DRIVER"

    def test_query_roles_parse_tags_empty(self):
        from codedmap.app.services.domain_services import query_roles_parse_tags
        role = query_roles_parse_tags([])
        assert role is None
