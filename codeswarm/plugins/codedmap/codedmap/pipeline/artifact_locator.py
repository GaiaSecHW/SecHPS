# codedmap/pipeline/artifact_locator.py

import os
import json
import hashlib
import logging
from pathlib import Path
from typing import Optional, Dict, List, Any
from functools import lru_cache

logger = logging.getLogger(__name__)


class ArtifactLocator:
    """
    [Optimized & Aligned] 负责根据源代码文件定位预先生成的 AST JSON 文件。

    关键变更:
    1. 算法对齐: Hash 计算和路径归一化逻辑与 ast_exporter.py 保持严格一致。
    2. Build Dir 感知: 利用 compile_commands.json 中的 directory 字段推断 build_dir。
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(ArtifactLocator, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, package_root: Path = None, project_root: Path = None):
        if self._initialized:
            return

        if package_root is None or project_root is None:
            return

        self.package_root = Path(package_root).resolve()
        self.project_root = Path(project_root).resolve()

        # [Aligned] 目录结构对齐 ast_exporter.py 的 main 函数
        self.artifact_root = self.package_root / "ast_artifacts"
        self.compile_db_path = self.package_root / "compile_commands.json"

        # 索引 A: 绝对路径 -> Entry
        self._compile_db_abs_map: Dict[str, Any] = {}
        # 索引 B: 文件名 -> List[Entry]
        self._compile_db_name_map: Dict[str, List[Any]] = {}

        self._loaded = False
        self._initialized = True

    def _load_compile_db(self):
        """
        加载并构建索引。
        """
        if self._loaded: return

        if not self.compile_db_path.exists():
            logger.warning(f"Compile DB not found at {self.compile_db_path}")
            self._loaded = True
            return

        try:
            logger.info(f"Loading compilation database: {self.compile_db_path}")
            with open(self.compile_db_path, 'r') as f:
                data = json.load(f)

                for entry in data:
                    file_path_str = entry['file']

                    # [Critical Fix] Hash 算法对齐 Exporter
                    # Exporter 逻辑: if 'arguments' ... else command
                    # 必须完全一致，否则 Hash 错位
                    if 'arguments' in entry:
                        cmd_str = " ".join(entry['arguments'])
                    else:
                        cmd_str = entry.get('command', '')

                    compact_entry = {
                        'file': file_path_str,
                        'directory': entry.get('directory', ''),
                        'command': cmd_str  # 存储清洗后的 cmd_str 用于计算 Hash
                    }

                    # 1. 填充绝对路径索引
                    try:
                        # 处理相对路径 (相对于 directory 字段)
                        if not os.path.isabs(file_path_str) and compact_entry['directory']:
                            abs_path = os.path.abspath(os.path.join(compact_entry['directory'], file_path_str))
                        else:
                            abs_path = os.path.abspath(file_path_str)

                        self._compile_db_abs_map[abs_path] = compact_entry
                    except Exception:
                        pass  # 容错

                    # 2. 填充文件名索引 (用于模糊查找)
                    filename = os.path.basename(file_path_str)
                    if filename not in self._compile_db_name_map:
                        self._compile_db_name_map[filename] = []
                    self._compile_db_name_map[filename].append(compact_entry)

            self._loaded = True
            logger.info(f"Loaded {len(self._compile_db_abs_map)} compilation entries.")

        except Exception as e:
            logger.error(f"Failed to load compile_commands.json: {e}")
            self._loaded = True

    def _calculate_hash(self, cmd_entry: dict) -> str:
        # [Aligned] 与 Exporter 的 get_file_hash 保持一致
        # fingerprint = f"{compile_command['file']}|{compile_command['directory']}|{cmd_str}"
        fingerprint = f"{cmd_entry['file']}|{cmd_entry['directory']}|{cmd_entry['command']}"
        return hashlib.md5(fingerprint.encode('utf-8')).hexdigest()[:12]

    def _find_compile_entry(self, src_path: Path) -> Optional[dict]:
        self._load_compile_db()
        abs_src_str = str(src_path.resolve())

        # 1. 精确匹配 (最快)
        if abs_src_str in self._compile_db_abs_map:
            return self._compile_db_abs_map[abs_src_str]

        # 2. 模糊匹配 (处理软链接或路径大小写差异)
        # 这是一个兜底逻辑
        filename = src_path.name
        candidates = self._compile_db_name_map.get(filename)
        if not candidates:
            return None

        # 如果只有一个同名文件，直接返回
        if len(candidates) == 1:
            return candidates[0]

        # 如果有多个，尝试后缀匹配
        try:
            # 尝试用 relative path 匹配
            rel_path_str = str(src_path.relative_to(self.project_root)).replace('\\', '/')
            for entry in candidates:
                if entry['file'].endswith(rel_path_str):
                    return entry
        except ValueError:
            pass

        return None

    @lru_cache(maxsize=5000)
    def find_artifact(self, source_file: str) -> Optional[str]:
        """
        [Cached API] 查找 Artifact。
        """
        src_path = Path(source_file).resolve()

        # 1. 查找 Compile Entry
        cmd_entry = self._find_compile_entry(src_path)
        if not cmd_entry:
            return None

        # 2. 计算 Hash
        file_hash = self._calculate_hash(cmd_entry)

        # 3. 计算子路径 (Sub Directory)
        # [Critical Fix] 必须复刻 Exporter 的 _normalize_cursor_path 逻辑
        # Exporter 优先级: Build Dir (_generated) -> Project Root -> Fallback

        sub_dir = None

        # 尝试 1: 相对于 Build Dir (从 cmd_entry 获取 directory)
        # 很多生成代码位于 build_dir 下
        build_dir = Path(cmd_entry['directory']) if cmd_entry['directory'] else None
        if build_dir:
            try:
                rel = src_path.relative_to(build_dir)
                sub_dir = Path("_generated") / rel.parent
            except ValueError:
                pass

        # 尝试 2: 相对于 Project Root (如果是源码)
        if sub_dir is None:
            try:
                rel = src_path.relative_to(self.project_root)
                sub_dir = rel.parent
            except ValueError:
                pass

        # 尝试 3: 外部文件 (Fallback)
        if sub_dir is None:
            sub_dir = Path("_external")

        # 4. 拼接最终路径
        json_filename = f"{src_path.name}_{file_hash}.json.gz"
        artifact_path = self.artifact_root / sub_dir / json_filename

        if artifact_path.exists():
            return str(artifact_path)

        # Debug Logging: 如果找不到，打个 Debug 方便排查
        # logger.debug(f"Artifact missing: {artifact_path} (Src: {src_path})")
        return None

    def clear_cache(self):
        self.find_artifact.cache_clear()