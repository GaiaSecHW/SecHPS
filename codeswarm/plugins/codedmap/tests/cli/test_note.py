"""Note command tests via catalog registration + shared contracts."""

from argparse import ArgumentParser
from contextlib import nullcontext
import pytest

from codedmap.app.query.note_validation import NoteSchemaValidationError
from codedmap.app.contracts.service import CommandRequest, ExecutionContext
from codedmap.cli._bootstrap import _build_local_command_executor
from codedmap.cli.commands._catalog_dispatch import register_catalog_domain


def test_note_add_parser_contract():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(
        [
            "note",
            "add",
            "Incident title",
            "Body content",
            "--category",
            "COORDINATION",
        ]
    )
    assert ns.command == "note"
    assert ns.note_action == "add"
    assert ns.title == "Incident title"
    assert ns.content == "Body content"


def test_note_show_parser_contract():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(["note", "show", "123"])
    assert ns.command == "note"
    assert ns.note_action == "show"
    assert ns.note_id == "123"


def test_note_list_parser_contract():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(["note", "list"])
    assert ns.command == "note"
    assert ns.note_action == "list"


def test_note_add_parser_accepts_layering_flags():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(
        [
            "note",
            "add",
            "Layered title",
            "{}",
            "--scope",
            "campaign",
            "--knowledge-class",
            "assessment",
            "--campaign-id",
            "cmp_123",
        ]
    )
    assert ns.scope == "campaign"
    assert ns.knowledge_class == "assessment"
    assert ns.campaign_id == "cmp_123"


def test_note_list_parser_accepts_layering_filters():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(
        [
            "note",
            "list",
            "--scope",
            "stable_confirmed",
            "--knowledge-class",
            "fact",
            "--campaign-id",
            "cmp_123",
        ]
    )
    assert ns.scope == "stable_confirmed"
    assert ns.knowledge_class == "fact"
    assert ns.campaign_id == "cmp_123"


def test_note_list_parser_accepts_scope_all():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(
        [
            "note",
            "list",
            "--scope",
            "all",
        ]
    )
    assert ns.scope == "all"


def test_note_list_parser_rejects_scope_all_with_campaign_id():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")

    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "note",
                "list",
                "--scope",
                "all",
                "--campaign-id",
                "cmp_123",
            ]
        )


def test_note_list_help_mentions_scope_defaults_and_conflict():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")

    subparsers_action = next(action for action in parser._actions if getattr(action, "choices", None))
    note_parser = subparsers_action.choices["note"]
    note_subparsers_action = next(action for action in note_parser._actions if getattr(action, "choices", None))
    note_list_parser = note_subparsers_action.choices["list"]

    help_text = " ".join(note_list_parser.format_help().split())

    assert "current campaign + stable_confirmed" in help_text
    assert "campaign, stable_candidate, stable_confirmed, or all" in help_text
    assert "Cannot be used with --scope all" in help_text


def test_note_promote_parser_contract():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(["note", "promote", "123"])
    assert ns.command == "note"
    assert ns.note_action == "promote"
    assert ns.note_id == "123"


def test_note_confirm_parser_contract():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(["note", "confirm", "123"])
    assert ns.command == "note"
    assert ns.note_action == "confirm"
    assert ns.note_id == "123"


def test_note_parser_accepts_debug_flag():
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")
    ns = parser.parse_args(["note", "list", "--debug"])
    assert ns.command == "note"
    assert ns.note_action == "list"
    assert ns.debug is True


def test_note_list_executor_forwards_layering_filters(monkeypatch):
    import codedmap.cli._bootstrap as bootstrap
    from codedmap.app.services import domain_services as svc

    captured = {}

    monkeypatch.setattr(bootstrap, "create_store", lambda ns: nullcontext(object()))

    def fake_note_list(store, **kwargs):
        captured["store"] = store
        captured["kwargs"] = kwargs
        return {"notes": [], "total": 0, "offset": 0, "limit": 50, "has_more": False, "truncated": False}

    monkeypatch.setattr(svc, "note_list", fake_note_list)

    executor = _build_local_command_executor()
    response = executor.execute(CommandRequest(
        tool_name="note_list",
        params={
            "scope": "stable_confirmed",
            "knowledge_class": "fact",
            "campaign_id": "cmp_123",
        },
        context=ExecutionContext(db="ignored.db", backend="sqlite"),
    ))

    assert response.success is True
    assert captured["kwargs"]["scope"] == "stable_confirmed"
    assert captured["kwargs"]["knowledge_class"] == "fact"
    assert captured["kwargs"]["campaign_id"] == "cmp_123"


def test_note_add_executor_forwards_layering_fields(monkeypatch):
    import codedmap.cli._bootstrap as bootstrap
    from codedmap.app.services import domain_services as svc

    captured = {}

    monkeypatch.setattr(bootstrap, "create_store", lambda ns: nullcontext(object()))

    def fake_note_add(store, **kwargs):
        captured["store"] = store
        captured["kwargs"] = kwargs
        return {"id": 1}

    monkeypatch.setattr(svc, "note_add", fake_note_add)

    executor = _build_local_command_executor()
    response = executor.execute(CommandRequest(
        tool_name="note_add",
        params={
            "title": "Layered title",
            "content": "{}",
            "scope": "campaign",
            "knowledge_class": "assessment",
            "campaign_id": "cmp_123",
        },
        context=ExecutionContext(db="ignored.db", backend="sqlite"),
    ))

    assert response.success is True
    assert captured["kwargs"]["scope"] == "campaign"
    assert captured["kwargs"]["knowledge_class"] == "assessment"
    assert captured["kwargs"]["campaign_id"] == "cmp_123"


def test_note_schema_validation_error_contract():
    err = NoteSchemaValidationError(
        message="test error",
        details={
            "category": "COORDINATION",
            "expected_schema": {},
            "validation_errors": [{"loc": [], "msg": "x", "type": "y"}],
            "raw_content_excerpt": "...",
        },
    )
    assert err.code == "SCHEMA_VALIDATION_ERROR"
    assert "category" in err.details
    assert "expected_schema" in err.details
    assert "validation_errors" in err.details
    assert "raw_content_excerpt" in err.details
