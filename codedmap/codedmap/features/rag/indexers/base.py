# codedmap/features/rag/indexers/base.py

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

from codedmap.infra.storage.store import CPGStore

class BaseIndexer(ABC):
    """
    RAG 索引器策略基类。
    封装了具体的向量存储和检索逻辑 (Neo4j vs Memory)。
    """
    
    def __init__(self, store: CPGStore):
        self.store = store

    @abstractmethod
    def search(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """
        执行向量搜索。
        Return: List of {"node": CPGNode, "score": float}
        """
        pass

    @abstractmethod
    def get_filter_label(self) -> str:
        """返回该策略针对的节点 Label (用于混合检索中的关键词过滤)"""
        pass
    
    # 具体的 Index Name 管理留给实现类，基类不需要强制定义