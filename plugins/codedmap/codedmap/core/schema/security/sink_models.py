# codedmap/core/schema/security/sink_models.py
"""
Core data models for backward tracing from sink functions.

Canonical location for SinkCategory, SinkDefinition, TraceHop, TracePath, TraceResult.
Moved from app/tracing/models.py to eliminate analysis→app dependency.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any

from codedmap.core.schema.tags.layer import TagLayer


class SinkCategory(str, Enum):
    """V2 sink categories — 10 values (Phase 37 expansion).

    Replaces STATE_MUTATION with INFO_LEAK, MEMORY_FREE, PRIVILEGE_MUTATION.

    Values are UPPERCASE to directly encode the ONTOLOGY:SINK:* tag name.

    V2 values (10 total):
      MEMORY_WRITE:      Memory write/copy sinks (strcpy, memcpy, sprintf, recv→buf)
      INFO_LEAK:         Out-of-bounds read, uninitialized memory leak (copy_to_user)
      MEMORY_ALLOC:      Memory allocation sinks (malloc, alloca, realloc, kmalloc)
      MEMORY_FREE:       Double free, use-after-free (free, kfree)
      PRIVILEGE_MUTATION: Privilege escalation, credential tampering (commit_creds, setuid)
      OS_COMMAND:        OS command execution (system, exec*, popen, ShellExecute)
      CODE_EVAL:         Code evaluation / unsafe deserialization (eval, pickle.load, yaml.load)
      FILE_ACCESS:       File read/write/open sinks (fopen, read, fread, fgets, open)
      DB_EXECUTE:        Database query execution (sqlite3_exec, mysql_query, cursor.execute)
      VIEW_RENDER:       Template/view rendering sinks (render_template, innerHTML)
    """
    MEMORY_WRITE       = "MEMORY_WRITE"
    INFO_LEAK          = "INFO_LEAK"
    MEMORY_ALLOC       = "MEMORY_ALLOC"
    MEMORY_FREE        = "MEMORY_FREE"
    PRIVILEGE_MUTATION = "PRIVILEGE_MUTATION"
    OS_COMMAND         = "OS_COMMAND"
    CODE_EVAL          = "CODE_EVAL"
    FILE_ACCESS        = "FILE_ACCESS"
    DB_EXECUTE         = "DB_EXECUTE"
    VIEW_RENDER        = "VIEW_RENDER"


@dataclass
class SinkDefinition:
    """
    A single dangerous sink function.

    Attributes:
        name: Function name (e.g., "strcpy", "system")
        category: V2 category of the sink
        languages: Languages this sink applies to (default: all)
    """
    name: str
    category: SinkCategory
    languages: List[str] = field(default_factory=lambda: ["c", "cpp", "python"])

    def matches_language(self, lang: str) -> bool:
        """Check if this sink applies to a given language."""
        return lang.lower() in [l.lower() for l in self.languages]

    @classmethod
    def from_dict(cls, data: dict) -> "SinkDefinition":
        """Create SinkDefinition from YAML-parsed dictionary."""
        return cls(
            name=data["name"],
            category=SinkCategory(data["category"]),
            languages=data.get("languages", ["c", "cpp", "python"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize sink definition to dictionary."""
        return {
            "name": self.name,
            "category": self.category.value,
            "languages": self.languages,
        }


@dataclass
class Sink:
    """
    Represents a detected sink call site in the code.

    A sink is a CPG METHOD node that contains calls to dangerous sink functions.
    Mirrors the Source model structure with sink-specific fields.

    Attributes:
        node_id:   Unique identifier of the enclosing METHOD CPG node
        name:      Name of the enclosing method
        file:      Source file path
        line:      Line number of the enclosing method
        category:  Sink category (MEMORY_WRITE, OS_COMMAND, etc.)
        sink_name: Name of the matched sink function (e.g., "strcpy")
        tags:      Additional tags for this sink (optional)
        triggers:  List of trigger dicts — each has 'node' and 'sink_name' fields.
                   Shape: [{"node": {"id": N, "label": "CALL", "code": "...", "name": "..."}, "sink_name": "strcpy"}]
    """
    node_id: int
    name: str
    file: str
    line: int
    category: SinkCategory
    sink_name: str
    tags: List[str] = field(default_factory=list)
    triggers: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def full_tag(self) -> str:
        """
        Generate the full ONTOLOGY-format tag for this sink.

        Format: ONTOLOGY:SINK:{category.value}
        Example: ONTOLOGY:SINK:MEMORY_WRITE
        """
        return f"{TagLayer.ONTOLOGY.value}:SINK:{self.category.value}"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize sink to dictionary."""
        return {
            "id": self.node_id,
            "label": "METHOD",
            "name": self.name,
            "file": self.file,
            "line": self.line,
            "category": self.category.value,
            "sink_name": self.sink_name,
            "tags": self.tags,
            "full_tag": self.full_tag,
            "triggers": self.triggers,
        }

    def __repr__(self) -> str:
        return (
            f"Sink({self.name} at {self.file}:{self.line}, "
            f"category={self.category.value}, sink_name={self.sink_name})"
        )


@dataclass
class TraceHop:
    """
    A single hop in the backward tracing path.

    Represents a node in the data flow path from sink to source.

    Attributes:
        node_id: Unique identifier of the CPG node
        file: Source file path
        line: Line number in source file
        code: Code snippet (truncated to 80 chars)
        hop_type: Type of hop ("ddg", "entry_point", or "source")
    """
    node_id: int
    file: str
    line: int
    code: str
    hop_type: str

    def to_dict(self) -> Dict[str, Any]:
        """Serialize hop to dictionary."""
        return {
            "node_id": self.node_id,
            "file": self.file,
            "line": self.line,
            "code": self.code,
            "hop_type": self.hop_type,
        }


@dataclass
class TracePath:
    """
    A single path from sink to controllable input.

    Attributes:
        hops: List of hops in the path (from sink to source)
        found_controllable: Whether a controllable input was found
        termination_reason: Why tracing stopped ("entry_point", "source", "max_depth")
    """
    hops: List[TraceHop]
    found_controllable: bool
    termination_reason: str

    @property
    def depth(self) -> int:
        """Number of hops in the path."""
        return len(self.hops)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize path to dictionary."""
        return {
            "hops": [h.to_dict() for h in self.hops],
            "found_controllable": self.found_controllable,
            "termination_reason": self.termination_reason,
            "depth": self.depth,
        }


@dataclass
class TraceResult:
    """
    Result of backward tracing from a sink.

    Contains all paths found from the sink to potential sources.

    Attributes:
        sink_node_id: Node ID of the sink function call
        paths: List of trace paths found
        max_depth_used: Maximum depth used for tracing
        total_paths: Total number of paths found
    """
    sink_node_id: int
    paths: List[TracePath]
    max_depth_used: int
    total_paths: int

    @property
    def found_controllable(self) -> bool:
        """Check if any path found a controllable input."""
        return any(p.found_controllable for p in self.paths)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize result to dictionary."""
        return {
            "sink_node_id": self.sink_node_id,
            "paths": [p.to_dict() for p in self.paths],
            "max_depth_used": self.max_depth_used,
            "total_paths": self.total_paths,
            "found_controllable": self.found_controllable,
        }

    def to_json(self) -> str:
        """Serialize result to JSON string."""
        import json
        return json.dumps(self.to_dict(), indent=2)
