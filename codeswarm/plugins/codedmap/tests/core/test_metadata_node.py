"""Tests for MetaDataNode.project_name and RepairReason cross-boundary values (Phase 30-01, Task 1.2)."""
import os
import sys

sys.path.append(os.getcwd())

from codedmap.core.schema.graph.nodes.structure import MetaDataNode
from codedmap.core.schema.graph.enums import Language
from codedmap.cli.commands.repair import RepairReason


def test_metadata_node_project_name_optional():
    node = MetaDataNode(language=Language.C, root_path="/tmp", id=1)
    assert node.project_name is None


def test_metadata_node_project_name_set():
    node = MetaDataNode(language=Language.C, root_path="/tmp", id=2, project_name="my_project")
    dumped = node.model_dump(by_alias=True)
    assert dumped["projectName"] == "my_project"


def test_repair_reason_cross_boundary_values():
    assert RepairReason.IPC.value == "ipc"
    assert RepairReason.SYSCALL.value == "syscall"
    assert RepairReason.RPC.value == "rpc"
    assert RepairReason.SHARED_DATA.value == "shared_data"


def test_repair_reason_choices_include_cross_boundary():
    choices = [r.value for r in RepairReason]
    assert "ipc" in choices
    assert "syscall" in choices
