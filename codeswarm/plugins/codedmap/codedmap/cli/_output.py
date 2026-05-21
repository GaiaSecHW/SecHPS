# codedmap/cli/_output.py
"""CLI output adapter over shared response contracts.

This module keeps CLI-specific rendering concerns while re-exporting the
shared response/schema helpers from codedmap.app.contracts.response.
"""

import sys
import json
from typing import Any, Callable

from codedmap.app.contracts.response import (
    CLI_SCHEMA_VERSION,
    WitnessHop,
    ErrorCode,
    CLIError,
    CLIMetadata,
    CLIResponse,
    _node_to_dict,
    _node_to_witness_hop,
    _find_call_edge,
)


class OutputFormatter:
    """Dual-mode output formatter for CLI commands."""

    def __init__(self) -> None:
        self._renderers: dict[str, Callable[[Any, CLIResponse], bool]] = {
            "nodes": self._render_nodes_content,
            "text": self._render_text_content,
            "stats": self._render_stats_content,
            "object": self._render_object_content,
        }
        self._object_renderers: list[tuple[Callable[[dict], bool], Callable[[dict, CLIResponse], bool]]] = [
            (self._is_nodes_object, self._render_object_nodes),
            (self._is_inspect_object, self._render_object_inspect),
            (self._is_tags_object, self._render_object_tags),
            (self._is_notes_object, self._render_object_notes),
            (self._is_note_detail_object, self._render_object_note_detail),
        ]

    def render(self, response: CLIResponse, args) -> None:
        if getattr(args, "output", "json") == "json" or getattr(args, "json", False):
            self._render_json(response)
        else:
            self._render_text(response)

    def _render_json(self, response: CLIResponse) -> None:
        print(response.to_json())

    def _render_text(self, response: CLIResponse) -> None:
        if not response.success:
            print(f"Error: {response.error.message}", file=sys.stderr)
            return

        result = response.result
        if result is None:
            return

        if not isinstance(result, dict):
            print("No results found.")
            return

        kind = result.get("kind")
        content = result.get("content")
        if not isinstance(kind, str):
            print("No results found.")
            return

        renderer = self._renderers.get(kind)
        if renderer is None:
            print("No results found.")
            return

        if not renderer(content, response):
            print("No results found.")

    @staticmethod
    def _render_nodes_content(content: Any, response: CLIResponse) -> bool:
        if not isinstance(content, list) or not content:
            return False
        if OutputFormatter._is_tag_rows(content):
            OutputFormatter._render_tag_rows(content, response)
            return True
        if OutputFormatter._is_single_node_tags_payload(content):
            OutputFormatter._render_single_node_tags(content[0], response)
            return True
        from codedmap.cli._bootstrap import format_nodes_table
        print(format_nodes_table(content, limit=response.metadata.limit))
        return True

    @staticmethod
    def _render_text_content(content: Any, _response: CLIResponse) -> bool:
        if not isinstance(content, str):
            return False
        print(content or "(empty project)")
        return True

    @staticmethod
    def _render_stats_content(content: Any, _response: CLIResponse) -> bool:
        if not isinstance(content, dict):
            return False
        OutputFormatter._render_stats_text(content)
        return True

    def _render_object_content(self, content: Any, response: CLIResponse) -> bool:
        if content is None:
            return False
        if isinstance(content, dict):
            for predicate, renderer in self._object_renderers:
                if predicate(content):
                    return renderer(content, response)

            print(json.dumps(content, ensure_ascii=False, indent=2))
            return True

        if isinstance(content, list):
            print(json.dumps(content, ensure_ascii=False, indent=2))
            return True
        print(content)
        return True

    @staticmethod
    def _is_nodes_object(content: dict) -> bool:
        return isinstance(content.get("nodes"), list)

    @staticmethod
    def _is_inspect_object(content: dict) -> bool:
        target = content.get("target")
        if not isinstance(target, dict) or "label" not in target:
            return False
        return any(k in content for k in ("callees", "callers", "source", "tags", "notes_count"))

    @staticmethod
    def _render_object_inspect(content: dict, response: CLIResponse) -> bool:
        target = content.get("target")
        if isinstance(target, dict):
            label = target.get("label", "?")
            name = target.get("name", "?")
            file = target.get("file", "?")
            line = target.get("line")
            loc = f"{file}:{line}" if line is not None else file
            print(f"[{label}] {name} ({loc})")
            print()

        source = content.get("source")
        if isinstance(source, str) and source:
            print("Source:")
            for src_line in source.split("\n"):
                print(f"  {src_line}")
            print()

        callees = content.get("callees")
        if isinstance(callees, list):
            print(f"Callees ({len(callees)}):")
            if callees:
                for idx, c in enumerate(callees, start=1):
                    if not isinstance(c, dict):
                        continue
                    c_label = c.get("label", "?")
                    c_name = c.get("name", "?")
                    c_file = c.get("file", "?")
                    c_line = c.get("line")
                    c_loc = f"{c_file}:{c_line}" if c_line is not None else c_file
                    repaired = " [repaired]" if c.get("repaired") else ""
                    print(f"  {idx}. [{c_label}] {c_name} ({c_loc}){repaired}")
            print()

        callers = content.get("callers")
        if isinstance(callers, list):
            print(f"Callers ({len(callers)}):")
            if callers:
                for idx, c in enumerate(callers, start=1):
                    if not isinstance(c, dict):
                        continue
                    c_label = c.get("label", "?")
                    c_name = c.get("name", "?")
                    c_file = c.get("file", "?")
                    c_line = c.get("line")
                    c_loc = f"{c_file}:{c_line}" if c_line is not None else c_file
                    repaired = " [repaired]" if c.get("repaired") else ""
                    print(f"  {idx}. [{c_label}] {c_name} ({c_loc}){repaired}")
            print()

        tags = content.get("tags")
        if isinstance(tags, list):
            print(f"Tags ({len(tags)}):")
            for idx, tag in enumerate(tags, start=1):
                print(f"  {idx}. {tag}")
            print()

        return True

    @staticmethod
    def _is_tags_object(content: dict) -> bool:
        return isinstance(content.get("tags"), list)

    @staticmethod
    def _is_notes_object(content: dict) -> bool:
        return isinstance(content.get("notes"), list)

    @staticmethod
    def _is_note_detail_object(content: dict) -> bool:
        return isinstance(content.get("note"), dict)

    @staticmethod
    def _is_tag_rows(content: list[Any]) -> bool:
        return all(
            isinstance(item, dict)
            and isinstance(item.get("tag"), str)
            and "tags" not in item
            for item in content
        )

    @staticmethod
    def _is_single_node_tags_payload(content: list[Any]) -> bool:
        return (
            len(content) == 1
            and isinstance(content[0], dict)
            and isinstance(content[0].get("tags"), list)
        )

    @staticmethod
    def _render_tag_rows(content: list[dict[str, Any]], response: CLIResponse) -> None:
        total = response.metadata.total if response.metadata.total > 0 else len(content)
        print(f"Found {total} result(s):\n")
        for idx, item in enumerate(content, start=1):
            tag = item.get("tag", "?")
            created_by = item.get("created_by")
            suffix = f" [created_by={created_by}]" if isinstance(created_by, str) and created_by else ""
            print(f"  {idx}. {tag}{suffix}")

    @staticmethod
    def _render_single_node_tags(content: dict[str, Any], response: CLIResponse) -> None:
        tags = content.get("tags")
        if not isinstance(tags, list):
            return
        total = response.metadata.total if response.metadata.total > 0 else len(tags)
        print(f"Found {total} result(s):\n")
        for idx, tag in enumerate(tags, start=1):
            if isinstance(tag, dict):
                created_by = tag.get("created_by")
                suffix = f" [created_by={created_by}]" if isinstance(created_by, str) and created_by else ""
                print(f"  {idx}. {tag.get('tag', '?')}{suffix}")
            else:
                print(f"  {idx}. {tag}")

    @staticmethod
    def _render_object_nodes(content: dict, response: CLIResponse) -> bool:
        nodes = content.get("nodes")
        if not isinstance(nodes, list):
            return False
        normalized_nodes = []
        for item in nodes:
            if not isinstance(item, dict):
                continue
            row = dict(item)
            if row.get("id") is None and row.get("node_id") is not None:
                row["id"] = row["node_id"]
            normalized_nodes.append(row)
        if not normalized_nodes:
            return False
        from codedmap.cli._bootstrap import format_nodes_table
        print(format_nodes_table(normalized_nodes, limit=response.metadata.limit))
        return True

    @staticmethod
    def _render_object_tags(content: dict, _response: CLIResponse) -> bool:
        tags = content.get("tags")
        if not isinstance(tags, list):
            return False
        total = content.get("total") if isinstance(content.get("total"), int) else len(tags)
        print(f"Found {total} result(s):\n")
        for idx, tag in enumerate(tags, start=1):
            if isinstance(tag, dict):
                created_by = tag.get("created_by")
                suffix = f" [created_by={created_by}]" if isinstance(created_by, str) and created_by else ""
                print(f"  {idx}. {tag.get('tag', '?')}{suffix}")
            else:
                print(f"  {idx}. {tag}")
        return True

    @staticmethod
    def _render_object_notes(content: dict, _response: CLIResponse) -> bool:
        notes = content.get("notes")
        if not isinstance(notes, list):
            return False
        total = content.get("total") if isinstance(content.get("total"), int) else len(notes)
        print(f"Found {total} result(s):\n")
        for idx, note in enumerate(notes, start=1):
            if not isinstance(note, dict):
                print(f"  {idx}. {note}")
                continue
            note_id = note.get("note_id", "?")
            title = note.get("title", "")
            category = note.get("category", "?")
            target = note.get("target_label", "")
            source = note.get("source")
            suffix = f" recorded_by={source}" if isinstance(source, str) and source else ""
            print(f"  {idx}. [{category}] {title} (id={note_id}) {target}{suffix}".rstrip())
        return True

    @staticmethod
    def _render_object_note_detail(content: dict, _response: CLIResponse) -> bool:
        note = content.get("note")
        if not isinstance(note, dict):
            return False
        print(f"[{note.get('category', '?')}] {note.get('title', '')} (id={note.get('id', '?')})")
        note_source = note.get("source")
        if isinstance(note_source, str) and note_source:
            print(f"Recorded by: {note_source}")
        note_content = note.get("content")
        if isinstance(note_content, str) and note_content:
            print()
            rendered_content = note_content
            try:
                parsed_content = json.loads(note_content)
            except (TypeError, ValueError):
                parsed_content = None
            if isinstance(parsed_content, (dict, list)):
                rendered_content = json.dumps(
                    OutputFormatter._expand_nested_json_strings(parsed_content),
                    ensure_ascii=False,
                    indent=2,
                )
            print(rendered_content)
        contexts = content.get("node_contexts")
        if isinstance(contexts, list) and contexts:
            print("\nAttached nodes:")
            for idx, ctx in enumerate(contexts, start=1):
                if not isinstance(ctx, dict):
                    continue
                label = ctx.get("label", "?")
                name = ctx.get("name", "?")
                file = ctx.get("file", "?")
                line = ctx.get("line", "?")
                nid = ctx.get("id", "?")
                print(f"  {idx}. [{label}] {name} ({file}:{line}, id={nid})")
        return True

    @staticmethod
    def _expand_nested_json_strings(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: OutputFormatter._expand_nested_json_strings(v) for k, v in value.items()}
        if isinstance(value, list):
            return [OutputFormatter._expand_nested_json_strings(v) for v in value]
        if not isinstance(value, str):
            return value

        text = value.strip()
        if not text or text[0] not in "[{":
            return value

        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return value
        if isinstance(parsed, (dict, list)):
            return OutputFormatter._expand_nested_json_strings(parsed)
        return value

    @staticmethod
    def _render_stats_text(stats: dict) -> None:
        edge_total = stats.get("total_edges", -1)
        edge_str = str(edge_total) if isinstance(edge_total, int) and edge_total >= 0 else "N/A"
        print(
            "nodes:{nodes}  edges:{edges}  files:{files}  methods:{methods}  modules:{modules}".format(
                nodes=stats.get("total_nodes", 0),
                edges=edge_str,
                files=stats.get("files", 0),
                methods=stats.get("methods", 0),
                modules=stats.get("modules", 0),
            )
        )
        languages = stats.get("languages") or []
        if languages:
            print(f"languages: {', '.join(str(lang) for lang in languages)}")
        print()

        def _fmt_breakdown(label: str, breakdown: dict) -> str:
            total = breakdown.get("total", 0) if isinstance(breakdown, dict) else 0
            top_categories = breakdown.get("top_categories", []) if isinstance(breakdown, dict) else []
            if not top_categories:
                return f"{label}: {total}"
            parts = []
            shown = 0
            for entry in top_categories:
                if not isinstance(entry, dict) or not entry:
                    continue
                k, v = next(iter(entry.items()))
                parts.append(f"{k}:{v}")
                shown += int(v) if isinstance(v, int) else 0
            if not parts:
                return f"{label}: {total}"
            suffix = f", +{max(total - shown, 0)} more" if total > shown else ""
            return f"{label}: {total} ({', '.join(parts)}{suffix})"

        print(_fmt_breakdown("Entry points", stats.get("entry_points", {})))
        print(_fmt_breakdown("Sources", stats.get("sources", {})))
        print(_fmt_breakdown("Sinks", stats.get("sinks", {})))
        print(f"Guards: {stats.get('guards', 0)}  Sanitizers: {stats.get('sanitizers', 0)}")
        print()

        def _fmt_audit(label: str, audit: dict) -> str:
            total = audit.get("total", 0) if isinstance(audit, dict) else 0
            audited = audit.get("audited", 0) if isinstance(audit, dict) else 0
            percent = audit.get("percent", 0.0) if isinstance(audit, dict) else 0.0
            return f"{label}: {audited}/{total} audited ({percent:.0f}%)"

        print(_fmt_audit("Entry points", stats.get("entry_point_audit", {})))
        print(_fmt_audit("Sources", stats.get("source_audit", {})))
        print(_fmt_audit("Sinks", stats.get("sink_audit", {})))

        notes_total = stats.get("notes_total", 0)
        notes_by_category = stats.get("notes_by_category", {})
        if isinstance(notes_by_category, dict) and notes_by_category:
            notes_desc = ", ".join(f"{k}:{v}" for k, v in notes_by_category.items())
            print(f"Notes: {notes_total} ({notes_desc})")
        else:
            print(f"Notes: {notes_total}")
        print(f"Repairs: {stats.get('repairs_total', 0)}")
        print()

        hot_spots = stats.get("hot_spots", [])
        if isinstance(hot_spots, list) and hot_spots:
            print("Hot spots:")
            for idx, hs in enumerate(hot_spots, start=1):
                if not isinstance(hs, dict):
                    continue
                name = hs.get("name", "?")
                file_path = hs.get("file") or "?"
                line = hs.get("line")
                loc = f"{file_path}:{line}" if line is not None else file_path
                score = hs.get("score", 0)
                sinks = hs.get("unaudited_sinks", 0)
                sources = hs.get("unaudited_sources", 0)
                print(f"  {idx}. {name} [{loc}]  score:{score} ({sinks} sinks, {sources} sources)")
            total_methods = stats.get("hot_spots_total_methods")
            if isinstance(total_methods, int) and total_methods > len(hot_spots):
                print(f"  ... and {total_methods - len(hot_spots)} more methods.")
            print()
