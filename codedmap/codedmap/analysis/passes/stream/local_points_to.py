# codedmap/analysis/passes/stream/local_points_to.py

import logging
import time
from typing import List, Optional, Tuple, Set, Dict, Any

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.analysis.passes.analysis_data import PtsConstraint, ConstraintType
# 注意：这里引用的是你刚刚修复过的 disk_map
from codedmap.infra.utils.disk_map import DiskMap, DiskSet
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    CallNode, IdentifierNode, LiteralNode, BlockNode
)
from codedmap.core.schema.graph.operators import Operators

logger = logging.getLogger(__name__)


class LocalPointsToPass(StreamPass):
    """
    [Phase 2 Fix] Local Points-To Constraint Generator
    修复点:
    1. 补全 Linux Kernel / Glib 等常用内存分配函数。
    2. 支持 *x = &y 和 *x = malloc 等复杂左值/右值组合。
    3. 引入 Phantom Temporary 处理 STORE_ADDR。
    """

    def __init__(self, config=None):
        super().__init__(config)

        # [Fix 1] 完整的 Allocator 列表 (Source of Truth)
        # 将来建议移至 codedmap.core.configs.common
        self._allocator_names = {
            # C Standard
            "malloc", "calloc", "realloc", "strdup", "strndup", "memalign", "posix_memalign",
            "alloca", "__builtin_alloca",
            # GLib (QEMU/Gnome)
            "g_malloc", "g_malloc0", "g_realloc", "g_try_malloc", "g_try_malloc0",
            "g_new", "g_new0", "g_memdup", "g_slice_alloc", "g_slice_alloc0",
            # Linux Kernel (Core)
            "kmalloc", "kzalloc", "vmalloc", "kcalloc", "kvmalloc", "kvzalloc",
            "kmem_cache_alloc", "kmem_cache_zalloc", "kmem_cache_alloc_node",
            "__kmalloc", "__vmalloc",
            # Linux Kernel (Device Managed)
            "devm_kzalloc", "devm_kmalloc", "devm_kcalloc", "devm_vmalloc",
            # C++
            "new", "operator new", "<operator>.new", "<operator>.new[]"
        }

        self._init_disk_state()

    def _init_disk_state(self):
        """初始化 DiskMap"""
        # 确保 work_dir 存在
        if not self.work_dir.exists():
            self.work_dir.mkdir(parents=True, exist_ok=True)

        self._dm_pts = DiskMap(table_name="pts_graph", value_type="INTEGER", filename="pts.db",
                               work_dir=str(self.work_dir))
        self.pts = DiskSet(self._dm_pts)

        self._dm_copy = DiskMap(table_name="copy_graph", value_type="INTEGER", filename="copy.db",
                                work_dir=str(self.work_dir))
        self.copy_edges = DiskSet(self._dm_copy)

        self._dm_load = DiskMap(table_name="load_cons", value_type="INTEGER", filename="load.db",
                                work_dir=str(self.work_dir))
        self.load_constraints = DiskSet(self._dm_load)

        self._dm_store = DiskMap(table_name="store_cons", value_type="INTEGER", filename="store.db",
                                 work_dir=str(self.work_dir))
        self.store_constraints = DiskSet(self._dm_store)

    def __del__(self):
        self._cleanup_disk_state()

    def _cleanup_disk_state(self):
        for attr in ['_dm_pts', '_dm_copy', '_dm_load', '_dm_store']:
            if hasattr(self, attr):
                db = getattr(self, attr)
                if db: db.close()

    def analyze(self, graph: CPGGraph):
        start_time = time.time()
        stats = {"scanned": 0, "generated": 0, "allocs": 0, "phantoms": 0, "failed": 0, "errors": 0}

        calls = [n for n in graph.nodes.values() if isinstance(n, CallNode)]
        if not calls: return

        # 使用 Batch Context (利用 disk_map 的 Atomic Write 特性)
        with self.pts.batch_update() as pts_w, \
                self.copy_edges.batch_update() as copy_w, \
                self.load_constraints.batch_update() as load_w, \
                self.store_constraints.batch_update() as store_w:

            for call in calls:
                try:
                    # 仅处理赋值操作
                    if call.name != Operators.assignment: continue

                    stats["scanned"] += 1
                    generated = self._process_assignment(call, graph)

                    if generated:
                        stats["generated"] += len(generated)
                        for c in generated:
                            self._ingest_constraint(c, pts_w, copy_w, load_w, store_w)

                            ctype = c.type.value if hasattr(c.type, 'value') else c.type
                            if ctype == ConstraintType.ADDR_OF: stats["allocs"] += 1
                            if c.src_id < 0 or c.dst_id < 0: stats["phantoms"] += 1  # 统计幻影变量
                    else:
                        stats["failed"] += 1

                except Exception as e:
                    stats["errors"] += 1
                    if stats["errors"] <= 3:
                        logger.error(f"Error processing call {call.id}: {e}", exc_info=True)

        duration = time.time() - start_time
        # Log summary (Reduced noise)
        if stats["generated"] > 0:
            logger.info(
                f"[LocalPTS] {duration:.3f}s | "
                f"Gen: {stats['generated']} (Allocs: {stats['allocs']}, Phantoms: {stats['phantoms']})"
            )

    def _ingest_constraint(self, c: PtsConstraint, pts_w, copy_w, load_w, store_w):
        """
        分发约束写入。
        """
        ctype = c.type.value if hasattr(c.type, 'value') else c.type
        src, dst = c.src_id, c.dst_id

        if ctype == ConstraintType.ADDR_OF:
            pts_w.add(dst, src)
        elif ctype == ConstraintType.COPY:
            copy_w.add(src, dst)
        elif ctype == ConstraintType.LOAD:
            load_w.add(src, dst)
        elif ctype == ConstraintType.STORE:
            store_w.add(dst, src)

    # =========================================================================
    # Logic: Assignment Processing (Enhanced)
    # =========================================================================

    def _process_assignment(self, assignment: CallNode, graph: CPGGraph) -> List[PtsConstraint]:
        lhs_expr, rhs_expr = self._get_assignment_operands(assignment, graph)
        if not lhs_expr or not rhs_expr:
            return []

        # Analyze RHS
        # rhs_type: COPY | ADDR_OF | LOAD
        # rhs_id:   VariableID | AllocatorID/GlobalID | PointerID
        rhs_type, rhs_id, rhs_offset = self._analyze_rhs(rhs_expr, graph)
        if rhs_id is None:
            return []

        # Analyze LHS
        # lhs_is_direct: True (x = ...) | False (*x = ...)
        lhs_is_direct, lhs_id, lhs_offset = self._analyze_lhs(lhs_expr, graph)
        if lhs_id is None:
            return []

        constraints = []

        # Case 1: x = ... (Direct LHS)
        if lhs_is_direct:
            # 简单的 COPY, ADDR_OF, 或 LOAD 都可以直接接在 x 后面
            # x = y      -> COPY(src=y, dst=x)
            # x = &y     -> ADDR_OF(src=y, dst=x)
            # x = malloc -> ADDR_OF(src=malloc_obj, dst=x)
            # x = *y     -> LOAD(src=y, dst=x)
            constraints.append(PtsConstraint(
                type=rhs_type,
                src_id=rhs_id,
                dst_id=lhs_id,
                field_offset=rhs_offset
            ))

        # Case 2: *x = ... (Indirect LHS / Store)
        else:
            # lhs_id 是指针变量 x 的 ID

            if rhs_type == ConstraintType.COPY:
                # *x = y -> STORE(dst=x, src=y)
                constraints.append(PtsConstraint(
                    type=ConstraintType.STORE,
                    src_id=rhs_id,
                    dst_id=lhs_id,
                    field_offset=lhs_offset
                ))

            elif rhs_type == ConstraintType.LOAD:
                # *x = *y
                # 降级为: temp = *y (LOAD), *x = temp (STORE)
                phantom = self._get_phantom_id(assignment.id)

                # 1. temp = *y
                constraints.append(PtsConstraint(
                    type=ConstraintType.LOAD,
                    src_id=rhs_id,  # y
                    dst_id=phantom  # temp
                ))
                # 2. *x = temp
                constraints.append(PtsConstraint(
                    type=ConstraintType.STORE,
                    src_id=phantom,  # temp
                    dst_id=lhs_id  # x
                ))

            elif rhs_type == ConstraintType.ADDR_OF:
                # [Fix] *x = &y  OR  *x = malloc()
                # 降级为: temp = &y (ADDR_OF), *x = temp (STORE)
                phantom = self._get_phantom_id(assignment.id)

                # 1. temp = &y
                constraints.append(PtsConstraint(
                    type=ConstraintType.ADDR_OF,
                    src_id=rhs_id,
                    dst_id=phantom
                ))
                # 2. *x = temp
                constraints.append(PtsConstraint(
                    type=ConstraintType.STORE,
                    src_id=phantom,
                    dst_id=lhs_id
                ))

        return constraints

    def _get_phantom_id(self, seed_id: int) -> int:
        """
        生成一个确定的负数 ID 作为幻影临时变量。
        使用负数是为了避免与 Neo4j 生成的正整数 ID 冲突。
        """
        # 确保不为0，且足够分散
        # 假设 seed_id (call_id) 是唯一的
        return -1 * abs(seed_id)

    # =========================================================================
    # Logic: Expression Analysis (Improved)
    # =========================================================================

    def _analyze_rhs(self, expr: AnyNode, graph: CPGGraph) -> Tuple[ConstraintType, Optional[int], int]:
        node = self._unwrap_expression(expr, graph)
        if not node: return (ConstraintType.COPY, None, 0)

        if isinstance(node, LiteralNode):
            # Literal (e.g. 0, 1) usually means NULL or integer constant. Ignored in PTS.
            return (ConstraintType.COPY, None, 0)

        if isinstance(node, IdentifierNode):
            if node.name in ("NULL", "nullptr"): return (ConstraintType.COPY, None, 0)
            resolved_id = self._resolve_local_ref(node, graph)
            return (ConstraintType.COPY, resolved_id, 0)

        if isinstance(node, CallNode):
            name = node.name

            # --- Allocators ---
            if self._is_allocator(name):
                # malloc() 返回一个新的 Abstract Object，我们用 Call Node ID 代表该 Object
                return (ConstraintType.ADDR_OF, node.id, 0)

            # --- Address Of (&x) ---
            if name == Operators.addressOf:
                op = self._get_unary_operand(node, graph)
                base = self._unwrap_expression(op, graph)
                if isinstance(base, IdentifierNode):
                    resolved_id = self._resolve_local_ref(base, graph)
                    return (ConstraintType.ADDR_OF, resolved_id, 0)
                # &(*p) -> p (COPY)
                # &array[i] -> GEP (ignored for now, treated as COPY array base?)
                return (ConstraintType.COPY, None, 0)

            # --- Indirection (*x) ---
            if name == Operators.indirection:
                op = self._get_unary_operand(node, graph)
                ptr = self._unwrap_expression(op, graph)
                if ptr:
                    ptr_id = ptr.id
                    if isinstance(ptr, IdentifierNode):
                        ptr_id = self._resolve_local_ref(ptr, graph)
                    return (ConstraintType.LOAD, ptr_id, 0)

            # --- Field / Index Access (x->f, x[i]) ---
            # 简化策略: 视为 Load (*x)
            if name in (Operators.indirectFieldAccess, Operators.fieldAccess):
                base, _ = self._get_field_access_parts(node, graph)
                if base:
                    base_id = base.id
                    if isinstance(base, IdentifierNode):
                        base_id = self._resolve_local_ref(base, graph)
                    # p->f is equivalent to *(p + offset), so it's a LOAD from p
                    return (ConstraintType.LOAD, base_id, 0)

            if name in (Operators.indexAccess, Operators.indirectIndexAccess):
                base = self._get_index_base(node, graph)
                if base:
                    base_id = base.id
                    if isinstance(base, IdentifierNode):
                        base_id = self._resolve_local_ref(base, graph)
                    return (ConstraintType.LOAD, base_id, 0)

            # --- Generic Call (Return Value) ---
            # x = foo() -> COPY(src=foo_ret, dst=x)
            # 在 Local 阶段，我们假设 call node id 本身代表返回值流出的地方
            # Global Solver 会处理 Return -> Call 的连接
            return (ConstraintType.COPY, node.id, 0)

        return (ConstraintType.COPY, None, 0)

    def _analyze_lhs(self, expr: AnyNode, graph: CPGGraph) -> Tuple[bool, Optional[int], int]:
        """
        Returns: (is_direct_write, target_id, offset)
        """
        node = self._unwrap_expression(expr, graph)
        if not node: return (True, None, 0)

        if isinstance(node, IdentifierNode):
            resolved_id = self._resolve_local_ref(node, graph)
            return (True, resolved_id, 0)

        if isinstance(node, CallNode):
            name = node.name

            target_node = None
            if name == Operators.indirection:
                op = self._get_unary_operand(node, graph)
                target_node = self._unwrap_expression(op, graph)

            elif name in (Operators.indirectFieldAccess, Operators.fieldAccess):
                target_node, _ = self._get_field_access_parts(node, graph)

            elif name == Operators.indexAccess:
                target_node = self._get_index_base(node, graph)

            if target_node:
                target_id = target_node.id
                if isinstance(target_node, IdentifierNode):
                    target_id = self._resolve_local_ref(target_node, graph)
                # Indirect write: *target_id = ...
                return (False, target_id, 0)

        return (True, None, 0)

    # =========================================================================
    # Helpers (Keep existing logic)
    # =========================================================================

    def _resolve_local_ref(self, node: AnyNode, graph: CPGGraph) -> int:
        # [Optimization] Direct REF lookup
        ref_edges = graph.get_out_edges(node.id, edge_type=EdgeType.REF)
        if ref_edges:
            return ref_edges[0].dst
        return node.id

    def _get_assignment_operands(self, call: CallNode, graph: CPGGraph) -> Tuple[Optional[AnyNode], Optional[AnyNode]]:
        candidates = graph.get_ast_children(call)
        if not candidates: return None, None

        def sort_key(n):
            idx = getattr(n, 'argument_index', -1)
            order = getattr(n, 'order', 9999)
            if idx is not None and idx != -1: return (0, idx)
            return (1, order)

        sorted_nodes = sorted(candidates, key=sort_key)
        if len(sorted_nodes) < 2: return None, None
        return sorted_nodes[0], sorted_nodes[1]

    def _is_allocator(self, name: str) -> bool:
        if name in self._allocator_names: return True
        if '<' in name or 'new' in name:
            return any(alloc in name for alloc in self._allocator_names)
        return False

    def _unwrap_expression(self, node: AnyNode, graph: CPGGraph) -> Optional[AnyNode]:
        if not node: return None
        curr = node
        visited = set()
        while curr and curr.id not in visited:
            visited.add(curr.id)
            if isinstance(curr, BlockNode):
                children = graph.get_ast_children(curr)
                if children:
                    curr = children[-1]
                    continue
                else:
                    return None
            if isinstance(curr, CallNode):
                if curr.name in (Operators.cast, "<operator>.cast", "CSTYLE_CAST_EXPR", "PAREN_EXPR"):
                    children = graph.get_ast_children(curr)
                    if children:
                        curr = children[-1]
                        continue
            break
        return curr

    def _get_unary_operand(self, call: CallNode, graph: CPGGraph) -> Optional[AnyNode]:
        children = graph.get_ast_children(call)
        return children[0] if children else None

    def _get_field_access_parts(self, call: CallNode, graph: CPGGraph) -> Tuple[Optional[AnyNode], Optional[str]]:
        children = graph.get_ast_children(call)
        if len(children) >= 2:
            base = self._unwrap_expression(children[0], graph)
            field_node = children[1]
            name = getattr(field_node, 'name', None) or getattr(field_node, 'code', None)
            return base, name
        return None, None

    def _get_index_base(self, call: CallNode, graph: CPGGraph) -> Optional[AnyNode]:
        children = graph.get_ast_children(call)
        if children:
            return self._unwrap_expression(children[0], graph)
        return None