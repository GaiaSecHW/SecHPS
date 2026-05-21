import pytest

from codedmap.core.configs.storage import StorageConfig
from codedmap.infra.storage.driver_memory.engine import MemoryEngine
from codedmap.infra.storage.driver_sqlite.engine import SqliteEngine
from codedmap.infra.storage.store import CPGStore


def test_memory_engine_contract_is_minimal(tmp_path):
    engine = MemoryEngine(StorageConfig(backend="memory"))

    assert not hasattr(engine, "metadata")
    assert engine.capabilities.supports_vector_search is True
    assert engine.capabilities.supports_programmatic_import is False

    snapshot_path = tmp_path / "memory_snapshot.json"
    engine.snapshot(str(snapshot_path))
    assert snapshot_path.exists()


def test_sqlite_engine_contract_is_minimal(tmp_path):
    db_path = tmp_path / "graph.db"
    engine = SqliteEngine(StorageConfig(backend="sqlite", uri=str(db_path)))

    assert not hasattr(engine, "metadata")
    assert engine.capabilities.supports_programmatic_import is True

    bulk_writer = engine.create_bulk_writer(str(tmp_path / "bulk"))
    assert bulk_writer is not None


@pytest.mark.parametrize(
    ("backend", "uri"),
    [
        ("memory", ":memory:"),
        ("sqlite", "graph.db"),
    ],
)
def test_store_engines_do_not_expose_storage_metadata(tmp_path, backend, uri):
    uri_value = uri if backend == "memory" else str(tmp_path / uri)
    config = StorageConfig(backend=backend, uri=uri_value)

    with CPGStore(config) as store:
        assert not hasattr(store._engine, "metadata")


def test_neo4j_engine_contract_without_live_database(monkeypatch):
    pytest.importorskip("neo4j")

    from codedmap.infra.storage.driver_neo4j import engine as neo4j_engine_module

    class DummyClient:
        def __init__(self, uri, auth, database):
            self.uri = uri
            self.auth = auth
            self._database = database

    class DummyConnection:
        def __init__(self, client):
            self.client = client

        def connect(self):
            pass

        def init_schema(self):
            pass

        def close(self):
            pass

        def clear_database(self):
            pass

        def transaction(self):
            return None

    class DummyReader:
        def __init__(self, client):
            self.client = client

        def export_to_file(self, output_path):
            with open(output_path, "w", encoding="utf-8") as handle:
                handle.write("{}")

    class DummyWriter:
        def __init__(self, client, batch_size):
            self.client = client
            self.batch_size = batch_size

    class DummyTraversalSource:
        def __init__(self, client):
            self.client = client

    monkeypatch.setattr(neo4j_engine_module, "Neo4jClient", DummyClient)
    monkeypatch.setattr(neo4j_engine_module, "Neo4jConnection", DummyConnection)
    monkeypatch.setattr(neo4j_engine_module, "Neo4jReader", DummyReader)
    monkeypatch.setattr(neo4j_engine_module, "Neo4jWriter", DummyWriter)
    monkeypatch.setattr(neo4j_engine_module, "Neo4jTraversalSource", DummyTraversalSource)

    engine = neo4j_engine_module.Neo4jEngine(
        StorageConfig(backend="neo4j", uri="bolt://localhost:7687")
    )

    assert not hasattr(engine, "metadata")
    assert engine.capabilities.supports_vector_search is True
    assert engine.capabilities.supports_programmatic_import is False
