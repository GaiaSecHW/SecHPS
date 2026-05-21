# codedmap/cli/commands/enhance.py
"""
cpg enhance — Run analysis passes on an existing CPG database.

Designed for enhancing Joern-imported (or previously built) databases with
analysis passes that fill in missing metadata. For example, running LinkerPass,
CallGraphPass, and GlobalPointsToPass can resolve indirect calls (function
pointers) that Joern doesn't handle.
"""
import os

from codedmap.cli._bootstrap import safe_main
from codedmap.cli._output import OutputFormatter, CLIResponse, CLIMetadata
from codedmap.app.services.enhance_service import (
    AVAILABLE_PASSES,
    DEFAULT_PASSES,
    run_enhance,
)


def register(subparsers):
    p = subparsers.add_parser(
        "enhance",
        help="Run analysis passes on an existing CPG database",
    )

    p.add_argument(
        "--db",
        default=os.environ.get("CPG_DB", ""),
        help="Path to CPG database (required, or set $CPG_DB).",
    )
    p.add_argument(
        "--backend",
        choices=["sqlite", "neo4j"],
        default=os.environ.get("CPG_BACKEND", "sqlite"),
        help="Storage backend (default: sqlite).",
    )
    p.add_argument(
        "--passes",
        nargs="+",
        choices=AVAILABLE_PASSES + ["ai"],
        default=DEFAULT_PASSES,
        help=f"Passes to run (default: {' '.join(DEFAULT_PASSES)}).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Force re-run even if passes were previously completed.",
    )
    p.add_argument(
        "--workers", "-w",
        type=int,
        default=None,
        help="Number of parallel workers.",
    )
    p.add_argument(
        "--config", "-c",
        help="Path to YAML config file.",
    )
    p.add_argument(
        "--output",
        choices=["json", "text"],
        default="json",
        help="Output format (default: json)",
    )


@safe_main
def run(args):
    import sys

    db = args.db
    use_json = args.output == "json" or getattr(args, "json", False)
    if not db:
        if use_json:
            response = CLIResponse.error_response(
                "enhance", "DB_CONNECTION_ERROR",
                "Error: --db or $CPG_DB is required.",
                target={"raw": "db"},
            )
            OutputFormatter().render(response, args)
        else:
            print("Error: --db or $CPG_DB is required.", file=sys.stderr)
        return

    pass_names = args.passes

    if args.output != "json":
        print(f"Enhancing CPG database: {db}")
        print(f"Backend: {args.backend}")
        print(f"Passes: {', '.join(pass_names)}")
        if args.force:
            print("Force re-run: enabled")
        print()

    result = run_enhance(
        db=db,
        backend=args.backend,
        passes=pass_names,
        force=args.force,
        workers=args.workers,
        config_path=args.config,
        project_root=".",
    )

    if args.output == "json":
        response = CLIResponse(
            command="enhance",
            target={"db": db},
            result={"kind": "object", "content": result},
            metadata=CLIMetadata(),
            success=True,
        )
        OutputFormatter().render(response, args)
        return

    print("\nEnhancement complete.")
