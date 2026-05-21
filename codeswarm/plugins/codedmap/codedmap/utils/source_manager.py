# codedmap/utils/source_manager.py
import gzip
import os
import json
import logging
from enum import Enum
from functools import lru_cache
from typing import Dict, Optional, List, Union, Any
from pathlib import Path

logger = logging.getLogger(__name__)


class ResourceType(Enum):
    SOURCE = "source"
    ARTIFACT = "artifact"


class SourceCodeManager:
    """
    [Optimized] 统一资源管理器 (Singleton).

    Optimizations:
    1. Memory Safety: 使用 LRU Cache 替代无限增长的 Dict，防止 OOM。
    2. Performance: 缓存路径解析结果，减少 os.path.exists 系统调用。
    3. Thread Safety: lru_cache 是线程安全的 (GIL)。
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SourceCodeManager, cls).__new__(cls)

            # [Optimization] 仅保留虚拟文件存储 (用于处理 _generated 文件)
            # 物理文件的缓存全部托管给 lru_cache
            cls._instance._virtual_sources: Dict[str, bytes] = {}
            cls._instance.project_root: str = ""

        return cls._instance

    def set_project_root(self, root: Union[str, Path]):
        self.project_root = str(root)
        # 切换项目根目录时，清空之前的路径缓存
        self.resolve_source_path.cache_clear()
        self.resolve_artifact_path.cache_clear()

    # =========================================================
    # Path Resolution (High Frequency - Large Cache)
    # =========================================================

    @lru_cache(maxsize=10000)
    def resolve_source_path(self, filename: str) -> str:
        """
        [Cached] 路径解析。
        由于路径字符串占用内存极小，给较大的缓存空间以减少 IO。
        """
        # 1. 绝对路径检查
        if os.path.isabs(filename) and os.path.exists(filename):
            return filename

        if not self.project_root:
            return filename

        # 2. 标准拼接
        candidate_std = os.path.join(self.project_root, filename)
        if os.path.exists(candidate_std):
            return candidate_std

        # 3. 模糊前缀修复
        root_path_str = str(self.project_root)
        root_name = os.path.basename(root_path_str.rstrip(os.sep))
        prefix = root_name + os.sep

        if filename.startswith(prefix):
            stripped = filename[len(prefix):]
            candidate_overlap = os.path.join(self.project_root, stripped)
            if os.path.exists(candidate_overlap):
                return candidate_overlap

        # 4. 路径回溯
        if os.path.isabs(filename):  # 只有原名为绝对路径时才回溯
            parts = filename.split(os.sep)
            for i in range(1, min(len(parts), 10)):  # 限制回溯深度
                rel_candidate = os.path.join(*parts[-i:])
                abs_candidate = os.path.join(self.project_root, rel_candidate)
                if os.path.exists(abs_candidate):
                    return abs_candidate

        return candidate_std

    @lru_cache(maxsize=10000)
    def resolve_artifact_path(self, filename: str) -> str:
        if os.path.isabs(filename):
            return filename

        if self.project_root:
            candidate = os.path.join(self.project_root, filename)
            if os.path.exists(candidate):
                return candidate
        return filename

    # =========================================================
    # Data Management (Low Frequency/High Memory - Small Cache)
    # =========================================================

    def inject_virtual_file(self, rel_path: str, content: str):
        """注入虚拟文件 (不做 LRU，因为这是手动强依赖)"""
        abs_path = os.path.join(self.project_root, rel_path)
        self._virtual_sources[abs_path] = content.encode('utf-8')
        logger.debug(f"Injected virtual source for {rel_path}")

    @lru_cache(maxsize=8)
    def load_artifact(self, filename: str, parser: callable = json.loads) -> Optional[Any]:
        """
        [Memory Critical] 加载 Artifact。
        Artifact 通常很大 (MB级)，且通常只在单个 Worker 处理该文件时使用一次。
        设置极小的 maxsize (如 8)，保证并发处理时够用，但处理完即释放。
        """
        abs_path = self.resolve_artifact_path(filename)

        if not os.path.exists(abs_path):
            return None

        try:
            opener = gzip.open if abs_path.endswith(".gz") else open
            with opener(abs_path, 'rt', encoding='utf-8') as f:
                if parser == json.loads:
                    return json.load(f)
                else:
                    return parser(f.read())
        except Exception as e:
            logger.error(f"Failed to load artifact {abs_path}: {e}")
            return None

    def get_code(self, filename: str, start: int, end: int) -> Optional[str]:
        """获取代码切片"""
        if start is None or end is None or start >= end or start < 0:
            return None

        content_bytes = self._get_source_bytes(filename)
        if content_bytes is None:
            return None

        # 边界检查
        file_len = len(content_bytes)
        if start >= file_len: return None
        actual_end = min(end, file_len)

        try:
            return content_bytes[start:actual_end].decode('utf-8', errors='replace')
        except Exception:
            return None

    def get_surrounding_lines(self, filename: str, center_line: int, window: int = 5) -> Optional[str]:
        # 直接复用 cached lines
        lines = self._get_source_lines(filename)
        if not lines: return None

        total = len(lines)
        c_idx = center_line - 1
        if c_idx < 0 or c_idx >= total: return None

        s_idx = max(0, c_idx - window)
        e_idx = min(total, c_idx + window + 1)

        result = []
        for i in range(s_idx, e_idx):
            prefix = ">" if (i + 1) == center_line else " "
            result.append(f"{prefix} {i + 1:4d} | {lines[i].rstrip()}")
        return "\n".join(result)

    def get_file_head(self, filename: str, size: int = 4096) -> bytes:
        """
        [Low Memory Cost] 读取文件头。
        注意：此方法有意不使用 _get_source_bytes 的 LRU 缓存。
        原因：
        1. 避免为了读取头部而强制加载大文件，导致 LRU 热点数据被挤出。
        2. 操作系统层面的 Page Cache 会处理这种短读取的缓冲。
        """
        abs_path = self.resolve_source_path(filename)

        # 1. 优先检查虚拟文件 (In-Memory)
        if abs_path in self._virtual_sources:
            return self._virtual_sources[abs_path][:size]

        # 2. 检查物理文件
        if not os.path.exists(abs_path):
            return b""

        try:
            # 只读前 size 字节，不加载全量
            with open(abs_path, 'rb') as f:
                return f.read(size)
        except Exception as e:
            logger.warning(f"Could not read file head {abs_path}: {e}")
            return b""

    # --- Internal Caches ---

    @lru_cache(maxsize=200)
    def _get_source_bytes(self, filename: str) -> Optional[bytes]:
        """
        [Memory Critical] 源码字节缓存。
        200 个文件通常占用 200KB - 10MB 内存，是安全的。
        """
        # 1. 优先检查虚拟文件
        abs_path = self.resolve_source_path(filename)
        if abs_path in self._virtual_sources:
            return self._virtual_sources[abs_path]

        # 2. 读取物理文件
        if not os.path.exists(abs_path):
            return None

        try:
            with open(abs_path, 'rb') as f:
                return f.read()
        except Exception as e:
            logger.warning(f"Read error {abs_path}: {e}")
            return None

    @lru_cache(maxsize=200)
    def _get_source_lines(self, filename: str) -> Optional[List[str]]:
        """
        [Derived Cache] 行缓存。
        依赖 _get_source_bytes，但也单独缓存以避免重复 splitlines 开销。
        """
        content = self._get_source_bytes(filename)
        if content is None: return None

        try:
            return content.decode('utf-8', errors='replace').splitlines(keepends=True)
        except Exception:
            return None

    # =========================================================
    # Lifecycle Management
    # =========================================================

    def clear_cache(self, resource_type: Optional[ResourceType] = None):
        """
        [Hook] 显式清理缓存。
        在 Frontend Worker 处理完一个 Task 后调用。
        """
        if resource_type is None or resource_type == ResourceType.SOURCE:
            self._get_source_bytes.cache_clear()
            self._get_source_lines.cache_clear()
            self.resolve_source_path.cache_clear()
            # self._virtual_sources.clear() # 虚拟文件通常不清理，或者根据需求清理

        if resource_type is None or resource_type == ResourceType.ARTIFACT:
            self.load_artifact.cache_clear()
            self.resolve_artifact_path.cache_clear()


# Global Singleton
source_manager = SourceCodeManager()