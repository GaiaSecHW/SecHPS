# codedmap/core/schema/security/__init__.py
"""
Security domain models, rules, and catalogs.

Canonical location for pure data types used across analysis and app layers.
Moved from app/entrypoints/, app/tracing/, and app/tagging/ to eliminate
analysis→app dependency violations.

Entrypoint models:
    EntryPointLevel, EntryPointCategory, EntryPoint

Entrypoint rules:
    RulePattern, EntryPointRule

Entrypoint catalog:
    EntryPointCatalog

Sink/tracing models:
    SinkCategory, SinkDefinition, TraceHop, TracePath, TraceResult

Sink catalog:
    SinkCatalog

Static security rules:
    StaticSecurityRules

Source models (Phase 31-02):
    SourceCategory, Source

Source rules:
    SourcePattern, SourceRule

Source catalog:
    SourceCatalog

Role models (Phase 37):
    RoleCategory, Role

Note: Rule loading (I/O) lives in codedmap.infra.loaders.cascading_loader
and codedmap.infra.loaders.rule_registry.
"""

from .entrypoint_models import EntryPoint, EntryPointLevel, EntryPointCategory
from .entrypoint_rules import EntryPointRule, RulePattern
from .entrypoint_catalog import EntryPointCatalog
from .sink_models import SinkCategory, SinkDefinition, TraceHop, TracePath, TraceResult
from .sink_catalog import SinkCatalog
from .static_rules import StaticSecurityRules
from .source_models import SourceCategory, Source
from .source_rules import SourcePattern, SourceRule
from .source_catalog import SourceCatalog
from .role_models import RoleCategory, Role


__all__ = [
    # Entrypoint models
    "EntryPoint",
    "EntryPointLevel",
    "EntryPointCategory",
    # Entrypoint rules
    "EntryPointRule",
    "RulePattern",
    # Entrypoint catalog
    "EntryPointCatalog",
    # Sink/tracing models
    "SinkCategory",
    "SinkDefinition",
    "TraceHop",
    "TracePath",
    "TraceResult",
    # Sink catalog
    "SinkCatalog",
    # Static security rules
    "StaticSecurityRules",
    # Source models
    "SourceCategory",
    "Source",
    # Source rules
    "SourcePattern",
    "SourceRule",
    # Source catalog
    "SourceCatalog",
    # Role models
    "RoleCategory",
    "Role",
]
