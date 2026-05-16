import unittest
from unittest.mock import MagicMock

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode, CallNode, BlockNode
from codedmap.core.schema.graph.enums import EdgeType, DispatchType
from codedmap.agents.resolver import ResolverAgent, ResolverDecision, PotentialTarget
from codedmap.passes.smart_resolver import SmartGraphResolver

class TestResolverAgent(unittest.TestCase):
    
    def setUp(self):
        self.graph = CPGGraph()
        
    def test_resolve_function_pointer(self):
        """
        场景: C语言函数指针
        void (*fp)(int) = &my_handler;
        fp(1); // Dynamic Dispatch
        
        目标: Agent 识别出 fp 指向 my_handler，并建立 CALL 边。
        """
        # 1. 构建图
        # 目标函数
        handler = MethodNode(name="my_handler", fullName="my_handler", code="void my_handler(int x){}")
        
        # 调用者函数
        main = MethodNode(name="main", fullName="main", code="void main() { ... }")
        
        # 动态调用点
        call_dynamic = CallNode(
            name="fp", 
            methodFullName="ANY", # 未知
            code="fp(1)", 
            dispatchType=DispatchType.DYNAMIC_DISPATCH
        )
        
        self.graph.add_node(handler)
        self.graph.add_node(main)
        self.graph.add_node(call_dynamic)
        
        self.graph.add_ast_edge(main, call_dynamic) # 建立上下文关系
        
        # 2. Mock Agent
        mock_agent = MagicMock(spec=ResolverAgent)
        
        def mock_resolve(call_code, context_code, language="C/C++"):
            # 模拟 LLM 看到代码后的推理
            if "fp(1)" in call_code:
                return ResolverDecision(
                    targets=[
                        PotentialTarget(
                            method_name="my_handler", 
                            confidence=0.95, 
                            reasoning="Assignment 'fp = &my_handler' found in context."
                        )
                    ],
                    is_ambiguous=False
                )
            return ResolverDecision(targets=[], is_ambiguous=False)
            
        mock_agent.resolve.side_effect = mock_resolve
        
        # 3. 运行 Smart Resolver
        resolver = SmartGraphResolver(self.graph, mock_agent)
        resolver.run()
        
        # 4. 验证
        # 检查是否添加了 CALL 边: call_dynamic -> handler
        has_edge = False
        for edge in self.graph.edges:
            if edge.type == EdgeType.CALL and edge.src == call_dynamic.id and edge.dst == handler.id:
                has_edge = True
                break
        
        self.assertTrue(has_edge, "Resolver should link dynamic call to the actual method node")
        
        # 检查 CallNode 属性是否被修正
        self.assertEqual(call_dynamic.method_full_name, "my_handler")

if __name__ == '__main__':
    unittest.main()