"""
/api/v1/tools — Agent discovery endpoint for CPG command manifest.

Returns the full tool catalog as a lean JSON manifest suitable for
LLM function-calling, MCP tool registration, or programmatic discovery.
"""

from fastapi import APIRouter

router = APIRouter(tags=["tools"])


@router.get("/api/v1/tools")
def list_tools():
    """Return the full CPG tool manifest for agent discovery.

    Each tool entry contains:
    - name: Underscore-format command identifier (e.g., "module_assign")
    - description: Agent-friendly single-sentence description
    - input_schema: JSON Schema for the command's business-logic parameters
    """
    from codedmap.core.schema.catalog import CATALOG, DOMAIN_DESCRIPTIONS

    return {
        "domains": DOMAIN_DESCRIPTIONS,
        "tools": [cmd.to_tool_dict() for cmd in CATALOG]
    }
