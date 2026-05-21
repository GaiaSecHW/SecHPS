# CodeDMap

Code Property Graph SDK for LLM/Agent-driven code auditing and vulnerability hunting.

## Tech Stack

- Python 3.12+ (target 3.14), Pydantic V2, tree-sitter, libclang, Neo4j, SQLite, instructor/litellm
- No `__init__.py` in some packages (implicit namespace packages). Tests use `sys.path.append(os.getcwd())`.

## Project Layout

```
codedmap/
  core/           # Schema definitions, graph container, builder (see core/CLAUDE.md)
  frontend/       # Parsers: tree-sitter (C/C++/Python) + libclang JSON IR
  analysis/       # Passes (stream per-file, then batch global), traversal, algorithms
  infra/          # Storage backends (memory/neo4j/sqlite), AI services (litellm)
  features/       # RAG retrieval-augmented generation
  pipeline/       # Orchestrator, frontend runner, state machine
  utils/          # ID generator, source manager, visualizer
tools/            # ast_exporter.py (libclang artifact exporter)
tests/            # 62 test files mirroring src structure
```

## Architecture: Two-Phase Pipeline

1. **Frontend (Stream)**: Parse files one-by-one -> emit nodes/edges -> stream passes run per-file (CFG, DDG, CDG, local ref, local points-to, macro normalization)
2. **Backend (Batch)**: Global passes run after all files parsed (linker, call graph, PDG, global ref, global points-to)
3. **AI Passes** (optional): LLM-powered summary, type inference, security tagging

## CLI Commands

The `codedmap.cli` module provides 9 domain-grouped CLI commands for building, querying, and annotating CPG databases:

- `cdm query` — Graph traversal: search, inspect, trace, entrypoints, stats, tree, sources, sinks, guards, sanitizers, roles
- `cdm note` — Note/insight CRUD (add/list/show/remove)
- `cdm tag` — Security tagging (add/remove/list/find/bulk)
- `cdm rules` — Rule registry management (list/add/tombstone/validate)
- `cdm module` — Module CRUD operations (create/delete/rename/list/show/assign/remove)
- `cdm repair` — Call-chain repair (link/suggest/list/undo)
- `cdm build` — Build CPG graph from source code (or `cdm build enhance` for existing DB)
- `cdm serve` — Start REST API server
- `cdm assets` — Asset migration (export/import/diff/anchor/merge)

See `codedmap/cli/CLAUDE.md` for full CLI documentation.

## Build/Analysis Separation (IR Mode)

1. Build environment: compile project, run `tools/ast_exporter.py` to export AST artifacts as gzip JSON
2. Analysis environment: run codedmap with `parser.import_path` pointing to artifacts directory

## Storage Backends

All backends implement the same streaming reader/writer interface:
- `memory`: In-memory CPGGraph (testing/prototyping)
- `sqlite`: Local file-based (intermediate storage)
- `neo4j`: Production graph DB (direct or bulk CSV import)

## Running Commands

**Always use `python3`, never `python`.** The system `python` may point to Python 2.7.

```bash
python3 -m pytest tests/ -v            # run tests
python3 -m codedmap.cli ...            # run CLI
python3 -m tools.cdm_client ...        # run CDM client
```

## Key Conventions

- Node IDs: Deterministic (SHA-256 hash) for global nodes (METHOD, TYPE_DECL, FILE); offset-based deterministic for AST nodes; Snowflake for orphan nodes
- Pydantic V2: Use `model_config = ConfigDict(...)`, not `class Config`
- Field aliases: camelCase aliases for Joern compatibility (e.g., `fullName`, `typeFullName`, `lineNumber`)
- Edges: Factory methods on `CPGEdge` (e.g., `CPGEdge.ast()`, `CPGEdge.ddg()`)
- Graph mutations go through `GraphPatch` for transactional batch writes to storage

## Agent Rules
  - When adding new node types, edge types, or changing ID generation logic in core/, update core/CLAUDE.md accordingly.
  - When modifying tag-related code (tag models, engine, navigator, matcher, registry) or tag rules (rules/ YAML files, ontology categories), update `docs/TAG_SYSTEM.md` accordingly.

## Coding Rules

### Respect Module Abstraction (High Cohesion, Low Coupling)
Never leak implementation details across module boundaries. Specifically:
- **No raw SQL outside storage drivers.** Application code (analysis/, app/, cli/) must use Repository methods, GraphReader/GraphWriter interfaces, or TraversalInterface DSL — never construct SQL strings directly. If a query pattern is missing, add a method to the appropriate Repository or Reader, not inline SQL at the call site.
- **No raw Cypher outside Neo4j driver.** Same principle — Cypher belongs in `driver_neo4j/` only.
- **No storage-specific logic in domain code.** Code in analysis/, app/, cli/ must work identically regardless of backend (memory/sqlite/neo4j). If you find yourself checking which backend is active, the abstraction is wrong.
- **Add missing abstractions, don't bypass existing ones.** When the current interface doesn't support what you need, extend the interface (Repository method, Reader method, Traversal operator) rather than reaching through to the implementation.
- **GraphPatch for all mutations.** All graph writes from passes and application code go through `GraphPatch` → `apply_patch()`. Never mutate storage directly.

## Refactoring Rules

### No Shim Directories
When moving modules to new locations, rewrite ALL import sites in the same commit. Do NOT create backward-compatibility re-export shim files or directories. Shim directories create phantom structure that misleads navigation and accumulates as tech debt. If a move has too many import sites to rewrite atomically, use a two-commit approach: (1) rewrite all imports, (2) move the file — never leave a re-export wrapper behind.

### No Backward Compatibility During Development
The project is in active development. When refactoring CLI flags, command paths, or APIs:
- Remove old interfaces immediately — do not keep deprecated aliases, compat shims, or legacy flags
- Update all call sites (code + tests) in the same commit
- Keep the codebase unified with a single way to do each thing
Backward compatibility is only needed after a stable public release. Until then, clean breaks prevent debt accumulation.
