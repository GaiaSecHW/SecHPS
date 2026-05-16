from collections import defaultdict
from contextlib import contextmanager
from types import SimpleNamespace
import sys
import types

sys.modules.setdefault("psutil", types.SimpleNamespace(cpu_count=lambda logical=True: 1))

from codedmap.analysis.passes.batch import global_points_to as gpt
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.infra.executor.messages.base import BaseTask


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self._offset = 0

    def fetchone(self):
        if not self.rows:
            return None
        return self.rows[0]

    def fetchmany(self, size):
        chunk = self.rows[self._offset:self._offset + size]
        self._offset += len(chunk)
        return chunk


class FakeConn:
    def __init__(self, disk_set):
        self.disk_set = disk_set

    def execute(self, _query):
        return FakeCursor([(self.disk_set.count(),)])


class FakeDiskSet:
    def __init__(self, initial=None, table_name="fake"):
        initial = initial or {}
        self.data = {key: set(values) for key, values in initial.items()}
        self.set_table_name = table_name
        self.map = SimpleNamespace(conn=FakeConn(self))

    def add(self, key, value):
        bucket = self.data.setdefault(key, set())
        before = len(bucket)
        bucket.add(value)
        return len(bucket) != before

    def get(self, key):
        return set(self.data.get(key, set()))

    def update(self, key, values):
        bucket = self.data.setdefault(key, set())
        before = len(bucket)
        bucket.update(values)
        return len(bucket) != before

    def count(self):
        return sum(len(values) for values in self.data.values())

    def iter_items(self):
        return self.data.items()

    @contextmanager
    def batch_update(self):
        yield self


class CachedPtsLookup:
    def __init__(self, disk_set):
        self.disk_set = disk_set

    def __call__(self, key):
        return self.disk_set.get(key)

    def cache_clear(self):
        pass


def test_assignment_worker_generates_copy_constraints():
    lhs = SimpleNamespace(id=10, name="lhs", order=1)
    rhs = SimpleNamespace(id=20, name="rhs", order=2)

    class FakeStore:
        def get_neighbor_nodes_batch(self, node_ids, direction, edge_types, target_labels=None):
            if edge_types == [EdgeType.AST.value, EdgeType.ARGUMENT.value]:
                return {100: [lhs, rhs]}
            if edge_types == [EdgeType.REF.value]:
                return {}
            raise AssertionError(f"Unexpected edge_types: {edge_types}")

    gpt.GlobalPointsToWorkerState.store = FakeStore()
    gpt.GlobalPointsToWorkerState.pts = FakeDiskSet(table_name="pts")
    gpt.GlobalPointsToWorkerState.copy_edges = FakeDiskSet(table_name="copy")
    gpt.GlobalPointsToWorkerState.load_constraints = FakeDiskSet(table_name="load")
    gpt.GlobalPointsToWorkerState.store_constraints = FakeDiskSet(table_name="store")

    result = gpt.assignment_worker(BaseTask(task_id="assign", payload={"ids": [100]}))

    assert result.status == "SUCCESS"
    assert gpt.GlobalPointsToWorkerState.copy_edges.get(20) == {10}


def test_solve_loop_propagates_copy_edges():
    points_to_pass = object.__new__(gpt.GlobalPointsToPass)
    points_to_pass.pts = FakeDiskSet({1: {101}}, table_name="pts")
    points_to_pass.copy_edges = FakeDiskSet({1: {2}}, table_name="copy")
    points_to_pass.load_constraints = FakeDiskSet(table_name="load")
    points_to_pass.store_constraints = FakeDiskSet(table_name="store")
    points_to_pass.worklist = set()
    points_to_pass._resolved_call_cache = set()
    points_to_pass._initialize_worklist = lambda: points_to_pass.worklist.update({1})
    points_to_pass._resolve_indirect_calls = lambda stats: 0
    points_to_pass._get_cached_pts = CachedPtsLookup(points_to_pass.pts)
    points_to_pass.SOLVER_MAX_ITER = 4

    stats = defaultdict(int)
    points_to_pass._solve_loop(stats)

    assert points_to_pass.pts.get(2) == {101}


def test_resolve_indirect_calls_writes_call_edges(monkeypatch):
    captured_edges = []

    class FakeWriter:
        def __init__(self, store, created_by, batch_size=5000):
            self.store = store
            self.created_by = created_by

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            return False

        def add_edge_tuple(self, src, dst, edge_type):
            captured_edges.append((src, dst, edge_type, self.created_by))

    class FakeStore:
        def __init__(self):
            self.query = SimpleNamespace(
                all_nodes=lambda _label: SimpleNamespace(
                    filter=lambda **kwargs: SimpleNamespace(
                        values=lambda *_args: [{"id": 500}]
                    )
                )
            )

        def get_neighbor_nodes_batch(self, node_ids, direction, edge_types, target_labels=None):
            assert node_ids == [500]
            assert direction == "OUT"
            assert edge_types == [EdgeType.AST.value]
            return {500: [SimpleNamespace(id=42, order=1)]}

    points_to_pass = object.__new__(gpt.GlobalPointsToPass)
    points_to_pass.store = FakeStore()
    points_to_pass._resolved_call_cache = set()
    points_to_pass._get_cached_pts = CachedPtsLookup(FakeDiskSet({42: {9001}}, table_name="pts"))

    monkeypatch.setattr(gpt, "BatchWriterContext", FakeWriter)

    stats = defaultdict(int)
    new_edges = points_to_pass._resolve_indirect_calls(stats)

    assert new_edges == 1
    assert captured_edges == [
        (500, 9001, EdgeType.CALL.value, points_to_pass.name)
    ]
    assert stats["dyn_calls"] == 1
