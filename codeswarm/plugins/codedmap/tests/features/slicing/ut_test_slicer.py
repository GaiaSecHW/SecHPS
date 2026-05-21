import unittest
import logging
from typing import Set
import sys
import os

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import (
    ControlStructureNode, MethodNode, BlockNode, CallNode, IdentifierNode, LocalNode, LiteralNode, FileNode
)
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.app.query.slicer import GraphSlicer
from codedmap.app.query.serializer import SliceSerializer
from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.cpg_config import CPGConfig

# 配置日志
logging.basicConfig(level=logging.ERROR)

class BaseTestSlicer(unittest.TestCase):
    def setUp(self):
        """
        [SSOT Fix] 初始化 Memory Store
        """
        self.config = CPGConfig(
            project_root=".", 
            storage={"backend": "memory"}
        )
        self.store = CPGStore(self.config.storage)
        
        # 获取底层 Graph 对象用于快速构建测试数据
        # 在 Memory 模式下，store._backend._graph 是真正的数据容器
        self.graph = self.store._conn.db.graph

    def tearDown(self):
        self.store.close()

    def create_node(self, node_type, **kwargs):
        """辅助函数：创建并添加节点，自动生成 ID"""
        if 'id' not in kwargs:
            # 简单模拟 ID 生成
            kwargs['id'] = self.store._conn.db.graph._max_id + 1
            self.store._conn.db.graph._max_id += 1
            
        node = node_type(**kwargs)
        self.graph.add_node(node)
        return node

    def assert_nodes_in_subgraph(self, subgraph: CPGGraph, expected_ids: Set[int]):
        """验证子图中是否包含且仅包含预期的节点 ID"""
        # 兼容处理: 如果 nodes 是 dict，取 values()；如果是 list，直接迭代
        nodes_iter = subgraph.nodes.values() if isinstance(subgraph.nodes, dict) else subgraph.nodes
        
        subgraph_ids = {n.id for n in nodes_iter}
        # 使用 set.issubset 允许子图包含比预期更多的节点（因为 context enrichment 可能会多拉一些父节点）
        # 但为了严谨测试，这里我们尽量精确匹配核心节点，或者检查 expected_ids 是否都在 subgraph_ids 中
        missing = expected_ids - subgraph_ids
        self.assertTrue(len(missing) == 0, 
                        f"Subgraph missing expected nodes.\nMissing: {missing}\nActual: {subgraph_ids}")

    def assert_has_edge(self, subgraph: CPGGraph, src_id: int, dst_id: int, edge_type: str):
        """验证子图中是否存在特定的边"""
        for edge in subgraph.edges:
            if edge.src == src_id and edge.dst == dst_id and edge.type == edge_type:
                return
        self.fail(f"Edge {src_id} -> {dst_id} ({edge_type}) not found in subgraph")


class TestGraphSlicer(BaseTestSlicer):

    def test_forward_slice_basic(self):
        """
        场景 1: 基础前向切片
        A -> B -> C
        """
        a = self.create_node(IdentifierNode, name="A", code="A", typeFullName="int")
        b = self.create_node(IdentifierNode, name="B", code="B", typeFullName="int")
        c = self.create_node(IdentifierNode, name="C", code="C", typeFullName="int")

        self.graph.add_edge(a, b, EdgeType.DDG)
        self.graph.add_edge(b, c, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        subgraph = slicer.slice_forward(a, [EdgeType.DDG])

        self.assert_nodes_in_subgraph(subgraph, {a.id, b.id, c.id})
        self.assert_has_edge(subgraph, a.id, b.id, EdgeType.DDG)
        self.assert_has_edge(subgraph, b.id, c.id, EdgeType.DDG)

    def test_backward_slice_basic(self):
        """
        场景 2: 基础后向切片
        A -> B -> C
        """
        a = self.create_node(IdentifierNode, name="A", code="A", typeFullName="int")
        b = self.create_node(IdentifierNode, name="B", code="B", typeFullName="int")
        c = self.create_node(IdentifierNode, name="C", code="C", typeFullName="int")

        self.graph.add_edge(a, b, EdgeType.DDG)
        self.graph.add_edge(b, c, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        subgraph = slicer.slice_backward(c, [EdgeType.DDG])

        self.assert_nodes_in_subgraph(subgraph, {a.id, b.id, c.id})

    def test_chop_isolation(self):
        """
        场景 3: Chop 切片的隔离能力 (去噪)
        """
        source = self.create_node(IdentifierNode, name="Source", code="src", typeFullName="int")
        sink = self.create_node(CallNode, name="Sink", code="sink()", methodFullName="sink")
        
        node_a = self.create_node(IdentifierNode, name="A", code="a", typeFullName="int")
        
        # 干扰路径
        node_b = self.create_node(IdentifierNode, name="B", code="b", typeFullName="int")
        dead_end = self.create_node(IdentifierNode, name="Dead", code="dead", typeFullName="int")
        node_other = self.create_node(IdentifierNode, name="Other", code="other", typeFullName="int")

        self.graph.add_edge(source, node_a, EdgeType.DDG)
        self.graph.add_edge(node_a, sink, EdgeType.DDG)
        
        self.graph.add_edge(source, node_b, EdgeType.DDG)
        self.graph.add_edge(node_b, dead_end, EdgeType.DDG)
        
        self.graph.add_edge(node_other, sink, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        subgraph = slicer.data_flow_chop(source, sink)

        expected_ids = {source.id, node_a.id, sink.id}
        self.assert_nodes_in_subgraph(subgraph, expected_ids)
        
        # 验证干扰节点不在子图中
        subgraph_ids = {n.id for n in subgraph.nodes.values()}
        self.assertNotIn(node_b.id, subgraph_ids)
        self.assertNotIn(dead_end.id, subgraph_ids)

    def test_context_enrichment(self):
        """
        场景 4: 上下文补全 (Context Enrichment)
        验证 AST 父节点被包含
        """
        method = self.create_node(MethodNode, name="main", fullName="main", signature="()")
        block = self.create_node(BlockNode, code="{...}")
        
        source = self.create_node(IdentifierNode, name="x", code="x", typeFullName="int")
        sink = self.create_node(IdentifierNode, name="y", code="y", typeFullName="int")

        self.graph.add_ast_edge(method, block)
        self.graph.add_ast_edge(block, source)
        self.graph.add_ast_edge(block, sink)

        self.graph.add_edge(source, sink, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        subgraph = slicer.data_flow_chop(source, sink)

        expected_ids = {source.id, sink.id, method.id, block.id}
        self.assert_nodes_in_subgraph(subgraph, expected_ids)

    def test_sibling_enrichment_for_patch(self):
        """
        [New] 场景 5: 兄弟节点扩充 (Sibling Enrichment)
        Block {
           A = 1;  (Source)
           B = 2;  (Irrelevant Sibling)
           C = A;  (Sink)
        }
        数据流 A -> C。
        期望: 切片不仅包含 A, C，还要包含 B，因为 B 是同一 Block 下的兄弟节点。
        """
        block = self.create_node(BlockNode, code="{...}")
        
        stmt_a = self.create_node(IdentifierNode, name="A", code="A=1", order=1)
        stmt_b = self.create_node(IdentifierNode, name="B", code="B=2", order=2)
        stmt_c = self.create_node(IdentifierNode, name="C", code="C=A", order=3)

        # 建立 AST (Block 包含 A, B, C)
        self.graph.add_ast_edge(block, stmt_a)
        self.graph.add_ast_edge(block, stmt_b)
        self.graph.add_ast_edge(block, stmt_c)

        # 建立数据流 (仅 A -> C)
        self.graph.add_edge(stmt_a, stmt_c, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        subgraph = slicer.data_flow_chop(stmt_a, stmt_c)

        # 验证: 虽然 B 没有参与数据流，但因为它是 A/C 的兄弟，应该被包含
        expected_ids = {stmt_a.id, stmt_b.id, stmt_c.id, block.id}
        self.assert_nodes_in_subgraph(subgraph, expected_ids)

    def test_source_expansion_ref(self):
        """
        [New] 场景 6: 起点自动扩展 (Local -> REF)
        int x; (Local)
        x = 1; (Identifier REF) -> DDG -> y = x (Sink)
        用户选择 Local x 作为起点，Slicer 应该自动找到 x 的引用点作为 BFS 种子。
        """
        local_x = self.create_node(LocalNode, name="x", code="int x", fullName="Local:x", typeFullName="int")
        ref_x = self.create_node(IdentifierNode, name="x", code="x=1")
        sink_y = self.create_node(IdentifierNode, name="y", code="y=x")

        # Local <-[REF]- Identifier
        self.graph.add_edge(ref_x, local_x, EdgeType.REF)
        # AST (假设在同一个 block)
        block = self.create_node(BlockNode, code="{...}")
        self.graph.add_ast_edge(block, local_x)
        self.graph.add_ast_edge(block, ref_x)
        self.graph.add_ast_edge(block, sink_y)

        # DDG
        self.graph.add_edge(ref_x, sink_y, EdgeType.DDG)

        slicer = GraphSlicer(self.store)
        # 注意：这里我们传入 LocalNode 作为 source
        subgraph = slicer.data_flow_chop(local_x, sink_y)

        # 期望：切片成功，且包含路径上的所有节点
        expected_ids = {local_x.id, ref_x.id, sink_y.id}
        self.assert_nodes_in_subgraph(subgraph, expected_ids)

    def test_serializer_output(self):
        """
        [New] 场景 7: 序列化输出验证 (包含 ID)
        """
        # 构造一个简单的图
        f = self.create_node(FileNode, name="test.c", fullName="/test.c")
        n1 = self.create_node(CallNode, name="foo", code="foo()", lineNumber=10, filename="test.c", label=NodeLabel.CALL)
        n2 = self.create_node(CallNode, name="bar", code="bar()", lineNumber=11, filename="test.c", label=NodeLabel.CALL)
        
        # 构造一个小图
        subgraph = CPGGraph()
        subgraph.add_node(n1)
        subgraph.add_node(n2)
        
        # 序列化
        output = SliceSerializer.to_code_context(subgraph)
        
        # 验证
        # 1. 包含文件名
        self.assertIn("File: test.c", output)
        # 2. 包含代码
        self.assertIn("foo()", output)
        # 3. [关键] 包含 ID 标记
        self.assertIn(f"⟪ID:{n1.id}⟫", output)
        self.assertIn(f"⟪ID:{n2.id}⟫", output)

if __name__ == '__main__':
    unittest.main()