import logging
from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field

from codedmap.core.schema.graph.nodes import CPGNode, MethodNode, FileNode, AstNode
from codedmap.core.schema.graph.enums import NodeLabel
from codedmap.infra.storage.store import CPGStore
from codedmap.utils.source_manager import source_manager as _global_source_manager

logger = logging.getLogger(__name__)

class LocationQuery(BaseModel):
    file_path: str
    line_number: int
    column_number: Optional[int] = None

class ResolvedContext(BaseModel):
    """
    [Output] 解析后的完整上下文对象，方便 Agent 直接使用
    """
    node: AstNode
    enclosing_method: Optional[MethodNode] = None
    enclosing_file: Optional[FileNode] = None
    source_code_snippet: Optional[str] = None # 节点自身的代码 (e.g. "auth(user)")
    surrounding_code: Optional[str] = None # 周边代码窗口 (e.g. 前后 5 行)

class NodeResolver:
    """
    [Bridge Service] 节点定位服务。
    连接 "Human/Agent World" (File:Line, Name) 与 "Graph World" (Node ID)。
    """
    
    def __init__(self, store: CPGStore):
        self.store = store
        # 依赖 Repository
        self.ast_repo = self.store.ast
        self.method_repo = self.store.methods
        self.file_repo = self.store.files

    # =========================================================
    # 1. Location Resolution (File:Line -> Node)
    # =========================================================

    def resolve_location(self, query: LocationQuery) -> Optional[AstNode]:
        """
        根据位置定位 AST 节点。
        包含智能选优逻辑：优先返回 "动作性" 较强的节点 (如 Call, MethodDef)。
        """
        # 1. 查找候选节点
        # 注意：这里我们处理一下 file_path，支持模糊匹配
        # 如果 repo 支持模糊匹配最好，否则这里可能需要先 resolve file
        candidates = self.ast_repo.find_by_location(
            file_path=query.file_path, 
            line=query.line_number, 
            column=query.column_number
        )
        
        if not candidates:
            # 尝试处理相对路径问题：如果找不到，尝试只用文件名搜索
            filename_only = query.file_path.split('/')[-1]
            if filename_only != query.file_path:
                logger.debug(f"Retrying with filename only: {filename_only}")
                candidates = self.ast_repo.find_by_location(
                    file_path=filename_only,
                    line=query.line_number
                )

        if not candidates:
            return None

        # 2. 智能选优 (Heuristic Selection)
        return self._pick_best_candidate(candidates)

    def _pick_best_candidate(self, nodes: List[AstNode]) -> AstNode:
        """
        [Smart Logic] 当一行有多个节点时，决定返回哪一个给 Agent。
        优先级：
        1. METHOD (函数定义行)
        2. CALL (函数调用)
        3. CONTROL_STRUCTURE (if/while)
        4. ASSIGNMENT / OPERATOR (赋值/运算)
        5. Others (Identifier, Literal)
        """
        # 优先级映射 (Label -> Score)
        priority_map = {
            NodeLabel.METHOD: 100,
            NodeLabel.TYPE_DECL: 95, # [New] 类定义也很重要
            NodeLabel.CALL: 90,
            NodeLabel.CONTROL_STRUCTURE: 80,
            NodeLabel.NAMESPACE_BLOCK: 70, # [New] 包定义
            NodeLabel.UNKNOWN: 0
        }

        def get_score(n: AstNode):
            # 1. Label 优先级
            score = priority_map.get(n.label, 10)
            
            # 2. 代码长度优先级 (通常涵盖更多信息的节点更好)
            if n.code:
                score += min(len(n.code), 50) / 100.0
            
            # 3. AST 深度优先级 (Order 越小通常越靠外? 或者是 Root? 
            # 视具体需求，Agent 通常喜欢看整句语句，而不是内部变量)
            # 这里我们假设 Order 越小，越可能是语句的开始
            # score -= (n.order or 0) * 0.1 
            
            return score

        # 按分数降序排列
        sorted_nodes = sorted(nodes, key=get_score, reverse=True)
        return sorted_nodes[0]

    # =========================================================
    # 2. Semantic Resolution (Name -> Node)
    # =========================================================

    def resolve_function(self, name: str, fuzzy: bool = True) -> List[MethodNode]:
        """
        根据函数名查找。
        """
        # 1. 精确匹配
        results = self.method_repo.find_by_name(name, exact_match=True)
        if results:
            return results
        
        # 2. 模糊匹配 (如果允许)
        if fuzzy:
            return self.method_repo.find_by_name(name, exact_match=False)
        
        return []

    # =========================================================
    # 3. Context Retrieval (Node -> Context)
    # =========================================================

    def get_node_context(self, node_id: int, window_size: int = 5) -> ResolvedContext:
        """
        [One-Stop Shop] 一次性获取节点及其周边的完整上下文。
        
        Args:
            node_id: CPG 节点 ID
            window_size: 上下文窗口大小 (前后 N 行)
        """
        # 1. 获取节点本身
        node = self.ast_repo.get_by_id(node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        # 2. 向上查找 Method & File
        method = self.ast_repo.get_enclosing_method(node_id)
        file_node = self.ast_repo.get_enclosing_file(node_id)

        # 3. 获取自身代码片段
        code = getattr(node, "code", None)
        if not code and hasattr(node, "get_code"):
            code = node.get_code()

        # 4. [New] 获取周边代码 (Context Window)
        surrounding_code = None
        if file_node and node.line_number is not None:
            surrounding_code = self._fetch_surrounding_code(
                file_path=file_node.name,
                center_line=node.line_number,
                window=window_size
            )

        return ResolvedContext(
            node=node,
            enclosing_method=method,
            enclosing_file=file_node,
            source_code_snippet=code,
            surrounding_code=surrounding_code # 返回增强的上下文
        )

    def _fetch_surrounding_code(self, file_path: str, center_line: int, window: int) -> Optional[str]:
        """
        [Internal] 从 SourceManager 读取原始文件的指定行范围。
        """
        # 1. 检查 SourceManager 是否可用
        if not _global_source_manager:
            logger.warning("SourceManager not available")
            return None
            
        try:
            # 2. 直接代理给 SourceManager 的新接口
            # 我们不再自己处理字节切片和行号计算，SourceManager 已经封装好了
            return _global_source_manager.get_surrounding_lines(
                filename=file_path,
                center_line=center_line,
                window=window
            )
            
        except Exception as e:
            logger.warning(f"Failed to fetch surrounding code for {file_path}: {e}")
            return None