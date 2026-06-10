"""Parser configuration for CPG SDK."""
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel, Field


DEFAULT_PARSER_IGNORED_DIRS = {
    ".git", ".svn", ".idea", ".vscode", "__pycache__",
    "build", "dist", "bin", "obj", "docs", "documentation",
    "test", "tests", "examples", "samples", "scripts", "tools"
}

DEFAULT_PARSER_IGNORED_PATTERNS = {
    "test_*", "mock_*", "spec_*", "example_*", "*_test*"
}


class ParserConfig(BaseModel):
    """解析器配置"""
    languages: List[str] = Field(default=["c", "cpp"], description="Languages to parse")
    n_workers: int = Field(default=8, description="Parallel workers for Parsing")
    import_path: Optional[Path] = Field(
        default=None,
        description="Path containing 'compile_commands.json'. Code artifacts must be in a subdirectory named 'ast_artifacts' here."
    )
    skip_uncompiled: bool = Field(
        default=False,
        description="If True, only parse files that have a corresponding Clang Artifact (compile_commands entry). Skip others."
    )

    include_paths: List[str] = Field(default_factory=list, description="Global include paths for C/C++")
    skip_dirs: List[str] = Field(default_factory=lambda: list(DEFAULT_PARSER_IGNORED_DIRS), description="Directories to ignore")
    exclude_patterns: List[str] = Field(default_factory=lambda: list(DEFAULT_PARSER_IGNORED_PATTERNS),
                                        description="Files/dirs starting with these prefixes are ignored")
    fail_fast: bool = Field(default=False, description="Stop immediately on parser errors")
