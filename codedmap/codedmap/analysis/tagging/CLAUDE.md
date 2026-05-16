# cpg_schema/analysis/tagging — Tag Engine & Navigator

## CRITICAL INVARIANT: Tags and Modules are strictly orthogonal

NEVER apply tags to ModuleNodes. Modules define MACRO business boundaries
(Directories/Files). Tags define MICRO architectural roles (Methods/ASTs).
For full provenance and schema rules, consult docs/TAG_SYSTEM.md.

Unified tagging business logic: permission-enforced writes, format validation, CRUD operations, rule-based batch tagging, and AI-assisted tagging (via factory injection). This is the **canonical entry point** for all tag mutations — CLI, DSL, analysis passes, and agent workflows all route through here.

## Cross-Layer Map

The tag system is a **cross-cutting concern** spanning four architectural layers. Each layer owns a distinct responsibility; no single layer can be removed without breaking the system.

```
Layer 0  core/schema/tags/           Pure data models (TagLayer, TagDefinition, TagRegistry,
│                                     SecurityTagMatcher, Provenance, AppliedBy, L1_ONTOLOGY)
│                                     Zero I/O, zero external deps.
│
Layer 0  core/schema/graph/base.py   CPGNode.tags: List[str]          ← flat string storage
│                                     CPGNode.tags_provenance: Dict    ← L2/L3 provenance metadata
│
Layer 1  infra/storage/repository.py TagRepository — storage CRUD via Writer
│                                     (add, remove, get_all, find_nodes, list_all)
│                                     Layer-agnostic: tags are just strings.
│
Layer 2  analysis/tagging/           ◀ YOU ARE HERE
│          engine.py                  TagEngine — unified API, permission enforcement, provenance
│          navigator.py               TagNavigator — validation, normalization, CRUD delegation
│
Layer 3  app/tagging/ai_tagger.py   AITagger — LLM-based tagging (depends on ContextLoader)
│                                     Injected into TagEngine via ai_tagger_factory callback.
│
Layer 4  cli/commands/tag.py         CLI entry: add, remove, list, find, bulk, bulk-file
```

### Data Flow (Write Path)

```
Agent / CLI / Pass
  │
  │  tagger.add(node, "SEMANTIC:AUTH:HIGH", applied_by="agent")
  │
  ▼
TagEngine.add()                          ← Layer 2
  ├── TagRegistry.is_writable(tag)       ← Layer 0 (rejects L1 ONTOLOGY writes)
  ├── TagNavigator.add_tag(node, tag)    ← Layer 2
  │     ├── _validate_tag_appropriate()    (format check + normalization)
  │     ├── store.tags.get_all(node)       (idempotency check)
  │     └── store.tags.add(node, tag)    ← Layer 1 (TagRepository → Writer)
  └── _record_provenance(node, tag)      ← Layer 2 (sets CPGNode.tags_provenance)
```

### Data Flow (Read Path)

```
Agent / CLI / Pass
  │
  │  tagger.find("ONTOLOGY:SOURCE:*")
  │
  ▼
TagEngine.find(pattern)                  ← Layer 2
  ├── store.tags.list_all(prefix=...)    ← Layer 1 (TagRepository → Reader)
  ├── fnmatch filter                     ← Layer 2 (wildcard matching)
  └── store.tags.find_nodes(tag)         ← Layer 1 (per matching tag)
```

## Module Map

```
analysis/tagging/
  __init__.py       # Exports: TagEngine, TagPermissionError, TagNavigator, TagResult
  engine.py         # TagEngine — unified API, three entry points (manual / rules / AI)
  navigator.py      # TagNavigator — validation, normalization, CRUD, bulk ops
  CLAUDE.md         # This file
```

## TagEngine (`engine.py`)

Single entry point for all tagging operations. Composes TagNavigator + TagRegistry + StaticSecurityRules + optional AITagger.

### Constructor

```python
TagEngine(store: CPGStore, ai_tagger_factory: Optional[Callable] = None)
```

`ai_tagger_factory` is a dependency-injection seam: `analysis/` cannot import from `app/`, so `AITagger` (which lives in `app/tagging/`) is injected as a callable `(store, **kwargs) -> AITagger`. When not provided, `ai_tag()` / `ai_tag_all()` raise `RuntimeError`.

### API Surface

| Method | Layer | Returns | Description |
|--------|-------|---------|-------------|
| `add(node, tag, applied_by)` | Manual | `TagResult` | Add tag (idempotent). Rejects L1 ONTOLOGY. Records provenance for L2/L3. |
| `add_system_tag(node, tag)` | System | `TagResult` | Add tag bypassing L1 permission check. For analysis passes (e.g., EntryPointPass) that write ONTOLOGY tags. |
| `remove(node, tag)` | Manual | `TagResult` | Remove tag from node. |
| `list_tags(node)` | Query | `List[str]` | All tags on a node. |
| `list_all_tags(prefix)` | Query | `List[str]` | All unique tags in database, optionally filtered. |
| `find(tag_pattern, limit)` | Query | `List[CPGNode]` | Find nodes by tag or wildcard pattern (`*`, `?`). |
| `bulk_tag(pattern, tag, node_type)` | Manual | `List[TagResult]` | Tag all nodes matching name pattern. |
| `auto_tag_by_rules()` | Rules | `int` | (Removed in Phase 38 — replaced by EntryPointPass/SourcePass/SinkPass pipeline passes.) |
| `ai_tag(method)` | AI | `List[str]` | LLM-based tagging on single method. Requires `ai_tagger_factory`. |
| `ai_tag_all(budget_limit)` | AI | `int` | LLM-based tagging on all internal methods with budget control. |

### Permission Model

| Tag Layer | Writable via `add()`? | Writable via `add_system_tag()`? | Writable via `auto_tag_by_rules()`? | Example |
|-----------|----------------------|----------------------------------|-------------------------------------|---------|
| L1 ONTOLOGY (read-only namespaces) | ✗ — raises `TagPermissionError` | ✓ — bypasses permission check | ✓ — via `_add_system_tag()` (internal) | `ONTOLOGY:SINK:DB_EXECUTE` |
| L1 ONTOLOGY (collaborative) | ✗ without justification; ✓ with justification | ✓ | ✗ | `ONTOLOGY:GUARD:BOUNDS_CHECK` |
| L2 SEMANTIC | ✓ | ✓ | ✗ (not applicable) | `SEMANTIC:AUTH:PASSWORD_HASH` |
| L3 STATE | ✓ | ✓ | ✗ (not applicable) | `STATE:REVIEWED` |

### Provenance Tracking

`TagEngine._record_provenance()` stores provenance metadata on `CPGNode.tags_provenance` for L2/L3 tags and collaborative L1 tags. The provenance dict is keyed by tag string, valued by `Provenance.model_dump()`:

```python
node.tags_provenance["SEMANTIC:AUTH:HIGH"] = {
    "applied_by": "agent",
    "timestamp": "2026-03-09T12:00:00Z",
    "justification": "confirmed hardcoded credential"
}
```

System-only L1 ONTOLOGY tags (ENTRY_POINT, SOURCE, SINK) do not get provenance records — they are applied automatically by analysis passes.

## TagNavigator (`navigator.py`)

Business logic layer for tag CRUD. Extends `BaseGraphNavigator`. Owns validation and normalization; delegates persistence to `CPGStore.tags` (TagRepository).

### Tag Format Rules

Only the layered colon-separated format is accepted:

| Format | Regex | Example | Layer Detection |
|--------|-------|---------|-----------------|
| Layered | `^(ONTOLOGY\|SEMANTIC\|STATE):[A-Z][A-Z0-9_]*(:[A-Z][A-Z0-9_]*)*$` | `ONTOLOGY:SINK:DB_EXECUTE` | Parsed from first colon-delimited segment |

All tags are normalized to uppercase. Empty tags raise `ValueError`. Tags without colon separation raise `ValueError` with a "colon-separated" message (old underscore-prefixed formats like `SOURCE_*`, `SINK_*` are rejected). Invalid formats raise `ValueError` with actionable message.

All tags must use colon-separated LAYER:NAMESPACE:NAME format.

### API Surface

| Method | Returns | Description |
|--------|---------|-------------|
| `validate_tag(tag)` | `(str, Optional[str])` | Normalize + validate. Returns (tag, warning). |
| `validate_namespaced_tag(tag)` | `(str, Optional[str])` | Validate layered format specifically. Falls back to `validate_tag` for non-colon tags. |
| `add_tag(node, tag)` | `TagResult` | Idempotent add. No permission check (that's TagEngine's job). |
| `remove_tag(node, tag)` | `TagResult` | Remove. Returns `not_found` if tag absent. |
| `list_tags(node)` | `List[str]` | All tags on node. |
| `find_by_tag(tag, limit)` | `List[CPGNode]` | Exact match or prefix match for namespaced tags. |
| `bulk_tag(pattern, tag, node_type)` | `List[TagResult]` | Bulk add by name substring. Supports method/module/any. |

### TagResult

```python
@dataclass
class TagResult:
    node_id: int
    node_name: str
    tag: str
    action: str       # "added" | "removed" | "already_exists" | "not_found"
    warning: str | None
```

## Dependencies

### What This Package Imports

| Dependency | Layer | Module | Used For |
|------------|-------|--------|----------|
| `CPGNode`, `MethodNode` | L0 | `core.schema.graph` | Node type hints |
| `TagRegistry` | L0 | `core.schema.tags.registry` | `is_writable()`, `get_layer()` |
| `TagLayer` | L0 | `core.schema.tags.layer` | Layer enum comparison |
| `Provenance`, `AppliedBy` | L0 | `core.schema.tags.provenance` | Provenance recording |
| `SecurityTagMatcher` | L0 | `core.schema.tags.matcher` | Check existing ONTOLOGY security tags |
| `StaticSecurityRules` | L0 | `core.schema.security` | Rule-based sink/source detection |
| `CPGStore` | L1 | `infra.storage.store` | Graph access (`.tags`, `.query`, `.methods`) |
| `BaseGraphNavigator` | L2 | `analysis.traversal.base` | Navigator base class |

### Who Imports This Package

| Consumer | Layer | Import Path | Purpose |
|----------|-------|-------------|---------|
| `cli/commands/tag.py` | L4 | `analysis.tagging.engine.TagEngine` | CLI tag subcommands |
| `cli/commands/traceback.py` | L4 | `analysis.tagging.engine.TagEngine` | Auto-tag during traceback |
| `cli/commands/module.py` | L4 | `analysis.tagging.navigator.TagNavigator` | Module tag/untag |
| `app/query/root.py` | L3 | `analysis.tagging.engine.TagEngine` | `CPG.tagger` property |
| `app/tagging/ai_tagger.py` | L3 | `analysis.tagging.navigator.TagNavigator` | AI tagger writes tags |
| `analysis/detection/module_detector.py` | L2 | `analysis.tagging.navigator.TagNavigator` | Tag modules during detection |
| `analysis/passes/batch/entry_point_pass.py` | L2 | `analysis.tagging.TagEngine` | Batch entry point tagging |
| `analysis/passes/ai/smart_dataflow_tagging.py` | L2 | `analysis.tagging.navigator.TagNavigator` | AI dataflow tagging pass |
| `analysis/traversal/__init__.py` | L2 | Lazy re-export of `TagNavigator` | Backward compatibility |

## Backward Compatibility

### Re-Export Shims

`analysis/traversal/__init__.py` has a `__getattr__` lazy re-export for `TagNavigator` — code that does `from cpg_schema.analysis.traversal import TagNavigator` still works. The canonical import path is `from cpg_schema.analysis.tagging import TagNavigator`.

## Three-Layer Tag Schema Summary

| Layer | Enum | Prefix | Mutability | Populated By | Example |
|-------|------|--------|------------|--------------|---------|
| L1 Ontology | `TagLayer.ONTOLOGY` | `ONTOLOGY:` | System read-only (GUARD/SANITIZER/ROLE collaborative) | `EntryPointPass`, `SourcePass`, `SinkPass`, `GuardPass`, `SanitizerPass` | `ONTOLOGY:SINK:DB_EXECUTE` |
| L2 Semantic | `TagLayer.SEMANTIC` | `SEMANTIC:` | Agent/pass-writable | `TagEngine.add()`, AI passes | `SEMANTIC:AUTH:PASSWORD_HASH` |
| L3 State | `TagLayer.STATE` | `STATE:` | Agent/human-writable | `TagEngine.add()`, CLI | `STATE:REVIEWED` |

L1 ontology is defined in `core/schema/tags/ontology.py` with 5 namespaces (SOURCE, SINK, SANITIZER, ENTRY_POINT, ROLE) totaling ~35 pre-defined tags.

## Tests

```
tests/core/schema/test_tags.py                          # TagLayer, TagDefinition, TagRegistry, L1_ONTOLOGY
tests/analysis/traversal/test_tag_navigator.py           # TagNavigator CRUD, validation, bulk ops
tests/app/tagging/test_tag_navigator_layers.py           # Layered format validation
tests/app/tagging/test_tag_engine_permissions.py         # L1 rejection, L2/L3 acceptance
tests/app/tagging/test_tag_api_compat.py                 # Colon-only format enforcement
tests/app/query/test_tag_registry_dsl.py                 # DSL integration with TagRegistry
tests/cli/test_tag_command.py                            # CLI tag subcommand end-to-end
tests/integration/test_tag_persistence.py                # Cross-backend tag persistence
```

## Extension Guide

### Adding a New Tag Namespace to L1 Ontology

1. Add entries to `ONTOLOGY_CATEGORIES` in `core/schema/tags/ontology.py`
2. Add description template to `_DESCRIPTIONS` in the same file
3. L1_ONTOLOGY is rebuilt automatically at import time
4. If the namespace has security semantics, add matcher methods to `SecurityTagMatcher` in `core/schema/tags/matcher.py`
5. If rule-based detection is needed, add patterns to `StaticSecurityRules` in `core/schema/security/static_rules.py` and wire into `TagEngine.auto_tag_by_rules()`

### Adding a New Tagging Strategy (e.g., ML-Based)

1. Create the strategy implementation in the appropriate layer:
   - Pure model/heuristic → `analysis/tagging/`
   - Needs AI provider / external I/O → `app/tagging/`
2. If in `app/`, inject into TagEngine via the same `ai_tagger_factory` pattern (or add a new factory parameter)
3. Never import from `app/` at module level in `analysis/`

### Adding Tag-Based Analytics / Reporting

1. Query-only logic that uses `CPGStore` → `analysis/tagging/stats.py` (new file)
2. Export from `analysis/tagging/__init__.py`
3. Wire into CLI via `cli/commands/tag.py` subcommand

## Agent Rules

- **TagEngine is the single write entry point.** Do not call `TagNavigator.add_tag()` directly from CLI or passes — route through `TagEngine.add()` to get permission enforcement and provenance tracking. For analysis passes that need to write L1 ONTOLOGY tags, use `TagEngine.add_system_tag()` instead of `_add_system_tag()`.
- **Tags are always uppercase.** Both `TagNavigator` and `TagEngine` normalize to uppercase. Do not store mixed-case tags.
- **Storage is layer-agnostic.** `TagRepository` and all storage drivers know nothing about L1/L2/L3. Layer enforcement is exclusively in `TagEngine`. Do not add layer logic to storage.
- **Keep AI tagging in `app/`.** `AITagger` depends on `ContextLoader` and AI providers — it belongs in `app/tagging/`, injected into TagEngine via factory. Do not move it to `analysis/`.
- **Layered colon-separated format is the only accepted format.** Use `LAYER:NAMESPACE:NAME` (e.g., `SEMANTIC:CRYPTO:WEAK_ALGORITHM`). Tags without colon separation (e.g., `SOURCE_HTTP_PARAM`) are rejected with a `ValueError`.
