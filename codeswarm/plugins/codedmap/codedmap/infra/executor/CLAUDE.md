# cpg_schema/infra/executor — Task Execution Framework

Execution infrastructure for the CPG pipeline: runner strategies, IPC message types, and pipeline state management. Moved here from `pipeline/` in Phase 20.6 to fix `analysis/ → pipeline/` layer violations.

## Module Map

```
executor/
  __init__.py              # Package init
  runner.py                # BaseRunner, SequentialRunner, ThreadPoolRunner, ProcessPoolRunner
  state.py                 # PipelineStateManager, PassState — JSON checkpoint/resume
  messages/
    __init__.py            # Re-exports all message types
    base.py                # BaseTask, TaskResult — IPC base dataclasses
    analysis.py            # AnalysisTask, AIAnalysisResult, BatchAnalysisResult, EdgeTuple, UpdateTuple
    parser.py              # ParserTask — batch file parsing task
```

## Runner Strategy Pattern

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

## Messages — IPC Dataclasses

All task/result types are plain `@dataclass` for pickle-safe IPC across process boundaries.

| Class | Direction | Usage |
|---|---|---|
| `BaseTask` | Main → Worker | Base with task_id, created_at, meta |
| `TaskResult` | Worker → Main | Base with status (SUCCESS/FAILED/RETRY), payload, error |
| `ParserTask(BaseTask)` | Main → Worker | Batch of file_paths + languages + strategies + config_dict |
| `AnalysisTask(BaseTask)` | Main → Worker | AI pass context: node_id, prompt_inputs, agent_config |
| `AIAnalysisResult(TaskResult)` | Worker → Main | model_response, target_node_id, prompt_hash, token_usage |
| `BatchAnalysisResult(TaskResult)` | Worker → Main | new_edges (tuples), node_updates (tuples), metrics |

## State Management

`PipelineStateManager` — JSON-file-based pass execution state for checkpoint/resume.

```python
state_file = project_root / ".cpg_build_state.json"
```

| Method | Purpose |
|---|---|
| `mark_start(pass_name)` | Set status=RUNNING |
| `mark_completed(pass_name)` | Set status=COMPLETED |
| `mark_failed(pass_name, error)` | Set status=FAILED |
| `is_completed(pass_name)` | Check if pass done (for skip) |
| `clear()` | Delete state file (force_rerun) |

## Agent Rules

1. **Worker functions must be module-level** — `multiprocessing.Pool` requires picklable callables
2. **Config serialization for IPC** — `config.model_dump()` passes config across process boundaries
3. **All message types must be `@dataclass`** — for pickle-safe IPC
