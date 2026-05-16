"""Shared module-scope helpers used by API and CLI adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Set

from codedmap.infra.storage.store import CPGStore


class ModuleNotFoundError(Exception):
    def __init__(self, name: str, suggestions: list | None = None):
        self.name = name
        self.suggestions = suggestions or []
        msg = f"Module not found: '{name}'"
        if self.suggestions:
            msg += f". Did you mean: {', '.join(self.suggestions)}?"
        super().__init__(msg)


class AmbiguousModuleError(Exception):
    def __init__(self, name: str, candidates: list):
        self.name = name
        self.candidates = candidates
        super().__init__(
            f"Ambiguous module: '{name}' matches {len(candidates)} modules. "
            "Use --module-id to disambiguate."
        )


@dataclass
class ModuleScope:
    module: object
    name: str
    file_ids: Set[int] = field(default_factory=set)
    method_ids: Set[int] = field(default_factory=set)
    file_count: int = 0
    method_count: int = 0

    def to_metadata_dict(self) -> dict:
        return {
            "name": self.name,
            "file_count": self.file_count,
            "method_count": self.method_count,
        }


def _build_module_scope(module_node, nav) -> ModuleScope:
    files = list(nav.get_files(module_node))
    methods = list(nav.get_methods(module_node))
    file_ids = {f.id for f in files if f.id is not None}
    method_ids = {m.id for m in methods if m.id is not None}
    return ModuleScope(
        module=module_node,
        name=getattr(module_node, "name", "?"),
        file_ids=file_ids,
        method_ids=method_ids,
        file_count=len(file_ids),
        method_count=len(method_ids),
    )


def resolve_module_scope(store: CPGStore, module: Optional[str], module_id: Optional[int]) -> Optional[ModuleScope]:
    from codedmap.analysis.traversal.module import ModuleNavigator
    from codedmap.core.schema.graph.enums import NodeLabel

    if module_id is None and module is None:
        return None

    nav = ModuleNavigator(store)
    if module_id is not None:
        node = store.get_node(module_id)
        if node is None:
            raise ModuleNotFoundError(name=str(module_id))
        label = getattr(node, "label", None)
        if hasattr(label, "value"):
            label = label.value
        if label != NodeLabel.MODULE.value:
            raise ModuleNotFoundError(name=str(module_id))
        return _build_module_scope(node, nav)

    matches = store.modules.find_by_name(module, exact_match=True)
    if not matches:
        matches = store.modules.find_by_name(module, exact_match=False)

    if not matches:
        raise ModuleNotFoundError(name=module or "")
    if len(matches) == 1:
        return _build_module_scope(matches[0], nav)
    candidates = [{"id": m.id, "name": getattr(m, "name", "?")} for m in matches]
    raise AmbiguousModuleError(name=module or "", candidates=candidates)


def filter_by_scope(nodes: list, scope: Optional[ModuleScope], store: CPGStore) -> list:
    if scope is None:
        return nodes
    result = []
    for node in nodes:
        node_id = getattr(node, "id", None)
        if node_id is None:
            continue
        file_node = store.ast.get_enclosing_file(node_id)
        if file_node is not None and file_node.id in scope.file_ids:
            result.append(node)
    return result

