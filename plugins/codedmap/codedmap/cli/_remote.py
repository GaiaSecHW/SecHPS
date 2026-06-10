# codedmap/cli/_remote.py
"""
Remote HTTP transport layer for CPG CLI.

Thin adapter that delegates all HTTP transport to codedmap.client.sdk
(CatalogTransport). Translates argparse Namespace to SDK calls against
a remote CPG REST API server.

Public API:
    is_remote(args)         -> bool
    get_remote_url(args)    -> str
    remote_execute(args)    -> None  (prints to stdout, exits on error)
"""

import json
import os
import sys
from argparse import Namespace
from typing import Any, Dict, Tuple

from codedmap.client.sdk import CatalogTransport, CPGClientError, resolve_route


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def is_remote(args: Namespace) -> bool:
    """Return True if remote mode is active (--remote flag or CPG_SERVER env var)."""
    remote = getattr(args, "remote", "") or os.environ.get("CPG_SERVER", "")
    return bool(remote)


def get_remote_url(args: Namespace) -> str:
    """Return the remote server URL, stripping trailing slash."""
    url = getattr(args, "remote", "") or os.environ.get("CPG_SERVER", "")
    return url.rstrip("/")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def remote_execute(args: Namespace) -> None:
    """Translate CLI args to an HTTP request via shared SDK transport and print result."""
    url = get_remote_url(args)
    api_key = getattr(args, "api_key", "") or os.environ.get("CPG_API_KEY", "")
    agent_id = os.environ.get("CPG_AGENT_ID", "").strip() or None
    output_mode = getattr(args, "output", "json")

    transport = CatalogTransport(
        url,
        api_key=api_key or None,
        agent_id=agent_id,
        timeout=30.0,
        debug=bool(getattr(args, "debug", False)),
    )

    command_name, params = _extract_command(args)

    try:
        response_dict = transport.execute(command_name, params or None)
    except CPGClientError as exc:
        if exc.code == "INVALID_ARGUMENT":
            print("Error: Unknown remote command: %s" % exc, file=sys.stderr)
        elif exc.code == "DB_CONNECTION_ERROR":
            print("Error: %s" % exc, file=sys.stderr)
        else:
            print("Error: %s" % exc, file=sys.stderr)
        sys.exit(1)

    # Serialize and render
    response_text = json.dumps(response_dict)

    if output_mode == "json":
        print(response_text)
        if not response_dict.get("success", True):
            sys.exit(1)
        return

    # Text mode: parse CLIResponse and render
    if response_dict.get("success", True):
        _render_text(response_text, args)
    else:
        err = response_dict.get("error") or {}
        if isinstance(err, dict):
            msg = err.get("message") or response_text
        else:
            msg = response_text
        print("Error: %s" % msg, file=sys.stderr)
        sys.exit(1)


def _render_text(response_body: str, args: Namespace) -> None:
    """Parse a CLIResponse JSON body and render it as text via OutputFormatter."""
    from codedmap.cli._output import CLIResponse, OutputFormatter

    try:
        data = json.loads(response_body)
        response = CLIResponse(**data)
    except Exception:
        print(response_body)
        return

    fmt = OutputFormatter()
    fmt.render(response, args)


# ---------------------------------------------------------------------------
# Route mapping — catalog-driven via codedmap.client.sdk
# ---------------------------------------------------------------------------

def _extract_command(args: Namespace) -> Tuple[str, Dict[str, Any]]:
    """Extract catalog command name and params from argparse Namespace.

    Returns (command_name, params_dict).
    """
    from codedmap.core.schema.catalog import CATALOG

    command = getattr(args, "command", None)
    action = getattr(args, "%s_action" % command, None) if command else None

    # Build the catalog lookup name
    if action:
        target_name = "%s_%s" % (command, action)
    else:
        target_name = command

    # Find matching catalog entry to extract params
    cmd_def = None
    for c in CATALOG:
        if c.name == target_name:
            cmd_def = c
            break

    if cmd_def is None:
        raise CPGClientError(
            "Unknown remote command: %s" % target_name,
            code="INVALID_ARGUMENT",
        )

    # Extract params from args matching input_schema fields
    schema = cmd_def.input_model.model_json_schema()
    props = schema.get("properties", {})
    params: Dict[str, Any] = {}
    for field_name in props:
        val = getattr(args, field_name, None)
        if val is not None:
            field_schema = props[field_name]
            cli_action = field_schema.get("cli_action")
            if cli_action == "read_json_file" and isinstance(val, str):
                import json as _json
                from pathlib import Path
                data = _json.loads(Path(val).read_text())
                params[field_name] = data if isinstance(data, list) else [data]
            else:
                params[field_name] = val

    return target_name, params
