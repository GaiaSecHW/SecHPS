"""Note domain router: /note/*

Thin HTTP adapter — all business logic is in codedmap.app.services.domain_services.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from fastapi.responses import JSONResponse

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http
from codedmap.app.services.domain_services import (
    note_add as svc_note_add,
    note_list as svc_note_list,
    note_show as svc_note_show,
    note_promote as svc_note_promote,
    note_confirm as svc_note_confirm,
    note_remove as svc_note_remove,
)

router = APIRouter(prefix="/note", tags=["note"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class NoteAddBody(BaseModel):
    node_ids: Optional[List[int]] = None
    title: str
    content: str
    category: str = "COORDINATION"
    source: str = "agent"
    confidence: Optional[float] = None
    scope: str = "campaign"
    knowledge_class: str = "assessment"
    campaign_id: Optional[str] = None


class NoteRemoveBody(BaseModel):
    note_id: Optional[int] = None
    node_ids: Optional[List[int]] = None
    category: Optional[str] = None


class NotePromoteBody(BaseModel):
    note_id: int


class NoteConfirmBody(BaseModel):
    note_id: int


# ---------------------------------------------------------------------------
# Note routes
# ---------------------------------------------------------------------------

@router.post("/add")
async def note_add(
    body: NoteAddBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.query.note_validation import NoteSchemaValidationError

    async with lock:
        try:
            result = svc_note_add(
                store,
                title=body.title,
                content=body.content,
                node_ids=body.node_ids,
                category=body.category,
                source=body.source,
                confidence=body.confidence,
                scope=body.scope,
                knowledge_class=body.knowledge_class,
                campaign_id=body.campaign_id,
                created_by=f"{agent_id}@note:add",
            )
        except NoteSchemaValidationError as e:
            response = CLIResponse.error_response(
                "note", "SCHEMA_VALIDATION_ERROR", str(e), details=e.details
            )
            return cli_response_to_http(response)
        except ValueError as e:
            response = CLIResponse.error_response("note", "INVALID_ARGUMENT", str(e))
            return cli_response_to_http(response)

    response = CLIResponse(
        command="note",
        result={
            "kind": "object",
            "content": {
                "note": result,
                "write_visibility": {
                    "scope": body.scope,
                    "knowledge_class": body.knowledge_class,
                    "campaign_id": body.campaign_id,
                },
            },
        },
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/list")
def note_list(
    node_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),
    knowledge_class: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    try:
        result = svc_note_list(
            store,
            node_id=node_id,
            category=category,
            scope=scope,
            knowledge_class=knowledge_class,
            campaign_id=campaign_id,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        response = CLIResponse.error_response("note", "INTERNAL_ERROR", str(e))
        return cli_response_to_http(response)

    notes = result["notes"]
    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": {"notes": notes, "total": result["total"]}},
        metadata=CLIMetadata(
            total=result["total"],
            limit=result["limit"],
            offset=result["offset"],
            has_more=result["has_more"],
            truncated=result["truncated"],
        ),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/show")
def note_show(note_id: int = Query(...), store=Depends(get_store)):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    try:
        result = svc_note_show(store, note_id=note_id)
    except ValueError as e:
        response = CLIResponse.error_response("note", "NODE_NOT_FOUND", str(e))
        return cli_response_to_http(response)

    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return JSONResponse(content=response.model_dump(mode="json"))


@router.post("/promote")
async def note_promote(
    body: NotePromoteBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        try:
            result = svc_note_promote(
                store,
                note_id=body.note_id,
                created_by=f"{agent_id}@note:promote",
            )
        except ValueError as e:
            response = CLIResponse.error_response("note", "INVALID_ARGUMENT", str(e))
            return cli_response_to_http(response)

    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return JSONResponse(content=response.model_dump(mode="json"))


@router.post("/confirm")
async def note_confirm(
    body: NoteConfirmBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        try:
            result = svc_note_confirm(
                store,
                note_id=body.note_id,
                created_by=f"{agent_id}@note:confirm",
            )
        except ValueError as e:
            response = CLIResponse.error_response("note", "INVALID_ARGUMENT", str(e))
            return cli_response_to_http(response)

    response = CLIResponse(
        command="note",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return JSONResponse(content=response.model_dump(mode="json"))


@router.post("/remove")
async def note_remove(
    body: NoteRemoveBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store)
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata

    async with lock:
        try:
            svc_note_remove(
                store,
                note_id=body.note_id,
                node_ids=body.node_ids,
                category=body.category,
                created_by=f"{agent_id}@note:remove",
            )
        except ValueError as e:
            response = CLIResponse.error_response("note", "INVALID_ARGUMENT", str(e))
            return cli_response_to_http(response)

    response = CLIResponse.success_response(command="note", nodes=[], metadata=CLIMetadata(total=0))
    return cli_response_to_http(response)
