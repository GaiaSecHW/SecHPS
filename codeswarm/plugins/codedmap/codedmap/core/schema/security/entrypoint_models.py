# codedmap/core/schema/security/entrypoint_models.py
"""
Core data models for entry point detection.

Canonical location for EntryPointLevel, EntryPointCategory, EntryPoint.
Moved from app/entrypoints/models.py to eliminate analysis→app dependency.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from codedmap.core.schema.tags.layer import TagLayer


class EntryPointLevel(str, Enum):
    """
    Confidence level for entry point detection.

    L1 (raw): Direct detection from pattern match (e.g., recv() call).
    L2 (wrapped): Entry point wrapped in a known handler (e.g., HTTP handler).
    L3 (verified): Entry point confirmed by call graph analysis.
    """
    L1 = "L1"  # Raw pattern match
    L2 = "L2"  # Wrapped in handler
    L3 = "L3"  # Verified by analysis


class EntryPointCategory(str, Enum):
    """
    V2 category of entry point based on attack surface channel.

    Values are UPPERCASE to directly encode the ONTOLOGY tag name.
    EntryPoint.full_tag uses category.value directly:
      f"ONTOLOGY:ENTRY_POINT:{category.value}" → "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"

    V2 values (7 total — replaces 10 V1 values):
      NETWORK_LISTENER: HTTP/RPC/WebSocket/message-queue handlers
                        (replaces HTTP, RPC, WEBSOCKET, MESSAGE_QUEUE)
      IPC_HANDLER:      IPC channel handlers (pipes, shared memory, D-Bus)
                        (new — no direct V1 equivalent)
      CLI_COMMAND:      Command-line interface entry points (main, argparse, click)
                        (replaces CLI)
      PLUGIN_HOOK:      Plugin/extension hook registration (unchanged)
      SYSCALL_HANDLER:  Kernel syscall handlers and raw TCP socket server setup
                        (replaces SYSCALL)
      IOCTL_HANDLER:    Kernel ioctl handlers (file_operations, unlocked_ioctl)
                        (replaces IOCTL)
      HARDWARE_IRQ:     OS signal handlers, hardware interrupt handlers
                        (replaces SIGNAL_HANDLER)

    Removed: DATA_INPUT (it's a Source, not an EntryPoint)
    """
    NETWORK_LISTENER = "NETWORK_LISTENER"
    IPC_HANDLER = "IPC_HANDLER"
    CLI_COMMAND = "CLI_COMMAND"
    PLUGIN_HOOK = "PLUGIN_HOOK"
    SYSCALL_HANDLER = "SYSCALL_HANDLER"
    IOCTL_HANDLER = "IOCTL_HANDLER"
    HARDWARE_IRQ = "HARDWARE_IRQ"


@dataclass
class EntryPoint:
    """
    Represents a detected entry point in the code.

    Attributes:
        node_id: Unique identifier of the CPG node (method or call site)
        name: Name of the function/method
        file: Source file path
        line: Line number in source file
        level: Detection confidence level (L1/L2/L3)
        category: Entry point category (HTTP/CLI/RPC/etc.)
        rule_name: Name of the rule that detected this entry point
        tags: Additional tags for this entry point (optional)
    """
    node_id: int
    name: str
    file: str
    line: int
    level: EntryPointLevel
    category: EntryPointCategory
    rule_name: str
    tags: List[str] = field(default_factory=list)
    protocol: Optional[str] = None

    @property
    def full_tag(self) -> str:
        """
        Generate the full ONTOLOGY-format tag for this entry point.

        Format: ONTOLOGY:ENTRY_POINT:{category.value}
        Example: ONTOLOGY:ENTRY_POINT:HTTP

        Category values are UPPERCASE so they directly encode the ontology name.
        Level is stored separately in the EntryPoint.level field and in
        provenance metadata — it is NOT encoded in the tag string.
        """
        return f"{TagLayer.ONTOLOGY.value}:ENTRY_POINT:{self.category.value}"

    def to_dict(self) -> dict:
        """Serialize entry point to dictionary."""
        return {
            "node_id": self.node_id,
            "name": self.name,
            "file": self.file,
            "line": self.line,
            "level": self.level.value,
            "category": self.category.value,
            "rule_name": self.rule_name,
            "tags": self.tags,
            "full_tag": self.full_tag,
            "protocol": self.protocol,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "EntryPoint":
        """Deserialize entry point from dictionary."""
        return cls(
            node_id=data["node_id"],
            name=data["name"],
            file=data["file"],
            line=data["line"],
            level=EntryPointLevel(data["level"]),
            category=EntryPointCategory(data["category"]),
            rule_name=data["rule_name"],
            tags=data.get("tags", []),
            protocol=data.get("protocol"),
        )

    def __repr__(self) -> str:
        return (
            f"EntryPoint({self.name} at {self.file}:{self.line}, "
            f"level={self.level.value}, category={self.category.value})"
        )
