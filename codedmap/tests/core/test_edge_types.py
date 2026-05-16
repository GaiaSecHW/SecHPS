"""Tests for cross-boundary EdgeType additions (Phase 30-01, Task 1.1)."""
import os
import sys

sys.path.append(os.getcwd())

from codedmap.core.schema.graph.enums import EdgeType, safe_str_to_enum


def test_ipc_edge_type_value():
    assert EdgeType.IPC.value == "IPC"


def test_syscall_edge_type_value():
    assert EdgeType.SYSCALL.value == "SYSCALL"


def test_rpc_edge_type_value():
    assert EdgeType.RPC.value == "RPC"


def test_shared_data_edge_type_value():
    assert EdgeType.SHARED_DATA.value == "SHARED_DATA"


def test_cross_boundary_edge_types_are_str_enum():
    for et in (EdgeType.IPC, EdgeType.SYSCALL, EdgeType.RPC, EdgeType.SHARED_DATA):
        assert isinstance(et, str), f"{et} should be an instance of str"


def test_safe_str_to_enum_cross_boundary():
    result = safe_str_to_enum("IPC", EdgeType, EdgeType.CALL)
    assert result == EdgeType.IPC
