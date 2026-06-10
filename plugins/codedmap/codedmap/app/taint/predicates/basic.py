# codedmap/app/taint/predicates/basic.py

from codedmap.core.schema.graph import AnyNode
from codedmap.core.schema.graph.nodes import CallNode, IdentifierNode, MethodParameterInNode

class QueryPredicates:
    """常用查询谓词工厂"""

    @staticmethod
    def is_call_to(name: str):
        """匹配函数调用名"""
        def _check(n: AnyNode):
            return isinstance(n, CallNode) and n.name == name
        return _check

    @staticmethod
    def is_param(index: int = None):
        """匹配函数参数"""
        def _check(n: AnyNode):
            if not isinstance(n, MethodParameterInNode): return False
            if index is not None and n.order != index: return False
            return True
        return _check

    @staticmethod
    def is_identifier(name: str):
        def _check(n: AnyNode):
            return isinstance(n, IdentifierNode) and n.name == name
        return _check
