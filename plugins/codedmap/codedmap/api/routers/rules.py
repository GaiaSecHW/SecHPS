# codedmap/api/routers/rules.py
"""
Rules domain router: /rules/list, /rules/categories, /rules/show,
/rules/resolve, /rules/add_sink, /rules/add_source, /rules/add_safe,
/rules/add_entrypoint, /rules/tombstone, /rules/validate

All endpoints delegate to codedmap.app.services.domain_services (no CLI stdout-capture).
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from codedmap.api.deps import get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http

router = APIRouter(prefix="/rules", tags=["rules"])


class AddSinkBody(BaseModel):
    name: str
    category: str
    project: str = "."


class AddSourceBody(BaseModel):
    name: str
    category: str
    project: str = "."


class AddSafeBody(BaseModel):
    name: str
    project: str = "."


class AddEntrypointBody(BaseModel):
    name: str
    category: str = "cli"
    pattern_type: str = "function_name"
    func_pattern: Optional[str] = None
    project: str = "."


class TombstoneBody(BaseModel):
    id: str
    reason: str
    project: str = "."


@router.get("/list")
def rules_list(
    type: Optional[str] = Query(None),
    project: str = Query("."),
    limit: int = Query(50),
    offset: int = Query(0),
    show_origin: bool = Query(False),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_list as svc_rules_list

    result = svc_rules_list(
        project=project,
        rule_type=type,
        limit=limit,
        offset=offset,
        show_origin=show_origin,
    )
    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
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


@router.get("/categories")
def rules_categories(project: str = Query(".")):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_categories as svc_rules_categories

    result = svc_rules_categories(project=project)
    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result["total"]),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/show")
def rules_show(merged: bool = Query(True), project: str = Query(".")):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_show as svc_rules_show

    result = svc_rules_show(project=project)
    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result["total"]),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/resolve")
def rules_resolve(name: str = Query(...), project: str = Query(".")):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_resolve as svc_rules_resolve

    result = svc_rules_resolve(function_name=name, project=project)
    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=len(result.get("matches", []))),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/add_sink")
async def rules_add_sink(
    body: AddSinkBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_add_sink as svc_add_sink

    async with lock:
        try:
            result = svc_add_sink(name=body.name, category=body.category, project=body.project)
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("rules", "INVALID_ARGUMENT", str(exc))
            )

    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/add_source")
async def rules_add_source(
    body: AddSourceBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_add_source as svc_add_source

    async with lock:
        try:
            result = svc_add_source(name=body.name, category=body.category, project=body.project)
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("rules", "INVALID_ARGUMENT", str(exc))
            )

    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/add_safe")
async def rules_add_safe(
    body: AddSafeBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_add_safe as svc_add_safe

    async with lock:
        result = svc_add_safe(name=body.name, project=body.project)

    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/add_entrypoint")
async def rules_add_entrypoint(
    body: AddEntrypointBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_add_entrypoint as svc_add_ep

    async with lock:
        result = svc_add_ep(
            name=body.name,
            category=body.category,
            pattern_type=body.pattern_type,
            func_pattern=body.func_pattern,
            project=body.project,
        )

    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/tombstone")
async def rules_tombstone(
    body: TombstoneBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_tombstone as svc_tombstone

    async with lock:
        try:
            result = svc_tombstone(rule_id=body.id, reason=body.reason, project=body.project)
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("rules", "INVALID_ARGUMENT", str(exc))
            )

    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/validate")
def rules_validate(project: str = Query(".")):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import rules_validate as svc_validate

    result = svc_validate(project=project)
    response = CLIResponse(
        command="rules",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result.get("total_issues", 0)),
        success=True,
    )
    return cli_response_to_http(response)
