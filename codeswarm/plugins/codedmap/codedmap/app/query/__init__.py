from importlib import import_module
from typing import Any

__all__ = [
    "CPG",
    "QueryStep",
    "QueryResult",
    "DSLError",
    "QuerySyntaxError",
    "QueryExecutionError",
    "GraphSlicer",
    "SubgraphExtractor",
    "SliceSerializer",
    "SubgraphExporter",
    "EntryPointContext",
    "EntryPointContextResult",
    "assemble_entry_point_context",
]

_EXPORTS = {
    "CPG": (".root", "CPG"),
    "QueryStep": (".step", "QueryStep"),
    "QueryResult": (".results", "QueryResult"),
    "DSLError": (".errors", "DSLError"),
    "QuerySyntaxError": (".errors", "QuerySyntaxError"),
    "QueryExecutionError": (".errors", "QueryExecutionError"),
    "GraphSlicer": (".slicer", "GraphSlicer"),
    "SubgraphExtractor": (".extractor", "SubgraphExtractor"),
    "SliceSerializer": (".serializer", "SliceSerializer"),
    "SubgraphExporter": (".serializer", "SubgraphExporter"),
    "EntryPointContext": (".context", "EntryPointContext"),
    "EntryPointContextResult": (".context", "EntryPointContextResult"),
    "assemble_entry_point_context": (".context", "assemble_entry_point_context"),
}


def __getattr__(name: str) -> Any:
    try:
        module_name, attr_name = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc

    module = import_module(module_name, __name__)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
