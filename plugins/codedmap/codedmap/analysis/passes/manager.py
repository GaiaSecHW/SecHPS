"""Pass manager for orchestrating batch and stream analysis passes."""

import logging
import time
import traceback
from collections import deque
from pathlib import Path
from typing import List, Dict, Optional, Set, Type, Any, Union
from dataclasses import dataclass, field

from codedmap.infra.executor.runner import BaseRunner, ProcessPoolRunner
from codedmap.infra.executor.state import PipelineStateManager

from .base_batch import BaseBatchPass
from .base_stream import StreamPass

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.configs.ai import AIConfig
from codedmap.core.schema.graph.enums import ParseStrategy
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)


@dataclass
class PassRegistration:
    """Pass registration info"""
    pass_cls: Union[Type[BaseBatchPass], Type[StreamPass]]
    dependencies: List[Union[str, Type]] = field(default_factory=list)
    kwargs: Dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    is_stream: bool = False
    unique_name: str = ""


class PassManager:
    """
    Analysis pipeline manager (Dual Mode: Batch & Stream).
    Supports automated Pruning (Clean-Before-Write) and Subset Execution.

    Responsibilities:
    1. Manage global passes (BatchPass): DAG scheduling, resource lifecycle.
    2. Manage stream passes (StreamPass): In-memory pipeline.
    """

    def __init__(self,
                 config: AnalysisConfig,
                 store: Optional[CPGStore] = None,
                 runner: Optional[BaseRunner] = None,
                 storage_config: Optional[StorageConfig] = None,
                 ai_config: Optional[AIConfig] = None,
                 project_root: Optional[Path] = None,
                 workspace: Optional[Path] = None):
        self.config = config
        self.storage_config = storage_config or StorageConfig()
        self.ai_config = ai_config or AIConfig()
        self.project_root = project_root or Path(".")
        self.workspace = workspace or Path("./workspace")
        self.store = store

        self.runner = runner or ProcessPoolRunner(max_workers=config.max_workers)
        self.state_manager = PipelineStateManager(self.workspace)
        self._registered_names: Set[str] = set()

        self._global_registry: List[PassRegistration] = []
        self._stream_instances: List[StreamPass] = []

        self.stats: Dict[str, float] = {}

    def register(self,
                 pass_cls: Union[Type[BaseBatchPass], Type[StreamPass]],
                 dependencies: List[Union[str, Type]] = None,
                 enabled: bool = True,
                 name: Optional[str] = None,
                 **kwargs):
        """Generic registration interface."""
        if not enabled:
            return

        base_name = name if name else pass_cls.__name__
        unique_name = base_name

        counter = 1
        while unique_name in self._registered_names:
            counter += 1
            unique_name = f"{base_name}_{counter}"

        self._registered_names.add(unique_name)

        deps = []
        if dependencies:
            for d in dependencies:
                if isinstance(d, str):
                    deps.append(d)
                elif hasattr(d, '__name__'):
                    deps.append(d.__name__)

        if issubclass(pass_cls, StreamPass):
            try:
                instance = pass_cls(workspace=self.workspace)
                self._stream_instances.append(instance)
            except Exception as e:
                logger.error(f"Failed to instantiate Stream Pass {pass_cls.__name__}: {e}")

        elif issubclass(pass_cls, BaseBatchPass):
            reg = PassRegistration(
                pass_cls=pass_cls,
                dependencies=deps,
                kwargs=kwargs,
                enabled=enabled,
                is_stream=False,
                unique_name=unique_name
            )
            self._global_registry.append(reg)

        else:
            logger.warning(f"Unknown Pass type: {pass_cls}")

    def run_all(self, force_rerun: bool = False):
        """Execute all global passes with DAG scheduling."""
        if not self.store:
            logger.error("Cannot run global passes without a valid Store.")
            return

        if force_rerun:
            logger.warning("Force Rerun enabled: Clearing ALL pipeline states.")
            self.state_manager.clear()

        sorted_registry = self._topological_sort(self._global_registry)

        logger.info(f"Starting Global Analysis Pipeline (DAG Schedule: {len(sorted_registry)} passes)...")
        plan_str = " -> ".join([r.unique_name for r in sorted_registry])
        logger.info(f"Execution Plan: {plan_str}")

        self._execute_pass_list(sorted_registry, force_rerun=force_rerun)

    def run_subset(self, target_classes: List[Type], force_rerun: bool = False):
        """Execute only specified passes."""
        if not self.store:
            logger.error("Cannot run passes without a valid Store.")
            return

        if not target_classes:
            logger.warning("run_subset called with empty target list.")
            return

        target_set = set(target_classes)
        full_sorted = self._topological_sort(self._global_registry)
        subset_to_run = [r for r in full_sorted if r.pass_cls in target_set]

        if not subset_to_run:
            logger.warning("No matching registered passes found for the provided subset classes.")
            return

        logger.info(f"Starting Subset Analysis ({len(subset_to_run)} passes)...")
        plan_str = " -> ".join([r.unique_name for r in subset_to_run])
        logger.info(f"Subset Execution Plan: {plan_str}")

        self._execute_pass_list(subset_to_run, force_rerun=force_rerun)

    def _execute_pass_list(self, registry_list: List[PassRegistration], force_rerun: bool):
        """Unified pass list execution engine."""
        total_start = time.time()

        for reg in registry_list:
            if not reg.enabled:
                logger.info(f"Pass {reg.unique_name} is disabled. Skipping.")
                continue

            if not force_rerun and self.state_manager.is_completed(reg.unique_name):
                logger.info(f"Using cached result for {reg.unique_name} (SKIPPED)")
                continue

            try:
                self._run_single_global_pass(reg)
            except Exception as e:
                logger.error(f"Pipeline aborted due to failure in {reg.unique_name}")
                raise e

        total_duration = time.time() - total_start
        logger.info(f"Pipeline Segment Finished in {total_duration:.2f}s")
        self._print_summary()

    def _topological_sort(self, registry: List[PassRegistration]) -> List[PassRegistration]:
        """Kahn's algorithm for topological sort."""
        name_to_reg = {r.pass_cls.__name__: r for r in registry}
        adj = {r.pass_cls.__name__: [] for r in registry}
        in_degree = {r.pass_cls.__name__: 0 for r in registry}

        for r in registry:
            for dep_name in r.dependencies:
                if dep_name in name_to_reg:
                    adj[dep_name].append(r.pass_cls.__name__)
                    in_degree[r.pass_cls.__name__] += 1

        queue = deque([name for name, deg in in_degree.items() if deg == 0])
        sorted_result = []

        while queue:
            u_name = queue.popleft()
            sorted_result.append(name_to_reg[u_name])
            for v_name in adj[u_name]:
                in_degree[v_name] -= 1
                if in_degree[v_name] == 0:
                    queue.append(v_name)

        if len(sorted_result) != len(registry):
            logger.error("Cycle detected in Pass dependencies! Execution order is undefined.")
            return registry

        return sorted_result

    def _run_single_global_pass(self, reg: PassRegistration):
        """Run a single batch pass: Init -> Prune -> Run -> Cleanup"""
        pass_name = reg.unique_name
        logger.info(f"Running Global Pass: {pass_name} (Class: {reg.pass_cls.__name__})")

        self.state_manager.mark_start(pass_name)
        start_time = time.time()
        instance = None

        try:
            init_kwargs = reg.kwargs.copy()
            instance = reg.pass_cls(
                store=self.store,
                runner=self.runner,
                config=self.config,
                storage_config=self.storage_config,
                ai_config=self.ai_config,
                project_root=self.project_root,
                workspace=self.workspace,
                **init_kwargs
            )

            if hasattr(instance, 'prune'):
                try:
                    logger.debug(f"Pruning old data for {pass_name}...")
                    instance.prune()
                except Exception as e:
                    logger.error(f"Failed to prune old data for {pass_name}: {e}")
                    raise e

            instance.run()

            duration = time.time() - start_time
            self.stats[pass_name] = duration
            self.state_manager.mark_completed(pass_name)
            logger.info(f" -> {pass_name} completed in {duration:.2f}s.")

        except Exception as e:
            duration = time.time() - start_time
            self.stats[pass_name] = -1.0
            self.state_manager.mark_failed(pass_name, str(e))
            logger.error(f"Global Pass {pass_name} Failed after {duration:.2f}s: {e}")
            logger.debug(traceback.format_exc())
            raise e

        finally:
            if instance and hasattr(instance, 'cleanup'):
                try:
                    instance.cleanup()
                except Exception as cleanup_err:
                    logger.warning(f"Failed to cleanup pass {pass_name}: {cleanup_err}")

    def run_stream(self, graph: CPGGraph, strategy: ParseStrategy) -> CPGGraph:
        """Run stream passes on in-memory graph."""
        current_graph = graph
        for pass_obj in self._stream_instances:
            try:
                current_graph = pass_obj.run_on_graph(current_graph, strategy)
            except Exception as e:
                logger.error(f"Stream Pass {pass_obj.name} failed: {e}")
        return current_graph

    def _print_summary(self):
        print("\n=== Analysis Performance Summary ===")
        print(f"{'Pass Name':<30} | {'Time (s)':<10} | {'Status'}")
        print("-" * 55)
        for name, duration in self.stats.items():
            status = "OK" if duration >= 0 else "FAIL"
            time_str = f"{duration:.2f}" if duration >= 0 else "N/A"
            print(f"{name:<30} | {time_str:<10} | {status}")
        print("=" * 55 + "\n")
