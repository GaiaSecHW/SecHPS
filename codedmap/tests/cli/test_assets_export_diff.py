"""
Tests for cpg assets — export and diff subcommands.

Tests covered:
    test_asset_registry_next_id
    test_asset_registry_export_load_roundtrip
    test_build_signature_content_hash
    test_asset_type_enum_values
    test_diff_tier1_match
    test_diff_tier4_orphan
"""

import json
import os
import sys
import argparse
import contextlib
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
    _build_signature,
    _diff_assets_logic,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_method_node(node_id: int, name: str, full_name: str, file_name: str = "test.c") -> MethodNode:
    return MethodNode(
        id=node_id,
        name=name,
        full_name=full_name,
        label=NodeLabel.METHOD,
        file_name=file_name,
        signature=f"void {name}()",
    )


def _make_asset_record(asset_id: str, asset_type: AssetType,
                       node_id: int, full_name: str, file_path: str = "test.c",
                       payload: dict = None) -> AssetRecord:
    raw_hash = full_name + "|" + file_path
    import hashlib
    content_hash = hashlib.sha256(raw_hash.encode()).hexdigest()[:16]
    sig = SemanticSignature(
        node_id=node_id,
        full_name=full_name,
        file_path=file_path,
        content_hash=content_hash,
    )
    return AssetRecord(
        asset_id=asset_id,
        asset_type=asset_type,
        signature=sig,
        payload=payload or {},
    )


@pytest.fixture
def memory_store_with_method():
    """In-memory store containing one METHOD node."""
    config = StorageConfig(backend="memory", uri=":memory:")
    store = CPGStore(config)
    builder = CPGBuilder()
    m = _make_method_node(1001, "process_data", "mod.process_data", "src/main.c")
    builder.graph.add_node(m)
    store.save(builder.get_graph())
    yield store
    store.close()


# ---------------------------------------------------------------------------
# Test: AssetRegistry.next_id — sequential IDs start at A001
# ---------------------------------------------------------------------------

def test_asset_registry_next_id():
    registry = AssetRegistry()
    assert registry.next_id() == "A001"
    assert registry.next_id() == "A002"
    assert registry.next_id() == "A003"


# ---------------------------------------------------------------------------
# Test: export / load roundtrip
# ---------------------------------------------------------------------------

def test_asset_registry_export_load_roundtrip(tmp_path):
    registry = AssetRegistry()

    r1 = _make_asset_record("A001", AssetType.TAG, 1001, "mod.foo", payload={"tag_value": "SENSITIVE"})
    r2 = _make_asset_record("A002", AssetType.NOTE, 1002, "mod.bar", payload={"category": "SEC", "text": "note"})
    registry.add(r1)
    registry.add(r2)

    export_path = tmp_path / "test.assets.json"
    registry.export(export_path)

    # Load into a fresh registry
    fresh = AssetRegistry()
    fresh.load(export_path)

    all_records = fresh.all()
    assert len(all_records) == 2

    ids = {r.asset_id for r in all_records}
    assert "A001" in ids
    assert "A002" in ids

    types = {r.asset_id: r.asset_type for r in all_records}
    assert types["A001"] == AssetType.TAG
    assert types["A002"] == AssetType.NOTE


# ---------------------------------------------------------------------------
# Test: _build_signature produces a 16-char hex content_hash
# ---------------------------------------------------------------------------

def test_build_signature_content_hash():
    node = _make_method_node(42, "my_func", "ns.my_func", "path/to/file.c")
    sig = _build_signature(node)

    assert sig.content_hash, "content_hash should be non-empty"
    assert len(sig.content_hash) == 16, f"expected 16 chars, got {len(sig.content_hash)}"
    # Hex digits only
    int(sig.content_hash, 16)  # will raise ValueError if not hex

    assert sig.full_name == "ns.my_func"
    assert sig.file_path == "path/to/file.c"
    assert sig.node_id == 42


# ---------------------------------------------------------------------------
# Test: AssetType enum values are lowercase strings
# ---------------------------------------------------------------------------

def test_asset_type_enum_values():
    for member in AssetType:
        assert member.value == member.value.lower(), (
            f"AssetType.{member.name} value '{member.value}' is not lowercase"
        )
    # Spot-check specific values
    assert AssetType.TAG.value == "tag"
    assert AssetType.NOTE.value == "note"
    assert AssetType.MODULE_ASSIGNMENT.value == "module_assignment"
    assert AssetType.REPAIR_EDGE.value == "repair_edge"


# ---------------------------------------------------------------------------
# Test: diff Tier 1 match (node_id exists + full_name matches)
# ---------------------------------------------------------------------------

def test_diff_tier1_match(memory_store_with_method):
    store = memory_store_with_method

    # Create an asset whose signature.node_id and full_name match node 1001
    record = _make_asset_record(
        "A001", AssetType.TAG, 1001, "mod.process_data",
        file_path="src/main.c",
        payload={"tag_value": "SENSITIVE"},
    )

    registry = AssetRegistry()
    registry.add(record)

    diff = _diff_assets_logic(store, registry)
    result = diff["per_record"]["A001"]

    assert result["tier"] == "matched_t1", (
        f"Expected matched_t1, got {result['tier']}"
    )
    assert result["matched_node_id"] == 1001


# ---------------------------------------------------------------------------
# Test: diff Tier 4 orphan (no match at any tier)
# ---------------------------------------------------------------------------

def test_diff_tier4_orphan(memory_store_with_method):
    store = memory_store_with_method

    # Create an asset with a node_id that does not exist and a full_name
    # that doesn't match any node in the store
    record = _make_asset_record(
        "A001", AssetType.TAG, 9999, "nonexistent.function",
        file_path="nowhere.c",
        payload={"tag_value": "MARKER"},
    )

    registry = AssetRegistry()
    registry.add(record)

    diff = _diff_assets_logic(store, registry)
    result = diff["per_record"]["A001"]

    assert result["tier"] == "orphaned", (
        f"Expected orphaned, got {result['tier']}"
    )
    assert result["matched_node_id"] is None
    assert len(diff["orphaned_records"]) == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
