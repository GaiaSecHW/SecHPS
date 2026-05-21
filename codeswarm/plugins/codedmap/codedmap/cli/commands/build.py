# codedmap/cli/commands/build.py
"""
cpg build — Build CPG graph from source code or Joern CSV export.

Orchestrates the full pipeline: parse source (or import Joern CSV) -> run
analysis passes -> export.
"""
import sys
from pathlib import Path

from codedmap.cli._bootstrap import safe_main
from codedmap.cli._output import OutputFormatter, CLIResponse, CLIMetadata


def register(subparsers):
    from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
    p = subparsers.add_parser(
        "build",
        help=DOMAIN_DESCRIPTIONS["build"],
    )

    p.add_argument("project_root", nargs="?", help="Path to source code root directory (or 'enhance' to run analysis passes)")
    p.add_argument("--workspace", help="Workspace directory for build artifacts (default: <project_root>/workspace)")
    p.add_argument("--db", help="Output database path (overrides workspace; default: <workspace>/graph.db)")
    p.add_argument(
        "--backend",
        choices=["sqlite", "neo4j"],
        default="sqlite",
        help="Storage backend (default: sqlite)",
    )
    p.add_argument("--config", "-c", help="Path to YAML config file")
    p.add_argument(
        "--languages", "-l",
        nargs="+",
        default=["c", "cpp"],
        help="Languages to parse (default: c cpp)",
    )
    p.add_argument("--workers", "-w", type=int, help="Number of parallel workers")

    # enhance pass control (used when project_root == 'enhance')
    from codedmap.app.services.enhance_service import AVAILABLE_PASSES, DEFAULT_PASSES
    p.add_argument(
        "--passes",
        nargs="+",
        choices=AVAILABLE_PASSES + ["ai"],
        default=DEFAULT_PASSES,
        help=f"Analysis passes to run when using 'enhance' (default: {' '.join(DEFAULT_PASSES)}).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Force re-run even if passes were previously completed (enhance mode).",
    )

    # Phase control
    phase = p.add_argument_group("phase control")
    phase.add_argument(
        "--skip-ingestion",
        action="store_true",
        help="Skip parsing (use existing graph)",
    )
    phase.add_argument(
        "--skip-analysis",
        action="store_true",
        help="Skip global analysis passes",
    )
    phase.add_argument(
        "--skip-export",
        action="store_true",
        help="Skip Neo4j CSV export",
    )
    phase.add_argument(
        "--ai",
        action="store_true",
        help="Enable AI enhancement passes",
    )
    phase.add_argument(
        "--ai-only",
        action="store_true",
        help="Run only AI enhancement (requires existing graph)",
    )

    # Joern CSV import
    joern = p.add_argument_group("joern import")
    joern.add_argument(
        "--joern-dir",
        help="Path to Joern neo4jcsv export directory (use Joern CSV instead of source parsing)",
    )
    joern.add_argument(
        "--joern-id-strategy",
        choices=["regenerate", "passthrough", "hybrid"],
        default="hybrid",
        help="Joern ID translation strategy (default: hybrid)",
    )
    joern.add_argument(
        "--joern-skip-unknown",
        action="store_true",
        help="Skip nodes with unknown labels (default: use GenericNode fallback)",
    )
    p.add_argument(
        "--output",
        choices=["json", "text"],
        default="json",
        help="Output format (default: json)",
    )
    p.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging and full tracebacks on internal errors.",
    )
    import os
    p.add_argument(
        "--remote",
        default=os.environ.get("CPG_SERVER", ""),
        help="Remote CPG server URL (or set CPG_SERVER env var).",
    )
    p.add_argument(
        "--api-key",
        default=os.environ.get("CPG_API_KEY", ""),
        help="API key for remote server authentication.",
    )


@safe_main
def run(args):
    from codedmap.cli._remote import is_remote, remote_execute
    if is_remote(args):
        remote_execute(args)
        return

    # Delegate to enhance subcommand if requested
    if getattr(args, "project_root", None) == "enhance":
        from codedmap.cli.commands import enhance as cmd_enhance
        cmd_enhance.run(args)
        return

    from codedmap.app.build import CPGBuildEngine

    project_root = Path(args.project_root).resolve()

    # Pass raw args to CPGBuildEngine, which handles all workspace logic
    engine = CPGBuildEngine(
        project_root=str(project_root),
        db=args.db,
        workspace=args.workspace,
        backend=args.backend,
        config_path=args.config,
        languages=args.languages,
        workers=args.workers,
    )

    # Enable AI if requested
    if args.ai or args.ai_only:
        engine.config.ai.enable_llm = True

    # Enable Joern CSV import if requested
    joern_dir = args.joern_dir
    if joern_dir:
        joern_path = Path(joern_dir)
        if not joern_path.is_dir():
            if getattr(args, "output", "json") == "json":
                response = CLIResponse.error_response("build", "INVALID_ARGUMENT", f"Joern export directory not found: {joern_dir}")
                OutputFormatter().render(response, args)
                return
            print(f"Error: Joern export directory not found: {joern_dir}", file=sys.stderr)
            sys.exit(1)
        engine.config.joern_import.enabled = True
        engine.config.joern_import.export_dir = joern_path
        engine.config.joern_import.id_strategy = args.joern_id_strategy
        engine.config.joern_import.skip_unknown_labels = args.joern_skip_unknown

    # Get resolved paths for display
    workspace = engine.config.workspace
    db = engine.config.storage.uri

    if args.output == "json":
        # JSON mode: run build silently, then output envelope
        if args.ai_only:
            engine.ai_enhance()
        else:
            engine.build(
                skip_ingestion=args.skip_ingestion or None,
                skip_analysis=args.skip_analysis or None,
                skip_export=args.skip_export or None,
            )
        response = CLIResponse(
            command="build",
            target={"project_root": str(args.project_root)},
            result={"kind": "object", "content": {"status": "completed", "project_root": str(args.project_root)}},
            metadata=CLIMetadata(),
            success=True,
        )
        OutputFormatter().render(response, args)
        return

    if args.ai_only:
        print(f"Running AI enhancement on: {args.project_root}")
        print(f"Database: {db}\n")
        engine.ai_enhance()
        print("\nAI enhancement complete.")
    else:
        if joern_dir:
            print(f"Importing Joern CPG from: {joern_dir}")
        else:
            print(f"Building CPG for: {args.project_root}")
        print(f"Workspace: {workspace}")
        print(f"Database: {db}")
        print(f"Backend: {args.backend}")
        if joern_dir:
            print(f"ID strategy: {args.joern_id_strategy}")
        else:
            print(f"Languages: {', '.join(args.languages)}")
        print()
        engine.build(
            skip_ingestion=args.skip_ingestion or None,
            skip_analysis=args.skip_analysis or None,
            skip_export=args.skip_export or None,
        )
        print("\nBuild complete.")
