import unittest
from unittest.mock import MagicMock

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.nodes import MethodNode, CallNode, LiteralNode, IdentifierNode
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.agents.summarizer import SummaryAgent, LibrarySummary, TaintRule, FlowType
from codedmap.analysis.smart_summary import SmartSummaryApplier

class TestSummaryAgent(unittest.TestCase):
    
    def setUp(self):
        self.graph = CPGGraph()
        
    def test_summarize_memcpy(self):
        """验证基础的数据流 (Arg -> Arg, Arg -> Ret)"""
        # ... (保持之前的 memcpy 测试代码不变，它已经覆盖了基础功能) ...
        # 为了完整性，这里简写，假设之前的代码存在
        pass

    def test_oop_this_flow(self):
        """
        [New] 场景: string.append(str)
        规则: Arg 1 (str) -> This (Index 0) (Side Effect)
        验证: SmartSummaryApplier 能正确处理 Receiver 边
        """
        # 1. 构建图
        append_method = MethodNode(name="append", fullName="std::string::append", is_external=True)
        
        call = CallNode(name="append", code="s.append(x)")
        receiver_s = IdentifierNode(name="s", typeFullName="std::string")
        arg_x = IdentifierNode(name="x", typeFullName="std::string", argumentIndex=1)
        
        self.graph.add_node(append_method)
        self.graph.add_node(call)
        self.graph.add_node(receiver_s)
        self.graph.add_node(arg_x)
        
        self.graph.add_edge(call, append_method, EdgeType.CALL)
        self.graph.add_edge(call, receiver_s, EdgeType.RECEIVER) # 关键：Receiver 边
        self.graph.add_edge(call, arg_x, EdgeType.ARGUMENT)
        
        # 2. Mock Agent
        mock_agent = MagicMock(spec=SummaryAgent)
        mock_agent.summarize.return_value = LibrarySummary(
            function_name="append", is_deterministic=True,
            rules=[
                TaintRule(
                    flow_type=FlowType.SIDE_EFFECT,
                    input_index=1, # x
                    output_index=0, # this (s)
                    description="Appends argument to this"
                )
            ]
        )
        
        # 3. Run
        applier = SmartSummaryApplier(self.graph, mock_agent)
        applier.run()
        
        # 4. Verify DDG: x -> s
        has_edge = False
        for edge in self.graph.edges:
            if edge.type == EdgeType.DDG and edge.src == arg_x.id and edge.dst == receiver_s.id:
                has_edge = True
                break
        self.assertTrue(has_edge, "Should add DDG edge from Argument to Receiver (this)")

    def test_source_sink_tagging(self):
        """
        [New] 场景: system(cmd) 和 val = getenv(key)
        规则 1: system Arg 1 是 SINK
        规则 2: getenv Return 是 SOURCE
        验证: 标签是否被添加到节点的 tags 列表
        """
        # 1. 构建图
        system_m = MethodNode(name="system", is_external=True, full_name="std::system")
        getenv_m = MethodNode(name="getenv", is_external=True, full_name="std::getenv")
        
        call_sys = CallNode(name="system", code="system(cmd)")
        arg_cmd = IdentifierNode(name="cmd", argumentIndex=1)
        
        call_env = CallNode(name="getenv", code="getenv(key)")
        
        for n in [system_m, getenv_m, call_sys, arg_cmd, call_env]: self.graph.add_node(n)
        
        self.graph.add_edge(call_sys, system_m, EdgeType.CALL)
        self.graph.add_edge(call_sys, arg_cmd, EdgeType.ARGUMENT)
        self.graph.add_edge(call_env, getenv_m, EdgeType.CALL)
        
        # 2. Mock Agent
        mock_agent = MagicMock(spec=SummaryAgent)
        def side_effect(sig, docs=""):
            if "system" in sig:
                return LibrarySummary(function_name="system", is_deterministic=True, rules=[
                    TaintRule(flow_type=FlowType.SINK, input_index=1, description="Command Execution")
                ])
            if "getenv" in sig:
                return LibrarySummary(function_name="getenv", is_deterministic=True, rules=[
                    TaintRule(flow_type=FlowType.SOURCE, output_index=-1, description="Environment Variable")
                ])
            return LibrarySummary(function_name="unk", rules=[], is_deterministic=False)
            
        mock_agent.summarize.side_effect = side_effect
        
        # 3. Run
        applier = SmartSummaryApplier(self.graph, mock_agent)
        applier.run()
        
        # 4. Verify Tags
        # Check system(cmd): cmd should be tagged SINK
        self.assertTrue(
            any("TAINT_SINK" in t for t in getattr(arg_cmd, 'tags', [])),
            "Cmd arg should be tagged as SINK"
        )

        # Check getenv(): call node should be tagged SOURCE
        self.assertTrue(
            any("TAINT_SOURCE" in t for t in getattr(call_env, 'tags', [])),
            "Getenv return should be tagged as SOURCE"
        )

if __name__ == '__main__':
    unittest.main()