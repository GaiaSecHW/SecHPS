# codedmap/api/routers/module.py
"""
Module domain router: /module/create, /module/delete, /module/rename,
/module/list, /module/show, /module/assign, /module/remove

All endpoints delegate to codedmap.app.services.domain_services (no cli.commands.module imports).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from codedmap.api.deps import get_store, get_store_lock, require_agent_id
from codedmap.api.app import cli_response_to_http

router = APIRouter(prefix="/module", tags=["module"])


class ModuleCreateBody(BaseModel):
    name: str
    description: str = ""
    full_name: Optional[str] = None
    paths: Optional[List[str]] = None


class ModuleDeleteBody(BaseModel):
    name: str


class ModuleRenameBody(BaseModel):
    name: str
    new_name: str
    new_full_name: Optional[str] = None


class ModuleAssignBody(BaseModel):
    name: str
    paths: List[str]
    justification: str = ""
    confidence: Optional[float] = None


class ModuleRemoveBody(BaseModel):
    name: str
    paths: List[str]


@router.post("/create")
async def module_create(
    body: ModuleCreateBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_create as svc_create

    async with lock:
        try:
            result = svc_create(
                store=store,
                name=body.name,
                description=body.description,
                full_name=body.full_name,
                paths=body.paths,
                created_by=f"{agent_id}@module:create",
            )
        except ValueError as exc:
            return cli_response_to_http(
                CLIResponse.error_response("module", "INVALID_ARGUMENT", str(exc))
            )

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/delete")
async def module_delete(
    body: ModuleDeleteBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_delete as svc_delete
    from codedmap.app.services.scope_utils import ModuleNotFoundError, AmbiguousModuleError

    try:
        async with lock:
            result = svc_delete(store=store, name=body.name, created_by=f"{agent_id}@module:delete")
    except (ModuleNotFoundError, AmbiguousModuleError) as exc:
        return cli_response_to_http(
            CLIResponse.error_response("module", "MODULE_NOT_FOUND", str(exc))
        )

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/rename")
async def module_rename(
    body: ModuleRenameBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_rename as svc_rename
    from codedmap.app.services.scope_utils import ModuleNotFoundError, AmbiguousModuleError

    try:
        async with lock:
            result = svc_rename(
                store=store,
                name=body.name,
                new_name=body.new_name,
                new_full_name=body.new_full_name,
                created_by=f"{agent_id}@module:rename",
            )
    except (ModuleNotFoundError, AmbiguousModuleError) as exc:
        return cli_response_to_http(
            CLIResponse.error_response("module", "MODULE_NOT_FOUND", str(exc))
        )

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/list")
def module_list(
    limit: int = Query(50),
    offset: int = Query(0),
    all: bool = Query(False),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_list as svc_list

    result = svc_list(store=store, limit=limit, offset=offset, show_all=all)
    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": {"modules": result["modules"], "total": result["total"]}},
        metadata=CLIMetadata(
            total=result["total"],
            has_more=result["has_more"],
            limit=result["limit"],
            offset=result["offset"],
            truncated=result["truncated"],
        ),
        success=True,
    )
    return cli_response_to_http(response)


@router.get("/show")
def module_show(
    name: Optional[str] = Query(None),
    module_id: Optional[int] = Query(None),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_show as svc_show
    from codedmap.app.services.scope_utils import ModuleNotFoundError, AmbiguousModuleError

    try:
        result = svc_show(store=store, name=name, module_id=module_id)
    except ValueError as exc:
        err_str = str(exc)
        code = "MODULE_NOT_FOUND" if "not found" in err_str.lower() or "provide" in err_str.lower() else "INVALID_ARGUMENT"
        return cli_response_to_http(CLIResponse.error_response("module", code, err_str))
    except (ModuleNotFoundError, AmbiguousModuleError) as exc:
        return cli_response_to_http(CLIResponse.error_response("module", "MODULE_NOT_FOUND", str(exc)))

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=1),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/assign")
async def module_assign(
    body: ModuleAssignBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_assign as svc_assign
    from codedmap.app.services.scope_utils import ModuleNotFoundError, AmbiguousModuleError

    try:
        async with lock:
            result = svc_assign(
                store=store,
                name=body.name,
                paths=body.paths,
                justification=body.justification,
                confidence=body.confidence,
                created_by=f"{agent_id}@module:assign",
            )
    except (ModuleNotFoundError, AmbiguousModuleError) as exc:
        return cli_response_to_http(
            CLIResponse.error_response("module", "MODULE_NOT_FOUND", str(exc))
        )

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result["assigned"] + result["skipped"]),
        success=True,
    )
    return cli_response_to_http(response)


@router.post("/remove")
async def module_remove(
    body: ModuleRemoveBody,
    agent_id: str = Depends(require_agent_id),
    lock=Depends(get_store_lock),
    store=Depends(get_store),
):
    from codedmap.app.contracts.response import CLIResponse, CLIMetadata
    from codedmap.app.services.domain_services import module_remove_files as svc_remove
    from codedmap.app.services.scope_utils import ModuleNotFoundError, AmbiguousModuleError

    try:
        async with lock:
            result = svc_remove(
                store=store,
                name=body.name,
                paths=body.paths,
                created_by=f"{agent_id}@module:remove",
            )
    except (ModuleNotFoundError, AmbiguousModuleError) as exc:
        return cli_response_to_http(
            CLIResponse.error_response("module", "MODULE_NOT_FOUND", str(exc))
        )

    response = CLIResponse(
        command="module",
        result={"kind": "object", "content": result},
        metadata=CLIMetadata(total=result["removed"]),
        success=True,
    )
    return cli_response_to_http(response)
