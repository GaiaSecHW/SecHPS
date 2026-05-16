"""
Tests for cross-boundary annotation infrastructure in CLI:
- add_project_args() registers --project flag
- resolve_project_scope() returns None when absent, project_name when present
- filter_by_project() passes through when project_name is None
"""

import sys
import os
import argparse
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from codedmap.cli._bootstrap import add_project_args, resolve_project_scope, filter_by_project


class _MockStore:
    """Minimal store stub — not used in these tests but required by signature."""
    pass


class TestAddProjectArgsRegistersFlag:
    """test_add_project_args_registers_flag: parser accepts --project."""

    def test_add_project_args_registers_flag(self):
        p = argparse.ArgumentParser()
        add_project_args(p)
        args = p.parse_args(["--project", "kernel"])
        assert args.project == "kernel"

    def test_add_project_args_default_none(self):
        p = argparse.ArgumentParser()
        add_project_args(p)
        args = p.parse_args([])
        assert args.project is None


class TestResolveProjectScopeNoneWhenAbsent:
    """test_resolve_project_scope_none_when_absent: returns None when flag not in namespace."""

    def test_resolve_project_scope_none_when_absent(self):
        store = _MockStore()
        result = resolve_project_scope(store, SimpleNamespace())
        assert result is None

    def test_resolve_project_scope_none_when_explicit_none(self):
        store = _MockStore()
        result = resolve_project_scope(store, SimpleNamespace(project=None))
        assert result is None


class TestResolveProjectScopeReturnsName:
    """test_resolve_project_scope_returns_name: returns project_name string when present."""

    def test_resolve_project_scope_returns_name(self):
        store = _MockStore()
        result = resolve_project_scope(store, SimpleNamespace(project="kernel"))
        assert result == "kernel"

    def test_resolve_project_scope_returns_arbitrary_name(self):
        store = _MockStore()
        result = resolve_project_scope(store, SimpleNamespace(project="my-firmware-v2"))
        assert result == "my-firmware-v2"


class TestFilterByProjectPassthroughNoProject:
    """test_filter_by_project_passthrough_no_project: None project_name returns nodes unchanged."""

    def test_filter_by_project_passthrough_no_project(self):
        nodes = [object(), object(), object()]
        store = _MockStore()
        result = filter_by_project(nodes, None, store)
        assert result is nodes

    def test_filter_by_project_passthrough_with_project(self):
        """With a project name, current pass-through impl returns all nodes (single-project DB)."""
        nodes = [object(), object()]
        store = _MockStore()
        result = filter_by_project(nodes, "kernel", store)
        # Current implementation is a pass-through with TODO for multi-project lookup
        assert len(result) == len(nodes)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
