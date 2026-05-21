# codedmap/cli/commands/serve.py
"""
cpg serve -- Start the CPG REST API server (FastAPI + uvicorn).
"""
import os
import sys


def register(subparsers):
    from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
    p = subparsers.add_parser(
        "serve",
        help=DOMAIN_DESCRIPTIONS["serve"],
    )
    p.add_argument(
        "--db",
        default=os.environ.get("CPG_DB", ""),
        help="Path to CPG database (required, or set $CPG_DB).",
    )
    p.add_argument(
        "--backend",
        choices=["sqlite", "neo4j", "memory"],
        default=os.environ.get("CPG_BACKEND", "sqlite"),
        help="Storage backend (default: sqlite).",
    )
    p.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0).",
    )
    p.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to listen on (default: 8000).",
    )
    p.add_argument(
        "--api-key",
        default=None,
        help="API key for X-API-Key header authentication (optional).",
    )
    p.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of uvicorn worker processes (default: 1).",
    )
    p.add_argument(
        "--output",
        choices=["json", "text"],
        default="json",
        help="Output format for startup message (default: json).",
    )
    p.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging and full tracebacks on internal errors.",
    )


def run(args):
    db = getattr(args, "db", None) or os.environ.get("CPG_DB", "")

    try:
        if not db:
            from codedmap.cli._bootstrap import NoDatabaseError
            raise NoDatabaseError("Error: --db or $CPG_DB is required.")
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    host = getattr(args, "host", "0.0.0.0")
    port = getattr(args, "port", 8000)
    backend = getattr(args, "backend", "sqlite")
    api_key = getattr(args, "api_key", None)
    workers = getattr(args, "workers", 1)

    use_json = getattr(args, "output", "json") == "json"

    if use_json:
        import json
        print(json.dumps({
            "status": "starting",
            "host": host,
            "port": port,
            "db": db,
            "backend": backend,
            "api_key_enabled": api_key is not None,
        }))
    else:
        print(f"CPG API server starting on http://{host}:{port}")
        print(f"Database: {db} (backend: {backend})")
        if api_key:
            print("API key authentication enabled")

    try:
        import uvicorn
        from codedmap.api.app import create_app

        app = create_app(db_path=db, backend=backend, api_key=api_key)
        uvicorn.run(app, host=host, port=port, workers=workers)
    except ImportError as e:
        print(f"Error: {e}. Install API dependencies: pip install 'cpg-sdk[api]'", file=sys.stderr)
        sys.exit(1)
