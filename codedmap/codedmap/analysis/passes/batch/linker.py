# codedmap/analysis/passes/batch/linker.py

import logging
import time
import json
import traceback
from collections import defaultdict
from typing import Dict, List, Any, Tuple, Iterator, Optional

# CPG Schema
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.infra.executor.messages.base import BaseTask
from codedmap.infra.executor.messages.analysis import BatchAnalysisResult, AnalysisTask

# Base Framework
from codedmap.analysis.passes.base_batch import BaseBatchPass, WorkerGlobalState
# 适配新的 DiskMap 导入
from codedmap.infra.utils.disk_map import DiskMap
from codedmap.utils.path_utils import normalize_path

logger = logging.getLogger(__name__)

# =============================================================================
# Constants & Prefixes
# =============================================================================

PREFIX_USR = "U:"  # Unified Symbol Resolution
PREFIX_ALIAS = "A:"  # Macro Alias
PREFIX_MANGLED = "M:"  # C++ Mangled
PREFIX_GLOBAL = "G:"  # Global Variable / Function / Type
PREFIX_STATIC = "S:"  # File-Scope Static

HEADER_EXTENSIONS = {'.h', '.hpp', '.hh', '.hxx', '.h++', '.inc', '.def'}


def is_header_file(filename: str) -> bool:
    if not filename: return False
    return any(filename.endswith(ext) for ext in HEADER_EXTENSIONS)


# =============================================================================
# 1. Worker Logic
# =============================================================================

def linker_worker(task: AnalysisTask) -> BatchAnalysisResult:
    """
    [Worker] 执行引用解析。
    修复点:
    1. 允许 CALL 节点进入 Global/Static 匹配逻辑 (修复 malloc 等普通函数无法链接的问题)。
    2. 适配新的 DiskMap 接口 (Key 自动转 str)。
    """
    result = BatchAnalysisResult(task_id=task.task_id, status="SUCCESS")

    try:
        disk_map = WorkerGlobalState.get_map()
        project_root = WorkerGlobalState.get_project_root()

        batch_nodes = task.payload.get("nodes", [])
        if not batch_nodes:
            return result

        raw_edges = []
        node_updates = []  # [New] 支持节点属性更新
        stats = defaultdict(int)

        for node in batch_nodes:
            nid = node['id']
            label = node['label']
            name = node.get("name") or ""  # [Fix] Ensure name is never None

            target_id = None
            match_method = "NONE"
            edge_type = EdgeType.REF.value  # Default

            if label == NodeLabel.CALL.value:
                edge_type = EdgeType.CALL.value
            elif label == NodeLabel.TYPE_DECL.value:
                edge_type = EdgeType.INHERITS_FROM.value

            # -----------------------------------------------------------------
            # Strategy 1: USR (High Precision)
            # -----------------------------------------------------------------
            ref_usr = node.get("ref_usr")
            if ref_usr:
                usr_key = f"{PREFIX_USR}{ref_usr}"
                target_id = disk_map.get(usr_key)
                if target_id: match_method = "USR"

            # -----------------------------------------------------------------
            # Strategy 2: Alias/Mangled (Only for CALL)
            # -----------------------------------------------------------------
            if target_id is None and label == NodeLabel.CALL.value:
                # 2.1 Mangled
                mangled = node.get("mangledName") or node.get("mangled_name")
                if mangled:
                    m_key = f"{PREFIX_MANGLED}{mangled}"
                    target_id = disk_map.get(m_key)
                    if target_id: match_method = "MANGLED"

                # 2.2 Alias
                if target_id is None:
                    alias_list = node.get("aliasNames", [])
                    if isinstance(alias_list, str):
                        try:
                            alias_list = json.loads(alias_list)
                        except:
                            alias_list = [alias_list]

                    if alias_list:
                        for alias in alias_list:
                            a_key = f"{PREFIX_ALIAS}{alias}"
                            target_id = disk_map.get(a_key)
                            if target_id:
                                match_method = "ALIAS"
                                break

                # 2.3 Alias Fallback (Name match)
                if target_id is None and name:
                    a_key = f"{PREFIX_ALIAS}{name}"
                    target_id = disk_map.get(a_key)
                    if target_id: match_method = "ALIAS_NAME"

            # -----------------------------------------------------------------
            # Strategy 3: Static/Global
            # [Fix] 之前只允许 IDENTIFIER/TYPE_REF，导致普通 CALL (如 malloc) 被忽略
            # -----------------------------------------------------------------
            # 允许: IDENTIFIER (变量), TYPE_REF (类型), CALL (函数)
            allowed_labels = [NodeLabel.IDENTIFIER.value, NodeLabel.TYPE_REF.value, NodeLabel.CALL.value]

            if target_id is None and label in allowed_labels and name:

                # 3.1 Try Static (File Scope) - 解决 Shadowing
                raw_file = node.get("fileName") or node.get("file_name")
                if raw_file:
                    rel_file = normalize_path(raw_file, project_root=project_root, include_project_name=False)
                    s_key = f"{PREFIX_STATIC}{rel_file}:{name}"
                    target_id = disk_map.get(s_key)
                    if target_id:
                        match_method = "STATIC"
                        # 如果是 CALL 链接到了 STATIC，通常意味着 Static Dispatch
                        if label == NodeLabel.CALL.value:
                            node_updates.append((nid, {"dispatchType": "STATIC_DISPATCH"}))

                # 3.2 Try Global (Last Resort)
                if target_id is None:
                    # 优先尝试 Full Name 匹配 (如果是 C++ 调用，TypeRef 通常有 fullName)
                    type_full_name = node.get("typeFullName")
                    if type_full_name and "::" in type_full_name:
                        g_key = f"{PREFIX_GLOBAL}{type_full_name}"
                        target_id = disk_map.get(g_key)

                    # Fallback to Name
                    if target_id is None:
                        g_key = f"{PREFIX_GLOBAL}{name}"
                        target_id = disk_map.get(g_key)
                        if target_id:
                            match_method = "GLOBAL"

            # -----------------------------------------------------------------
            # Record Result
            # -----------------------------------------------------------------
            if target_id:
                # [Fix] 确保 target_id 是 int (disk_map.get 可能会返回 tuple 或 string，视 driver 而定)
                # 新版 DiskMap 保证 value 是 int (如果存储时是 int)
                raw_edges.append((nid, target_id, edge_type, None))
                stats[edge_type] += 1
                stats[f"LINK_{match_method}"] += 1
            else:
                stats["MISSED"] += 1

        result.new_edges = raw_edges
        result.node_updates = node_updates
        result.metrics = stats
        return result

    except Exception as e:
        return BatchAnalysisResult(
            task_id=task.task_id,
            status="FAILED",
            error=f"{str(e)}\n{traceback.format_exc()}"
        )


# =============================================================================
# 2. Linker Pass
# =============================================================================

class LinkerPass(BaseBatchPass):
    """
    [All-in-One] 全局链接器。
    修复: 确保索引构建与查找逻辑一致，适配 DiskMap 并发。
    """
    BATCH_SIZE = 10000

    def run(self):
        logger.info(f"=== [{self.name}] Starting Analysis (Fix applied) ===")
        try:
            # 初始化 DiskMap (KV Mode)
            # 使用 KV 模式存储索引，Key=Symbol, Value=NodeID
            self.state_map = DiskMap(
                table_name="linker_index",
                key_type="TEXT",
                value_type="INTEGER",  # 显式指定
                work_dir=str(self.work_dir),  # Path -> str
                filename="linker.db"
            )
            # 显式 Enter 以保持连接打开
            self.state_map.__enter__()

            # 1. 构建磁盘索引
            self._build_disk_index()

            # 2. 并行链接
            total = self.store.query.all_nodes([NodeLabel.CALL, NodeLabel.IDENTIFIER, NodeLabel.TYPE_REF]).count() or 0

            self.run_parallel(
                task_generator=self._generate_streaming_tasks(),
                worker_handler=linker_worker,
                total_items=total
            )

        finally:
            self.cleanup()

    def _build_disk_index(self):
        logger.info(f"[{self.name}] Phase 1: Indexing definitions...")
        project_root = self.project_root

        def_labels = [
            NodeLabel.METHOD.value,
            NodeLabel.TYPE_DECL.value,
            NodeLabel.MEMBER.value,
            NodeLabel.LOCAL.value
        ]

        fields = [
            "id", "label", "name", "fullName",
            "usr",
            "aliasNames", "mangledName",
            "fileName", "file_name", "is_static", "astParentType"
        ]

        def key_generator():
            count = 0
            # [Fix] 显式定义哪些 Parent 类型意味着是 Top-Level (File Scope)
            TOP_LEVEL_PARENTS = {"NAMESPACE_BLOCK", "TRANSLATION_UNIT", "FILE"}

            for label in [NodeLabel.METHOD.value, NodeLabel.TYPE_DECL.value, NodeLabel.MEMBER.value,
                          NodeLabel.LOCAL.value]:
                for node in self.iter_nodes(label, fields):
                    nid = node['id']
                    name = node.get('name')
                    full_name = node.get('fullName')  # C++ Qualified Name
                    parent_type = node.get('astParentType')

                    # 1. USR (top-level field, not metadata dict)
                    usr = node.get('usr')
                    if usr:
                        yield f"{PREFIX_USR}{usr}", nid

                    # 2. Method specifics
                    if label == NodeLabel.METHOD.value:
                        # ... Alias / Mangled 逻辑 ...
                        mangled = node.get('mangledName') or node.get('mangled_name')
                        if mangled: yield f"{PREFIX_MANGLED}{mangled}", nid

                        # Alias 逻辑...
                        aliases = node.get('aliasNames')
                        if isinstance(aliases, str):
                            try:
                                aliases = json.loads(aliases)
                            except:
                                aliases = [aliases]
                        if aliases:
                            for alias in aliases: yield f"{PREFIX_ALIAS}{alias}", nid

                    # 3. Global / Static (增强版)
                    if name and name != "<empty>":
                        raw_file = node.get('fileName') or node.get('file_name')
                        rel_file = None
                        if raw_file:
                            rel_file = normalize_path(raw_file, project_root=project_root, include_project_name=False)

                        is_static_storage = node.get('is_static', False)
                        is_in_header = is_header_file(rel_file) if rel_file else False

                        # 区分 File-Scope Static 和 Function-Scope Static
                        # 只有当 Parent 是 Top-Level 时，LOCAL 才是真正的 File-Scope Static
                        is_true_file_scope = True
                        if label == NodeLabel.LOCAL.value:
                            # 如果 parent 不是 namespace/file，那它就是函数局部变量，跳过索引
                            if parent_type and parent_type not in TOP_LEVEL_PARENTS:
                                is_true_file_scope = False

                        # 索引生成
                        if is_static_storage and rel_file and not is_in_header and is_true_file_scope:
                            # S:file:name
                            yield f"{PREFIX_STATIC}{rel_file}:{name}", nid

                        # [Fix Logic] Global 索引增强
                        # 只有确实是全局可见的才索引
                        if (label != NodeLabel.LOCAL.value or is_static_storage) and is_true_file_scope:
                            # [Optimization] 优先使用 fullName (Namespace::Class) 防止冲突
                            # 如果没有 fullName (C语言常见)，退化为 name
                            key_name = full_name if full_name and "::" in full_name else name
                            yield f"{PREFIX_GLOBAL}{key_name}", nid

                            # 额外生成一个 Short Name 索引作为兜底 (Optional, 视情况而定)
                            if key_name != name:
                                yield f"{PREFIX_GLOBAL}{name}", nid

                    count += 1
                    if count % 1000000 == 0: self._log_mem(f"Indexing {count}")

        self.state_map.bulk_set(key_generator())

    def _generate_streaming_tasks(self) -> Iterator[AnalysisTask]:
        ref_labels = [
            NodeLabel.CALL.value,
            NodeLabel.IDENTIFIER.value,
            NodeLabel.TYPE_REF.value,
            NodeLabel.TYPE_DECL.value
        ]

        # [Optimization] 减少网络传输，只取需要的字段
        fetch_fields = [
            "id", "label", "name",
            "usr", "ref_usr",
            "fileName", "file_name",
            "mangledName", "aliasNames"
        ]

        current_batch = []
        task_seq = 0

        for label in ref_labels:
            logger.info(f"[{self.name}] Streaming tasks for {label}...")
            for node in self.iter_nodes(label, fetch_fields):
                # 跳过显然不需要链接的
                if label == NodeLabel.CALL.value and (node.get('name') or '').startswith("<operator>"):
                    continue

                current_batch.append(node)
                if len(current_batch) >= self.BATCH_SIZE:
                    yield AnalysisTask(
                        task_id=str(task_seq),
                        pass_name=self.name,
                        target_node_id=0,
                        target_label="BATCH",
                        payload={"nodes": current_batch}
                    )
                    current_batch = []
                    task_seq += 1

        if current_batch:
            yield AnalysisTask(
                task_id=str(task_seq),
                pass_name=self.name,
                target_node_id=0,
                target_label="BATCH",
                payload={"nodes": current_batch}
            )