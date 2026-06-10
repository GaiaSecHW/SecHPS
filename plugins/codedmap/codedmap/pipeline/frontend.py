# codedmap/pipeline/frontend.py

import os
import sys
import json
import logging
import time
import gc
import uuid
import shutil
from dataclasses import dataclass, field
from pathlib import Path
import fnmatch
from typing import Generator, List, Optional, Union, Dict, Any

# [Architecture] Configs & Schema
from codedmap.core.configs.parser import ParserConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.configs.ai import AIConfig
from codedmap.core.configs.pipeline import PipelineConfig
from codedmap.core.configs.dispatch import DispatchConfig
from codedmap.core.schema.graph import CPGGraph
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import Language, ParseStrategy


@dataclass
class FrontendConfig:
    """Composite config for FrontendPipeline — assembled by the Orchestrator."""
    parser: ParserConfig
    storage: StorageConfig
    ai: AIConfig
    pipeline: PipelineConfig
    dispatch: DispatchConfig
    project_root: Path
    project_name: Optional[str] = None
    workspace: Optional[Path] = None
    _full_config_dict: Optional[dict] = field(default=None, repr=False)


# [Architecture] Infrastructure
from codedmap.analysis.passes.manager import PassManager
from codedmap.infra.storage.store import CPGStore
from codedmap.utils.source_manager import source_manager

# [Architecture] Execution & Dispatch
from codedmap.infra.executor.runner import ProcessPoolRunner
from codedmap.infra.executor.messages.base import TaskResult
from codedmap.infra.executor.messages.parser import ParserTask
from .dispatch.core import SmartParseDispatcher
from .artifact_locator import ArtifactLocator

# Parsers
from codedmap.frontend.parsers.source_code.c_parser import CParser
from codedmap.frontend.parsers.source_code.cpp_parser import CppParser
from codedmap.frontend.parsers.source_code.python_parser import PythonCodeParser
from codedmap.frontend.parsers.ir.clang_json_parser import ClangJSONParser

# Stream Passes
from codedmap.analysis.passes.stream.cfg import CFGPass
from codedmap.analysis.passes.stream.ddg import DataFlowPass
from codedmap.analysis.passes.stream.cdg import CDGPass
from codedmap.analysis.passes.stream.local_ref import LocalRefPass
from codedmap.analysis.passes.stream.local_points_to import LocalPointsToPass
from codedmap.analysis.passes.stream.macro_normalization import MacroNormalizationPass
from codedmap.core.ast_validator import GraphValidator

logger = logging.getLogger(__name__)

# =============================================================================
# 1. Worker Logic (Run inside subprocess)
# =============================================================================


class _WorkerContext:
    """
    Per-process worker state container.

    Encapsulates the module-level globals required by multiprocessing.Pool.
    Workers access state via _worker_ctx instead of bare globals.
    """
    __slots__ = ('store', 'config_dict', 'storage_config', 'workspace')

    def __init__(self):
        self.store: Optional[CPGStore] = None
        self.config_dict: Optional[Dict[str, Any]] = None
        self.storage_config: Optional[StorageConfig] = None
        self.workspace: Optional[Path] = None

    def initialize(self, config_dict: Dict[str, Any]):
        """Called once per worker process during Pool initialization."""
        self.config_dict = config_dict
        self.storage_config = StorageConfig(**config_dict.get("storage", {}))
        workspace_str = config_dict.get("workspace")
        self.workspace = Path(workspace_str) if workspace_str else Path("./workspace")
        use_bulk = self.storage_config.use_bulk_import
        if not use_bulk:
            self.store = CPGStore(self.storage_config)
            self.store.init_db()

    def ensure_store(self, config_dict: Dict[str, Any] = None):
        """Ensure store is available (defensive fallback)."""
        if self.store is None and self.storage_config is not None:
            self.store = CPGStore(self.storage_config)
            self.store.init_db()
        elif self.store is None and config_dict:
            self.storage_config = StorageConfig(**config_dict.get("storage", {}))
            self.store = CPGStore(self.storage_config)
            self.store.init_db()


# Single per-process instance (required by multiprocessing.Pool)
_worker_ctx = _WorkerContext()

# Backward-compatible aliases for external references
_worker_store = None  # Use _worker_ctx.store instead
_worker_config = None  # Use _worker_ctx.config_dict instead


def _init_frontend_worker(config_dict: Dict[str, Any]):
    """
    Worker 初始化。
    """
    global _worker_store, _worker_config
    try:
        _worker_ctx.initialize(config_dict)
        # Keep backward-compatible globals in sync
        _worker_store = _worker_ctx.store
        _worker_config = _worker_ctx.config_dict
    except Exception as e:
        logger.error(f"Worker init failed: {e}")
        raise


def _parser_task_handler(task: 'ParserTask') -> 'TaskResult':
    """
    [Adapter Pattern]
    Worker 入口：接收 Batch 任务，执行批量处理。
    """
    try:
        # 调用 Batch 核心逻辑
        nodes_written_or_graph = _execute_batch_task(
            file_paths=task.file_paths,
            languages=task.languages,
            parse_strategies=task.parse_strategies,
            config_dict=task.config_dict,
            task_id=task.task_id
        )

        return TaskResult(
            task_id=task.task_id,
            status="SUCCESS",
            payload=nodes_written_or_graph
        )
    except Exception as e:
        import traceback
        return TaskResult(
            task_id=task.task_id,
            status="FAILED",
            error=str(e) + "\n" + traceback.format_exc()
        )


def _process_hybrid_c_parsing(
        builder: CPGBuilder,
        file_path: str,
        config_dict: dict,
        locator: ArtifactLocator
) -> bool:
    """Hybrid Parsing Logic (Same as before)"""
    artifact_path = locator.find_artifact(file_path)
    if not artifact_path:
        return False

    ast_json_obj = source_manager.load_artifact(artifact_path, parser=json.loads)
    if not ast_json_obj:
        return False

    if "_embedded_source" in ast_json_obj:
        embedded_code = ast_json_obj["_embedded_source"]
        virtual_path = ast_json_obj.get("location", {}).get("file")
        if virtual_path and embedded_code:
            source_manager.inject_virtual_file(virtual_path, embedded_code)

    try:
        ir_parser = ClangJSONParser(builder, project_root=config_dict["project_root"])
        ir_parser.run(file_path, ast_json_obj)

        ts_parser = CParser(builder, project_root=config_dict["project_root"])
        ts_parser.parse_comments_only(file_path)

        return True
    except Exception as e:
        logger.error(f"Error during hybrid parsing for {file_path}: {e}")
        return False


def _core_parse_file_to_graph(
        file_path: str,
        language: Language,
        parse_strategy: str,
        config_dict: dict
) -> Optional[CPGGraph]:
    """
    [Pure Logic] 解析单个文件并返回 Graph 对象。
    """
    # [DEBUG START] 计时开始：文件处理总耗时
    t_file_start = time.time()

    local_cpg_builder = None

    try:
        strategy_enum = ParseStrategy(parse_strategy)
        local_parser_config = ParserConfig(**config_dict.get("parser", {}))
        local_storage_config = StorageConfig(**config_dict.get("storage", {}))
        local_cpg_builder = CPGBuilder()

        # Set Global Context (Thread-local in worker)
        source_manager.set_project_root(config_dict["project_root"])
        package_root = Path(config_dict.get("package_root", config_dict["project_root"]))
        locator = ArtifactLocator(package_root=package_root, project_root=Path(config_dict["project_root"]))

        parse_success = False

        # [DEBUG START] 计时开始：纯 AST 解析阶段
        t_parser_start = time.time()

        # --- Parsing ---
        if language == Language.C or language == Language.CPP:
            artifact_path = locator.find_artifact(file_path)
            is_compiled = artifact_path is not None

            if local_parser_config.skip_uncompiled and not is_compiled:
                return None

            if is_compiled:
                if _process_hybrid_c_parsing(local_cpg_builder, file_path, config_dict, locator):
                    parse_success = True

            if not parse_success:
                parser = None
                if language == Language.C:
                    parser = CParser(local_cpg_builder, project_root=config_dict["project_root"])
                elif language == Language.CPP:
                    parser = CppParser(local_cpg_builder, project_root=config_dict["project_root"])
                if parser:
                    parser.parse_file(file_path, strategy=strategy_enum)
                    parse_success = True

        elif language == Language.PYTHON:
            parser = PythonCodeParser(local_cpg_builder, project_root=config_dict["project_root"])
            parser.parse_file(file_path, strategy=strategy_enum)
            parse_success = True

        # [DEBUG END] 纯 AST 解析阶段耗时
        t_parser_dur = time.time() - t_parser_start
        if t_parser_dur > 1.0:  # 超过1秒才打印，避免刷屏
            logger.debug(f"[PERF] Parser took {t_parser_dur:.3f}s for {os.path.basename(file_path)}")

        if not parse_success:
            return None

        # --- Stream Passes ---
        graph = local_cpg_builder.get_graph()
        if not graph or not graph.nodes:
            return None

        # [DEBUG START] 计时开始：分析 Pass 阶段
        t_passes_start = time.time()

        validator = GraphValidator(graph)
        cycles = validator.find_ast_cycles()
        if cycles:
            logger.warning(f"⚠️⚠️⚠️ Detected {len(cycles)} AST cycles. Attempting Auto-Healing...")
            print(cycles)

        pm = PassManager(local_storage_config, store=None)
        pm.register(LocalRefPass)
        pm.register(MacroNormalizationPass)
        pm.register(CFGPass)
        pm.register(DataFlowPass)
        pm.register(CDGPass)
        pm.register(LocalPointsToPass)

        graph = pm.run_stream(graph, strategy_enum)

        # [DEBUG END] 分析 Pass 阶段耗时
        t_passes_dur = time.time() - t_passes_start
        if t_passes_dur > 0.5:
            logger.debug(
                f"[PERF] Stream Passes took {t_passes_dur:.3f}s for {os.path.basename(file_path)} (Nodes: {len(graph.nodes)})")

        return graph

    except Exception as e:
        logger.error(f"[Parse Error] {file_path}: {e}")
        return None


def _execute_batch_task(
        file_paths: List[str], languages: List[str],
        parse_strategies: List[str], config_dict: dict, task_id: str
) -> int:
    """
    [Worker Batch Executor]
    """
    # [DEBUG START] 批次处理开始
    t_batch_start = time.time()

    total_nodes = 0

    # Use WorkerContext (ensure storage config is loaded)
    if _worker_ctx.storage_config is None:
        _worker_ctx.storage_config = StorageConfig(**config_dict.get("storage", {}))

    use_bulk = _worker_ctx.storage_config.use_bulk_import

    # [Context] 准备写入上下文
    bulk_writer_ctx = None

    if use_bulk:
        # 临时创建一个 Store 门面来获取 Engine 的 bulk writer
        # 注意：这里并没有建立 DB 连接，只是利用 Factory 逻辑
        temp_store = CPGStore(_worker_ctx.storage_config)

        # 目录已在主进程创建，直接使用
        buffer_dir = _worker_ctx.workspace / "bulk_buffer"

        bulk_writer_ctx = temp_store.create_bulk_writer(
            output_dir=str(buffer_dir),
            worker_id=f"{os.getpid()}_{task_id}"  # 唯一 ID 防止冲突
        )

    # 如果是非 Bulk 模式且 store 为空 (防御性)，临时初始化
    elif _worker_ctx.store is None:
        _worker_ctx.ensure_store(config_dict)

    try:
        # 如果是 Bulk 模式，进入 Context Manager
        if bulk_writer_ctx:
            writer = bulk_writer_ctx.__enter__()
        else:
            writer = None

        # --- Loop Files ---
        for i, file_path in enumerate(file_paths):
            # 1. 解析文件 (内含解析耗时日志)
            graph = _core_parse_file_to_graph(
                file_path, Language(languages[i]), parse_strategies[i], config_dict
            )

            if not graph or not graph.nodes: continue

            node_count = len(graph.nodes)
            total_nodes += node_count

            # --- Write Strategy ---
            # [DEBUG START] 计时开始：写入阶段 (最可疑的瓶颈)
            t_write_start = time.time()

            if use_bulk:
                # Stream to Disk (OOM Safe)
                writer.write_nodes_stream(graph.nodes.values())
                writer.write_edges_stream(graph.edges)
            else:
                # Write to DB (Memory Intensive for large graphs)
                _worker_ctx.store.save(graph)

            # [DEBUG END] 写入阶段耗时
            t_write_dur = time.time() - t_write_start

            # 如果写入时间超过 0.5 秒，或者节点数很少但写入很慢，就打印 Warning
            if t_write_dur > 0.5:
                logger.debug(
                    f"[PERF-SLOW-WRITE] Task {task_id}: Writing {file_path} ({node_count} nodes) took {t_write_dur:.3f}s")

            # Free memory explicitly
            del graph
            if i % 100 == 0: gc.collect()

        # 退出 Context Manager
        if bulk_writer_ctx:
            bulk_writer_ctx.__exit__(None, None, None)
            # 临时 Store 关闭
            temp_store.close()

        # [DEBUG END] 批次处理结束
        t_batch_total = time.time() - t_batch_start
        logger.debug(
            f"[PERF-BATCH] Task {task_id} completed. Processed {len(file_paths)} files ({total_nodes} nodes) in {t_batch_total:.2f}s")

        return total_nodes

    except Exception:
        # [Fix] 正确处理 Context Manager 异常退出
        if bulk_writer_ctx:
            bulk_writer_ctx.__exit__(*sys.exc_info())
        raise


# =============================================================================
# 2. Frontend Pipeline (Main Process)
# =============================================================================

class FrontendPipeline:
    def __init__(self, config: FrontendConfig, store: CPGStore):
        """
        """
        self.config = config
        self.store = store
        self.dispatcher = SmartParseDispatcher(config.dispatch, config.ai)

        if not self.config.project_root.exists():
            raise FileNotFoundError(f"Project root does not exist: {self.config.project_root}")

        self._valid_extensions = self._get_extensions(self.config.parser.languages)
        source_manager.set_project_root(str(self.config.project_root))

        self.stats = {
            "files_scanned": 0, "files_parsed": 0, "files_ignored": 0,
            "files_skeleton": 0, "files_full": 0, "nodes_written": 0,
            "duration": 0.0
        }

    def _get_extensions(self, languages: List[str]) -> set:
        exts = set()
        lang_map = {
            "c": {".c", ".h"}, "cpp": {".cpp", ".hpp", ".cc", ".cxx", ".hxx"}, "python": {".py", ".pyw"}
        }
        for lang in languages:
            if lang in lang_map: exts.update(lang_map[lang])
        return exts

    def run(self):
        """执行流式解析与入库"""
        start_time = time.time()
        logger.info(f"Starting Frontend Ingestion for {self.config.project_root}")
        logger.info(f"Backend: {self.config.storage.backend.upper()}")

        use_bulk = self.config.storage.use_bulk_import
        #use_bulk = False

        # [Safety Optimization] 主进程预先创建 Buffer 目录，防止 Worker 竞争
        if use_bulk:
            buffer_dir = self.config.workspace / "bulk_buffer"
            if buffer_dir.exists():
                logger.warning(f"Cleaning existing bulk buffer: {buffer_dir}")
                try:
                    shutil.rmtree(buffer_dir)
                    pass
                except Exception as e:
                    logger.warning(f"Failed to clean buffer dir: {e}")
            buffer_dir.mkdir(parents=True, exist_ok=True)

        ## 1. 运行流式解析 (多进程)
        # Workers 会将数据写入 DB (普通模式) 或 CSV (Bulk 模式)
        self._run_streaming_parsing()

        # 2. 处理 Bulk Import
        if use_bulk:
            buffer_dir = self.config.workspace / "bulk_buffer"
            if buffer_dir.exists():
                logger.info(f"Bulk buffering complete. Importing from {buffer_dir}...")
                # 调用 Store 的导入接口 (SQLite 会自动执行，Neo4j 会提示)
                try:
                    self.store.import_bulk_data(str(buffer_dir))

                    # 只有导入成功才清理
                    shutil.rmtree(buffer_dir)
                    logger.info(f"Cleaned up temporary buffer: {buffer_dir}")

                except Exception as e:
                    logger.error(f"Bulk Import Failed: {e}")
                    raise
            else:
                logger.warning("Bulk mode enabled but no buffer data generated.")

        # 3. 写入元数据 (Project Metadata)
        self._add_metadata()

        duration = time.time() - start_time
        logger.info(f"Ingestion completed in {duration:.2f}s.")
        return self.stats

    def _run_streaming_parsing(self):
        """
        Stream parsing with ProcessPool.
        """
        # Use the pre-serialized full config dict for worker IPC.
        # The Orchestrator sets _full_config_dict when constructing FrontendConfig.
        config_dict = self.config._full_config_dict or {}
        effective_package_root = self.config.parser.import_path or self.config.project_root
        config_dict["package_root"] = str(effective_package_root)

        # Batch Size (configurable via PipelineConfig.frontend_batch_size)
        BATCH_SIZE = self.config.pipeline.frontend_batch_size

        runner = ProcessPoolRunner(
            max_workers=self.config.parser.n_workers,
            maxtasks_per_child=20
        )

        logger.info(f"Starting ProcessPoolRunner (Workers={runner.max_workers}, BatchSize={BATCH_SIZE})...")

        # Generator Logic (Same as before)
        def task_generator():
            file_gen = self._scan_files()
            batch_files = []
            batch_langs = []
            batch_strategies = []

            for file_path in file_gen:
                self.stats["files_scanned"] += 1
                lang = self._detect_language(file_path)
                if not lang: continue

                strategy = self.dispatcher.decide(file_path, source_manager)
                if strategy == ParseStrategy.IGNORE:
                    self.stats["files_ignored"] += 1
                    continue

                if strategy == ParseStrategy.SKELETON:
                    self.stats["files_skeleton"] += 1
                else:
                    self.stats["files_full"] += 1

                batch_files.append(str(file_path))
                batch_langs.append(lang.value)
                batch_strategies.append(strategy.value)

                if len(batch_files) >= BATCH_SIZE:
                    yield ParserTask(
                        task_id=f"batch_{uuid.uuid4().hex[:8]}",
                        file_paths=list(batch_files),
                        languages=list(batch_langs),
                        parse_strategies=list(batch_strategies),
                        config_dict=config_dict
                    )
                    batch_files = []
                    batch_langs = []
                    batch_strategies = []

            if batch_files:
                yield ParserTask(
                    task_id=f"batch_last_{uuid.uuid4().hex[:8]}",
                    file_paths=batch_files,
                    languages=batch_langs,
                    parse_strategies=batch_strategies,
                    config_dict=config_dict
                )

        # Execution
        try:
            # [Optimization] 传入 initializer
            for result in runner.execute(
                    tasks=task_generator(),
                    handler_func=_parser_task_handler,
                    initializer=_init_frontend_worker,  # <--- 关键修改
                    initargs=(config_dict,)  # <--- 传递配置
            ):
                self._process_runner_result(result)
        except Exception as e:
            logger.error(f"Pipeline Execution Failed: {e}", exc_info=True)
            raise

    def _process_runner_result(self, result: TaskResult):
        if result.status != "SUCCESS":
            logger.error(f"Task {result.task_id} failed: {result.error}")
            return

        # 这里的 payload 是 int (nodes_written)，因为 Worker 已经写库了
        count = result.payload or 0
        self.stats["nodes_written"] += count
        self.stats["files_parsed"] += 1

        if self.stats["files_parsed"] % 10 == 0:
            logger.info(f"Processed {self.stats['files_parsed']} batches...")

    def _scan_files(self) -> Generator[Path, None, None]:
        root = self.config.project_root
        skip_dirs = set(self.config.parser.skip_dirs)
        exclude_patterns = self.config.parser.exclude_patterns

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            for fname in filenames:
                file_path = Path(dirpath) / fname
                if file_path.suffix not in self._valid_extensions: continue
                if any(fnmatch.fnmatch(fname, pattern) for pattern in exclude_patterns): continue
                yield file_path

    def _detect_language(self, filename: Path) -> Optional[Language]:
        ext = filename.suffix.lower()
        if ext in [".c", ".h"]:
            return Language.C
        elif ext in [".cpp", ".cc", ".cxx", ".hpp", ".hxx"]:
            return Language.CPP
        elif ext in [".py", ".pyw"]:
            return Language.PYTHON
        return None

    def _add_metadata(self):
        temp_builder = CPGBuilder()
        temp_builder.add_meta_data(
            language="MIXED",
            root_path=str(self.config.project_root),
            version="1.2"
        )
        self.store.save(temp_builder.get_graph())