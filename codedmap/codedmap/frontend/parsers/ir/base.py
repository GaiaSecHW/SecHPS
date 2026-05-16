# codedmap/frontend/parsers/ir/base.py

import logging
from abc import abstractmethod
from typing import Any, Dict, Optional

from codedmap.frontend.parsers.base import AbstractParser
from codedmap.core.graph_builder import CPGBuilder
from codedmap.core.schema.graph.enums import Language
from codedmap.utils.source_manager import source_manager

logger = logging.getLogger("cpg.parser.ir")


class IRParser(AbstractParser):
    """
    [Layer 1] 基于中间表示 (IR) 的解析器基类。

    特点:
    1. 不直接读取源码文件，而是读取构建产物 (Artifacts)。
    2. 使用 source_manager.load_artifact 进行对象级缓存。
    """

    def __init__(self, builder: CPGBuilder, project_root: str = None):
        super().__init__(builder, project_root)
        self._language_enum: Optional[Language] = None

    def _parse_implementation(self, file_path: str) -> Any:
        """
        实现读取 IR 文件 (通常是 JSON)。
        file_path 这里通常指的是 IR 文件的路径，或者是源码路径 (取决于调用约定)。

        约定: 如果传入的是源码路径 (e.g. main.c)，我们需要找到对应的 JSON 路径。
        但为了简化，我们假设上层调度器已经定位到了 JSON 文件路径。
        """
        # 使用 SourceManager 的 Artifact 缓存，避免重复 IO 和 JSON Decode
        data = source_manager.load_artifact(file_path)
        if data is None:
            logger.error(f"Failed to load IR artifact: {file_path}")
        return data

    @abstractmethod
    def run(self, filename: str, root_node: Dict[str, Any]):
        """
        具体的图构建逻辑。
        Args:
            filename: 文件名 (用于节点归属)
            root_node: JSON 反序列化后的字典对象
        """
        pass