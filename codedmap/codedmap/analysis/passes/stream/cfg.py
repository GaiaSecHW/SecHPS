# codedmap/analysis/passes/stream/cfg.py

import re
import time
import logging
from typing import List, Tuple, Optional, Dict, Set
from contextlib import contextmanager

from codedmap.analysis.passes.base_stream import StreamPass
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, ControlStructureNode, BlockNode,
    ReturnNode, CallNode, JumpTargetNode, AstNode
)
from codedmap.core.schema.graph.enums import EdgeType, ControlStructureType

logger = logging.getLogger(__name__)

_GOTO_LABEL_RE = re.compile(r'goto\s+(\w+)', re.IGNORECASE)


class LoopContext:
    """
    循环/Switch 上下文数据类。
    采用延迟绑定 (Back-patching) 模式，无需创建临时的 UnknownNode。
    """
    __slots__ = ('name', 'resolved_continue_target', 'continue_sources', 'break_exits')

    def __init__(self, name: str):
        self.name = name
        self.resolved_continue_target: Optional[AnyNode] = None
        self.continue_sources: List[AnyNode] = []
        self.break_exits: List[AnyNode] = []

    def __repr__(self):
        return f"<LoopCtx {self.name} resolved={bool(self.resolved_continue_target)} pending={len(self.continue_sources)}>"


class CFGPass(StreamPass):
    """
    控制流图 (CFG) 构建 Pass (Stream Architecture).
    """

    def analyze(self, graph: CPGGraph):
        start_time = time.time()
        methods = [n for n in graph.nodes.values() if isinstance(n, MethodNode)]

        stats = {
            "methods_processed": 0,
            "methods_skipped": 0,
            "edges_created": 0,
            "gotos_resolved": 0,
            "errors": 0
        }

        for method in methods:
            if getattr(method, 'is_stub', False):
                stats["methods_skipped"] += 1
                continue

            try:
                processor = CFGProcessor(method, graph)
                delta_stats = processor.process()

                stats["methods_processed"] += 1
                stats["edges_created"] += delta_stats["edges"]
                stats["gotos_resolved"] += delta_stats["gotos"]

            except Exception as e:
                stats["errors"] += 1
                logger.error(f"Error processing CFG for method '{method.name}': {e}", exc_info=True)

        duration = time.time() - start_time
        if stats["methods_processed"] > 0:
            logger.debug(
                f"[CFGPass] Processed {stats['methods_processed']} methods in {duration:.3f}s. "
                f"Edges: {stats['edges_created']}, GOTOs: {stats['gotos_resolved']}. "
                f"Errors: {stats['errors']}."
            )


class CFGProcessor:
    """
    [Internal Worker] 封装单次方法分析的状态和逻辑。
    """

    def __init__(self, method: MethodNode, graph: CPGGraph):
        self.method = method
        self.graph = graph

        self._curr_loop_stack: List[LoopContext] = []
        self._curr_method_return: Optional[MethodReturnNode] = None
        self._curr_method_name: str = method.name

        self._label_map: Dict[str, JumpTargetNode] = {}
        self._pending_gotos: List[Tuple[AnyNode, str]] = []
        self._visited: Set[int] = set()

        self._edges_count = 0

        self._dispatch_map: Dict[type, object] = {
            BlockNode: self.handle_BlockNode,
            ControlStructureNode: self._dispatch_control_structure,
            ReturnNode: self.handle_ReturnNode,
            CallNode: self.handle_CallNode,
            JumpTargetNode: self.handle_JumpTargetNode,
        }

        self._ctrl_dispatch_map = {
            ControlStructureType.IF: self.handle_if,
            ControlStructureType.WHILE: self.handle_while,
            ControlStructureType.DO: self.handle_do,
            ControlStructureType.FOR: self.handle_for,
            ControlStructureType.SWITCH: self.handle_switch,
            ControlStructureType.MATCH: self.handle_switch,
            ControlStructureType.BREAK: self.handle_jump,
            ControlStructureType.CONTINUE: self.handle_jump,
            ControlStructureType.GOTO: self.handle_jump,
            ControlStructureType.TRY: self.handle_try,
            ControlStructureType.THROW: self.handle_throw,
        }

    # =========================================================================
    # Tools & Helpers
    # =========================================================================

    @contextmanager
    def _loop_scope(self, name: str, pre_resolved_target: Optional[AnyNode] = None):
        ctx = LoopContext(name)
        ctx.resolved_continue_target = pre_resolved_target
        self._curr_loop_stack.append(ctx)
        try:
            yield ctx
        finally:
            self._curr_loop_stack.pop()

    def _add_cfg_edge(self, src: AnyNode, dst: AnyNode, label: Optional[str] = None):
        if src is None:
            logger.warning(f"[{self._curr_method_name}] Ignored CFG edge with NONE Source -> Dst: {dst}")
            return

        if dst is None:
            src_code = getattr(src, 'code', '<no_code>')
            src_line = getattr(src, 'line_number', -1)
            logger.warning(
                f"[{self._curr_method_name}] Ignored CFG edge with NONE Dst. "
                f"Src: {src.label}({src.id}) at line {src_line} [{src_code}]")
            return

        self.graph.add_cfg_edge(src, dst, label=label)
        self._edges_count += 1

    @staticmethod
    def _build_order_map(children: List[AnyNode]) -> Dict[int, AnyNode]:
        return {getattr(c, 'order', 0) or 0: c for c in children}

    # =========================================================================
    # Core Logic
    # =========================================================================

    def process(self) -> Dict[str, int]:
        children = self.graph.get_ast_children(self.method)
        self._curr_method_return = next((c for c in children if isinstance(c, MethodReturnNode)), None)
        body = next((c for c in children if isinstance(c, BlockNode)), None)

        if not self._curr_method_return:
            return {"edges": 0, "gotos": 0}

        if not body:
            self._add_cfg_edge(self.method, self._curr_method_return)
            return {"edges": 1, "gotos": 0}

        entry, exits = self.visit(body)

        self._add_cfg_edge(self.method, entry)

        for exit_node in exits:
            self._add_cfg_edge(exit_node, self._curr_method_return)

        resolved_gotos = 0
        for goto_node, label_name in self._pending_gotos:
            target = self._label_map.get(label_name)
            if target:
                self._add_cfg_edge(goto_node, target, label="GOTO")
                resolved_gotos += 1
            else:
                logger.warning(f"[{self._curr_method_name}] Unresolved GOTO target: '{label_name}'")

        return {
            "edges": self._edges_count,
            "gotos": resolved_gotos
        }

    def visit(self, node: AnyNode) -> Tuple[AnyNode, List[AnyNode]]:
        if not node:
            return None, []

        if node.id in self._visited:
            return node, []

        self._visited.add(node.id)

        handler = self._dispatch_map.get(type(node))
        if handler:
            return handler(node)

        return node, [node]

    # =========================================================================
    # Handlers
    # =========================================================================

    def handle_BlockNode(self, node: BlockNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]

        valid_sequence = []
        for child in children:
            entry, exits = self.visit(child)
            if entry:
                valid_sequence.append((entry, exits))
            else:
                child_type = getattr(child, 'control_structure_type', child.label)
                logger.warning(
                    f"[{self._curr_method_name}] Block child visited to None! "
                    f"Type: {child_type}, ID: {child.id}, "
                    f"File: {child.file_name}, Line: {child.line_number}, "
                    f"Code: {child.get_code()} -- "
                    f"Entry node of this structure's condition/init/body is likely missing."
                )

        if not valid_sequence:
            return node, [node]

        first_entry, current_exits = valid_sequence[0]

        for i in range(1, len(valid_sequence)):
            next_entry, next_exits = valid_sequence[i]
            for exit_node in current_exits:
                self._add_cfg_edge(exit_node, next_entry)
            current_exits = next_exits

        return first_entry, current_exits

    def _dispatch_control_structure(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        handler = self._ctrl_dispatch_map.get(node.control_structure_type)
        if handler:
            return handler(node)
        return node, [node]

    # --- Control Structures ---

    def handle_if(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]

        order_map = self._build_order_map(children)
        cond = order_map.get(1) or children[0]
        true_body = order_map.get(2)
        false_body = order_map.get(3)

        cond_entry, cond_exits = self.visit(cond)
        final_exits = []

        if true_body:
            t_entry, t_exits = self.visit(true_body)
            for e in cond_exits:
                self._add_cfg_edge(e, t_entry, label="TRUE")
            final_exits.extend(t_exits)
        else:
            final_exits.extend(cond_exits)

        if false_body:
            f_entry, f_exits = self.visit(false_body)
            for e in cond_exits:
                self._add_cfg_edge(e, f_entry, label="FALSE")
            final_exits.extend(f_exits)
        else:
            final_exits.extend(cond_exits)

        return cond_entry, final_exits

    def handle_while(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        order_map = self._build_order_map(children)
        cond = order_map.get(1)
        body = order_map.get(2)

        if not cond:
            return self._handle_infinite_loop(node, body)

        cond_entry, cond_exits = self.visit(cond)

        with self._loop_scope("WHILE", pre_resolved_target=cond_entry) as ctx:
            final_exits = list(cond_exits)

            if body:
                body_entry, body_exits = self.visit(body)
                for e in cond_exits:
                    self._add_cfg_edge(e, body_entry, label="TRUE")
                for e in body_exits:
                    self._add_cfg_edge(e, cond_entry)
            else:
                for e in cond_exits:
                    self._add_cfg_edge(e, cond_entry, label="TRUE")

            for src in ctx.continue_sources:
                self._add_cfg_edge(src, cond_entry)

            final_exits.extend(ctx.break_exits)

        return cond_entry, final_exits

    def handle_do(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]

        body = children[0]
        cond = children[1] if len(children) > 1 else None

        with self._loop_scope("DO", pre_resolved_target=None) as ctx:
            body_entry, body_exits = self.visit(body)

            cond_entry, cond_exits = None, []
            if cond:
                cond_entry, cond_exits = self.visit(cond)

            actual_continue_target = cond_entry if cond_entry else body_entry

            for src in ctx.continue_sources:
                self._add_cfg_edge(src, actual_continue_target, label="CONTINUE")

            if cond_entry:
                for e in body_exits:
                    self._add_cfg_edge(e, cond_entry)
                for e in cond_exits:
                    self._add_cfg_edge(e, body_entry, label="TRUE")
                final_exits = list(cond_exits)
            else:
                for e in body_exits:
                    self._add_cfg_edge(e, body_entry)
                final_exits = []

            final_exits.extend(ctx.break_exits)

        return body_entry, final_exits

    def handle_for(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        order_map = self._build_order_map(children)
        init = order_map.get(1)
        cond = order_map.get(2)
        update = order_map.get(3)
        body = order_map.get(4)

        # LibClang 宏展开有时输出顺序为 Init, Cond, Body, Update (Body 占了 Update 的槽)
        is_update_block = isinstance(update, BlockNode)
        is_body_block = isinstance(body, BlockNode)

        if is_update_block and not is_body_block:
            body, update = update, body

        if not body and isinstance(update, BlockNode):
            body = update
            update = None

        if not body and children and len(children) < 4:
            body = children[-1]
            if init is body:
                init = None
            if cond is body:
                cond = None
            if update is body:
                update = None

        entry_node = None
        last_exits = []

        if init:
            entry_node, last_exits = self.visit(init)

        cond_entry, cond_exits = None, []
        if cond:
            cond_entry, cond_exits = self.visit(cond)
            if not cond_entry:
                cond_entry = node

            for e in last_exits:
                self._add_cfg_edge(e, cond_entry)
            last_exits = []

        if not entry_node:
            entry_node = cond_entry

        update_entry, update_exits = None, []
        if update:
            update_entry, update_exits = self.visit(update)

        resolved_target = update_entry if update_entry else cond_entry

        with self._loop_scope("FOR", pre_resolved_target=resolved_target) as ctx:
            if body:
                body_entry, body_exits = self.visit(body)

                if not body_entry:
                    if not entry_node:
                        entry_node = node
                else:
                    if not entry_node:
                        entry_node = body_entry

                    actual_continue_target = resolved_target if resolved_target else body_entry
                    for src in ctx.continue_sources:
                        self._add_cfg_edge(src, actual_continue_target, label="CONTINUE")

                    if update_entry:
                        target = cond_entry if cond_entry else body_entry
                        for e in update_exits:
                            self._add_cfg_edge(e, target)

                    if last_exits and not cond_entry:
                        for e in last_exits:
                            self._add_cfg_edge(e, body_entry)

                    if cond_entry:
                        for e in cond_exits:
                            self._add_cfg_edge(e, body_entry, label="TRUE")

                    next_hop = actual_continue_target
                    for e in body_exits:
                        self._add_cfg_edge(e, next_hop)

            if not entry_node:
                entry_node = node

            final_exits = []
            if cond_exits:
                final_exits.extend(cond_exits)
            final_exits.extend(ctx.break_exits)

        return entry_node, final_exits

    def _handle_infinite_loop(self, node, body):
        with self._loop_scope("WHILE_INF", pre_resolved_target=None) as ctx:
            if body:
                b_entry, b_exits = self.visit(body)

                for src in ctx.continue_sources:
                    self._add_cfg_edge(src, b_entry, label="CONTINUE")

                for e in b_exits:
                    self._add_cfg_edge(e, b_entry)

                return b_entry, ctx.break_exits
            else:
                return node, []

    def handle_switch(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]

        cond_node = None
        body_stmts = []
        if isinstance(children[0], BlockNode):
            body_stmts = self.graph.get_ast_children(children[0])
        else:
            cond_node = children[0]
            remaining = children[1:]
            if remaining and len(remaining) == 1 and isinstance(remaining[0], BlockNode):
                body_stmts = self.graph.get_ast_children(remaining[0])
            else:
                body_stmts = remaining

        cond_entry = node
        cond_exits = []
        if cond_node:
            cond_entry, cond_exits = self.visit(cond_node)
        else:
            cond_exits = [node]

        final_exits = []

        parent_resolved = None
        if self._curr_loop_stack:
            parent_resolved = self._curr_loop_stack[-1].resolved_continue_target

        with self._loop_scope("SWITCH", pre_resolved_target=parent_resolved) as ctx:
            if body_stmts:
                has_default = False
                prev_exits = []

                for stmt in body_stmts:
                    s_entry, s_exits = self.visit(stmt)

                    if isinstance(stmt, JumpTargetNode):
                        for ce in cond_exits:
                            self._add_cfg_edge(ce, s_entry, label=stmt.name)
                        if stmt.name == "default":
                            has_default = True

                    if prev_exits:
                        for pe in prev_exits:
                            self._add_cfg_edge(pe, s_entry)

                    prev_exits = s_exits

                final_exits.extend(prev_exits)
                if not has_default:
                    final_exits.extend(cond_exits)
            else:
                final_exits.extend(cond_exits)

            final_exits.extend(ctx.break_exits)

            if ctx.continue_sources and len(self._curr_loop_stack) >= 2:
                parent_ctx = self._curr_loop_stack[-2]
                parent_ctx.continue_sources.extend(ctx.continue_sources)

        return cond_entry, final_exits

    def handle_jump(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        if node.control_structure_type == ControlStructureType.GOTO:
            raw_code = node.get_code()
            if raw_code:
                m = _GOTO_LABEL_RE.search(raw_code)
                label_name = m.group(1) if m else raw_code.replace("goto", "").replace(";", "").strip()
            else:
                label_name = "<unknown_label>"
                logger.warning(
                    f"[{self._curr_method_name}] Could not extract GOTO label from source at line {node.line_number}")
            self._pending_gotos.append((node, label_name))
            return node, []

        if not self._curr_loop_stack:
            code_snippet = node.get_code() or "<no_source>"
            logger.warning(f"[{self._curr_method_name}] Orphan jump '{code_snippet}' at Line {node.line_number}")
            return node, [node]

        ctx = self._curr_loop_stack[-1]

        if node.control_structure_type == ControlStructureType.BREAK:
            ctx.break_exits.append(node)
            return node, []

        elif node.control_structure_type == ControlStructureType.CONTINUE:
            if ctx.resolved_continue_target:
                self._add_cfg_edge(node, ctx.resolved_continue_target)
            else:
                ctx.continue_sources.append(node)
            return node, []

        return node, [node]

    def handle_throw(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        """throw/raise 终止当前控制流路径，连接到 MethodReturn。"""
        if self._curr_method_return:
            self._add_cfg_edge(node, self._curr_method_return, label="THROW")
        return node, []

    def handle_JumpTargetNode(self, node: JumpTargetNode) -> Tuple[AnyNode, List[AnyNode]]:
        if node.name:
            self._label_map[node.name] = node
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]
        first_entry, current_exits = self.visit(children[0])
        self._add_cfg_edge(node, first_entry)
        for i in range(1, len(children)):
            next_entry, next_exits = self.visit(children[i])
            for ex in current_exits:
                self._add_cfg_edge(ex, next_entry)
            current_exits = next_exits
        return node, current_exits

    def handle_ReturnNode(self, node: ReturnNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        entry = node
        if children:
            expr = children[0]
            e_entry, e_exits = self.visit(expr)
            entry = e_entry
            for e in e_exits:
                self._add_cfg_edge(e, node)
        if self._curr_method_return:
            self._add_cfg_edge(node, self._curr_method_return)
        return entry, []

    def handle_try(self, node: ControlStructureNode) -> Tuple[AnyNode, List[AnyNode]]:
        children = self.graph.get_ast_children(node)
        if not children:
            return node, [node]
        try_body = children[0]
        catch_clauses = children[1:]
        try_entry, try_exits = self.visit(try_body)
        final_exits = list(try_exits)
        for catch_node in catch_clauses:
            c_entry, c_exits = self.visit(catch_node)
            self._add_cfg_edge(try_entry, c_entry, label="EXCEPTION")
            final_exits.extend(c_exits)
        return try_entry, final_exits

    def handle_CallNode(self, node: CallNode) -> Tuple[AnyNode, List[AnyNode]]:
        semantic_type = node.metadata.get("semantic_type") if node.metadata else None
        if semantic_type == "LOOP":
            return self._handle_macro_loop(node)
        if node.name == "<operator>.conditional":
            return self._handle_conditional_operator(node)
        if node.name == "<operator>.logicalAnd":
            return self._handle_logical_and(node)
        if node.name == "<operator>.logicalOr":
            return self._handle_logical_or(node)

        args = self.graph.get_ast_children(node)
        if not args:
            return node, [node]

        valid_sequence = []
        for arg in args:
            entry, exits = self.visit(arg)
            if entry:
                valid_sequence.append((entry, exits))

        if not valid_sequence:
            return node, [node]

        first_entry, current_exits = valid_sequence[0]

        for i in range(1, len(valid_sequence)):
            next_entry, next_exits = valid_sequence[i]
            for ex in current_exits:
                self._add_cfg_edge(ex, next_entry)
            current_exits = next_exits

        for ex in current_exits:
            self._add_cfg_edge(ex, node)

        return first_entry, [node]

    def _handle_conditional_operator(self, node: CallNode) -> Tuple[AnyNode, List[AnyNode]]:
        args = self.graph.get_ast_children(node)
        if len(args) < 3:
            return node, [node]
        cond, true_expr, false_expr = args[0], args[1], args[2]
        cond_entry, cond_exits = self.visit(cond)
        t_entry, t_exits = self.visit(true_expr)
        for ex in cond_exits:
            self._add_cfg_edge(ex, t_entry, label="TRUE")
        f_entry, f_exits = self.visit(false_expr)
        for ex in cond_exits:
            self._add_cfg_edge(ex, f_entry, label="FALSE")
        for ex in t_exits:
            self._add_cfg_edge(ex, node)
        for ex in f_exits:
            self._add_cfg_edge(ex, node)
        return cond_entry, [node]

    def _handle_logical_and(self, node: CallNode) -> Tuple[AnyNode, List[AnyNode]]:
        args = self.graph.get_ast_children(node)
        if len(args) < 2:
            return node, [node]
        lhs, rhs = args[0], args[1]
        lhs_entry, lhs_exits = self.visit(lhs)
        rhs_entry, rhs_exits = self.visit(rhs)
        for ex in lhs_exits:
            self._add_cfg_edge(ex, rhs_entry, label="TRUE")
            self._add_cfg_edge(ex, node, label="FALSE")
        for ex in rhs_exits:
            self._add_cfg_edge(ex, node)
        return lhs_entry, [node]

    def _handle_logical_or(self, node: CallNode) -> Tuple[AnyNode, List[AnyNode]]:
        args = self.graph.get_ast_children(node)
        if len(args) < 2:
            return node, [node]
        lhs, rhs = args[0], args[1]
        lhs_entry, lhs_exits = self.visit(lhs)
        rhs_entry, rhs_exits = self.visit(rhs)
        for ex in lhs_exits:
            self._add_cfg_edge(ex, rhs_entry, label="FALSE")
            self._add_cfg_edge(ex, node, label="TRUE")
        for ex in rhs_exits:
            self._add_cfg_edge(ex, node)
        return lhs_entry, [node]

    def _handle_macro_loop(self, node: CallNode) -> Tuple[AnyNode, List[AnyNode]]:
        """
        处理宏循环 (Macro Loop)。
        Topology: While-Loop Style (Check-First)

        Flow:
          [Entry] -> Node (Header/Check) --TRUE--> FirstChild ... -> LastChild --BACK--> Node
                               |
                             FALSE (Exit)
        """
        name = node.name
        children = self.graph.get_ast_children(node)

        if not children:
            self._add_cfg_edge(node, node, label="TRUE")
            return node, [node]

        with self._loop_scope(f"MACRO:{name}", pre_resolved_target=node) as ctx:

            valid_sequence = []
            for child in children:
                entry, exits = self.visit(child)
                if entry:
                    valid_sequence.append((entry, exits))

            if valid_sequence:
                first_entry, _ = valid_sequence[0]

                self._add_cfg_edge(node, first_entry, label="TRUE")

                current_exits = valid_sequence[0][1]
                for i in range(1, len(valid_sequence)):
                    next_entry, next_exits = valid_sequence[i]
                    for ex in current_exits:
                        self._add_cfg_edge(ex, next_entry)
                    current_exits = next_exits

                for ex in current_exits:
                    self._add_cfg_edge(ex, node, label="BACK")

            for src in ctx.continue_sources:
                self._add_cfg_edge(src, node, label="CONTINUE")

            final_exits = [node]
            final_exits.extend(ctx.break_exits)

            return node, final_exits
