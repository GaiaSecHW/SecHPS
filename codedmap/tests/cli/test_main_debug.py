import logging
import sys


def test_main_debug_flag_enables_debug_logging(monkeypatch):
    import codedmap.cli.__main__ as cli_main
    import codedmap.cli.commands._catalog_dispatch as catalog_dispatch

    seen = {"basic": False, "root": None, "dispatched": False}

    def _fake_basic_config(**kwargs):
        seen["basic"] = kwargs.get("level") == logging.DEBUG

    def _fake_dispatch(_args, _domain):
        seen["dispatched"] = True

    monkeypatch.setattr(logging, "basicConfig", _fake_basic_config)
    monkeypatch.setattr(catalog_dispatch, "dispatch_catalog_command", _fake_dispatch)
    monkeypatch.setattr(sys, "argv", ["cdm", "--debug", "note", "list"])

    cli_main.main()

    seen["root"] = logging.getLogger().level
    assert seen["basic"] is True
    assert seen["root"] == logging.DEBUG
    assert seen["dispatched"] is True
