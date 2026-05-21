"""Unit tests for Role model layer: RoleCategory, Role."""

import sys
import os
import pytest

sys.path.append(os.getcwd())

from codedmap.core.schema.security.role_models import RoleCategory, Role


class TestRoleCategory:
    """RoleCategory has exactly 7 UPPERCASE values."""

    def test_has_all_values(self):
        assert RoleCategory.BOUNDARY.value == "BOUNDARY"
        assert RoleCategory.LOGIC_PROVIDER.value == "LOGIC_PROVIDER"
        assert RoleCategory.DATA_STORAGE.value == "DATA_STORAGE"
        assert RoleCategory.INFRASTRUCTURE.value == "INFRASTRUCTURE"
        assert RoleCategory.DRIVER.value == "DRIVER"
        assert RoleCategory.KERNEL_CORE.value == "KERNEL_CORE"
        assert RoleCategory.UTILITY.value == "UTILITY"

    def test_exactly_7_values(self):
        assert len(RoleCategory) == 7

    def test_all_values_uppercase(self):
        for cat in RoleCategory:
            assert cat.value == cat.value.upper()

    def test_bad_value_raises(self):
        with pytest.raises(ValueError):
            RoleCategory("bad_value")


class TestRole:
    """Role dataclass with full_tag, to_dict, from_dict."""

    def _make_role(self, **kwargs):
        defaults = {
            "node_id": 50001,
            "name": "handle_request",
            "file": "server.c",
            "line": 100,
            "category": RoleCategory.BOUNDARY,
        }
        defaults.update(kwargs)
        return Role(**defaults)

    def test_full_tag_boundary(self):
        r = self._make_role(category=RoleCategory.BOUNDARY)
        assert r.full_tag == "ONTOLOGY:ROLE:BOUNDARY"

    def test_full_tag_all_categories(self):
        for cat in RoleCategory:
            r = self._make_role(category=cat)
            assert r.full_tag == f"ONTOLOGY:ROLE:{cat.value}"

    def test_to_dict_shape(self):
        r = self._make_role(justification="Entry point for HTTP requests")
        d = r.to_dict()
        assert d["id"] == 50001
        assert d["label"] == "METHOD"
        assert d["name"] == "handle_request"
        assert d["category"] == "BOUNDARY"
        assert d["full_tag"] == "ONTOLOGY:ROLE:BOUNDARY"
        assert d["justification"] == "Entry point for HTTP requests"

    def test_from_dict_round_trip(self):
        r = self._make_role(justification="Core logic")
        d = r.to_dict()
        r2 = Role.from_dict(d)
        assert r2.node_id == r.node_id
        assert r2.category == r.category
        assert r2.justification == r.justification

    def test_default_tags_empty(self):
        r = self._make_role()
        assert r.tags == []

    def test_default_justification_none(self):
        r = self._make_role()
        assert r.justification is None


class TestImportSanity:
    """Role types importable from codedmap.core.schema.security."""

    def test_import_role_category(self):
        from codedmap.core.schema.security import RoleCategory
        assert RoleCategory.BOUNDARY is not None

    def test_import_role(self):
        from codedmap.core.schema.security import Role
        assert Role is not None
