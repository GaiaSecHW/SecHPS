#!/usr/bin/env python3
"""
CDM Remote Client — standalone CLI + SDK wrapper for CodeDMap REST API.

This script is intentionally repo-local but package-independent:
- No import from codedmap.*
- Command catalog is loaded from tools/tools.json
- HTTP transport uses httpx directly

USAGE (CLI):
    python tools/cdm_client.py query search --pattern "main" --remote http://localhost:8000
    python tools/cdm_client.py discover --remote http://localhost:8000

USAGE (SDK):
    from cdm_client import CPGClient
    client = CPGClient("http://localhost:8000", api_key="secret", agent_id="my-agent")
    result = client.call("query_search", {"pattern": "main", "limit": 10})
    upload = client.build.upload("source.zip", languages=["python"])
    status = client.build.status(upload["result"]["content"]["job_id"])
    graph = client.graph.entrypoints(limit=10)
    job_graph = client.graph.job_visualize(
        upload["result"]["content"]["job_id"],
        {"kind": "full", "direction": "both"},
    )

ENVIRONMENT VARIABLES:
    CPG_SERVER    -- Remote server URL (alternative to --remote)
    CPG_API_KEY   -- API key for authentication (alternative to --api-key)
    CPG_AGENT_ID  -- Agent identifier for provenance tracking

DEPENDENCIES:
    pip install httpx
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_TIMEOUT = 300.0
ACTOR_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")

JSON_SCHEMA_TYPE_MAP = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": None,
}


class CPGClientError(Exception):
    """Transport-level error for cdm_client standalone SDK."""

    def __init__(self, message: str, code: str = "INTERNAL_ERROR"):
        super().__init__(message)
        self.code = code


def _tools_json_path() -> Path:
    return Path(__file__).parent / "tools.json"


def _load_tools_bundle() -> Dict[str, Any]:
    path = _tools_json_path()
    if not path.exists():
        raise CPGClientError(
            "tools.json not found at %s. Run: python tools/export_catalog.py" % path,
            code="CONFIG_ERROR",
        )
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        raise CPGClientError("Failed to parse tools.json: %s" % exc, code="CONFIG_ERROR") from exc


def _load_tools() -> tuple[list[dict], dict[str, str]]:
    bundle = _load_tools_bundle()
    return bundle.get("tools", []), bundle.get("domains", {})


def _build_tool_index(tools: List[dict]) -> Dict[str, dict]:
    return {t["name"]: t for t in tools if "name" in t}


def resolve_route(command_name: str, tools: List[dict]) -> Tuple[str, str]:
    """Resolve tool name to (HTTP method, path) from tools.json metadata."""
    index = _build_tool_index(tools)
    tool = index.get(command_name)
    if not tool:
        raise CPGClientError("Unknown command: %s" % command_name, code="INVALID_ARGUMENT")
    method = "GET" if tool.get("read_write") == "read" else "POST"
    return method, "/%s/%s" % (tool.get("domain", ""), tool.get("subcommand", ""))


class CatalogTransport:
    """Catalog-driven HTTP transport based on tools.json."""

    def __init__(
        self,
        base_url: str,
        tools: List[dict],
        *,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self.tools = tools
        self.api_key = api_key
        self.agent_id = agent_id
        self.timeout = timeout

    def _build_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        if self.agent_id:
            if not ACTOR_PATTERN.match(self.agent_id):
                raise CPGClientError(
                    "Invalid agent_id format: '%s'. Must match [a-zA-Z0-9_-]+" % self.agent_id,
                    code="INVALID_ARGUMENT",
                )
            headers["X-Agent-ID"] = self.agent_id
        return headers

    @staticmethod
    def _clean_params(params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return {k: v for k, v in (params or {}).items() if v is not None}

    def _parse(self, resp: Any) -> Dict[str, Any]:
        try:
            return resp.json()
        except Exception:
            raise CPGClientError(
                "Server returned %s: %s" % (resp.status_code, resp.text),
                code="INTERNAL_ERROR",
            )

    def _raise_from_httpx(self, exc: Exception) -> None:
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
                raise CPGClientError("Request failed: %s" % exc, code="INTERNAL_ERROR") from exc
        except ImportError:
            pass
        raise CPGClientError("Request failed: %s" % exc, code="INTERNAL_ERROR") from exc

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        try:
            import httpx
        except ImportError:
            raise CPGClientError(
                "httpx is required for remote mode. Install with: pip install httpx",
                code="DEPENDENCY_ERROR",
            )
        url = "%s%s" % (self.base_url, path)
        clean = self._clean_params(params)
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.get(url, params=clean, headers=self._build_headers())
        except Exception as exc:
            self._raise_from_httpx(exc)
        return self._parse(resp)

    def post(self, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        try:
            import httpx
        except ImportError:
            raise CPGClientError(
                "httpx is required for remote mode. Install with: pip install httpx",
                code="DEPENDENCY_ERROR",
            )
        url = "%s%s" % (self.base_url, path)
        clean = self._clean_params(body)
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, json=clean, headers=self._build_headers())
        except Exception as exc:
            self._raise_from_httpx(exc)
        return self._parse(resp)

    def post_multipart(
        self,
        path: str,
        *,
        files: Dict[str, Any],
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            import httpx
        except ImportError:
            raise CPGClientError(
                "httpx is required for remote mode. Install with: pip install httpx",
                code="DEPENDENCY_ERROR",
            )
        url = "%s%s" % (self.base_url, path)
        clean = self._clean_params(data)
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, data=clean, files=files, headers=self._build_headers())
        except Exception as exc:
            self._raise_from_httpx(exc)
        return self._parse(resp)

    def execute(self, command_name: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        method, path = resolve_route(command_name, self.tools)
        if method == "GET":
            return self.get(path, params)
        return self.post(path, params)


class _QueryDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def search(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_search", params or None)

    def inspect(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_inspect", params or None)

    def trace(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_trace", params or None)

    def entrypoints(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_entrypoints", params or None)

    def stats(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_stats", params or None)

    def tree(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_tree", params or None)

    def sources(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_sources", params or None)

    def sinks(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_sinks", params or None)

    def guards(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_guards", params or None)

    def sanitizers(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_sanitizers", params or None)

    def roles(self, **params) -> Dict[str, Any]:
        return self._t.execute("query_roles", params or None)


class _TagDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def add(self, **params) -> Dict[str, Any]:
        return self._t.execute("tag_add", params or None)

    def remove(self, **params) -> Dict[str, Any]:
        return self._t.execute("tag_remove", params or None)

    def list(self, **params) -> Dict[str, Any]:
        return self._t.execute("tag_list", params or None)

    def find(self, **params) -> Dict[str, Any]:
        return self._t.execute("tag_find", params or None)

    def bulk(self, **params) -> Dict[str, Any]:
        return self._t.execute("tag_bulk", params or None)


class _NoteDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def add(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_add", params or None)

    def list(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_list", params or None)

    def show(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_show", params or None)

    def promote(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_promote", params or None)

    def confirm(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_confirm", params or None)

    def remove(self, **params) -> Dict[str, Any]:
        return self._t.execute("note_remove", params or None)


class _ModuleDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def create(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_create", params or None)

    def delete(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_delete", params or None)

    def rename(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_rename", params or None)

    def list(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_list", params or None)

    def show(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_show", params or None)

    def assign(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_assign", params or None)

    def remove(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_remove", params or None)

    def of(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_of", params or None)

    def deps(self, **params) -> Dict[str, Any]:
        return self._t.execute("module_deps", params or None)


class _RepairDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def link(self, **params) -> Dict[str, Any]:
        return self._t.execute("repair_link", params or None)

    def suggest(self, **params) -> Dict[str, Any]:
        return self._t.execute("repair_suggest", params or None)

    def list(self, **params) -> Dict[str, Any]:
        return self._t.execute("repair_list", params or None)

    def undo(self, **params) -> Dict[str, Any]:
        return self._t.execute("repair_undo", params or None)


class _RulesDomain:
    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def list(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_list", params or None)

    def categories(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_categories", params or None)

    def show(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_show", params or None)

    def resolve(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_resolve", params or None)

    def add_sink(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_add_sink", params or None)

    def add_source(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_add_source", params or None)

    def add_safe(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_add_safe", params or None)

    def add_entrypoint(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_add_entrypoint", params or None)

    def tombstone(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_tombstone", params or None)

    def validate(self, **params) -> Dict[str, Any]:
        return self._t.execute("rules_validate", params or None)


class _BuildDomain:
    """Direct helpers for the API-native Phase 11 upload/status surface."""

    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def upload(
        self,
        archive_path: str,
        *,
        languages: Optional[List[str]] = None,
        backend: str = "sqlite",
    ) -> Dict[str, Any]:
        archive_file = Path(archive_path)
        data: Dict[str, Any] = {"backend": backend}
        if languages:
            data["languages"] = languages
        with archive_file.open("rb") as handle:
            return self._t.post_multipart(
                "/api/v1/build/upload",
                files={"archive": (archive_file.name, handle, "application/octet-stream")},
                data=data,
            )

    def status(self, job_id: str) -> Dict[str, Any]:
        return self._t.get("/api/v1/build/status", {"job_id": job_id})


class _GraphDomain:
    """Direct helpers for the graph API surface, including job-scoped routes."""

    def __init__(self, transport: CatalogTransport):
        self._t = transport

    def entrypoints(self, **params) -> Dict[str, Any]:
        return self._t.get("/api/v1/graph/entrypoints", params or None)

    def visualize(self, body: Optional[Dict[str, Any]] = None, **params) -> Dict[str, Any]:
        payload = dict(body or {})
        payload.update(params)
        return self._t.post("/api/v1/graph/visualize", payload or None)

    def job_entrypoints(self, job_id: str, **params) -> Dict[str, Any]:
        return self._t.get(f"/api/v1/jobs/{job_id}/graph/entrypoints", params or None)

    def job_visualize(self, job_id: str, body: Optional[Dict[str, Any]] = None, **params) -> Dict[str, Any]:
        payload = dict(body or {})
        payload.update(params)
        return self._t.post(f"/api/v1/jobs/{job_id}/graph/visualize", payload or None)


class CPGClient:
    """Programmatic SDK for CodeDMap REST API (standalone, tools.json-driven)."""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        tools, _domains = _load_tools()
        self._transport = CatalogTransport(
            base_url,
            tools,
            api_key=api_key,
            agent_id=agent_id,
            timeout=timeout,
        )
        self.query = _QueryDomain(self._transport)
        self.tag = _TagDomain(self._transport)
        self.note = _NoteDomain(self._transport)
        self.module = _ModuleDomain(self._transport)
        self.repair = _RepairDomain(self._transport)
        self.rules = _RulesDomain(self._transport)
        self.build = _BuildDomain(self._transport)
        self.graph = _GraphDomain(self._transport)

    def health(self) -> Dict[str, Any]:
        return self._transport.get("/")

    def discover(self) -> Dict[str, Any]:
        return self._transport.get("/api/v1/tools")

    def call(self, tool_name: str, params: Optional[dict] = None) -> Dict[str, Any]:
        return self._transport.execute(tool_name, params)


class OutputFormatter:
    def render(self, response: dict, output: str = "text") -> None:
        if output == "json":
            print(json.dumps(response, indent=2))
            return
        self._render_text(response)

    def _render_text(self, response: dict) -> None:
        success = response.get("success", True)
        if not success:
            err = response.get("error") or {}
            msg = err.get("message") if isinstance(err, dict) else str(err) or "Unknown error"
            code = err.get("code") if isinstance(err, dict) else "?"
            print("Error [%s]: %s" % (code, msg), file=sys.stderr)
            return
        result = response.get("result")
        if result is None:
            print("OK")
            return
        if "nodes" in result:
            nodes = result["nodes"]
            if nodes:
                for n in nodes:
                    print(
                        "  [%s] %s (%s:%s) id=%s"
                        % (
                            n.get("label", "?"),
                            n.get("name", "?"),
                            n.get("file", "?"),
                            n.get("line", "?"),
                            n.get("id", "?"),
                        )
                    )
                total = response.get("metadata", {}).get("total", 0)
                if total > len(nodes):
                    print("  ... and %d more" % (total - len(nodes)))
            else:
                print("No matching nodes found.")
            return
        if "chain" in result:
            print("Call chain:")
            for hop in result["chain"]:
                indent = "  " * hop.get("depth", 0)
                repaired = " [REPAIRED]" if hop.get("repaired") else ""
                print(
                    "%s%s (%s:%s)%s"
                    % (
                        indent,
                        hop.get("name", "?"),
                        hop.get("file", "?"),
                        hop.get("line", "?"),
                        repaired,
                    )
                )
            return
        if "job_id" in result:
            print("Build job started: %s (status=%s)" % (result["job_id"], result.get("status", "?")))
            return
        if "rules" in result:
            for rule in result["rules"]:
                print("  [%s] %s: %s" % (rule.get("type", "?"), rule.get("id", "?"), rule.get("name", "?")))
            return
        print(json.dumps(result, indent=2))


def _add_remote_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--remote",
        default=os.environ.get("CPG_SERVER", ""),
        metavar="URL",
        help="CPG server URL (or set CPG_SERVER)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("CPG_API_KEY", ""),
        help="API key (or set CPG_API_KEY)",
    )
    parser.add_argument(
        "--output",
        choices=["json", "text"],
        default="json",
        help="Output format (default: json)",
    )


def _add_schema_args(parser: argparse.ArgumentParser, schema: dict) -> None:
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    for name, prop in props.items():
        cli_name = "--%s" % name.replace("_", "-")
        ptype = prop.get("type", "string")
        cli_action = prop.get("cli_action")
        if cli_action == "read_json_file":
            parser.add_argument(
                cli_name,
                dest=name,
                required=(name in required),
                help=prop.get("description", "") + " (JSON file path)",
            )
            continue
        if ptype == "boolean":
            parser.add_argument(cli_name, dest=name, action="store_true", help=prop.get("description", ""))
        elif ptype == "array":
            item_type = prop.get("items", {}).get("type", "string")
            parser.add_argument(
                cli_name,
                dest=name,
                nargs="+",
                type=JSON_SCHEMA_TYPE_MAP.get(item_type, str),
                required=(name in required),
                help=prop.get("description", ""),
            )
        else:
            arg_type = JSON_SCHEMA_TYPE_MAP.get(ptype, str)
            kwargs = {"dest": name, "type": arg_type, "help": prop.get("description", "")}
            if name in required:
                kwargs["required"] = True
            else:
                kwargs["default"] = prop.get("default")
            parser.add_argument(cli_name, **kwargs)


def _extract_params(args: argparse.Namespace, tool: dict) -> dict:
    props = tool["input_schema"].get("properties", {})
    params = {}
    for field_name, prop in props.items():
        val = getattr(args, field_name, None)
        if val is None:
            continue
        cli_action = prop.get("cli_action")
        if cli_action == "read_json_file" and isinstance(val, str):
            try:
                data = json.loads(Path(val).read_text())
                params[field_name] = data if isinstance(data, list) else [data]
            except Exception as exc:
                print("Error reading file: %s" % exc, file=sys.stderr)
                sys.exit(1)
        else:
            params[field_name] = val
    return params


def _auto_register_cli(subparsers, tools: List[dict], domains: Dict[str, str]) -> None:
    from collections import defaultdict

    by_domain = defaultdict(list)
    for t in tools:
        by_domain[t["domain"]].append(t)

    for domain, domain_tools in sorted(by_domain.items()):
        dp = subparsers.add_parser(domain, help=domains.get(domain, ""))
        dsub = dp.add_subparsers(dest="%s_action" % domain)
        for t in domain_tools:
            sp = dsub.add_parser(t["subcommand"], help=t["description"])
            _add_schema_args(sp, t["input_schema"])
            _add_remote_args(sp)
            sp.set_defaults(_tool=t)


def _client_from_args(args: argparse.Namespace) -> CPGClient:
    remote = getattr(args, "remote", "") or os.environ.get("CPG_SERVER", "")
    if not remote:
        print("Error: --remote or CPG_SERVER environment variable is required.", file=sys.stderr)
        sys.exit(1)
    api_key = getattr(args, "api_key", "") or os.environ.get("CPG_API_KEY", "")
    agent_id = os.environ.get("CPG_AGENT_ID", "").strip() or None
    return CPGClient(remote, api_key=api_key or None, agent_id=agent_id)


def _run(args: argparse.Namespace, response: dict) -> None:
    fmt = OutputFormatter()
    output = getattr(args, "output", "json")
    fmt.render(response, output)
    if not response.get("success", True):
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="cdm_client",
        description="CDM Remote Client -- standalone CLI + SDK wrapper for CodeDMap REST API.",
        epilog="Set CPG_SERVER and CPG_API_KEY environment variables to avoid passing --remote / --api-key on every command.",
    )
    subparsers = parser.add_subparsers(dest="command")

    tools, domains = _load_tools()
    _auto_register_cli(subparsers, tools, domains)

    s = subparsers.add_parser("discover", help="List available tools from server")
    _add_remote_args(s)
    s.set_defaults(_tool=None, _discover=True)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    tool = getattr(args, "_tool", None)
    is_discover = getattr(args, "_discover", False)

    if not tool and not is_discover:
        parser.parse_args([args.command, "--help"])
        sys.exit(0)

    try:
        client = _client_from_args(args)
        if is_discover:
            response = client.discover()
        else:
            params = _extract_params(args, tool)
            response = client.call(tool["name"], params)
    except CPGClientError as exc:
        print("Error [%s]: %s" % (exc.code, exc), file=sys.stderr)
        sys.exit(1)

    _run(args, response)


if __name__ == "__main__":
    main()
