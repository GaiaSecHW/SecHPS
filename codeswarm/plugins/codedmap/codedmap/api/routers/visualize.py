"""Thin graph visualization router."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from codedmap.api.deps import get_store
from codedmap.api.job_graph import open_job_graph_store

from codedmap.core.schema.visualize import (
    GraphEntrypointSignature,
    VisualizeRequest,
    VisualizeResponse,
)

router = APIRouter(prefix="/api/v1/graph", tags=["graph"])
job_router = APIRouter(prefix="/api/v1/jobs", tags=["graph"])


def _map_graph_entrypoint(item: dict) -> GraphEntrypointSignature:
    """Project shared query-service nodes into the UI-facing flat DTO."""
    return GraphEntrypointSignature(
        id=str(item["id"]),
        name=item["name"],
        full_name=item.get("full_name"),
        node_label=item["label"],
        file_path=item["file"],
    )


def _list_graph_entrypoints(
    *,
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None, description="Entry point type/rule name"),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store,
) -> list[GraphEntrypointSignature]:
    """Expose entrypoints as a flat array for frontend consumers."""
    from codedmap.app.services.query_services import list_entrypoints

    try:
        data = list_entrypoints(
            store=store,
            level=level,
            category=category,
            entry_type=type,
            file_filter=None,
            module=module,
            module_id=module_id,
            limit=limit,
            offset=offset,
            show_all=False,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch graph entrypoints: {exc}",
        ) from exc

    return [_map_graph_entrypoint(item) for item in data["nodes"]]


def _build_visualize_response(*, body: VisualizeRequest, store) -> VisualizeResponse:
    """Expose the visualization contract as a bare graph response."""
    from codedmap.app.services.visualize import VisualizeService, VisualizeServiceError

    try:
        return VisualizeService().build(store=store, request=body)
    except VisualizeServiceError as exc:
        if exc.code == "INVALID_REQUEST":
            raise HTTPException(status_code=400, detail=exc.message) from exc
        if exc.code == "UNSUPPORTED_LENS":
            raise HTTPException(status_code=501, detail=exc.message) from exc
        if exc.code == "ENTRYPOINT_RESOLUTION_FAILED":
            raise HTTPException(status_code=422, detail=exc.message) from exc
        raise HTTPException(status_code=500, detail=f"Failed to build visualize graph: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to build visualize graph: {exc}") from exc


@router.get("/entrypoints", response_model=list[GraphEntrypointSignature], status_code=200)
def list_graph_entrypoints(
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None, description="Entry point type/rule name"),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store=Depends(get_store),
) -> list[GraphEntrypointSignature]:
    return _list_graph_entrypoints(
        level=level,
        category=category,
        type=type,
        limit=limit,
        offset=offset,
        module=module,
        module_id=module_id,
        store=store,
    )


@job_router.get("/{job_id}/graph/entrypoints", response_model=list[GraphEntrypointSignature], status_code=200)
def list_job_graph_entrypoints(
    job_id: str,
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type: Optional[str] = Query(None, description="Entry point type/rule name"),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
) -> list[GraphEntrypointSignature]:
    with open_job_graph_store(job_id) as store:
        return _list_graph_entrypoints(
            level=level,
            category=category,
            type=type,
            limit=limit,
            offset=offset,
            module=module,
            module_id=module_id,
            store=store,
        )


@router.post("/visualize", response_model=VisualizeResponse, status_code=200)
async def visualize_graph(body: VisualizeRequest, store=Depends(get_store)) -> VisualizeResponse:
    return _build_visualize_response(body=body, store=store)


@job_router.post("/{job_id}/graph/visualize", response_model=VisualizeResponse, status_code=200)
async def visualize_job_graph(job_id: str, body: VisualizeRequest) -> VisualizeResponse:
    with open_job_graph_store(job_id) as store:
        return _build_visualize_response(body=body, store=store)
