# codedmap/core — CPG Schema & Graph Engine

This is the foundation layer of CodeDMap. All other modules (frontend, analysis, infra, features) depend on it. Changes here have wide blast radius.

## CRITICAL INVARIANT: Tags and Modules are strictly orthogonal

NEVER apply tags to ModuleNodes. Modules define MACRO business boundaries
(Directories/Files). Tags define MICRO architectural roles (Methods/ASTs).
For full provenance and schema rules, consult docs/TAG_SYSTEM.md.

## Module Map

```
core/
  schema/
    graph/                # ← NEW sub-package (20.6-01 reorganization)
      __init__.py         # Re-exports all public symbols
      base.py             # CPGNode, AstNode base classes + auto ID generation
      container.py        # CPGGraph container (in-memory graph with adjacency indexes)
      edges.py            # CPGEdge + factory methods
      enums.py            # NodeLabel, EdgeType, DispatchType, etc.
      categories.py       # Declaration, Expression, Statement base classes
      operators.py        # Joern operator constants (e.g., <operator>.assignment)
      patch.py            # GraphPatch for transactional graph mutations
      nodes/              # ← Split from monolithic nodes.py (45 classes)
        __init__.py       # Re-exports all node classes
        structure.py      # MetaDataNode, FileNode, DirectoryNode, ModuleNode, etc.
        declarations.py   # MethodNode, TypeDeclNode, LocalNode, MemberNode, etc.
        expressions.py    # CallNode, IdentifierNode, LiteralNode, etc.
        statements.py     # ReturnNode, JumpTargetNode, JumpLabelNode
        types.py          # TypeNode, TypeRefNode, BindingNode
        extensions.py     # VectorNode, EmbeddingChunkNode, InsightNode
        interop.py        # TagNode, FindingNode, KeyValuePairNode, etc.
    overlays/             # Extension nodes (fuzzing, dynamic trace)
  configs/
    settings.py           # CPGConfig (StorageConfig, ParserConfig, AIConfig, etc.)
    c_cpp_macros.py       # C/C++ macro definitions
  graph_builder.py        # CPGBuilder — high-level API for constructing CPG
  ast_validator.py        # GraphValidator — detects AST cycles
  diagnostics.py          # CollisionInvestigator — debug ID collisions
```

## Node Type Hierarchy

```
CPGNode (Pydantic BaseModel)
  |-- id: Optional[int]         # Auto-generated, see ID Generation below
  |-- label: Union[str, Enum]   # NodeLabel enum value
  |-- is_stub: bool             # Stub protection for merge
  |-- tags: List[str]
  |-- metadata: Dict (excluded from serialization)
  |
  +-- AstNode (has location info: line, column, offset, file_name, code)
  |     |
  |     +-- Declaration (has name, full_name, is_external)
  |     |     |-- FileNode (label=FILE)
  |     |     |-- MethodNode (label=METHOD, signature, summary)
  |     |     |-- MethodReturnNode (label=METHOD_RETURN)
  |     |     |-- MethodParameterInNode (label=METHOD_PARAMETER_IN, order)
  |     |     |-- MethodParameterOutNode (label=METHOD_PARAMETER_OUT, order)
  |     |     |-- LocalNode (label=LOCAL, typeFullName)
  |     |     |-- MemberNode (label=MEMBER, typeFullName)
  |     |     |-- TypeDeclNode (label=TYPE_DECL, inheritsFromTypeFullName)
  |     |     +-- NamespaceBlockNode (label=NAMESPACE_BLOCK)
  |     |
  |     +-- Expression (has argument_index, typeFullName)
  |     |     |-- CallNode (label=CALL, methodFullName, dispatchType)
  |     |     |-- IdentifierNode (label=IDENTIFIER, name)
  |     |     |-- LiteralNode (label=LITERAL)
  |     |     |-- BlockNode (label=BLOCK)
  |     |     |-- ControlStructureNode (label=CONTROL_STRUCTURE, controlStructureType)
  |     |     |-- FieldIdentifierNode (label=FIELD_IDENTIFIER, canonicalName)
  |     |     |-- MethodRefNode (label=METHOD_REF, methodFullName)
  |     |     +-- UnknownNode (label=UNKNOWN, parserTypeName)
  |     |
  |     +-- Statement
  |     |     +-- ReturnNode (label=RETURN)
  |     |
  |     |-- ImportNode (label=IMPORT, importedEntity)
  |     |-- CommentNode (label=COMMENT, is_docstring)
  |     |-- ModifierNode (label=MODIFIER, modifierType)
  |     |-- JumpTargetNode (label=JUMP_TARGET)
  |     +-- AnnotationNode (label=ANNOTATION)
  |
  +-- TypeNode (label=TYPE, full_name — global, no file dependency)
  +-- TypeRefNode (label=TYPE_REF, typeFullName)
  +-- BindingNode (label=BINDING — connects TypeDecl to Method)
  +-- ClosureBindingNode (label=CLOSURE_BINDING)
  +-- TagNode (label=TAG, name, value)
  +-- DirectoryNode (label=DIRECTORY, path)
  +-- ModuleNode (label=MODULE — architecture-level logical module, cross-directory)
  +-- MetaDataNode (label=META_DATA, language, version, root_path)
  +-- DependencyNode (label=DEPENDENCY, version)
  +-- InsightNode (label=INSIGHT — AI analysis results)
  +-- EmbeddingChunkNode (label=EMBEDDING_CHUNK — RAG chunks)
  +-- VectorNode (label=VECTOR — embedding vectors, cold storage)
  +-- GenericNode (label=UNKNOWN — fallback for unknown labels)
```

## ID Generation Strategy (CRITICAL)

All ID generation logic lives in `base.py:auto_generate_id` (model_validator) and `utils/id_generator.py`.

### Rules

| Node Category | ID Algorithm | Key Inputs | Stability |
|---|---|---|---|
| METHOD, TYPE_DECL | Deterministic SHA-256 | file_name + label + full_name + signature | Cross-run stable |
| TYPE | Deterministic SHA-256 | "TYPE" + full_name | Cross-run stable |
| FILE | Deterministic SHA-256 | "FILE" + path | Cross-run stable |
| META_DATA | Deterministic SHA-256 | "METADATA" + root_path + language | Cross-run stable |
| TAG | Deterministic SHA-256 | "TAG" + name + value | Cross-run stable |
| DIRECTORY | Deterministic SHA-256 | "DIR" + name + path | Cross-run stable |
| MODULE | Deterministic SHA-256 | "MODULE" + full_name | Cross-run stable |
| AST nodes (with file_name) | Deterministic SHA-256 | file_name + label + line + col + order + arg_idx + offset_start + offset_end + code[:32] | Cross-run stable if same parser output |
| Orphan nodes (no file_name) | Snowflake (timestamp-based) | machine_id + timestamp + sequence | NOT stable across runs |

### ID Generation Internals

- `generate_deterministic_id(*args)`: SHA-256 of `"|".join(args)`, truncated to 63-bit positive int (Neo4j/Java Long compatible)
- `generate_id()`: Snowflake generator (41-bit timestamp + 10-bit machine_id + 12-bit sequence), thread-safe
- Global nodes (METHOD, TYPE_DECL, FILE) use full_name as primary identity — same entity in different parse runs gets the same ID
- AST nodes use positional info — ID changes if source code changes line/column/offset

### Collision Handling

- `CPGBuilder._add_node()` detects ID collisions at insertion time
- Global nodes (FILE, METHOD, TYPE_DECL, etc.) are **mergeable** — collision = same entity, return existing
- Local AST nodes (CALL, BLOCK, etc.) are **non-mergeable** — collision = hash collision, generate salted new ID via `CollisionInvestigator.generate_salted_id()`
- Parent-child self-loop prevention: if child.id == parent.id after insertion, re-salt the child

### Known Constraint

- `auto_generate_id` must NOT perform IO (no `get_code()` calls). ID inputs must be available at construction time.
- If `code` field is needed for disambiguation, parser must pass it explicitly in constructor kwargs.

## Edge System

### CPGEdge Fields

```python
class CPGEdge(BaseModel):
    src: int                          # Source node ID
    dst: int                          # Target node ID
    type: Union[EdgeType, str]        # Edge type (enum or extension string)
    properties: Dict[str, Any] = {}   # Edge attributes
    created_by: str = "static"        # Which component created this edge
```

### Edge Types by Graph Layer

| Layer | Edge Types | Semantics |
|---|---|---|
| AST | AST, CONTAINS, SOURCE_FILE | Parent->child, File->Method, Node->File |
| Call Graph | CALL, RECEIVER, ARGUMENT, CONDITION | CallSite->Method, Call->receiver, Call->arg |
| CFG | CFG | Predecessor->Successor (properties.label = "true"/"false") |
| PDG | CDG, DDG | Control dependency, Data dependency (properties.variable = var_name) |
| Symbols | REF, EVAL_TYPE, BINDS, INHERITS_FROM | Identifier->Local, Expr->Type, TypeDecl->Method |
| Parameters | PARAMETER_LINK | ParamIn->ParamOut |
| Closures | CAPTURE, CAPTURED_BY | MethodRef->ClosureBinding, Local->MethodRef |
| Tags | TAGGED_BY | (removed in Phase 15 — tags use property-based storage on CPGNode.tags list) |
| Memory | POINTS_TO | Pointer->MemoryLocation |
| Files | INCLUDES | File->File (physical dependency) |
| AI/RAG | DOC_COMMENT, HAS_CHUNK, HAS_INSIGHT, HAS_VECTOR | Semantic overlays |
| Cross-Boundary | IPC, SYSCALL, RPC, SHARED_DATA | IPC/syscall/RPC/shared-data links between disjoint project forests |

### Edge Dedup

- Dedup hash includes `(src, dst, type, semantic_property)` where semantic_property is `variable` (DDG) or `label` (CFG)
- Two DDG edges with different variables between the same nodes are NOT duplicates
- Dedup set is an in-memory `Set[int]`; call `shrink_memory()` after build phase to release

## CPGGraph Container

**Location**: `schema/graph/container.py`

### Data Structures

- `nodes: Dict[int, AnyNode]` — primary node storage, O(1) lookup
- `edges: List[CPGEdge]` — primary edge storage
- `_out_index: Dict[int, List[CPGEdge]]` — outgoing adjacency list (private, not serialized)
- `_in_index: Dict[int, List[CPGEdge]]` — incoming adjacency list (private, not serialized)
- `_edge_dedup_set: Set[int]` — dedup hash set (cleared via `shrink_memory()`)

### Key Operations

| Operation | Complexity | Notes |
|---|---|---|
| `add_node(node)` | O(1) | Auto-assigns Snowflake ID if node.id is None |
| `add_edge(src, dst, type)` | O(1) amortized | Dedup check via hash set |
| `get_node_by_id(id)` | O(1) | Dict lookup |
| `get_out_edges(id, type?)` | O(k) | k = out-degree of node |
| `get_ast_children(id)` | O(k log k) | Sorted by `order` attribute |
| `remove_node(id, cascade?)` | O(E) | Rebuilds edge list; cascade recursively deletes AST subtree |
| `relocate_node_id(old, new)` | O(k) | Atomically moves node + updates all edges/indexes/dedup; k = degree |
| `merge(subgraph, consume?)` | O(N+E) | Smart merge with stub protection; consume=True frees source |
| `get_subgraph(ids)` | O(N+E) | Extracts induced subgraph |
| `apply_patch(patch)` | O(P) | Applies GraphPatch to in-memory graph (same protocol as storage writers) |

### Merge Strategy

When merging node with same ID:
- If existing is full (not stub) and new is stub -> **skip** (protect existing)
- Otherwise -> **overwrite** (upgrade stub to full, or replace full with full)

## CPGBuilder

**Location**: `graph_builder.py`

High-level API for constructing CPG graphs. Used by frontend parsers.

### Usage Pattern

```python
builder = CPGBuilder()
with builder.program_root():
    with builder.file("path/to/file.c"):
        with builder.namespace_block("<global>"):
            with builder.method("main", signature="int(int,char**)", return_type_full_name="int"):
                param = builder.parameter("argc", "int", order=0)
                with builder.block():
                    x = builder.local_variable("x", "int")
                    id_node = builder.identifier("x", "int")
                    lit = builder.literal("42", "int")
                    builder.assignment(id_node, lit)
                    call = builder.call("printf", "printf", args=[lit])
```

### Context Management

- `scope_stack: List[AstNode]` — tracks current nesting (File > Namespace > Method > Block > ...)
- `symbol_table_stack: List[Dict[str, RefableNode]]` — lexical scope symbol resolution
- `_semantic_cache: Dict[str, AnyNode]` — prevents duplicate FileNode/TypeDecl/Namespace creation
- `_directory_cache: Dict[str, DirectoryNode]` — directory tree dedup
- `_module_cache: Dict[str, ModuleNode]` — module dedup by full_name

### Collision Repair

`_reassign_node_id(node, salt_seed)` is the unified method for resolving ID collisions:
- If the node object is in the graph → uses `CPGGraph.relocate_node_id()` to preserve all existing edges
- If not in graph (different object at that ID) → just updates the node's ID attribute
- Used by `call()` for receiver/argument collision repair, replacing the old remove+re-add pattern that lost edges

### Auto-Injection

`_prepare_node_kwargs()` automatically injects into every node:
1. `file_name` — from current FileNode in scope stack (needed for deterministic ID)
2. `astParentType` — parent's label string (used by Linker for scope judgment)
3. `astParentFullName` — parent's full_name (used for C++ linking)

### Builder Methods

| Method | Node Created | Auto AST Edge | Notes |
|---|---|---|---|
| `file(name)` | FileNode | No (root) | Context manager, creates directory structure |
| `namespace_block(name)` | NamespaceBlockNode | Yes | Context manager, cached by full_name |
| `method(name, sig)` | MethodNode + MethodReturnNode | Yes | Context manager, creates METHOD_RETURN child |
| `type_decl(name, full_name)` | TypeDeclNode | Yes | Context manager, cached, merges inheritance |
| `block()` | BlockNode | Yes | Context manager |
| `control_structure(type)` | ControlStructureNode | Yes | Context manager |
| `parameter(name, type, order)` | ParamIn + ParamOut | Yes | Creates PARAMETER_LINK edge |
| `local_variable(name, type)` | LocalNode | Yes | Registers in symbol table |
| `identifier(name, type)` | IdentifierNode | Yes | Auto-creates REF edge if symbol found |
| `literal(code, type)` | LiteralNode | Yes | |
| `call(name, full_name, args)` | CallNode | Yes | Connects ARGUMENT + RECEIVER edges |
| `assignment(target, source)` | CallNode (operator) | Yes | Wraps as `<operator>.assignment` call |
| `field_access(base, field)` | CallNode + FieldIdentifierNode | Yes | `<operator>.fieldAccess` |
| `attach_modifier(node, type)` | ModifierNode | AST edge to target | |
| `attach_tag(node, key, val)` | TagNode | — | Adds tag to node.tags list (property-based storage) |
| `module(name, full_name)` | ModuleNode | No | Cached by full_name, merges list fields |
| `module_contains(module, target)` | — (edge only) | CONTAINS edge | Links module to File/Dir/sub-Module |

## GraphPatch (Transactional Mutations)

**Location**: `schema/patch.py`

For post-construction graph mutations (AI passes, analysis passes), use `GraphPatch` instead of direct graph modification. This enables transactional writes to external storage backends.

```python
patch = GraphPatch(created_by="SmartSummaryPass")
patch.update_node(method_id, summary="Allocates inode from bitmap")
patch.add_edge(method_id, tag_id, EdgeType.TAGGED_BY)
patch.remove_outgoing_neighbors(old_node_id, EdgeType.HAS_INSIGHT)

# Apply to storage backend (via Writer):
store.apply_patch(patch)

# Apply to in-memory CPGGraph directly:
graph.apply_patch(patch)
```

`CPGGraph.apply_patch()` follows the same execution order as `BaseGraphWriter.apply_patch()`:
Prune → Delete edges → Delete nodes → Add nodes → Update props → List ops → Add edges

### Patch Operations

- `add_node(node)` / `add_edge(src, dst, type)` — additions
- `remove_node(id)` / `remove_edge(src, dst, type)` — deletions
- `update_node(id, **props)` — property updates
- `property_list_append(id, key, val)` / `property_list_remove(id, key, val)` — atomic list ops
- `remove_outgoing_neighbors(src_id, edge_type)` — blind prune
- `merge(other_patch)` / `merge_all(patches)` — combine patches

## Configuration

**Location**: `configs/settings.py`

Root config: `CPGConfig(project_root=Path("."))` with sub-configs:
- `StorageConfig` — backend (memory/neo4j/sqlite), URI, credentials, batch_size, work_dir
- `ParserConfig` — languages, n_workers, import_path, skip_dirs, exclude_patterns
- `AIConfig` — enable_llm, provider, model_name, embed_model, api_key, api_base, runner_type, max_workers, batch_size, feature flags (enable_smart_dispatcher, enable_smart_resolver, enable_smart_summary, enable_embedding, enable_security_tagging)
- `JoernImportConfig` — enabled, export_dir, export_format, id_strategy, skip_unknown_labels, skip_edge_types, batch_size
- `AnalysisConfig` — max_call_depth, slicing_depth, runner_type
- `DispatchConfig` — critical_paths, ignore_paths, sensitive_keywords (for smart file prioritization)
- `PipelineConfig` — skip_ingestion, skip_analysis, skip_export (phase-level gating for `run_full_pipeline`). Method parameters override config values when not `None`. Use `skip_analysis=True` when importing from Joern/CodeQL which already provide Call Graph/DDG edges.

**`project_root` is optional** (defaults to `Path(".")`). Query-only scenarios (CLI, CPGStore with StorageConfig) don't need it. Build scenarios should provide it explicitly.

### Factory Methods

| Method | Purpose |
|---|---|
| `CPGConfig.load_from_yaml(path, project_root_override?)` | Load from YAML config file |
| `CPGConfig.for_build(project_root, **overrides)` | Create config for building a CPG graph |

### Minimal Config (Query-Only)

`CPGStore` and `StorageEngineFactory` accept either `CPGConfig` or `StorageConfig` directly. For query-only scenarios (CLI commands), pass `StorageConfig` alone — no need to construct a full `CPGConfig`:

```python
# Query-only: just StorageConfig
store = CPGStore(StorageConfig(backend="sqlite", uri="graph.db"))

# Build: full CPGConfig via factory
config = CPGConfig.for_build("/path/to/code", storage=StorageConfig(backend="sqlite", uri="out.db"))
```

## Overlays (Extension Nodes)

**Location**: `schema/overlays/`

For domain-specific extensions that don't belong in core schema:
- `OverlayNode(CPGNode)` — base class with `tool_info: Dict`
- `fuzzing.py` — FuzzCampaignNode, FuzzInputNode
- `trace.py` — TraceSessionNode, TraceEventNode, RuntimeValueNode
- Custom edge types as string constants (not in EdgeType enum): `EXECUTED_IN`, `NEXT_EVENT`, `MAPPED_TO`, `HAS_VALUE`

## Operators (Joern Standard)

**Location**: `schema/operators.py`

All operators use format `<operator>.operatorName`. Key ones for vulnerability analysis:
- Memory: `indexAccess`, `fieldAccess`, `indirectFieldAccess`, `indirection`, `addressOf`, `sizeOf`, `getElementPtr`, `pointerShift`
- Arithmetic: `addition`, `subtraction`, `preIncrement`, `postDecrement` (important for integer overflow detection)
- Assignment: `assignment`, `assignmentPlus`, etc.

## Known Issues & Tech Debt

1. **(Resolved in 20.6-01)** **AnyNode** — previously a manually-maintained 33-type Union in graph.py; now simplified to `AnyNode = CPGNode` with runtime dispatch via `_node_registry`
2. **`_node_registry`** — auto-populated by `__init_subclass__`; could be used to dynamically build AnyNode but currently isn't
3. **`AstNode.model_config = extra='allow'`** — silently absorbs typos in field names; consider `extra='ignore'` for safety
4. **`CPGNode.__hash__` mutability** — hash depends on `id` which can change during collision repair; don't put nodes in sets/dicts before ID is finalized
5. **(Fixed)** filename is now `diagnostics.py`
6. **(Resolved in 20.6-01)** **No `__init__.py`** in `core/schema/` — now has `graph/__init__.py` and `graph/nodes/__init__.py` with full re-exports
