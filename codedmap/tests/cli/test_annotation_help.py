from argparse import ArgumentParser

import pytest

from codedmap.cli.commands._catalog_dispatch import register_catalog_domain


def test_note_add_help_includes_category_contract(capsys):
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "note")

    with pytest.raises(SystemExit):
        parser.parse_args(["note", "add", "-h"])

    output = capsys.readouterr().out
    assert "ARCHITECTURE" in output
    assert "SECURITY_BOUNDARY" in output


def test_tag_domain_help_includes_layer_format_hint(capsys):
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "tag")

    with pytest.raises(SystemExit):
        parser.parse_args(["tag", "-h"])

    output = capsys.readouterr().out
    assert "ONTOLOGY:{NAMESPACE}:{NAME}" in output
    assert "SEMANTIC:{NAMESPACE}:{NAME}" in output


def test_tag_add_help_includes_l1_l2_l3_examples(capsys):
    parser = ArgumentParser(prog="cdm")
    sub = parser.add_subparsers(dest="command")
    register_catalog_domain(sub, "tag")

    with pytest.raises(SystemExit):
        parser.parse_args(["tag", "add", "-h"])

    output = capsys.readouterr().out
    assert "ONTOLOGY:" in output
    assert "SEMANTIC:" in output
    assert "STATE:" in output
    assert "ENTRY_POINT/SOURCE/SINK" in output
    assert "system-only" in output
