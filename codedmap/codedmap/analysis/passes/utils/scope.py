# codedmap/passes/utils/scope.py

from typing import Dict, Optional, Deque, List, Any
from collections import deque
from codedmap.core.schema.graph import AnyNode

class ScopeElement:
    """作用域元素：存储当前作用域内的变量定义"""
    def __init__(self, node: Optional[AnyNode], name: str = "Global"):
        self.scope_node = node
        self.scope_name = name
        # key: variable name, value: definition node
        self.variables: Dict[str, AnyNode] = {}

    def add_variable(self, name: str, node: AnyNode):
        # C 语言允许在同级作用域声明同名变量 (虽然编译器会报 error/warning，但在 AST 中可能存在)
        # 这里覆盖旧值是正确的 Shadowing 行为
        self.variables[name] = node

    def resolve(self, name: str) -> Optional[AnyNode]:
        return self.variables.get(name)
    
    def __repr__(self):
        return f"<Scope: {self.scope_name} (vars={len(self.variables)})>"

class ScopeManager:
    """作用域管理器：处理嵌套作用域的压栈/出栈和查找"""
    def __init__(self):
        self.stack: Deque[ScopeElement] = deque()

    def enter_scope(self, node: Optional[AnyNode], name: str = "Anonymous"):
        elem = ScopeElement(node, name)
        self.stack.append(elem)
        return elem

    def exit_scope(self):
        if self.stack:
            self.stack.pop()

    def add_declaration(self, name: str, node: AnyNode):
        if self.stack:
            self.stack[-1].add_variable(name, node)

    def resolve(self, name: str) -> Optional[AnyNode]:
        # 从栈顶（最内层）向栈底（全局）查找
        for scope in reversed(self.stack):
            node = scope.resolve(name)
            if node:
                return node
        return None

    def get_all_definitions(self) -> Dict[str, AnyNode]:
        """
        [Debug Helper] 获取当前作用域链下所有可见的变量定义快照。

        用途：
        1. 调试时打印当前位置能访问哪些变量。
        2. 分析闭包捕获（如果未来支持 Lambda）。

        逻辑：
        从最外层(Global)遍历到最内层(Local)。
        利用 dict.update 的覆盖特性，自动实现 Shadowing 效果。
        (例如：Global 有 x=1, Local 有 x=2, 结果字典中 x=2)
        """
        visible_defs = {}
        # deque 的默认迭代顺序是从左到右 (Bottom -> Top)
        for scope in self.stack:
            visible_defs.update(scope.variables)
        return visible_defs

    @property
    def depth(self):
        return len(self.stack)