import json
from dataclasses import dataclass, asdict
from typing import List, Any, Iterator
from codedmap.core.schema.graph.nodes import CPGNode

class QueryResult:
    """
    [DSL Result] 查询结果封装器。
    提供格式化输出、导出、以及对结果集的集合操作。
    """
    def __init__(self, nodes: List[CPGNode]):
        self._nodes = nodes

    def __iter__(self) -> Iterator[CPGNode]:
        return iter(self._nodes)

    def __len__(self) -> int:
        return len(self._nodes)

    def __getitem__(self, index) -> CPGNode:
        return self._nodes[index]

    def ids(self) -> List[int]:
        """快速获取所有 ID"""
        return [n.id for n in self._nodes]

    def first(self) -> Any:
        """获取第一个结果，如果为空返回 None"""
        return self._nodes[0] if self._nodes else None

    def show(self, attr: str = "code", limit: int = 10):
        """
        [UX] 打印简报。
        例如: result.show("name") 打印所有函数名。
        """
        print(f"--- Query Result ({len(self._nodes)} nodes) ---")
        for i, node in enumerate(self._nodes[:limit]):
            val = getattr(node, attr, "N/A")
            # 处理过长的代码
            if isinstance(val, str) and len(val) > 50:
                val = val[:47] + "..."
            print(f"[{i}] {node.label}:{node.id} -> {val}")

        if len(self._nodes) > limit:
            print(f"... and {len(self._nodes) - limit} more.")

    def to_json(self) -> str:
        """导出为 JSON 字符串"""
        # 需要 Node 实现 dict() 或 model_dump() (Pydantic)
        data = [n.model_dump(by_alias=True) for n in self._nodes]
        return json.dumps(data, indent=2, default=str)

    def property(self, name: str) -> List[Any]:
        """提取所有节点的特定属性值列表"""
        return [getattr(n, name, None) for n in self._nodes]


def _parse_entry_point_tags(tags):
    """Extract level, category, and rule from entry point tags."""
    if not tags:
        return "?", "?", "?"
    for tag in tags:
        if tag and "ENTRY_POINT" in tag.upper():
            parts = tag.split(":")
            if len(parts) >= 4:
                level = parts[2]
                category = parts[3].lower()
                # Rule is typically the last part or embedded in the tag
                rule = parts[-1].lower() if len(parts) > 4 else category
                return level, category, rule
    return "?", "?", "?"


@dataclass
class EntryPointsResult:
    """Query result with metadata for agent consumption."""
    results: List[dict]
    total: int
    has_more: bool
    limit: int

    def to_json(self) -> str:
        """Export as JSON string."""
        return json.dumps(asdict(self), indent=2)

    @classmethod
    def from_nodes(cls, nodes: List[Any], limit: int) -> "EntryPointsResult":
        """Create result from CPGNode list."""
        # Parse entry point info from nodes
        results = []
        display_count = min(len(nodes), limit)
        for node in nodes[:limit]:
            tags = getattr(node, "tags", [])
            level, category, rule = _parse_entry_point_tags(tags)
            results.append({
                "id": getattr(node, "id", None),
                "name": getattr(node, "name", "?"),
                "full_name": getattr(node, "fullName", None) or getattr(node, "full_name", None),
                "file": getattr(node, "fileName", None) or getattr(node, "file_name", None),
                "line": getattr(node, "lineNumber", None) or getattr(node, "line_number", None),
                "level": level,
                "category": category,
                "type": rule,
                "tags": tags,
            })
        return cls(
            results=results,
            total=len(nodes),
            has_more=len(nodes) > limit,
            limit=limit
        )
