import logging
import os
import time
from typing import Dict, List, Tuple, Any, Iterator, Set

# Schema & Enums
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.infra.executor.messages.analysis import AnalysisTask, BatchAnalysisResult

# Base & Utils
from codedmap.analysis.passes.base_batch import BaseBatchPass, WorkerGlobalState
from codedmap.infra.utils.disk_map import DiskMap
from codedmap.utils.path_utils import normalize_path

logger = logging.getLogger(__name__)

# =============================================================================
# Constants & Helpers
# =============================================================================

PREFIX_GLOBAL = "G:"
PREFIX_STATIC = "S:"
HEADER_EXTENSIONS = {'.h', '.hpp', '.hh', '.hxx', '.h++', '.inc', '.def'}


def is_header_file(filename: str) -> bool:
    if not filename: return False
    _, ext = os.path.splitext(filename)
    return ext.lower() in HEADER_EXTENSIONS


# =============================================================================
# Worker Logic
# =============================================================================

def global_ref_worker(task: AnalysisTask) -> BatchAnalysisResult:
    """
    [Worker Process] 批量符号解析。

    Payload: {'identifiers': [{'id': 1, 'name': 'foo', 'file_name': 'a.c'}, ...]}
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")

    # 1. 获取本地 DiskMap (零拷贝)
    disk_map = WorkerGlobalState.get_map()
    project_root = WorkerGlobalState.get_project_root()

    identifiers = task.payload.get('identifiers', [])
    if not identifiers:
        return result

    # 2. 准备批量查询 Keys
    # 我们需要为每个 Identifier 生成 2 个候选 Key:
    # 1. Static (S:filename:name) - 优先级高
    # 2. Global (G:name)          - 优先级低

    query_keys = set()
    for node in identifiers:
        name = node.get('name')
        if not name: continue

        # Candidate: Global
        query_keys.add(f"{PREFIX_GLOBAL}{name}")

        # Candidate: Static
        file_name = node.get('file_name')
        if file_name:
            query_keys.add(f"{PREFIX_STATIC}{file_name}:{name}")

    if not query_keys:
        return result

    # 3. 执行批量 IO (耗时点)
    # result_map: { 'G:foo': 101, 'S:a.c:bar': 102 }
    found_map = disk_map.get_batch(list(query_keys))

    # 4. 内存匹配与连边
    stats = {"linked_static": 0, "linked_global": 0, "failed": 0}

    for node in identifiers:
        name = node.get('name')
        if not name: continue

        target_id = None
        link_type = "NONE"

        # Strategy 1: Static Match (优先)
        raw_file_name = node.get('fileName') or node.get('file_name')
        if raw_file_name:
            rel_file_name = normalize_path(
                raw_file_name,
                project_root=project_root,
                include_project_name=False
            )
            static_key = f"{PREFIX_STATIC}{rel_file_name}:{name}"
            if static_key in found_map:
                target_id = found_map[static_key]
                link_type = "STATIC"

        # Strategy 2: Global Match (备选)
        if not target_id:
            global_key = f"{PREFIX_GLOBAL}{name}"
            if global_key in found_map:
                target_id = found_map[global_key]
                link_type = "GLOBAL"

        # Action
        if target_id:
            # 添加边 REF: (Identifier) -> (TypeDecl/Member)
            result.new_edges.append((node['id'], target_id, EdgeType.REF.value, None))

            if link_type == "STATIC":
                stats["linked_static"] += 1
            else:
                stats["linked_global"] += 1
        else:
            stats["failed"] += 1

    result.metrics = stats
    return result


# =============================================================================
# Main Pass
# =============================================================================

class GlobalRefPass(BaseBatchPass):
    """
    [Industrial Grade] 全局引用解析 Pass (CQRS Architecture).

    Features:
    - OOM-Free Indexing: 使用 DiskMap 存储千万级符号表 (Global + Static)。
    - Smart Filtering: 仅处理尚未链接的 Identifier。
    - Parallel Resolution: 多进程分块解析。
    """

    BATCH_SIZE = 5000

    def run(self):
        logger.info(f"=== [{self.name}] Starting Analysis ===")

        try:
            # 初始化 DiskMap
            self.state_map = DiskMap(table_name="gref_index", key_type="TEXT", value_type="INTEGER", work_dir=self.work_dir,
                                     filename="global_ref.db")
            self.state_map.__enter__()

            # --- Phase 1: Symbol Indexing (Build Dictionary on Disk) ---
            # 构建一个支持 Global 和 Static 查找的混合索引
            self._build_symbol_index()

            # --- Phase 2: Parallel Resolution ---
            # 统计待处理数量 (可选，为了日志好看)
            # count() 可能比较慢，视具体 Storage 实现而定，这里仅做估算或跳过
            total_items = 0

            self.run_parallel(
                task_generator=self._generate_tasks(),
                worker_handler=global_ref_worker,
                total_items=total_items
            )

        finally:
            self.cleanup()

    # =========================================================================
    # Phase 1: Indexing
    # =========================================================================

    def _build_symbol_index(self):
        """
        遍历所有 MEMBER 和 TYPE_DECL，构建符号表索引。
        """
        logger.info(f"[{self.name}] Phase 1: Indexing symbols to disk...")

        # 需要索引的节点类型
        target_labels = [NodeLabel.MEMBER.value, NodeLabel.TYPE_DECL.value]

        # 1. 生成器：遍历节点并生成 Key-Value 对
        def key_generator():
            count = 0

            # 我们需要 file_name 来区分 static; astParentType 用于过滤无效 Member
            fields = ["id", "name", "label", "file_name", "astParentType", "is_static"]

            for label in target_labels:
                # 使用基类 iter_nodes 保证投影查询
                source_iter = self.iter_nodes(label, fields)

                for node in source_iter:
                    name = node.get('name')
                    if not name: continue

                    # [Filter] 结构体字段过滤 (Member 必须属于 Namespace/File 等顶层作用域)
                    if node['label'] == NodeLabel.MEMBER.value:
                        parent_type = node.get("astParentType", "")
                        if parent_type not in ["NAMESPACE_BLOCK", "TRANSLATION_UNIT", "FILE"]:
                            continue

                    nid = node['id']
                    raw_file_name = node.get('fileName') or node.get('file_name')
                    rel_file_name = normalize_path(
                        raw_file_name,
                        project_root=self.project_root,
                        include_project_name=False
                    )

                    # [Strategy] Header Promotion Logic
                    # 如果是在头文件中，通常视为全局可见
                    is_in_header = is_header_file(rel_file_name)
                    is_type_decl = (node['label'] == NodeLabel.TYPE_DECL.value)

                    # 判定是否为严格的 Local Static (仅当前文件可见)
                    # C语言中: static 变量/函数不在头文件中 -> 文件作用域
                    is_static = node.get('is_static', False)
                    is_strict_local = (is_static and rel_file_name and not is_in_header and not is_type_decl)

                    if is_strict_local:
                        # Index as Static: "S:filename:name" -> ID
                        yield f"{PREFIX_STATIC}{rel_file_name}:{name}", nid
                    else:
                        # Index as Global: "G:name" -> ID
                        yield f"{PREFIX_GLOBAL}{name}", nid

                    count += 1
                    if count % 100000 == 0:
                        logger.info(f"  Indexed {count} symbols...")

        # 2. 批量写入磁盘
        start = time.time()
        self.state_map.bulk_set(key_generator())
        logger.info(f"[{self.name}] Indexing completed in {time.time() - start:.2f}s")
        self._log_mem("After Indexing")

    # =========================================================================
    # Phase 2: Task Generation
    # =========================================================================

    def _generate_tasks(self) -> Iterator[AnalysisTask]:
        """
        生成解析任务。
        优化：只查找【没有 REF 出边】的 Identifier。
        """

        # 使用 Storage DSL 进行过滤，减少数据传输
        query = self.store.query.all_nodes(NodeLabel.IDENTIFIER.value) \
            .where_no_out_edge(EdgeType.REF.value) \
            .values("id", "name", "fileName")

        current_batch = []
        task_seq = 0

        for node in query:
            # 基本校验
            if not node.get('name'): continue

            current_batch.append(node)

            if len(current_batch) >= self.BATCH_SIZE:
                yield AnalysisTask(
                    task_id=str(task_seq),
                    pass_name=self.name,
                    target_node_id=0,
                    target_label="IDENTIFIER",
                    payload={"identifiers": current_batch}
                )
                current_batch = []
                task_seq += 1

        if current_batch:
            yield AnalysisTask(
                task_id=str(task_seq),
                pass_name=self.name,
                target_node_id=0,
                target_label="IDENTIFIER",
                payload={"identifiers": current_batch}
            )
