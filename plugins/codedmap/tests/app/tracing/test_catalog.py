# tests/app/tracing/test_catalog.py
"""
Tests for SinkCatalog: loading, filtering, and lookup.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))

from codedmap.core.schema.security import SinkCatalog, SinkCategory, SinkDefinition


class TestSinkCatalog:
    """Tests for SinkCatalog class."""

    def test_empty_catalog(self):
        """Test creating an empty catalog."""
        catalog = SinkCatalog()
        assert len(catalog.sinks) == 0

    def test_add_sink(self):
        """Test adding a single sink."""
        catalog = SinkCatalog()
        sink = SinkDefinition("test", SinkCategory.MEMORY_WRITE)
        catalog.add_sink(sink)
        assert len(catalog.sinks) == 1
        assert catalog.sinks[0].name == "test"

    def test_add_sinks(self):
        """Test adding multiple sinks."""
        catalog = SinkCatalog()
        sinks = [
            SinkDefinition("a", SinkCategory.MEMORY_WRITE),
            SinkDefinition("b", SinkCategory.FILE_ACCESS),
        ]
        catalog.add_sinks(sinks)
        assert len(catalog.sinks) == 2


class TestSinkCatalogLoadDefault:
    """Tests for SinkCatalog.load_default()."""

    def test_load_default_returns_catalog(self):
        """Test that load_default returns a SinkCatalog."""
        catalog = SinkCatalog.load_default()
        assert isinstance(catalog, SinkCatalog)

    def test_load_default_has_sinks(self):
        """Test that default catalog has sinks."""
        catalog = SinkCatalog.load_default()
        assert len(catalog.sinks) >= 20

    def test_all_categories_present(self):
        """Test that V2 categories have sinks."""
        catalog = SinkCatalog.load_default()
        categories = catalog.get_all_categories()
        assert SinkCategory.MEMORY_WRITE in categories
        assert SinkCategory.FILE_ACCESS in categories
        assert SinkCategory.CODE_EVAL in categories


class TestSinkCatalogFiltering:
    """Tests for catalog filtering methods."""

    def test_by_category_memory_write(self):
        """Test filtering by MEMORY_WRITE category."""
        catalog = SinkCatalog.load_default()
        sinks = catalog.by_category(SinkCategory.MEMORY_WRITE)
        assert len(sinks) > 0
        for sink in sinks:
            assert sink.category == SinkCategory.MEMORY_WRITE

    def test_by_category_file_access(self):
        """Test filtering by FILE_ACCESS category."""
        catalog = SinkCatalog.load_default()
        file_sinks = catalog.by_category(SinkCategory.FILE_ACCESS)
        assert len(file_sinks) > 0
        for sink in file_sinks:
            assert sink.category == SinkCategory.FILE_ACCESS

    def test_by_category_code_eval(self):
        """Test filtering by CODE_EVAL category."""
        catalog = SinkCatalog.load_default()
        deserial_sinks = catalog.by_category(SinkCategory.CODE_EVAL)
        assert len(deserial_sinks) > 0
        for sink in deserial_sinks:
            assert sink.category == SinkCategory.CODE_EVAL

    def test_by_language_c(self):
        """Test filtering by C language."""
        catalog = SinkCatalog.load_default()
        c_sinks = catalog.by_language("c")
        assert len(c_sinks) > 0
        for sink in c_sinks:
            assert sink.matches_language("c")

    def test_by_language_python(self):
        """Test filtering by Python language."""
        catalog = SinkCatalog.load_default()
        python_sinks = catalog.by_language("python")
        assert len(python_sinks) > 0
        for sink in python_sinks:
            assert sink.matches_language("python")

    def test_by_language_case_insensitive(self):
        """Test that language filtering is case insensitive."""
        catalog = SinkCatalog.load_default()
        c_lower = catalog.by_language("c")
        c_upper = catalog.by_language("C")
        assert len(c_lower) == len(c_upper)


class TestSinkCatalogLookup:
    """Tests for catalog lookup methods."""

    def test_find_by_name_exact_match(self):
        """Test finding a sink by exact name."""
        catalog = SinkCatalog.load_default()
        sink = catalog.find_by_name("recv")
        assert sink is not None
        assert sink.name == "recv"

    def test_find_by_name_case_insensitive(self):
        """Test that name lookup is case insensitive."""
        catalog = SinkCatalog.load_default()
        sink = catalog.find_by_name("RECV")
        assert sink is not None
        assert sink.name.lower() == "recv"

    def test_find_by_name_short_name(self):
        """Test finding a sink by short name (e.g., recv matches socket.recv)."""
        catalog = SinkCatalog.load_default()
        # "recv" should match "socket.recv"
        sink = catalog.find_by_name("recv")
        # Could match either recv (C) or socket.recv (Python)
        assert sink is not None
        assert "recv" in sink.name.lower()

    def test_find_by_name_not_found(self):
        """Test finding a non-existent sink."""
        catalog = SinkCatalog.load_default()
        sink = catalog.find_by_name("nonexistent_function")
        assert sink is None

    def test_is_sink_true(self):
        """Test is_sink returns True for known sinks."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("recv") is True
        assert catalog.is_sink("memcpy") is True
        assert catalog.is_sink("pickle.load") is True

    def test_is_sink_false(self):
        """Test is_sink returns False for unknown functions."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("printf") is False
        assert catalog.is_sink("malloc") is False
        assert catalog.is_sink("unknown") is False


class TestSinkCatalogSerialization:
    """Tests for catalog serialization."""

    def test_to_dict(self):
        """Test serialization to dictionary."""
        catalog = SinkCatalog.load_default()
        d = catalog.to_dict()
        assert "version" in d
        assert d["version"] == 1
        assert "sinks" in d
        assert len(d["sinks"]) == len(catalog.sinks)

    def test_to_dict_contains_sink_data(self):
        """Test that to_dict contains proper sink data."""
        catalog = SinkCatalog.load_default()
        d = catalog.to_dict()
        # Check first sink has expected fields
        first_sink = d["sinks"][0]
        assert "name" in first_sink
        assert "category" in first_sink
        assert "languages" in first_sink


class TestDefaultSinks:
    """Tests for specific default sink definitions."""

    def test_network_sinks_c_cpp(self):
        """Test that C/C++ network sinks are present."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("recv") is True
        assert catalog.is_sink("recvfrom") is True
        assert catalog.is_sink("recvmsg") is True
        assert catalog.is_sink("accept") is True

    def test_network_sinks_python(self):
        """Test that Python network sinks are present."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("socket.recv") is True
        assert catalog.is_sink("socket.recvfrom") is True
        assert catalog.is_sink("socket.accept") is True

    def test_file_sinks_c_cpp(self):
        """Test that C/C++ file sinks are present."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("read") is True
        assert catalog.is_sink("fread") is True
        assert catalog.is_sink("fgets") is True
        assert catalog.is_sink("fscanf") is True
        assert catalog.is_sink("pread") is True

    def test_memory_sinks_c_cpp(self):
        """Test that C/C++ memory sinks are present."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("memcpy") is True
        assert catalog.is_sink("memmove") is True
        assert catalog.is_sink("strcpy") is True
        assert catalog.is_sink("strcat") is True
        assert catalog.is_sink("sprintf") is True
        assert catalog.is_sink("gets") is True

    def test_deserial_sinks_python(self):
        """Test that Python deserialization sinks are present."""
        catalog = SinkCatalog.load_default()
        assert catalog.is_sink("pickle.load") is True
        assert catalog.is_sink("pickle.loads") is True
        assert catalog.is_sink("yaml.load") is True
        assert catalog.is_sink("yaml.unsafe_load") is True
        assert catalog.is_sink("marshal.load") is True
        assert catalog.is_sink("shelve.open") is True


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
