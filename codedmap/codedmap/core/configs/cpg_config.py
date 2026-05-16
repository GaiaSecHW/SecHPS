"""CPGConfig — composition root aggregating all sub-config modules."""
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from .storage import StorageConfig
from .parser import ParserConfig
from .ai import AIConfig
from .analysis import AnalysisConfig
from .dispatch import DispatchConfig
from .pipeline import PipelineConfig
from .joern import JoernImportConfig


class CPGConfig(BaseModel):
    """
    Global configuration root.
    Aggregates all sub-module configs as the single entry point for SDK configuration.
    """

    project_root: Path = Field(default=Path("."), description="Root directory of the source code")
    project_name: Optional[str] = None
    workspace: Optional[Path] = Field(
        default=None,
        description="Workspace directory for CPG build artifacts. Default: <project_root>/workspace"
    )

    storage: StorageConfig = Field(default_factory=StorageConfig)
    parser: ParserConfig = Field(default_factory=ParserConfig)
    ai: AIConfig = Field(default_factory=AIConfig)
    analysis: AnalysisConfig = Field(default_factory=AnalysisConfig)
    dispatch: DispatchConfig = Field(default_factory=DispatchConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    joern_import: JoernImportConfig = Field(default_factory=JoernImportConfig)

    @model_validator(mode='after')
    def _resolve_workspace(self):
        if self.workspace is None:
            self.workspace = self.project_root / "workspace"
        elif not self.workspace.is_absolute():
            self.workspace = self.project_root / self.workspace
        return self

    @classmethod
    def for_build(cls, project_root: str, **overrides) -> "CPGConfig":
        """Create a CPGConfig for building a CPG graph."""
        return cls(project_root=Path(project_root), **overrides)

    @classmethod
    def load_from_yaml(cls, yaml_path: str, project_root_override: Optional[str] = None) -> "CPGConfig":
        """Load from YAML file.

        I/O implementation delegated to ``infra.loaders.config_loader``.
        This classmethod is kept for backward compatibility.
        """
        from codedmap.infra.loaders.config_loader import load_config_from_yaml
        return load_config_from_yaml(yaml_path, project_root_override)

    def get_openai_api_key(self) -> Optional[str]:
        """Backward-compatible delegation to AIConfig.get_openai_api_key()."""
        return self.ai.get_openai_api_key()

    def get_neo4j_auth(self):
        """Backward-compatible delegation to StorageConfig.get_neo4j_auth()."""
        return self.storage.get_neo4j_auth()
