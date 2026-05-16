import unittest
import shutil
import tempfile
import logging
import sys
import os
from typing import List, Optional

# 假设我们在项目根目录下运行
sys.path.append(os.getcwd())

from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.pipeline.frontend import FrontendPipeline, FrontendConfig
from codedmap.infra.storage.store import CPGStore
from codedmap.core.schema.graph import CPGGraph, AnyNode
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.core.schema.graph.nodes import MethodNode, CallNode, IdentifierNode, TypeDeclNode, ControlStructureNode, MethodParameterInNode, MethodParameterOutNode

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TestProjectBuilder")

class TestProjectBuilderComprehensive(unittest.TestCase):
    
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        
        # 1. 目录结构
        os.makedirs(os.path.join(self.test_dir, ".git"))
        os.makedirs(os.path.join(self.test_dir, "build"))
        os.makedirs(os.path.join(self.test_dir, "src", "cpp_core"))
        os.makedirs(os.path.join(self.test_dir, "lib"))

        # 2. 忽略文件
        with open(os.path.join(self.test_dir, ".git/config"), "w") as f: f.write("ignored")
        with open(os.path.join(self.test_dir, "build/temp.o"), "w") as f: f.write("ignored")
        with open(os.path.join(self.test_dir, "src/test_utils.c"), "w") as f: f.write("void test_func() {}")

        # 3. src/main.c
        with open(os.path.join(self.test_dir, "src/main.c"), "w") as f:
            f.write("""
            #include "utils.h"
            #include <stdio.h>
            int main() {
                int a = 42;
                int result = complex_math(a);
                printf("Result: %d\\n", result);
                return 0;
            }
            """)

        # 4. src/utils.c (C 语言逻辑测试)
        with open(os.path.join(self.test_dir, "src/utils.c"), "w") as f:
            f.write("""
            int complex_math(int input) {
                int x = 0;
                if (input > 10) {
                    x = input * 2;
                } else {
                    x = input + 5;
                }
                return x; 
            }
            """)

        # 5. src/cpp_core/engine.cpp (C++ 测试)
        with open(os.path.join(self.test_dir, "src/cpp_core/engine.cpp"), "w") as f:
            f.write("""
            namespace Core {
                class Engine {
                private:
                    int power;
                public:
                    void start() {
                        this->power = 100;
                    }
                };
            }
            """)
        
        # 6. lib/legacy.c
        with open(os.path.join(self.test_dir, "lib/legacy.c"), "w") as f: f.write("void legacy() {}")

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def _get_builder(self, n_workers=1):
        """辅助方法：创建一个配置为 Memory Storage 的 Builder"""
        config = CPGConfig(
            project_root=self.test_dir,
            parser={
                "languages": ["c", "cpp"], # 启用多种语言
                "skip_dirs": ["tests", "build", ".git"],
                "exclude_patterns": ["test_*.c", "*.old.c"],
                "n_workers": n_workers
            },
            storage={
                # [Fix] 关键：强制使用内存后端，否则无法在测试中直接断言
                "backend": "memory",
                "uri": ":memory:"
            },
            ai={"enable_llm": False}
        )
        frontend_config = FrontendConfig(
            parser=config.parser,
            storage=config.storage,
            ai=config.ai,
            pipeline=config.pipeline,
            dispatch=config.dispatch,
            project_root=config.project_root,
            project_name=config.project_name,
            _full_config_dict=config.model_dump(),
        )
        store = CPGStore(config.storage)
        store.init_db()
        return FrontendPipeline(frontend_config, store=store)

    def _get_graph_from_builder(self, builder: FrontendPipeline) -> CPGGraph:
        """
        [Fix] 辅助方法：从 Builder 的 Store 中提取 Graph。
        这是为了适配 SSTO 模式，不再直接访问 builder.graph
        """
        # 假设 CPGStore._backend 是 MemoryBackend，并且有一个 _graph 属性
        # 如果你的实现不同，请调整此处
        return builder.store._conn.db.graph

    def test_01_file_filtering(self):
        """测试 1: 文件过滤 (目录级 + 模式级)"""
        builder = self._get_builder()
        
        # 直接测试私有方法 _scan_files 验证过滤逻辑
        scanned_files = list(builder._scan_files())
        file_names = [f.name for f in scanned_files]
        
        self.assertIn("main.c", file_names)
        self.assertIn("utils.c", file_names)
        self.assertIn("engine.cpp", file_names)
        
        # 验证目录过滤
        self.assertFalse(any("test_utils.c" in f for f in file_names), "Should skip 'test_*.c' via exclude_patterns")
        self.assertNotIn("temp.o", file_names)
        
        print(f"✅ Test 01 Passed: Found {len(file_names)} valid files.")

    def test_02_c_logic_cfg_ddg(self):
        """测试 2: C 语言 CFG/DDG 逻辑 (修复版)"""
        builder = self._get_builder()
        builder.build() # build() 内部会自动调用 passes
        
        # [Fix] 从 store 获取 graph
        graph = self._get_graph_from_builder(builder)

        # 1. 验证 CFG (控制流)
        if_nodes = [n for n in graph.nodes.values() if isinstance(n, ControlStructureNode) and n.code == "<if>"] # 假设 if 的 label 或 code 特征
        # 或者更严谨地检查:
        if_nodes = [n for n in graph.nodes.values() if n.label == NodeLabel.CONTROL_STRUCTURE]
        
        self.assertTrue(len(if_nodes) >= 1, "ControlStructure node not found")
        if_node = if_nodes[0]

        # 查找 Condition 节点 (AST 的第一个子节点)
        children_ids = [e.dst for e in graph.edges if e.type == EdgeType.AST and e.src == if_node.id]
        children = [graph.nodes[nid] for nid in children_ids if nid in graph.nodes]
        # 按 order 排序
        children.sort(key=lambda x: getattr(x, 'order', 0) or 0)
        
        self.assertTrue(len(children) > 0, "IF node has no children")
        cond_node = children[0]
        
        print(f"DEBUG: Condition Node: {cond_node.label}, Code: '{cond_node.code}'")

        # 验证 CFG 边是从 Condition 节点出发的
        cfg_out_edges = [e for e in graph.edges if e.type == EdgeType.CFG and e.src == cond_node.id]
        labels = [e.properties.get("label") for e in cfg_out_edges]
        print(f"DEBUG: CFG Edge Labels from Condition: {labels}")

        self.assertIn("TRUE", labels, "Missing TRUE CFG edge from condition")
        self.assertIn("FALSE", labels, "Missing FALSE CFG edge from condition")

        # 2. 验证 DDG (数据流)
        # 查找所有对 'x' 的使用 (Use)
        x_usages = [
            n for n in graph.nodes.values() 
            if isinstance(n, IdentifierNode) and n.name == "x"
        ]
        
        # 验证是否至少有一个 x 有 DDG 入边
        has_ddg = False
        for usage in x_usages:
            in_edges = [e for e in graph.edges if e.type == EdgeType.DDG and e.dst == usage.id]
            if in_edges:
                has_ddg = True
                for e in in_edges:
                    src = graph.nodes[e.src]
                    print(f"DEBUG: DDG Edge found: {src.code} --[var={e.properties.get('variable')}]--> {usage.code}")
        
        self.assertTrue(has_ddg, "No DDG edges found for variable 'x'")
        print(f"✅ Test 02 Passed.")

    def test_03_cpp_features(self):
        """测试 3: C++ Namespace, Class, This (修复版)"""
        builder = self._get_builder()
        builder.build()
        graph = self._get_graph_from_builder(builder)

        # 1. 验证 Namespace
        # 注意：NamespaceBlockNode 的 label 可能是 NAMESPACE_BLOCK
        ns_nodes = [n for n in graph.nodes.values() if n.label == "NAMESPACE_BLOCK" and n.name == "Core"]
        self.assertTrue(len(ns_nodes) > 0, "Namespace 'Core' not found")

        # 2. 验证 Class (TypeDecl)
        cls = next((n for n in graph.nodes.values() if isinstance(n, TypeDeclNode) and n.name == "Engine"), None)
        self.assertIsNotNone(cls)

        # 3. 验证 Method "start"
        method = next((n for n in graph.nodes.values() if isinstance(n, MethodNode) and n.name == "start"), None)
        self.assertIsNotNone(method)

        # 4. 验证隐式 'this' 参数
        # 查找方法的 AST 子节点中的参数
        params = [
            n for n in graph.nodes.values() 
            if isinstance(n, MethodParameterInNode) and n.name == "this"
            # 这里简化逻辑，实际应该通过 AST 边查找 method 的子节点
        ]
        
        # 如果图很大，最好通过边查找
        ast_children_ids = {e.dst for e in graph.edges if e.src == method.id and e.type == EdgeType.AST}
        this_param = next((n for n in params if n.id in ast_children_ids), None)
        
        self.assertIsNotNone(this_param, "'this' parameter missing")
        
        # 验证类型 (根据你的 parser 实现，可能是 engine.Core.Engine* 或类似)
        # 这里只验证它包含 Engine
        self.assertIn("Engine", this_param.type_full_name if hasattr(this_param, 'type_full_name') else this_param.typeFullName)
        
        print(f"✅ Test 03 Passed.")

    def test_04_cross_file_linking(self):
        """测试 4: 跨文件调用"""
        builder = self._get_builder()
        builder.build()
        graph = self._get_graph_from_builder(builder)
        
        # 查找调用点 (main.c 中调用 complex_math)
        call = next((n for n in graph.nodes.values() if isinstance(n, CallNode) and n.name == "complex_math"), None)
        # 查找定义点 (utils.c 中的定义)
        callee = next((n for n in graph.nodes.values() if isinstance(n, MethodNode) and n.name == "complex_math"), None)
        
        self.assertIsNotNone(call, "Call site 'complex_math' not found")
        self.assertIsNotNone(callee, "Callee definition 'complex_math' not found")
        
        # 验证 CALL 边
        linked = any(e.src == call.id and e.dst == callee.id for e in graph.edges if e.type == EdgeType.CALL)
        self.assertTrue(linked, "Cross-file CALL edge missing")
        print(f"✅ Test 04 Passed.")

    def test_05_external_library(self):
        """测试 5: 外部库 (printf)"""
        builder = self._get_builder()
        builder.build()
        graph = self._get_graph_from_builder(builder)
        
        printf_call = next((n for n in graph.nodes.values() if isinstance(n, CallNode) and n.name == "printf"), None)
        self.assertIsNotNone(printf_call)
        
        # 验证是否连接到了 Phantom Method (Stub)
        call_edges = [e for e in graph.edges if e.src == printf_call.id and e.type == EdgeType.CALL]
        self.assertTrue(len(call_edges) > 0)
        
        target_id = call_edges[0].dst
        target = graph.nodes[target_id]
        
        # 验证目标是否标记为外部
        self.assertTrue(getattr(target, 'is_external', False) or getattr(target, 'isExternal', False))
        print(f"✅ Test 05 Passed.")

    def test_06_id_collision(self):
        """测试 6: 多进程下的 ID 冲突与合并"""
        shutil.copy(os.path.join(self.test_dir, "src/main.c"), os.path.join(self.test_dir, "src/main2.c"))
        
        # [Fix] n_workers=2
        builder = self._get_builder(n_workers=2)
        builder.build()
        graph = self._get_graph_from_builder(builder)
        
        # 检查 ID 唯一性
        ids = [n.id for n in graph.nodes.values()]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate IDs found! Snowflake Generator might not be process-safe.")
        
        # 确保数据完整性
        self.assertTrue(len(ids) > 10, "Graph seems too small")
        print(f"✅ Test 06 Passed.")

if __name__ == "__main__":
    unittest.main()