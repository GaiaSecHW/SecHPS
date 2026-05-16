# codedmap/infra/storage/driver_neo4j/bulk/writer.py

import csv
from typing import List, Any, get_args, get_origin, Dict
from codedmap.infra.storage.bulk.base_writer import BaseBulkWriter
from codedmap.infra.storage.bulk.introspector import PropertyMeta
from codedmap.infra.storage.driver_neo4j.bulk.encoder import Neo4jValueEncoder


class Neo4jBulkWriter(BaseBulkWriter):
    """
    [Implementation] Neo4j Admin Import 专用导出器。
    """

    def __init__(self, output_dir, worker_id=None):
        super().__init__(output_dir, worker_id)
        # Neo4j 最佳实践：Header 与 Data 分离
        self.headers_dir = self.output_dir / "headers"
        self.headers_dir.mkdir(parents=True, exist_ok=True)

    def _write_header(self, group_name: str, kind: str, label_or_type: str, prop_metas: List[PropertyMeta]):
        path = self.headers_dir / f"{group_name}_header.csv"

        # 并发安全检查：如果存在则跳过 (假设 Schema 一致)
        if path.exists(): return

        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)

            # Neo4j Import Header Format
            if kind == "node":
                # :ID, :LABEL, props...
                header_row = ["id:ID", ":LABEL"]
            else:
                # :START_ID, :END_ID, :TYPE, props...
                header_row = [":START_ID", ":END_ID", ":TYPE"]

            for meta in prop_metas:
                type_suffix = self._map_python_type_to_neo4j(meta.py_type)
                # 组合列名: e.g. "age:int"
                header_row.append(f"{meta.export_name}{type_suffix}")

            writer.writerow(header_row)

    def _format_node_row(self, nid: str, label: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        # 数据行不需要写类型后缀，只需要写值
        row = [nid, label]
        for meta in metas:
            val = props.get(meta.export_name)
            # 编码 (处理转义、序列化等)
            row.append(Neo4jValueEncoder.encode(val))
        return row

    def _format_edge_row(self, src: str, dst: str, etype: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        row = [src, dst, etype]

        for meta in metas:
            val = props.get(meta.export_name)
            row.append(Neo4jValueEncoder.encode(val))

        return row

    def _map_python_type_to_neo4j(self, py_type: Any) -> str:
        """
        类型映射逻辑。
        """
        origin = get_origin(py_type)
        args = get_args(py_type)

        # 1. 数组类型 List[...]
        if origin is list or origin is List:
            inner = args[0] if args else str
            if inner is int: return ":int[]"
            if inner is float: return ":float[]"
            if inner is bool: return ":boolean[]"
            return ":string[]"

        # 2. 标量类型
        if py_type is int: return ":int"
        if py_type is float: return ":float"
        if py_type is bool: return ":boolean"  # [Fix] 显式支持布尔

        # 3. 默认
        return ":string"