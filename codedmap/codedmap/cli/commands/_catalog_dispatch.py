# codedmap/cli/commands/_catalog_dispatch.py
"""Catalog-driven CLI registration + thin local dispatch adapter.

This module intentionally contains only parser registration and dispatch wiring.
Business logic execution for local mode is delegated to:
- codedmap.cli._bootstrap._dispatch_catalog_command_via_executor (CommandExecutor)
- codedmap.cli._remote.remote_execute (remote mode)
"""

from __future__ import annotations

import inspect
from argparse import Action, ArgumentParser
from enum import Enum
from typing import get_args, get_origin

from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS, get_command


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def register_catalog_domain(subparsers, domain: str) -> None:
    """Register a migrated domain command from catalog metadata."""
    register = _REGISTER_FN.get(domain)
    if register is None:
        raise ValueError(f"Unsupported migrated domain: {domain}")
    register(subparsers)


def dispatch_catalog_command(args, domain: str) -> None:
    """Thin dispatch path: local -> CommandExecutor, remote -> remote adapter."""
    from codedmap.cli._bootstrap import _dispatch_catalog_command_via_executor

    _dispatch_catalog_command_via_executor(args, domain)


# ---------------------------------------------------------------------------
# Generic registration helpers
# ---------------------------------------------------------------------------


def _add_connection_output_args(parser: ArgumentParser) -> None:
    from codedmap.cli._bootstrap import add_connection_args

    add_connection_args(parser)


def _is_list_annotation(annotation) -> bool:
    origin = get_origin(annotation)
    if origin in (list, tuple):
        return True
    return "list" in str(annotation).lower()


def _field_type(annotation):
    origin = get_origin(annotation)
    if origin is None:
        return annotation
    args = [a for a in get_args(annotation) if a is not type(None)]
    return args[0] if args else str


def _enum_choices(typ) -> list[str] | None:
    """Return the string choices for a str-Enum field, or None otherwise.

    argparse gets the raw string value; the service/API layer converts it
    back into the enum. This keeps CLI help output ("--reason {a,b,c}")
    aligned with the enum membership declared in the catalog.
    """
    if isinstance(typ, type) and issubclass(typ, Enum):
        return [member.value for member in typ]
    return None


def _model_help_text(model_cls: type) -> str | None:
    doc = getattr(model_cls, "__doc__", None)
    if not doc:
        return None
    return inspect.cleandoc(doc)


class _NoteListCampaignIdAction(Action):
    def __call__(self, parser, namespace, values, option_string=None):
        if getattr(namespace, "scope", None) == "all":
            parser.error("--campaign-id cannot be used with --scope all")
        setattr(namespace, self.dest, values)


class _NoteListScopeAction(Action):
    def __call__(self, parser, namespace, values, option_string=None):
        if values == "all" and getattr(namespace, "campaign_id", None) is not None:
            parser.error("--scope all cannot be used with --campaign-id")
        setattr(namespace, self.dest, values)


def _register_command_action(sub, domain: str, action: str, help_text: str | None = None) -> None:
    cmd_name = f"{domain}_{action.replace('-', '_')}"
    cmd_def = get_command(cmd_name)
    if cmd_def is None:
        return

    parser = sub.add_parser(
        action,
        help=help_text or cmd_def.description,
        description=_model_help_text(cmd_def.input_model),
    )
    _add_connection_output_args(parser)

    shared_args = {"offset"}

    for field_name, field in cmd_def.input_model.model_fields.items():
        if field_name in shared_args:
            continue
        annotation = field.annotation
        typ = _field_type(annotation)
        required = field.is_required()
        choices = _enum_choices(typ)

        # Prefer positional args for required scalar parameters to keep CLI ergonomic.
        use_positional = required and (typ in (str, int, float) or choices is not None)

        if use_positional:
            kwargs = {"help": field.description}
            if choices is not None:
                kwargs["choices"] = choices
                kwargs["type"] = str
            else:
                kwargs["type"] = typ
            parser.add_argument(field_name, **kwargs)
            continue

        arg_name = f"--{field_name.replace('_', '-')}"

        if typ is bool:
            default = None if required else field.default
            if default is True:
                parser.add_argument(
                    arg_name,
                    dest=field_name,
                    action="store_false",
                    default=True,
                    help=field.description,
                )
            else:
                parser.add_argument(
                    arg_name,
                    dest=field_name,
                    action="store_true",
                    default=False,
                    help=field.description,
                )
            continue

        kwargs = {"dest": field_name, "help": field.description}
        if _is_list_annotation(annotation):
            inner = _field_type(get_args(annotation)[0]) if get_args(annotation) else str
            inner_choices = _enum_choices(inner)
            kwargs["nargs"] = "+"
            kwargs["type"] = str if inner_choices is not None else (inner if inner in (str, int, float) else str)
            if inner_choices is not None:
                kwargs["choices"] = inner_choices
        elif choices is not None:
            kwargs["type"] = str
            kwargs["choices"] = choices
        else:
            kwargs["type"] = typ if typ in (str, int, float) else str

        if required:
            kwargs["required"] = True
        else:
            default = field.default
            if isinstance(default, Enum):
                default = default.value
            kwargs["default"] = None if default is None else default

        if domain == "note" and action == "list" and field_name == "scope":
            kwargs["action"] = _NoteListScopeAction
        elif domain == "note" and action == "list" and field_name == "campaign_id":
            kwargs["action"] = _NoteListCampaignIdAction

        parser.add_argument(arg_name, **kwargs)


# ---------------------------------------------------------------------------
# Domain registration
# ---------------------------------------------------------------------------


def _register_query(subparsers) -> None:
    p = subparsers.add_parser("query", help=DOMAIN_DESCRIPTIONS["query"])
    sub = p.add_subparsers(dest="query_action", help="Query subcommand")
    _register_command_action(sub, "query", "search")
    _register_command_action(sub, "query", "inspect")
    _register_command_action(sub, "query", "trace")
    _register_command_action(sub, "query", "entrypoints")
    _register_command_action(sub, "query", "sources")
    _register_command_action(sub, "query", "sinks")
    _register_command_action(sub, "query", "guards")
    _register_command_action(sub, "query", "sanitizers")
    _register_command_action(sub, "query", "roles")
    _register_command_action(sub, "query", "stats")
    _register_command_action(sub, "query", "tree")


def _register_note(subparsers) -> None:
    p = subparsers.add_parser("note", help=DOMAIN_DESCRIPTIONS["note"], description=DOMAIN_DESCRIPTIONS["note"])
    sub = p.add_subparsers(dest="note_action", help="Note action")
    _register_command_action(sub, "note", "add")
    _register_command_action(sub, "note", "list")
    _register_command_action(sub, "note", "show")
    _register_command_action(sub, "note", "promote")
    _register_command_action(sub, "note", "confirm")
    _register_command_action(sub, "note", "remove")


def _register_tag(subparsers) -> None:
    p = subparsers.add_parser("tag", help=DOMAIN_DESCRIPTIONS["tag"], description=DOMAIN_DESCRIPTIONS["tag"])
    sub = p.add_subparsers(dest="tag_action", help="Tag action")
    _register_command_action(sub, "tag", "add")
    _register_command_action(sub, "tag", "remove")
    _register_command_action(sub, "tag", "list")
    _register_command_action(sub, "tag", "find")
    _register_command_action(sub, "tag", "bulk")


def _register_module(subparsers) -> None:
    p = subparsers.add_parser("module", help=DOMAIN_DESCRIPTIONS["module"])
    sub = p.add_subparsers(dest="module_action", help="Module action")
    _register_command_action(sub, "module", "create")
    _register_command_action(sub, "module", "delete")
    _register_command_action(sub, "module", "rename")
    _register_command_action(sub, "module", "list")
    _register_command_action(sub, "module", "show")
    _register_command_action(sub, "module", "assign")
    _register_command_action(sub, "module", "remove")
    _register_command_action(sub, "module", "of")
    _register_command_action(sub, "module", "deps")


def _register_repair(subparsers) -> None:
    p = subparsers.add_parser("repair", help=DOMAIN_DESCRIPTIONS["repair"])
    sub = p.add_subparsers(dest="repair_action", help="Repair action")
    _register_command_action(sub, "repair", "link")
    _register_command_action(sub, "repair", "suggest")
    _register_command_action(sub, "repair", "list")
    _register_command_action(sub, "repair", "undo")


def _register_rules(subparsers) -> None:
    p = subparsers.add_parser("rules", help=DOMAIN_DESCRIPTIONS["rules"])
    sub = p.add_subparsers(dest="rules_action", help="Rules action")
    _register_command_action(sub, "rules", "list")
    _register_command_action(sub, "rules", "categories")
    _register_command_action(sub, "rules", "show")
    _register_command_action(sub, "rules", "resolve")
    _register_command_action(sub, "rules", "add_sink")
    _register_command_action(sub, "rules", "add_source")
    _register_command_action(sub, "rules", "add_safe")
    _register_command_action(sub, "rules", "add_entrypoint")
    _register_command_action(sub, "rules", "tombstone")
    _register_command_action(sub, "rules", "validate")


def _register_federation(subparsers) -> None:
    p = subparsers.add_parser("federation", help=DOMAIN_DESCRIPTIONS["federation"])
    sub = p.add_subparsers(dest="federation_action", help="Federation action")
    _register_command_action(sub, "federation", "register")
    _register_command_action(sub, "federation", "link")
    _register_command_action(sub, "federation", "neighbors")


def _register_knowledge(subparsers) -> None:
    p = subparsers.add_parser("knowledge", help=DOMAIN_DESCRIPTIONS["knowledge"])
    sub = p.add_subparsers(dest="knowledge_action", help="Knowledge action")
    _register_command_action(sub, "knowledge", "dump")
    _register_command_action(sub, "knowledge", "project")


_REGISTER_FN = {
    "query": _register_query,
    "note": _register_note,
    "tag": _register_tag,
    "module": _register_module,
    "repair": _register_repair,
    "rules": _register_rules,
    "federation": _register_federation,
    "knowledge": _register_knowledge,
}
