from __future__ import annotations

import sys
import types


def test_catalog_transport_debug_logs_post_request(monkeypatch, capsys):
    from codedmap.client import sdk

    captured = {}

    class FakeResponse:
        status_code = 200
        text = '{"success": true}'

        def json(self):
            return {"success": True}

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    fake_httpx = types.SimpleNamespace(Client=FakeClient)
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    transport = sdk.CatalogTransport(
        "http://127.0.0.1:8000",
        agent_id="map_surveyor",
        timeout=12.0,
        debug=True,
    )

    response = transport.execute(
        "note_add",
        {
            "title": "Survey_Handoff",
            "content": "{}",
            "scope": "campaign",
            "campaign_id": "cmp_123",
        },
    )

    assert response == {"success": True}
    stderr = capsys.readouterr().err
    assert "HTTP POST http://127.0.0.1:8000/note/add" in stderr
    assert '"campaign_id": "cmp_123"' in stderr
    assert '"scope": "campaign"' in stderr
