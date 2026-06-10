"""Shared note visibility policy helpers."""

from __future__ import annotations

import os
from typing import Any, Callable, Optional


MetadataResolver = Callable[[Any], dict[str, Any]]


def is_all_scope(scope: Optional[str]) -> bool:
    return isinstance(scope, str) and scope.lower() == "all"


def has_explicit_layer_filters(
    scope: Optional[str] = None,
    campaign_id: Optional[str] = None,
    knowledge_class: Optional[str] = None,
) -> bool:
    return any(value is not None for value in (scope, campaign_id, knowledge_class))


def resolve_current_campaign_id(current_campaign_id: Optional[str] = None) -> Optional[str]:
    if current_campaign_id:
        return current_campaign_id
    for env_name in ("CPG_CAMPAIGN_ID", "CDM_CAMPAIGN_ID"):
        value = os.getenv(env_name)
        if value:
            return value
    return None


def note_matches_read_policy(
    note: Any,
    *,
    metadata_resolver: MetadataResolver,
    scope: Optional[str] = None,
    campaign_id: Optional[str] = None,
    knowledge_class: Optional[str] = None,
    current_campaign_id: Optional[str] = None,
) -> bool:
    metadata = metadata_resolver(note)

    if has_explicit_layer_filters(
        scope=scope,
        campaign_id=campaign_id,
        knowledge_class=knowledge_class,
    ):
        if scope is not None and not is_all_scope(scope) and metadata.get("scope") != scope:
            return False
        if campaign_id is not None and metadata.get("campaign_id") != campaign_id:
            return False
        if knowledge_class is not None and metadata.get("knowledge_class") != knowledge_class:
            return False
        return True

    current_campaign_id = resolve_current_campaign_id(current_campaign_id)
    note_scope = metadata.get("scope")
    if note_scope == "stable_confirmed":
        return True
    return (
        current_campaign_id is not None
        and note_scope == "campaign"
        and metadata.get("campaign_id") == current_campaign_id
    )
