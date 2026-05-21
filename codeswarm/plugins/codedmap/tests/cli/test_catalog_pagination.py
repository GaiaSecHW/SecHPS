from codedmap.core.schema.catalog import get_command


def test_catalog_marks_module_list_as_paginable():
    cmd = get_command("module_list")
    assert cmd is not None
    assert cmd.pagination_enabled is True
    assert cmd.default_limit == 50
    assert cmd.max_limit == 500


def test_catalog_tool_dict_contains_pagination_metadata():
    cmd = get_command("query_search")
    assert cmd is not None
    payload = cmd.to_tool_dict()
    assert "pagination" in payload
    assert payload["pagination"]["enabled"] is True
    assert payload["pagination"]["default_limit"] == 20
