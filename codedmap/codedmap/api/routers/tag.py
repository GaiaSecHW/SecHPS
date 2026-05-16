"""Tag domain router: /tag/*

Thin HTTP adapter — all business logic is in codedmap.app.services.domain_services.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http
from codedmap.app.services.domain_services import (
    tag_add as svc_tag_add,
    tag_remove as svc_tag_remove,
    tag_list as svc_tag_list,
    tag_find as svc_tag_find,
    tag_bulk as svc_tag_bulk,
)

router = APIRouter(prefix="/tag", tags=["tag"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class TagAddBody(BaseModel):
    node_id: int
    tag: str
    confidence: Optional[float] = None
    justification: Optional[str] = None


class TagRemoveBody(BaseModel):
    node_id: int
    tag: str


class TagBulkBody(BaseModel):
    tag: str
    pattern: str
    type: str = "method"


# ---------------------------------------------------------------------------
# Tag routes
# ---------------------------------------------------------------------------

@router.post("/add")
async def tag_add(
    body: TagAddBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        try:
            result = svc_tag_add(
                store, body.node_id, body.tag,
                confidence=body.confidence,
                justification=body.justification,
                created_by=f"{agent_id}@tag:add",
            )
        except ValueError as e:
            response = CLIResponse.error_response("tag", "NODE_NOT_FOUND", str(e))
            return cli_response_to_http(response)

    nodes = [result]
    response = CLIResponse.success_response(
        command="tag", nodes=nodes, metadata=CLIMetadata(total=1),
    )
    return cli_response_to_http(response)


@router.post("/remove")
async def tag_remove(
    body: TagRemoveBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        try:
            result = svc_tag_remove(
                store, body.node_id, body.tag,
                created_by=f"{agent_id}@tag:remove",
            )
        except ValueError as e:
            response = CLIResponse.error_response("tag", "NODE_NOT_FOUND", str(e))
            return cli_response_to_http(response)

    nodes = [result]
    response = CLIResponse.success_response(
        command="tag", nodes=nodes, metadata=CLIMetadata(total=1),
    )
    return cli_response_to_http(response)


@router.get("/list")
def tag_list(
    node_id: Optional[int] = Query(None),
    function: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    try:
        result = svc_tag_list(store, node_id=node_id, function=function, limit=limit, offset=offset)
    except ValueError as e:
        response = CLIResponse.error_response("tag", "NODE_NOT_FOUND", str(e))
        return cli_response_to_http(response)

    if node_id is not None or function is not None:
        # Single-node result
        nodes = [{"node_id": result["node_id"], "name": result["name"], "tags": result["tags"]}]
        response = CLIResponse.success_response(
            command="tag",
            nodes=nodes,
            metadata=CLIMetadata(
                total=result["total"],
                limit=result["limit"],
                offset=result["offset"],
                has_more=result["has_more"],
                truncated=result["truncated"],
            ),
        )
    else:
        # All-tags result
        nodes = result["tags"]
        response = CLIResponse.success_response(
            command="tag",
            nodes=nodes,
            metadata=CLIMetadata(
                total=result["total"],
                limit=result["limit"],
                offset=result["offset"],
                has_more=result["has_more"],
                truncated=result["truncated"],
            ),
        )

    return cli_response_to_http(response)


@router.get("/find")
def tag_find(
    tag: str = Query(...),
    limit: int = Query(50),
    offset: int = Query(0),
    module: Optional[str] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    result = svc_tag_find(store, tag=tag, limit=limit, offset=offset, module=module)
    nodes = result["nodes"]
    response = CLIResponse.success_response(
        command="tag",
        nodes=nodes,
        metadata=CLIMetadata(
            total=result["total"],
            limit=result["limit"],
            offset=result["offset"],
            has_more=result["has_more"],
            truncated=result["truncated"],
        ),
    )
    return cli_response_to_http(response)


@router.post("/bulk")
async def tag_bulk(
    body: TagBulkBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        result = svc_tag_bulk(
            store, pattern=body.pattern, tag=body.tag,
            node_type=body.type,
            created_by=f"{agent_id}@tag:bulk",
        )

    nodes = result["nodes"]
    response = CLIResponse.success_response(
        command="tag", nodes=nodes, metadata=CLIMetadata(total=len(nodes)),
    )
    return cli_response_to_http(response)
