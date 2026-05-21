# cpg_schema/pipeline — Pipeline Orchestration Layer

Top-level orchestration of the CPG SDK's three-phase pipeline: Ingestion (Frontend) -> Analysis (Batch Passes) -> Export (Neo4j CSV). This layer owns the execution lifecycle, process-pool management, and smart file dispatch.

> **Note (Phase 20.6):** Task execution infrastructure (runner, messages, state) has been moved to `infra/executor/`. See `infra/executor/CLAUDE.md` for details.

## Module Map

```
pipeline/
  orchestrator.py          # PipelineOrchestrator — top-level entry point, 3-phase pipeline
  frontend.py              # FrontendPipeline — multi-process file parsing + stream passes
  artifact_locator.py      # ArtifactLocator — locate pre-exported Clang AST JSON artifacts
  dispatch/
    core.py                # SmartParseDispatcher — 2-stage decision pipeline (Rules + AI)
    rules.py               # RuleEngine — L1 path regex + L2 keyword matching
    critic.py              # SecurityCritic — L3 LLM-based file risk assessment
```

### Moved to `infra/executor/` (Phase 20.6)

```
infra/executor/
  runner.py              # BaseRunner, SequentialRunner, ThreadPoolRunner, ProcessPoolRunner
  state.py               # PipelineStateManager — JSON-based checkpoint/resume
  messages/
    base.py              # BaseTask, TaskResult — IPC dataclasses
    parser.py            # ParserTask — batch file parsing task
    analysis.py          # AnalysisTask, AIAnalysisResult, BatchAnalysisResult — AI/batch IPC
```

## Architecture: Three-Phase Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PipelineOrchestrator                              │
│                                                                     │
│  Phase 1: Ingestion          Phase 2: Analysis       Phase 3: Export│
│  ┌───────────────────┐      ┌──────────────────┐    ┌─────────────┐│
│  │ FrontendPipeline   │ ──→ │ PassManager       │ →  │ Snapshot    ││
│  │ (ProcessPool)      │     │ (DAG BatchPasses) │    │ (CSV Export)││
│  │                    │     │                   │    │             ││
│  │ scan files         │     │ Linker            │    │ SQLite →    ││
│  │ → dispatch         │     │ CallGraph         │    │ Neo4j CSV   ││
│  │ → parse (workers)  │     │ GlobalPointsTo    │    │ + import    ││
│  │ → stream passes    │     │ PDG               │    │   script    ││
│  │ → write to store   │     │ AI Passes...      │    │             ││
│  └───────────────────┘      └──────────────────┘    └─────────────┘│
│                                                                     │
│  Each phase is independently skippable via PipelineConfig or        │
│  run_full_pipeline() parameters.                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## PipelineOrchestrator (orchestrator.py)

### Role

Application entry point. Assembles Config -> Store -> Runner -> PassManager and orchestrates all three phases.

### Constructor

```python
PipelineOrchestrator(config_path: str = None, config: CPGConfig = None)
```

If neither is provided, uses default `CPGConfig()`.

### Public Methods

| Method | Purpose |
|---|---|
| `run_full_pipeline(skip_ingestion, force_rerun, skip_analysis, skip_export)` | Run 3-phase pipeline with configurable phase gating |
| `run_enhance(target_classes, force_rerun)` | Run a subset of analysis passes on existing graph (no ingestion). For enhancing Joern-imported DBs. |
| `run_ai_enhancement(force_rerun)` | Run only AI semantic passes (requires base graph) |
| `shutdown()` | Close store and release resources |

### Phase Gating (Configurable Skip)

`run_full_pipeline` parameters accept `None` (default), `True`, or `False`. Resolution priority: **method parameter > PipelineConfig > default (False)**.

```python
# Parameter resolution logic:
_skip_ingestion = skip_ingestion if skip_ingestion is not None else self.config.pipeline.skip_ingestion
_skip_analysis  = skip_analysis  if skip_analysis is not None  else self.config.pipeline.skip_analysis
_skip_export    = skip_export    if skip_export is not None    else self.config.pipeline.skip_export
```

Use cases:
- `skip_analysis=True`: Importing from Joern/CodeQL (Call Graph/DDG already provided)
- `skip_ingestion=True`: Re-running analysis on pre-populated graph
- `skip_export=True`: Skip Neo4j CSV export even in bulk mode

### Private Methods

| Method | Phase | Purpose |
|---|---|---|
| `_run_ingestion_phase()` | 1 | Create FrontendPipeline, run, WAL checkpoint |
| `_run_analysis_phase(force_rerun)` | 2 | Init PassManager, register passes, run_all, WAL checkpoint |
| `_run_export_phase()` | 3 | SQLite -> Neo4j CSV snapshot + import script generation |
| `_init_runner()` | Setup | Create Runner (Process/Thread/Sequential) based on config |
| `_setup_intermediate_storage()` | Setup | If bulk mode: override backend to SQLite; create CPGStore |
| `_force_checkpoint(stage_name)` | Infra | Force SQLite WAL TRUNCATE checkpoint between phases |
| `_check_base_graph_readiness()` | Guard | Query store for METHOD nodes; used by `run_ai_enhancement` |
| `_register_analysis_passes()` | Setup | Register all Batch + AI passes with DAG dependencies |

### Pass Registration DAG

```
Group 1: Base Topology
  LinkerPass []                    ← no deps (foundation)
  CallGraphPass []                 ← no deps (parallel with Linker)
  GlobalPointsToPass [Linker, CG]  ← needs REF + CALL edges

Group 2: AI Enhancement (if enable_llm)
  SemanticEmbedding [CG]           ← "SemanticEmbedding_Method_Typedecl"
  SmartGraphResolver [CG, Embed?]  ← dynamic deps
  SmartSummaryPass [CG]

Group 3: Deep Analysis
  PDGPass [PointsTo, Linker, CG, + AI deps]  ← convergence point

Group 4: Security & Aggregation (if enable_llm)
  SecurityTaggingPass [PDG]
  SemanticEmbedding_File [Embed_Method]
  SmartModuleSummaryPass [Embed_File]
```

### Bulk Mode Flow

When `config.storage.use_bulk_import=True`:

```
1. _setup_intermediate_storage() overrides backend → SQLite (work_dir/interim_graph.db)
2. Frontend writes via BulkWriter (CSV → bulk_buffer/) per worker
3. After all workers finish → store.import_bulk_data(bulk_buffer/)
4. Analysis runs against SQLite
5. _run_export_phase() → store.snapshot() → CSV files + neo4j-admin import script
```

## FrontendPipeline (frontend.py)

### Role

Multi-process file scanner, parser, and stream-pass executor. This is Phase 1 of the pipeline.

### Architecture

```
Main Process                              Worker Processes (N=config.parser.n_workers)
─────────────                             ──────────────────────────────────────────
FrontendPipeline.run()                    _init_frontend_worker(config_dict)
  │                                         → CPGConfig(**config_dict)
  ├── _scan_files()                         → CPGStore (non-bulk) or None (bulk)
  │     os.walk + extension filter
  │     + skip_dirs + exclude_patterns    _parser_task_handler(ParserTask)
  │                                         → _execute_batch_task()
  ├── SmartParseDispatcher.decide()             for file in batch:
  │     → ParseStrategy per file                  _core_parse_file_to_graph()
  │                                                 ├── Hybrid C: ClangJSON + TreeSitter
  ├── Batch tasks (10 files/batch)                  ├── TreeSitter: C/Cpp/Python
  │     → ParserTask(file_paths, langs,             ├── Stream Passes (per-file):
  │        strategies, config_dict)                 │   LocalRef → MacroNorm → CFG
  │                                                 │   → DDG → CDG → LocalPointsTo
  └── ProcessPoolRunner.execute()                   └── return CPGGraph
        → imap_unordered                    Write Strategy:
                                              Bulk → BulkWriter.write_nodes/edges_stream
                                              Normal → _worker_store.save(graph)
```

### Key Functions (Module-Level, Picklable)

| Function | Context | Purpose |
|---|---|---|
| `_init_frontend_worker(config_dict)` | Worker init | Create global `_worker_store`, `_worker_config` |
| `_parser_task_handler(task)` | Worker | Adapter: ParserTask -> TaskResult |
| `_core_parse_file_to_graph(file, lang, strategy, config)` | Worker | Parse single file + run stream passes -> CPGGraph |
| `_execute_batch_task(files, langs, strategies, config, task_id)` | Worker | Loop files, parse, write to store/bulk |
| `_process_hybrid_c_parsing(builder, file, config, locator)` | Worker | ClangJSON IR + TreeSitter comments |

### Hybrid Parsing (C/C++)

Priority: Clang IR artifact (if compiled) > TreeSitter fallback.

```
if compiled (artifact exists):
  ClangJSONParser → IR-based AST (precise types, USR)
  + CParser.parse_comments_only() → Comment nodes
else:
  CParser/CppParser → TreeSitter AST (heuristic types, no macro recovery)
```

### FrontendPipeline Class

| Method | Purpose |
|---|---|
| `run()` | Main entry: scan -> parse -> bulk import -> metadata |
| `_run_streaming_parsing()` | ProcessPool execution loop |
| `_scan_files()` | Generator: os.walk with extension/dir/pattern filters |
| `_detect_language(path)` | Extension -> Language enum |
| `_add_metadata()` | Write META_DATA node (language, root_path, version) |
| `_process_runner_result(result)` | Accumulate stats from TaskResult |

### Stats Tracking

```python
self.stats = {
    "files_scanned", "files_parsed", "files_ignored",
    "files_skeleton", "files_full", "nodes_written", "duration"
}
```

## Executor (executor/runner.py)

### Runner Strategy Pattern

```python
BaseRunner (ABC)
  ├── SequentialRunner      # Debug: single-thread, calls initializer once
  ├── ThreadPoolRunner      # IO-bound: ThreadPoolExecutor + as_completed
  └── ProcessPoolRunner     # CPU-bound: multiprocessing.Pool + imap_unordered
```

### Interface

```python
def execute(self,
            tasks: Iterable[BaseTask],
            handler_func: Callable[[BaseTask], TaskResult],
            initializer: Optional[Callable] = None,
            initargs: Tuple = (),
            chunksize: int = 1) -> Iterator[TaskResult]
```

### ProcessPoolRunner Details

- Uses `multiprocessing.Pool` (not `ProcessPoolExecutor`)
- `maxtasksperchild` parameter to prevent memory leaks (default=20 for Frontend, 10 for Analysis)
- `imap_unordered` for streaming results back to main process
- `initializer` called once per worker process (for DB connections, config setup)

### Runner Selection

| Context | Runner | Config Key |
|---|---|---|
| Frontend parsing | Always `ProcessPoolRunner` | `config.parser.n_workers` |
| Analysis (Batch passes) | Config-driven | `config.analysis.runner_type` ("process"/"thread"/"sequential") |
| AI passes | Always `ThreadPoolRunner` internally | `config.ai.max_workers` |

## Smart Dispatch (dispatch/)

### Three-Level Decision Pipeline

```
File Path
  │
  ▼
┌──────────────────────────────────┐
│  L1: Path Rules (RuleEngine)     │  O(1) regex
│  ├── ignore_paths → IGNORE       │
│  └── critical_paths → FULL       │
├──────────────────────────────────┤
│  L2: Keyword Rules (RuleEngine)  │  O(K) binary search in 4KB head
│  └── sensitive_keywords → FULL   │
├──────────────────────────────────┤
│  L3: AI Critic (SecurityCritic)  │  LLM call (if enabled)
│  └── SecurityAssessment → FULL/  │
│      SKELETON/IGNORE             │
├──────────────────────────────────┤
│  Fallback → FULL                 │
└──────────────────────────────────┘
```

### SmartParseDispatcher (core.py)

Facade with a `List[DecisionStage]` pipeline. Each stage returns `Optional[ParseStrategy]`; first non-None wins.

### DecisionContext (core.py)

Lazy-loading context object per file:
- `head_content` — first 4KB (bytes), cached
- `extract_lightweight_features()` — regex-extracted includes + function signatures, cached

### RuleEngine (rules.py)

Consumes `DispatchConfig`:
- `critical_paths: List[Pattern]` — compiled regex, match → FULL
- `ignore_paths: List[Pattern]` — compiled regex, match → IGNORE
- `sensitive_keywords: List[bytes]` — binary substring match in file head → FULL

### SecurityCritic (critic.py)

LLM-based file risk assessment:
- Uses `BaseAgent.predict()` with `SecurityAssessment` (Pydantic) response model
- Input: file_path, includes[:15], signatures[:30]
- Output: `SecurityAssessment(chain_of_thought, risk_level, strategy, confidence)`
- Fail-safe: any error → FULL (never miss a risky file)

## State Management (state.py)

### PipelineStateManager

JSON-file-based pass execution state for checkpoint/resume.

```python
state_file = project_root / ".cpg_build_state.json"
```

| Method | Purpose |
|---|---|
| `mark_start(pass_name)` | Set status=RUNNING, record start_time |
| `mark_completed(pass_name)` | Set status=COMPLETED, record duration |
| `mark_failed(pass_name, error)` | Set status=FAILED, record error |
| `is_completed(pass_name)` | Check if pass already completed (for skip) |
| `clear()` | Delete state file (force_rerun) |

### PassState

```python
@dataclass
class PassState:
    name: str
    status: str  # "PENDING", "RUNNING", "COMPLETED", "FAILED"
    start_time: float
    end_time: float
    duration: float
    error: Optional[str]
```

## ArtifactLocator (artifact_locator.py)

### Role

Locate pre-exported Clang AST JSON artifacts (from `tools/ast_exporter.py`) for hybrid parsing.

### Singleton Pattern

`__new__` ensures single instance. Initialized once with `package_root` and `project_root`.

### Lookup Algorithm

```
1. Load compile_commands.json → build two indexes:
   - _compile_db_abs_map: abs_path → entry (fast exact match)
   - _compile_db_name_map: filename → List[entry] (fuzzy fallback)

2. find_artifact(source_file):
   a. Find compile entry (exact → single-name → suffix match)
   b. Calculate MD5 hash: "{file}|{directory}|{command}"[:12]
   c. Determine sub_dir:
      - Relative to build_dir → "_generated/..."
      - Relative to project_root → direct relative path
      - Else → "_external"
   d. Return: artifact_root / sub_dir / "{filename}_{hash}.json.gz"
```

### Cache

`@lru_cache(maxsize=5000)` on `find_artifact()`. Call `clear_cache()` to reset.

### Critical Alignment

Hash calculation and path normalization **must match** `tools/ast_exporter.py` exactly, or artifacts won't be found.

## Messages (messages/)

### IPC Dataclasses

All task/result types are plain `@dataclass` for pickle-safe IPC across process boundaries.

| Class | Direction | Usage |
|---|---|---|
| `BaseTask` | Main → Worker | Base with task_id, created_at, meta |
| `TaskResult` | Worker → Main | Base with status (SUCCESS/FAILED/RETRY), payload, error |
| `ParserTask(BaseTask)` | Main → Worker | Batch of file_paths + languages + strategies + config_dict |
| `AnalysisTask(BaseTask)` | Main → Worker | AI pass context: node_id, prompt_inputs, agent_config |
| `AIAnalysisResult(TaskResult)` | Worker → Main | model_response, target_node_id, prompt_hash, token_usage |
| `BatchAnalysisResult(TaskResult)` | Worker → Main | new_edges (tuples), node_updates (tuples), metrics |

### Design Principle

Workers return **raw semantic data** (edge tuples, property updates), not `GraphPatch` objects. The main process (Coordinator) is responsible for constructing and applying patches, because it has access to the graph store context.

## Data Flow: Full Pipeline Execution

```
CPGConfig
  │
  ▼
PipelineOrchestrator.__init__()
  │
  ├── _init_runner() → ProcessPoolRunner / ThreadPoolRunner / Sequential
  ├── _setup_intermediate_storage() → CPGStore (SQLite if bulk, else configured backend)
  │
  ├── Phase 1: _run_ingestion_phase()
  │     FrontendPipeline(config, store)
  │       ├── _scan_files() → file generator
  │       ├── SmartParseDispatcher.decide() → strategy per file
  │       ├── ProcessPoolRunner → N workers
  │       │     _core_parse_file_to_graph()
  │       │       ├── Parser (ClangJSON / TreeSitter)
  │       │       └── Stream Passes (CFG, DDG, CDG, Ref, PointsTo, MacroNorm)
  │       └── Write to Store (direct or bulk CSV)
  │     _force_checkpoint("Ingestion")
  │
  ├── Phase 2: _run_analysis_phase()
  │     PassManager.run_all()
  │       DAG Topo Sort → [Linker, CallGraph] → PointsTo → PDG → AI Passes...
  │       Each: prune() → run() → cleanup()
  │     _force_checkpoint("Global Analysis")
  │
  └── Phase 3: _run_export_phase() (bulk mode only)
        store.snapshot(csv_dir)
        ImportScriptGenerator.generate()
```

## Application-Level Entry Point (app/build.py)

`CPGBuildEngine` in `app/build.py` wraps `PipelineOrchestrator` with a simplified interface for CLI and scripts:

```python
from cpg_schema.app.build import CPGBuildEngine

# Simple usage
engine = CPGBuildEngine(project_root="/path/to/code", db="/path/to/graph.db")
engine.build()                          # Full pipeline
engine.build(skip_ingestion=True)       # Re-run analysis only
engine.enhance(["linker", "pointsto"]) # Run specific passes on existing graph
engine.ai_enhance()                     # AI passes only

# With YAML config
engine = CPGBuildEngine(project_root="/path/to/code", config_path="config.yaml")
engine.build()
```

The CLI `cpg build` command delegates to `CPGBuildEngine`. Direct `PipelineOrchestrator` usage is still supported for advanced scenarios.

## Configuration Dependencies

| Config Section | Used By | Key Fields |
|---|---|---|
| `PipelineConfig` | Orchestrator | `skip_ingestion`, `skip_analysis`, `skip_export`, `frontend_batch_size` |
| `StorageConfig` | Orchestrator, Frontend | `backend`, `use_bulk_import`, `work_dir`, `csv_output_dir` |
| `ParserConfig` | Frontend | `languages`, `n_workers`, `import_path`, `skip_dirs`, `exclude_patterns`, `skip_uncompiled` |
| `AnalysisConfig` | Orchestrator | `runner_type`, `max_workers` |
| `AIConfig` | Orchestrator, Dispatch | `enable_llm`, `enable_smart_dispatcher`, feature flags |
| `DispatchConfig` | SmartParseDispatcher | `critical_paths`, `ignore_paths`, `sensitive_keywords` |

## Known Issues & Tech Debt

1. **`_worker_store` global state** — Module-level globals (`_worker_store`, `_worker_config`) in `frontend.py` are required for `multiprocessing.Pool` but make testing difficult. No cleanup on worker exit.
2. **ArtifactLocator is a Singleton** — `__new__` pattern prevents re-initialization with different paths in the same process. Call `clear_cache()` doesn't reset state, only LRU cache.
3. **Bulk mode `use_bulk` commented-out overrides** — Multiple `#use_bulk = False` debug lines left in `frontend.py`.
4. **`FrontendPipeline._process_runner_result` counts batches as files** — `stats["files_parsed"]` increments once per batch result, not per file.
5. **ProcessPoolRunner doesn't use `concurrent.futures`** — Uses raw `multiprocessing.Pool` which has different error propagation semantics.
6. ~~**`PipelineOrchestrator.__init__` calls `CPGConfig.load()` which doesn't exist**~~ — **Fixed.** Now calls `load_from_yaml()`.
7. **`_force_checkpoint` pierces the Store facade** — Uses `getattr` to reach through `CPGStore._engine.db.checkpoint()`, fragile coupling.
8. **No graceful shutdown for ProcessPool** — If main process crashes during Phase 1, worker processes may orphan.
9. **BATCH_SIZE=10 is hardcoded** in `_run_streaming_parsing()` — Not configurable.
10. **`_register_analysis_passes` lives in Orchestrator** — Tightly couples pass registration to the orchestrator; could be extracted to a registry module.

## Agent Rules

1. **Worker functions must be module-level (top-level)** — `multiprocessing.Pool` requires picklable callables. Never define worker handlers as methods or closures.
2. **Config serialization for IPC** — `config.model_dump()` is used to pass config across process boundaries. Any new config field must be serializable (no lambdas, no file handles).
3. **Phase gating resolution** — When modifying `run_full_pipeline`, maintain the parameter-overrides-config pattern: `param if param is not None else config.pipeline.skip_*`.
4. **Stream passes run in worker memory** — Never add DB access to stream passes. They only see the per-file CPGGraph.
5. **Dispatch fail-safe** — All dispatch stages must fail-safe to FULL (never silently drop files). Errors in L3 (AI) should not block L1/L2 results.
6. **Artifact hash alignment** — Any change to `tools/ast_exporter.py` hash calculation must be mirrored in `ArtifactLocator._calculate_hash()`.
7. **Bulk mode directory lifecycle** — `bulk_buffer/` is created by main process before workers start, and cleaned up after `import_bulk_data()`. Workers create per-process files inside it.
8. **Adding new pipeline phases** — Add a `skip_*` field to `PipelineConfig`, a `_run_*_phase()` method, and gating logic in `run_full_pipeline()`.
