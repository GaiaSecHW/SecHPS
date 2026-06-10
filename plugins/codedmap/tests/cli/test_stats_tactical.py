"""Stats command tests via service execution boundary."""

from codedmap.app.services import query_services


def test_query_stats_cli_envelope_without_scope(monkeypatch):
    def _fake_stats_summary(store, module=None, module_id=None):
        return {
            "result": {"total_nodes": 7, "methods": 3},
            "total": 7,
            "scope": None,
        }

    monkeypatch.setattr(query_services, "stats_summary", _fake_stats_summary)
    payload = query_services.execute_query_tool("query_stats", store=object(), params={})

    assert payload["__cli_envelope__"] is True
    assert payload["command"] == "stats"
    assert payload["metadata"]["total"] == 7
    assert payload["result"]["kind"] == "stats"
    assert payload["result"]["content"]["methods"] == 3


def test_query_stats_cli_envelope_with_scope(monkeypatch):
    class _Scope:
        def to_metadata_dict(self):
            return {"name": "network", "file_count": 2, "method_count": 4}

    def _fake_stats_summary(store, module=None, module_id=None):
        return {
            "result": {"total_nodes": 4, "methods": 4},
            "total": 4,
            "scope": _Scope(),
        }

    monkeypatch.setattr(query_services, "stats_summary", _fake_stats_summary)
    payload = query_services.execute_query_tool("query_stats", store=object(), params={"module": "network"})

    assert payload["metadata"]["total"] == 4
    assert payload["metadata"]["module_scope"]["name"] == "network"
