import csv
import gzip
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List, Union, Iterator
from abc import ABC, abstractmethod

from codedmap.infra.storage.bulk.introspector import SchemaIntrospector, PropertyMeta

logger = logging.getLogger(__name__)


class BaseBulkWriter(ABC):
    """
    [Production Core]
    负责文件句柄管理、分片管理、元数据反射和属性提取。
    """

    def __init__(self, output_dir: Union[str, Path], worker_id: Optional[str] = None):
        self.output_dir = Path(output_dir)
        self.worker_id = worker_id or "default"

        self.data_dir = self.output_dir / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)

        # Cache: {filename: (file_handle, csv_writer)}
        self._handles: Dict[str, Any] = {}
        # Cache: set of labels that have been initialized (headers written)
        self._initialized_groups: set = set()
        # Cache: Schema Metadata
        self._meta_cache: Dict[str, List[PropertyMeta]] = {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """安全关闭所有打开的文件句柄"""
        for f, _ in self._handles.values():
            try:
                f.close()
            except Exception as e:
                logger.warning(f"Error closing bulk writer handle: {e}")
        self._handles.clear()

    # --- Public Streaming API ---

    def write_nodes_stream(self, nodes_iterator: Iterator[Union[Dict, Any]]):
        for node in nodes_iterator:
            # 1. 解析基础信息
            if isinstance(node, dict):
                label = node.get('label', 'UNKNOWN')
                nid = str(node.get('id'))
            else:
                raw_lbl = getattr(node, 'label', 'UNKNOWN')
                label = raw_lbl.value if hasattr(raw_lbl, 'value') else str(raw_lbl)
                nid = str(node.id)

            group_name = f"nodes_{label}"

            if group_name not in self._meta_cache:
                self._meta_cache[group_name] = SchemaIntrospector.get_node_properties(label)
            metas = self._meta_cache[group_name]

            if group_name not in self._initialized_groups:
                self._write_header(group_name, "node", label, metas)
                self._initialized_groups.add(group_name)

            # 提取属性字典
            props_dict = self._extract_props(node, metas)

            # # [FIX START] 将 Dict 转换为与 Header 顺序一致的 List
            # ordered_values = []
            # for meta in metas:
            #     # 使用 get 获取值，如果不存在则为 None (Encoder 会转为空字符串)
            #     ordered_values.append(props_dict.get(meta.export_name))
            # # [FIX END]

            # 传入有序列表
            row = self._format_node_row(nid, label, props_dict, metas)
            self._get_writer(group_name).writerow(row)

    def write_edges_stream(self, edges_iterator: Iterator[Union[Dict, Any]]):
        for edge in edges_iterator:
            if isinstance(edge, dict):
                src = str(edge.get('src'))
                dst = str(edge.get('dst'))
                raw_type = edge.get('type')
                source_props = edge.get('properties', edge)
            else:
                src = str(edge.src)
                dst = str(edge.dst)
                raw_type = edge.type
                source_props = edge

            etype = raw_type.value if hasattr(raw_type, 'value') else str(raw_type)
            group_name = f"edges_{etype}"

            if group_name not in self._meta_cache:
                self._meta_cache[group_name] = SchemaIntrospector.get_edge_properties(etype)
            metas = self._meta_cache[group_name]

            if group_name not in self._initialized_groups:
                self._write_header(group_name, "edge", etype, metas)
                self._initialized_groups.add(group_name)

            props_dict = self._extract_props(source_props, metas)

            # # [FIX START] 将 Dict 转换为与 Header 顺序一致的 List
            # ordered_values = []
            # for meta in metas:
            #     ordered_values.append(props_dict.get(meta.export_name))
            # # [FIX END]

            row = self._format_edge_row(src, dst, etype, props_dict, metas)
            self._get_writer(group_name).writerow(row)

    # --- Internal Helpers ---

    def _extract_props(self, source: Union[Dict, Any], metas: List[PropertyMeta]) -> Dict[str, Any]:
        """
        [Helper] 根据元数据从源对象提取属性值。
        自动处理 Pydantic、Dict、以及 Set 转 List。
        """
        result = {}
        is_dict = isinstance(source, dict)

        for meta in metas:
            val = None
            if is_dict:
                # 优先尝试直接获取，其次尝试 properties 嵌套
                if meta.attr_name in source:
                    val = source[meta.attr_name]
                elif 'properties' in source and isinstance(source['properties'], dict):
                    val = source['properties'].get(meta.attr_name)
            else:
                val = getattr(source, meta.attr_name, None)

            if val is not None:
                # [Sanitization] Set 无法被 JSON 序列化，必须在此处转 list
                if isinstance(val, set):
                    val = list(val)
                result[meta.export_name] = val

        return result

    def _get_writer(self, base_name: str):
        file_key = f"{base_name}_{self.worker_id}"
        if file_key not in self._handles:
            # 生产环境使用 gzip 压缩，level 6 是速度和体积的最佳平衡点
            path = self.data_dir / f"{file_key}.csv.gz"
            f = gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=6)
            self._handles[file_key] = (f, csv.writer(f))
        return self._handles[file_key][1]

    # --- Abstract Hooks ---

    @abstractmethod
    def _write_header(self, group_name: str, kind: str, label_or_type: str, metas: List[PropertyMeta]):
        pass

    @abstractmethod
    def _format_node_row(self, nid: str, label: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        pass

    @abstractmethod
    def _format_edge_row(self, src: str, dst: str, etype: str, props: Dict[str, Any], metas: List[PropertyMeta]) -> List[str]:
        pass