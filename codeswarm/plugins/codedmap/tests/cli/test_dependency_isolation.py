import argparse
import builtins
import contextlib
import importlib
import json
import sys
from io import StringIO

from codedmap.cli._bootstrap import _dispatch_catalog_command_via_executor
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph.nodes import ModuleNode
from codedmap.infra.storage.store import CPGStore


def _seed_sqlite_module_db(db_path: str) -> None:
    store = CPGStore(StorageConfig(backend="sqlite", uri=db_path))
    builder = CPGBuilder()
    builder.graph.add_node(
        ModuleNode(
            id=2001,
            name="crypto",
            label=NodeLabel.MODULE,
            fullName="kernel.crypto",
            subsystem="crypto",
            summary="Cryptographic subsystem",
            tags=["HIGH_VALUE_CRYPTO"],
        )
    )
    store.save(builder.get_graph())
    store.close()


def test_sqlite_cli_starts_without_optional_dependencies(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test_modules.db")
    _seed_sqlite_module_db(db_path)

    blocked_prefixes = ("neo4j", "llama_index", "openai", "instructor")
    original_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name.startswith(blocked_prefixes):
            raise ImportError(f"blocked optional dependency: {name}")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded_import)

    for module_name in [
        "codedmap.cli._bootstrap",
        "codedmap.infra.storage.store",
        "codedmap.infra.storage.factory",
        "codedmap.infra.storage.driver_sqlite.engine",
        "codedmap.infra.storage.driver_sqlite.reader",
        "codedmap.infra.storage.driver_sqlite.serializer",
        "codedmap.infra.storage.base.converter",
    ]:
        sys.modules.pop(module_name, None)

    importlib.import_module("codedmap.cli._bootstrap")
    args = argparse.Namespace(
        query_action="inspect",
        db=db_path,
        backend="sqlite",
        module="crypto",
        module_id=None,
        detail=False,
        hierarchy=False,
        output="json",
        function=None,
        file=None,
        line=None,
        node_id=None,
        remote="",
        api_key="",
        offset=0,
    )
    stdout = StringIO()
    with contextlib.redirect_stdout(stdout):
        _dispatch_catalog_command_via_executor(args, "query")

    data = json.loads(stdout.getvalue())
    assert data["success"] is True
    assert data["command"] == "inspect"
    assert data["result"]["name"] == "crypto"
