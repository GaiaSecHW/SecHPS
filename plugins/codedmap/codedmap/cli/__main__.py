# codedmap/cli/__main__.py
"""
CodeDMap CLI entry point.

Usage:
    python -m codedmap.cli <command> [options]

Commands (11 domains):
    Query:      cdm query {search,inspect,trace,entrypoints,stats,tree}
    Note:       cdm note {add,list,show,remove}
    Tag:        cdm tag {add,remove,list,find,bulk}
    Module:     cdm module {create,delete,rename,list,show,assign,remove}
    Repair:     cdm repair {link,suggest,list,undo}
    Rules:      cdm rules {list,categories,show,resolve,add-sink,...}
    Federation: cdm federation {register,link,neighbors}
    Knowledge:  cdm knowledge {dump,project}
    Build:      cdm build [enhance]
    Serve:      cdm serve --db <path> --port <port>

Migrated domains (query, note, tag, module, repair, rules, federation, knowledge) are
registered via _catalog_dispatch.register_catalog_domain() — a single generic dispatcher
driven by catalog DOMAIN_DESCRIPTIONS and input models.

build and serve are explicit hand-written CLI-native exceptions.
"""

import argparse
import logging
import sys


def main():
    parser = argparse.ArgumentParser(
        prog="cdm",
        description="CodeDMap — The Deterministic Code Atlas for Agent-Driven Auditing.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging and full tracebacks on internal errors.",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Migrated domains — registered via generic catalog dispatcher
    from codedmap.cli.commands._catalog_dispatch import register_catalog_domain, dispatch_catalog_command

    MIGRATED_DOMAINS = ["query", "note", "tag", "module", "repair", "rules", "federation", "knowledge"]
    for domain in MIGRATED_DOMAINS:
        register_catalog_domain(subparsers, domain)

    # Explicit CLI-native exceptions (build and serve)
    from codedmap.cli.commands import build as cmd_build
    from codedmap.cli.commands import serve as cmd_serve

    cmd_build.register(subparsers)
    cmd_serve.register(subparsers)

    args = parser.parse_args()
    if getattr(args, "debug", False):
        logging.basicConfig(level=logging.DEBUG)
        logging.getLogger().setLevel(logging.DEBUG)

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command in MIGRATED_DOMAINS:
        dispatch_catalog_command(args, args.command)
    elif args.command == "build":
        cmd_build.run(args)
    elif args.command == "serve":
        cmd_serve.run(args)


if __name__ == "__main__":
    main()
