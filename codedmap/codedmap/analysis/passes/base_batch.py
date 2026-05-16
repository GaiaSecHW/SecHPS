# codedmap/analysis/passes/base_batch.py

import logging
import time
import os
import sys
import psutil
import traceback
import functools
from abc import ABC, abstractmethod
from enum import Enum
from typing import Iterator, List, Dict, Any, Callable, Tuple, Optional, Union

# 引入核心组件
from pathlib import Path
from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.infra.executor.runner import BaseRunner
from codedmap.infra.executor.messages.base import BaseTask, TaskResult
from codedmap.infra.executor.messages.analysis import BatchAnalysisResult, EdgeTuple, UpdateTuple

# [Update] 引入 Patch 相关定义以支持 Pruning
from codedmap.core.schema.graph.patch import GraphPatch, PatchStrategy, PruneRequest
from codedmap.core.schema.graph.enums import EdgeType

# 引入我们刚才确定的 DiskMap 工具
from codedmap.infra.utils.disk_map import DiskMap

logger = logging.getLogger(__name__)


# =============================================================================
# 0. Safety Wrapper (The Debugger)
# =============================================================================

def _safe_worker_wrapper(real_handler: Callable, task: Any) -> Any:
    """
    拦截 Worker 的执行，确保：
    1. 输入参数 task 无论是 Dict 还是 Object 都能被处理。
    2. 任何 crash 都会被捕获并打印完整堆栈到 stderr（防止日志丢失）。
    3. 返回一个合法的 Result 对象，防止 Runner 崩溃。
    """
    task_id = "unknown"
    try:
        if isinstance(task, dict):
            task_id = task.get('task_id') or task.get('id') or "unknown"
        else:
            task_id = getattr(task, 'task_id', getattr(task, 'id', "unknown"))
    except Exception:
        pass

    try:
        return real_handler(task)

    except Exception as e:
        error_msg = f"\n[CRITICAL WORKER CRASH] Task {task_id}\nType: {type(e).__name__}\nMsg: {str(e)}\nTraceback:\n{traceback.format_exc()}\n"
        sys.stderr.write(error_msg)
        sys.stderr.flush()

        return BatchAnalysisResult(
            task_id=str(task_id),
            status="FAILED",
            error=str(e)
        )


# =============================================================================
# 1. Worker Context
# =============================================================================

class WorkerGlobalState:
    _project_root: str = ""
    _disk_map: Optional[DiskMap] = None

    @classmethod
    def initialize(cls, project_root: str, disk_map_path: str, key_type: str, value_type: str, table_name: str):
        cls._project_root = project_root
        if cls._disk_map is None and disk_map_path:
            cls._disk_map = DiskMap(
                table_name=table_name,
                key_type=key_type,
                value_type=value_type,
                existing_db_path=disk_map_path
            )

    @classmethod
    def get_map(cls) -> DiskMap:
        if cls._disk_map is None:
            raise RuntimeError("Worker DiskMap not initialized!")
        return cls._disk_map

    @classmethod
    def get_project_root(cls) -> str:
        return cls._project_root


def init_worker(project_root: str, disk_map_path: str, key_type: str, value_type: str, table_name: str):
    WorkerGlobalState.initialize(project_root, disk_map_path, key_type, value_type, table_name)


# =============================================================================
# 2. Batch Writer Context (Updated for Provenance)
# =============================================================================

class BatchWriterContext:
    """
    批量写入上下文管理器。
    [Update] 自动注入 created_by 字段。
    """

    def __init__(self, store: CPGStore, created_by: str, batch_size: int = 5000):
        self.store = store
        self.created_by = created_by  # [New] 当前 Pass 的名称
        self.batch_size = batch_size
        self._edge_buffer: List[Dict] = []
        self._update_buffer: List[Dict] = []

    def add_edge_tuple(self, src, dst, type_str, props=None):
        # [New] 构造字典时注入 created_by
        self._edge_buffer.append({
            "src": src,
            "dst": dst,
            "type": type_str,
            "created_by": self.created_by,
            "properties": props or {}
        })
        self._check_flush()

    def add_update_tuple(self, node_id, props):
        payload = props.copy()
        payload['id'] = node_id
        # Update 也可以带上 last_modified_by，视 Schema 而定，这里暂且保持原样
        self._update_buffer.append(payload)
        self._check_flush()

    def add_raw_results(self, edges: List[EdgeTuple], updates: List[UpdateTuple]):
        if edges:
            # [New] 批量注入 created_by
            self._edge_buffer.extend([
                {
                    "src": e[0],
                    "dst": e[1],
                    "type": e[2],
                    "created_by": self.created_by,
                    "properties": e[3] or {}
                }
                for e in edges
            ])
        if updates:
            for nid, props in updates:
                payload = props.copy()
                payload['id'] = nid
                self._update_buffer.extend([payload])
        self._check_flush()

    def _check_flush(self):
        total = len(self._edge_buffer) + len(self._update_buffer)
        if total >= self.batch_size:
            self.flush()

    def flush(self):
        if self._edge_buffer:
            self.store.add_edges_batch(self._edge_buffer)
            self._edge_buffer.clear()
        if self._update_buffer:
            self.store.update_nodes_properties(
                label="ANY", updates=self._update_buffer, match_key="id"
            )
            self._update_buffer.clear()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.flush()


# =============================================================================
# 3. Base Batch Pass (Updated for Pruning)
# =============================================================================

class PrunePolicy(str, Enum):
    """
    Pass 运行前的清理策略。
    """
    SELF_GENERATED = "SELF_GENERATED"  # 默认：仅删除由当前 Pass (created_by=self.name) 创建的边


class BaseBatchPass(ABC):
    def __init__(self, store: CPGStore, runner: BaseRunner,
                 config: Optional[AnalysisConfig] = None,
                 storage_config: Optional[StorageConfig] = None,
                 project_root: Optional[Path] = None,
                 workspace: Optional[Path] = None,
                 **kwargs):
        if not runner:
            raise ValueError("BaseBatchPass requires a valid 'runner' instance.")
        self.store = store
        self.runner = runner
        self.config = config or AnalysisConfig()
        self.storage_config = storage_config or StorageConfig()
        self.project_root = project_root or Path(".")
        self.workspace = workspace or Path("./workspace")
        self.work_dir = self.workspace / "analysis"
        self.state_map: Optional[DiskMap] = None

        self.prune_policy: PrunePolicy = PrunePolicy.SELF_GENERATED
        self.prune_targets: List[EdgeType] = []

    @property
    def name(self) -> str:
        return self.__class__.__name__

    @abstractmethod
    def run(self):
        pass

    def prune(self):
        """
        [Clean-Before-Write]
        根据 prune_policy 和 prune_targets 生成并执行清理 Patch。
        通常由 PassManager 在 run() 之前调用。
        """
        if not self.prune_targets:
            return

        logger.info(f"[{self.name}] Executing Prune Strategy: {self.prune_policy.value} on {self.prune_targets}")

        patch = GraphPatch(
            created_by=self.name,
            strategy=PatchStrategy.OVERWRITE
        )

        for edge_type in self.prune_targets:
            if self.prune_policy == PrunePolicy.SELF_GENERATED:
                # 只清理“我自己”生成的特定类型边
                patch.prune_actions.append(
                    PruneRequest(edge_type=edge_type, created_by=self.name)
                )
            else:
                pass

        if not patch.is_empty:
            try:
                self.store.apply_patch(patch)
                logger.info(f"[{self.name}] Prune completed.")
            except Exception as e:
                logger.error(f"[{self.name}] Prune failed: {e}")
                raise

    def index_state(self, source_iter, key_extractor, value_extractor, key_type="TEXT",
                    value_type="INTEGER") -> DiskMap:
        start_time = time.time()
        logger.info(f"[{self.name}] [Phase 1] Indexing state ({key_type}->{value_type})...")

        self.state_map = DiskMap(table_name="pass_state", key_type=key_type, value_type=value_type)
        self.state_map.__enter__()

        count = 0

        def generator():
            nonlocal count
            for node in source_iter:
                k = key_extractor(node)
                v = value_extractor(node)
                if k is not None and v is not None:
                    yield k, v
                    count += 1
                    if count % 100000 == 0:
                        self._log_mem(f"Indexing {count} items")

        try:
            self.state_map.bulk_set(generator())
            logger.info(f"[{self.name}] [Phase 1] Done. Items: {count}, Time: {time.time() - start_time:.2f}s")
            return self.state_map
        except Exception as e:
            logger.error(f"[{self.name}] Indexing failed: {e}")
            self.cleanup()
            raise

    def run_parallel(self,
                     task_generator: Iterator[BaseTask],
                     worker_handler: Callable[[BaseTask], BatchAnalysisResult],
                     total_items: int = 0) -> Dict[str, int]:

        if not self.state_map:
            raise RuntimeError("State map not initialized. Call index_state() first.")

        start_time = time.time()
        logger.info(f"[{self.name}] [Phase 2] Starting Parallel Analysis.")

        # Worker Init Args
        project_root = str(self.project_root)

        current_table_name = self.state_map.table_name

        init_args = (
            project_root,
            self.state_map.db_path,
            self.state_map.key_type,
            self.state_map.value_type,
            current_table_name
        )

        metrics = {"processed": 0, "edges_created": 0, "failed": 0}
        last_log_time = start_time

        safe_handler = functools.partial(_safe_worker_wrapper, worker_handler)

        # [Update] 传入 self.name 作为 created_by
        with BatchWriterContext(self.store, created_by=self.name, batch_size=5000) as writer:
            results_iter = self.runner.execute(
                tasks=task_generator,
                handler_func=safe_handler,
                initializer=init_worker,
                initargs=init_args
            )

            for res in results_iter:
                metrics["processed"] += 1

                if isinstance(res, dict):
                    status = res.get('status', 'FAILED')
                    error = res.get('error', 'Unknown error')
                    new_edges = res.get('new_edges', [])
                    node_updates = res.get('node_updates', [])
                    res_metrics = res.get('metrics', {})
                else:
                    status = getattr(res, 'status', 'FAILED')
                    error = getattr(res, 'error', 'Unknown error')
                    new_edges = getattr(res, 'new_edges', [])
                    node_updates = getattr(res, 'node_updates', [])
                    res_metrics = getattr(res, 'metrics', {})

                if status != "SUCCESS":
                    logger.error(f"[{self.name}] Task failed: {error}")
                    metrics["failed"] += 1
                    continue

                if new_edges or node_updates:
                    writer.add_raw_results(new_edges, node_updates)

                if res_metrics:
                    for k, v in res_metrics.items():
                        metrics[f"worker_{k}"] = metrics.get(f"worker_{k}", 0) + v
                    metrics["edges_created"] += len(new_edges)

                if time.time() - last_log_time >= 10.0:
                    self._log_progress(start_time, metrics["processed"], total_items, metrics["edges_created"])
                    last_log_time = time.time()

        total_time = time.time() - start_time
        logger.info(f"[{self.name}] [Phase 2] Complete. Time: {total_time:.2f}s, Edges: {metrics['edges_created']}")
        return metrics

    def iter_nodes(self, label: str, fields: List[str] = None) -> Iterator[Dict[str, Any]]:
        target_fields = list(fields) if fields else []
        if 'id' not in target_fields: target_fields.append('id')
        return self.store.query.all_nodes(node_label=label).values(*target_fields)

    def cleanup(self):
        if self.state_map:
            try:
                self.state_map.__exit__(None, None, None)
            except Exception:
                pass
            self.state_map = None

    def _log_mem(self, msg: str):
        try:
            process = psutil.Process(os.getpid())
            mem = process.memory_info().rss / 1024 / 1024
            logger.debug(f"[{self.name}] {msg} | RSS: {mem:.1f} MB")
        except:
            pass

    def _log_progress(self, start_time, processed, total, created):
        elapsed = time.time() - start_time
        speed = processed / elapsed if elapsed > 0 else 0
        pct = f"{(processed / total * 100):.1f}%" if total > 0 else "?"
        self._log_mem(f"Progress: {processed}/{total} ({pct}) | Speed: {int(speed)}/s | Edges: {created}")