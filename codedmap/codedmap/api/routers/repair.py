# codedmap/api/routers/repair.py
"""
Repair domain router: /repair/link, /repair/suggest, /repair/list, /repair/undo

All endpoints delegate to codedmap.app.services.domain_services.
No stdout-capture, no CLI command imports.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http
from codedmap.core.schema.catalog import RepairReason

router = APIRouter(prefix="/repair", tags=["repair"])


class RepairLinkBody(BaseModel):
    from_function: str
    from_full_name: Optional[str] = None
    from_file: Optional[str] = None
    to_function: str
    to_full_name: Optional[str] = None
    to_file: Optional[str] = None
    reason: RepairReason
    note: Optional[str] = None


class RepairUndoBody(BaseModel):
    repair_id: Optional[str] = None
    all: bool = False


def _node_file(node) -> Optional[str]:
    return (
        getattr(node, "file_name", None)
        or getattr(node, "fileName", None)
        or getattr(node, "file", None)
    )


def _resolve_method_node_id(
    store,
    function_name: str,
    *,
    full_name: Optional[str] = None,
    file: Optional[str] = None,
    role: str = "function",
) -> int:
    from codedmap.core.schema.graph.enums import NodeLabel

    matches = [
        node for node in store.query.all_nodes(NodeLabel.METHOD).to_list()
        if getattr(node, "name", "") == function_name or getattr(node, "full_name", "") == function_name
    ]
    if full_name:
        matches = [
            node for node in matches
            if getattr(node, "full_name", None) == full_name or getattr(node, "fullName", None) == full_name
        ]
    if file:
        matches = [node for node in matches if _node_file(node) == file]
    if not matches:
        raise ValueError(f"METHOD node not found for {role}: '{function_name}'")
    if len(matches) > 1:
        raise ValueError(f"Ambiguous METHOD node for {role}: '{function_name}' ({len(matches)} matches)")
    return matches[0].id


@router.post("/link")
async def repair_link(
    body: RepairLinkBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import repair_link as svc_link

    try:
        from_id = _resolve_method_node_id(
            store,
            body.from_function,
            full_name=body.from_full_name,
            file=body.from_file,
            role="caller",
        )
        to_id = _resolve_method_node_id(
            store,
            body.to_function,
            full_name=body.to_full_name,
            file=body.to_file,
            role="callee",
        )
    except ValueError as exc:
        return cli_response_to_http(
            CLIResponse.error_response("repair", "INVALID_ARGUMENT", str(exc))
        )

    async with lock:
        try:
            result = svc_link(
                store=store,
                from_id=from_id,
                to_id=to_id,
                reason=body.reason,
                note=body.note,
                created_by=f"{agent_id}@repair:link",
            )
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("repair", "NODE_NOT_FOUND", str(exc))
            )

    response = CLIResponse(
        command="repair",
        target={"raw": f"{result.get('from', '?')} -> {result.get('to', '?')}"},
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/suggest")
def repair_suggest(
    limit: int = Query(100),
    offset: int = Query(0),
    max_candidates: int = Query(3),
    module: Optional[str] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import repair_suggest as svc_suggest

    result = svc_suggest(
        store=store,
        limit=limit,
        offset=offset,
        max_candidates=max_candidates,
        module=module,
    )
    response = CLIResponse(
        command="repair",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(
            total=result.get("total", 0),
            limit=result.get("limit", limit),
            offset=result.get("offset", offset),
            has_more=result.get("has_more", False),
            truncated=result.get("truncated", False),
        ),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/list")
def repair_list(store=Depends(get_store)):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import repair_list as svc_list

    result = svc_list(store=store)
    response = CLIResponse(
        command="repair",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result.get("total", 0)),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/undo")
async def repair_undo(
    body: RepairUndoBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import repair_undo as svc_undo

    if not body.repair_id and not body.all:
        return cli_response_to_http(
            CLIResponse.error_response("repair", "INVALID_ARGUMENT", "Specify repair_id or set all=true")
        )

    async with lock:
        try:
            result = svc_undo(
                store=store,
                repair_id=body.repair_id,
                undo_all=body.all,
                created_by=f"{agent_id}@repair:undo",
            )
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("repair", "NODE_NOT_FOUND", str(exc))
            )

    response = CLIResponse(
        command="repair",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result.get("undone", 0)),
        success=True,
    )
    return cli_response_to_http(response)
