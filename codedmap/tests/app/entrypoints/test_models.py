# tests/app/entrypoints/test_models.py
"""
Unit tests for entry point data models.
"""

import pytest

from codedmap.core.schema.security import (
    EntryPoint,
    EntryPointLevel,
    EntryPointCategory,
)


class TestEntryPointLevel:
    """Tests for EntryPointLevel enum."""

    def test_entry_point_level_enum_has_l1(self):
        """EntryPointLevel should have L1 value."""
        assert EntryPointLevel.L1 == "L1"
        assert EntryPointLevel.L1.value == "L1"

    def test_entry_point_level_enum_has_l2(self):
        """EntryPointLevel should have L2 value."""
        assert EntryPointLevel.L2 == "L2"
        assert EntryPointLevel.L2.value == "L2"

    def test_entry_point_level_enum_has_l3(self):
        """EntryPointLevel should have L3 value."""
        assert EntryPointLevel.L3 == "L3"
        assert EntryPointLevel.L3.value == "L3"

    def test_entry_point_level_count(self):
        """EntryPointLevel should have exactly 3 values."""
        assert len(EntryPointLevel) == 3

    def test_entry_point_level_is_string_enum(self):
        """EntryPointLevel should be a string enum."""
        assert isinstance(EntryPointLevel.L1.value, str)


class TestEntryPointCategory:
    """Tests for EntryPointCategory enum — V2 UPPERCASE values."""

    def test_entry_point_category_enum_has_network_listener(self):
        """EntryPointCategory should have NETWORK_LISTENER value."""
        assert EntryPointCategory.NETWORK_LISTENER == "NETWORK_LISTENER"
        assert EntryPointCategory.NETWORK_LISTENER.value == "NETWORK_LISTENER"

    def test_entry_point_category_enum_has_cli_command(self):
        """EntryPointCategory should have CLI_COMMAND value."""
        assert EntryPointCategory.CLI_COMMAND == "CLI_COMMAND"
        assert EntryPointCategory.CLI_COMMAND.value == "CLI_COMMAND"

    def test_entry_point_category_enum_has_ipc_handler(self):
        """EntryPointCategory should have IPC_HANDLER value."""
        assert EntryPointCategory.IPC_HANDLER == "IPC_HANDLER"
        assert EntryPointCategory.IPC_HANDLER.value == "IPC_HANDLER"

    def test_entry_point_category_enum_has_plugin_hook(self):
        """EntryPointCategory should have PLUGIN_HOOK value."""
        assert EntryPointCategory.PLUGIN_HOOK == "PLUGIN_HOOK"
        assert EntryPointCategory.PLUGIN_HOOK.value == "PLUGIN_HOOK"

    def test_entry_point_category_enum_has_syscall_handler(self):
        """EntryPointCategory should have SYSCALL_HANDLER value."""
        assert EntryPointCategory.SYSCALL_HANDLER == "SYSCALL_HANDLER"
        assert EntryPointCategory.SYSCALL_HANDLER.value == "SYSCALL_HANDLER"

    def test_entry_point_category_enum_has_ioctl_handler(self):
        """EntryPointCategory should have IOCTL_HANDLER value."""
        assert EntryPointCategory.IOCTL_HANDLER == "IOCTL_HANDLER"
        assert EntryPointCategory.IOCTL_HANDLER.value == "IOCTL_HANDLER"

    def test_entry_point_category_enum_has_hardware_irq(self):
        """EntryPointCategory should have HARDWARE_IRQ value."""
        assert EntryPointCategory.HARDWARE_IRQ == "HARDWARE_IRQ"
        assert EntryPointCategory.HARDWARE_IRQ.value == "HARDWARE_IRQ"

    def test_entry_point_category_count(self):
        """EntryPointCategory should have exactly 7 V2 values."""
        assert len(EntryPointCategory) == 7

    def test_entry_point_category_is_string_enum(self):
        """EntryPointCategory should be a string enum."""
        assert isinstance(EntryPointCategory.NETWORK_LISTENER.value, str)

    def test_entry_point_category_network_listener_constructs(self):
        """EntryPointCategory('NETWORK_LISTENER') should succeed."""
        cat = EntryPointCategory("NETWORK_LISTENER")
        assert cat == EntryPointCategory.NETWORK_LISTENER

    def test_entry_point_category_v1_raises(self):
        """EntryPointCategory('HTTP') (old V1 value) should raise ValueError."""
        with pytest.raises(ValueError):
            EntryPointCategory("HTTP")

    def test_no_category_to_ontology_dict(self):
        """_CATEGORY_TO_ONTOLOGY dict should not exist in entrypoint_models module."""
        import codedmap.core.schema.security.entrypoint_models as m
        assert not hasattr(m, "_CATEGORY_TO_ONTOLOGY"), (
            "_CATEGORY_TO_ONTOLOGY dict must be deleted; enum values ARE the ontology names"
        )


class TestEntryPoint:
    """Tests for EntryPoint dataclass."""

    def test_entry_point_creation(self):
        """EntryPoint should be creatable with all required fields."""
        ep = EntryPoint(
            node_id=12345,
            name="handle_request",
            file="server.c",
            line=42,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="http_handler",
        )
        assert ep.node_id == 12345
        assert ep.name == "handle_request"
        assert ep.file == "server.c"
        assert ep.line == 42
        assert ep.level == EntryPointLevel.L1
        assert ep.category == EntryPointCategory.NETWORK_LISTENER
        assert ep.rule_name == "http_handler"

    def test_entry_point_default_tags(self):
        """EntryPoint should default to empty tags list."""
        ep = EntryPoint(
            node_id=1,
            name="main",
            file="main.c",
            line=1,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="main_function",
        )
        assert ep.tags == []

    def test_entry_point_with_tags(self):
        """EntryPoint should accept custom tags."""
        ep = EntryPoint(
            node_id=1,
            name="read_config",
            file="config.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="file_read",
            tags=["config", "json"],
        )
        assert ep.tags == ["config", "json"]

    def test_entry_point_full_tag_network_listener(self):
        """EntryPoint.full_tag should return ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER."""
        ep = EntryPoint(
            node_id=1,
            name="recv_data",
            file="net.c",
            line=100,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="recv",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"

    def test_entry_point_full_tag_cli_command(self):
        """EntryPoint.full_tag should return ONTOLOGY:ENTRY_POINT:CLI_COMMAND."""
        ep = EntryPoint(
            node_id=2,
            name="main",
            file="main.c",
            line=5,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.CLI_COMMAND,
            rule_name="main_function",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:CLI_COMMAND"

    def test_entry_point_full_tag_syscall_handler(self):
        """EntryPoint.full_tag should return ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER."""
        ep = EntryPoint(
            node_id=4,
            name="ioctl_handler",
            file="driver.c",
            line=50,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.SYSCALL_HANDLER,
            rule_name="ioctl",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:SYSCALL_HANDLER"

    def test_entry_point_full_tag_all_categories_have_ontology_prefix(self):
        """All EntryPointCategory values produce ONTOLOGY:ENTRY_POINT: prefix."""
        for cat in EntryPointCategory:
            ep = EntryPoint(
                node_id=99, name="test", file="test.c", line=1,
                level=EntryPointLevel.L1, category=cat, rule_name="test"
            )
            assert ep.full_tag.startswith("ONTOLOGY:ENTRY_POINT:"), (
                f"Category {cat.value} produced wrong prefix: {ep.full_tag}"
            )
            # The suffix should be the category value itself (UPPERCASE)
            suffix = ep.full_tag.split("ONTOLOGY:ENTRY_POINT:")[1]
            assert suffix == cat.value, (
                f"full_tag suffix {suffix!r} should match category.value {cat.value!r}"
            )

    def test_entry_point_serialization(self):
        """EntryPoint should serialize to dict correctly."""
        ep = EntryPoint(
            node_id=100,
            name="process",
            file="app.py",
            line=25,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="http_request",
            tags=["api", "v2"],
        )
        data = ep.to_dict()
        assert data["node_id"] == 100
        assert data["name"] == "process"
        assert data["file"] == "app.py"
        assert data["line"] == 25
        assert data["level"] == "L2"
        assert data["category"] == "NETWORK_LISTENER"
        assert data["rule_name"] == "http_request"
        assert data["tags"] == ["api", "v2"]
        assert data["full_tag"] == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"

    def test_entry_point_deserialization(self):
        """EntryPoint should deserialize from dict correctly."""
        data = {
            "node_id": 200,
            "name": "handle",
            "file": "handler.py",
            "line": 30,
            "level": "L1",
            "category": "CLI_COMMAND",
            "rule_name": "argparse",
            "tags": ["command"],
        }
        ep = EntryPoint.from_dict(data)
        assert ep.node_id == 200
        assert ep.name == "handle"
        assert ep.file == "handler.py"
        assert ep.line == 30
        assert ep.level == EntryPointLevel.L1
        assert ep.category == EntryPointCategory.CLI_COMMAND
        assert ep.rule_name == "argparse"
        assert ep.tags == ["command"]

    def test_entry_point_repr(self):
        """EntryPoint should have a useful repr."""
        ep = EntryPoint(
            node_id=1,
            name="test_func",
            file="test.c",
            line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="test_rule",
        )
        repr_str = repr(ep)
        assert "test_func" in repr_str
        assert "test.c" in repr_str
        assert "L1" in repr_str
        assert "NETWORK_LISTENER" in repr_str

    def test_entry_point_roundtrip(self):
        """EntryPoint should survive serialization roundtrip."""
        original = EntryPoint(
            node_id=999,
            name="complex_entry",
            file="/path/to/file.cpp",
            line=1234,
            level=EntryPointLevel.L3,
            category=EntryPointCategory.IOCTL_HANDLER,
            rule_name="custom_rule",
            tags=["tag1", "tag2", "tag3"],
        )
        data = original.to_dict()
        restored = EntryPoint.from_dict(data)
        assert restored.node_id == original.node_id
        assert restored.name == original.name
        assert restored.file == original.file
        assert restored.line == original.line
        assert restored.level == original.level
        assert restored.category == original.category
        assert restored.rule_name == original.rule_name
        assert restored.tags == original.tags
        assert restored.full_tag == original.full_tag
