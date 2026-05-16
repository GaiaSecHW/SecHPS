"""
codedmap/api/routers/knowledge.py

Thin HTTP adapter for knowledge dump and projection endpoints.

Design constraints:
  - Routers are transport adapters only — no business logic lives here.
  - All domain logic is delegated to codedmap.app.services.knowledge (canonical).
  - Request validation is handled by Pydantic models.
  - Responses are built from service outputs, not constructed inline.

Phase 05 canonical locations:
  - Matcher DTOs/engine: codedmap.app.services.matcher
  - Knowledge models: codedmap.app.services.knowledge  (Phase 05-01 canonical)
  - Matcher infra adapter: codedmap.infra.matcher.adapters.sqlite

Phase 05-03 endpoint surface (final):
  POST /knowledge/dump    — export all knowledge artifacts from the active graph
  POST /knowledge/project — project a batch of knowledge artifacts onto the graph

GET /knowledge/export is removed — POST /knowledge/dump is the canonical dump endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from codedmap.app.services.knowledge import (
    ProjectionRequest,
    ProjectionResponse,
    dump_knowledge,
    project_knowledge,
)
from codedmap.api.deps import get_store
from codedmap.infra.matcher.adapters.sqlite import SqliteMatcherAdapter

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/dump", summary="Dump all knowledge artifacts from the active graph")
async def dump_knowledge_endpoint(
    store=Depends(get_store),
) -> JSONResponse:
    """Dump all knowledge artifacts (notes and tags) from the active CPG graph.

    This endpoint is a thin adapter: it delegates all enumeration logic to
    ``dump_knowledge()`` in the service layer and returns the typed artifact list.

    Returns:
        JSON body: {"artifacts": [...], "total": N}
        HTTP 200 always — dump is a read-only operation.
    """
    artifacts = dump_knowledge(store=store)
    return JSONResponse(
        content={
            "artifacts": [a.model_dump(mode="json") for a in artifacts],
            "total": len(artifacts),
        },
        status_code=200,
    )


@router.post("/project", summary="Project knowledge artifacts onto the active graph")
async def project_knowledge_endpoint(
    body: ProjectionRequest,
    store=Depends(get_store),
) -> JSONResponse:
    """Project a batch of knowledge artifacts (notes / tags) onto the active CPG graph.

    This endpoint is a thin adapter: it validates the request shape and delegates
    all matching and projection logic to ``project_knowledge()`` in the service layer.

    The store-backed SQLite matcher adapter resolves candidates for each artifact's
    SemanticSignature.  Ambiguity, orphan, and no-hash handling are preserved.

    HTTP status semantics:
      200 — all artifacts projected successfully (failed == 0)
      207 — partial success when allow_partial=True (some failed)
      422 — strict mode failure when allow_partial=False (any failure)
    """
    matcher_adapter = SqliteMatcherAdapter(store)

    response: ProjectionResponse = project_knowledge(
        artifacts=body.artifacts,
        allow_partial=body.allow_partial,
        adapter=matcher_adapter,
        store=store,
    )

    status_code = 200 if response.failed == 0 else (207 if body.allow_partial else 422)
    return JSONResponse(
        content=response.model_dump(mode="json"),
        status_code=status_code,
    )
