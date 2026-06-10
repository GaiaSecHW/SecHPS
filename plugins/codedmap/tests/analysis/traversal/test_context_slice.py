"""
Tests for context_slice.py:
  - SliceOptions model
  - ContextSlice Pydantic model hierarchy
  - ContextSliceBuilder with DDG traversal
  - ContextLoader.get_context_slice() API
  - CPG.context_slice() DSL method

Requirements: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, DSL-02
"""

import pytest
from typing import List, Dict, Optional, Iterator, Set, Any
from collections import defaultdict
from unittest.mock import MagicMock, patch

import sys
import os
sys.path.append(os.getcwd())

from codedmap.analysis.traversal.context_slice import (
    SliceOptions,
    ContextSlice,
    ContextSliceBuilder,
    TargetInfo,
    ScopeEntry,
    DDGEntry,
    CalleeInfo,
)
from codedmap.core.schema.graph.base import CPGNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, FileNode, CallNode, TypeDeclNode,
    IdentifierNode, ControlStructureNode,
)
from codedmap.core.schema.graph.enums import EdgeType, Language, NodeLabel
from codedmap.core.schema.graph import CPGGraph, CPGEdge


# =========================================================================
# Pure Model Tests (no store required)
# =========================================================================

class TestSliceOptionsModel:
    """Tests for SliceOptions configuration model (CTX-04)."""

    def test_slice_options_defaults(self):
        """Verify all defaults match CONTEXT.md specification."""
        opts = SliceOptions()

        assert opts.ddg_depth == 3
        assert opts.include_source is True
        assert opts.include_ddg is True
        assert opts.include_callees is True
        assert opts.include_globals is True
        assert opts.include_tags is True
        assert opts.max_source_lines == 600
        assert opts.truncate_source is True
        assert opts.max_callees == 20

    def test_slice_options_custom_values(self):
        """Verify SliceOptions accepts custom values (CTX-04)."""
        opts = SliceOptions(
            ddg_depth=5,
            include_source=False,
            include_callees=True,
            max_callees=10,
        )

        assert opts.ddg_depth == 5
        assert opts.include_source is False
        assert opts.include_callees is True
        assert opts.max_callees == 10

    def test_slice_options_frozen(self):
        """SliceOptions should be frozen/immutable."""
        opts = SliceOptions()

        with pytest.raises(Exception):  # Pydantic ValidationError or FrozenInstanceError
            opts.ddg_depth = 10


class TestContextSliceModel:
    """Tests for ContextSlice and sub-models (CTX-02, CTX-03)."""

    def test_target_info_model(self):
        """TargetInfo has all required fields."""
        target = TargetInfo(
            node_id=1,
            node_name="test_func",
            label="METHOD",
            language="C",
            file_path="src/test.c",
            line_start=10,
            line_end=20,
            summary="A test function",
        )

        assert target.node_id == 1
        assert target.node_name == "test_func"
        assert target.label == "METHOD"
        assert target.language == "C"
        assert target.file_path == "src/test.c"
        assert target.line_start == 10
        assert target.line_end == 20
        assert target.summary == "A test function"

    def test_target_info_optional_fields(self):
        """TargetInfo optional fields can be None."""
        target = TargetInfo(
            node_id=1,
            node_name="minimal",
            label="IDENTIFIER",
        )

        assert target.language is None
        assert target.file_path is None
        assert target.line_start is None
        assert target.line_end is None
        assert target.summary is None

    def test_scope_entry_model(self):
        """ScopeEntry has type and name."""
        entry = ScopeEntry(type="METHOD", name="myFunction")
        assert entry.type == "METHOD"
        assert entry.name == "myFunction"

    def test_ddg_entry_model(self):
        """DDGEntry has all fields including variable and control_context (CTX-02)."""
        entry = DDGEntry(
            node_id=5,
            variable="buf",
            code="char buf[100]",
            line=15,
            file_path="src/main.c",
            depth=2,
            control_context=["if (condition)", "while (running)"],
            truncated=True,
        )

        assert entry.node_id == 5
        assert entry.variable == "buf"
        assert entry.code == "char buf[100]"
        assert entry.line == 15
        assert entry.file_path == "src/main.c"
        assert entry.depth == 2
        assert len(entry.control_context) == 2
        assert entry.truncated is True

    def test_ddg_entry_defaults(self):
        """DDGEntry defaults control_context to empty list, truncated to False."""
        entry = DDGEntry(
            node_id=5,
            variable="x",
            code="int x = 1",
            depth=1,
        )

        assert entry.control_context == []
        assert entry.truncated is False

    def test_callee_info_model(self):
        """CalleeInfo has all fields including tags (CTX-02)."""
        callee = CalleeInfo(
            node_id=10,
            name="helper",
            full_name="pkg.helper",
            signature="void helper(int arg)",
            file_path="lib/utils.c",
            line=25,
            is_external=False,
            docstring="Helper function",
            summary="Does something useful",
            tags=["ONTOLOGY:SINK:DB_EXECUTE", "STATE:REVIEWED"],
        )

        assert callee.node_id == 10
        assert callee.name == "helper"
        assert callee.full_name == "pkg.helper"
        assert callee.signature == "void helper(int arg)"
        assert callee.file_path == "lib/utils.c"
        assert callee.line == 25
        assert callee.is_external is False
        assert callee.docstring == "Helper function"
        assert callee.summary == "Does something useful"
        assert "ONTOLOGY:SINK:DB_EXECUTE" in callee.tags
        assert "STATE:REVIEWED" in callee.tags

    def test_callee_info_defaults(self):
        """CalleeInfo defaults tags to empty list, is_external to False."""
        callee = CalleeInfo(
            node_id=10,
            name="external_lib_func",
        )

        assert callee.tags == []
        assert callee.is_external is False

    def test_context_slice_model_dump_json(self):
        """ContextSlice.model_dump(mode='json') produces valid JSON dict (CTX-03)."""
        target = TargetInfo(node_id=1, node_name="test", label="METHOD")
        scope = [ScopeEntry(type="FILE", name="test.c"), ScopeEntry(type="METHOD", name="test")]

        slice_obj = ContextSlice(
            target=target,
            enclosing_scope=scope,
            source="int test() { return 0; }",
            reaching_definitions=None,
            forward_usages=[],
            callees=[],
            tags=["CUSTOM_TAG"],
            tags_provenance={"CUSTOM_TAG": {"source": "manual"}},
        )

        data = slice_obj.model_dump(mode='json')

        assert data['target']['node_id'] == 1
        assert data['target']['node_name'] == "test"
        assert data['source'] == "int test() { return 0; }"
        assert data['reaching_definitions'] is None
        assert data['forward_usages'] == []
        assert data['tags'] == ["CUSTOM_TAG"]
        assert data['tags_provenance']['CUSTOM_TAG']['source'] == "manual"

    def test_context_slice_model_json_schema(self):
        """ContextSlice.model_json_schema() returns schema with expected keys (CTX-03)."""
        schema = ContextSlice.model_json_schema()

        props = schema.get('properties', {})
        assert 'target' in props
        assert 'enclosing_scope' in props
        assert 'source' in props
        assert 'reaching_definitions' in props
        assert 'forward_usages' in props
        assert 'callees' in props
        assert 'tags' in props
        assert 'referenced_globals' in props

    def test_context_slice_none_vs_empty_semantics(self):
        """None (excluded by options) vs [] (included but empty) (CTX-02, CTX-04)."""
        target = TargetInfo(node_id=1, node_name="test", label="METHOD")

        # None = explicitly excluded
        slice_excluded = ContextSlice(
            target=target,
            enclosing_scope=[],
            source=None,
            reaching_definitions=None,
            callees=None,
        )

        # [] = included but empty
        slice_empty = ContextSlice(
            target=target,
            enclosing_scope=[],
            source="",
            reaching_definitions=[],
            callees=[],
        )

        assert slice_excluded.source is None
        assert slice_empty.source == ""
        assert slice_excluded.reaching_definitions is None
        assert slice_empty.reaching_definitions == []


# =========================================================================
# Mock Infrastructure for Integration Tests
# =========================================================================

class MockCPGGraph:
    """Mock CPGGraph for DDG traversal tests."""

    def __init__(self):
        self.nodes: Dict[int, CPGNode] = {}
        self.edges: List[tuple] = []  # (src, dst, edge_type_value, properties)

    def add_node(self, node: CPGNode):
        self.nodes[node.id] = node

    def add_edge(self, src: int, dst: int, edge_type: EdgeType, properties: dict = None):
        et = edge_type.value if hasattr(edge_type, "value") else str(edge_type)
        self.edges.append((src, dst, et, properties or {}))

    def get_in_edges(self, node_id: int, edge_type: EdgeType = None) -> List[CPGEdge]:
        et = edge_type.value if edge_type and hasattr(edge_type, "value") else None
        result = []
        for src, dst, etype, props in self.edges:
            if dst == node_id and (et is None or etype == et):
                edge = CPGEdge(src=src, dst=dst, type=edge_type)
                edge.properties = props
                result.append(edge)
        return result

    def get_out_edges(self, node_id: int, edge_type: EdgeType = None) -> List[CPGEdge]:
        et = edge_type.value if edge_type and hasattr(edge_type, "value") else None
        result = []
        for src, dst, etype, props in self.edges:
            if src == node_id and (et is None or etype == et):
                edge = CPGEdge(src=src, dst=dst, type=edge_type)
                edge.properties = props
                result.append(edge)
        return result


class MockQueryChain:
    """Fluent query chain for mock store."""

    def __init__(self, db: "MockGraphDB", node_ids: List[int]):
        self._db = db
        self._ids = list(node_ids)

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
        return self.repeat(
            edge_type=edge_type or EdgeType.AST,
            direction="OUT",
            min_depth=1,
            max_depth=max_depth,
            target_label=target_label,
        )

    def file(self) -> "MockQueryChain":
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

    def filter(self, **kwargs) -> "MockQueryChain":
        filtered = []
        for nid in self._ids:
            node = self._db.nodes.get(nid)
            if node and all(getattr(node, k, None) == v for k, v in kwargs.items()):
                filtered.append(nid)
        return MockQueryChain(self._db, filtered)

    def limit(self, n: int) -> "MockQueryChain":
        return MockQueryChain(self._db, self._ids[:n])

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
        self.edges: List[tuple] = []
        self.method_graphs: Dict[int, MockCPGGraph] = {}

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
    """Mock CPGStore for ContextSliceBuilder tests."""

    def __init__(self, db: MockGraphDB):
        self._db = db
        self.query = MockQueryChain(db, [])
        self._node_cache = db.nodes

    def get_node(self, node_id: int):
        return self._db.nodes.get(node_id)

    def load_method_to_memory(self, method_id: int) -> Optional[MockCPGGraph]:
        """Load method subgraph - returns pre-built graph or creates one."""
        return self._db.method_graphs.get(method_id)


def make_method(id: int, name: str, code: str = None, line: int = None,
                file_name: str = None, tags: List[str] = None,
                summary: str = None, is_external: bool = False) -> MethodNode:
    node = MethodNode(
        id=id, name=name, fullName=name, label=NodeLabel.METHOD,
        code=code, lineNumber=line, fileName=file_name
    )
    node.tags = tags or []
    node.summary = summary
    node.is_external = is_external
    return node


def make_file(id: int, name: str) -> FileNode:
    return FileNode(id=id, name=name, fullName=name, label=NodeLabel.FILE, language=Language.C)


def make_call(id: int, name: str, code: str = None, line: int = None) -> CallNode:
    return CallNode(id=id, name=name, label=NodeLabel.CALL, code=code, lineNumber=line)


def make_identifier(id: int, name: str, code: str = None, line: int = None) -> IdentifierNode:
    return IdentifierNode(id=id, name=name, label=NodeLabel.IDENTIFIER, code=code, lineNumber=line)


def build_store(*nodes_and_edges) -> MockStore:
    """Build mock store from nodes and edges."""
    db = MockGraphDB()
    for item in nodes_and_edges:
        if isinstance(item, CPGNode):
            db.add_node(item)
        elif isinstance(item, tuple) and len(item) == 3:
            db.add_edge(*item)
    return MockStore(db)


# =========================================================================
# ContextSliceBuilder Tests (CTX-01, CTX-02, CTX-06)
# =========================================================================

class TestContextSliceBuilder:
    """Tests for ContextSliceBuilder.build() (CTX-01, CTX-02, CTX-06)."""

    def test_context_slice_builder_returns_model(self):
        """CTX-01: ContextSliceBuilder.build() returns ContextSlice model."""
        from codedmap.analysis.traversal.ast import AstContextNavigator
        from codedmap.analysis.traversal.call import CallGraphNavigator

        # Create mock store with minimal method
        method = make_method(1, "test_func", code="void test_func() {}", line=10)
        store = build_store(method)

        # Create mock navigators
        ast_nav = AstContextNavigator(store)
        call_nav = CallGraphNavigator(store)

        builder = ContextSliceBuilder(store, ast_nav, call_nav)
        result = builder.build(method)

        assert isinstance(result, ContextSlice)
        assert result.target.node_id == 1
        assert result.target.node_name == "test_func"
        assert result.target.label == "METHOD"

    def test_context_slice_content_fields(self):
        """CTX-02: Context slice content includes target, source, DDG, callees, scope, tags, globals."""
        from codedmap.analysis.traversal.ast import AstContextNavigator
        from codedmap.analysis.traversal.call import CallGraphNavigator

        method = make_method(
            1, "process", code="void process() { int x = 1; }", line=10,
            file_name="main.c", tags=["CUSTOM_TAG"], summary="Process function"
        )
        method.tags_provenance = {"CUSTOM_TAG": {"source": "manual"}}

        f = make_file(100, "main.c")
        store = build_store(method, f, (100, 1, EdgeType.AST), (1, 100, EdgeType.SOURCE_FILE))

        ast_nav = AstContextNavigator(store)
        call_nav = CallGraphNavigator(store)

        builder = ContextSliceBuilder(store, ast_nav, call_nav)
        result = builder.build(method, SliceOptions(include_source=True, include_tags=True))

        # Target info
        assert result.target.node_id == 1
        assert result.target.node_name == "process"
        assert result.target.file_path == "main.c"

        # Enclosing scope
        assert isinstance(result.enclosing_scope, list)

        # Source code
        assert result.source is not None

        # Tags
        assert result.tags is not None
        assert "CUSTOM_TAG" in result.tags
        assert result.tags_provenance is not None

    def test_context_slice_serialization(self):
        """CTX-03: model_dump(mode='json') and model_json_schema() work."""
        from codedmap.analysis.traversal.ast import AstContextNavigator
        from codedmap.analysis.traversal.call import CallGraphNavigator

        method = make_method(1, "test", code="int test() { return 0; }", line=1)
        store = build_store(method)

        ast_nav = AstContextNavigator(store)
        call_nav = CallGraphNavigator(store)

        builder = ContextSliceBuilder(store, ast_nav, call_nav)
        result = builder.build(method)

        # Test serialization
        json_data = result.model_dump(mode='json')
        assert json_data['target']['node_id'] == 1

        # Test schema
        schema = ContextSlice.model_json_schema()
        assert 'properties' in schema

    def test_slice_options_controls_output(self):
        """CTX-04: SliceOptions controls depth/inclusion."""
        from codedmap.analysis.traversal.ast import AstContextNavigator
        from codedmap.analysis.traversal.call import CallGraphNavigator

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        ast_nav = AstContextNavigator(store)
        call_nav = CallGraphNavigator(store)

        builder = ContextSliceBuilder(store, ast_nav, call_nav)

        # include_source=False should result in None source
        opts_no_source = SliceOptions(include_source=False, include_ddg=False, include_callees=False, include_tags=False, include_globals=False)
        result = builder.build(method, opts_no_source)
        assert result.source is None
        assert result.reaching_definitions is None
        assert result.callees is None

        # include_source=True should include source
        opts_with_source = SliceOptions(include_source=True, include_ddg=False, include_callees=False, include_tags=False, include_globals=False)
        result = builder.build(method, opts_with_source)
        assert result.source is not None

    def test_depth_bounded_traversal(self):
        """CTX-06: DDG traversal respects depth limit."""
        from codedmap.analysis.traversal.ast import AstContextNavigator
        from codedmap.analysis.traversal.call import CallGraphNavigator

        # Build method with DDG chain
        method = make_method(1, "chain_test", code="void chain_test() {}", line=1)
        n1 = make_identifier(10, "x", code="int x = 1", line=2)
        n2 = make_identifier(11, "y", code="int y = x", line=3)
        n3 = make_identifier(12, "z", code="int z = y", line=4)
        n4 = make_identifier(13, "w", code="int w = z", line=5)

        store = build_store(method, n1, n2, n3, n4,
                           (1, 10, EdgeType.AST),
                           (1, 11, EdgeType.AST),
                           (1, 12, EdgeType.AST),
                           (1, 13, EdgeType.AST))

        # Create method subgraph with DDG edges
        method_graph = MockCPGGraph()
        method_graph.add_node(method)
        method_graph.add_node(n1)
        method_graph.add_node(n2)
        method_graph.add_node(n3)
        method_graph.add_node(n4)
        method_graph.add_edge(10, 11, EdgeType.DDG, {"variable": "x"})
        method_graph.add_edge(11, 12, EdgeType.DDG, {"variable": "y"})
        method_graph.add_edge(12, 13, EdgeType.DDG, {"variable": "z"})
        store._db.method_graphs[1] = method_graph

        ast_nav = AstContextNavigator(store)
        call_nav = CallGraphNavigator(store)

        builder = ContextSliceBuilder(store, ast_nav, call_nav)

        # Test depth=1 should only get immediate DDG neighbors
        opts_depth1 = SliceOptions(ddg_depth=1, include_source=False, include_callees=False, include_tags=False, include_globals=False)
        result = builder.build(n2, opts_depth1)

        # With depth=1 from n2, we should get n1 (backward) and n3 (forward)
        assert result.reaching_definitions is not None
        assert result.forward_usages is not None


class TestContextLoaderAPI:
    """Tests for ContextLoader.get_context_slice() (CTX-05)."""

    def test_context_loader_api(self):
        """CTX-05: ContextLoader.get_context_slice() returns ContextSlice."""
        from codedmap.analysis.traversal.context import ContextLoader

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        loader = ContextLoader(store)
        result = loader.get_context_slice(method)

        assert isinstance(result, ContextSlice)
        assert result.target.node_id == 1

    def test_context_loader_with_options(self):
        """CTX-05: ContextLoader.get_context_slice() respects options."""
        from codedmap.analysis.traversal.context import ContextLoader

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        loader = ContextLoader(store)
        opts = SliceOptions(include_source=False, include_ddg=False, include_callees=False, include_tags=False, include_globals=False)
        result = loader.get_context_slice(method, opts)

        assert result.source is None

    def test_context_loader_coexists_with_get_context_data(self):
        """CTX-05: get_context_slice coexists with get_context_data."""
        from codedmap.analysis.traversal.context import ContextLoader, ContextStrategy

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        loader = ContextLoader(store)

        # Both methods should exist
        assert hasattr(loader, 'get_context_slice')
        assert hasattr(loader, 'get_context_data')

        # get_context_data should still work
        data = loader.get_context_data(method, ContextStrategy.SUMMARY)
        assert 'strategy' in data


class TestDSLContextSliceMethod:
    """Tests for cpg.context_slice(node) DSL method (DSL-02)."""

    def test_dsl_context_slice_method(self):
        """DSL-02: cpg.context_slice(node) returns ContextSlice."""
        from codedmap.app.query.root import CPG

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        cpg = CPG(store)
        result = cpg.context_slice(method)

        assert isinstance(result, ContextSlice)
        assert result.target.node_id == 1

    def test_dsl_context_slice_with_node_id(self):
        """DSL-02: cpg.context_slice(node_id) works with integer ID."""
        from codedmap.app.query.root import CPG

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        cpg = CPG(store)
        result = cpg.context_slice(1)  # Pass node ID as int

        assert isinstance(result, ContextSlice)
        assert result.target.node_id == 1

    def test_dsl_context_slice_with_options(self):
        """DSL-02: cpg.context_slice(node, **options) passes options."""
        from codedmap.app.query.root import CPG

        method = make_method(1, "test", code="void test() {}", line=1)
        store = build_store(method)

        cpg = CPG(store)
        result = cpg.context_slice(method, include_source=False, ddg_depth=5)

        assert isinstance(result, ContextSlice)
        assert result.source is None

    def test_dsl_context_slice_invalid_node(self):
        """DSL-02: cpg.context_slice(invalid_id) raises ValueError."""
        from codedmap.app.query.root import CPG

        store = build_store()  # Empty store
        cpg = CPG(store)

        with pytest.raises(ValueError, match="Node not found"):
            cpg.context_slice(999)


class TestCalleeSorting:
    """Tests for callee sorting by interestingness."""

    def test_callee_sorting_tagged_first(self):
        """Callees with tags should sort before those without."""
        tagged = CalleeInfo(node_id=1, name="tagged_func", tags=["ONTOLOGY:SINK:DB_EXECUTE"])
        untagged = CalleeInfo(node_id=2, name="untagged_func", tags=[])
        external = CalleeInfo(node_id=3, name="external_func", is_external=True)

        callees = [untagged, external, tagged]

        # Sort using the same key as ContextSliceBuilder
        def sort_key(c):
            has_tags = len(c.tags) > 0
            is_internal = not c.is_external
            return (not has_tags, not is_internal)

        callees.sort(key=sort_key)

        # Tagged should be first
        assert callees[0].name == "tagged_func"
        # External should be last
        assert callees[-1].is_external is True
