# codedmap/core/configs/settings.py
# Backward compatibility shim — imports from new per-config files.
# All new code should import from the specific config module directly.

from .storage import StorageConfig
from .parser import ParserConfig, DEFAULT_PARSER_IGNORED_DIRS, DEFAULT_PARSER_IGNORED_PATTERNS
from .ai import AIConfig
from .analysis import AnalysisConfig
from .dispatch import DispatchConfig
from .pipeline import PipelineConfig
from .joern import JoernImportConfig
from .cpg_config import CPGConfig

__all__ = [
    "StorageConfig", "ParserConfig", "AIConfig", "AnalysisConfig",
    "DispatchConfig", "PipelineConfig", "JoernImportConfig", "CPGConfig",
    "DEFAULT_PARSER_IGNORED_DIRS", "DEFAULT_PARSER_IGNORED_PATTERNS",
]
