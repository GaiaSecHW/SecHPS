# cpg_schema/infra/storage — Storage Layer

Backend-agnostic persistence layer for CPG graphs. Three drivers (Memory, SQLite, Neo4j) share one interface contract. All graph mutations from AI passes flow through `GraphPatch → BaseGraphWriter.apply_patch()`.

## Module Map

```
storage/
  interfaces.py          # All abstract contracts (StorageEngine, GraphReader, GraphWriter, TraversalInterface, etc.)
  store.py               # CPGStore — unified facade + repository dispatch
  factory.py             # StorageEngineFactory — conditional import registry
  repository.py          # Domain repositories (Method, File, AST, Tag, Insight, Vector)
  exceptions.py          # StorageError hierarchy (ConnectionError, IntegrityError, TransientError, SchemaError)
  disk_map.py            # DiskMap (SQLite KV) + DiskSet (1:N relation) + BatchUpdater — used by analysis passes
  base/
    writer.py            # BaseGraphWriter — Template Method for apply_patch() orchestration
    reader.py            # BaseGraphReader (stub)
    backend.py           # BaseBackend (minimal)
  bulk/
    base_writer.py       # BaseBulkWriter — streaming CSV output with file handle management
    encoder.py           # ValueEncoder, StandardJsonEncoder — serialize values for CSV
    introspector.py      # SchemaIntrospector — Pydantic model reflection for column schemas
  driver_memory/
    engine.py            # MemoryEngine
    store.py             # MemoryDatabase — wraps CPGGraph + RLock + GraphIndexer
    connection.py        # MemoryConnection, MemoryTransaction (RLock-based)
    reader.py            # MemoryReader — direct dict/index lookups
    writer.py            # MemoryWriter — in-place CPGGraph mutations
    traversal.py         # MemoryTraversalSource, MemoryTraversal — iterator-factory DSL
  driver_sqlite/
    engine.py            # SqliteEngine
    store.py             # SqliteDatabase — WAL mode, PRAGMA tuning, retry logic
    connection.py        # SqliteConnection, SqliteTransaction
    reader.py            # SqliteReader — SQL queries with chunked batching
    writer.py            # SqliteWriter — BEGIN IMMEDIATE + exponential retry
    serializer.py        # SqliteSerializer — row ↔ Pydantic conversion
    traversal.py         # SqliteTraversalSource, SqliteTraversal
    bulk/
      importer.py        # SqliteImporter — programmatic CSV→DB import
      writer.py          # SqliteBulkWriter — gzip CSV output
  driver_neo4j/
    engine.py            # Neo4jEngine
    client.py            # Neo4jClient — connection pool + session management
    connection.py        # Neo4jConnection, Neo4jTransactionContext
    reader.py            # Neo4jReader, SubgraphLoader — Cypher queries
    writer.py            # Neo4jWriter — delegates to BatchGraphWriter
    batch_writer.py      # BatchGraphWriter — batched Cypher UNWIND writes
    converter.py         # DataConverter — Neo4j Record ↔ Pydantic
    cypher.py            # CypherTemplates — all Cypher query templates
    schema_manager.py    # SchemaManager — index/constraint DDL
    traversal.py         # Neo4jTraversalSource, Neo4jTraversal
    loader.py            # Cypher query builders for subgraph loading
    bulk/
      encoder.py         # Neo4jBulkEncoder — neo4j-admin import format
      writer.py          # Neo4jBulkWriter — CSV for neo4j-admin
      command.py         # Import command generation
```

## Architecture Layers

```
┌──────────────────────────────────────────────────┐
│                  Application Code                 │
│       (Pipeline Passes, AI Passes, CLI)          │
├──────────────────────────────────────────────────┤
│                    CPGStore                        │
│           (Facade + Repository Layer)             │
│   ┌────────┬────────┬─────┬──────┬───────────┐   │
│   │Methods │ Files  │ AST │ Tags │ Insights   │   │
│   │  Repo  │  Repo  │Repo │ Repo │ /VectorRepo│   │
│   └────────┴────────┴─────┴──────┴───────────┘   │
├──────────────────────────────────────────────────┤
│              StorageEngine Interface               │
│     ┌──────────┬──────────┬────────────────┐      │
│     │  Reader  │  Writer  │ TraversalSource │      │
│     └──────────┴──────────┴────────────────┘      │
├──────────────────────────────────────────────────┤
│            Driver Implementations                  │
│   ┌───────────┬───────────┬────────────────────┐  │
│   │  Memory   │  SQLite   │      Neo4j         │  │
│   │ (CPGGraph │ (WAL mode,│  (Cypher queries,  │  │
│   │  in-mem)  │  JSON col)│   vector index)    │  │
│   └───────────┴───────────┴────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Key Interfaces (interfaces.py)

### EngineCapabilities — Feature Flags

```python
@dataclass(frozen=True)
class EngineCapabilities:
    supports_atomic_batch_ops: bool   # Batch write in single transaction
    supports_vector_search: bool      # Vector similarity index
    supports_bulk_export: bool        # CSV/Parquet export
    supports_transactions: bool       # ACID transactions
    memory_optimized: bool            # Pure in-memory (skip caching)
    supports_programmatic_import: bool # SDK-level CSV import
```

| Backend | atomic_batch | vector_search | bulk_export | transactions | memory_opt | prog_import |
|---------|-------------|---------------|-------------|--------------|------------|-------------|
| Memory  | No          | Yes (brute)   | Yes         | Yes (RLock)  | **Yes**    | No          |
| SQLite  | **Yes**     | No (Python)   | Yes         | Yes          | No         | **Yes**     |
| Neo4j   | **Yes**     | **Yes** (idx) | Yes         | Yes          | No         | No          |

### GraphReader — Query Side

| Method | Returns | Notes |
|--------|---------|-------|
| `get_node(id)` | `CPGNode?` | O(1) point lookup |
| `get_nodes_batch(ids)` | `List[CPGNode]` | SQLite: chunked IN (max 950 params) |
| `get_neighbors(id, dir, types?)` | `List[int]` | IDs only, no object creation |
| `get_neighbors_batch(ids, dir, types?)` | `Dict[int, List[int]]` | Batch adjacency |
| `get_neighbor_nodes_batch(ids, dir, types?, labels?)` | `Dict[int, List[CPGNode]]` | Server-side label filtering |
| `get_subgraph(ids)` | `CPGGraph` | Induced subgraph (nodes + internal edges) |
| `get_context_subgraph(root_id)` | `CPGGraph?` | Optimization hook — Neo4j: single Cypher, others: `None` |
| `search_similar_nodes(label, prop, vec, k)` | `List[(CPGNode, float)]` | Neo4j: vector index; Memory/SQLite: brute-force cosine |

### GraphWriter — Command Side

Two levels of abstraction:
- **Public API**: `save_graph()`, `apply_patch()`, `delete_nodes()`, `update_nodes_properties()`, `property_list_append/remove()`, `add_edges_batch()`, `add_tags_batch()`
- **Atomic Primitives** (called by `BaseGraphWriter.apply_patch()` inside transaction):
  `_prune_neighbors_atomic`, `_remove_edges_atomic`, `_remove_nodes_atomic`, `_add_nodes_atomic`, `_add_edges_atomic`, `_update_nodes_atomic`, `_update_node_lists_atomic`

### TraversalInterface[T] — Fluent DSL

**Topology Steps** (return new Traversal, lazy):
- `out(edge_type, target_class?)` / `in_(edge_type, target_class?)`
- `repeat(edge_type, direction, min_depth, max_depth, target_label?)`

**Filtering** (lazy):
- `filter(**kwargs)` — exact match
- `has_label(label)` / `has_tag(tag)` / `has_no_tag(tag)`
- `where_contains(prop, value)` — substring/contains
- `where_no_out_edge(edge_type)` — negative topology filter

**Configuration** (blocking ops marked):
- `limit(n)` — streaming
- `distinct()` — **blocking** (materializes full set)
- `order_by(prop, desc?)` — **blocking** (materializes for sort)
- `property(*keys)` — projection hint

**Semantic Shortcuts** (default implementations, drivers can override):
- `ast()` → `out("AST").order_by("order")`
- `ast_parent()` → `in_("AST")`
- `files(name?)` → `repeat("AST", "IN", max_depth=20, target_label="FILE")`
- `callers()` → `in_("CALL").in_("CONTAINS", MethodNode)`
- `callees()` → `out("CONTAINS").out("CALL", MethodNode)`
- `methods()` → `repeat("AST", "IN", max_depth=20, target_label="METHOD")`
- `insights(category?)` / `vectors()`

**Terminal Operations** (trigger execution):
- `to_list()` — eager, full materialization
- `first()` — optimized with `LIMIT 1`
- `count()` — drivers should override as `COUNT(*)`
- `id_list()` — IDs only, skip object creation
- `values(*keys)` / `raw()` — dict streaming, skip Pydantic
- `iter_batch(batch_size, shard_index?, total_shards?)` — paginated iteration

### TraversalSourceProtocol — DSL Entry Points

```python
source.by_id(node_id)            # Single node start
source.by_ids(node_ids)          # Multi-node start
source.methods(name?)            # Label=METHOD, optional name filter
source.files(name?)              # Label=FILE, optional name filter
source.all_nodes(label?)         # Full scan with optional label
source.vectors()                 # Label=VECTOR
```

## GraphPatch Execution Protocol (CRITICAL)

`BaseGraphWriter.apply_patch()` executes inside a transaction in strict order:

```
Step 0: _prune_neighbors_atomic()    # Blind delete outgoing neighbors (idempotent cleanup)
Step A: _remove_edges_atomic()       # Explicit edge removal
Step B: _remove_nodes_atomic()       # Explicit node deletion
Step C: _add_nodes_atomic()          # Node creation (strategy: OVERWRITE/SKIP/FAIL)
Step D1: _update_nodes_atomic()      # Property updates
Step D2: _update_node_lists_atomic() # Atomic list append/remove
Step E: _add_edges_atomic()          # Edge creation
```

**PruneRequest** has `src_id` and `edge_type` fields. It enables blind deletion of all outgoing edges of a specific type from a source node.

**PatchStrategy** controls conflict behavior in Step C:
- `OVERWRITE` — upsert (default)
- `SKIP_ON_EXIST` — keep existing
- `FAIL_ON_EXIST` — raise error

## CPGStore (store.py) — Unified Facade

`CPGStore` accepts either `CPGConfig` or `StorageConfig` directly:

```python
# Full config (pipeline/build scenarios):
store = CPGStore(CPGConfig(...))       # store._full_config = CPGConfig, store.config = StorageConfig

# Minimal config (query-only scenarios, CLI):
store = CPGStore(StorageConfig(...))   # store._full_config = None, store.config = StorageConfig
```

`store.config` always resolves to `StorageConfig` (not `CPGConfig`). The original `CPGConfig` is preserved in `store._full_config` (or `None` if constructed from `StorageConfig`).

```python
# Repository access
store.methods.find_by_name("main")
store.files.find_by_name("ext4.c")
store.ast.find_by_location("file.c", line=42)
store.tags.add(node, "SOURCE")
store.insights.create_and_attach(method, "SECURITY", content, "SmartSummaryPass")
store.vectors.get_vector_by_host(method_id)

# DSL queries
store.query.methods().where_contains("name", "alloc").to_list()
store.query.by_id(method_id).ast().filter(label="CALL").to_list()

# Graph operations
store.save(graph)                 # Merge CPGGraph to storage
store.apply_patch(patch)          # Atomic multi-step mutation
store.delete_nodes([id1, id2])

# Special features
store.load_method_to_memory(id)   # Context subgraph (optimized for Neo4j)
store.create_bulk_writer(dir)     # Stream-to-disk for large projects
store.import_bulk_data(dir)       # CSV→DB import
store.snapshot(dir)               # DB→CSV export
```

## Repository Pattern

| Repository | Model | Read Methods | Write Methods |
|-----------|-------|-------------|---------------|
| `GenericRepository[T]` | any `CPGNode` | `get_by_id`, `find_all`, `count`, `iter_all` | — |
| `MethodRepository` | `MethodNode` | + `find_by_name`, `find_by_full_name`, `find_by_file`, `iter_by_name_pattern` | — |
| `FileRepository` | `FileNode` | + `find_by_name` | — |
| `AstRepository` | `AstNode` | + `find_by_location`, `get_enclosing_method`, `get_enclosing_file`, `get_children`, `find_in_file` | — |
| `TagRepository` | — | `get_all`, `find_nodes` | `add`, `add_batch`, `remove` (atomic list ops via Writer) |
| `InsightRepository` | `InsightNode` | + `find_by_category`, `get_attached_insights` | `create_and_attach`, `delete_by_category`, `delete_by_source` |
| `VectorRepository` | `VectorNode` | + `get_vector_by_host` | `attach_vector` |

## Driver-Specific Details

### Memory Driver

- **Storage**: `MemoryDatabase` holds live `CPGGraph` object + `GraphIndexer` (label→ID mapping)
- **Concurrency**: `threading.RLock` via `MemoryTransaction`
- **Vector search**: Brute-force cosine similarity in Python (iterates all VectorNodes)
- **Traversal**: `MemoryTraversal` uses iterator-factory pattern — each DSL step wraps parent factory with new predicate
- **Blocking ops**: `distinct()` and `order_by()` force full materialization; `limit()` is streaming via `islice()`

### SQLite Driver

- **Schema**: 2 tables — `nodes(id PK, label, properties JSON)`, `edges(src, dst, type, properties JSON, created_by)` with `UNIQUE(src, dst, type)`
- **Edge indexes**: `idx_edges_src_type(src, type)`, `idx_edges_dst_type(dst, type)`, `idx_edges_cleanup(type, created_by)`
- **PRAGMA tuning**: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-64000` (64MB), `mmap_size=268435456` (256MB), `busy_timeout=30000`
- **Concurrency**: `BEGIN IMMEDIATE` for strong locks; `_execute_with_retry()` with exponential backoff (0.1-2.0s + jitter, up to 100 retries)
- **merge_graph()**: Retry loop (60 attempts) with exponential backoff for lock contention
- **Batch query limit**: Chunked IN queries, max 950 params per chunk (SQLite limit)
- **Vector search**: Loads all VECTOR nodes into Python, brute-force cosine, reverse-walks `HAS_VECTOR` edges
- **Bulk import**: `SqliteImporter` reads gzip CSV files, batch INSERT

### Neo4j Driver

- **Connection**: `Neo4jClient` wraps `neo4j.Driver` (max_connection_lifetime=3600); results are eagerly materialized to prevent cursor-after-session bugs
- **Schema init**: `SchemaManager` creates constraints + indexes on connect
- **Cypher templates**: In `cypher.py` — `NODE_MERGE_OVERWRITE`, `NODE_MERGE_SKIP`, `NODE_CREATE_FAIL`, `EDGE_MERGE`, `EDGE_CREATE`, `DELETE_NODES_BY_ID`
- **Prune logic**: Neo4j driver groups PruneRequests by `(edge_type, created_by)` from patch context → global vs scoped Cypher patterns
- **Batch writes**: `BatchGraphWriter` groups nodes by label, uses `UNWIND` for bulk operations
- **Context subgraph**: `SubgraphLoader.load_function_ast()` — single optimized Cypher query for method + AST + DataFlow
- **Vector search**: Uses `db.index.vector.queryNodes()` — native Neo4j vector index, then walks `HAS_VECTOR` to find host nodes

## Exception Hierarchy

```
StorageError
  ├── ConnectionError      # Connection failure
  ├── IntegrityError       # Unique constraint / FK violation
  ├── TransientError       # Deadlock / timeout (retryable)
  └── SchemaError          # Schema version mismatch
```

## Design Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Template Method** | `BaseGraphWriter.apply_patch()` | Orchestrates 5-step mutation; subclasses implement atomic ops |
| **Abstract Factory** | `StorageEngineFactory.create()` | Conditional imports, single creation point. Accepts `Union[CPGConfig, StorageConfig]`. |
| **Repository** | `GenericRepository[T]` + specialized repos | Domain-driven query abstraction over DSL |
| **Facade** | `CPGStore` | Unified entry point for application code |
| **Builder / Iterator** | `TraversalInterface[T]` | Fluent lazy DSL; each step returns new traversal |
| **Feature Flags** | `EngineCapabilities` | Explicit capability declarations instead of `hasattr()` |
| **Strategy** | `PatchStrategy` | Conflict resolution for node upsert |
| **Context Manager** | All transaction types | Resource cleanup + rollback guarantee |
| **Adapter** | `DataConverter` | Neo4j Records / SQLite rows ↔ Pydantic models |

## Data Flow: Typical Write Path

```
AI Pass produces analysis results
    ↓
creates GraphPatch(created_by="SmartSummaryPass")
    ↓
CPGStore.apply_patch(patch)
    ↓
BaseGraphWriter.apply_patch()        ← Template Method
    ↓  enters transaction
    ↓  Step 0: prune old insights
    ↓  Step C: add new InsightNodes
    ↓  Step D1: update method.summary
    ↓  Step E: add HAS_INSIGHT edges
    ↓  commits transaction
```

## Data Flow: Typical Read Path

```
Agent asks "find all allocation functions"
    ↓
store.query.methods().where_contains("name", "alloc").to_list()
    ↓
TraversalSource creates Traversal[MethodNode]
    ↓  .where_contains() adds filter predicate
    ↓  .to_list() triggers execution
    ↓
  Memory: iterate label index → apply Python predicate
  SQLite: SELECT * FROM nodes WHERE label='METHOD' AND properties->>'name' LIKE '%alloc%'
  Neo4j:  MATCH (n:METHOD) WHERE n.name CONTAINS 'alloc' RETURN n
```

## Bulk I/O Pipeline

```
 Parsing Phase (Stream-to-Disk)          Import Phase (Disk-to-DB)
┌──────────┐     ┌──────────────┐     ┌────────────────┐
│  Parser  │ ──→ │ BulkWriter   │ ──→ │  CSV/Gzip      │
│(per-file)│     │(stream nodes │     │  Files         │
│          │     │ + edges)     │     │  (per-label)   │
└──────────┘     └──────────────┘     └───────┬────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  SqliteImporter    │  (programmatic)
                                    │  or                │
                                    │  neo4j-admin import│  (manual CLI)
                                    └────────────────────┘
```

## Known Issues & Constraints

1. **Vector search in Memory/SQLite is brute-force** — loads all VectorNodes into Python for cosine similarity. Only viable for <100K vectors.
2. **SQLite `UNIQUE(src, dst, type)` on edges** — prevents multiple edges of same type between same nodes (unlike Neo4j which allows it). DDG edges with different `variable` values could conflict.
3. **`clear_db()` in CPGStore** uses `hasattr` check — fragile coupling to internal connection API.
4. **`DataConverter.to_pydantic()`** — shared between Neo4j and SQLite but lives in `driver_neo4j/converter.py`. Should be in `base/` or `bulk/`.
5. **No `apply_patch()` on CPGGraph** — previously patches could only be applied via storage writers. Now fixed: `CPGGraph.apply_patch()` exists (see core/CLAUDE.md).
6. **InsightRepository.create_and_attach()** creates a throwaway `CPGBuilder` just to build a mini-graph — consider using `CPGGraph` directly.
7. **Traversal `method()` shortcut** (singular) is defined on `TraversalInterface` but `methods()` (plural) is on `TraversalSourceProtocol` — naming inconsistency.

## Agent Rules

When modifying storage code:
- **Adding a new backend**: Implement `StorageEngine`, `GraphReader` (all abstract methods), subclass `BaseGraphWriter`, implement `TraversalSource` + `Traversal`. Register in `factory.py`.
- **Adding a new atomic operation to patches**: Add field to `GraphPatch` (patch.py), add step to `BaseGraphWriter.apply_patch()`, implement in all 3 driver writers, add to `CPGGraph.apply_patch()`.
- **Adding a new repository**: Extend `GenericRepository[T]` or write standalone (like `TagRepository`). Register in `CPGStore.__init__()`.
- **Adding a new DSL operator**: Add to `TraversalInterface` (abstract or mixin default), implement in all 3 driver traversals.
- After structural changes, update this CLAUDE.md.
