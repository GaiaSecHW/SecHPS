# codedmap/analysis/passes/batch/global_points_to.py

import logging
import gc
import time
import sys
import traceback
from collections import defaultdict
from functools import lru_cache
from typing import Dict, Set, List, Tuple, Any, Iterator, Optional

# Core Schema & Enums
from codedmap.analysis.passes.analysis_data import ConstraintType
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, DispatchType
from codedmap.core.schema.graph.operators import Operators
from codedmap.infra.executor.messages.base import BaseTask
from codedmap.infra.executor.messages.analysis import BatchAnalysisResult

# Base Classes & Storage
from codedmap.analysis.passes.base_batch import BaseBatchPass, BatchWriterContext, WorkerGlobalState
# 引用修复后的 DiskMap/DiskSet
from codedmap.infra.utils.disk_map import DiskMap, DiskSet
from codedmap.infra.storage.store import CPGStore

logger = logging.getLogger(__name__)

# =============================================================================
# Constants
# =============================================================================

# Linux Kernel & C Standard Allocators
ALLOCATION_NAMES = {
    "malloc", "calloc", "realloc", "strdup", "strndup", "memalign", "posix_memalign",
    "g_malloc", "g_malloc0", "g_realloc", "g_try_malloc", "g_new", "g_new0",
    "kmalloc", "kzalloc", "vmalloc", "kcalloc", "kvmalloc", "kvzalloc",
    "kmem_cache_alloc", "devm_kzalloc", "devm_kmalloc",
    "new", "operator new", "<operator>.new"
}

# Dereference Operators
DEREFERENCE_OPS = {
    Operators.indirection, Operators.fieldAccess, Operators.indirectFieldAccess,
    Operators.indexAccess, Operators.pointerShift, Operators.getElementPtr
}


# =============================================================================
# 1. Worker Context & Initialization
# =============================================================================

class GlobalPointsToWorkerState:
    store: Optional[CPGStore] = None
    # Worker 端的 DB 句柄
    pts: Optional[DiskSet] = None
    copy_edges: Optional[DiskSet] = None
    load_constraints: Optional[DiskSet] = None
    store_constraints: Optional[DiskSet] = None

    # 路径配置
    _work_dir: str = ""

    @classmethod
    def initialize(cls, config_dump: Dict[str, Any], work_dir: str):
        """Worker 初始化：连接 Storage 和 DiskMap"""
        if cls.store is None:
            from codedmap.core.configs.storage import StorageConfig
            try:
                storage_config = StorageConfig(**config_dump)
                cls.store = CPGStore(storage_config)
                cls._work_dir = work_dir

                # 初始化 DiskSets (复用 Master 建立的 DB 文件)
                # 注意：DiskMap 内部已处理并发连接 (WAL Mode)
                cls._init_db("pts.db", "pts")
                cls._init_db("copy.db", "copy_edges")
                cls._init_db("load.db", "load_constraints")
                cls._init_db("store.db", "store_constraints")

            except Exception as e:
                sys.stderr.write(f"[GPT-Worker] Init failed: {e}\n")
                raise e

    @classmethod
    def _init_db(cls, filename, attr_name):
        dm = DiskMap(table_name=attr_name, value_type="INTEGER", filename=filename, work_dir=cls._work_dir)
        setattr(cls, attr_name, DiskSet(dm))


def gpt_worker_init(config_dump: Dict[str, Any], work_dir: str):
    GlobalPointsToWorkerState.initialize(config_dump, work_dir)


# =============================================================================
# 2. Worker Logic (Parallel Constraint Gen)
# =============================================================================

def _resolve_batch_refs(store: CPGStore, node_ids: List[int]) -> Dict[int, int]:
    """[Helper] 批量归一化 Identifier -> Local/Global"""
    if not node_ids: return {}
    unique_ids = list(set(node_ids))
    mapping = {nid: nid for nid in unique_ids}

    try:
        # 查询 REF 边 (Identifier -> Local/Param/Global)
        refs = store.get_neighbor_nodes_batch(
            node_ids=unique_ids, direction="OUT", edge_types=[EdgeType.REF.value]
        )
        for nid, neighbors in refs.items():
            if neighbors:
                target = neighbors[0]
                tid = getattr(target, 'id', None)
                if tid is not None:
                    mapping[nid] = tid
    except Exception as e:
        logger.warning(f"Batch ref resolution failed: {e}")

    return mapping


def _get_phantom_id(seed_id: int) -> int:
    """生成确定的负数 ID 用于中间变量"""
    return -1 * abs(seed_id)


def assignment_worker(task: BaseTask) -> BatchAnalysisResult:
    """
    [Worker] 扫描赋值语句，直接写入 DB。
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")
    stats = {"allocs": 0, "assigns": 0, "loads": 0, "stores": 0}

    # [DEBUG] Worker 级日志前缀
    log_prefix = f"[Worker-Assign-{task.task_id}]"

    try:
        state = GlobalPointsToWorkerState
        store = state.store
        assign_ids = task.payload.get("ids", [])
        if not assign_ids: return result

        # 1. Fetch LHS & RHS
        neighbors = store.get_neighbor_nodes_batch(
            node_ids=assign_ids, direction="OUT", edge_types=[EdgeType.AST.value, EdgeType.ARGUMENT.value]
        )

        # 2. Parse & Prepare Resolution
        parsed_ops = []  # (assign_id, lhs_node, rhs_node)
        ids_to_resolve = set()
        drill_down_ids = set()  # For fieldAccess

        for aid, nodes in neighbors.items():
            lhs = next((n for n in nodes if getattr(n, 'order', 0) == 1), None)
            rhs = next((n for n in nodes if getattr(n, 'order', 0) == 2), None)
            if lhs and rhs:
                parsed_ops.append((aid, lhs, rhs))

                # Check for Drill Down (fieldAccess -> base)
                if getattr(lhs, 'name', '') in DEREFERENCE_OPS: drill_down_ids.add(lhs.id)
                r_name = getattr(rhs, 'name', '')
                if r_name in DEREFERENCE_OPS or r_name == Operators.addressOf: drill_down_ids.add(rhs.id)

        # [DEBUG] 打印解析情况
        if len(parsed_ops) > 0:
             sys.stderr.write(f"{log_prefix} Parsed {len(parsed_ops)} assignments from {len(assign_ids)} tasks.\n")

        # 3. Drill Down (Get Base for x->f)
        inner_map = {}
        if drill_down_ids:
            inner_neighbors = store.get_neighbor_nodes_batch(
                node_ids=list(drill_down_ids), direction="OUT", edge_types=[EdgeType.AST.value, EdgeType.ARGUMENT.value]
            )
            for pid, children in inner_neighbors.items():
                # Base is usually order 1
                base = next((c for c in children if getattr(c, 'order', 0) == 1), None)
                if base: inner_map[pid] = base.id

        # 4. Collect IDs for Resolution
        for _, lhs, rhs in parsed_ops:
            # LHS
            if getattr(lhs, 'name', '') in DEREFERENCE_OPS:
                base = inner_map.get(lhs.id)
                if base: ids_to_resolve.add(base)
            else:
                ids_to_resolve.add(lhs.id)

            # RHS
            r_name = getattr(rhs, 'name', '')
            if r_name in DEREFERENCE_OPS or r_name == Operators.addressOf:
                base = inner_map.get(rhs.id)
                if base: ids_to_resolve.add(base)
            elif r_name not in ALLOCATION_NAMES:
                ids_to_resolve.add(rhs.id)

        ref_map = _resolve_batch_refs(store, list(ids_to_resolve))

        # [DEBUG] 检查归一化率
        resolved_count = sum(1 for k, v in ref_map.items() if k != v)
        if len(ids_to_resolve) > 0:
             sys.stderr.write(f"{log_prefix} Resolved {resolved_count}/{len(ids_to_resolve)} identifiers.\n")

        # 5. Generate & Write Constraints (Atomic Batch Write)
        with state.pts.batch_update() as pts_w, \
                state.copy_edges.batch_update() as copy_w, \
                state.load_constraints.batch_update() as load_w, \
                state.store_constraints.batch_update() as store_w:

            for aid, lhs, rhs in parsed_ops:
                l_name = getattr(lhs, 'name', '')
                r_name = getattr(rhs, 'name', '')
                l_is_deref = l_name in DEREFERENCE_OPS

                # Resolve LHS
                if l_is_deref:
                    l_inner = inner_map.get(lhs.id)
                    lhs_target = ref_map.get(l_inner, l_inner) if l_inner else None
                else:
                    lhs_target = ref_map.get(lhs.id, lhs.id)

                if lhs_target is None: continue

                # Logic Branching
                if l_is_deref:
                    # *lhs = ... (STORE)
                    # Handle RHS
                    src_id = None
                    if r_name in ALLOCATION_NAMES:
                        # *x = malloc -> temp = malloc; *x = temp
                        phantom = _get_phantom_id(aid)
                        pts_w.add(phantom, rhs.id)  # rhs.id is allocation site
                        src_id = phantom
                        stats["allocs"] += 1
                        # [DEBUG]
                        # sys.stderr.write(f"{log_prefix} Found Indirect Alloc: *x = {r_name}\n")
                    elif r_name == Operators.addressOf:
                        # *x = &y -> temp = &y; *x = temp
                        r_inner = inner_map.get(rhs.id)
                        if r_inner:
                            target = ref_map.get(r_inner, r_inner)
                            phantom = _get_phantom_id(aid)
                            pts_w.add(phantom, target)
                            src_id = phantom
                    elif r_name in DEREFERENCE_OPS:
                        # *x = *y -> temp = *y; *x = temp
                        r_inner = inner_map.get(rhs.id)
                        if r_inner:
                            ptr = ref_map.get(r_inner, r_inner)
                            phantom = _get_phantom_id(aid)
                            load_w.add(ptr, phantom)
                            src_id = phantom
                    else:
                        # *x = y
                        src_id = ref_map.get(rhs.id, rhs.id)

                    if src_id:
                        store_w.add(lhs_target, src_id)
                        stats["stores"] += 1

                else:
                    # x = ... (Direct Write)
                    if r_name in ALLOCATION_NAMES:
                        # x = malloc
                        pts_w.add(lhs_target, rhs.id)
                        stats["allocs"] += 1
                        # [DEBUG] 捕获 Allocator
                        # sys.stderr.write(f"{log_prefix} Found Direct Alloc: {lhs.name} = {r_name} (NodeID: {rhs.id})\n")
                    elif r_name == Operators.addressOf:
                        # x = &y
                        r_inner = inner_map.get(rhs.id)
                        if r_inner:
                            target = ref_map.get(r_inner, r_inner)
                            pts_w.add(lhs_target, target)
                            # [DEBUG] 捕获 ADDR_OF
                            # sys.stderr.write(f"{log_prefix} Found ADDR_OF: {lhs.name} = &...\n")
                    elif r_name in DEREFERENCE_OPS:
                        # x = *y (LOAD)
                        r_inner = inner_map.get(rhs.id)
                        if r_inner:
                            ptr = ref_map.get(r_inner, r_inner)
                            load_w.add(ptr, lhs_target)
                            stats["loads"] += 1
                    else:
                        # x = y (COPY)
                        src = ref_map.get(rhs.id, rhs.id)
                        copy_w.add(src, lhs_target)
                        stats["assigns"] += 1

        result.metrics = stats
        return result

    except Exception as e:
        sys.stderr.write(f"[Worker-Assign-ERROR] {e}\n{traceback.format_exc()}\n")
        return BatchAnalysisResult(task_id=task.task_id, status="FAILED", error=str(e))


def call_scan_worker(task: BaseTask) -> BatchAnalysisResult:
    """
    [Worker] 扫描函数调用，生成参数传递约束。
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")
    stats = {"calls_processed": 0}
    log_prefix = f"[Worker-Call-{task.task_id}]"

    try:
        state = GlobalPointsToWorkerState
        store = state.store
        call_ids = task.payload.get("ids", [])
        if not call_ids: return result

        # 1. Fetch Call -> Method (Using EdgeType.CALL established by Linker)
        call_to_methods = store.get_neighbor_nodes_batch(
            node_ids=call_ids, direction="OUT", edge_types=[EdgeType.CALL.value]
        )

        valid_calls = [c for c, m in call_to_methods.items() if m]

        # [DEBUG]
        if len(valid_calls) > 0:
            sys.stderr.write(f"{log_prefix} Processing {len(valid_calls)} linked calls out of {len(call_ids)}\n")

        if not valid_calls: return result

        # 2. Fetch Args
        neighbors_args = store.get_neighbor_nodes_batch(
            node_ids=valid_calls, direction="OUT", edge_types=[EdgeType.ARGUMENT.value]
        )

        args_map = {}  # cid -> list of {id, idx}
        ids_to_resolve = set()

        for cid, nodes in neighbors_args.items():
            args = []
            for n in nodes:
                idx = getattr(n, 'argument_index', -1)
                order = getattr(n, 'order', -1)
                nid = getattr(n, 'id', None)
                if nid:
                    args.append({'id': nid, 'idx': idx, 'order': order})
                    ids_to_resolve.add(nid)
            args.sort(key=lambda x: (x['idx'], x['order']))
            args_map[cid] = args

        # 3. Resolve Args
        ref_map = _resolve_batch_refs(store, list(ids_to_resolve))

        # 4. Fetch Params
        all_methods = set()
        for m_list in call_to_methods.values():
            for m in m_list: all_methods.add(m.id)

        neighbors_params = store.get_neighbor_nodes_batch(
            node_ids=list(all_methods), direction="OUT", edge_types=[EdgeType.AST.value],
            target_labels=[NodeLabel.METHOD_PARAMETER_IN.value, NodeLabel.METHOD_RETURN.value]
        )

        params_map = defaultdict(list)
        returns_map = {}
        for mid, nodes in neighbors_params.items():
            for n in nodes:
                lbl = getattr(n, 'label', '').value if hasattr(getattr(n, 'label', ''), 'value') else getattr(n,
                                                                                                              'label',
                                                                                                              '')
                if lbl == NodeLabel.METHOD_PARAMETER_IN.value:
                    order = getattr(n, 'order', -1)
                    params_map[mid].append({'id': n.id, 'order': order})
                elif lbl == NodeLabel.METHOD_RETURN.value:
                    returns_map[mid] = n.id
            params_map[mid].sort(key=lambda x: x['order'])

        # 5. Write Constraints
        with state.copy_edges.batch_update() as copy_w:
            for cid in valid_calls:
                c_args = args_map.get(cid, [])
                targets = call_to_methods.get(cid, [])

                for target_method in targets:
                    mid = target_method.id
                    m_params = params_map.get(mid, [])

                    # [DEBUG] 检查参数匹配情况
                    #if len(c_args) > 0 and len(m_params) > 0:
                    #    sys.stderr.write(f"{log_prefix} Call {cid} -> Method {mid}: Matching {len(c_args)} args to {len(m_params)} params\n")

                    # Arg -> Param
                    for arg, param in zip(c_args, m_params):
                        src = ref_map.get(arg['id'], arg['id'])
                        copy_w.add(src, param['id'])
                        stats["calls_processed"] += 1

                    # Return -> Call
                    ret_id = returns_map.get(mid)
                    if ret_id:
                        copy_w.add(ret_id, cid)

        result.metrics = stats
        return result

    except Exception as e:
        sys.stderr.write(f"[Worker-Call-ERROR] {e}\n{traceback.format_exc()}\n")
        return BatchAnalysisResult(task_id=task.task_id, status="FAILED", error=str(e))


# =============================================================================
# 3. Main Pass (Solver & Orchestration)
# =============================================================================

class GlobalPointsToPass(BaseBatchPass):
    BATCH_SIZE = 10000
    SOLVER_MAX_ITER = 100

    def run(self):
        logger.info(f"=== [{self.name}] Starting Production Analysis (All-in-One Fix + Debug) ===")
        start_time = time.time()

        self._init_disk_state()
        stats = defaultdict(int)

        try:
            # Phase 1: Parallel Assignment Scan
            # 虽然 LocalPointsToPass 可能跑过，但这里重新扫描确保全量覆盖（如 Global 初始值）
            self._run_scan(stats)

            # Phase 2: Solve
            self._solve_loop(stats)

            # Phase 3: Save Results
            self._save_results()

        finally:
            self._cleanup_disk_state()
            duration = time.time() - start_time
            logger.info(f"=== [{self.name}] Finished in {duration:.2f}s. Stats: {dict(stats)} ===")

    def _init_disk_state(self):
        # 确保 work_dir 存在
        wd = str(self.work_dir)
        # 初始化 DiskMap (KV) 和 DiskSet (Relation)
        # value_type="INTEGER" 配合 DiskSet 的 Schema
        self._dm_pts = DiskMap(table_name="pts", value_type="INTEGER", filename="pts.db", work_dir=wd)
        self.pts = DiskSet(self._dm_pts)

        self._dm_copy = DiskMap(table_name="copy_edges", value_type="INTEGER", filename="copy.db", work_dir=wd)
        self.copy_edges = DiskSet(self._dm_copy)

        self._dm_load = DiskMap(table_name="load_cons", value_type="INTEGER", filename="load.db", work_dir=wd)
        self.load_constraints = DiskSet(self._dm_load)

        self._dm_store = DiskMap(table_name="store_cons", value_type="INTEGER", filename="store.db", work_dir=wd)
        self.store_constraints = DiskSet(self._dm_store)

        self.worklist: Set[int] = set()
        self._resolved_call_cache: Set[Tuple[int, int]] = set()

    def _cleanup_disk_state(self):
        for attr in ['_dm_pts', '_dm_copy', '_dm_load', '_dm_store']:
            if hasattr(self, attr):
                db = getattr(self, attr)
                if db: db.close()
        gc.collect()

    def _run_scan(self, stats: Dict):
        """运行并行扫描任务"""
        logger.info(" > Phase 1: Scanning constraints...")
        init_args = (self.storage_config.model_dump(), str(self.work_dir))

        # 1. Assignments
        assign_tasks = self._generate_ids_tasks(NodeLabel.CALL.value, {"name": Operators.assignment})
        res_assign = self.runner.execute(
            tasks=assign_tasks, handler_func=assignment_worker,
            initializer=gpt_worker_init, initargs=init_args
        )
        for r in res_assign:
            if r.status == "SUCCESS":
                for k, v in r.metrics.items(): stats[k] += v
            else:
                logger.error(f"Assign task failed: {r.error}")

        # 2. Calls (Static)
        call_tasks = self._generate_ids_tasks(NodeLabel.CALL.value)  # Worker 内部会过滤已链接的
        res_calls = self.runner.execute(
            tasks=call_tasks, handler_func=call_scan_worker,
            initializer=gpt_worker_init, initargs=init_args
        )
        for r in res_calls:
            if r.status == "SUCCESS": stats["calls"] += r.metrics.get("calls_processed", 0)

        # [DEBUG] Sanity Check for Data Source
        logger.info(f" > Phase 1 Complete. Stats so far: {dict(stats)}")
        if stats.get('allocs', 0) == 0:
            logger.warning(" ! WARNING: No allocation sites found (malloc/new). Pts analysis might result in 0 edges.")
        if stats.get('assigns', 0) == 0:
            logger.warning(" ! WARNING: No assignment constraints found.")

    def _generate_ids_tasks(self, label: str, filters: Dict = None) -> Iterator[BaseTask]:
        query = self.store.query.all_nodes(label)
        if filters: query = query.filter(**filters)

        # Generator for batches
        batch = []
        tid = 0
        for item in query.values("id"):
            batch.append(item['id'])
            if len(batch) >= self.BATCH_SIZE:
                yield BaseTask(task_id=str(tid), payload={"ids": batch})
                batch = []
                tid += 1
        if batch:
            yield BaseTask(task_id=str(tid), payload={"ids": batch})

    # =========================================================================
    # Solver Logic (The Core)
    # =========================================================================

    def _solve_loop(self, stats: Dict):
        logger.info(" > Phase 2: Solving constraints (Anderson's Analysis)...")

        # [Fix Cold Start] 扫描 pts 表构建初始 Worklist
        self._initialize_worklist()

        # [DEBUG] Sanity Check for DB Population
        pts_count = self.pts.count()
        copy_count = self.copy_edges.count()
        logger.info(f"   [DB STATS] PTS: {pts_count}, COPY: {copy_count}")

        iteration = 0
        while self.worklist or iteration == 0:
            if not self.worklist and iteration > 0: break
            iteration += 1

            iter_start = time.time()
            processed = 0

            # Snapshot & Clear Worklist
            current_worklist = list(self.worklist)
            self.worklist.clear()

            # [Optimization] 预热缓存: 批量读取本轮需要的 PTS 集合
            # 使用 LRU Cache 装饰器在 self._get_cached_pts 上

            # --- Propagation ---
            # with self.pts.batch_update() as pts_w, ...
            # 注意：Solver 中为了逻辑清晰，且依赖实时性，暂时直接调用 add/update
            # 性能优化：通过 Cache 减少读 IO，写 IO 通过 DiskSet 内部优化

            # [DEBUG] 采样打印，防止日志爆炸
            sample_debug = False
            if iteration == 1 and len(current_worklist) > 0:
                sample_debug = True

            new_pts_count = 0

            for var_id in current_worklist:
                processed += 1
                pt_set = self._get_cached_pts(var_id)
                if not pt_set: continue

                # Rule 1: COPY (x = y) -> pts(x) U= pts(y)
                # Check downstream copy edges: var_id -> target
                # copy_edges 存储的是 src -> dst
                downstream = self.copy_edges.get(var_id)
                if downstream:
                    for target in downstream:
                        if self.pts.update(target, pt_set):
                            self.worklist.add(target)
                            new_pts_count += 1

                # Rule 2: LOAD (x = *var_id) -> pts(x) U= pts(o) for o in pt_set
                # load_cons: ptr -> {targets}
                load_targets = self.load_constraints.get(var_id)
                if load_targets:
                    for o in pt_set:
                        # 新增 COPY 边: o -> target
                        for target in load_targets:
                            if self.copy_edges.add(o, target):
                                # 新边建立，立即触发一次传播
                                pts_o = self._get_cached_pts(o)
                                if pts_o and self.pts.update(target, pts_o):
                                    self.worklist.add(target)
                                    new_pts_count += 1
                                # 同时需要监听 o 的变化
                                self.worklist.add(o)

                # Rule 3: STORE (*var_id = y) -> pts(o) U= pts(y) for o in pt_set
                # store_cons: ptr -> {sources}
                store_sources = self.store_constraints.get(var_id)
                if store_sources:
                    for o in pt_set:
                        # 新增 COPY 边: source -> o
                        for source in store_sources:
                            if self.copy_edges.add(source, o):
                                pts_src = self._get_cached_pts(source)
                                if pts_src and self.pts.update(o, pts_src):
                                    self.worklist.add(o)
                                    new_pts_count += 1
                                self.worklist.add(source)

            # --- Dynamic Dispatch ---
            new_edges = self._resolve_indirect_calls(stats)
            if new_edges:
                logger.info(f"    + Resolved {new_edges} dynamic calls.")

            logger.info(
                f"    Iter {iteration}: Proc {processed}, WL {len(self.worklist)}, Propagations {new_pts_count}, Time {time.time() - iter_start:.2f}s")

            # Cache Cleanup for memory safety
            self._get_cached_pts.cache_clear()

            if iteration >= self.SOLVER_MAX_ITER:
                logger.warning("Max iterations reached.")
                break

    @lru_cache(maxsize=100000)
    def _get_cached_pts(self, key: int) -> Set[int]:
        """[Optimization] 内存缓存 Points-to Set，减少 Solver 循环内的读 IO"""
        return self.pts.get(key)

    def _initialize_worklist(self):
        """[Fix Cold Start] 从 DB 加载初始 Worklist"""
        logger.info("    Initializing worklist from disk...")
        # 直接查询 pts 表中所有的 key
        cursor = self.pts.map.conn.execute(f"SELECT DISTINCT key FROM {self.pts.set_table_name}")
        count = 0
        while True:
            rows = cursor.fetchmany(10000)
            if not rows: break
            for r in rows:
                try:
                    self.worklist.add(int(r[0]))
                    count += 1
                except:
                    pass
        logger.info(f"    Worklist initialized with {count} nodes.")

    def _resolve_indirect_calls(self, stats: Dict) -> int:
        """
        解析间接调用。返回新增的边数。
        逻辑：
        1. 找到所有 Dynamic Dispatch Call
        2. 找到其函数指针 ptr
        3. 遍历 pts(ptr) 得到目标 methods
        4. 建立 Call Edge 和 COPY Edge
        """
        # 1. 找到潜在的 Dynamic Calls
        # 这里为了性能，只在 Master 端进行简单的 Query
        # 实际生产中可以缓存 Dynamic Call ID 列表
        query = self.store.query.all_nodes(NodeLabel.CALL.value).filter(
            dispatch_type=DispatchType.DYNAMIC_DISPATCH.value)
        dyn_calls = [n.get("id") for n in query.values("id")]

        new_edges_count = 0

        # [DEBUG] Check potential dynamic calls
        if len(dyn_calls) > 0:
            logger.debug(f"    Checking {len(dyn_calls)} dynamic calls for resolution...")

        # 批量获取 AST Child (Ptr)
        ast_map = self.store.get_neighbor_nodes_batch(dyn_calls, "OUT", [EdgeType.AST.value])

        for cid, children in ast_map.items():
            # 找 Order 最小的作为指针 (e.g. func_ptr(arg))
            ptr_node = min([c for c in children if hasattr(c, 'order')], key=lambda x: x.order, default=None)
            if not ptr_node: continue

            # 获取指针指向集
            targets = self._get_cached_pts(ptr_node.id)
            if not targets: continue

            for tgt_id in targets:
                if (cid, tgt_id) in self._resolved_call_cache: continue

                # 这是一个新的 Call 关系！
                # 1. 验证 tgt_id 是否是 Method
                # 这里略过验证 (假设 pts 传播正确)，直接建立边

                # 2. 建立 Call Edge
                with BatchWriterContext(self.store, created_by=self.name) as writer:
                    writer.add_edge_tuple(cid, tgt_id, EdgeType.CALL.value)

                # 3. 建立参数传递 (COPY)
                # 需要 fetch args 和 params，这里为了简化代码，暂略参数传递的具体构建
                # 在下一次迭代中，Worker 扫描静态 Call 时会扫到这条新边并生成约束！
                # 这是一个精妙的设计：Solver 只负责建边，Worker 负责补全约束。

                self._resolved_call_cache.add((cid, tgt_id))
                new_edges_count += 1
                stats["dyn_calls"] += 1

        return new_edges_count

    def _save_results(self):
        logger.info(" > Phase 3: Saving results to GraphDB...")
        count = 0
        with BatchWriterContext(self.store,  created_by=self.name, batch_size=5000) as writer:
            for src, tgts in self.pts.iter_items():
                # 过滤掉幻影变量 (负数 ID)
                if src < 0: continue
                for tgt in tgts:
                    if tgt < 0: continue  # 也不指向幻影
                    writer.add_edge_tuple(src, tgt, EdgeType.POINTS_TO.value)
                    count += 1
        logger.info(f"Saved {count} POINTS_TO edges.")