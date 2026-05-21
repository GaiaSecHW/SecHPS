#!/usr/bin/env python3
"""Export catalog to tools/tools.json for cpg_client.py consumption."""
import json
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from codedmap.core.schema.catalog import CATALOG, DOMAIN_DESCRIPTIONS

tools = [cmd.to_tool_dict() for cmd in CATALOG if cmd.domain != "serve"]
domains = {k: v for k, v in DOMAIN_DESCRIPTIONS.items() if k != "serve"}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools.json")
with open(out, "w") as f:
    json.dump({"schema_version": "1.0.0", "domains": domains, "tools": tools}, f, indent=2)
print("Exported %d tools (%d domains) to %s" % (len(tools), len(domains), out))
