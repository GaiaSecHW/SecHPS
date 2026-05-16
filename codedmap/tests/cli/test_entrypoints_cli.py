"""Entrypoints command tests via catalog + service execution path."""

from argparse import ArgumentParser

from codedmap.app.services import query_services
from codedmap.cli.commands._catalog_dispatch import register_catalog_domain


def test_entrypoints_subcommand_registered_under_query_domain():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "query")
    ns = parser.parse_args(
        [
            "query",
            "entrypoints",
            "--level",
            "L1",
            "--category",
            "HTTP",
            "--type",
            "http",
            "--limit",
            "25",
        ]
    )
    assert ns.command == "query"
    assert ns.query_action == "entrypoints"
    assert ns.level == "L1"
    assert ns.category == "HTTP"
    assert ns.type == "http"
    assert ns.limit == 25


def test_query_entrypoints_cli_envelope(monkeypatch):
    class _Scope:
        def to_metadata_dict(self):
            return {"name": "network", "file_count": 2, "method_count": 3}

    def _fake_list_entrypoints(**kwargs):
        return {
            "nodes": [{"id": 1, "name": "main", "type": "http", "category": "HTTP"}],
            "total": 1,
            "limit": 50,
            "has_more": False,
            "scope": _Scope(),
            "display_nodes": [],
        }

    monkeypatch.setattr(query_services, "list_entrypoints", _fake_list_entrypoints)
    payload = query_services.execute_query_tool(
        "query_entrypoints",
        store=object(),
        params={"level": "L1", "category": "HTTP", "limit": 50},
    )

    assert payload["__cli_envelope__"] is True
    assert payload["command"] == "entrypoints"
    assert payload["metadata"]["total"] == 1
    assert payload["result"]["kind"] == "nodes"
    assert payload["result"]["content"][0]["name"] == "main"
    assert payload["metadata"]["module_scope"]["name"] == "network"
