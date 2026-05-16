# codedmap/infra/storage/driver_neo4j/bulk/command.py

from pathlib import Path
import logging
import re
import os
from dataclasses import dataclass
from typing import List, Tuple, Optional, Callable

logger = logging.getLogger(__name__)


# =============================================================================
# 1. 路径适配器 (Infrastructure Layer)
# =============================================================================
class PathAdapter:
    """处理跨平台的路径转换逻辑"""

    @staticmethod
    def to_absolute_native(p: Path) -> str:
        """将路径转换为当前操作系统能识别的绝对路径字符串"""
        # 如果是在 WSL 下运行但生成 Windows 脚本，需要特殊处理
        # 这里假设代码运行在 Windows 或 WSL，目标是生成 Windows 可读路径
        path_str = str(p.absolute())

        # WSL to Windows 转换逻辑 (/mnt/c/... -> C:\...)
        if os.name == 'posix' and '/mnt/' in path_str:
            wsl_pattern = re.compile(r"^/mnt/([a-z])/(.*)$")
            match = wsl_pattern.match(path_str)
            if match:
                drive = match.group(1).upper()
                rest = match.group(2)
                return f"{drive}:\\{rest}".replace("/", "\\")

        # Native Windows
        if os.name == 'nt':
            return str(p.absolute()).replace("/", "\\")

        # Native Linux/Mac
        return str(p.absolute())


# =============================================================================
# 2. 命名策略 (Policy Layer)
# =============================================================================
@dataclass
class FileGroup:
    name: str  # Label or Relationship Type
    header: Path  # The header file
    data_files: List[Path]  # The list of data files


class NamingStrategy:
    """定义文件查找和匹配规则，解耦文件名硬编码"""

    NODE_PREFIX = "nodes_"
    EDGE_PREFIX = "edges_"
    HEADER_SUFFIX = "_header.csv"

    @staticmethod
    def extract_name(filename: str, prefix: str) -> str:
        return filename.replace(prefix, "").replace(NamingStrategy.HEADER_SUFFIX, "")

    @classmethod
    def find_data_files(cls, data_dir: Path, prefix: str, name: str) -> List[Path]:
        """
        [Priority Logic]
        1. Merged File (Best for IO)
        2. Sharded Files (Fallback)
        3. Simple/Legacy File
        """
        # 1. Merged
        merged = data_dir / f"{prefix}{name}_final.csv.gz"
        if merged.exists():
            return [merged]

        # 2. Shards (Worker Output)
        # 使用 glob 模式匹配，解耦具体的 PID 或 UUID 格式
        shards = sorted(list(data_dir.glob(f"{prefix}{name}_worker_*.csv.gz")))
        if shards:
            return shards

        # 3. Simple
        simple = data_dir / f"{prefix}{name}.csv.gz"
        if simple.exists():
            return [simple]

        return []


# =============================================================================
# 3. 核心生成器 (Application Layer)
# =============================================================================
class ImportScriptGenerator:
    # Neo4j Import 基础配置
    BASE_ARGS = [
        "--delimiter=,",
        "--skip-bad-relationships=true",
        "--skip-duplicate-nodes=true",
        "--multiline-fields=false",
        "--ignore-empty-strings=true",
        "--trim-strings=true",
        "--overwrite-destination=true",
        "--array-delimiter=\\037",
        "--bad-tolerance=1000000000"
    ]

    @classmethod
    def _scan_directory(cls, headers_dir: Path, data_dir: Path, prefix: str) -> List[FileGroup]:
        """通用的扫描逻辑，适用于 Nodes 和 Edges"""
        groups = []
        # pattern: nodes_*_header.csv
        pattern = f"{prefix}*{NamingStrategy.HEADER_SUFFIX}"

        for header_file in headers_dir.glob(pattern):
            name = NamingStrategy.extract_name(header_file.name, prefix)
            data_files = NamingStrategy.find_data_files(data_dir, prefix, name)

            if data_files:
                groups.append(FileGroup(name, header_file, data_files))

        return groups

    @classmethod
    def generate(cls, output_dir: Path, db_name: str = "neo4j"):
        headers_dir = output_dir / "headers"
        data_dir = output_dir / "data"

        # 1. Discovery Phase (发现)
        nodes = cls._scan_directory(headers_dir, data_dir, NamingStrategy.NODE_PREFIX)
        rels = cls._scan_directory(headers_dir, data_dir, NamingStrategy.EDGE_PREFIX)

        logger.info(f"Found {len(nodes)} Node groups and {len(rels)} Relationship groups.")

        # 2. Construction Phase (构建参数文件)
        args_lines = list(cls.BASE_ARGS)

        # 处理 Nodes
        for group in nodes:
            line = cls._fmt_arg("--nodes", group)
            args_lines.append(line)

        # 处理 Relationships
        for group in rels:
            line = cls._fmt_arg("--relationships", group)
            args_lines.append(line)

        # 3. Output Phase (写入文件)
        # 写 .args 文件
        args_file_path = output_dir / "import.args"
        with open(args_file_path, "w", encoding='utf-8', newline='\n') as f:
            f.write("\n".join(args_lines))

        # 写 .bat 启动脚本
        bat_path = cls._generate_bat_launcher(output_dir, db_name, args_file_path)

        return bat_path

    @staticmethod
    def _fmt_arg(flag: str, group: FileGroup) -> str:
        """
        Format: --flag=Name=Header,File1,File2
        Critical: No quotes inside the args file for Neo4j Admin Java parser
        """
        abs_header = PathAdapter.to_absolute_native(group.header)
        abs_files = [PathAdapter.to_absolute_native(f) for f in group.data_files]
        files_str = ",".join(abs_files)
        return f"{flag}={group.name}={abs_header},{files_str}"

    @staticmethod
    def _generate_bat_launcher(output_dir: Path, db_name: str, args_path: Path) -> Path:
        """生成 Windows 启动脚本"""
        launcher_path = output_dir / "run_import.bat"

        args_win_path = PathAdapter.to_absolute_native(args_path)

        lines = [
            "@echo off",
            "pushd \"%~dp0\"",
            f"echo ==================================================",
            f"echo Starting Massive Import for DB: {db_name}",
            f"echo Using config: {args_win_path}",
            f"echo ==================================================",
            "",
            "set JAVA_OPTS=-Xmx4G --add-opens=java.base/java.nio=ALL-UNNAMED --add-opens=java.base/java.io=ALL-UNNAMED --add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
            # 假设 neo4j-admin 在上一级 bin 目录，或者在 PATH 中
            # 使用 @file 语法传递参数，规避 CMD 长度限制
            f"..\\bin\\neo4j-admin.bat database import full {db_name} @\"{args_win_path}\"",
            "",
            "if %errorlevel% neq 0 (",
            "   color 4F",
            "   echo [ERROR] Import Failed! Check logs.",
            ") else (",
            "   color 2F",
            "   echo [SUCCESS] Import Completed Successfully.",
            ")",
            "pause",
            "popd"
        ]

        with open(launcher_path, "w", encoding='utf-8', newline='\r\n') as f:
            f.write("\n".join(lines))

        return launcher_path