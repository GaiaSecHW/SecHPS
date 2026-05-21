# tests/app/tracing/test_models.py
"""
Tests for tracing models: SinkCategory, SinkDefinition, TraceHop, TracePath, TraceResult.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from codedmap.core.schema.security.sink_models import (
    SinkCategory,
    SinkDefinition,
    TraceHop,
    TracePath,
    TraceResult,
)


class TestSinkCategory:
    """Tests for SinkCategory enum."""

    def test_category_values(self):
        """Test that all expected V2 categories exist."""
        assert SinkCategory.MEMORY_WRITE.value == "MEMORY_WRITE"
        assert SinkCategory.FILE_ACCESS.value == "FILE_ACCESS"
        assert SinkCategory.CODE_EVAL.value == "CODE_EVAL"
        assert SinkCategory.OS_COMMAND.value == "OS_COMMAND"
        assert SinkCategory.MEMORY_ALLOC.value == "MEMORY_ALLOC"
        assert SinkCategory.DB_EXECUTE.value == "DB_EXECUTE"
        assert SinkCategory.VIEW_RENDER.value == "VIEW_RENDER"
        assert SinkCategory.INFO_LEAK.value == "INFO_LEAK"
        assert SinkCategory.MEMORY_FREE.value == "MEMORY_FREE"
        assert SinkCategory.PRIVILEGE_MUTATION.value == "PRIVILEGE_MUTATION"

    def test_category_count(self):
        """Test that there are exactly 10 V2 categories."""
        assert len(SinkCategory) == 10

    def test_category_is_string_enum(self):
        """Test that SinkCategory is a string enum."""
        assert isinstance(SinkCategory.MEMORY_WRITE, str)
        assert SinkCategory.MEMORY_WRITE == "MEMORY_WRITE"


class TestSinkDefinition:
    """Tests for SinkDefinition dataclass."""

    def test_basic_creation(self):
        """Test creating a basic sink definition."""
        sink = SinkDefinition("recv", SinkCategory.MEMORY_WRITE)
        assert sink.name == "recv"
        assert sink.category == SinkCategory.MEMORY_WRITE

    def test_full_creation(self):
        """Test creating a sink with all fields."""
        sink = SinkDefinition(
            name="pickle.load",
            category=SinkCategory.CODE_EVAL,
            languages=["python"],
        )
        assert sink.name == "pickle.load"
        assert sink.category == SinkCategory.CODE_EVAL
        assert sink.languages == ["python"]

    def test_default_languages(self):
        """Test that default languages include c, cpp, python."""
        sink = SinkDefinition("test", SinkCategory.MEMORY_WRITE)
        assert "c" in sink.languages
        assert "cpp" in sink.languages
        assert "python" in sink.languages

    def test_matches_language_case_insensitive(self):
        """Test that language matching is case insensitive."""
        sink = SinkDefinition("recv", SinkCategory.MEMORY_WRITE, ["c", "cpp"])
        assert sink.matches_language("c") is True
        assert sink.matches_language("C") is True
        assert sink.matches_language("CPP") is True
        assert sink.matches_language("python") is False

    def test_to_dict(self):
        """Test serialization to dictionary."""
        sink = SinkDefinition(
            name="memcpy",
            category=SinkCategory.MEMORY_WRITE,
            languages=["c", "cpp"],
        )
        d = sink.to_dict()
        assert d["name"] == "memcpy"
        assert d["category"] == "MEMORY_WRITE"
        assert d["languages"] == ["c", "cpp"]


class TestTraceHop:
    """Tests for TraceHop dataclass."""

    def test_basic_creation(self):
        """Test creating a basic trace hop."""
        hop = TraceHop(
            node_id=12345,
            file="test.c",
            line=42,
            code="x = recv(sock, buf, len, 0);",
            hop_type="ddg"
        )
        assert hop.node_id == 12345
        assert hop.file == "test.c"
        assert hop.line == 42
        assert hop.hop_type == "ddg"

    def test_to_dict(self):
        """Test serialization to dictionary."""
        hop = TraceHop(
            node_id=1,
            file="a.py",
            line=10,
            code="data = sock.recv(1024)",
            hop_type="ddg"
        )
        d = hop.to_dict()
        assert d["node_id"] == 1
        assert d["file"] == "a.py"
        assert d["line"] == 10
        assert d["code"] == "data = sock.recv(1024)"
        assert d["hop_type"] == "ddg"


class TestTracePath:
    """Tests for TracePath dataclass."""

    def test_empty_path(self):
        """Test creating an empty path."""
        path = TracePath(hops=[], found_controllable=False, termination_reason="max_depth")
        assert path.depth == 0
        assert path.found_controllable is False

    def test_path_with_hops(self):
        """Test creating a path with hops."""
        hop1 = TraceHop(1, "a.c", 10, "recv()", "ddg")
        hop2 = TraceHop(2, "a.c", 5, "entry_point", "entry_point")
        path = TracePath(hops=[hop1, hop2], found_controllable=True, termination_reason="entry_point")
        assert path.depth == 2
        assert path.found_controllable is True

    def test_to_dict(self):
        """Test serialization to dictionary."""
        hop = TraceHop(1, "a.c", 10, "recv()", "ddg")
        path = TracePath(hops=[hop], found_controllable=True, termination_reason="source")
        d = path.to_dict()
        assert d["depth"] == 1
        assert d["found_controllable"] is True
        assert d["termination_reason"] == "source"
        assert len(d["hops"]) == 1


class TestTraceResult:
    """Tests for TraceResult dataclass."""

    def test_empty_result(self):
        """Test creating an empty result."""
        result = TraceResult(sink_node_id=100, paths=[], max_depth_used=10, total_paths=0)
        assert result.sink_node_id == 100
        assert result.total_paths == 0
        assert result.found_controllable is False

    def test_result_with_paths(self):
        """Test creating a result with paths."""
        hop = TraceHop(1, "a.c", 10, "recv()", "ddg")
        path = TracePath(hops=[hop], found_controllable=True, termination_reason="source")
        result = TraceResult(sink_node_id=100, paths=[path], max_depth_used=5, total_paths=1)
        assert result.total_paths == 1
        assert result.found_controllable is True

    def test_found_controllable_aggregation(self):
        """Test that found_controllable aggregates from paths."""
        path1 = TracePath([], False, "max_depth")
        path2 = TracePath([], True, "source")
        result = TraceResult(sink_node_id=1, paths=[path1, path2], max_depth_used=10, total_paths=2)
        assert result.found_controllable is True

    def test_to_dict(self):
        """Test serialization to dictionary."""
        hop = TraceHop(1, "a.c", 10, "recv()", "ddg")
        path = TracePath(hops=[hop], found_controllable=True, termination_reason="source")
        result = TraceResult(sink_node_id=100, paths=[path], max_depth_used=5, total_paths=1)
        d = result.to_dict()
        assert d["sink_node_id"] == 100
        assert d["max_depth_used"] == 5
        assert d["total_paths"] == 1
        assert d["found_controllable"] is True
        assert len(d["paths"]) == 1

    def test_to_json(self):
        """Test JSON serialization."""
        result = TraceResult(sink_node_id=1, paths=[], max_depth_used=5, total_paths=0)
        json_str = result.to_json()
        assert '"sink_node_id": 1' in json_str
        assert '"total_paths": 0' in json_str


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
