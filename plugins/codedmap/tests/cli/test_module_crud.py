# tests/cli/test_module_crud.py
"""
Tests for cpg module CRUD subcommands.

Phase 27 Plan 01 — Task 3
"""

import argparse
import json
import os
import sys
from io import StringIO

import pytest
import importlib.util

if importlib.util.find_spec("codedmap.cli.commands.module") is None:
    pytest.skip(
        "Legacy module CLI wrapper tests are obsolete after catalog/service convergence.",
        allow_module_level=True,
    )

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from codedmap.core.configs.storage import StorageConfig
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import EdgeType, Language, NodeLabel
from codedmap.core.schema.graph.nodes import FileNode, MethodNode
from codedmap.core.schema.graph.nodes.structure import ModuleNode
from codedmap.infra.storage.store import CPGStore
from codedmap.cli.commands import module


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def store_with_modules(tmp_path):
    """Create a SQLite store with 2 modules, 4 files, 4 methods, and CONTAINS edges.

    Structure:
      Module "crypto" (fullName="kernel.crypto")
        -> src/crypto/aes.c, src/crypto/rsa.c
           -> aes_encrypt (in aes.c), rsa_sign (in rsa.c)

      Module "network" (fullName="kernel.network")
        -> src/net/tcp.c, src/net/udp.c
           -> tcp_send (in tcp.c), udp_recv (in udp.c)
    """
    db_path = str(tmp_path / "crud.db")
    config = StorageConfig(backend="sqlite", uri=db_path)
    store = CPGStore(config)
    builder = CPGBuilder()

    # Modules
    mod_crypto = ModuleNode(id=7001, name="crypto", fullName="kernel.crypto", label="MODULE")
    mod_network = ModuleNode(id=7002, name="network", fullName="kernel.network", label="MODULE")

    # Files
    f_aes = FileNode(id=7010, name="src/crypto/aes.c", fullName="src/crypto/aes.c", label="FILE", language=Language.C)
    f_rsa = FileNode(id=7011, name="src/crypto/rsa.c", fullName="src/crypto/rsa.c", label="FILE", language=Language.C)
    f_tcp = FileNode(id=7012, name="src/net/tcp.c", fullName="src/net/tcp.c", label="FILE", language=Language.C)
    f_udp = FileNode(id=7013, name="src/net/udp.c", fullName="src/net/udp.c", label="FILE", language=Language.C)

    # Methods
    m_aes = MethodNode(id=7020, name="aes_encrypt", label="METHOD",
                       fullName="crypto.aes_encrypt", fileName="src/crypto/aes.c", lineNumber=10)
    m_rsa = MethodNode(id=7021, name="rsa_sign", label="METHOD",
                       fullName="crypto.rsa_sign", fileName="src/crypto/rsa.c", lineNumber=20)
    m_tcp = MethodNode(id=7022, name="tcp_send", label="METHOD",
                       fullName="net.tcp_send", fileName="src/net/tcp.c", lineNumber=30)
    m_udp = MethodNode(id=7023, name="udp_recv", label="METHOD",
                       fullName="net.udp_recv", fileName="src/net/udp.c", lineNumber=40)

    for node in [mod_crypto, mod_network, f_aes, f_rsa, f_tcp, f_udp, m_aes, m_rsa, m_tcp, m_udp]:
        builder.graph.add_node(node)

    # Module CONTAINS edges
    builder.graph.add_edge(7001, 7010, EdgeType.CONTAINS)  # crypto -> aes.c
    builder.graph.add_edge(7001, 7011, EdgeType.CONTAINS)  # crypto -> rsa.c
    builder.graph.add_edge(7002, 7012, EdgeType.CONTAINS)  # network -> tcp.c
    builder.graph.add_edge(7002, 7013, EdgeType.CONTAINS)  # network -> udp.c

    # File AST edges (file -> method)
    builder.graph.add_edge(7010, 7020, EdgeType.AST)  # aes.c -> aes_encrypt
    builder.graph.add_edge(7011, 7021, EdgeType.AST)  # rsa.c -> rsa_sign
    builder.graph.add_edge(7012, 7022, EdgeType.AST)  # tcp.c -> tcp_send
    builder.graph.add_edge(7013, 7023, EdgeType.AST)  # udp.c -> udp_recv

    store.save(builder.get_graph())
    yield {"db_path": db_path, "store": store}
    store.close()


@pytest.fixture
def empty_store(tmp_path):
    """Create an empty SQLite store."""
    db_path = str(tmp_path / "empty.db")
    config = StorageConfig(backend="sqlite", uri=db_path)
    store = CPGStore(config)
    yield {"db_path": db_path, "store": store}
    store.close()


def _make_args(db_path, action, **kwargs):
    """Build an argparse.Namespace for module commands."""
    ns = {
        "command": "module",
        "module_action": action,
        "output": "text",
        "db": db_path,
        "backend": "sqlite",
    }
    ns.update(kwargs)
    return argparse.Namespace(**ns)


def _run_capture(args):
    """Run module.run(args) and capture stdout/stderr. Returns (stdout, stderr, exit_code)."""
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = StringIO()
    sys.stderr = StringIO()
    exit_code = 0
    try:
        module.run(args)
    except SystemExit as e:
        exit_code = e.code if e.code is not None else 0
    finally:
        stdout = sys.stdout.getvalue()
        stderr = sys.stderr.getvalue()
        sys.stdout = old_out
        sys.stderr = old_err
    return stdout, stderr, exit_code


# ===========================================================================
# TestModuleCreate
# ===========================================================================

class TestModuleCreate:

    def test_create_basic(self, empty_store):
        """Create a module and verify it exists in store."""
        db_path = empty_store["db_path"]
        args = _make_args(db_path, "create", name="mymod", full_name=None, paths=None)
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Created module 'mymod'" in stdout

        # Verify in store
        store = empty_store["store"]
        mods = store.modules.find_by_name("mymod", exact_match=True)
        assert len(mods) == 1
        assert mods[0].name == "mymod"
        assert mods[0].full_name == "mymod"  # defaults to name

    def test_create_with_paths(self, store_with_modules):
        """Create a module with --paths and verify CONTAINS edges."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "create", name="allcrypto", full_name="all.crypto",
                          paths=["src/crypto/*.c"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Created module 'allcrypto'" in stdout
        assert "Assigned 2 files" in stdout

    def test_create_duplicate_error(self, store_with_modules):
        """Creating a module with existing full_name returns error."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "create", name="crypto", full_name="kernel.crypto", paths=None)
        stdout, stderr, code = _run_capture(args)
        assert code == 1
        assert "already exists" in stderr

    def test_create_json_output(self, empty_store):
        """Verify JSON envelope has action/id/name/full_name."""
        db_path = empty_store["db_path"]
        args = _make_args(db_path, "create", name="jsonmod", full_name="test.jsonmod",
                          paths=None, output="json")
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        data = json.loads(stdout)
        assert data["success"] is True
        assert data["result"]["action"] == "created"
        assert data["result"]["name"] == "jsonmod"
        assert data["result"]["full_name"] == "test.jsonmod"
        assert "id" in data["result"]


# ===========================================================================
# TestModuleDelete
# ===========================================================================

class TestModuleDelete:

    def test_delete_basic(self, store_with_modules):
        """Delete a module and verify it's gone."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        # Verify exists first
        assert len(store.modules.find_by_name("crypto", exact_match=True)) == 1

        args = _make_args(db_path, "delete", name="crypto")
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Deleted module 'crypto'" in stdout

        # Verify gone
        assert len(store.modules.find_by_name("crypto", exact_match=True)) == 0

    def test_delete_cascade(self, store_with_modules):
        """Delete module with files — CONTAINS edges gone but FileNodes remain."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        args = _make_args(db_path, "delete", name="crypto")
        stdout, stderr, code = _run_capture(args)
        assert code == 0

        # FileNodes should still exist
        aes_files = store.files.find_by_name("src/crypto/aes.c")
        assert len(aes_files) > 0

    def test_delete_not_found(self, store_with_modules):
        """Delete nonexistent module returns error."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "delete", name="nonexistent_xyz")
        stdout, stderr, code = _run_capture(args)
        assert code == 1
        assert "not found" in stderr.lower() or "Module not found" in stderr


# ===========================================================================
# TestModuleRename
# ===========================================================================

class TestModuleRename:

    def test_rename_display_name(self, store_with_modules):
        """Rename name only (full_name unchanged) — same ID preserved."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        old_mods = store.modules.find_by_name("crypto", exact_match=True)
        old_id = old_mods[0].id

        args = _make_args(db_path, "rename", name="crypto", new_name="crypto_v2",
                          new_full_name="kernel.crypto")  # same full_name
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Renamed" in stdout

        # ID should be preserved since full_name didn't change
        new_mods = store.modules.find_by_name("crypto_v2", exact_match=True)
        assert len(new_mods) == 1
        assert new_mods[0].id == old_id

    def test_rename_full_name(self, store_with_modules):
        """Rename with new full_name — new ID, CONTAINS edges migrated."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        old_mods = store.modules.find_by_name("crypto", exact_match=True)
        old_id = old_mods[0].id

        args = _make_args(db_path, "rename", name="crypto", new_name="encryption",
                          new_full_name="kernel.encryption")
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Renamed" in stdout
        assert "2 files preserved" in stdout

        # Old module should be gone
        assert len(store.modules.find_by_name("crypto", exact_match=True)) == 0

        # New module should exist with different ID
        new_mods = store.modules.find_by_name("encryption", exact_match=True)
        assert len(new_mods) == 1
        assert new_mods[0].id != old_id


# ===========================================================================
# TestModuleAssign
# ===========================================================================

class TestModuleAssign:

    def test_assign_by_pattern(self, store_with_modules):
        """Assign files matching pattern — verify CONTAINS edges created."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        # Create a new module with no files
        from codedmap.core.schema.graph.nodes.structure import ModuleNode as MN
        from codedmap.core.schema.graph.patch import GraphPatch
        new_mod = MN(name="all_src", fullName="all.src")
        patch = GraphPatch(created_by="test").add_node(new_mod)
        store.apply_patch(patch)

        args = _make_args(db_path, "assign", name="all_src", paths=["src/net/*.c"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Assigned 2 files" in stdout

    def test_assign_idempotent(self, store_with_modules):
        """Assign same files twice — second time shows already assigned."""
        db_path = store_with_modules["db_path"]

        # crypto already has aes.c and rsa.c
        args = _make_args(db_path, "assign", name="crypto", paths=["src/crypto/*.c"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "0 files" not in stdout or "2 already assigned" in stdout

    def test_assign_no_match(self, store_with_modules):
        """Pattern matches no files — 0 assigned."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "assign", name="crypto", paths=["nonexistent/*.xyz"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Assigned 0 files" in stdout


# ===========================================================================
# TestModuleRemove
# ===========================================================================

class TestModuleRemove:

    def test_remove_by_pattern(self, store_with_modules):
        """Remove files matching pattern — CONTAINS edges removed."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        from codedmap.analysis.traversal.module import ModuleNavigator
        nav = ModuleNavigator(store)
        mod = store.modules.find_by_name("crypto", exact_match=True)[0]

        # Before: 2 files
        assert sum(1 for _ in nav.get_files(mod)) == 2

        args = _make_args(db_path, "remove", name="crypto", paths=["src/crypto/aes.c"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "Removed 1 files" in stdout
        assert "1 remaining" in stdout

    def test_remove_files_remain(self, store_with_modules):
        """After remove, FileNodes still exist in graph."""
        db_path = store_with_modules["db_path"]
        store = store_with_modules["store"]

        args = _make_args(db_path, "remove", name="crypto", paths=["src/crypto/aes.c"])
        stdout, stderr, code = _run_capture(args)
        assert code == 0

        # FileNode should still exist
        aes_files = store.files.find_by_name("src/crypto/aes.c")
        assert len(aes_files) > 0


# ===========================================================================
# TestModuleList
# ===========================================================================

class TestModuleList:

    def test_list_basic(self, store_with_modules):
        """List modules — verify names shown."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "list", limit=50, **{"all": False})
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "crypto" in stdout
        assert "network" in stdout

    def test_list_json(self, store_with_modules):
        """Verify JSON envelope with modules array."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "list", limit=50, output="json", **{"all": False})
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        data = json.loads(stdout)
        assert data["success"] is True
        assert "modules" in data["result"]
        assert len(data["result"]["modules"]) == 2
        names = {m["name"] for m in data["result"]["modules"]}
        assert "crypto" in names
        assert "network" in names


# ===========================================================================
# TestModuleShow
# ===========================================================================

class TestModuleShow:

    def test_show_basic(self, store_with_modules):
        """Show module details — verify file_count/method_count."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "show", name="crypto")
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        assert "crypto" in stdout
        assert "kernel.crypto" in stdout
        assert "Files: 2" in stdout
        assert "Methods: 2" in stdout

    def test_show_json(self, store_with_modules):
        """Verify JSON envelope matches expected shape."""
        db_path = store_with_modules["db_path"]
        args = _make_args(db_path, "show", name="crypto", output="json")
        stdout, stderr, code = _run_capture(args)
        assert code == 0
        data = json.loads(stdout)
        assert data["success"] is True
        r = data["result"]
        assert r["name"] == "crypto"
        assert r["full_name"] == "kernel.crypto"
        assert r["file_count"] == 2
        assert r["method_count"] == 2
        assert "files" in r
        assert "metrics" in r
