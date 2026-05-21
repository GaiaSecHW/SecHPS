# codedmap/core/schema/security/source_models.py
"""
Core data models for taint source detection.

Canonical location for SourceCategory and Source.
Mirrors the EntryPoint model structure.

Values are UPPERCASE to directly encode the ONTOLOGY tag name:
  Source.full_tag → f"ONTOLOGY:SOURCE:{category.value}" → "ONTOLOGY:SOURCE:NETWORK_DATA"

V2 ontology: 7 categories replacing the 15 V1 values.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from codedmap.core.schema.tags.layer import TagLayer


class SourceCategory(str, Enum):
    """
    V2 category of taint source based on data origin channel.

    Values are UPPERCASE and directly encode the ONTOLOGY:SOURCE:* tag name.
    Source.full_tag uses category.value directly:
      f"ONTOLOGY:SOURCE:{category.value}" → "ONTOLOGY:SOURCE:NETWORK_DATA"

    Categories (7 total — V2 ontology):
      NETWORK_DATA:        Network socket/HTTP/RPC/message-queue receive
                           (replaces HTTP_INPUT, NETWORK_IO)
      FILE_DATA:           File read, config parsing, JSON/XML/YAML/CSV
                           (replaces FILE_READ)
      ENV_DATA:            Environment variables, CLI args, stdin
                           (replaces ENV_VAR, CLI_ARGS, STDIN)
      IPC_DATA:            IPC, pipes, shared memory, DB results, process output, registry
                           (replaces DATABASE, IPC, PROCESS_OUTPUT, SHARED_MEMORY, REGISTRY)
      USER_SPACE_DATA:     Kernel copy_from_user, get_user, userspace data reads
                           (new in Phase 37)
      HARDWARE_STATE:      Hardware sensor inputs, timing, crypto-random
                           (replaces CRYPTO_RANDOM, TIMING, SENSOR)
      DESERIALIZED_OBJECT: Binary/unsafe deserialization output
                           (replaces DESERIALIZATION)
    """
    NETWORK_DATA        = "NETWORK_DATA"
    FILE_DATA           = "FILE_DATA"
    ENV_DATA            = "ENV_DATA"
    IPC_DATA            = "IPC_DATA"
    USER_SPACE_DATA     = "USER_SPACE_DATA"
    HARDWARE_STATE      = "HARDWARE_STATE"
    DESERIALIZED_OBJECT = "DESERIALIZED_OBJECT"


@dataclass
class Source:
    """
    Represents a detected taint source in the code.

    A source is a CPG node (method or call site) that introduces untrusted data.
    Mirrors the EntryPoint model structure with an added 'triggers' field.

    Attributes:
        node_id:   Unique identifier of the CPG node
        name:      Name of the function/method
        file:      Source file path
        line:      Line number in source file
        category:  Taint source category (ENV_VAR, NETWORK_IO, etc.)
        rule_name: Name of the rule that detected this source
        tags:      Additional tags for this source (optional)
        triggers:  List of trigger dicts — each has 'node' and 'taint_target' fields.
                   Shape: [{"node": {"id": ..., "label": ..., "code": ...}, "taint_target": "param[N]"}]
    """
    node_id: int
    name: str
    file: str
    line: int
    category: SourceCategory
    rule_name: str
    tags: List[str] = field(default_factory=list)
    triggers: List[Dict[str, Any]] = field(default_factory=list)
    origin: Optional[str] = None

    @property
    def full_tag(self) -> str:
        """
        Generate the full ONTOLOGY-format tag for this source.

        Format: ONTOLOGY:SOURCE:{category.value}
        Example: ONTOLOGY:SOURCE:ENV_VAR

        Category values are UPPERCASE so they directly encode the ontology name.
        """
        return f"{TagLayer.ONTOLOGY.value}:SOURCE:{self.category.value}"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize source to dictionary matching CONTEXT.md JSON shape."""
        return {
            "id": self.node_id,
            "label": "METHOD",
            "name": self.name,
            "file": self.file,
            "line": self.line,
            "category": self.category.value,
            "rule_name": self.rule_name,
            "tags": self.tags,
            "full_tag": self.full_tag,
            "triggers": self.triggers,
            "origin": self.origin,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Source":
        """Deserialize source from dictionary."""
        return cls(
            node_id=data["id"] if "id" in data else data["node_id"],
            name=data["name"],
            file=data["file"],
            line=data["line"],
            category=SourceCategory(data["category"]),
            rule_name=data["rule_name"],
            tags=data.get("tags", []),
            triggers=data.get("triggers", []),
            origin=data.get("origin"),
        )

    def __repr__(self) -> str:
        return (
            f"Source({self.name} at {self.file}:{self.line}, "
            f"category={self.category.value})"
        )
