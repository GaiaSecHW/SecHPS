# codedmap/infra/loaders/config_loader.py
"""
YAML loader for CPGConfig.

Infra layer (Layer 1): performs file I/O (open, yaml.safe_load).
Depends on core/configs for CPGConfig data model.

Extracted from CPGConfig.load_from_yaml() to preserve core's "zero I/O" invariant.
"""

from pathlib import Path
from typing import Optional

import yaml

from codedmap.core.configs.cpg_config import CPGConfig


def load_config_from_yaml(
    yaml_path: str, project_root_override: Optional[str] = None
) -> CPGConfig:
    """
    Load a CPGConfig from a YAML file.

    Args:
        yaml_path: Path to the YAML configuration file.
        project_root_override: If provided, overrides the ``project_root`` field.

    Returns:
        A fully-constructed CPGConfig instance.

    Raises:
        FileNotFoundError: If the YAML file does not exist.
    """
    path = Path(yaml_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {yaml_path}")

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if project_root_override:
        data["project_root"] = project_root_override

    return CPGConfig(**data)
