# cpg_schema/frontend/integrations/joern — Joern Neo4j CSV Importer

Imports Joern's `neo4jcsv` export (nodes.csv + edges.csv) into cpg_schema's CPGGraph or storage backends. This replaces the native tree-sitter/libclang frontend when analyzing codebases that Joern already parsed.

## Module Map

```
joern/
  constants.py   # Mapping tables: property names, label aliases, edge aliases, skip sets
  csv_parser.py  # Low-level Neo4j CSV reader (header type annotations, value conversion, gzip, split-format auto-merge)
  mapper.py      # JoernNodeMapper + JoernEdgeMapper (label/property/enum normalization)
  id_bridge.py   # JoernIdBridge — Joern ID -> cpg_schema ID translation (3 strategies)
  importer.py    # JoernCSVImporter — top-level orchestrator (2-pass: nodes then edges)
```

## Data Flow

```
Joern export dir
  │
  ├── nodes.csv ─┐
  └── edges.csv ─┤
                 │
         find_csv_files()          # csv_parser.py — discover node/edge files
                 │
  ┌──────────────┴──────────────┐
  │  Pass 1: Nodes              │  Pass 2: Edges
  │                             │
  │  parse_nodes()              │  parse_edges()
  │  ColumnSpec + _convert_value│  ColumnSpec + _convert_value
  │       │                     │       │
  │  JoernNodeMapper.map_node() │  JoernEdgeMapper.map_edge()
  │  (label alias + property    │  (type alias + semantic props)
  │   rename + enum conversion) │       │
  │       │                     │  JoernIdBridge.translate_edge_id()
  │  JoernIdBridge              │  (lookup joern_id -> cpg_id)
  │   .translate_node_id()      │       │
  │  (passthrough/regenerate/   │  graph.add_edge(src, dst, **kwargs)
  │   hybrid + record mapping)  │  or store.add_edges_batch()
  │       │                     │
  │  node_class(**kwargs)       │
  │  graph.add_node(node)       │
  │  or GraphPatch -> store     │
  └─────────────────────────────┘
```

## ID Strategy

`JoernIdBridge` supports three strategies via `IdStrategy = Literal["passthrough", "regenerate", "hybrid"]`:

| Strategy | Global Nodes | AST Nodes | Use Case |
|---|---|---|---|
| `passthrough` | Keep Joern ID | Keep Joern ID | Standalone import, no merge with native CPG |
| `regenerate` | SHA-256 from props | SHA-256 from props | Full ID parity with native parser output |
| `hybrid` (default) | SHA-256 from props | Keep Joern ID | Merge global declarations while preserving Joern-internal references |

### `_regenerate_id` Alignment with `auto_generate_id`

The `_regenerate_id` method in `id_bridge.py` mirrors the ID generation logic in `core/schema/base.py:auto_generate_id`:

| Node Category | `_regenerate_id` Inputs | Matches `auto_generate_id`? |
|---|---|---|
| METHOD | `file_name, "METHOD", fullName, signature` | Yes — same 4-tuple |
| TYPE_DECL | `file_name, "TYPE_DECL", fullName, ""` | Yes |
| TYPE | `"GLOBAL", "TYPE", fullName` | Close — no file_name for global types |
| FILE | `"FILE", fullName` | Yes |
| META_DATA | `"GLOBAL", "META_DATA", fullName` | Yes |
| NAMESPACE_BLOCK | `file_name, "NAMESPACE_BLOCK", fullName, ""` | Yes |
| AST (with file) | `file_name, label, line, col, order, argIdx, start, end, code[:32]` | Yes — same positional tuple |
| Fallback | `"JOERN", label, fullName` | N/A — never generated natively |

**Global node labels** triggering regeneration in hybrid mode are defined in `constants.GLOBAL_NODE_LABELS`:
`{METHOD, TYPE_DECL, TYPE, FILE, META_DATA, NAMESPACE_BLOCK}`

## Label & Edge Mapping

### Node Label Aliases (`NODE_LABEL_ALIAS`)

| Joern Label | cpg_schema Label | Reason |
|---|---|---|
| `NAMESPACE` | `NAMESPACE_BLOCK` | Joern uses shorter name |
| `TYPE_ARGUMENT` | `TYPE_REF` | Mapped to closest equivalent |
| `CONFIG_FILE` | `FILE` | Treated as regular file node |
| `TYPE_PARAMETER` | `TYPE_REF` | Mapped to closest equivalent |

Labels not in the alias table are used as-is. If a label doesn't match any `CPGNode` subclass (via `_node_registry`), it falls back to `GenericNode` (unless `skip_unknown_labels=True`).

### Edge Type Aliases (`EDGE_TYPE_ALIAS`)

| Joern Type | cpg_schema Type | Notes |
|---|---|---|
| `REACHING_DEF` | `DDG` | Joern's name for data dependency |
| `DOMINATE` | `CDG` | Mapped to control dependency |
| `POST_DOMINATE` | `CDG` | Also mapped to CDG |

### Skipped Properties (`SKIP_PROPERTIES`)

`OVERLAYS`, `CONTAINED_REF`, `INHERITS_FROM_TYPE_FULL_NAME` (the last is handled specially in `mapper._handle_special_fields` as a semicolon-separated list).

## Configuration

`JoernImportConfig` lives in `core/configs/settings.py` and is accessed as `CPGConfig.joern_import`:

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `bool` | `False` | Enable Joern import as ingestion source |
| `export_dir` | `Optional[Path]` | `None` | Path to Joern `neo4jcsv` export directory |
| `export_format` | `Literal["neo4jcsv"]` | `"neo4jcsv"` | Only `neo4jcsv` supported |
| `id_strategy` | `Literal["regenerate","passthrough","hybrid"]` | `"hybrid"` | ID translation strategy |
| `skip_unknown_labels` | `bool` | `False` | Skip nodes with unknown labels vs. GenericNode fallback |
| `skip_edge_types` | `List[str]` | `[]` | Edge types to drop (e.g., `["DOMINATE", "POST_DOMINATE"]`) |
| `batch_size` | `int` | `5000` | Batch size for `run_to_store` GraphPatch flushes |

### Recommended Pipeline Config

Since Joern already computes Call Graph, DDG, CDG edges, set `skip_analysis=True` to avoid re-running global passes:

```yaml
joern_import:
  enabled: true
  export_dir: /path/to/joern/export
  id_strategy: hybrid

pipeline:
  skip_analysis: true   # Joern already provides CG/DDG/CDG edges
```

## Pipeline Integration

The orchestrator (`pipeline/orchestrator.py`) routes to Joern import in `run_full_pipeline`:

```python
# orchestrator.py:238
if self.config.joern_import.enabled and self.config.joern_import.export_dir:
    self._run_joern_import_phase()    # -> JoernCSVImporter.run_to_store()
else:
    self._run_ingestion_phase()       # -> native FrontendPipeline
```

The Joern import phase replaces the entire frontend ingestion (Phase 1). Subsequent phases (analysis, export) proceed normally, gated by `PipelineConfig.skip_analysis` / `skip_export`.

## Usage

### Direct API

```python
from cpg_schema.frontend.integrations.joern.importer import JoernCSVImporter

# In-memory mode (small/medium projects)
importer = JoernCSVImporter(id_strategy="hybrid")
stats = importer.run("/path/to/joern/export")
graph = importer.get_graph()  # CPGGraph

# Store mode (large projects, batched writes)
importer = JoernCSVImporter(id_strategy="hybrid", batch_size=10000)
stats = importer.run_to_store("/path/to/joern/export", store)
```

### Via Pipeline

```python
from cpg_schema.core.configs.settings import CPGConfig

config = CPGConfig(
    project_root="/src/target",
    joern_import={"enabled": True, "export_dir": "/path/to/joern/export"},
    pipeline={"skip_analysis": True},
)
orchestrator = PipelineOrchestrator(config)
orchestrator.run_full_pipeline()
```

## Test Fixtures

Located at `tests/frontend/integrations/joern/fixtures/`:

### `nodes.csv`

- **Format**: Neo4j CSV with typed headers (`:ID`, `NAME:STRING`, `LINE_NUMBER:INT`, `:LABEL`, etc.)
- **21 nodes** covering: METHOD, METHOD_PARAMETER_IN, LOCAL, BLOCK, CALL (x2: `printf` + `<operator>.assignment`), IDENTIFIER, LITERAL, FILE, NAMESPACE_BLOCK, TYPE_DECL (with `INHERITS_FROM_TYPE_FULL_NAME=int;float`), MODIFIER, RETURN, IMPORT, JUMP_TARGET, METHOD_RETURN, TYPE (x2), BINDING, CONTROL_STRUCTURE, FIELD_IDENTIFIER
- **Simulates**: A minimal C file `test.c` with `main()`, variable assignment, printf call, if-statement, struct with inheritance

### `edges.csv`

- **Format**: `:START_ID,:END_ID,:TYPE,VARIABLE:STRING`
- **23 edges** covering: AST (x11), CONTAINS (x2), ARGUMENT (x1), CFG (x4), DDG (x1, with `VARIABLE=x`), REF (x1), CALL (x1), EVAL_TYPE (x1)

## Integration Tests

### `test_joern_sqlite_import.py`

Integration test that imports real Joern Neo4j CSV export (gzip project) into SQLite backend. Tests the full pipeline: CSV parse → node/edge mapping → ID translation → SQLite storage.

**Key test classes:**
- `TestImportStats` — Verify import completes with expected scale (>1000 nodes, >5000 edges)
- `TestNodeQueries` — Query imported nodes via CPGStore (methods, files, calls, identifiers, type_decls, literals, locals)
- `TestNamedEntities` — Find specific entities (main method, gzip.c, deflate.c)
- `TestEdgeTraversals` — Verify edges are persisted and traversable (AST, CALL, CFG, REF)
- `TestIdBridge` — Verify ID translation strategy (hybrid mode regenerates global node IDs)
- `TestStoreLifecycle` — Verify store operations (get_node_by_id, get_nodes_batch, checkpoint)

**Preprocessing**: Joern exports 3 files per type (`*_header.csv`, `*_data.csv`, `*_cypher.csv`). The `find_csv_files()` function in `csv_parser.py` auto-detects this split format and merges header + data into temp files transparently. No manual preprocessing needed.

## Known Constraints & Gotchas

1. **`0` vs empty in CSV** — `csv_parser.py:162` treats raw value `"0"` as valid data (not empty). The check `if not raw_val and raw_val != "0"` preserves `0` for `LINE_NUMBER`, `ORDER`, etc. Without this, nodes at line 0 or order 0 would lose those properties.

2. **`-1` as missing sentinel** — `id_bridge._regenerate_id` uses `-1` as the default for missing positional values (`line`, `col`, `order`, `argIdx`, `offsetStart`, `offsetEnd`). This matches the native `auto_generate_id` behavior where `None` fields become `-1` in the hash.

3. **`add_edge(**kwargs)` unpacking** — `importer.py:298` passes edge properties via `**edge_kwargs` to `graph.add_edge(src, dst, type=mapped_type, **edge_kwargs)`. The `created_by` field is injected here as `"joern_import"`. This relies on `CPGGraph.add_edge` accepting arbitrary keyword arguments.

4. **GenericNode fallback** — When `node_class(**kwargs)` fails (e.g., missing required field), `importer._create_node` catches the exception and retries with `GenericNode(id=cpg_id, label=joern_label, **joern_props)` using the *original* unmapped properties. If `skip_unknown_labels=True`, this fallback is skipped entirely.

5. **`inheritsFromTypeFullName` semicolon split** — Joern stores this as a semicolon-separated string (e.g., `"int;float"`). The mapper converts it to `["int", "float"]` in `_handle_special_fields`. This property is also in `SKIP_PROPERTIES` to prevent double-processing by the generic property mapper.

6. **Edge ID lookup failure** — If `translate_edge_id` returns `None` (Joern edge references a node ID not in the `_id_map`), the edge is silently dropped and counted in `stats.edges_missing_endpoint`. This can happen if node CSV files are incomplete.

7. **No `__init__.py`** — This package uses implicit namespace packages, consistent with the rest of cpg_schema.

8. **Single-format limitation** — Only `neo4jcsv` export format is supported (`export_format` field exists but is fixed to `"neo4jcsv"`). Joern's other export formats (graphml, dot, etc.) are not handled.
