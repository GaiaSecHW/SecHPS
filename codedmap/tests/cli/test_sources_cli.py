"""Sources command tests via catalog + service execution path."""

import json
from argparse import ArgumentParser

from codedmap.app.services import query_services
from codedmap.cli.commands._catalog_dispatch import register_catalog_domain


def test_sources_subcommand_registered_under_query_domain():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "query")
    ns = parser.parse_args(["query", "sources", "--category", "ENV_VAR", "--limit", "5"])
    assert ns.command == "query"
    assert ns.query_action == "sources"
    assert ns.category == "ENV_VAR"
    assert ns.limit == 5


def test_query_sources_cli_envelope(monkeypatch):
    def _fake_list_sources(store, category=None, function_filter=None, limit=50, show_all=False):
        return {
            "nodes": [{"id": 101, "name": "getenv", "category": "ENV_VAR", "triggers": []}],
            "total": 1,
            "limit": limit,
            "has_more": False,
        }

    monkeypatch.setattr(query_services, "list_sources", _fake_list_sources)
    payload = query_services.execute_query_tool(
        "query_sources",
        store=object(),
        params={"category": "ENV_VAR", "limit": 50},
    )
    assert payload["__cli_envelope__"] is True
    assert payload["command"] == "sources"
    assert payload["metadata"]["total"] == 1
    assert payload["result"]["kind"] == "nodes"
    assert payload["result"]["content"][0]["name"] == "getenv"


def test_query_sources_json_serializable(monkeypatch):
    def _fake_list_sources(store, category=None, function_filter=None, limit=50, show_all=False):
        return {
            "nodes": [],
            "total": 0,
            "limit": limit,
            "has_more": False,
        }

    monkeypatch.setattr(query_services, "list_sources", _fake_list_sources)
    payload = query_services.execute_query_tool("query_sources", store=object(), params={})
    # keep contract as json-serializable dict for CLIResponse construction
    json.dumps(payload)
