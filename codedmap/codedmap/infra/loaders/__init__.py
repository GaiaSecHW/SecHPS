"""
Loaders — I/O-performing data loaders for configuration files.

Infra layer (Layer 1): depends on core only.
"""

from .config_loader import load_config_from_yaml

__all__ = [
    "load_config_from_yaml",
]
