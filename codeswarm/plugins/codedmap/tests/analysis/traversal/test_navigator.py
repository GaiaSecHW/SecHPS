"""
Tests for analysis/traversal navigators:
  - AstContextNavigator
  - CallGraphNavigator
  - DataFlowNavigator
  - ControlFlowNavigator
  - ContextLoader (facade)

Uses a lightweight MockStore that matches the current Storage DSL interface
(by_id, repeat, descendants, callers, in_, out, file, filter, limit, first,
 distinct, ast_children, has_label, files, by_ids).
"""

import pytest
from typing import List, Dict, Optional, Iterator, Set
from collections import defaultdict

from codedmap.core.schema.graph.base import CPGNode, AstNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, FileNode, CallNode, TypeDeclNode,
    IdentifierNode, ControlStructureNode, LiteralNode,
)
from codedmap.core.schema.graph.enums import EdgeType, Language, NodeLabel
from codedmap.analysis.traversal.ast import AstContextNavigator
from codedmap.analysis.traversal.call import CallGraphNavigator
from codedmap.analysis.traversal.dataflow import DataFlowNavigator
from codedmap.analysis.traversal.cfg import ControlFlowNavigator
from codedmap.analysis.traversal.context import ContextLoader, ContextStrategy


# =========================================================================
# Mock Infrastructure — matches current Storage DSL
# =========================================================================

class MockQueryChain:
    """
    Fluent query chain that mirrors the real TraversalInterface.

    Supported DSL methods:
        by_id / by_ids / in_ / out / repeat / descendants / callers
        file / type_decl / filter / limit / first / distinct
        ast_children / has_label / files / to_list
    """

    def __init__(self, db: "MockGraphDB", node_ids: List[int]):
        self._db = db
        self._ids = list(node_ids)

    # --- traversal primitives ---

    def by_id(self, nid: int) -> "MockQueryChain":
        return MockQueryChain(self._db, [nid])

    def by_ids(self, nids: List[int]) -> "MockQueryChain":
        return MockQueryChain(self._db, list(nids))

    def in_(self, edge_type, target_class=None) -> "MockQueryChain":
        result_ids = []
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        for nid in self._ids:
            for src, dst, etype in self._db.edges:
                if dst == nid and etype == et:
                    result_ids.append(src)
        if target_class:
            result_ids = [i for i in result_ids if isinstance(self._db.nodes.get(i), target_class)]
        return MockQueryChain(self._db, result_ids)

    def out(self, edge_type, target_class=None) -> "MockQueryChain":
        result_ids = []
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        for nid in self._ids:
            for src, dst, etype in self._db.edges:
                if src == nid and etype == et:
                    result_ids.append(dst)
        if target_class:
            result_ids = [i for i in result_ids if isinstance(self._db.nodes.get(i), target_class)]
        return MockQueryChain(self._db, result_ids)

    def repeat(self, edge_type=None, direction="OUT", min_depth=0, max_depth=10,
               target_label=None) -> "MockQueryChain":
        """BFS multi-hop traversal."""
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        collected: List[int] = []
        frontier: Set[int] = set(self._ids)
        visited: Set[int] = set(self._ids)

        for depth in range(1, max_depth + 1):
            next_frontier: Set[int] = set()
            for nid in frontier:
                neighbors = self._db.get_neighbors(nid, et, direction)
                for nb_id in neighbors:
                    if nb_id not in visited:
                        visited.add(nb_id)
                        next_frontier.add(nb_id)
                        if depth >= min_depth:
                            if target_label is None:
                                collected.append(nb_id)
                            else:
                                node = self._db.nodes.get(nb_id)
                                lbl = getattr(node, "label", None)
                                lbl_val = lbl.value if hasattr(lbl, "value") else str(lbl)
                                if lbl_val == (target_label.value if hasattr(target_label, "value") else str(target_label)):
                                    collected.append(nb_id)
            frontier = next_frontier
            if not frontier:
                break

        return MockQueryChain(self._db, collected)

    def descendants(self, target_label=None, max_depth=100, edge_type=None) -> "MockQueryChain":
        """AST descendant search (like repeat on AST/OUT with label filter)."""
        return self.repeat(
            edge_type=edge_type or EdgeType.AST,
            direction="OUT",
            min_depth=1,
            max_depth=max_depth,
            target_label=target_label,
        )

    def callers(self) -> "MockQueryChain":
        """Shortcut: in_(CALL) then find enclosing METHOD via AST-IN."""
        call_sites = self.in_(EdgeType.CALL)
        method_ids = []
        for cid in call_sites._ids:
            chain = MockQueryChain(self._db, [cid])
            m = chain.repeat(EdgeType.AST, direction="IN", min_depth=1, max_depth=20,
                             target_label=NodeLabel.METHOD)
            method_ids.extend(m._ids)
        return MockQueryChain(self._db, list(dict.fromkeys(method_ids)))

    def file(self) -> "MockQueryChain":
        """Shortcut: find enclosing FILE via AST-IN or SOURCE_FILE."""
        result_ids = []
        for nid in self._ids:
            sf = MockQueryChain(self._db, [nid]).out(EdgeType.SOURCE_FILE)
            if sf._ids:
                result_ids.extend(sf._ids)
            else:
                f = MockQueryChain(self._db, [nid]).repeat(
                    EdgeType.AST, direction="IN", min_depth=1, max_depth=30,
                    target_label=NodeLabel.FILE)
                result_ids.extend(f._ids)
        return MockQueryChain(self._db, list(dict.fromkeys(result_ids)))

    def type_decl(self) -> "MockQueryChain":
        return self.repeat(EdgeType.AST, direction="IN", min_depth=1, max_depth=20,
                           target_label=NodeLabel.TYPE_DECL)

    def ast_children(self) -> "MockQueryChain":
        return self.out(EdgeType.AST)

    def has_label(self, label) -> "MockQueryChain":
        lbl_val = label.value if hasattr(label, "value") else str(label)
        filtered = []
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node:
                n_lbl = getattr(node, "label", None)
                n_lbl_val = n_lbl.value if hasattr(n_lbl, "value") else str(n_lbl)
                if n_lbl_val == lbl_val:
                    filtered.append(nid)
        return MockQueryChain(self._db, filtered)

    def files(self) -> "MockQueryChain":
        file_ids = [nid for nid, n in self._db.nodes.items()
                    if getattr(n, "label", None) == NodeLabel.FILE]
        return MockQueryChain(self._db, file_ids)

    # --- terminal operations ---

    def filter(self, **kwargs) -> "MockQueryChain":
        filtered = []
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node and all(getattr(node, k, None) == v for k, v in kwargs.items()):
                filtered.append(nid)
        return MockQueryChain(self._db, filtered)

    def limit(self, n: int) -> "MockQueryChain":
        return MockQueryChain(self._db, self._ids[:n])

    def distinct(self) -> "MockQueryChain":
        return MockQueryChain(self._db, list(dict.fromkeys(self._ids)))

    def first(self):
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node:
                return node
        return None

    def to_list(self) -> list:
        return [self._db.nodes[nid] for nid in self._ids if nid in self._db.nodes]

    def __iter__(self):
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node:
                yield node


class MockGraphDB:
    """In-memory graph database backing the mock query chain."""

    def __init__(self):
        self.nodes: Dict[int, CPGNode] = {}
        self.edges: List[tuple] = []  # (src_id, dst_id, edge_type_value)

    def add_node(self, node: CPGNode):
        self.nodes[node.id] = node

    def add_edge(self, src_id: int, dst_id: int, edge_type):
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        self.edges.append((src_id, dst_id, et))

    def get_neighbors(self, nid: int, edge_type_val: str, direction: str) -> List[int]:
        result = []
        for src, dst, et in self.edges:
            if et == edge_type_val:
                if direction == "OUT" and src == nid:
                    result.append(dst)
                elif direction == "IN" and dst == nid:
                    result.append(src)
        return result


class MockStore:
    """Drop-in replacement for CPGStore in navigator tests."""

    def __init__(self, db: MockGraphDB):
        self._db = db
        self.query = MockQueryChain(db, [])

    def get_node(self, node_id: int):
        return self._db.nodes.get(node_id)


# =========================================================================
# Helper: graph building
# =========================================================================

def _make_method(id: int, name: str, code: str = None, line: int = None, file_name: str = None) -> MethodNode:
    return MethodNode(id=id, name=name, fullName=name, label=NodeLabel.METHOD,
                      code=code, lineNumber=line, fileName=file_name)

def _make_file(id: int, name: str) -> FileNode:
    return FileNode(id=id, name=name, fullName=name, label=NodeLabel.FILE, language=Language.C)

def _make_call(id: int, name: str, code: str = None, line: int = None, file_name: str = None) -> CallNode:
    return CallNode(id=id, name=name, label=NodeLabel.CALL, code=code,
                    lineNumber=line, fileName=file_name)

def _make_identifier(id: int, name: str, code: str = None, line: int = None) -> IdentifierNode:
    return IdentifierNode(id=id, name=name, label=NodeLabel.IDENTIFIER,
                          code=code, lineNumber=line)

def _make_type_decl(id: int, name: str) -> TypeDeclNode:
    return TypeDeclNode(id=id, name=name, fullName=name, label=NodeLabel.TYPE_DECL)

def _make_ctrl(id: int, code: str = None, line: int = None) -> ControlStructureNode:
    return ControlStructureNode(id=id, label=NodeLabel.CONTROL_STRUCTURE,
                                code=code, lineNumber=line)


def build_store(*nodes_and_edges) -> MockStore:
    """
    Convenience: build_store(node1, node2, ..., (src, dst, EdgeType), ...)
    """
    db = MockGraphDB()
    for item in nodes_and_edges:
        if isinstance(item, CPGNode):
            db.add_node(item)
        elif isinstance(item, tuple) and len(item) == 3:
            db.add_edge(*item)
    return MockStore(db)


# =========================================================================
# Tests: AstContextNavigator
# =========================================================================

class TestAstNavigator:

    def test_get_enclosing_method(self):
        method = _make_method(1, "main", code="int main() { return 0; }", line=1)
        call = _make_call(2, "printf", line=3)
        store = build_store(method, call, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        result = nav.get_enclosing_method(call)

        assert result is not None
        assert result.id == 1
        assert result.name == "main"

    def test_get_enclosing_method_returns_none_for_orphan(self):
        call = _make_call(10, "orphan")
        store = build_store(call)

        nav = AstContextNavigator(store)
        assert nav.get_enclosing_method(call) is None

    def test_get_enclosing_method_by_int_id(self):
        method = _make_method(1, "foo")
        ident = _make_identifier(2, "x")
        store = build_store(method, ident, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        assert nav.get_enclosing_method(2).id == 1

    def test_get_enclosing_file(self):
        f = _make_file(1, "main.c")
        method = _make_method(2, "main")
        store = build_store(f, method, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        result = nav.get_enclosing_file(method)

        assert result is not None
        assert result.id == 1
        assert result.name == "main.c"

    def test_get_methods_in_file(self):
        f = _make_file(1, "utils.c")
        m1 = _make_method(2, "helper_a")
        m2 = _make_method(3, "helper_b")
        store = build_store(f, m1, m2,
                            (1, 2, EdgeType.AST),
                            (1, 3, EdgeType.AST))

        nav = AstContextNavigator(store)
        methods = list(nav.get_methods_in_file(f))

        assert len(methods) == 2
        names = {m.name for m in methods}
        assert names == {"helper_a", "helper_b"}

    def test_get_methods_in_type(self):
        td = _make_type_decl(1, "MyClass")
        m1 = _make_method(2, "init")
        m2 = _make_method(3, "process")
        store = build_store(td, m1, m2,
                            (1, 2, EdgeType.AST),
                            (1, 3, EdgeType.AST))

        nav = AstContextNavigator(store)
        methods = list(nav.get_methods_in_type(td))

        assert len(methods) == 2

    def test_get_enclosing_type(self):
        td = _make_type_decl(1, "Parser")
        method = _make_method(2, "parse")
        store = build_store(td, method, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        result = nav.get_enclosing_type(method)

        assert result is not None
        assert result.name == "Parser"

    def test_get_context_code_short_method(self):
        """Method code shorter than max_lines -> return full code."""
        code = "void f() {\n  return;\n}"
        method = _make_method(1, "f", code=code, line=10)
        call = _make_call(2, "g", line=11)
        store = build_store(method, call, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        result = nav.get_context_code(call, max_lines=50)

        assert result == code

    def test_get_context_code_windowed(self):
        """Long code triggers smart window extraction."""
        lines = [f"line {i}" for i in range(1, 22)]
        code = "\n".join(lines)
        method = _make_method(1, "big", code=code, line=1)
        call = _make_call(2, "target", line=10)
        store = build_store(method, call, (1, 2, EdgeType.AST))

        nav = AstContextNavigator(store)
        result = nav.get_context_code(call, max_lines=5)

        assert result is not None
        assert len(result.split("\n")) <= 7  # 5 lines + possible hidden markers

    def test_get_base_types(self):
        parent_td = _make_type_decl(1, "Base")
        child_td = _make_type_decl(2, "Derived")
        store = build_store(parent_td, child_td, (2, 1, EdgeType.INHERITS_FROM))

        nav = AstContextNavigator(store)
        bases = list(nav.get_base_types(child_td))

        assert len(bases) == 1
        assert bases[0].name == "Base"


# =========================================================================
# Tests: CallGraphNavigator
# =========================================================================

class TestCallNavigator:

    def test_get_callers(self):
        method = _make_method(1, "target")
        caller_call = _make_call(2, "target")
        store = build_store(method, caller_call, (2, 1, EdgeType.CALL))

        nav = CallGraphNavigator(store)
        callers = list(nav.get_callers(method))

        assert len(callers) == 1
        assert callers[0].id == 2

    def test_get_callees(self):
        caller_method = _make_method(1, "caller")
        call_site = _make_call(2, "helper")
        callee_method = _make_method(3, "helper")
        store = build_store(
            caller_method, call_site, callee_method,
            (1, 2, EdgeType.AST),   # method contains call site
            (2, 3, EdgeType.CALL),  # call site resolves to method
        )

        nav = CallGraphNavigator(store)
        callees = list(nav.get_callees(caller_method))

        assert len(callees) == 1
        assert callees[0].name == "helper"

    def test_get_callers_empty(self):
        method = _make_method(1, "isolated")
        store = build_store(method)

        nav = CallGraphNavigator(store)
        assert list(nav.get_callers(method)) == []

    def test_get_recursive_callers(self):
        """A -> B -> C: recursive callers of C should find B and A."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        m_c = _make_method(3, "C")
        call_b = _make_call(4, "B")  # call site inside A
        call_c = _make_call(5, "C")  # call site inside B

        store = build_store(
            m_a, m_b, m_c, call_b, call_c,
            (1, 4, EdgeType.AST),   # A contains call to B
            (4, 2, EdgeType.CALL),  # call resolves to B
            (2, 5, EdgeType.AST),   # B contains call to C
            (5, 3, EdgeType.CALL),  # call resolves to C
        )

        nav = CallGraphNavigator(store)
        callers = list(nav.get_recursive_callers(m_c, max_depth=5))

        caller_names = {c.name for c in callers}
        assert "B" in caller_names
        assert "A" in caller_names

    def test_get_recursive_callers_cycle(self):
        """Cyclic calls: A -> B -> A. Should not infinite loop."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        call_b = _make_call(3, "B")
        call_a = _make_call(4, "A")

        store = build_store(
            m_a, m_b, call_b, call_a,
            (1, 3, EdgeType.AST), (3, 2, EdgeType.CALL),  # A -> B
            (2, 4, EdgeType.AST), (4, 1, EdgeType.CALL),  # B -> A
        )

        nav = CallGraphNavigator(store)
        callers = list(nav.get_recursive_callers(m_a, max_depth=5))

        assert len(callers) <= 2
        caller_ids = {c.id for c in callers}
        assert 2 in caller_ids  # B calls A

    def test_get_recursive_callers_max_depth(self):
        """Respects max_depth limit."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        m_c = _make_method(3, "C")
        call_b = _make_call(4, "B")
        call_c = _make_call(5, "C")

        store = build_store(
            m_a, m_b, m_c, call_b, call_c,
            (1, 4, EdgeType.AST), (4, 2, EdgeType.CALL),
            (2, 5, EdgeType.AST), (5, 3, EdgeType.CALL),
        )

        nav = CallGraphNavigator(store)
        callers_d1 = list(nav.get_recursive_callers(m_c, max_depth=1))

        assert len(callers_d1) == 1
        assert callers_d1[0].name == "B"


# =========================================================================
# Tests: DataFlowNavigator
# =========================================================================

class TestDataFlowNavigator:

    def test_get_definitions(self):
        var_def = _make_identifier(1, "x", code="int x = 0", line=5)
        var_use = _make_identifier(2, "x", code="printf(x)", line=10)
        store = build_store(var_def, var_use, (1, 2, EdgeType.DDG))

        nav = DataFlowNavigator(store)
        defs = list(nav.get_definitions(var_use))

        assert len(defs) == 1
        assert defs[0].id == 1

    def test_get_usages(self):
        var_def = _make_identifier(1, "x", code="int x = 0", line=5)
        use1 = _make_identifier(2, "x", code="a = x", line=8)
        use2 = _make_identifier(3, "x", code="b = x", line=9)
        store = build_store(var_def, use1, use2,
                            (1, 2, EdgeType.DDG),
                            (1, 3, EdgeType.DDG))

        nav = DataFlowNavigator(store)
        usages = list(nav.get_usages(var_def))

        assert len(usages) == 2

    def test_get_data_slice_backward(self):
        n1 = _make_identifier(1, "src", code="src = recv()", line=1)
        n2 = _make_identifier(2, "buf", code="buf = process(src)", line=2)
        n3 = _make_call(3, "sink", code="sink(buf)", line=3)
        store = build_store(n1, n2, n3,
                            (1, 2, EdgeType.DDG),
                            (2, 3, EdgeType.DDG))

        nav = DataFlowNavigator(store)
        result = nav.get_data_slice(n3, direction="IN", max_depth=5)

        assert "sink(buf)" in result
        assert ">> " in result  # start node marker

    def test_get_data_slice_empty(self):
        """Node with no DDG edges -> empty or minimal slice."""
        n1 = _make_identifier(1, "orphan", code="int x", line=1)
        store = build_store(n1)

        nav = DataFlowNavigator(store)
        result = nav.get_data_slice(n1, direction="IN")

        assert isinstance(result, str)


# =========================================================================
# Tests: ControlFlowNavigator
# =========================================================================

class TestControlFlowNavigator:

    def test_get_successors(self):
        s1 = _make_identifier(1, "a", code="a = 1", line=1)
        s2 = _make_identifier(2, "b", code="b = 2", line=2)
        store = build_store(s1, s2, (1, 2, EdgeType.CFG))

        nav = ControlFlowNavigator(store)
        succs = list(nav.get_successors(s1))

        assert len(succs) == 1
        assert succs[0].id == 2

    def test_get_predecessors(self):
        s1 = _make_identifier(1, "a", code="a = 1", line=1)
        s2 = _make_identifier(2, "b", code="b = 2", line=2)
        store = build_store(s1, s2, (1, 2, EdgeType.CFG))

        nav = ControlFlowNavigator(store)
        preds = list(nav.get_predecessors(s2))

        assert len(preds) == 1
        assert preds[0].id == 1

    def test_is_reachable_true(self):
        n_a = _make_identifier(1, "a")
        n_b = _make_identifier(2, "b")
        n_c = _make_identifier(3, "c")
        store = build_store(n_a, n_b, n_c,
                            (1, 2, EdgeType.CFG),
                            (2, 3, EdgeType.CFG))

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable(n_a, n_c) is True

    def test_is_reachable_false(self):
        n_a = _make_identifier(1, "a")
        n_b = _make_identifier(2, "b")
        store = build_store(n_a, n_b)  # no CFG edges

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable(n_a, n_b) is False

    def test_is_reachable_self(self):
        n_a = _make_identifier(1, "a")
        store = build_store(n_a)

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable(n_a, n_a) is True

    # --- Interprocedural reachability tests ---

    def test_is_reachable_interprocedural(self):
        """Reachability across method calls: main calls treat_file."""
        m_main = _make_method(1, "main", line=1)
        m_treat = _make_method(2, "treat_file", line=10)
        call_treat = _make_call(3, "treat_file", line=5)
        # Statement inside main (CFG start)
        stmt_in_main = _make_identifier(4, "x", line=2)
        # Statement inside treat_file (CFG end)
        stmt_in_treat = _make_identifier(5, "y", line=11)

        store = build_store(
            m_main, m_treat, call_treat, stmt_in_main, stmt_in_treat,
            # AST: main contains stmt and call
            (1, 4, EdgeType.AST),
            (1, 3, EdgeType.AST),
            # AST: treat_file contains stmt
            (2, 5, EdgeType.AST),
            # CALL: call_treat -> treat_file
            (3, 2, EdgeType.CALL),
            # CFG within main
            (4, 3, EdgeType.CFG),
        )

        nav = ControlFlowNavigator(store)
        # Cross-procedure: main node -> treat_file node
        assert nav.is_reachable(m_main, m_treat) is True
        assert nav.is_reachable(stmt_in_main, stmt_in_treat) is True
        # Reverse should fail
        assert nav.is_reachable(m_treat, m_main) is False

    def test_is_reachable_interprocedural_transitive(self):
        """Transitive call reachability: A -> B -> C."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        m_c = _make_method(3, "C")
        call_b = _make_call(4, "B")
        call_c = _make_call(5, "C")

        store = build_store(
            m_a, m_b, m_c, call_b, call_c,
            (1, 4, EdgeType.AST), (4, 2, EdgeType.CALL),
            (2, 5, EdgeType.AST), (5, 3, EdgeType.CALL),
        )

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable(m_a, m_c) is True
        assert nav.is_reachable(m_c, m_a) is False

    def test_find_path_interprocedural(self):
        """find_path returns method-level path for cross-procedure."""
        m_main = _make_method(1, "main")
        m_treat = _make_method(2, "treat_file")
        call_treat = _make_call(3, "treat_file")

        store = build_store(
            m_main, m_treat, call_treat,
            (1, 3, EdgeType.AST),
            (3, 2, EdgeType.CALL),
        )

        nav = ControlFlowNavigator(store)
        path = nav.find_path(m_main, m_treat)
        assert len(path) >= 2
        assert path[0].id == 1
        assert path[-1].id == 2

    def test_is_reachable_interprocedural_public_api(self):
        """Dedicated interprocedural API works independently."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        call_b = _make_call(3, "B")

        store = build_store(
            m_a, m_b, call_b,
            (1, 3, EdgeType.AST),
            (3, 2, EdgeType.CALL),
        )

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable_interprocedural(m_a, m_b) is True
        assert nav.is_reachable_interprocedural(m_b, m_a) is False

    def test_find_path_interprocedural_public_api(self):
        """Dedicated interprocedural find_path API."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        m_c = _make_method(3, "C")
        call_b = _make_call(4, "B")
        call_c = _make_call(5, "C")

        store = build_store(
            m_a, m_b, m_c, call_b, call_c,
            (1, 4, EdgeType.AST), (4, 2, EdgeType.CALL),
            (2, 5, EdgeType.AST), (5, 3, EdgeType.CALL),
        )

        nav = ControlFlowNavigator(store)
        path = nav.find_path_interprocedural(m_a, m_c)
        assert len(path) == 3
        assert path[0].id == 1
        assert path[1].id == 2
        assert path[2].id == 3

    def test_is_reachable_interprocedural_no_enclosing_method(self):
        """Nodes without enclosing method -> interprocedural returns False."""
        n_a = _make_identifier(1, "a")
        n_b = _make_identifier(2, "b")
        store = build_store(n_a, n_b)  # no AST edges, no methods

        nav = ControlFlowNavigator(store)
        # CFG fails, interprocedural fails (no enclosing methods)
        assert nav.is_reachable(n_a, n_b) is False

    def test_is_reachable_cfg_takes_priority_over_interprocedural(self):
        """When CFG path exists, it is found without needing call graph."""
        n_a = _make_identifier(1, "a")
        n_b = _make_identifier(2, "b")
        store = build_store(n_a, n_b, (1, 2, EdgeType.CFG))

        nav = ControlFlowNavigator(store)
        assert nav.is_reachable(n_a, n_b) is True

    def test_find_path_interprocedural_unreachable(self):
        """find_path returns empty for unreachable interprocedural targets."""
        m_a = _make_method(1, "A")
        m_b = _make_method(2, "B")
        store = build_store(m_a, m_b)  # no call edges

        nav = ControlFlowNavigator(store)
        path = nav.find_path(m_a, m_b)
        assert path == []


# =========================================================================
# Tests: ContextLoader (Facade)
# =========================================================================

class TestContextLoader:

    def _build_basic_graph(self):
        """Build a small graph: file -> method -> call (with DDG flow)."""
        f = _make_file(1, "main.c")
        method = _make_method(2, "process", code="void process() {\n  sink(x);\n}", line=5,
                              file_name="main.c")
        call = _make_call(3, "sink", code="sink(x)", line=6, file_name="main.c")
        ident = _make_identifier(4, "x", code="x", line=6)

        return build_store(
            f, method, call, ident,
            (1, 2, EdgeType.AST),
            (2, 3, EdgeType.AST),
            (2, 4, EdgeType.AST),
            (4, 3, EdgeType.DDG),
            (2, 1, EdgeType.SOURCE_FILE),
        )

    def test_context_loader_initializes_all_navigators(self):
        store = self._build_basic_graph()
        loader = ContextLoader(store)

        assert loader.ast is not None
        assert loader.dataflow is not None
        assert loader.call is not None
        assert loader.cfg is not None
        assert loader.structure is not None

    def test_get_context_data_summary(self):
        store = self._build_basic_graph()
        loader = ContextLoader(store)
        method = store.get_node(2)

        data = loader.get_context_data(method, ContextStrategy.SUMMARY)

        assert data["strategy"] == "SUMMARY"
        assert data["node_name"] == "process"
        assert "code" in data

    def test_get_context_data_hierarchy(self):
        td = _make_type_decl(1, "Parser")
        method = _make_method(2, "parse", code="void parse() {}", line=1)
        f = _make_file(3, "parser.c")
        store = build_store(
            td, method, f,
            (1, 2, EdgeType.AST),
            (3, 1, EdgeType.AST),
        )

        loader = ContextLoader(store)
        data = loader.get_context_data(method, ContextStrategy.HIERARCHY)

        assert data["strategy"] == "HIERARCHY"
        assert data["class_info"] is not None
        assert data["class_info"]["name"] == "Parser"
        assert "parse" in data["class_info"]["methods"]

    def test_get_context_data_hierarchy_no_type(self):
        method = _make_method(1, "standalone")
        store = build_store(method)

        loader = ContextLoader(store)
        data = loader.get_context_data(method, ContextStrategy.HIERARCHY)

        assert data["class_info"] is None

    def test_format_trace(self):
        m1 = _make_method(1, "entry", code="void entry() {}", line=1)
        m2 = _make_method(2, "middle", code="void middle() {}", line=5)
        m3 = _make_method(3, "sink", code="void sink() {}", line=10)
        store = build_store(m1, m2, m3)

        loader = ContextLoader(store)
        result = loader.format_trace([m1, m2, m3])

        assert isinstance(result, str)

    def test_get_project_skeleton(self):
        f1 = _make_file(1, "src/main.c")
        f2 = _make_file(2, "src/utils.c")
        store = build_store(f1, f2)

        loader = ContextLoader(store)
        skeleton = loader.get_project_skeleton()

        assert isinstance(skeleton, str)
        assert "main.c" in skeleton
        assert "utils.c" in skeleton


# =========================================================================
# Tests: RepoStructureNavigator (via ContextLoader)
# =========================================================================

class TestRepoStructureNavigator:

    def test_generate_skeleton_ascii(self):
        from codedmap.analysis.traversal.structure import RepoStructureNavigator

        f1 = _make_file(1, "src/main.c")
        f2 = _make_file(2, "src/lib/helper.c")
        store = build_store(f1, f2)

        nav = RepoStructureNavigator(store)
        skeleton = nav.generate_repo_skeleton(style="ascii")

        assert "src/" in skeleton
        assert "main.c" in skeleton
        assert "helper.c" in skeleton

    def test_generate_skeleton_ignores_dirs(self):
        from codedmap.analysis.traversal.structure import RepoStructureNavigator

        f1 = _make_file(1, "src/main.c")
        f2 = _make_file(2, "__pycache__/cached.pyc")
        store = build_store(f1, f2)

        nav = RepoStructureNavigator(store)
        skeleton = nav.generate_repo_skeleton()

        assert "main.c" in skeleton
        assert "cached.pyc" not in skeleton

    def test_get_module_dependencies(self):
        from codedmap.analysis.traversal.structure import RepoStructureNavigator

        f1 = _make_file(1, "main.c")
        f2 = _make_file(2, "utils.c")
        method_in_f2 = _make_method(3, "helper")
        call_site = _make_call(4, "helper")
        method_in_f1 = _make_method(5, "main")

        store = build_store(
            f1, f2, method_in_f1, method_in_f2, call_site,
            (1, 5, EdgeType.AST),           # f1 -> main
            (5, call_site.id, EdgeType.AST), # main -> call(helper)
            (call_site.id, 3, EdgeType.CALL), # call -> helper method
            (2, 3, EdgeType.AST),           # f2 -> helper
            (3, 2, EdgeType.SOURCE_FILE),   # helper -> f2 (source file)
        )

        nav = RepoStructureNavigator(store)
        deps = nav.get_module_dependencies(f1)

        assert "utils.c" in deps

    def test_get_module_dependencies_cached(self):
        from codedmap.analysis.traversal.structure import RepoStructureNavigator

        f1 = _make_file(1, "main.c")
        store = build_store(f1)

        nav = RepoStructureNavigator(store)
        deps1 = nav.get_module_dependencies(f1)
        deps2 = nav.get_module_dependencies(f1)

        assert deps1 == deps2
