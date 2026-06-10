"""
Phase 02.1 — API-first assets replacement contract tests.

Tests are grouped by behavior prefix for selective -k targeting:
  - common_schema, graph_uri, file_path  → Task 1 (core/schema/common.py)
  - knowledge_contract, errors_shape     → Task 2 (knowledge.py — canonical NOTE/TAG union)
  - knowledge_project                    → Task 2 (project_knowledge() service)
  - federation                           → Task 3 (FederationEngine deferred contract)
  - teardown, registration, catalog      → Task 3 (legacy assets teardown)

NOTE: Matcher decision-tree tests (exact/no_hash/evolved/orphan/ambiguous) are
owned by tests/app/services/test_matcher.py (Phase 04 dedicated matcher suite).

Phase 05-01 update:
  - KnowledgeArtifact now lives in codedmap.app.services.knowledge (canonical).
  - Discriminated NOTE/TAG union: NoteArtifact (title, content, category, source,
    confidence, status) and TagArtifact (tag, source, confidence, reason).
  - No payload dict, no node_id in target_signature.
  - FederationEngine and projection models remain at knowledge_service for
    backward compat until all callers are migrated in Task 2.
"""

from __future__ import annotations

import sys
import os

sys.path.append(os.getcwd())

import pytest
from pydantic import ValidationError


# ---------------------------------------------------------------------------
# Task 1: common_schema — SemanticSignature and GlobalNodeRef primitives
# ---------------------------------------------------------------------------

class TestSemanticSignature:
    """common_schema: SemanticSignature fields, validation, and name-resolution helper."""

    def test_common_schema_valid_minimal(self):
        from codedmap.core.schema.common import SemanticSignature
        sig = SemanticSignature(
            node_label="METHOD",
            name="main",
            file_path="src/main.c",
        )
        assert sig.node_label == "METHOD"
        assert sig.name == "main"
        assert sig.file_path == "src/main.c"
        assert sig.content_hash is None

    def test_common_schema_with_content_hash(self):
        from codedmap.core.schema.common import SemanticSignature
        sig = SemanticSignature(
            node_label="METHOD",
            name="foo",
            file_path="src/foo.c",
            content_hash="abc123",
        )
        assert sig.content_hash == "abc123"

    def test_common_schema_node_id_is_forbidden(self):
        """SemanticSignature must NOT accept node_id field."""
        from codedmap.core.schema.common import SemanticSignature
        import inspect
        fields = SemanticSignature.model_fields
        assert "node_id" not in fields, "node_id must not exist in SemanticSignature"

    def test_common_schema_required_fields_enforced(self):
        """Missing required fields raise ValidationError."""
        from codedmap.core.schema.common import SemanticSignature
        with pytest.raises(ValidationError):
            SemanticSignature(node_label="METHOD")  # missing name, file_path

    def test_common_schema_field_count(self):
        """Exactly 4 fields: node_label, name, file_path, content_hash."""
        from codedmap.core.schema.common import SemanticSignature
        fields = set(SemanticSignature.model_fields.keys())
        assert fields == {"node_label", "name", "file_path", "content_hash"}


class TestGraphURIValidation:
    """graph_uri: GraphURI format validation via regex."""

    def test_graph_uri_valid_sqlite(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("sqlite://my_graph") is True

    def test_graph_uri_valid_neo4j(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("neo4j://prod-cluster/main") is True

    def test_graph_uri_valid_memory(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("memory://test") is True

    def test_graph_uri_invalid_no_scheme(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("just_a_string") is False

    def test_graph_uri_invalid_empty_path(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("sqlite://") is False

    def test_graph_uri_invalid_special_chars_in_scheme(self):
        from codedmap.core.schema.common import validate_graph_uri
        assert validate_graph_uri("my-scheme://graph") is False


class TestFilePathNormalization:
    """file_path: normalization strips workspace prefix, normalizes slashes, drops leading slash."""

    def test_file_path_strips_absolute_prefix(self):
        from codedmap.core.schema.common import normalize_file_path
        result = normalize_file_path("/home/user/workspace/src/main.c")
        # Should not start with /
        assert not result.startswith("/")

    def test_file_path_normalizes_backslashes(self):
        from codedmap.core.schema.common import normalize_file_path
        result = normalize_file_path("src\\foo\\bar.py")
        assert "\\" not in result
        assert "/" in result or result == "src/foo/bar.py"

    def test_file_path_drops_leading_slash(self):
        from codedmap.core.schema.common import normalize_file_path
        result = normalize_file_path("/src/main.c")
        assert not result.startswith("/")
        assert result == "src/main.c"

    def test_file_path_relative_unchanged(self):
        from codedmap.core.schema.common import normalize_file_path
        result = normalize_file_path("src/main.c")
        assert result == "src/main.c"

    def test_file_path_normalizer_applied_in_signature(self):
        """SemanticSignature applies file_path normalization automatically."""
        from codedmap.core.schema.common import SemanticSignature
        sig = SemanticSignature(
            node_label="METHOD",
            name="init",
            file_path="/abs/workspace/src/init.c",
        )
        assert not sig.file_path.startswith("/")


class TestGlobalNodeRef:
    """common_schema: GlobalNodeRef model validation."""

    def test_common_schema_global_node_ref_valid(self):
        from codedmap.core.schema.common import GlobalNodeRef
        ref = GlobalNodeRef(graph_uri="sqlite://test", node_id=42)
        assert ref.graph_uri == "sqlite://test"
        assert ref.node_id == 42

    def test_common_schema_global_node_ref_invalid_uri(self):
        from codedmap.core.schema.common import GlobalNodeRef
        with pytest.raises(ValidationError):
            GlobalNodeRef(graph_uri="not_a_valid_uri", node_id=1)

    def test_common_schema_global_node_ref_fields(self):
        from codedmap.core.schema.common import GlobalNodeRef
        fields = set(GlobalNodeRef.model_fields.keys())
        assert fields == {"graph_uri", "node_id"}


class TestSemanticNameResolution:
    """common_schema: resolve_semantic_name helper uses FULL_NAME -> NAME -> CODE order."""

    def test_common_schema_name_resolution_full_name_preferred(self):
        from codedmap.core.schema.common import resolve_semantic_name
        result = resolve_semantic_name(full_name="pkg.Cls.method", name="method", code=None)
        assert result == "pkg.Cls.method"

    def test_common_schema_name_resolution_falls_back_to_name(self):
        from codedmap.core.schema.common import resolve_semantic_name
        result = resolve_semantic_name(full_name=None, name="method", code=None)
        assert result == "method"

    def test_common_schema_name_resolution_falls_back_to_code(self):
        from codedmap.core.schema.common import resolve_semantic_name
        result = resolve_semantic_name(full_name=None, name=None, code="x = foo()")
        assert result is not None
        assert len(result) > 0

    def test_common_schema_name_resolution_code_truncated(self):
        from codedmap.core.schema.common import resolve_semantic_name
        long_code = "x" * 200
        result = resolve_semantic_name(full_name=None, name=None, code=long_code)
        assert len(result) <= 64

    def test_common_schema_name_resolution_all_none_raises(self):
        from codedmap.core.schema.common import resolve_semantic_name
        with pytest.raises(ValueError):
            resolve_semantic_name(full_name=None, name=None, code=None)


# ---------------------------------------------------------------------------
# Task 2: knowledge_contract — Canonical NOTE/TAG discriminated union
# Phase 05-01: KnowledgeArtifact lives at codedmap.app.services.knowledge
# ---------------------------------------------------------------------------

class TestKnowledgeArtifactContract:
    """knowledge_contract: NoteArtifact/TagArtifact typed fields, no payload envelope."""

    def test_knowledge_contract_note_artifact_valid(self):
        """NoteArtifact accepts artifact_type=NOTE with title, content, category, source."""
        from codedmap.app.services.knowledge import NoteArtifact
        artifact = NoteArtifact(
            schema_version="1.0",
            target_signature={
                "node_label": "METHOD",
                "name": "login",
                "file_path": "src/auth.py",
            },
            title="SQL injection in login",
            content="CVE details",
            category="VULNERABILITY",
            source="manual",
        )
        assert artifact.artifact_type == "NOTE"
        assert artifact.schema_version == "1.0"
        assert artifact.title == "SQL injection in login"
        assert artifact.content == "CVE details"
        assert artifact.category == "VULNERABILITY"
        assert artifact.source == "manual"

    def test_knowledge_contract_note_artifact_optional_fields(self):
        """NoteArtifact accepts optional confidence and status fields."""
        from codedmap.app.services.knowledge import NoteArtifact
        artifact = NoteArtifact(
            schema_version="1.0",
            target_signature={
                "node_label": "METHOD",
                "name": "login",
                "file_path": "src/auth.py",
            },
            title="test",
            content="details",
            category="COORDINATION",
            source="agent",
            confidence=0.9,
            status="OPEN",
        )
        assert artifact.confidence == 0.9
        assert artifact.status == "OPEN"

    def test_knowledge_contract_tag_artifact_valid(self):
        """TagArtifact accepts artifact_type=TAG with tag, source fields."""
        from codedmap.app.services.knowledge import TagArtifact
        artifact = TagArtifact(
            schema_version="1.0",
            target_signature={
                "node_label": "METHOD",
                "name": "execute",
                "file_path": "src/db.py",
            },
            tag="SINK:SQL_INJECT",
            source="manual",
        )
        assert artifact.artifact_type == "TAG"
        assert artifact.tag == "SINK:SQL_INJECT"
        assert artifact.source == "manual"

    def test_knowledge_contract_tag_artifact_optional_fields(self):
        """TagArtifact accepts optional confidence and reason fields."""
        from codedmap.app.services.knowledge import TagArtifact
        artifact = TagArtifact(
            schema_version="1.0",
            target_signature={
                "node_label": "METHOD",
                "name": "execute",
                "file_path": "src/db.py",
            },
            tag="SINK:SQL_INJECT",
            source="auto",
            confidence=0.85,
            reason="raw SQL query construction",
        )
        assert artifact.confidence == 0.85
        assert artifact.reason == "raw SQL query construction"

    def test_knowledge_contract_tag_uses_tag_field_not_name(self):
        """TagArtifact must use 'tag' field (not 'name') per D-09."""
        from codedmap.app.services.knowledge import TagArtifact
        import inspect
        fields = TagArtifact.model_fields
        assert "tag" in fields, "TagArtifact must have 'tag' field"
        assert "name" not in fields, "TagArtifact must NOT have 'name' field — use 'tag'"

    def test_knowledge_contract_note_missing_title_rejected(self):
        """NoteArtifact requires title — missing raises ValidationError."""
        from codedmap.app.services.knowledge import NoteArtifact
        with pytest.raises(ValidationError):
            NoteArtifact(
                schema_version="1.0",
                target_signature={
                    "node_label": "METHOD",
                    "name": "main",
                    "file_path": "src/main.c",
                },
                # missing title, content, category, source
            )

    def test_knowledge_contract_tag_missing_tag_field_rejected(self):
        """TagArtifact requires tag field — missing raises ValidationError."""
        from codedmap.app.services.knowledge import TagArtifact
        with pytest.raises(ValidationError):
            TagArtifact(
                schema_version="1.0",
                target_signature={
                    "node_label": "METHOD",
                    "name": "execute",
                    "file_path": "src/db.py",
                },
                source="manual",
                # missing tag
            )

    def test_knowledge_contract_schema_version_mandatory(self):
        """schema_version field must be '1.0' — missing value rejected."""
        from codedmap.app.services.knowledge import NoteArtifact
        with pytest.raises(ValidationError):
            NoteArtifact(
                # missing schema_version
                target_signature={
                    "node_label": "METHOD",
                    "name": "main",
                    "file_path": "src/main.c",
                },
                title="test",
                content="test",
                category="COORDINATION",
                source="manual",
            )

    def test_knowledge_contract_wrong_schema_version_rejected(self):
        """schema_version='2.0' must be rejected (only '1.0' allowed)."""
        from codedmap.app.services.knowledge import NoteArtifact
        with pytest.raises(ValidationError):
            NoteArtifact(
                schema_version="2.0",
                target_signature={
                    "node_label": "METHOD",
                    "name": "main",
                    "file_path": "src/main.c",
                },
                title="test",
                content="test",
                category="COORDINATION",
                source="manual",
            )

    def test_knowledge_contract_no_payload_field(self):
        """NoteArtifact and TagArtifact must NOT have a payload field."""
        from codedmap.app.services.knowledge import NoteArtifact, TagArtifact
        assert "payload" not in NoteArtifact.model_fields, (
            "NoteArtifact must not have 'payload' — use typed fields"
        )
        assert "payload" not in TagArtifact.model_fields, (
            "TagArtifact must not have 'payload' — use typed fields"
        )

    def test_knowledge_contract_no_node_id_in_signature(self):
        """target_signature must NOT accept node_id — storage ID decoupling."""
        from codedmap.app.services.knowledge import NoteArtifact
        from codedmap.core.schema.common import SemanticSignature
        artifact = NoteArtifact(
            schema_version="1.0",
            target_signature={
                "node_label": "METHOD",
                "name": "login",
                "file_path": "src/auth.py",
            },
            title="test",
            content="details",
            category="COORDINATION",
            source="manual",
        )
        assert isinstance(artifact.target_signature, SemanticSignature)
        assert "node_id" not in SemanticSignature.model_fields

    def test_knowledge_contract_discriminated_union_note(self):
        """KnowledgeArtifact union resolves to NoteArtifact for artifact_type=NOTE."""
        from codedmap.app.services.knowledge import KnowledgeArtifact, NoteArtifact
        artifact = KnowledgeArtifact.model_validate({
            "artifact_type": "NOTE",
            "schema_version": "1.0",
            "target_signature": {
                "node_label": "METHOD",
                "name": "login",
                "file_path": "src/auth.py",
            },
            "title": "Test finding",
            "content": "Some details",
            "category": "VULNERABILITY",
            "source": "manual",
        })
        assert isinstance(artifact, NoteArtifact)
        assert artifact.artifact_type == "NOTE"

    def test_knowledge_contract_discriminated_union_tag(self):
        """KnowledgeArtifact union resolves to TagArtifact for artifact_type=TAG."""
        from codedmap.app.services.knowledge import KnowledgeArtifact, TagArtifact
        artifact = KnowledgeArtifact.model_validate({
            "artifact_type": "TAG",
            "schema_version": "1.0",
            "target_signature": {
                "node_label": "METHOD",
                "name": "execute",
                "file_path": "src/db.py",
            },
            "tag": "SINK:SQL_INJECT",
            "source": "manual",
        })
        assert isinstance(artifact, TagArtifact)
        assert artifact.artifact_type == "TAG"

    def test_knowledge_contract_unknown_type_rejected(self):
        """MODULE_ASSIGNMENT and other unknown types must be rejected."""
        from codedmap.app.services.knowledge import KnowledgeArtifact
        with pytest.raises((ValidationError, ValueError)):
            KnowledgeArtifact.model_validate({
                "artifact_type": "MODULE_ASSIGNMENT",
                "schema_version": "1.0",
                "target_signature": {
                    "node_label": "FILE",
                    "name": "main.c",
                    "file_path": "src/main.c",
                },
            })


class TestProjectionRequestResponse:
    """knowledge_contract: ProjectionRequest / ProjectionResponse shape."""

    def test_knowledge_contract_projection_request_allow_partial_default_false(self):
        from codedmap.app.services.knowledge import ProjectionRequest
        req = ProjectionRequest(artifacts=[])
        assert req.allow_partial is False

    def test_knowledge_contract_projection_request_allow_partial_true(self):
        from codedmap.app.services.knowledge import ProjectionRequest
        req = ProjectionRequest(artifacts=[], allow_partial=True)
        assert req.allow_partial is True

    def test_knowledge_contract_projection_response_has_allow_partial(self):
        """ProjectionResponse includes allow_partial field for audit traceability."""
        from codedmap.app.services.knowledge import ProjectionResponse
        resp = ProjectionResponse(
            projected=0,
            failed=0,
            allow_partial=False,
            errors=[],
        )
        assert resp.allow_partial is False


class TestBatchErrorShape:
    """errors_shape: batch error DTOs are deterministic with required fields."""

    def test_errors_shape_required_fields(self):
        from codedmap.app.services.knowledge import ProjectionError
        err = ProjectionError(
            index=0,
            artifact_type="NOTE",
            code="MATCH_FAILED",
            message="No matching node found",
            field_path=None,
        )
        assert err.index == 0
        assert err.artifact_type == "NOTE"
        assert err.code == "MATCH_FAILED"
        assert err.message == "No matching node found"

    def test_errors_shape_field_path_optional(self):
        from codedmap.app.services.knowledge import ProjectionError
        err = ProjectionError(
            index=1,
            artifact_type="TAG",
            code="AMBIGUOUS",
            message="Multiple candidates found",
        )
        assert err.field_path is None

    def test_errors_shape_fields_complete(self):
        """Exactly the required fields: index, artifact_type, code, message, field_path."""
        from codedmap.app.services.knowledge import ProjectionError
        fields = set(ProjectionError.model_fields.keys())
        assert "index" in fields
        assert "artifact_type" in fields
        assert "code" in fields
        assert "message" in fields
        assert "field_path" in fields


# ---------------------------------------------------------------------------
# Task 2 (Wave 2): knowledge_project / allow_partial / errors_shape
# ---------------------------------------------------------------------------

# Shared candidate pool for projection tests (mirrors the engine test pool above)
_PROJ_POOL = [
    {
        "node_id": 100,
        "node_label": "METHOD",
        "name": "login",
        "file_path": "src/auth.py",
        "content_hash": "deadbeef",
    },
    {
        "node_id": 200,
        "node_label": "METHOD",
        "name": "logout",
        "file_path": "src/auth.py",
        "content_hash": "cafebabe",
    },
]


def _make_note_artifact(name: str, file_path: str, content_hash: str | None = None):
    """Helper — build a minimal NoteArtifact dict."""
    sig = {
        "node_label": "METHOD",
        "name": name,
        "file_path": file_path,
    }
    if content_hash is not None:
        sig["content_hash"] = content_hash
    return {
        "artifact_type": "NOTE",
        "schema_version": "1.0",
        "target_signature": sig,
        "title": "test",
        "content": "test note",
        "category": "COORDINATION",
        "source": "manual",
    }


class TestKnowledgeProjectService:
    """knowledge_project: project_knowledge() service behavior."""

    def test_knowledge_project_all_matched_strict(self):
        """allow_partial=False: all artifacts matched -> projected=N, failed=0, errors=[]."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_note_artifact("login", "src/auth.py", "deadbeef")),
            NoteArtifact(**_make_note_artifact("logout", "src/auth.py", "cafebabe")),
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.projected == 2
        assert resp.failed == 0
        assert resp.errors == []
        assert resp.allow_partial is False

    def test_knowledge_project_orphan_strict_fails_all(self):
        """allow_partial=False: any orphan -> projected=0, failed=N (all-or-nothing)."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_note_artifact("login", "src/auth.py", "deadbeef")),   # MATCHED
            NoteArtifact(**_make_note_artifact("missing_fn", "src/gone.py")),           # ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        assert resp.projected == 0
        assert resp.failed == 2
        assert len(resp.errors) == 1  # only the orphaned one has an error
        assert resp.errors[0].index == 1
        assert resp.errors[0].code in ("MATCH_FAILED", "ORPHANED")

    def test_knowledge_project_allow_partial_persists_valid(self):
        """allow_partial=True: valid artifacts projected, failures collected, not rolled back."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_note_artifact("login", "src/auth.py", "deadbeef")),   # MATCHED
            NoteArtifact(**_make_note_artifact("missing_fn", "src/gone.py")),           # ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=_PROJ_POOL)
        assert resp.projected == 1
        assert resp.failed == 1
        assert len(resp.errors) == 1
        assert resp.errors[0].index == 1
        assert resp.allow_partial is True

    def test_knowledge_project_ambiguous_produces_error(self):
        """AMBIGUOUS match -> error with code=AMBIGUOUS."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        # Two METHOD nodes with same name+path but different hashes
        pool_with_dupes = [
            {"node_id": 1, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "aaa"},
            {"node_id": 2, "node_label": "METHOD", "name": "dup", "file_path": "src/x.py", "content_hash": "bbb"},
        ]
        artifacts = [
            NoteArtifact(**_make_note_artifact("dup", "src/x.py")),  # no hash -> AMBIGUOUS
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=pool_with_dupes)
        assert resp.failed == 1
        assert resp.errors[0].code == "AMBIGUOUS"

    def test_knowledge_project_error_index_matches_batch_position(self):
        """ProjectionError.index must match the 0-based artifact position in the batch."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [
            NoteArtifact(**_make_note_artifact("login", "src/auth.py", "deadbeef")),   # idx=0 MATCHED
            NoteArtifact(**_make_note_artifact("bad1", "src/gone.py")),                 # idx=1 ORPHANED
            NoteArtifact(**_make_note_artifact("bad2", "src/also_gone.py")),            # idx=2 ORPHANED
        ]
        resp = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=_PROJ_POOL)
        error_indices = {e.index for e in resp.errors}
        assert error_indices == {1, 2}

    def test_knowledge_project_response_has_allow_partial_echo(self):
        """ProjectionResponse.allow_partial must echo the request's flag."""
        from codedmap.app.services.knowledge import project_knowledge, NoteArtifact

        artifacts = [NoteArtifact(**_make_note_artifact("login", "src/auth.py", "deadbeef"))]
        resp_strict = project_knowledge(artifacts=artifacts, allow_partial=False, candidates=_PROJ_POOL)
        resp_partial = project_knowledge(artifacts=artifacts, allow_partial=True, candidates=_PROJ_POOL)
        assert resp_strict.allow_partial is False
        assert resp_partial.allow_partial is True


class TestKnowledgeRouterContract:
    """knowledge_project: /knowledge/project router endpoint shape and delegation."""

    def test_knowledge_project_router_exists(self):
        """Router file must be importable and expose @router.post('/project')."""
        from codedmap.api.routers import knowledge as kr
        assert kr.router is not None

    def test_knowledge_project_router_prefix(self):
        """Router prefix must be /knowledge."""
        from codedmap.api.routers import knowledge as kr
        assert kr.router.prefix == "/knowledge"

    def test_knowledge_project_endpoint_registered(self):
        """POST /project must be registered on the router."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        # Paths include the router prefix, so check suffix
        post_project = any(path.endswith("/project") and "POST" in methods for path, methods in routes)
        assert post_project, "POST /project must be registered"

    def test_knowledge_export_endpoint_not_registered(self):
        """GET /export must NOT be registered — removed in Phase 05-03 (use POST /dump)."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        # Paths include the router prefix, so check suffix
        get_export = any(path.endswith("/export") and "GET" in methods for path, methods in routes)
        assert not get_export, (
            "GET /export must be removed — the canonical dump endpoint is POST /dump (Phase 05-03)"
        )

    def test_knowledge_dump_endpoint_on_router(self):
        """POST /dump must be registered on the knowledge router (Phase 05-03)."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        post_dump = any(path.endswith("/dump") and "POST" in methods for path, methods in routes)
        assert post_dump, "POST /dump must be registered on /knowledge router (Phase 05-03)"


# ---------------------------------------------------------------------------
# Task 1 (Wave 3): federation — FederationEngine deferred contract
# ---------------------------------------------------------------------------

class TestFederationServiceActivated:
    """federation: FederationEngine activated with adapter delegation (Phase 06)."""

    def test_federation_service_importable(self):
        """FederationEngine must be importable from codedmap.app.services.domain.federation."""
        from codedmap.app.services.domain.federation import FederationEngine
        assert FederationEngine is not None

    def test_federation_engine_requires_adapter(self):
        """FederationEngine constructor requires an adapter argument."""
        import inspect
        from codedmap.app.services.domain.federation import FederationEngine
        sig = inspect.signature(FederationEngine.__init__)
        params = [p for p in sig.parameters if p != "self"]
        assert "adapter" in params

    def test_federation_engine_has_register_graph(self):
        """FederationEngine has register_graph method."""
        from codedmap.app.services.domain.federation import FederationEngine
        assert hasattr(FederationEngine, "register_graph")

    def test_federation_engine_has_link_boundary(self):
        """FederationEngine has link_boundary method."""
        from codedmap.app.services.domain.federation import FederationEngine
        assert hasattr(FederationEngine, "link_boundary")

    def test_federation_engine_has_get_virtual_neighbors(self):
        """FederationEngine has get_virtual_neighbors method."""
        from codedmap.app.services.domain.federation import FederationEngine
        assert hasattr(FederationEngine, "get_virtual_neighbors")


class TestFederationRouterDeferred:
    """federation: /federation router endpoints all return 501 immediately."""

    def test_federation_router_importable(self):
        """Federation router must be importable."""
        from codedmap.api.routers import federation as fr
        assert fr.router is not None

    def test_federation_router_prefix(self):
        """Router prefix must be /federation."""
        from codedmap.api.routers import federation as fr
        assert fr.router.prefix == "/federation"

    def test_federation_register_endpoint_registered(self):
        """POST /register must be registered on the federation router."""
        from codedmap.api.routers import federation as fr
        routes = [(r.path, list(r.methods)) for r in fr.router.routes]
        post_register = any(path.endswith("/register") and "POST" in methods for path, methods in routes)
        assert post_register, "POST /register must be registered"

    def test_federation_link_endpoint_registered(self):
        """POST /link must be registered on the federation router."""
        from codedmap.api.routers import federation as fr
        routes = [(r.path, list(r.methods)) for r in fr.router.routes]
        post_link = any(path.endswith("/link") and "POST" in methods for path, methods in routes)
        assert post_link, "POST /link must be registered"

    def test_federation_neighbors_endpoint_registered(self):
        """POST /neighbors must be registered on the federation router."""
        from codedmap.api.routers import federation as fr
        routes = [(r.path, list(r.methods)) for r in fr.router.routes]
        post_neighbors = any(path.endswith("/neighbors") and "POST" in methods for path, methods in routes)
        assert post_neighbors, "POST /neighbors must be registered"

    def test_federation_router_uses_global_node_ref(self):
        """Federation router must import GlobalNodeRef from core/schema/common.py."""
        import importlib
        import inspect
        spec = importlib.util.find_spec("codedmap.api.routers.federation")
        assert spec is not None
        source = inspect.getsource(importlib.import_module("codedmap.api.routers.federation"))
        assert "GlobalNodeRef" in source

    def test_register_endpoint_not_501(self):
        """POST /federation/register must no longer return 501 (Phase 06 activated)."""
        import ast
        import inspect
        from codedmap.api.routers import federation as fr
        source = inspect.getsource(fr)
        tree = ast.parse(source)
        # Verify no 501 status code literal in the router source
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value == 501:
                raise AssertionError("Router still contains 501 status code — federation should be activated")

    def test_no_federation_deferred_response(self):
        """FederationDeferredResponse must not exist in federation router (Phase 06)."""
        import inspect
        from codedmap.api.routers import federation as fr
        source = inspect.getsource(fr)
        assert "FederationDeferredResponse" not in source, "FederationDeferredResponse should be removed"


# ---------------------------------------------------------------------------
# Task 2 (Wave 3): teardown — Legacy assets wiring removed
# ---------------------------------------------------------------------------

class TestLegacyAssetsTeardown:
    """teardown: Legacy assets CLI and API surfaces are removed."""

    def test_teardown_assets_cli_module_deleted(self):
        """codedmap/cli/commands/assets.py must not exist."""
        import os
        assets_cli_path = os.path.join(
            os.getcwd(), "codedmap", "cli", "commands", "assets.py"
        )
        assert not os.path.exists(assets_cli_path), (
            "codedmap/cli/commands/assets.py still exists — legacy CLI must be deleted"
        )

    def test_teardown_assets_api_router_deleted(self):
        """codedmap/api/routers/assets.py must not exist."""
        import os
        assets_api_path = os.path.join(
            os.getcwd(), "codedmap", "api", "routers", "assets.py"
        )
        assert not os.path.exists(assets_api_path), (
            "codedmap/api/routers/assets.py still exists — legacy API router must be deleted"
        )

    def test_teardown_cli_main_no_assets_import(self):
        """codedmap/cli/__main__.py must not import or reference assets command."""
        import inspect
        import importlib
        main_mod = importlib.import_module("codedmap.cli.__main__")
        source = inspect.getsource(main_mod)
        assert "assets" not in source, (
            "codedmap/cli/__main__.py still references 'assets' — must be removed"
        )

    def test_teardown_api_app_no_assets_router(self):
        """codedmap/api/app.py must not import or register assets router."""
        import inspect
        import importlib
        app_mod = importlib.import_module("codedmap.api.app")
        source = inspect.getsource(app_mod)
        assert "assets" not in source, (
            "codedmap/api/app.py still references 'assets' — must be removed"
        )

    def test_teardown_assets_not_importable_as_cli_command(self):
        """Importing codedmap.cli.commands.assets must fail with ImportError or ModuleNotFoundError."""
        import importlib
        try:
            importlib.import_module("codedmap.cli.commands.assets")
            raise AssertionError("codedmap.cli.commands.assets should not be importable")
        except (ImportError, ModuleNotFoundError):
            pass  # expected

    def test_teardown_assets_not_importable_as_api_router(self):
        """Importing codedmap.api.routers.assets must fail with ImportError or ModuleNotFoundError."""
        import importlib
        try:
            importlib.import_module("codedmap.api.routers.assets")
            raise AssertionError("codedmap.api.routers.assets should not be importable")
        except (ImportError, ModuleNotFoundError):
            pass  # expected


class TestRegistrationMigration:
    """registration: New knowledge/federation surfaces are registered in app.py."""

    def test_registration_knowledge_router_in_app(self):
        """codedmap/api/app.py must reference knowledge router."""
        import inspect
        import importlib
        app_mod = importlib.import_module("codedmap.api.app")
        source = inspect.getsource(app_mod)
        assert "knowledge" in source, (
            "app.py must include the knowledge router"
        )

    def test_registration_federation_router_in_app(self):
        """codedmap/api/app.py must reference federation router."""
        import inspect
        import importlib
        app_mod = importlib.import_module("codedmap.api.app")
        source = inspect.getsource(app_mod)
        assert "federation" in source, (
            "app.py must include the federation router"
        )


class TestCatalogTeardown:
    """catalog: DOMAIN_DESCRIPTIONS and tools.json updated — no legacy assets domain."""

    def test_catalog_domain_descriptions_no_assets(self):
        """DOMAIN_DESCRIPTIONS in catalog.py must not contain 'assets' key."""
        from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
        assert "assets" not in DOMAIN_DESCRIPTIONS, (
            "DOMAIN_DESCRIPTIONS still contains 'assets' — must be removed"
        )

    def test_catalog_domain_descriptions_has_knowledge(self):
        """DOMAIN_DESCRIPTIONS must contain 'knowledge' domain."""
        from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
        assert "knowledge" in DOMAIN_DESCRIPTIONS, (
            "DOMAIN_DESCRIPTIONS missing 'knowledge' domain"
        )

    def test_catalog_domain_descriptions_has_federation(self):
        """DOMAIN_DESCRIPTIONS must contain 'federation' domain."""
        from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
        assert "federation" in DOMAIN_DESCRIPTIONS, (
            "DOMAIN_DESCRIPTIONS missing 'federation' domain"
        )

    def test_catalog_no_assets_commands(self):
        """CATALOG must not contain any commands with domain='assets'."""
        from codedmap.core.schema.catalog import CATALOG
        assets_cmds = [c for c in CATALOG if c.domain == "assets"]
        assert assets_cmds == [], (
            f"CATALOG still contains assets-domain commands: {[c.name for c in assets_cmds]}"
        )

    def test_catalog_tools_json_no_assets_domain(self):
        """tools/tools.json must not advertise 'assets' domain."""
        import json
        import os
        tools_path = os.path.join(os.getcwd(), "tools", "tools.json")
        if not os.path.exists(tools_path):
            pytest.skip("tools.json not present")
        data = json.loads(open(tools_path).read())
        domains = data.get("domains", {})
        assert "assets" not in domains, (
            "tools/tools.json still lists 'assets' domain — must be removed"
        )
        tools = data.get("tools", [])
        assets_tools = [t for t in tools if t.get("domain") == "assets"]
        assert assets_tools == [], (
            f"tools/tools.json still has assets tools: {[t['name'] for t in assets_tools]}"
        )


# ---------------------------------------------------------------------------
# Phase 05-03 Task 1: POST /knowledge/dump endpoint — thin adapter over dump service
# Phase 05-03 Task 1: GET /knowledge/export removed — no compatibility shim
# ---------------------------------------------------------------------------

class TestKnowledgeDumpEndpoint:
    """Phase 05-03: POST /knowledge/dump is the canonical dump endpoint."""

    def test_knowledge_dump_endpoint_registered(self):
        """POST /dump must be registered on the knowledge router (Phase 05-03)."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        post_dump = any(path.endswith("/dump") and "POST" in methods for path, methods in routes)
        assert post_dump, "POST /dump must be registered on /knowledge router"

    def test_knowledge_export_endpoint_removed(self):
        """GET /export must NOT be registered — removed in Phase 05-03."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        get_export = any(path.endswith("/export") and "GET" in methods for path, methods in routes)
        assert not get_export, (
            "GET /export must be removed from /knowledge router in Phase 05-03. "
            "The canonical dump endpoint is POST /dump."
        )

    def test_knowledge_dump_router_imports_dump_service(self):
        """Router must import dump_knowledge from codedmap.app.services.knowledge."""
        import pathlib
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "dump_knowledge" in source, (
            "codedmap/api/routers/knowledge.py must import and use dump_knowledge "
            "from codedmap.app.services.knowledge"
        )

    def test_knowledge_dump_endpoint_returns_artifact_list(self):
        """POST /knowledge/dump returns {artifacts: [...], total: N} via TestClient."""
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from unittest.mock import MagicMock, patch
        from codedmap.api.routers import knowledge as kr
        from codedmap.api import deps

        app = FastAPI()
        mock_store = MagicMock()
        mock_store.insights.find_all_insights.return_value = []
        mock_store.tags.list_all.return_value = []

        app.dependency_overrides[deps.get_store] = lambda: mock_store
        app.include_router(kr.router)

        client = TestClient(app)
        resp = client.post("/knowledge/dump")
        assert resp.status_code == 200
        data = resp.json()
        assert "artifacts" in data, f"Response missing 'artifacts' key: {data}"
        assert "total" in data, f"Response missing 'total' key: {data}"

    def test_knowledge_dump_endpoint_delegates_to_dump_service(self):
        """POST /knowledge/dump calls dump_knowledge(store=store) — no inline logic."""
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from unittest.mock import MagicMock, patch
        from codedmap.api.routers import knowledge as kr
        from codedmap.api import deps

        app = FastAPI()
        mock_store = MagicMock()

        app.dependency_overrides[deps.get_store] = lambda: mock_store
        app.include_router(kr.router)

        client = TestClient(app)
        with patch("codedmap.api.routers.knowledge.dump_knowledge", return_value=[]) as mock_dump:
            resp = client.post("/knowledge/dump")
            assert resp.status_code == 200
            mock_dump.assert_called_once_with(store=mock_store)


# ---------------------------------------------------------------------------
# Phase 05-02 Task 1: knowledge_dump — Real typed dump from live store
# ---------------------------------------------------------------------------

class TestKnowledgeDumpNoteArtifacts:
    """knowledge_dump: dump_knowledge() emits NoteArtifact entries from store.insights."""

    def _make_store_with_method_and_insight(self):
        """Helper: create in-memory store with one MethodNode and one InsightNode."""
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.utils.id_generator import generate_id

        store = CPGStore(StorageConfig(backend="memory"))
        method_id = generate_id()
        method = MethodNode(
            id=method_id,
            name="login",
            label=NodeLabel.METHOD,
            fileName="src/auth.py",
        )
        graph = CPGGraph()
        graph.add_node(method)
        store._engine.writer.save_graph(graph)

        store.insights.upsert(
            host_ids=[method_id],
            category="VULNERABILITY",
            source="manual",
            title="SQL injection in login",
            content="Details about SQL injection",
            confidence=0.95,
        )
        return store, method_id

    def test_knowledge_dump_note_artifacts_emitted(self):
        """dump_knowledge() returns NoteArtifact entries for all InsightNodes."""
        from codedmap.app.services.knowledge import dump_knowledge, NoteArtifact

        store, method_id = self._make_store_with_method_and_insight()
        try:
            artifacts = dump_knowledge(store=store)
            note_artifacts = [a for a in artifacts if a.artifact_type == "NOTE"]
            assert len(note_artifacts) >= 1, "Expected at least one NoteArtifact"
            art = note_artifacts[0]
            assert isinstance(art, NoteArtifact)
        finally:
            store.close()

    def test_knowledge_dump_note_schema_version_1_0(self):
        """All dumped NoteArtifacts must have schema_version='1.0'."""
        from codedmap.app.services.knowledge import dump_knowledge

        store, method_id = self._make_store_with_method_and_insight()
        try:
            artifacts = dump_knowledge(store=store)
            note_artifacts = [a for a in artifacts if a.artifact_type == "NOTE"]
            for art in note_artifacts:
                assert art.schema_version == "1.0"
        finally:
            store.close()

    def test_knowledge_dump_note_target_signature_has_no_node_id(self):
        """Dumped NoteArtifact target_signature must NOT include node_id."""
        from codedmap.app.services.knowledge import dump_knowledge
        from codedmap.core.schema.common import SemanticSignature

        store, method_id = self._make_store_with_method_and_insight()
        try:
            artifacts = dump_knowledge(store=store)
            note_artifacts = [a for a in artifacts if a.artifact_type == "NOTE"]
            for art in note_artifacts:
                assert isinstance(art.target_signature, SemanticSignature)
                assert "node_id" not in SemanticSignature.model_fields
        finally:
            store.close()

    def test_knowledge_dump_note_has_required_typed_fields(self):
        """Dumped NoteArtifact has title, content, category, source — no payload envelope."""
        from codedmap.app.services.knowledge import dump_knowledge

        store, method_id = self._make_store_with_method_and_insight()
        try:
            artifacts = dump_knowledge(store=store)
            note_artifacts = [a for a in artifacts if a.artifact_type == "NOTE"]
            assert len(note_artifacts) >= 1
            art = note_artifacts[0]
            assert art.title == "SQL injection in login"
            assert "SQL injection" in art.content
            assert art.category == "VULNERABILITY"
            assert art.source == "manual"
            assert art.confidence == 0.95
        finally:
            store.close()


class TestKnowledgeDumpTagArtifacts:
    """knowledge_dump: dump_knowledge() emits TagArtifact entries from store.tags."""

    def _make_store_with_method_and_tag(self):
        """Helper: create in-memory store with one MethodNode with a tag."""
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.utils.id_generator import generate_id

        store = CPGStore(StorageConfig(backend="memory"))
        method_id = generate_id()
        method = MethodNode(
            id=method_id,
            name="execute_query",
            label=NodeLabel.METHOD,
            fileName="src/db.py",
        )
        graph = CPGGraph()
        graph.add_node(method)
        store._engine.writer.save_graph(graph)

        store.tags.add(method_id, "SINK:SQL_INJECT")
        return store, method_id

    def test_knowledge_dump_tag_artifacts_emitted(self):
        """dump_knowledge() returns TagArtifact entries for tagged nodes."""
        from codedmap.app.services.knowledge import dump_knowledge, TagArtifact

        store, method_id = self._make_store_with_method_and_tag()
        try:
            artifacts = dump_knowledge(store=store)
            tag_artifacts = [a for a in artifacts if a.artifact_type == "TAG"]
            assert len(tag_artifacts) >= 1, "Expected at least one TagArtifact"
            art = tag_artifacts[0]
            assert isinstance(art, TagArtifact)
        finally:
            store.close()

    def test_knowledge_dump_tag_has_tag_field_not_name(self):
        """Dumped TagArtifact uses 'tag' field (D-09) — not 'name'."""
        from codedmap.app.services.knowledge import dump_knowledge

        store, method_id = self._make_store_with_method_and_tag()
        try:
            artifacts = dump_knowledge(store=store)
            tag_artifacts = [a for a in artifacts if a.artifact_type == "TAG"]
            assert len(tag_artifacts) >= 1
            art = tag_artifacts[0]
            assert hasattr(art, "tag")
            assert art.tag == "SINK:SQL_INJECT"
        finally:
            store.close()

    def test_knowledge_dump_tag_schema_version_1_0(self):
        """All dumped TagArtifacts have schema_version='1.0'."""
        from codedmap.app.services.knowledge import dump_knowledge

        store, method_id = self._make_store_with_method_and_tag()
        try:
            artifacts = dump_knowledge(store=store)
            tag_artifacts = [a for a in artifacts if a.artifact_type == "TAG"]
            for art in tag_artifacts:
                assert art.schema_version == "1.0"
        finally:
            store.close()

    def test_knowledge_dump_contract_same_as_project_input(self):
        """Dump output artifacts can be directly used as project() input (no translation)."""
        from codedmap.app.services.knowledge import dump_knowledge, KnowledgeArtifact

        store, method_id = self._make_store_with_method_and_tag()
        try:
            artifacts = dump_knowledge(store=store)
            # Each artifact must be parseable by KnowledgeArtifact.model_validate
            for art in artifacts:
                parsed = KnowledgeArtifact.model_validate(art.model_dump())
                assert parsed.artifact_type == art.artifact_type
        finally:
            store.close()


# ---------------------------------------------------------------------------
# Phase 05-04 Task 1: knowledge_project endpoint — real persistence through HTTP
# ---------------------------------------------------------------------------


class TestKnowledgeProjectEndpointPersistence:
    """knowledge_project and endpoint: POST /knowledge/project persists notes via HTTP."""

    def _make_store_with_method(self):
        """Helper: create an in-memory store with one MethodNode ready for exact-match."""
        from codedmap.core.configs.storage import StorageConfig
        from codedmap.infra.storage.store import CPGStore
        from codedmap.core.schema.graph.nodes import MethodNode
        from codedmap.core.schema.graph.enums import NodeLabel
        from codedmap.core.schema.graph import CPGGraph
        from codedmap.utils.id_generator import generate_id

        store = CPGStore(StorageConfig(backend="memory"))
        method_id = generate_id()
        method = MethodNode(
            id=method_id,
            name="vuln_login",
            label=NodeLabel.METHOD,
            fileName="src/auth.py",
        )
        graph = CPGGraph()
        graph.add_node(method)
        store._engine.writer.save_graph(graph)
        return store, method_id

    def test_knowledge_project_endpoint_returns_200_with_exact_match(self):
        """POST /knowledge/project with one exact-match NOTE returns 200, projected==1, failed==0, exact_matches==1."""
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from codedmap.api.routers import knowledge as kr
        from codedmap.api import deps

        store, method_id = self._make_store_with_method()
        try:
            app = FastAPI()
            app.dependency_overrides[deps.get_store] = lambda: store
            app.include_router(kr.router)

            client = TestClient(app)
            payload = {
                "artifacts": [
                    {
                        "artifact_type": "NOTE",
                        "schema_version": "1.0",
                        "target_signature": {
                            "node_label": "METHOD",
                            "name": "vuln_login",
                            "file_path": "src/auth.py",
                        },
                        "title": "SQL injection via login",
                        "content": "Unparameterized query in login handler.",
                        "category": "VULNERABILITY",
                        "source": "endpoint_test",
                    }
                ],
                "allow_partial": False,
            }
            resp = client.post("/knowledge/project", json=payload)
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert data["projected"] == 1, f"Expected projected=1, got {data}"
            assert data["failed"] == 0, f"Expected failed=0, got {data}"
            assert data["exact_matches"] == 1, f"Expected exact_matches=1, got {data}"
        finally:
            store.close()

    def test_knowledge_project_endpoint_persists_note_to_store(self):
        """After POST /knowledge/project, store.insights.find_all_insights() returns the persisted note."""
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from codedmap.api.routers import knowledge as kr
        from codedmap.api import deps

        store, method_id = self._make_store_with_method()
        try:
            app = FastAPI()
            app.dependency_overrides[deps.get_store] = lambda: store
            app.include_router(kr.router)

            client = TestClient(app)
            payload = {
                "artifacts": [
                    {
                        "artifact_type": "NOTE",
                        "schema_version": "1.0",
                        "target_signature": {
                            "node_label": "METHOD",
                            "name": "vuln_login",
                            "file_path": "src/auth.py",
                        },
                        "title": "Endpoint persistence test note",
                        "content": "This note must be readable from store after HTTP call.",
                        "category": "COORDINATION",
                        "source": "endpoint_regression",
                    }
                ],
                "allow_partial": False,
            }
            resp = client.post("/knowledge/project", json=payload)
            assert resp.status_code == 200, f"HTTP call failed: {resp.text}"

            # Verify persistence: note must be retrievable from the store
            all_insights = store.insights.find_all_insights()
            assert len(all_insights) >= 1, (
                "POST /knowledge/project did not persist any InsightNode — "
                "router likely dropped store= argument (simulation mode)"
            )
            titles = [getattr(i, "title", None) for i in all_insights]
            assert "Endpoint persistence test note" in titles, (
                f"Projected note title not found in store. Found titles: {titles}"
            )
            sources = [getattr(i, "source", None) for i in all_insights]
            assert "endpoint_regression" in sources, (
                f"Projected note source not found in store. Found sources: {sources}"
            )
        finally:
            store.close()

    def test_knowledge_project_endpoint_router_wires_store_to_service(self):
        """Regression guard: router source contains store=store in project_knowledge() call.

        This assertion prevents future edits from silently dropping the store=
        argument, which would revert the endpoint to simulation mode without
        any test failure in the unit-test surface.
        """
        import inspect
        from codedmap.api.routers import knowledge as kr

        source = inspect.getsource(kr.project_knowledge_endpoint)
        assert "store=store" in source, (
            "codedmap/api/routers/knowledge.py project_knowledge_endpoint() must pass "
            "store=store to project_knowledge() — without it all projections run in "
            "simulation mode and no notes are persisted. Current source:\n" + source
        )
