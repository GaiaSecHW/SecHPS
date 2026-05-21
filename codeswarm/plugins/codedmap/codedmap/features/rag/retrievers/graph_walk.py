# codedmap/features/rag/retrievers/graph_walk.py

from typing import Dict, Any, Optional
from codedmap.core.schema.graph.enums import EdgeType, NodeLabel
from codedmap.infra.storage.store import CPGStore 
from codedmap.core.schema.graph.nodes import MethodNode

# [Architectural Note] source_manager 最好作为 Service 注入，而不是全局 import
# 这里暂时保持，但标记为待优化
from codedmap.utils.source_manager import source_manager

class GraphWalkRetriever:
    """
    [Level 2] 图游走检索 (Context Expansion)
    """
    def __init__(self, store: CPGStore):
        self.store = store

    def expand_context(self, node_id: int, depth: int = 1) -> Dict[str, Any]:
        # 使用 Repository 查找
        # 假设我们有通用的 get_node 方法或者使用 query
        # node = self.store.methods.get_by_id(node_id) # 如果是 Method
        
        # 更通用的写法 (因为 Entry Point 可能是 Struct)
        nodes = self.store.query.by_id(node_id).to_list()
        if not nodes:
            return {"error": "Node not found"}
        node = nodes[0]

        # 获取文件路径 (利用 DSL)
        # .file() 已经在 TraversalInterface 中定义
        file_nodes = self.store.query.by_id(node_id).file().to_list()
        file_path = file_nodes[0].name if file_nodes else getattr(node, "filename", "unknown")

        # 获取源码
        # 建议：如果 store 支持 code 属性懒加载，这里会触发 IO
        source_code = node.get_code(source_manager)

        context = {
            "target_name": getattr(node, "name", "unknown"),
            "node_id": node.id,
            "file_path": file_path,
            "source_code": source_code, 
            "callers": [],
            "callees": [],
            "used_types": [],
            "literals": []
        }

        if depth > 0:
            # 1. Callers (DSL)
            callers = (
                self.store.query.by_id(node_id)
                .callers()
                .limit(5)
                .to_list()
            )
            context["callers"] = [f"{m.name}" for m in callers]

            # 2. Callees (DSL)
            callees = (
                self.store.query.by_id(node_id)
                .callees()
                .limit(10)
                .to_list()
            )
            context["callees"] = [m.name for m in callees]

            # 2. Type Definitions (参数类型定义)
            # 查找 Method -> PARAM -> EVAL_TYPE -> TYPE_DECL
            try:
                type_decls = (self.store.query.by_id(node_id)
                              .out(EdgeType.AST) # 找到 Param
                              .out(EdgeType.EVAL_TYPE) 
                              .out(EdgeType.REF) # 指向 TypeDecl
                              .limit(5)
                              .to_list())
                
                # 简单去重
                unique_types = {t.name: t.code for t in type_decls if t.code}
                context["used_types"] = [f"Struct {k}: {v[:200]}..." for k, v in unique_types.items()]
            except Exception: pass

            # 3. Literals (硬编码字符串)
            # 查找 Method -> CONTAINS -> LITERAL
            try:
                literals = (self.store.query.by_id(node_id)
                            .out(EdgeType.CONTAINS)
                            .has_label(NodeLabel.LITERAL)
                            .limit(10)
                            .to_list())
                
                # 只保留字符串类型的字面量
                strs = [l.code for l in literals if l.code and ('"' in l.code)]
                if strs:
                    context["literals"] = strs
            except Exception: pass

        return context