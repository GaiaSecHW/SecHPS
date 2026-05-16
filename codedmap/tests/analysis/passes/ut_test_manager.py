import unittest
import time
from typing import Optional
from unittest.mock import MagicMock

import sys
import os
# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.passes.base_batch import BatchPass
from codedmap.analysis.passes.manager import PassManager

# ==========================================
# 1. 定义 Mock Passes (适配 SSOT 签名)
# ==========================================

class MockPassA(BatchPass):
    """用于测试执行顺序的 Pass A"""
    def run(self):
        # [Fix] 将执行痕迹记录到 store 中 (MockStore 充当黑板)
        # 注意：Mock对象通常会自动创建属性，但为了保险起见，我们在setUp中已初始化trace
        self.store.trace.append("A")

class MockPassB(BatchPass):
    """用于测试执行顺序的 Pass B"""
    def run(self):
        self.store.trace.append("B")

class MockPassWithArgs(BatchPass):
    """用于测试参数注入 (Dependency Injection)"""
    def __init__(self, store, config=None, agent=None, threshold=0.0):
        # [Fix] 调用父类 __init__(store, config)
        super().__init__(store, config)
        self.agent = agent
        self.threshold = threshold

    def run(self):
        # 将接收到的参数存入 store 以便验证
        self.store.received_args = {
            "agent": self.agent,
            "threshold": self.threshold
        }

class MockFailingPass(BatchPass):
    """用于测试容错性，故意抛出异常"""
    def run(self):
        raise ValueError("Intentional Failure")

class MockSlowPass(BatchPass):
    """用于测试耗时统计"""
    def run(self):
        time.sleep(0.1)

# ==========================================
# 2. 测试类
# ==========================================

class TestPassManager(unittest.TestCase):

    def setUp(self):
        # [Fix] 基础环境准备：核心是 Mock Store
        # 使用 spec=CPGStore 保证接口一致性
        self.store = MagicMock(spec=CPGStore)
        # 手动挂载测试所需的动态属性 (Mock 实例允许动态添加属性)
        self.store.trace = []
        self.store.received_args = {}
        
        # [Fix] Mock Config
        self.config = MagicMock(spec=CPGConfig)
        
        # 关键修复：显式配置嵌套的 parser mock
        # 因为 spec=CPGConfig 可能会限制直接的链式赋值
        parser_mock = MagicMock()
        parser_mock.fail_fast = False
        self.config.parser = parser_mock
        
        # [Fix] 初始化 Manager (Signature Change: config, store)
        self.manager = PassManager(config=self.config, store=self.store)

    def test_priority_execution_order(self):
        """
        场景 1: 优先级排序
        注册 Pass A (Priority 10) 和 Pass B (Priority 1)。
        预期执行顺序: B -> A
        """
        # 故意先注册优先级低的
        self.manager.register(MockPassA, priority=10)
        self.manager.register(MockPassB, priority=1)
        
        self.manager.run_all()
        
        expected_trace = ["B", "A"]
        self.assertEqual(self.store.trace, expected_trace, 
                         "Passes should execute in ascending order of priority")

    def test_dependency_injection(self):
        """
        场景 2: 依赖注入 (Kwargs)
        注册时传递 extra arguments，验证 Pass 实例能否正确接收。
        """
        dummy_agent = "Agent-007"
        
        self.manager.register(
            MockPassWithArgs, 
            priority=5, 
            agent=dummy_agent, 
            threshold=0.95
        )
        
        self.manager.run_all()
        
        # 检查 store.received_args
        self.assertEqual(self.store.received_args['agent'], dummy_agent)
        self.assertEqual(self.store.received_args['threshold'], 0.95)

    def test_skip_disabled_pass(self):
        """
        场景 3: 禁用 Pass
        注册 Pass 但设置 enabled=False。
        预期: 该 Pass 不被执行。
        """
        self.manager.register(MockPassA, priority=1, enabled=False)
        self.manager.register(MockPassB, priority=2, enabled=True)
        
        self.manager.run_all()
        
        self.assertEqual(self.store.trace, ["B"], "Disabled passes should be skipped")

    def test_fault_tolerance(self):
        """
        场景 4: 容错性 (Graceful Degradation)
        中间某个 Pass 崩溃，不应影响后续 Pass 执行。
        顺序: PassA -> FailingPass -> PassB
        """
        self.manager.register(MockPassA, priority=1)
        self.manager.register(MockFailingPass, priority=2)
        self.manager.register(MockPassB, priority=3)
        
        # 捕获日志以避免测试输出变脏
        with self.assertLogs('codedmap.passes.manager', level='ERROR') as log:
            self.manager.run_all()
            
            # 验证错误被记录了
            self.assertTrue(any("Intentional Failure" in m for m in log.output))

        # 核心验证: 尽管中间挂了，B 依然执行了
        self.assertEqual(self.store.trace, ["A", "B"])
        
        # 验证 stats 状态 (-1.0 代表失败)
        self.assertEqual(self.manager.stats['MockFailingPass'], -1.0)
        self.assertGreater(self.manager.stats['MockPassA'], 0)

    def test_performance_stats(self):
        """
        场景 5: 性能监控
        验证是否记录了 Pass 的运行时间。
        """
        self.manager.register(MockSlowPass, priority=1)
        
        self.manager.run_all()
        
        duration = self.manager.stats.get('MockSlowPass')
        self.assertIsNotNone(duration)
        # 允许一点误差，但肯定大约 0.1s
        self.assertTrue(0.09 <= duration <= 0.20, f"Duration {duration} out of expected range")

    def test_config_propagation(self):
        """
        场景 6: Config 传递
        验证 Config 对象被正确传给了 Pass。
        """
        class ConfigCheckPass(BatchPass):
            def run(self):
                # 如果 config 是 None，这里会报错
                if self.config is None:
                    raise ValueError("Config missing")
                # 将结果标记在 store 上
                self.store.config_received = True

        self.manager.register(ConfigCheckPass)
        self.manager.run_all()
        
        self.assertTrue(getattr(self.store, 'config_received', False))

if __name__ == '__main__':
    unittest.main()