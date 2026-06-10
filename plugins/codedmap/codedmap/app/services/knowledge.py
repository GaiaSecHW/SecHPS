"""
codedmap.app.services.knowledge — Canonical Knowledge Projection Domain module.

Phase 05-01: This is the single canonical home for all knowledge projection
domain logic. Replaces codedmap.app.services.knowledge_service.

Design decisions:
  D-01: Canonical module path is codedmap/app/services/knowledge.py
  D-05–D-09: Discriminated NOTE/TAG union with typed fields (no payload dict)
  D-08: target_signature decoupled from storage IDs (no node_id)
  D-09: TagArtifact uses 'tag' field (not 'name')

Architecture:
  - All models are transport-agnostic (no FastAPI types)
  - API routers import from here, not from knowledge_service.py
  - Matcher engine canonical location: codedmap.app.services.matcher
  - codedmap.app.services.knowledge_service is deleted (Phase 05-01 Task 2)

Domain coverage:
  - NoteArtifact: typed NOTE projection with title/content/category/source
  - TagArtifact: typed TAG projection with tag/source
  - KnowledgeArtifact: discriminated union type alias (NoteArtifact | TagArtifact)
  - ProjectionError, ProjectionRequest, ProjectionResponse: batch projection contracts
  - project_knowledge: orchestrates batch artifact projection via matcher
  - FederationEngine: cross-graph federation (deferred to Phase 4)
"""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from codedmap.core.schema.common import GlobalNodeRef, SemanticSignature, normalize_file_path

# ---------------------------------------------------------------------------
# Matcher engine re-export — canonical location: codedmap.app.services.matcher
# ---------------------------------------------------------------------------
from codedmap.app.services.matcher import run_matcher  # noqa: F401
from codedmap.infra.matcher.query_adapter import MatcherQueryAdapter, RawCandidateRow


# ===========================================================================
# Knowledge projection models — discriminated NOTE/TAG union
# ===========================================================================

class NoteArtifact(BaseModel):
    """Typed NOTE artifact for projecting a note onto a CPG node.

    Fields mirror the VULNERABILITY/COORDINATION/SECURITY_BOUNDARY note schema
    without using a payload envelope.
    """

    model_config = ConfigDict(frozen=True)

    artifact_type: Literal["NOTE"] = Field(
        default="NOTE",
        description="Discriminating type — always NOTE for NoteArtifact",
    )
    schema_version: Literal["1.0"] = Field(
        ..., description="Schema version — must be '1.0'"
    )
    target_signature: SemanticSignature = Field(
        ..., description="Semantic coordinates of the target CPG node"
    )

    # NOTE-specific typed fields
    title: str = Field(..., description="Short title for the note")
    content: str = Field(..., description="Full note content / body text")
    category: str = Field(..., description="Note category (e.g., VULNERABILITY, COORDINATION)")
    source: str = Field(..., description="Origin of this note (e.g., 'manual', 'agent', 'auto')")
    confidence: Optional[float] = Field(
        default=None, description="Confidence score 0.0–1.0 (optional)"
    )
    status: Optional[str] = Field(
        default=None, description="Note lifecycle status (e.g., OPEN, CONFIRMED, DISMISSED)"
    )


class TagArtifact(BaseModel):
    """Typed TAG artifact for projecting a security tag onto a CPG node.

    Uses 'tag' field (not 'name') per D-09 to avoid confusion with node name.
    """

    model_config = ConfigDict(frozen=True)

    artifact_type: Literal["TAG"] = Field(
        default="TAG",
        description="Discriminating type — always TAG for TagArtifact",
    )
    schema_version: Literal["1.0"] = Field(
        ..., description="Schema version — must be '1.0'"
    )
    target_signature: SemanticSignature = Field(
        ..., description="Semantic coordinates of the target CPG node"
    )

    # TAG-specific typed fields
    tag: str = Field(..., description="Ontology tag to apply (e.g., 'SINK:SQL_INJECT')")
    source: str = Field(..., description="Origin of this tag (e.g., 'manual', 'agent', 'auto')")
    confidence: Optional[float] = Field(
        default=None, description="Confidence score 0.0–1.0 (optional)"
    )
    reason: Optional[str] = Field(
        default=None, description="Human-readable rationale for the tag (optional)"
    )


class _KnowledgeArtifactMeta(type):
    """Metaclass that provides model_validate() as a class method on KnowledgeArtifact."""

    def model_validate(cls, obj: Any, **kwargs: Any) -> "NoteArtifact | TagArtifact":
        from pydantic import TypeAdapter
        _union_type = Annotated[
            Union[NoteArtifact, TagArtifact],
            Field(discriminator="artifact_type"),
        ]
        adapter = TypeAdapter(_union_type)
        return adapter.validate_python(obj, **kwargs)


class KnowledgeArtifact(metaclass=_KnowledgeArtifactMeta):
    """Discriminated union of NoteArtifact and TagArtifact, keyed by artifact_type.

    Use KnowledgeArtifact.model_validate(dict) to parse from a raw dict.
    Direct instantiation: use NoteArtifact(...) or TagArtifact(...).

    Usage:
        artifact = KnowledgeArtifact.model_validate({"artifact_type": "NOTE", ...})
    """
    pass


# ===========================================================================
# Batch projection error and response models
# ===========================================================================

class ProjectionError(BaseModel):
    """Deterministic error record for a single failed artifact projection."""

    model_config = ConfigDict(frozen=True)

    index: int = Field(..., description="0-based artifact index in the batch")
    artifact_type: str = Field(..., description="Artifact type that failed")
    code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable error description")
    field_path: Optional[str] = Field(
        default=None, description="Dotted path to the offending field, if applicable"
    )


class ProjectionRequest(BaseModel):
    """Request to project a batch of knowledge artifacts onto a CPG graph."""

    artifacts: List[Union[NoteArtifact, TagArtifact]] = Field(
        default_factory=list,
        description="Ordered list of knowledge artifacts to project",
    )
    allow_partial: bool = Field(
        default=False,
        description="Allow partial success: persist valid artifacts and collect failures",
    )


class ProjectionResponse(BaseModel):
    """Response from a knowledge projection operation.

    Phase 05-02: Extended with typed tier counters (D-23 through D-26).
    """

    projected: int = Field(..., description="Number of artifacts successfully projected")
    failed: int = Field(..., description="Number of artifacts that failed to project")
    allow_partial: bool = Field(
        ..., description="Whether partial success was permitted in this batch"
    )
    errors: List[ProjectionError] = Field(
        default_factory=list,
        description="Per-artifact failure records (populated only when failed > 0)",
    )
    # Tier counters (D-24 / D-26) — exact/evolved/orphaned/ambiguous
    exact_matches: int = Field(
        default=0,
        description="TIER_1 and TIER_1B successful matches (exact hash+name+path or name+path)",
    )
    evolved_matches: int = Field(
        default=0,
        description="TIER_2 successful matches (name+path matched but hash differs — evolved node)",
    )
    orphaned: int = Field(
        default=0,
        description="TIER_3 no-match outcomes (artifact has no surviving node in graph)",
    )
    ambiguous: int = Field(
        default=0,
        description="Multiple candidates found — auto-pick refused (AMBIGUOUS outcome)",
    )


# ===========================================================================
# Projection service
# ===========================================================================

def project_knowledge(
    *,
    artifacts: List[Union[NoteArtifact, TagArtifact]],
    allow_partial: bool,
    adapter: Union[MatcherQueryAdapter, None] = None,
    candidates: Union[List[RawCandidateRow], None] = None,
    store: Any = None,  # CPGStore — optional, required for real persistence
) -> ProjectionResponse:
    """Orchestrate knowledge projection using semantic matcher results.

    Phase 05-02: Adds real NOTE/TAG persistence and typed tier counters.

    Candidate source (exactly one must be provided):
      - adapter:    A MatcherQueryAdapter implementation.  The engine calls
                    adapter.lookup_candidates(signature) per artifact.
      - candidates: Pre-fetched list of RawCandidateRow dicts shared across
                    all artifacts (for unit tests or simple callers).

    Persistence:
      - NOTE artifacts are persisted via store.insights.upsert() (D-11).
      - TAG artifacts are persisted via store.tags.add() (D-12).
      - If store is None, matched artifacts are counted but NOT persisted
        (backward-compatible simulation mode for unit tests using candidates=).

    Batch modes (D-27):
      allow_partial=False (strict):
        - All-or-nothing: if ANY artifact fails matching OR persistence,
          all previously written insights/tags are rolled back.
        - projected=0, failed=len(artifacts) on any failure.

      allow_partial=True (partial):
        - MATCHED artifacts are persisted, failures are collected per-artifact.
        - projected + failed == len(artifacts).

    Tier counters (D-24 / D-26):
      - TIER_1 and TIER_1B -> exact_matches
      - TIER_2             -> evolved_matches
      - AMBIGUOUS          -> ambiguous
      - ORPHANED (TIER_3)  -> orphaned

    Args:
        artifacts:     Ordered list of NoteArtifact or TagArtifact objects.
        allow_partial: Strict (False) or partial (True) transactional mode.
        adapter:       MatcherQueryAdapter implementation (infra layer).
        candidates:    Pre-fetched RawCandidateRow list (for tests / simple use).
        store:         Active CPGStore for real persistence (optional).

    Returns:
        ProjectionResponse with projected, failed, allow_partial, errors, and
        tier counters (exact_matches, evolved_matches, orphaned, ambiguous).
    """
    errors: List[ProjectionError] = []
    # Per-artifact match results (idx -> MatchResult)
    match_results: Dict[int, Any] = {}

    exact_matches = 0
    evolved_matches = 0
    orphaned = 0
    ambiguous = 0

    # --- Phase 1: Match all artifacts (no persistence yet) ---
    for idx, artifact in enumerate(artifacts):
        result = run_matcher(
            artifact_index=idx,
            signature=artifact.target_signature,
            adapter=adapter,
            candidates=candidates,
        )
        match_results[idx] = result

        if result.status == "MATCHED":
            if result.tier in ("TIER_1", "TIER_1B"):
                exact_matches += 1
            elif result.tier == "TIER_2":
                evolved_matches += 1
        elif result.status == "AMBIGUOUS":
            ambiguous += 1
            error_code = "AMBIGUOUS"
            errors.append(
                ProjectionError(
                    index=idx,
                    artifact_type=artifact.artifact_type,
                    code=error_code,
                    message=f"Artifact at index {idx} could not be uniquely matched: AMBIGUOUS",
                    field_path="target_signature",
                )
            )
        else:  # ORPHANED
            orphaned += 1
            errors.append(
                ProjectionError(
                    index=idx,
                    artifact_type=artifact.artifact_type,
                    code="MATCH_FAILED",
                    message=f"Artifact at index {idx} could not be uniquely matched: {result.status}",
                    field_path="target_signature",
                )
            )

    # Strict mode: bail out immediately if any match failed (no writes)
    if not allow_partial and errors:
        return ProjectionResponse(
            projected=0,
            failed=len(artifacts),
            allow_partial=allow_partial,
            errors=errors,
            exact_matches=0,
            evolved_matches=0,
            orphaned=orphaned,
            ambiguous=ambiguous,
        )

    # --- Phase 2: Persist matched artifacts ---
    # Track what we write for strict-mode rollback
    created_insight_ids: List[int] = []
    added_tags: List[tuple] = []  # (node_id, tag_str) pairs

    matched_count = 0
    persist_errors: List[ProjectionError] = []

    for idx, artifact in enumerate(artifacts):
        result = match_results[idx]
        if result.status != "MATCHED":
            continue  # Already an error — skip

        # Attempt persistence
        node_id = result.matched_node_id
        try:
            if store is not None:
                if artifact.artifact_type == "NOTE":
                    note: NoteArtifact = artifact  # type: ignore[assignment]
                    insight = store.insights.upsert(
                        host_ids=[node_id],
                        category=note.category,
                        source=note.source,
                        title=note.title,
                        content=note.content,
                        confidence=note.confidence,
                        status=note.status or "active",
                    )
                    created_insight_ids.append(insight.id)
                elif artifact.artifact_type == "TAG":
                    tag_art: TagArtifact = artifact  # type: ignore[assignment]
                    store.tags.add(node_id, tag_art.tag)
                    added_tags.append((node_id, tag_art.tag))
            # If store is None: simulation mode — count as persisted without I/O
            matched_count += 1
        except Exception as exc:
            # Persistence failure
            persist_error = ProjectionError(
                index=idx,
                artifact_type=artifact.artifact_type,
                code="PERSISTENCE_FAILED",
                message=f"Artifact at index {idx} matched (node={node_id}) but persistence raised: {exc}",
                field_path=None,
            )
            if not allow_partial:
                # Strict mode: roll back ALL writes and fail the batch
                _rollback_writes(store, created_insight_ids, added_tags)
                return ProjectionResponse(
                    projected=0,
                    failed=len(artifacts),
                    allow_partial=allow_partial,
                    errors=[persist_error],
                    exact_matches=0,
                    evolved_matches=0,
                    orphaned=orphaned,
                    ambiguous=ambiguous,
                )
            else:
                persist_errors.append(persist_error)

    all_errors = errors + persist_errors
    total_failed = len(all_errors)
    # In partial mode: projected = those that actually succeeded persistence
    projected = matched_count if store is not None else len([
        idx for idx, r in match_results.items() if r.status == "MATCHED"
    ])

    return ProjectionResponse(
        projected=projected,
        failed=total_failed,
        allow_partial=allow_partial,
        errors=all_errors,
        exact_matches=exact_matches,
        evolved_matches=evolved_matches,
        orphaned=orphaned,
        ambiguous=ambiguous,
    )


def _rollback_writes(
    store: Any,
    created_insight_ids: List[int],
    added_tags: List[tuple],
) -> None:
    """Roll back all writes made during a strict-mode projection batch.

    Deletes any InsightNodes created and removes any tags added during
    the failed batch.  Best-effort — individual failures are silently
    suppressed to avoid masking the original error.

    Args:
        store:               Active CPGStore (or None for simulation mode).
        created_insight_ids: List of InsightNode IDs to delete.
        added_tags:          List of (node_id, tag_str) pairs to remove.
    """
    if store is None:
        return

    # Remove insight nodes
    for insight_id in created_insight_ids:
        try:
            store.insights.delete_insight_by_id(insight_id)
        except Exception:
            pass

    # Remove tags
    for node_id, tag_str in added_tags:
        try:
            store.tags.remove(node_id, tag_str)
        except Exception:
            pass


# ===========================================================================
# Dump service — emit portable NOTE/TAG artifacts from the active graph
# ===========================================================================

def dump_knowledge(
    *,
    store: Any,  # CPGStore — avoiding circular import
) -> List[Union[NoteArtifact, TagArtifact]]:
    """Enumerate all knowledge artifacts (notes and tags) from the active CPG store.

    Returns a list of NoteArtifact and TagArtifact objects in canonical Phase-05
    contract format.  The output is directly consumable by project_knowledge()
    without any translation step.

    NOTE artifact construction:
      - Iterates all InsightNodes via store.insights.find_all_insights().
      - Resolves the first host node via the reverse HAS_INSIGHT edge to obtain
        semantic coordinates (name, file_path, node_label, content_hash).
      - InsightNodes with no resolvable host are skipped (orphan global notes).

    TAG artifact construction (Phase-05 asymmetry):
      - Enumerates unique tags via store.tags.list_all().
      - For each tag, finds tagged nodes via store.tags.find_nodes().
      - Per D-15 through D-17, source/confidence/reason are not stored in the
        underlying tag storage; dumped TagArtifacts carry source='dump' and
        confidence/reason=None as intentional asymmetry.

    Args:
        store: Active CPGStore instance with populated graph data.

    Returns:
        List of NoteArtifact and TagArtifact objects (order: notes first, then tags).
    """
    artifacts: List[Union[NoteArtifact, TagArtifact]] = []

    # --- NOTE artifacts: enumerate InsightNodes ---
    try:
        insights = store.insights.find_all_insights()
    except Exception:
        insights = []

    for insight in insights:
        # Resolve the host node to derive semantic coordinates
        try:
            hosts = store.query.by_id(insight.id).in_("HAS_INSIGHT").to_list()
        except Exception:
            hosts = []

        if not hosts:
            # No resolvable host — skip orphan global notes
            continue

        # Use the first host node for semantic coordinates
        host = hosts[0]
        node_label = getattr(host, "label", None)
        if node_label is not None:
            node_label_str = node_label.value if hasattr(node_label, "value") else str(node_label)
        else:
            node_label_str = "UNKNOWN"

        host_name = getattr(host, "name", None) or getattr(host, "full_name", None) or ""
        host_file = normalize_file_path(getattr(host, "file_name", None) or "")
        host_hash = getattr(host, "code_hash", None)

        sig = SemanticSignature(
            node_label=node_label_str,
            name=host_name,
            file_path=host_file,
            content_hash=host_hash,
        )

        # Extract InsightNode category as string
        raw_category = getattr(insight, "category", "UNKNOWN")
        if hasattr(raw_category, "value"):
            category_str = raw_category.value
        else:
            category_str = str(raw_category)

        note = NoteArtifact(
            schema_version="1.0",
            target_signature=sig,
            title=getattr(insight, "title", "") or "",
            content=getattr(insight, "content", "") or "",
            category=category_str,
            source=getattr(insight, "source", "dump") or "dump",
            confidence=getattr(insight, "confidence", None),
            status=getattr(insight, "status", None),
        )
        artifacts.append(note)

    # --- TAG artifacts: enumerate tagged nodes ---
    # Per D-15 through D-17 (Phase-05 asymmetry): tag storage is string-only;
    # source/confidence/reason are artifact-level metadata only, not in storage.
    try:
        all_tags = store.tags.list_all()
    except Exception:
        all_tags = []

    for tag_str in all_tags:
        try:
            tagged_nodes = store.tags.find_nodes(tag_str)
        except Exception:
            tagged_nodes = []

        for node in tagged_nodes:
            node_label = getattr(node, "label", None)
            if node_label is not None:
                node_label_str = node_label.value if hasattr(node_label, "value") else str(node_label)
            else:
                node_label_str = "UNKNOWN"

            node_name = getattr(node, "name", None) or getattr(node, "full_name", None) or ""
            node_file = normalize_file_path(getattr(node, "file_name", None) or "")
            node_hash = getattr(node, "code_hash", None)

            sig = SemanticSignature(
                node_label=node_label_str,
                name=node_name,
                file_path=node_file,
                content_hash=node_hash,
            )

            tag_art = TagArtifact(
                schema_version="1.0",
                target_signature=sig,
                tag=tag_str,
                source="dump",  # Storage asymmetry: source not stored in tag storage
                confidence=None,
                reason=None,
            )
            artifacts.append(tag_art)

    return artifacts


# ===========================================================================
# Federation engine — re-exported from canonical domain module (Phase 06)
# ===========================================================================

# FederationEngine is now implemented at codedmap.app.services.domain.federation.
# Re-export here for backward compatibility and to satisfy TestCanonicalKnowledgeModuleExists.
from codedmap.app.services.domain.federation import FederationEngine  # noqa: F401
