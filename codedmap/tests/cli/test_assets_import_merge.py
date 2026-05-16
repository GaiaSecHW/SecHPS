"""
Tests for cpg assets — import, anchor, and merge subcommands; CLI registration.

Tests covered:
    test_import_dry_run_returns_counts
    test_import_tag_asset_applies_patch
    test_import_orphaned_asset_creates_report
    test_anchor_updates_asset_status
    test_assets_command_registered
    test_assets_register_creates_subparsers
"""

import argparse
import contextlib
import json
import os
import sys
from io import StringIO
from pathlib import Path

import pytest
import importlib.util

if importlib.util.find_spec("codedmap.cli.commands.assets") is None:
    pytest.skip(
        "Legacy assets CLI wrapper tests are obsolete after assets teardown.",
        allow_module_level=True,
    )

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph.nodes.declarations import MethodNode
from codedmap.core.graph_builder import CPGBuilder

from codedmap.cli.commands.assets import (
    AssetType,
    AssetRecord,
    AssetRegistry,
    SemanticSignature,
    _import_assets,
    _anchor_asset,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_method_node(node_id: int, name: str, full_name: str,
                      file_name: str = "src/main.c") -> MethodNode:
    return MethodNode(
        id=node_id,
        name=name,
        full_name=full_name,
        label=NodeLabel.METHOD,
        file_name=file_name,
        signature=f"void {name}()",
    )


def _make_sig(node_id: int, full_name: str, file_path: str = "src/main.c") -> SemanticSignature:
    import hashlib
    raw = "|".join([full_name, file_path, "METHOD"])
    content_hash = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return SemanticSignature(
        node_id=node_id,
        full_name=full_name,
        file_path=file_path,
        content_hash=content_hash,
    )


def _make_asset_file(tmp_path: Path, records: list) -> Path:
    asset_file = tmp_path / "test.assets.json"
    asset_file.write_text(json.dumps([r.model_dump(mode="json") for r in records], indent=2))
    return asset_file


@pytest.fixture
def method_store(tmp_path):
    """SQLite store with one METHOD node (id=1001, full_name='mod.process_data')."""
    db_path = str(tmp_path / "test.db")
    config = StorageConfig(backend="sqlite", uri=db_path)
    store = CPGStore(config)
    builder = CPGBuilder()
    m = _make_method_node(1001, "process_data", "mod.process_data")
    builder.graph.add_node(m)
    store.save(builder.get_graph())
    return store, db_path


def _make_args(**kwargs) -> argparse.Namespace:
    defaults = {
        "db": None,
        "backend": "sqlite",
        "output": "text",
        "asset_file": None,
        "dry_run": False,
        "asset_id": None,
        "target": None,
        "remote": "",
        "api_key": "",
    }
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


# ---------------------------------------------------------------------------
# Test: import dry-run returns counts without applying patch
# ---------------------------------------------------------------------------

def test_import_dry_run_returns_counts(method_store, tmp_path):
    store, db_path = method_store

    # One TAG asset that matches node 1001 via Tier 1
    record = AssetRecord(
        asset_id="A001",
        asset_type=AssetType.TAG,
        signature=_make_sig(1001, "mod.process_data"),
        payload={"tag_value": "SENSITIVE"},
    )
    asset_file = _make_asset_file(tmp_path, [record])

    args = _make_args(db=db_path, asset_file=str(asset_file), dry_run=True, output="json")
    fmt_out = StringIO()
    from codedmap.cli._output import OutputFormatter
    fmt = OutputFormatter()

    with contextlib.redirect_stdout(fmt_out):
        _import_assets(store, args, use_json=True, fmt=fmt)

    data = json.loads(fmt_out.getvalue())
    assert data["success"] is True
    assert data["result"]["imported"] == 1
    assert data["result"]["dry_run"] is True
    assert data["result"]["applied"] is False

    store.close()


# ---------------------------------------------------------------------------
# Test: import TAG asset applies patch to store (without dry-run)
# ---------------------------------------------------------------------------

def test_import_tag_asset_applies_patch(method_store, tmp_path):
    store, db_path = method_store

    tag_value = "CRITICAL:MEMORY_CORRUPTION"
    record = AssetRecord(
        asset_id="A001",
        asset_type=AssetType.TAG,
        signature=_make_sig(1001, "mod.process_data"),
        payload={"tag_value": tag_value},
    )
    asset_file = _make_asset_file(tmp_path, [record])

    args = _make_args(db=db_path, asset_file=str(asset_file), dry_run=False, output="json")
    fmt_out = StringIO()
    from codedmap.cli._output import OutputFormatter
    fmt = OutputFormatter()

    with contextlib.redirect_stdout(fmt_out):
        _import_assets(store, args, use_json=True, fmt=fmt)

    data = json.loads(fmt_out.getvalue())
    assert data["success"] is True
    assert data["result"]["imported"] == 1
    assert data["result"]["applied"] is True

    # Verify tag was written to the node
    updated_node = store.get_node(1001)
    assert updated_node is not None
    node_tags = getattr(updated_node, "tags", []) or []
    assert tag_value in node_tags, f"Expected '{tag_value}' in tags, got {node_tags}"

    store.close()


# ---------------------------------------------------------------------------
# Test: import orphaned asset creates .orphans.json report
# ---------------------------------------------------------------------------

def test_import_orphaned_asset_creates_report(method_store, tmp_path):
    store, db_path = method_store

    # Record with node_id that doesn't exist and full_name that doesn't match
    record = AssetRecord(
        asset_id="A001",
        asset_type=AssetType.TAG,
        signature=_make_sig(9999, "nonexistent.function", file_path="nowhere.c"),
        payload={"tag_value": "MARKER"},
    )
    asset_file = _make_asset_file(tmp_path, [record])

    args = _make_args(db=db_path, asset_file=str(asset_file), dry_run=False, output="json")
    fmt_out = StringIO()
    from codedmap.cli._output import OutputFormatter
    fmt = OutputFormatter()

    with contextlib.redirect_stdout(fmt_out):
        _import_assets(store, args, use_json=True, fmt=fmt)

    data = json.loads(fmt_out.getvalue())
    assert data["success"] is True
    assert data["result"]["orphaned"] == 1

    # Check orphans file was created
    orphans_path = Path(str(asset_file) + ".orphans.json")
    assert orphans_path.exists(), f"Expected orphans file at {orphans_path}"
    orphans_data = json.loads(orphans_path.read_text())
    assert len(orphans_data) == 1
    assert orphans_data[0]["asset_id"] == "A001"

    store.close()


# ---------------------------------------------------------------------------
# Test: anchor updates asset status and signature.node_id
# ---------------------------------------------------------------------------

def test_anchor_updates_asset_status(method_store, tmp_path):
    store, db_path = method_store

    # Start with an orphaned record (mismatched node_id)
    record = AssetRecord(
        asset_id="A001",
        asset_type=AssetType.TAG,
        signature=_make_sig(9999, "nonexistent.function", file_path="old.c"),
        payload={"tag_value": "SENSITIVE"},
        status="orphaned",
    )
    asset_file = _make_asset_file(tmp_path, [record])

    # Anchor to node 1001 which exists in the store
    args = _make_args(
        db=db_path,
        asset_file=str(asset_file),
        asset_id="A001",
        target="1001",
        output="json",
    )
    fmt_out = StringIO()
    from codedmap.cli._output import OutputFormatter
    fmt = OutputFormatter()

    with contextlib.redirect_stdout(fmt_out):
        _anchor_asset(store, args, use_json=True, fmt=fmt)

    data = json.loads(fmt_out.getvalue())
    assert data["success"] is True
    assert data["result"]["status"] == "anchored"
    assert data["result"]["new_node_id"] == 1001
    assert data["result"]["old_node_id"] == 9999

    # Verify the asset file was updated on disk
    updated_registry = AssetRegistry()
    updated_registry.load(asset_file)
    updated_record = updated_registry.get("A001")
    assert updated_record is not None
    assert updated_record.status == "anchored"
    assert updated_record.signature.node_id == 1001

    store.close()


# ---------------------------------------------------------------------------
# Test: "assets" command is registered in __main__.commands dict
# ---------------------------------------------------------------------------

def test_assets_command_registered():
    # We inspect the commands dict by importing __main__ and calling main()
    # in a controlled way. Instead, check the import and commands presence.
    import codedmap.cli.__main__ as main_module
    import importlib
    import inspect

    # Read the source to confirm "assets" is in the commands dict
    src = inspect.getsource(main_module)
    assert '"assets": cmd_assets' in src or "'assets': cmd_assets" in src, (
        "Expected 'assets' key in commands dict in __main__.py"
    )

    # Also confirm the import statement is present
    assert "from codedmap.cli.commands import assets as cmd_assets" in src


# ---------------------------------------------------------------------------
# Test: assets.register() creates all 5 subparsers without error
# ---------------------------------------------------------------------------

def test_assets_register_creates_subparsers():
    from codedmap.cli.commands import assets

    # Create a mock parser and subparsers
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")

    # Should not raise
    assets.register(subparsers)

    # Verify all 5 expected subcommands can be parsed
    for subcmd in ["export", "import", "diff", "anchor", "merge"]:
        if subcmd == "export":
            ns = parser.parse_args(["assets", subcmd, "--db", "test.db"])
        elif subcmd == "import":
            ns = parser.parse_args(["assets", subcmd, "--db", "test.db", "--asset-file", "x.json"])
        elif subcmd == "diff":
            ns = parser.parse_args(["assets", subcmd, "--db", "test.db", "--asset-file", "x.json"])
        elif subcmd == "anchor":
            ns = parser.parse_args([
                "assets", subcmd, "--db", "test.db",
                "--asset-file", "x.json", "--asset-id", "A001", "--target", "123"
            ])
        elif subcmd == "merge":
            ns = parser.parse_args([
                "assets", subcmd,
                "--from", "src.db", "--into", "dst.db", "--project", "myproj"
            ])
        assert ns.command == "assets", f"Expected command=assets for subcmd={subcmd}"
        assert ns.assets_action == subcmd, f"Expected assets_action={subcmd}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
