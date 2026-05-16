# codedmap/api/app.py
"""
FastAPI application factory for CPG SDK REST API.
"""

import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.responses import Response

from codedmap.app.contracts.response import CLI_SCHEMA_VERSION
from codedmap.api import deps

# Pre-import heavy modules to avoid Python 3.14 threaded-import deadlock
# (_DeadlockError / KeyError) when FastAPI's threadpool concurrently triggers
# first-time imports of these submodules from lazy imports inside endpoints.
import codedmap.core.schema.tags  # noqa: F401,E402
import codedmap.core.schema.tags.matcher  # noqa: F401,E402
import codedmap.app.query.root  # noqa: F401,E402
import codedmap.analysis.traversal  # noqa: F401,E402
import codedmap.analysis.traversal.module  # noqa: F401,E402

logger = logging.getLogger(__name__)
MAX_LOG_BODY_CHARS = 500


# Error code to HTTP status mapping
ERROR_STATUS_MAP = {
    "NODE_NOT_FOUND": 404,
    "MODULE_NOT_FOUND": 404,
    "AMBIGUOUS_TARGET": 422,
    "AMBIGUOUS_MODULE": 422,
    "INVALID_ARGUMENT": 400,
    "SCHEMA_VALIDATION_ERROR": 400,
    "DB_CONNECTION_ERROR": 503,
    "PERMISSION_DENIED": 403,
    "INTERNAL_ERROR": 500,
    # NO_RESULTS -> 200 (success with empty result)
}


def _truncate_text(value: str, limit: int = MAX_LOG_BODY_CHARS) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}...(truncated)"


def _format_body_excerpt(body: bytes, content_type: str) -> str:
    if not body:
        return ""

    normalized = content_type.lower()

    if "multipart/form-data" in normalized:
        return f"<multipart body omitted; {len(body)} bytes>"

    if "application/json" in normalized:
        try:
            parsed = json.loads(body)
        except (TypeError, ValueError):
            return _truncate_text(body.decode("utf-8", errors="replace"))
        return _truncate_text(json.dumps(parsed, ensure_ascii=True, separators=(",", ":")))

    if normalized.startswith("text/") or "application/x-www-form-urlencoded" in normalized:
        return _truncate_text(body.decode("utf-8", errors="replace"))

    return f"<binary body omitted; {len(body)} bytes>"


def _extract_error_detail(response_body: bytes) -> str:
    if not response_body:
        return ""

    try:
        payload = json.loads(response_body)
    except (TypeError, ValueError):
        return ""

    if isinstance(payload, dict):
        detail = payload.get("detail")
        if detail is not None:
            return _truncate_text(json.dumps(detail, ensure_ascii=True, separators=(",", ":")))

        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if message:
                return _truncate_text(str(message))

    return ""


async def _materialize_response(response) -> tuple[bytes, object]:
    body = getattr(response, "body", None)
    if body is not None:
        return body, response

    chunks = [chunk async for chunk in response.body_iterator]
    body = b"".join(chunks)
    rebuilt = Response(
        content=body,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.media_type,
        background=response.background,
    )
    return body, rebuilt


def _log_failed_request(
    request,
    status_code: int,
    request_body: bytes,
    response_body: bytes | None = None,
) -> None:
    content_type = request.headers.get("content-type", "")
    error_detail = _extract_error_detail(response_body or b"")
    logger.warning(
        "HTTP request failed: %s %s status=%s query=%s content_type=%s detail=%s body_excerpt=%s",
        request.method,
        request.url.path,
        status_code,
        request.url.query or "-",
        content_type or "-",
        error_detail or "-",
        "-" if error_detail else (_format_body_excerpt(request_body, content_type) or "-"),
    )


def cli_response_to_http(response) -> JSONResponse:
    """Convert a CLIResponse to a JSONResponse with the appropriate HTTP status code."""
    if response.success:
        status_code = 200
    else:
        error_code = response.error.code if response.error else "INTERNAL_ERROR"
        status_code = ERROR_STATUS_MAP.get(error_code, 500)

    return JSONResponse(
        content=response.model_dump(mode="json", exclude_none=True),
        status_code=status_code,
    )


def create_app(
    db_path: str,
    backend: str = "sqlite",
    api_key: Optional[str] = None,
) -> FastAPI:
    """Create and configure the FastAPI application.

    Args:
        db_path: Path to the CPG database.
        backend: Storage backend type (sqlite/neo4j/memory).
        api_key: Optional API key for X-API-Key header authentication.

    Returns:
        Configured FastAPI application instance.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        deps.init_store(db_path, backend)
        yield
        deps.close_store()

    app = FastAPI(
        title="CPG SDK API",
        version=CLI_SCHEMA_VERSION,
        description="REST API for Code Property Graph SDK - query, annotate, and manage CPG databases.",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def log_failed_http_requests(request, call_next):
        body = await request.body()

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive

        try:
            response = await call_next(request)
        except Exception:
            _log_failed_request(request, 500, body)
            raise

        if response.status_code >= 400:
            response_body, response = await _materialize_response(response)
            _log_failed_request(request, response.status_code, body, response_body=response_body)

        return response

    # Configure API key auth if provided
    if api_key is not None:
        deps._api_key = api_key

    # Register domain routers
    from codedmap.api.routers import query, note, tag, module, repair, rules, build, tools
    from codedmap.api.routers import knowledge, federation, visualize

    router_kwargs = {}
    if api_key is not None:
        from fastapi import Depends
        router_kwargs["dependencies"] = [Depends(deps.verify_api_key)]

    # Public discovery endpoint — no API key required
    app.include_router(tools.router)

    app.include_router(query.router, **router_kwargs)
    app.include_router(note.router, **router_kwargs)
    app.include_router(tag.router, **router_kwargs)
    app.include_router(module.router, **router_kwargs)
    app.include_router(repair.router, **router_kwargs)
    app.include_router(rules.router, **router_kwargs)
    app.include_router(build.router, **router_kwargs)
    app.include_router(build.frontend_router, **router_kwargs)
    app.include_router(knowledge.router, **router_kwargs)
    app.include_router(federation.router, **router_kwargs)
    app.include_router(visualize.router, **router_kwargs)
    app.include_router(visualize.job_router, **router_kwargs)

    @app.get("/", tags=["health"])
    def health():
        return {"name": "CPG SDK API", "version": CLI_SCHEMA_VERSION}

    return app
