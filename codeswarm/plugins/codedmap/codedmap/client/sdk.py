# codedmap/client/sdk.py
"""
Shared SDK transport for CodeDMap REST API.

Both CLI remote path (codedmap/cli/_remote.py) and standalone client
(tools/cdm_client.py) delegate to this module for all HTTP transport,
ensuring unified api_key/agent_id/timeout/retry behavior.

Public API:
    CatalogTransport   -- catalog-driven HTTP request execution
    CPGSDKClient       -- higher-level SDK client with call(tool_name) API
    CPGClientError     -- transport-level error
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any, Dict, Optional, Tuple

from codedmap.core.schema.catalog import CATALOG, get_command

ACTOR_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")

DEFAULT_TIMEOUT = 300.0


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class CPGClientError(Exception):
    """Transport-level error raised by CatalogTransport / CPGSDKClient."""

    def __init__(self, message: str, code: str = "INTERNAL_ERROR"):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Catalog-driven route resolution
# ---------------------------------------------------------------------------

def resolve_route(command_name: str) -> Tuple[str, str]:
    """Resolve a catalog command name to (http_method, url_path).

    Args:
        command_name: Catalog name like ``query_search``, ``tag_add``, ``build_start``.

    Returns:
        (``"GET"`` or ``"POST"``, path string like ``"/query/search"``).

    Raises:
        CPGClientError: If command_name is not found in the catalog.
    """
    cmd_def = get_command(command_name)
    if cmd_def is None:
        raise CPGClientError(
            "Unknown catalog command: %s" % command_name,
            code="INVALID_ARGUMENT",
        )
    http_method = "GET" if cmd_def.read_write == "read" else "POST"
    path = "/%s/%s" % (cmd_def.domain, cmd_def.subcommand)
    return (http_method, path)


# ---------------------------------------------------------------------------
# HTTP transport
# ---------------------------------------------------------------------------

class CatalogTransport:
    """Catalog-driven HTTP transport.

    Handles authentication headers (api_key, agent_id), timeout,
    and request serialization. Route mapping is always derived from the
    catalog — never hardcoded.

    Usage::

        transport = CatalogTransport(
            base_url="http://localhost:8000",
            api_key="secret",
            agent_id="my-agent",
            timeout=30.0,
        )
        response_dict = transport.execute("query_search", {"pattern": "main"})
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        debug: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.agent_id = agent_id
        self.timeout = timeout
        self.debug = debug

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_headers(self) -> Dict[str, str]:
        """Build HTTP headers from configured credentials."""
        headers: Dict[str, str] = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        if self.agent_id:
            if not ACTOR_PATTERN.match(self.agent_id):
                raise CPGClientError(
                    "Invalid agent_id format: '%s'. Must match [a-zA-Z0-9_-]+"
                    % self.agent_id,
                    code="INVALID_ARGUMENT",
                )
            headers["X-Agent-ID"] = self.agent_id
        return headers

    def _clean_params(self, params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return {k: v for k, v in (params or {}).items() if v is not None}

    # ------------------------------------------------------------------
    # Transport primitives
    # ------------------------------------------------------------------

    def get(
        self, path: str, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a GET request and return the parsed JSON response dict."""
        try:
            import httpx
        except ImportError:
            raise CPGClientError(
                "httpx is required for remote mode. Install with: pip install httpx",
                code="DEPENDENCY_ERROR",
            )
        url = "%s%s" % (self.base_url, path)
        clean = self._clean_params(params)
        self._debug_request("GET", url, clean)
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.get(url, params=clean, headers=self._build_headers())
        except Exception as exc:
            self._raise_from_httpx(exc)
        return self._parse(resp)

    def post(
        self, path: str, body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a POST request and return the parsed JSON response dict."""
        try:
            import httpx
        except ImportError:
            raise CPGClientError(
                "httpx is required for remote mode. Install with: pip install httpx",
                code="DEPENDENCY_ERROR",
            )
        url = "%s%s" % (self.base_url, path)
        clean = self._clean_params(body)
        self._debug_request("POST", url, clean)
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, json=clean, headers=self._build_headers())
        except Exception as exc:
            self._raise_from_httpx(exc)
        return self._parse(resp)

    def _parse(self, resp: Any) -> Dict[str, Any]:
        """Parse an httpx response to a dict."""
        try:
            return resp.json()
        except Exception:
            raise CPGClientError(
                "Server returned %s: %s" % (resp.status_code, resp.text),
                code="INTERNAL_ERROR",
            )

    def _debug_request(self, method: str, url: str, payload: Dict[str, Any]) -> None:
        if not self.debug:
            return
        print(
            "HTTP %s %s payload=%s" % (
                method,
                url,
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ),
            file=sys.stderr,
        )

    def _raise_from_httpx(self, exc: Exception) -> None:
        """Convert httpx exceptions to CPGClientError."""
        try:
            import httpx
            if isinstance(exc, httpx.ConnectError):
                raise CPGClientError(
                    "Cannot connect to CPG server at %s" % self.base_url,
                    code="DB_CONNECTION_ERROR",
                ) from exc
            if isinstance(exc, httpx.TimeoutException):
                raise CPGClientError(
                    "Request timed out at %s" % self.base_url,
                    code="DB_CONNECTION_ERROR",
                ) from exc
            if isinstance(exc, httpx.RequestError):
                raise CPGClientError(
                    "Request failed: %s" % exc,
                    code="INTERNAL_ERROR",
                ) from exc
        except ImportError:
            pass
        raise CPGClientError("Request failed: %s" % exc, code="INTERNAL_ERROR") from exc

    # ------------------------------------------------------------------
    # High-level dispatch
    # ------------------------------------------------------------------

    def execute(
        self, command_name: str, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Dispatch a catalog command by name.

        Resolves the route from the catalog, sends the appropriate HTTP
        method, and returns the parsed JSON response dict.

        Args:
            command_name: Catalog command name (e.g., ``"query_search"``).
            params: Command parameters dict (None values stripped).

        Returns:
            Parsed JSON response as dict.

        Raises:
            CPGClientError: On unknown command or transport failure.
        """
        http_method, path = resolve_route(command_name)
        if http_method == "GET":
            return self.get(path, params)
        else:
            return self.post(path, params)


# ---------------------------------------------------------------------------
# Higher-level SDK client
# ---------------------------------------------------------------------------

class CPGSDKClient:
    """High-level SDK client for the CodeDMap REST API.

    Wraps CatalogTransport with a catalog-validated ``call()`` interface.

    Usage::

        client = CPGSDKClient(
            base_url="http://localhost:8000",
            api_key="secret",
            agent_id="my-agent",
        )
        result = client.call("query_search", {"pattern": "main", "limit": 10})
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self._transport = CatalogTransport(
            base_url, api_key=api_key, agent_id=agent_id, timeout=timeout
        )

    def call(
        self, command_name: str, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a catalog command and return the response dict.

        Args:
            command_name: Catalog name like ``"query_search"``.
            params: Command parameters (None values stripped).

        Returns:
            Parsed JSON response dict.

        Raises:
            CPGClientError: On unknown command or transport failure.
        """
        return self._transport.execute(command_name, params)

    def health(self) -> Dict[str, Any]:
        """Check server health (GET /)."""
        return self._transport.get("/")

    def discover(self) -> Dict[str, Any]:
        """List available tools from server (GET /api/v1/tools)."""
        return self._transport.get("/api/v1/tools")
