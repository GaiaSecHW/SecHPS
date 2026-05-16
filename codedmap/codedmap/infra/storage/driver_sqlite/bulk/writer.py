import json
from typing import List, Dict, Any
from codedmap.infra.storage.bulk.base_writer import BaseBulkWriter
from codedmap.infra.storage.bulk.introspector import PropertyMeta


class SqliteBulkWriter(BaseBulkWriter):
    """
    [Production Implementation] SQLite 优化版 Writer。

    Strategy:
    为了最大化 Loader 的导入速度，Worker 负责将所有属性打包成单一的 JSON 字符串。
    CSV 结构固定为 3 列 (Node) 或 4 列 (Edge)。
    """

    def _write_header(self, group_name: str, kind: str, label_or_type: str, metas: List[PropertyMeta]):
        writer = self._get_writer(group_name)
        if kind == "node":
            # 只有固定的三列
            writer.writerow(["id", "label", "properties"])
        else:
            # 只有固定的四列
            writer.writerow(["src", "dst", "type", "properties"])

    def _format_node_row(self, nid: str, label: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        # JSON 序列化 (ensure_ascii=False 减小体积并支持中文)
        # props 已经在 base_writer 中处理过 (Set -> List)，可以直接 dump
        props_json = json.dumps(props, ensure_ascii=False) if props else ""
        return [nid, label, props_json]

    def _format_edge_row(self, src: str, dst: str, etype: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        props_json = json.dumps(props, ensure_ascii=False) if props else ""
        return [src, dst, etype, props_json]