import unittest
import logging
from typing import Optional

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

# 导入核心组件
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.nodes import (
    MethodNode, MethodReturnNode, MethodParameterInNode, 
    CallNode, LiteralNode, IdentifierNode, BlockNode
)
from codedmap.core.schema.graph.enums import EdgeType, DispatchType, NodeLabel
from codedmap.analysis.passes.batch.pdg import PDGPass
from codedmap.infra.storage.store import CPGStore
from codedmap.core.configs.cpg_config import CPGConfig

# 配置日志
logging.basicConfig(level=logging.DEBUG)

class BaseTestPDG(unittest.TestCase):
    """
    PDG 测试基类 (SSOT 适配版)
    """

    def setUp(self):
        # [Fix] 初始化 Store 而非 Graph
        self.config = CPGConfig(
            project_root=".", 
            storage={"backend": "memory"}
        )
        self.store = CPGStore(self.config.storage)
        # 获取底层 graph 用于数据注入 (Cheat Sheet)
        self.graph = self.store._conn.db.graph

    def tearDown(self):
        self.store.close()

    def create_method(self, name: str, params: list[str] = [], return_type: str = "int") -> tuple[MethodNode, MethodReturnNode, list[MethodParameterInNode]]:
        """创建一个完整的方法结构"""
        method_full_name = name 
        method = MethodNode(
            name=name, 
            fullName=method_full_name, 
            signature="()", 
            code=f"{name}()",
            label=NodeLabel.METHOD
        )
        self.graph.add_node(method)

        param_nodes = []
        for i, p_name in enumerate(params):
            param = MethodParameterInNode(
                name=p_name,
                fullName=f"{method_full_name}.{p_name}",
                code=f"int {p_name}", 
                typeFullName="int", 
                order=i + 1,
                label=NodeLabel.METHOD_PARAMETER_IN
            )
            self.graph.add_node(param)
            self.graph.add_ast_edge(method, param)
            param_nodes.append(param)

        ret = MethodReturnNode(
            name="RET", 
            fullName=f"{method_full_name}.RET",
            typeFullName=return_type, 
            code="RET",
            label=NodeLabel.METHOD_RETURN
        )
        self.graph.add_node(ret)
        self.graph.add_ast_edge(method, ret)

        return method, ret, param_nodes

    def create_call(self, caller_method: MethodNode, callee_method: Optional[MethodNode], args: list[str]) -> tuple[CallNode, list[LiteralNode]]:
        """
        创建一个调用点
        """
        call_name = callee_method.name if callee_method else "unknown_func"
        call_full_name = callee_method.full_name if callee_method else f"<unknown>.{call_name}"
        
        call_node = CallNode(
            name=call_name, 
            methodFullName=call_full_name, 
            code=f"{call_name}(...)",
            dispatchType=DispatchType.STATIC_DISPATCH,
            label=NodeLabel.CALL
        )
        self.graph.add_node(call_node)
        
        # 挂载到调用者 AST (必须有，否则 DSL 可能查不到 Context)
        self.graph.add_ast_edge(caller_method, call_node)
        self.graph.add_edge(caller_method, call_node, EdgeType.CONTAINS)

        arg_nodes = []
        for i, arg_val in enumerate(args):
            arg = LiteralNode(
                code=arg_val, 
                typeFullName="int", 
                argumentIndex=i + 1,
                label=NodeLabel.LITERAL
            )
            self.graph.add_node(arg)
            self.graph.add_ast_edge(call_node, arg)
            # Joern 规范：同时需要 ARGUMENT 边
            self.graph.add_edge(call_node, arg, EdgeType.ARGUMENT, argumentIndex=i+1)
            arg_nodes.append(arg)

        # 建立 Call Graph 边
        if callee_method:
            self.graph.add_edge(call_node, callee_method, EdgeType.CALL)

        return call_node, arg_nodes

    def has_ddg_edge(self, src: AnyNode, dst: AnyNode) -> bool:
        """断言辅助：检查是否存在 DDG 边"""
        # 注意：SSOT 模式下，pass.run() 会通过 store.save() 写回 backend。
        # 在 Memory 模式下，这等同于更新 self.graph。
        # 我们可以直接遍历 self.graph.edges，或者通过 store 查询。
        for edge in self.graph.edges:
            if edge.type == EdgeType.DDG and edge.src == src.id and edge.dst == dst.id:
                return True
        return False


class TestPDG(BaseTestPDG):

    def test_return_value_flow(self):
        """场景 1: 返回值传递"""
        source_method, source_ret, _ = self.create_method("source", return_type="int")
        main_method, _, _ = self.create_method("main")
        call_site, _ = self.create_call(main_method, source_method, [])

        # [Fix] 刷新索引
        self.store._conn.db._rebuild_index()
        # [Fix] 传入 store
        PDGPass(self.store).run()

        self.assertTrue(self.has_ddg_edge(source_ret, call_site), 
                        "Should link MethodReturn to CallSite (Return Value Flow)")

    def test_argument_passing_simple(self):
        """场景 2: 简单参数传递"""
        sink_method, _, sink_params = self.create_method("sink", params=["p"])
        target_param = sink_params[0]

        main_method, _, _ = self.create_method("main")
        _, call_args = self.create_call(main_method, sink_method, args=["100"])
        arg_node = call_args[0]

        self.store._conn.db._rebuild_index()
        PDGPass(self.store).run()

        self.assertTrue(self.has_ddg_edge(arg_node, target_param),
                        "Should link Call Argument to Method Parameter")

    def test_argument_order_strictness(self):
        """场景 3: 多参数顺序匹配"""
        add_method, _, add_params = self.create_method("add", params=["x", "y"])
        param_x = add_params[0]
        param_y = add_params[1]

        main_method, _, _ = self.create_method("main")
        _, call_args = self.create_call(main_method, add_method, args=["A", "B"])
        arg_a = call_args[0]
        arg_b = call_args[1]

        self.store._conn.db._rebuild_index()
        PDGPass(self.store).run()

        self.assertTrue(self.has_ddg_edge(arg_a, param_x), "Arg 1 should link to Param 1")
        self.assertTrue(self.has_ddg_edge(arg_b, param_y), "Arg 2 should link to Param 2")
        self.assertFalse(self.has_ddg_edge(arg_a, param_y), "Arg 1 should NOT link to Param 2")
        self.assertFalse(self.has_ddg_edge(arg_b, param_x), "Arg 2 should NOT link to Param 1")

    def test_argument_mismatch_robustness(self):
        """场景 4: 鲁棒性 - 实参多于形参"""
        printf_method, _, params = self.create_method("printf", params=["f"])
        param_f = params[0]

        main_method, _, _ = self.create_method("main")
        _, args = self.create_call(main_method, printf_method, args=["fmt", "100"])
        arg_fmt = args[0]
        arg_extra = args[1]

        self.store._conn.db._rebuild_index()
        try:
            PDGPass(self.store).run()
        except Exception as e:
            self.fail(f"PDGPass crashed on argument mismatch: {e}")

        self.assertTrue(self.has_ddg_edge(arg_fmt, param_f), "Matching argument should link")
        
        has_outgoing = any(e.src == arg_extra.id and e.type == EdgeType.DDG for e in self.graph.edges)
        self.assertFalse(has_outgoing, "Extra argument should not have DDG edges")

    def test_unresolved_call(self):
        """场景 5: 未解析的调用"""
        main_method, _, _ = self.create_method("main")
        call_site, _ = self.create_call(main_method, None, args=["1"])
        
        self.store._conn.db._rebuild_index()
        PDGPass(self.store).run()

        has_incoming = any(e.dst == call_site.id and e.type == EdgeType.DDG for e in self.graph.edges)
        self.assertFalse(has_incoming, "Unresolved call should not have incoming data flow")

if __name__ == '__main__':
    unittest.main()