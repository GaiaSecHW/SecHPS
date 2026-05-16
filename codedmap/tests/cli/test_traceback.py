"""Trace command behavior through catalog/service execution path."""

from codedmap.app.services import query_services


def test_execute_query_tool_trace_returns_cli_envelope(monkeypatch):
    def _fake_trace_nodes(**kwargs):
        return {
            "target": {"id": 1, "name": "sink", "file": "a.c", "line": 10, "label": "METHOD"},
            "result": {"nodes": [], "total": 0, "chain": [], "mode": "callers"},
            "total": 0,
            "scope": None,
        }

    monkeypatch.setattr(query_services, "trace_nodes", _fake_trace_nodes)

    payload = query_services.execute_query_tool(
        "query_trace",
        store=object(),
        params={"function": "sink", "depth": 3, "taint": False, "dataflow": False, "reachable": False},
    )

    assert payload["__cli_envelope__"] is True
    assert payload["command"] == "trace"
    assert payload["result"]["kind"] == "nodes"
    assert payload["result"]["content"] == []
    assert payload["metadata"]["limit"] == 3


def test_execute_query_tool_trace_reachable_mode(monkeypatch):
    def _fake_trace_nodes(**kwargs):
        return {
            "target": None,
            "result": {
                "reachable": True,
                "source": {"id": 1},
                "destination": {"id": 2},
                "path": [{"node_id": 1}, {"node_id": 2}],
                "path_length": 2,
                "mode": "reachable",
            },
            "total": 2,
            "scope": None,
        }

    monkeypatch.setattr(query_services, "trace_nodes", _fake_trace_nodes)

    payload = query_services.execute_query_tool(
        "query_trace",
        store=object(),
        params={"reachable": True, "from_function": "a", "to_function": "b"},
    )

    assert payload["result"]["kind"] == "object"
    assert payload["result"]["content"]["reachable"] is True
    assert payload["result"]["content"]["path_length"] == 2
