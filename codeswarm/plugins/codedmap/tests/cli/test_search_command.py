"""Query search contract tests (catalog + service layer)."""

from codedmap.core.schema.catalog import get_command
from codedmap.core.schema.graph.enums import NodeLabel


def test_query_search_catalog_schema_contains_expected_fields():
    cmd = get_command("query_search")
    assert cmd is not None
    fields = set(cmd.input_model.model_fields.keys())
    assert {"pattern", "type", "limit", "module", "module_id"} <= fields


def test_query_search_default_type_is_method():
    cmd = get_command("query_search")
    model = cmd.input_model(pattern="foo")
    assert model.type == "method"


def test_query_search_type_values_are_valid_node_families():
    # query_search currently supports method/call/identifier.
    # Validate these map to existing node labels in the graph schema.
    assert NodeLabel("METHOD")
    assert NodeLabel("CALL")
    assert NodeLabel("IDENTIFIER")
