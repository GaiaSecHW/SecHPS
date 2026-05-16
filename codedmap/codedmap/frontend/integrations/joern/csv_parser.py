# codedmap/frontend/integrations/joern/csv_parser.py

"""
Joern Neo4j CSV 格式解析器。

解析 `joern export --format=neo4jcsv` 产出的 nodes.csv 和 edges.csv。
处理 Neo4j CSV 的 header 类型注解、值转换、转义等。

Neo4j CSV Header 格式示例:
  :ID,NAME:STRING,FULL_NAME:STRING,LINE_NUMBER:INT,:LABEL
  :START_ID,:END_ID,:TYPE,VARIABLE:STRING
"""

import csv
import gzip
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .constants import NEO4J_TYPE_SUFFIXES

logger = logging.getLogger(__name__)


class ColumnSpec:
    """解析后的列定义。"""

    __slots__ = ("raw_name", "property_name", "neo4j_type", "is_meta")

    def __init__(self, raw_header: str):
        self.raw_name = raw_header.strip()

        # 检查是否为 Neo4j 元字段 (:ID, :LABEL, :TYPE, :START_ID, :END_ID)
        if self.raw_name.startswith(":"):
            stripped = self.raw_name[1:]  # 去掉前缀冒号
            # 可能有类型注解如 :ID(SomeSpace)
            paren_idx = stripped.find("(")
            if paren_idx != -1:
                stripped = stripped[:paren_idx]
            self.property_name = stripped.upper()
            self.neo4j_type = NEO4J_TYPE_SUFFIXES.get(self.property_name, "string")
            self.is_meta = True
        else:
            # 普通属性列: NAME:STRING, LINE_NUMBER:INT 等
            parts = self.raw_name.split(":")
            self.property_name = parts[0].strip()
            type_hint = parts[1].strip().upper() if len(parts) > 1 else "STRING"
            self.neo4j_type = NEO4J_TYPE_SUFFIXES.get(type_hint, "string")
            self.is_meta = False

    def __repr__(self) -> str:
        return f"ColumnSpec({self.property_name}, type={self.neo4j_type}, meta={self.is_meta})"


def _convert_value(raw: str, neo4j_type: str) -> Any:
    """根据 Neo4j 类型注解转换字符串值。"""
    if not raw or raw == "":
        return None

    if neo4j_type in ("int", "long", "id", "start_id", "end_id"):
        try:
            return int(raw)
        except (ValueError, TypeError):
            return None

    if neo4j_type in ("float", "double"):
        try:
            return float(raw)
        except (ValueError, TypeError):
            return None

    if neo4j_type == "boolean":
        return raw.lower() in ("true", "1", "yes")

    if neo4j_type == "string_array":
        # Neo4j 数组属性使用分号分隔
        return [s.strip() for s in raw.split(";") if s.strip()]

    if neo4j_type in ("int_array", "long_array"):
        result = []
        for s in raw.split(";"):
            s = s.strip()
            if s:
                try:
                    result.append(int(s))
                except ValueError:
                    pass
        return result

    # 默认返回原始字符串
    return raw


def _open_csv(file_path: Path):
    """打开 CSV 文件，自动检测 gzip 压缩。"""
    if file_path.suffix == ".gz":
        return gzip.open(file_path, "rt", encoding="utf-8", newline="")
    return open(file_path, "r", encoding="utf-8", newline="")


def parse_nodes(file_path: Path) -> Iterator[Tuple[int, str, Dict[str, Any]]]:
    """
    解析 Joern nodes.csv，逐行 yield (joern_id, label, properties)。

    Args:
        file_path: nodes.csv 路径

    Yields:
        (joern_id, label_str, properties_dict)
    """
    with _open_csv(file_path) as f:
        reader = csv.reader(f)

        # 解析 header
        header_row = next(reader)
        columns = [ColumnSpec(h) for h in header_row]

        # 找到 :ID 和 :LABEL 列的索引
        id_col_idx: Optional[int] = None
        label_col_idx: Optional[int] = None

        for idx, col in enumerate(columns):
            if col.is_meta and col.property_name == "ID":
                id_col_idx = idx
            elif col.is_meta and col.property_name == "LABEL":
                label_col_idx = idx

        if id_col_idx is None:
            raise ValueError(f"No :ID column found in {file_path}")
        if label_col_idx is None:
            raise ValueError(f"No :LABEL column found in {file_path}")

        line_num = 1
        for row in reader:
            line_num += 1
            if not row or len(row) < 2:
                continue

            # 提取 ID
            raw_id = row[id_col_idx] if id_col_idx < len(row) else ""
            try:
                joern_id = int(raw_id)
            except (ValueError, TypeError):
                logger.warning(f"Invalid node ID at line {line_num}: {raw_id!r}")
                continue

            # 提取 Label
            label = row[label_col_idx].strip() if label_col_idx < len(row) else ""
            if not label:
                logger.warning(f"Empty label at line {line_num}, id={joern_id}")
                continue

            # 提取属性
            properties: Dict[str, Any] = {}
            for idx, col in enumerate(columns):
                if idx == id_col_idx or idx == label_col_idx:
                    continue
                if idx >= len(row):
                    continue

                raw_val = row[idx]
                if not raw_val and raw_val != "0":
                    continue

                val = _convert_value(raw_val, col.neo4j_type)
                if val is not None:
                    properties[col.property_name] = val

            yield joern_id, label, properties


def parse_edges(file_path: Path) -> Iterator[Tuple[int, int, str, Dict[str, Any]]]:
    """
    解析 Joern edges.csv (rels.csv)，逐行 yield (start_id, end_id, type, properties)。

    Args:
        file_path: edges.csv 或 rels.csv 路径

    Yields:
        (start_id, end_id, edge_type_str, properties_dict)
    """
    with _open_csv(file_path) as f:
        reader = csv.reader(f)

        # 解析 header
        header_row = next(reader)
        columns = [ColumnSpec(h) for h in header_row]

        # 找到元字段索引
        start_col_idx: Optional[int] = None
        end_col_idx: Optional[int] = None
        type_col_idx: Optional[int] = None

        for idx, col in enumerate(columns):
            if col.is_meta:
                if col.property_name == "START_ID":
                    start_col_idx = idx
                elif col.property_name == "END_ID":
                    end_col_idx = idx
                elif col.property_name == "TYPE":
                    type_col_idx = idx

        if start_col_idx is None:
            raise ValueError(f"No :START_ID column found in {file_path}")
        if end_col_idx is None:
            raise ValueError(f"No :END_ID column found in {file_path}")
        if type_col_idx is None:
            raise ValueError(f"No :TYPE column found in {file_path}")

        line_num = 1
        for row in reader:
            line_num += 1
            if not row or len(row) < 3:
                continue

            # 提取 start/end ID
            try:
                start_id = int(row[start_col_idx])
                end_id = int(row[end_col_idx])
            except (ValueError, TypeError, IndexError):
                logger.warning(f"Invalid edge IDs at line {line_num}")
                continue

            # 提取边类型
            edge_type = row[type_col_idx].strip() if type_col_idx < len(row) else ""
            if not edge_type:
                logger.warning(f"Empty edge type at line {line_num}")
                continue

            # 提取属性
            properties: Dict[str, Any] = {}
            for idx, col in enumerate(columns):
                if idx in (start_col_idx, end_col_idx, type_col_idx):
                    continue
                if idx >= len(row):
                    continue

                raw_val = row[idx]
                if not raw_val and raw_val != "0":
                    continue

                val = _convert_value(raw_val, col.neo4j_type)
                if val is not None:
                    properties[col.property_name] = val

            yield start_id, end_id, edge_type, properties


def _merge_split_csvs(export_dir: Path) -> Path:
    """
    Merge Joern's split CSV format (header + data + cypher) into single files.

    Joern's `neo4jcsv` export produces three files per type:
      nodes_METHOD_header.csv  — header row only (:ID,:LABEL,NAME:string,...)
      nodes_METHOD_data.csv    — data rows only
      nodes_METHOD_cypher.csv  — Cypher import commands (ignored)

    This merges each header + data pair into a single CSV file in a temp
    directory, returning the path to that directory.

    Args:
        export_dir: Directory containing the split CSV files.

    Returns:
        Path to temporary directory containing merged CSV files.
    """
    merged_dir = Path(tempfile.mkdtemp(prefix="joern_merged_"))

    for header_file in sorted(export_dir.glob("*_header.csv")):
        # nodes_METHOD_header.csv -> nodes_METHOD
        base_name = header_file.name.replace("_header.csv", "")
        data_file = export_dir / f"{base_name}_data.csv"
        out_file = merged_dir / f"{base_name}.csv"

        if not data_file.exists():
            logger.warning(f"No matching data file for {header_file.name}, skipping")
            continue

        with open(out_file, "w", encoding="utf-8") as out:
            # Write header row
            with open(header_file, "r", encoding="utf-8") as hf:
                header_content = hf.read().strip()
                out.write(header_content)
                out.write("\n")
            # Write data rows
            with open(data_file, "r", encoding="utf-8") as df:
                for line in df:
                    out.write(line)

    logger.info(
        f"Merged split CSV files from {export_dir} into {merged_dir}"
    )
    return merged_dir


def _collect_csv_files(scan_dir: Path) -> Tuple[List[Path], List[Path]]:
    """
    Collect node and edge CSV files from a directory.

    Handles single-file (nodes.csv) and per-label (nodes_METHOD.csv) formats.
    Supports .csv and .csv.gz files.

    Returns:
        (node_files, edge_files)
    """
    node_files: List[Path] = []
    edge_files: List[Path] = []

    for f in sorted(scan_dir.iterdir()):
        if not f.is_file():
            continue
        name_lower = f.name.lower()

        # Skip non-CSV files
        suffix = f.suffix.lower()
        if suffix == ".gz":
            # Check double suffix: .csv.gz
            if not f.stem.lower().endswith(".csv"):
                continue
        elif suffix != ".csv":
            continue

        if name_lower.startswith("node"):
            node_files.append(f)
        elif name_lower.startswith(("edge", "rel")):
            edge_files.append(f)

    return node_files, edge_files


def find_csv_files(export_dir: Path) -> Tuple[List[Path], List[Path]]:
    """
    在 Joern 导出目录中查找节点和边的 CSV 文件。

    Supports two Joern export layouts:

    1. Split format (3 files per type — auto-detected and merged):
       nodes_METHOD_header.csv, nodes_METHOD_data.csv, nodes_METHOD_cypher.csv

    2. Single-file format:
       - nodes.csv, edges.csv (or rels.csv)
       - nodes_METHOD.csv, nodes_CALL.csv, edges_AST.csv 等

    Returns:
        (node_files, edge_files)
    """
    export_dir = Path(export_dir)
    if not export_dir.is_dir():
        raise FileNotFoundError(f"Export directory not found: {export_dir}")

    # Detect split format: presence of *_header.csv files
    header_files = sorted(export_dir.glob("*_header.csv"))

    if header_files:
        # Split format: merge header + data into temp directory
        merged_dir = _merge_split_csvs(export_dir)
        scan_dir = merged_dir
    else:
        scan_dir = export_dir

    node_files, edge_files = _collect_csv_files(scan_dir)

    if not node_files:
        raise FileNotFoundError(f"No node CSV files found in {export_dir}")
    if not edge_files:
        raise FileNotFoundError(f"No edge/rel CSV files found in {export_dir}")

    logger.info(f"Found {len(node_files)} node file(s), {len(edge_files)} edge file(s) in {scan_dir}")
    return node_files, edge_files
