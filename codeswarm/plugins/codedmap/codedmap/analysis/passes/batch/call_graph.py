# codedmap/analysis/passes/batch/call_graph.py

import logging
import json
from typing import Iterator

from codedmap.core.schema.graph.enums import EdgeType, NodeLabel, DispatchType
from codedmap.infra.executor.messages.analysis import AnalysisTask, BatchAnalysisResult
from codedmap.infra.utils.disk_map import DiskMap
from codedmap.analysis.passes.base_batch import BaseBatchPass, WorkerGlobalState
from codedmap.utils.path_utils import normalize_path

logger = logging.getLogger(__name__)


def _extract_function_name(full_name: str) -> str:
    if not full_name: return ""
    if ':' in full_name and '/' in full_name:
        return full_name.rsplit(':', 1)[-1]
    return full_name


# =============================================================================
# Key Prefixes (Refined)
# =============================================================================
PREFIX_FULL = "F:"  # Method Full Name (最强匹配)
PREFIX_STATIC_DEF = "SD:"  # [New] Global/Namespace Function (确定的 Static Dispatch)
PREFIX_MEMBER_DEF = "MD:"  # [New] Class Member Method (可能是 Dynamic Dispatch)


# =============================================================================
# Worker Logic
# =============================================================================

def call_linker_worker(task: AnalysisTask) -> BatchAnalysisResult:
    """
    [Worker] 处理 Call 节点链接。
    利用 Index 中的分类信息，更精准地设置 dispatchType。
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")

    try:
        disk_map = WorkerGlobalState.get_map()
        project_root = WorkerGlobalState.get_project_root()
        calls_batch = task.payload.get('calls', [])

        if not calls_batch: return result

        query_keys = []
        call_key_mapping = {}

        # 1. 生成查询 Keys
        for call in calls_batch:
            cid = call['id']
            keys_for_this_call = []

            raw_full_name = call.get('methodFullName') or call.get('method_full_name')
            raw_file = call.get('fileName') or call.get('file_name')
            name = call.get('name')

            # --- Priority 1: Full Name (Standard) ---
            if raw_full_name and raw_full_name != "ANY":
                clean_full_name = _extract_function_name(raw_full_name)
                k = f"{PREFIX_FULL}{clean_full_name}"
                keys_for_this_call.append(('FULL', k))
                query_keys.append(k)

                if name and name != clean_full_name:
                    k = f"{PREFIX_FULL}{name}"
                    keys_for_this_call.append(('FULL_SIMPLE', k))
                    query_keys.append(k)

            # --- Priority 2: File Scope + Name ---
            # [Fix] 这里生成的 Key 必须尝试匹配 SD (Static) 和 MD (Member) 两种可能性
            if raw_file and name:
                clean_file = normalize_path(raw_file, project_root=project_root, include_project_name=False)

                # 尝试 1: 它是一个全局静态函数吗？
                k_static = f"{PREFIX_STATIC_DEF}{clean_file}:{name}"
                keys_for_this_call.append(('STATIC_DEF', k_static))
                query_keys.append(k_static)

                # 尝试 2: 它是一个类成员方法吗？
                k_member = f"{PREFIX_MEMBER_DEF}{clean_file}:{name}"
                keys_for_this_call.append(('MEMBER_DEF', k_member))
                query_keys.append(k_member)

            call_key_mapping[cid] = keys_for_this_call

        # 2. 批量 IO
        found_map = disk_map.get_batch(query_keys)

        # 3. 匹配与属性更新
        metrics = {"linked_full": 0, "linked_static": 0, "linked_member": 0, "phantom": 0}

        for call in calls_batch:
            cid = call['id']
            target_id = None
            match_type = "NONE"

            # 按优先级尝试
            keys_list = call_key_mapping.get(cid, [])
            for k_type, key in keys_list:
                tid = found_map.get(key)
                if tid:
                    target_id = tid
                    match_type = k_type
                    break

            if target_id:
                result.new_edges.append((cid, target_id, EdgeType.CALL.value, None))

                # [Fix] 根据匹配到的类型，智能更新 dispatchType
                update_props = {}

                if match_type == 'STATIC_DEF':
                    # 明确链接到了一个 Global/Namespace 函数 -> 必定是 Static Dispatch
                    metrics["linked_static"] += 1
                    update_props["dispatchType"] = DispatchType.STATIC_DISPATCH.value

                elif match_type == 'MEMBER_DEF':
                    # 链接到了类成员 -> 可能是 Dynamic Dispatch
                    metrics["linked_member"] += 1
                    # 除非 Call 节点本身已经标记了 Static (例如 Base::func())，否则视为 Dynamic
                    if call.get('dispatchType') != DispatchType.STATIC_DISPATCH.value:
                        update_props["dispatchType"] = DispatchType.DYNAMIC_DISPATCH.value

                elif 'FULL' in match_type:
                    metrics["linked_full"] += 1
                    # Full Name 匹配通常比较准确，保留原有的 dispatchType 或不做假设

                if update_props:
                    result.node_updates.append((cid, update_props))
            else:
                metrics["phantom"] += 1

        result.metrics = metrics
        return result

    except Exception as e:
        return BatchAnalysisResult(task_id=task.task_id, status="FAILED", error=str(e))


# =============================================================================
# Pass Class
# =============================================================================

class CallGraphPass(BaseBatchPass):
    """
    [Enhanced] Call Graph 构建器。
    利用 astParentType 区分 Static vs Member 方法。
    """
    TASK_BATCH_SIZE = 10000

    def run(self):
        logger.info(f"=== [{self.name}] Starting Analysis (Scope Aware) ===")
        try:
            self.state_map = DiskMap(
                table_name="cg_index",
                key_type="TEXT",
                value_type="INTEGER",
                work_dir=str(self.work_dir),
                filename="call_graph.db"
            )
            self.state_map.__enter__()

            self._build_index()

            total_calls = self.store.query.all_nodes(NodeLabel.CALL.value).count()
            self.run_parallel(
                task_generator=self._generate_batched_tasks(),
                worker_handler=call_linker_worker,
                total_items=total_calls
            )
        finally:
            self.cleanup()

    def _build_index(self):
        logger.info(f"[{self.name}] Indexing methods...")
        # [Fix] 请求 astParentType 字段
        fields = ["id", "name", "fullName", "fileName", "astParentType"]

        source_iter = self.iter_nodes(NodeLabel.METHOD.value, fields)
        project_root = self.project_root

        def key_generator():
            count = 0
            for node in source_iter:
                nid = node['id']
                raw_full_name = node.get('fullName') or node.get('full_name')
                name = node.get('name')
                parent_type = node.get('astParentType')

                # 1. Full Name Index (Standard)
                if raw_full_name and raw_full_name != "ANY":
                    clean = _extract_function_name(raw_full_name)
                    yield f"{PREFIX_FULL}{clean}", nid
                    if name and name != clean:
                        yield f"{PREFIX_FULL}{name}", nid

                # 2. Local Index (Scope Aware)
                raw_file = node.get('fileName') or node.get('file_name')
                if raw_file and name:
                    clean_file = normalize_path(raw_file, project_root=project_root, include_project_name=False)

                    # [Logic] 根据 Parent Type 决定存入哪个 Prefix
                    # 如果 Parent 是 Class (TYPE_DECL)，它是成员方法
                    if parent_type == NodeLabel.TYPE_DECL.value:
                        yield f"{PREFIX_MEMBER_DEF}{clean_file}:{name}", nid

                    # 如果 Parent 是 Namespace/File，它是全局静态函数
                    # 注意：C++ 中方法定义在 .cpp 文件顶层时，Parent 可能是 TranslationUnit
                    elif parent_type in [NodeLabel.NAMESPACE_BLOCK.value, "TRANSLATION_UNIT", "FILE"]:
                        yield f"{PREFIX_STATIC_DEF}{clean_file}:{name}", nid

                    # 兜底：如果不确定，也可以存一份 STATIC (或者不做假设，避免污染)
                    # 这里为了最大兼容性，如果不明确是 TYPE_DECL，默认视为普通函数
                    else:
                        yield f"{PREFIX_STATIC_DEF}{clean_file}:{name}", nid

                count += 1
                if count % 200000 == 0: self._log_mem(f"Indexed {count}")

        self.state_map.bulk_set(key_generator())

    def _generate_batched_tasks(self, batch_size=5000) -> Iterator[AnalysisTask]:
        # [Fix] 请求 dispatchType，以便 Worker 做决策
        fields = ["id", "name", "methodFullName", "fileName", "dispatchType"]
        current_batch = []
        task_seq = 0

        for call in self.iter_nodes(NodeLabel.CALL.value, fields):
            if not call.get('name') or call['name'].startswith("<operator>"):
                continue

            current_batch.append(call)
            if len(current_batch) >= batch_size:
                yield AnalysisTask(
                    task_id=str(task_seq),
                    pass_name=self.name,
                    target_node_id=0,
                    target_label="BATCH",
                    payload={"calls": current_batch}
                )
                current_batch = []
                task_seq += 1

        if current_batch:
            yield AnalysisTask(
                task_id=str(task_seq),
                pass_name=self.name,
                target_node_id=0,
                target_label="BATCH",
                payload={"calls": current_batch}
            )