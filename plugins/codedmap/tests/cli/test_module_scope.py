"""Module scope tests via shared scope services."""

from codedmap.app.services.scope_utils import (
    ModuleNotFoundError,
    filter_by_scope,
    resolve_module_scope,
)
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import EdgeType, Language
from codedmap.core.schema.graph.nodes import FileNode, MethodNode
from codedmap.core.schema.graph.nodes.structure import ModuleNode
from codedmap.infra.storage.store import CPGStore


def _build_scoped_db(db_path: str):
    store = CPGStore(StorageConfig(backend="sqlite", uri=db_path))
    builder = CPGBuilder()

    mod_network = ModuleNode(id=5001, name="network", fullName="net.network", label="MODULE")
    mod_storage = ModuleNode(id=5002, name="storage", fullName="fs.storage", label="MODULE")

    file_tcp = FileNode(id=5010, name="net/tcp.c", fullName="net/tcp.c", label="FILE", language=Language.C)
    file_disk = FileNode(id=5012, name="fs/disk.c", fullName="fs/disk.c", label="FILE", language=Language.C)

    send_data = MethodNode(
        id=5020, name="send_data", label="METHOD", fullName="net.tcp.send_data", fileName="net/tcp.c", lineNumber=10
    )
    read_block = MethodNode(
        id=5022, name="read_block", label="METHOD", fullName="fs.disk.read_block", fileName="fs/disk.c", lineNumber=30
    )

    for node in [mod_network, mod_storage, file_tcp, file_disk, send_data, read_block]:
        builder.graph.add_node(node)

    builder.graph.add_edge(5001, 5010, EdgeType.CONTAINS)
    builder.graph.add_edge(5002, 5012, EdgeType.CONTAINS)
    builder.graph.add_edge(5010, 5020, EdgeType.AST)
    builder.graph.add_edge(5012, 5022, EdgeType.AST)

    store.save(builder.get_graph())
    return store


def test_resolve_module_scope_and_filter(tmp_path):
    db_path = str(tmp_path / "scope.db")
    store = _build_scoped_db(db_path)
    try:
        scope = resolve_module_scope(store, module="network", module_id=None)
        assert scope.name == "network"
        assert scope.file_count == 1
        assert scope.method_count == 1

        all_methods = store.query.all_nodes("METHOD").to_list()
        scoped = filter_by_scope(all_methods, scope, store)
        names = {n.name for n in scoped}
        assert names == {"send_data"}
    finally:
        store.close()


def test_resolve_module_scope_not_found(tmp_path):
    db_path = str(tmp_path / "scope_missing.db")
    store = _build_scoped_db(db_path)
    try:
        try:
            resolve_module_scope(store, module="missing", module_id=None)
            assert False, "expected ModuleNotFoundError"
        except ModuleNotFoundError:
            pass
    finally:
        store.close()
