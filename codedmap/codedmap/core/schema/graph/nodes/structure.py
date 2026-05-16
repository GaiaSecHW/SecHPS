# codedmap/core/schema/graph/nodes/structure.py
# File system & project structure nodes

from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..base import CPGNode
from ..categories import Declaration, AstNode
from ..enums import Language, NodeLabel
from codedmap.utils.id_generator import generate_deterministic_id


class MetaDataNode(CPGNode):
    """
    图的全局元数据
    """
    label: NodeLabel = NodeLabel.META_DATA
    language: Language = Field(..., description="语言类型: C, PYTHON等")
    version: str = Field(default="1.1", description="CPG 规范版本")
    root_path: str = Field(..., description="项目根路径")
    project_name: Optional[str] = Field(default=None, alias="projectName",
                                         description="Project namespace for multi-project DBs")

    @model_validator(mode='after')
    def generate_meta_id(self):
        if self.id is None:
            self.id = generate_deterministic_id("METADATA", self.root_path, self.language)
        return self


class DirectoryNode(CPGNode):
    """
    目录/文件夹节点。
    用于构建物理文件系统视图：Directory --(CONTAINS)--> File
    """
    label: NodeLabel = NodeLabel.DIRECTORY

    path: str = Field(..., description="目录绝对路径或相对项目的路径")
    name: str = Field(..., description="目录名称，例如 'utils'")

    summary: Optional[str] = Field(default=None, description="[AI] 模块级摘要")
    readme: Optional[str] = Field(default=None, description="目录下的 README.md 内容 (如果有)")

    @model_validator(mode='after')
    def generate_dir_id(self):
        if self.id is None and self.name:
            self.id = generate_deterministic_id("DIR", self.name, self.path)
        return self


class ModuleMetrics(BaseModel):
    """Typed result for module metric computation."""
    model_config = ConfigDict(frozen=True)

    entry_point_count: int = Field(default=0, description="Methods tagged SECURITY:ENTRY_POINT:*")
    method_count: int = Field(default=0, description="Total methods in module (all files, all classes)")
    sink_count: int = Field(default=0, description="Methods tagged SINK:*")
    density: float = Field(default=0.0, description="entry_point_count / method_count")
    file_count: int = Field(default=0, description="Files directly contained in module")


class ModuleNode(CPGNode):
    """
    逻辑模块节点 (Architecture-Level)。

    与 DirectoryNode (物理视图 1:1) 不同，ModuleNode 表示的是系统架构中的逻辑模块。
    一个模块可以跨越多个目录，例如 Linux ext4 模块涉及 fs/ext4/、include/linux/ext4*.h 等。
    """
    label: NodeLabel = NodeLabel.MODULE
    name: str = Field(..., description="模块名称，例如 'ext4', 'tcp_ipv4', 'bpf'")
    full_name: str = Field(..., alias="fullName", description="模块全名，例如 'fs.ext4', 'net.ipv4.tcp'")

    description: Optional[str] = Field(default=None, description="Module purpose and responsibility")

    subsystem: Optional[str] = Field(default=None, description="所属子系统")
    maintainers: List[str] = Field(default_factory=list, description="维护者列表")
    config_options: List[str] = Field(default_factory=list, description="关联的内核配置项")

    entry_points: List[str] = Field(default_factory=list, description="模块的关键入口函数全名列表")

    entry_point_count: Optional[int] = Field(default=None, description="[Cached] Entry point count")
    method_count: Optional[int] = Field(default=None, description="[Cached] Method count")
    sink_count: Optional[int] = Field(default=None, description="[Cached] Sink count")
    density: Optional[float] = Field(default=None, description="[Cached] Entry point density")
    file_count: Optional[int] = Field(default=None, description="[Cached] File count")

    @model_validator(mode='after')
    def generate_module_id(self):
        if self.id is None and self.full_name:
            self.id = generate_deterministic_id("MODULE", self.full_name)
        return self


class FileNode(Declaration):
    label: NodeLabel = NodeLabel.FILE
    hash: Optional[str] = Field(default=None)
    language: Language = Field(..., description="源文件语言类型 (C, CPP, PYTHON 等)")

    topics: List[str] = Field(default_factory=list, description="文件涉及的主题标签")
    summary: Optional[str] = Field(default=None, description="文件职责摘要")


class NamespaceBlockNode(Declaration):
    label: NodeLabel = NodeLabel.NAMESPACE_BLOCK

    summary: Optional[str] = Field(default=None, description="模块功能描述")


class DependencyNode(CPGNode):
    """
    依赖库信息 (SCA)
    """
    label: NodeLabel = NodeLabel.DEPENDENCY
    version: str = Field(default="", description="版本号")
    name: str = Field(..., description="库名称")
    dependency_group_id: Optional[str] = Field(default=None, alias="dependencyGroupId")


class ImportNode(AstNode):
    """C #include 或 Python import"""
    label: NodeLabel = NodeLabel.IMPORT
    imported_entity: str = Field(..., alias="importedEntity", description="被引用的头文件或包")
    imported_as: Optional[str] = Field(default=None, alias="importedAs")
    is_system_include: bool = Field(default=False, description="是否为系统库 (<> vs \"\")")
