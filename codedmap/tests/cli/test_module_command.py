"""Module and tag command tests through catalog dispatcher."""

import argparse
import contextlib
import json
from io import StringIO

from codedmap.cli._bootstrap import _dispatch_catalog_command_via_executor
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.core.schema.graph.nodes import ModuleNode
from codedmap.infra.storage.store import CPGStore


def _seed_modules_db(db_path: str):
    store = CPGStore(StorageConfig(backend="sqlite", uri=db_path))
    builder = CPGBuilder()
    for node in [
        ModuleNode(
            id=2001,
            name="crypto",
            label=NodeLabel.MODULE,
            fullName="kernel.crypto",
            subsystem="crypto",
            description="Cryptographic subsystem",
        ),
        ModuleNode(
            id=2002,
            name="auth",
            label=NodeLabel.MODULE,
            fullName="security.auth",
            subsystem="security",
            description="Authentication subsystem",
        ),
    ]:
        builder.graph.add_node(node)
    store.save(builder.get_graph())
    store.close()


def _run_dispatch(domain: str, **kwargs):
    base = {
        "db": kwargs.pop("db"),
        "backend": "sqlite",
        "output": "json",
        "remote": "",
        "api_key": "",
        "offset": 0,
    }
    base.update(kwargs)
    args = argparse.Namespace(**base)
    out = StringIO()
    with contextlib.redirect_stdout(out):
        _dispatch_catalog_command_via_executor(args, domain)
    return json.loads(out.getvalue())


def test_module_list_dispatch_success(tmp_path):
    db_path = str(tmp_path / "modules.db")
    _seed_modules_db(db_path)
    data = _run_dispatch("module", db=db_path, module_action="list")
    assert data["success"] is True
    assert data["command"] == "module"
    assert data["result"]["kind"] == "object"
    assert data["result"]["content"]["total"] >= 2


def test_module_list_dispatch_pagination_metadata(tmp_path):
    db_path = str(tmp_path / "modules.db")
    _seed_modules_db(db_path)

    first = _run_dispatch("module", db=db_path, module_action="list", limit=1, offset=0)
    assert first["success"] is True
    assert first["metadata"]["total"] == 2
    assert first["metadata"]["limit"] == 1
    assert first["metadata"]["offset"] == 0
    assert first["metadata"]["has_more"] is True
    assert len(first["result"]["content"]["modules"]) == 1

    second = _run_dispatch("module", db=db_path, module_action="list", limit=1, offset=1)
    assert second["success"] is True
    assert second["metadata"]["total"] == 2
    assert second["metadata"]["limit"] == 1
    assert second["metadata"]["offset"] == 1
    assert second["metadata"]["has_more"] is False
    assert len(second["result"]["content"]["modules"]) == 1


def test_module_show_dispatch_success(tmp_path):
    db_path = str(tmp_path / "modules.db")
    _seed_modules_db(db_path)
    data = _run_dispatch("module", db=db_path, module_action="show", name="crypto")
    assert data["success"] is True
    assert data["command"] == "module"
    assert data["result"]["kind"] == "object"
    assert data["result"]["content"]["name"] == "crypto"
    assert data["result"]["content"]["full_name"] == "kernel.crypto"
    # default is summary projection (progressive disclosure)
    assert "files" not in data["result"]["content"]
    assert "metrics" not in data["result"]["content"]


def test_module_show_verbose_returns_full_details(tmp_path):
    db_path = str(tmp_path / "modules.db")
    _seed_modules_db(db_path)
    data = _run_dispatch("module", db=db_path, module_action="show", name="crypto", verbose=True)
    assert data["success"] is True
    assert data["command"] == "module"
    assert data["result"]["kind"] == "object"
    assert data["result"]["content"]["name"] == "crypto"
    assert "files" in data["result"]["content"]
    assert "metrics" in data["result"]["content"]


def test_tag_list_dispatch_without_target_success(tmp_path):
    db_path = str(tmp_path / "modules.db")
    _seed_modules_db(db_path)
    data = _run_dispatch("tag", db=db_path, tag_action="list")
    assert data["success"] is True
    assert data["command"] == "tag"
    assert data["result"]["kind"] == "object"
    assert "tags" in data["result"]["content"]
    assert "total" in data["result"]["content"]
