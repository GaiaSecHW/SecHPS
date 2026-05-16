import logging
import os
import time
import traceback
import gc
from typing import List, Dict, Set, Tuple, Optional, Any, Iterator
from dataclasses import dataclass
from collections import defaultdict

# Core Schema
from codedmap.core.schema.graph.nodes import (
    MethodParameterInNode, MethodReturnNode, Expression
)
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel

# Pipeline
from codedmap.infra.executor.messages.base import BaseTask
from codedmap.infra.executor.messages.analysis import BatchAnalysisResult, EdgeTuple

# Infrastructure
from codedmap.analysis.passes.base_batch import BaseBatchPass, BatchWriterContext
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.storage.interfaces import GraphReader
from codedmap.infra.utils.disk_map import DiskMap, DiskSet

logger = logging.getLogger(__name__)


@dataclass
class MethodInterface:
    """方法接口描述 (Worker 内部缓存用)"""
    params: List[Dict[str, Any]]  # 存储轻量级字典而非 Node 对象
    ret_id: Optional[int]
    is_variadic: bool
    return_type: str


# =============================================================================
# 1. Worker State & Initialization
# =============================================================================

class PDGWorkerState:
    store: Optional[CPGStore] = None
    pts: Optional[DiskSet] = None  # [NEW]

    @classmethod
    def initialize(cls, config_dump: Dict[str, Any], pts_db_path: Optional[str]):
        if cls.store is None:
            from codedmap.core.configs.storage import StorageConfig
            storage_config = StorageConfig(**config_dump)
            cls.store = CPGStore(storage_config)

            # 加载指针分析结果 (只读)
            if pts_db_path:
                try:
                    # 注意：表名必须与 GlobalPointsToPass 中定义的一致
                    dm = DiskMap(table_name="pts_graph", value_type="BLOB", existing_db_path=pts_db_path)
                    cls.pts = DiskSet(dm)
                except Exception as e:
                    # 容错：如果没有指针分析结果，降级运行
                    pass


def pdg_worker_init(config_dump: Dict[str, Any], pts_db_path: Optional[str]):
    PDGWorkerState.initialize(config_dump, pts_db_path)


# =============================================================================
# 2. Worker Logic (High Performance)
# =============================================================================


def pdg_worker(task: BaseTask) -> BatchAnalysisResult:
    """
    [Worker Entry] 计算过程间依赖图 (DDG)。
    输入: 批量 Call ID
    输出: DDG 边列表
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")

    try:
        call_ids = task.payload.get("ids", [])
        if not call_ids:
            return result

        store = PDGWorkerState.store
        if not store:
            raise RuntimeError("Worker store not initialized")

        # 1. Batch Fetch Call -> Method (仅获取 ID)
        # GraphReader.get_neighbors_batch -> Dict[int, List[int]]
        call_to_methods = store.get_neighbors_batch(
            node_ids=call_ids,
            direction="OUT",
            edge_types=[EdgeType.CALL.value]
        )

        if not call_to_methods:
            return result

        # 2. Collect Targets for Preloading
        target_method_ids = set()
        valid_call_ids = []

        for cid, m_ids in call_to_methods.items():
            if m_ids:
                target_method_ids.update(m_ids)
                valid_call_ids.append(cid)

        if not target_method_ids:
            return result

        # 3. Preload Data (Optimized Batch Loading)
        # 将数据加载逻辑封装为独立函数，保持主流程清晰
        interface_cache = _preload_method_interfaces(list(target_method_ids), store)
        args_cache = _preload_call_arguments(valid_call_ids, store)

        # 4. Compute Edges (In-Memory Logic)
        # result.new_edges 期望格式: List[EdgeTuple] -> [(src, dst, type, props)]
        stats = defaultdict(int)

        for call_id in valid_call_ids:
            target_ids = call_to_methods.get(call_id, [])
            args = args_cache.get(call_id, [])

            is_call_linked = False

            for m_id in target_ids:
                interface = interface_cache.get(m_id)
                if not interface: continue

                # 执行核心连线逻辑
                new_edges_count = _generate_interprocedural_edges(
                    call_id, args, interface, result.new_edges
                )

                if new_edges_count > 0:
                    is_call_linked = True
                    stats["edges_created"] += new_edges_count

            if is_call_linked:
                stats["calls_linked"] += 1

        result.metrics = dict(stats)
        return result

    except Exception as e:
        return BatchAnalysisResult(
            task_id=task.task_id,
            status="FAILED",
            error=f"{str(e)}\n{traceback.format_exc()}"
        )


def _generate_interprocedural_edges(call_id: int,
                                    args: List[Dict[str, Any]],
                                    interface: MethodInterface,
                                    output_list: List[Tuple]) -> int:
    """计算 DDG 边，包含副作用分析"""
    count = 0
    params = interface.params
    pts_reader = PDGWorkerState.pts  # [NEW]

    param_map = {p['order']: p for p in params if p.get('order', -1) >= 0}
    max_order = max(param_map.keys()) if param_map else 0
    variadic_param = params[-1] if (interface.is_variadic and params) else None

    for arg in args:
        idx = arg.get('argument_index')
        if idx is None:
            idx = -1

        if idx < 0: continue

        target_param = param_map.get(idx)
        if not target_param and interface.is_variadic and idx > max_order:
            target_param = variadic_param

        if target_param:
            # 1. Forward: Arg -> Param (Read)
            output_list.append((arg['id'], target_param['id'], EdgeType.DDG.value, {"variable": f"arg_{idx}"}))
            count += 1

            # 2. Backward: Param -> Arg (Write / Side-Effect)
            # 这是一个关键的工业级增强：处理 Out Parameters
            # 条件：参数是指针类型 且 (我们确信它指向了对象 OR 悲观假设)

            # 这里利用 Points-to 信息进行精确判断
            # 如果该实参(Argument)是一个指针且指向了某些内存对象
            is_pointer_arg = False
            if pts_reader:
                # 检查 DiskMap 中是否有该 Arg 的记录
                if pts_reader.contains_key(arg['id']):
                    is_pointer_arg = True

            # 如果没有 Points-to 信息，可以回退到类型检查 (如果 Type info available)
            # if not is_pointer_arg and '*' in target_param.get('type', ''): is_pointer_arg = True

            if is_pointer_arg:
                output_list.append((
                    target_param['id'],
                    arg['id'],
                    EdgeType.DDG.value,
                    {"variable": f"arg_{idx}_out", "type": "SIDE_EFFECT"}
                ))
                count += 1

    # 3. Return -> Call
    if interface.ret_id and interface.return_type != "void":
        output_list.append((interface.ret_id, call_id, EdgeType.DDG.value, {"variable": "RET"}))
        count += 1

    return count


# =============================================================================
# 3. Data Loading Helpers
# =============================================================================

def _preload_method_interfaces(method_ids: List[int], store: CPGStore) -> Dict[int, MethodInterface]:
    """批量加载方法签名信息 (Params, Return, Variadic flag)"""
    if not method_ids: return {}

    cache = {}

    # A. 加载 AST 子节点 (Params & Return)
    target_labels = [NodeLabel.METHOD_PARAMETER_IN.value, NodeLabel.METHOD_RETURN.value]
    # 使用 get_neighbor_nodes_batch 获取节点数据
    neighbors_map = store.get_neighbor_nodes_batch(
        node_ids=method_ids,
        direction="OUT",
        edge_types=[EdgeType.AST.value],
        target_labels=target_labels
    )

    # B. 加载 Method 自身属性 (is_variadic)
    # 使用 get_nodes_batch 批量获取节点属性
    # 这一步比 get_subgraph 轻量得多
    method_nodes = store.get_nodes_batch(method_ids)
    method_props = {n.id: n for n in method_nodes}

    for m_id in method_ids:
        method_node = method_props.get(m_id)
        if not method_node: continue

        is_variadic = getattr(method_node, 'is_variadic', False)

        nodes = neighbors_map.get(m_id, [])
        params_data = []
        ret_id = None
        ret_type = 'ANY'

        for node in nodes:
            # 兼容：有些后端返回对象，有些返回字典，统一处理
            lbl = getattr(node, 'label', None)
            if hasattr(lbl, 'value'): lbl = lbl.value

            nid = getattr(node, 'id', None)

            if lbl == NodeLabel.METHOD_PARAMETER_IN.value:
                order = getattr(node, 'order', -1)
                params_data.append({'id': nid, 'order': order})
            elif lbl == NodeLabel.METHOD_RETURN.value:
                ret_id = nid
                ret_type = getattr(node, 'type_full_name', 'ANY')

        # 按 order 排序参数
        params_data.sort(key=lambda x: x['order'])

        cache[m_id] = MethodInterface(
            params=params_data,
            ret_id=ret_id,
            is_variadic=is_variadic,
            return_type=ret_type
        )

    return cache


def _preload_call_arguments(call_ids: List[int], store: CPGStore) -> Dict[int, List[Dict]]:
    """批量加载 Call 的参数列表"""
    if not call_ids: return {}

    # 获取 (Call) -[ARGUMENT]-> (Expression)
    neighbors_map = store.get_neighbor_nodes_batch(
        node_ids=call_ids,
        direction="OUT",
        edge_types=[EdgeType.ARGUMENT.value],
        target_labels=None
    )

    cache = {}
    for c_id, nodes in neighbors_map.items():
        args = []
        for n in nodes:
            # 提取必要字段
            raw_idx = getattr(n, 'argument_index', -1)
            if raw_idx is None:
                raw_idx = -1
            args.append({
                'id': n.id,
                'argument_index': raw_idx
            })

        # 排序
        args.sort(key=lambda x: x['argument_index'])
        cache[c_id] = args

    return cache


# =============================================================================
# 4. PDGPass Main Class
# =============================================================================

class PDGPass(BaseBatchPass):
    """
    [Industrial Grade] PDG (Program Dependence Graph) 构建 Pass.

    功能:
    构建过程间的数据依赖边 (Inter-procedural Data Dependence).
    1. Argument Passing: Call Argument -> Method Parameter
    2. Return Value: Method Return -> Call Site

    特点:
    - OOM-Free: 流式处理 Call 节点，无需 DiskMap 索引。
    - High-Performance: Worker 利用批量 IO 预加载数据。
    """

    # Worker 计算量较小，主要在 IO，可适当增大 Batch Size
    TASK_BATCH_SIZE = 5000

    def run(self):
        logger.info(f"=== [{self.name}] Starting Analysis ===")
        start_time = time.time()

        pts_db_path = None
        potential_path = os.path.join(self.work_dir, "pts.db")
        if os.path.exists(potential_path):
            pts_db_path = potential_path
            logger.info(f"  > Found Points-to DB at: {pts_db_path}")
        else:
            logger.warning(f"  ! pts.db not found in work_dir: {self.work_dir}")

        # 1. 任务生成: 流式获取所有 Call ID
        # 直接使用 DSL 的 count 和 id_list 在海量数据下可能慢，
        # 推荐使用 _generate_tasks 中的流式处理。

        # 估算总数用于进度条 (Optional)
        # total_calls = self.store.query.all_nodes(NodeLabel.CALL.value).count()
        total_calls = 0


        # 2. 并行执行
        # 注意：这里不使用 run_parallel (因为它强制检查 DiskMap state)，
        # 而是直接调用 runner 并配合 BatchWriterContext。

        logger.info("  > Processing calls (Parallel)...")

        # 初始化 Worker 参数
        init_args = (self.storage_config.model_dump(), pts_db_path)

        # 启动任务
        results_iter = self.runner.execute(
            tasks=self._generate_tasks(),
            handler_func=pdg_worker,
            initializer=pdg_worker_init,
            initargs=init_args
        )

        # 3. 结果处理 loop
        # 使用 BatchWriterContext 自动缓冲和批量写入
        with BatchWriterContext(self.store, created_by=self.name, batch_size=5000) as writer:
            processed_tasks = 0
            metrics = defaultdict(int)
            last_log = time.time()
            total_calls = 0

            for res in results_iter:
                processed_tasks += 1

                if res.status != "SUCCESS":
                    logger.error(f"Task {res.task_id} failed: {res.error}")
                    metrics["failed_tasks"] += 1
                    continue

                # 写入新边
                if res.new_edges:
                    writer.add_raw_results(res.new_edges, [])

                # 聚合统计
                for k, v in res.metrics.items():
                    metrics[k] += v

                # 进度日志
                if time.time() - last_log > 10.0:
                    self._log_progress(start_time, processed_tasks, total_calls, metrics)
                    last_log = time.time()

        duration = time.time() - start_time
        logger.info(f"=== [{self.name}] Completed in {duration:.2f}s ===")
        logger.info(f"  > Calls Linked: {metrics['calls_linked']}")
        logger.info(f"  > DDG Edges: {metrics['edges_created']}")
        logger.info(f"  > Failed: {metrics['failed_tasks']}")

    def _generate_tasks(self) -> Iterator[BaseTask]:
        """流式生成任务块"""
        # 使用 values() 仅投影 id，内存开销最小
        call_iter = self.store.query.all_nodes(NodeLabel.CALL.value).values("id")

        current_batch = []
        task_seq = 0

        for item in call_iter:
            current_batch.append(item['id'])
            if len(current_batch) >= self.TASK_BATCH_SIZE:
                yield BaseTask(task_id=str(task_seq), payload={"ids": current_batch})
                current_batch = []
                task_seq += 1

        if current_batch:
            yield BaseTask(task_id=str(task_seq), payload={"ids": current_batch})

    def _log_progress(self, start_time, processed, total, metrics):
        elapsed = time.time() - start_time
        speed = processed / elapsed if elapsed > 0 else 0

        # 内存监控
        process = gc.get_objects()  # 只是触发一下统计，或者可以用 psutil

        logger.info(
            f"  > Processed Tasks: {processed} | "
            f"Speed: {speed:.1f} tasks/s | "
            f"Edges: {metrics['edges_created']}"
        )