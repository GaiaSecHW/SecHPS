"""
Architecture guards for the Knowledge Projection Domain canonical path.

Phase 05-01 update:
  - Canonical module is codedmap.app.services.knowledge (not knowledge_service.py)
  - knowledge_service.py is deleted — no shim allowed
  - domain/knowledge.py is deleted or empty (no implementation logic)
  - API routers import from codedmap.app.services.knowledge
  - FederationEngine deferred contract preserved at new canonical path

Phase 05-03 update (final surface):
  - POST /knowledge/dump is the canonical dump endpoint
  - GET /knowledge/export is removed — no compatibility shim retained
  - POST /knowledge/project is preserved with 200/207/422 semantics
  - dump_knowledge() is imported and used in knowledge router
  - No references to knowledge_service.py in any touched file

Phase 06 update (federation activation):
  - FederationEngine now requires adapter argument — no zero-arg construction
  - No NotImplementedError in domain/federation.py — all stubs replaced with real delegation
  - federation.py router no longer returns 501 or references FederationDeferredResponse
  - TestFederationDeferredBehaviorPreserved replaced by TestFederationActivated

These guards replace the Phase 03-03 guards that pointed at knowledge_service.py.
"""

import pathlib
import importlib


class TestLegacyKnowledgeServiceDeleted:
    """The old knowledge_service.py must be deleted — no shim directories allowed."""

    def test_knowledge_service_module_deleted(self):
        """codedmap/app/services/knowledge_service.py must be removed (Phase 05-01)."""
        path = pathlib.Path("codedmap/app/services/knowledge_service.py")
        assert not path.exists(), (
            "codedmap/app/services/knowledge_service.py must be deleted. "
            "The canonical knowledge module is now codedmap/app/services/knowledge.py. "
            "No shim files allowed per CLAUDE.md Refactoring Rules."
        )

    def test_knowledge_service_not_importable(self):
        """codedmap.app.services.knowledge_service must not be importable."""
        try:
            importlib.import_module("codedmap.app.services.knowledge_service")
            raise AssertionError(
                "codedmap.app.services.knowledge_service should not be importable — "
                "knowledge_service.py must be deleted"
            )
        except (ImportError, ModuleNotFoundError):
            pass  # expected


class TestDomainKnowledgeDeleted:
    """codedmap/app/services/domain/knowledge.py must not contain implementation logic."""

    def test_domain_knowledge_has_no_implementation_logic(self):
        """domain/knowledge.py must be deleted or contain zero implementation logic."""
        path = pathlib.Path("codedmap/app/services/domain/knowledge.py")
        if not path.exists():
            return  # Deleted entirely — ideal
        source = path.read_text(encoding="utf-8")
        # Must not define any classes or functions — only re-exports allowed
        import ast
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                raise AssertionError(
                    f"codedmap/app/services/domain/knowledge.py defines '{node.name}' "
                    "— it must contain zero implementation logic. "
                    "Only re-exports from codedmap.app.services.knowledge are allowed, "
                    "or the file must be deleted entirely."
                )


class TestApiServicesFilesDeleted:
    """The api/services business modules must remain deleted (Phase 03 contract)."""

    def test_api_services_knowledge_deleted(self):
        """codedmap/api/services/knowledge.py must remain removed."""
        path = pathlib.Path("codedmap/api/services/knowledge.py")
        assert not path.exists(), (
            "codedmap/api/services/knowledge.py must be deleted. "
            "Knowledge service logic belongs in codedmap/app/services/knowledge.py."
        )

    def test_api_services_matcher_deleted(self):
        """codedmap/api/services/matcher.py must remain removed."""
        path = pathlib.Path("codedmap/api/services/matcher.py")
        assert not path.exists(), (
            "codedmap/api/services/matcher.py must be deleted. "
            "Matcher logic belongs in codedmap/app/services/matcher.py."
        )

    def test_api_services_federation_deleted(self):
        """codedmap/api/services/federation.py must remain removed."""
        path = pathlib.Path("codedmap/api/services/federation.py")
        assert not path.exists(), (
            "codedmap/api/services/federation.py must be deleted. "
            "Federation service belongs in codedmap/app/services/knowledge.py."
        )


class TestCanonicalKnowledgeModuleExists:
    """Knowledge/federation service logic must exist at the canonical path."""

    def test_knowledge_module_importable(self):
        """codedmap.app.services.knowledge must be importable."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert mod is not None

    def test_note_artifact_model_exists(self):
        """NoteArtifact must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "NoteArtifact"), (
            "NoteArtifact must exist in app/services/knowledge"
        )

    def test_tag_artifact_model_exists(self):
        """TagArtifact must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "TagArtifact"), (
            "TagArtifact must exist in app/services/knowledge"
        )

    def test_knowledge_artifact_union_exists(self):
        """KnowledgeArtifact discriminated union must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "KnowledgeArtifact"), (
            "KnowledgeArtifact must exist in app/services/knowledge"
        )

    def test_project_knowledge_function_exists(self):
        """project_knowledge() function must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "project_knowledge"), (
            "project_knowledge() function must exist in app/services/knowledge"
        )

    def test_run_matcher_reexported(self):
        """run_matcher must be re-exported from codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "run_matcher"), (
            "run_matcher() must be re-exported from app/services/knowledge "
            "(canonical location: app/services/matcher)"
        )

    def test_run_matcher_canonical_location(self):
        """Phase 04: run_matcher canonical location is codedmap.app.services.matcher."""
        mod = importlib.import_module("codedmap.app.services.matcher")
        assert hasattr(mod, "run_matcher"), (
            "run_matcher() must exist at its Phase 04 canonical path: "
            "codedmap.app.services.matcher"
        )

    def test_federation_engine_exists(self):
        """FederationEngine must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "FederationEngine"), (
            "FederationEngine must exist in app/services/knowledge"
        )


class TestKnowledgeRouterUsesCanonicalPath:
    """knowledge/federation API routers must import from codedmap.app.services.knowledge."""

    def test_knowledge_router_imports_from_canonical_knowledge(self):
        """codedmap/api/routers/knowledge.py must import from codedmap.app.services.knowledge."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "from codedmap.app.services.knowledge import" in source, (
            "codedmap/api/routers/knowledge.py must import from "
            "codedmap.app.services.knowledge (canonical Phase 05 path), "
            "not from knowledge_service or domain.knowledge"
        )

    def test_knowledge_router_does_not_import_knowledge_service(self):
        """codedmap/api/routers/knowledge.py must NOT import knowledge_service."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "knowledge_service" not in source, (
            "codedmap/api/routers/knowledge.py must NOT reference knowledge_service — "
            "that module is deleted. Use codedmap.app.services.knowledge instead."
        )

    def test_knowledge_router_does_not_import_api_services(self):
        """codedmap/api/routers/knowledge.py must NOT import from codedmap.api.services."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "from codedmap.api.services" not in source, (
            "codedmap/api/routers/knowledge.py must NOT import from codedmap.api.services — "
            "that namespace is removed. Use codedmap.app.services.knowledge instead."
        )

    def test_federation_router_does_not_import_api_services(self):
        """codedmap/api/routers/federation.py must NOT import from codedmap.api.services."""
        source = pathlib.Path("codedmap/api/routers/federation.py").read_text(encoding="utf-8")
        assert "from codedmap.api.services" not in source, (
            "codedmap/api/routers/federation.py must NOT import from codedmap.api.services"
        )


class TestFederationActivated:
    """Phase 06: Federation engine is fully activated — no more NotImplementedError stubs."""

    def test_federation_engine_requires_adapter(self):
        """FederationEngine must require an adapter argument — no zero-arg construction."""
        from codedmap.app.services.domain.federation import FederationEngine
        import inspect
        sig = inspect.signature(FederationEngine.__init__)
        params = list(sig.parameters.keys())
        assert "adapter" in params, (
            "FederationEngine.__init__ must accept 'adapter' parameter — "
            "Phase 06 activated service requires FederationRegistryAdapter"
        )

    def test_federation_engine_does_not_raise_not_implemented(self):
        """FederationEngine methods must NOT raise NotImplementedError — Phase 06 activated."""
        import ast
        import pathlib
        source = pathlib.Path("codedmap/app/services/domain/federation.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and node.exc is not None:
                if isinstance(node.exc, ast.Call):
                    func = node.exc.func
                    name = getattr(func, "id", None)
                    if name == "NotImplementedError":
                        raise AssertionError(
                            "FederationEngine still contains 'raise NotImplementedError' — "
                            "Phase 06 must replace all stubs with real adapter delegation"
                        )

    def test_federation_router_no_501_status(self):
        """Federation API router must not return 501 status — Phase 06 activated."""
        import pathlib
        source = pathlib.Path("codedmap/api/routers/federation.py").read_text(encoding="utf-8")
        assert "501" not in source, (
            "codedmap/api/routers/federation.py still contains '501' — "
            "Phase 06 must replace all deferred 501 responses with real endpoints"
        )

    def test_federation_router_no_deferred_response(self):
        """FederationDeferredResponse must be removed — Phase 06 activated."""
        import pathlib
        source = pathlib.Path("codedmap/api/routers/federation.py").read_text(encoding="utf-8")
        assert "FederationDeferredResponse" not in source, (
            "FederationDeferredResponse still exists in federation router — "
            "Phase 06 must replace it with real response models"
        )

    def test_federation_engine_register_returns_manifest(self):
        """FederationEngine.register_graph must return GraphManifest type annotation."""
        import pathlib
        source = pathlib.Path("codedmap/app/services/domain/federation.py").read_text(encoding="utf-8")
        assert "GraphManifest" in source, (
            "FederationEngine.register_graph must return GraphManifest — "
            "not GlobalNodeRef (old stub) or NotImplementedError"
        )


class TestPhase05FinalRouterSurface:
    """Phase 05-03 final API surface: POST dump/project, no GET export."""

    def test_router_has_post_dump_not_get_export(self):
        """POST /dump must be registered; GET /export must NOT exist."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        post_dump = any(path.endswith("/dump") and "POST" in methods for path, methods in routes)
        get_export = any(path.endswith("/export") and "GET" in methods for path, methods in routes)
        assert post_dump, (
            "POST /knowledge/dump must be registered — Phase 05-03 canonical dump endpoint"
        )
        assert not get_export, (
            "GET /knowledge/export must be removed — use POST /knowledge/dump instead"
        )

    def test_router_imports_dump_knowledge(self):
        """knowledge.py router must import dump_knowledge from canonical service module."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "dump_knowledge" in source, (
            "codedmap/api/routers/knowledge.py must import dump_knowledge — "
            "the POST /dump endpoint must delegate to the service layer"
        )

    def test_router_no_get_export_source(self):
        """knowledge.py router source must not contain GET /export route definition."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "@router.get(\"/export\"" not in source and "@router.get('/export'" not in source, (
            "GET /export route definition found in knowledge.py — must be removed (Phase 05-03)"
        )

    def test_router_has_post_project(self):
        """POST /project must remain registered for artifact projection."""
        from codedmap.api.routers import knowledge as kr
        routes = [(r.path, list(r.methods)) for r in kr.router.routes]
        post_project = any(path.endswith("/project") and "POST" in methods for path, methods in routes)
        assert post_project, "POST /knowledge/project must remain registered"

    def test_router_no_knowledge_service_reference(self):
        """knowledge.py router must not reference knowledge_service (deleted module)."""
        source = pathlib.Path("codedmap/api/routers/knowledge.py").read_text(encoding="utf-8")
        assert "knowledge_service" not in source, (
            "codedmap/api/routers/knowledge.py references knowledge_service — "
            "that module is deleted; use codedmap.app.services.knowledge"
        )

    def test_dump_knowledge_function_exists_in_service(self):
        """dump_knowledge() must exist in codedmap.app.services.knowledge."""
        mod = importlib.import_module("codedmap.app.services.knowledge")
        assert hasattr(mod, "dump_knowledge"), (
            "dump_knowledge() function must exist in codedmap.app.services.knowledge "
            "(Phase 05-02 canonical location)"
        )
