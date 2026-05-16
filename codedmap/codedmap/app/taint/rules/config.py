# codedmap/app/taint/rules/config.py

from typing import Callable, Union, Set, List, Iterator, Any
from codedmap.core.schema.graph.nodes import CPGNode
from codedmap.infra.storage.store import CPGStore

# Criteria 定义:
# 1. Set[int]: ID 集合 (最快)
# 2. Callable: Python 逻辑 (最灵活, 可集成 LLM)
Criteria = Union[Set[int], Callable[[CPGNode], bool]]

# Source 定义:
# 1. List[CPGNode]: 预加载的节点列表
# 2. Traversal: 数据库查询对象 (惰性, 适合大规模)
SourceCriteria = Union[List[CPGNode], Any]
class TaintConfiguration:
    """
    污点分析配置对象。
    [Industrial Grade Update]: 支持惰性 Source 加载。
    """
    def __init__(self,
                 sources: SourceCriteria,
                 sinks: Criteria,
                 sanitizers: Criteria = None):
        self._sources_raw = sources
        self.sinks = sinks
        self.sanitizers = sanitizers

    @property
    def sources(self) -> SourceCriteria:
        """[Fix] 暴露原始 sources 对象，供 Engine 检查非空"""
        return self._sources_raw

    @property
    def sources_iter(self) -> Iterator[CPGNode]:
        """
        统一迭代器接口，支持 List 和 Traversal。
        """
        if isinstance(self._sources_raw, list):
            yield from self._sources_raw
        elif hasattr(self._sources_raw, '__iter__'):
            # Traversal 对象是可迭代的
            yield from self._sources_raw
        else:
            raise ValueError(f"Invalid source type: {type(self._sources_raw)}")

    def is_sink(self, node: CPGNode) -> bool:
        return self._check(node, self.sinks)

    def is_sanitizer(self, node: CPGNode) -> bool:
        return self._check(node, self.sanitizers)

    def _check(self, node: CPGNode, criteria: Criteria) -> bool:
        if criteria is None:
            return False

        # Fast Path: ID Lookup
        if isinstance(criteria, set):
            return node.id in criteria

        # Flexible Path: Callable (Analysis logic / LLM)
        if callable(criteria):
            return criteria(node)

        return False

    @classmethod
    def from_tags(cls,
                  store: CPGStore,
                  source_tag: str = "SOURCE",
                  sink_tag: str = "SINK",
                  sanitizer_tag: str = "SANITIZER"):
        """
        [Factory] 自动从 Store 中加载打过标签的节点生成配置。
        """
        # 1. 利用 store.tags (TagRepository) 查找节点
        # 返回 List[CPGNode]
        sources = store.tags.find_nodes(source_tag)

        # 2. 也是 List[CPGNode]
        sink_nodes = store.tags.find_nodes(sink_tag)

        # 3. 转换为 ID 集合 (Set[int]) 以便 Engine 快速校验
        # 注意：这里我们预先计算了 ID 集合。
        # 如果是超大规模项目，Sinks 也可以保持为 List 或 BloomFilter，但通常 Sink 数量有限。
        sinks = {n.id for n in sink_nodes}

        # 4. Sanitizers
        sanitizer_nodes = store.tags.find_nodes(sanitizer_tag)
        sanitizers = {n.id for n in sanitizer_nodes}

        # 5. 可选：过滤掉被 "SUPPRESSED" 的 Source
        # 这体现了 Tagging 系统的灵活性
        suppressed_nodes = store.tags.find_nodes("SUPPRESSED")
        suppressed_ids = {n.id for n in suppressed_nodes}

        valid_sources = [s for s in sources if s.id not in suppressed_ids]

        return cls(sources=valid_sources, sinks=sinks, sanitizers=sanitizers)
