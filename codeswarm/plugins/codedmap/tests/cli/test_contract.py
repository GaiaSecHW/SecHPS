# tests/cli/test_contract.py
"""
Phase 22 — Agent Contract Freeze: CLI contract tests.

Tests for:
- AGT-01: schema_version on all JSON outputs
- AGT-02: Ambiguous target resolution with machine-readable candidates
- AGT-04: Exit codes, JSON envelopes on errors, safe_main behavior
"""

import argparse
import json
import sys
import unittest
from unittest.mock import MagicMock, patch

from codedmap.cli._output import (
    CLIResponse,
    CLIMetadata,
    CLIError,
    ErrorCode,
    OutputFormatter,
    CLI_SCHEMA_VERSION,
    _node_to_dict,
)
from codedmap.cli._bootstrap import (
    AmbiguousTargetError,
    safe_main,
    resolve_target,
    _extract_namespace,
    _output_error_on_crash,
)


# ═══════════════════════════════════════════════════════════════════════════════
# AGT-01: schema_version on all JSON outputs
# ═══════════════════════════════════════════════════════════════════════════════

class TestSchemaVersion(unittest.TestCase):
    """AGT-01: Every JSON envelope includes schema_version."""

    def test_schema_version_in_success_response(self):
        """Success responses include schema_version."""
        response = CLIResponse.success_response("search", [{"id": 1, "name": "main"}])
        data = json.loads(response.to_json())
        self.assertEqual(data["schema_version"], "1.0.0")

    def test_schema_version_in_error_response(self):
        """Error responses include schema_version."""
        response = CLIResponse.error_response("callers", "NODE_NOT_FOUND", "Node not found")
        data = json.loads(response.to_json())
        self.assertEqual(data["schema_version"], "1.0.0")

    def test_schema_version_in_ambiguous_response(self):
        """Ambiguous target responses include schema_version."""
        response = CLIResponse.ambiguous_response("callers", "main", [
            {"id": 1, "name": "main", "file": "a.c", "line": 1, "label": "METHOD"},
            {"id": 2, "name": "main", "file": "b.c", "line": 5, "label": "METHOD"},
        ])
        data = json.loads(response.to_json())
        self.assertEqual(data["schema_version"], "1.0.0")

    def test_schema_version_is_first_field(self):
        """schema_version appears before command in JSON output."""
        response = CLIResponse(command="test")
        data = json.loads(response.to_json())
        keys = list(data.keys())
        self.assertEqual(keys[0], "schema_version")

    def test_cli_schema_version_constant(self):
        """CLI_SCHEMA_VERSION constant is importable and matches envelope."""
        self.assertEqual(CLI_SCHEMA_VERSION, "1.0.0")
        response = CLIResponse(command="test")
        self.assertEqual(response.schema_version, CLI_SCHEMA_VERSION)

    def test_schema_version_in_manual_construction(self):
        """Manually constructed CLIResponse gets schema_version automatically."""
        response = CLIResponse(
            command="callers",
            target={"raw": "main"},
            result={"kind": "nodes", "content": []},
        )
        data = json.loads(response.to_json())
        self.assertIn("schema_version", data)
        self.assertEqual(data["schema_version"], "1.0.0")


# ═══════════════════════════════════════════════════════════════════════════════
# AGT-02: Ambiguous target resolution
# ═══════════════════════════════════════════════════════════════════════════════

class TestAmbiguousTarget(unittest.TestCase):
    """AGT-02: Ambiguous target resolution returns machine-readable candidates."""

    def test_ambiguous_target_error_attributes(self):
        """AmbiguousTargetError carries query and candidates."""
        candidates = [
            {"id": 1, "name": "main", "file": "a.c", "line": 1, "label": "METHOD"},
            {"id": 2, "name": "main", "file": "b.c", "line": 5, "label": "METHOD"},
        ]
        err = AmbiguousTargetError(query="main", candidates=candidates)
        self.assertEqual(err.query, "main")
        self.assertEqual(len(err.candidates), 2)
        self.assertIn("main", str(err))
        self.assertIn("2 nodes", str(err))

    def test_ambiguous_response_envelope_shape(self):
        """CLIResponse.ambiguous_response produces correct envelope."""
        candidates = [
            {"id": 1, "name": "main", "file": "a.c", "line": 1, "label": "METHOD"},
            {"id": 2, "name": "main", "file": "b.c", "line": 5, "label": "METHOD"},
        ]
        response = CLIResponse.ambiguous_response("callers", "main", candidates)
        data = json.loads(response.to_json())

        self.assertFalse(data["success"])
        self.assertEqual(data["error"]["code"], "AMBIGUOUS_TARGET")
        self.assertEqual(data["result"]["kind"], "object")
        self.assertIn("candidates", data["result"]["content"])
        self.assertEqual(len(data["result"]["content"]["candidates"]), 2)
        self.assertEqual(data["result"]["content"]["total"], 2)
        self.assertEqual(data["target"]["raw"], "main")
        self.assertIn("--node-id", data["error"]["message"])

    def test_ambiguous_target_error_code_exists(self):
        """ErrorCode.AMBIGUOUS_TARGET is defined."""
        self.assertEqual(ErrorCode.AMBIGUOUS_TARGET.value, "AMBIGUOUS_TARGET")

    def test_resolve_target_raises_on_multiple_matches(self):
        """resolve_target() raises AmbiguousTargetError for multi-match function names."""
        # Create a mock store
        mock_store = MagicMock()

        # Create mock method nodes
        m1 = MagicMock()
        m1.id = 1
        m1.name = "main"
        m1.label = MagicMock(value="METHOD")
        m1.fileName = "a.c"
        m1.file_name = "a.c"
        m1.lineNumber = 1
        m1.line_number = 1

        m2 = MagicMock()
        m2.id = 2
        m2.name = "main"
        m2.label = MagicMock(value="METHOD")
        m2.fileName = "b.c"
        m2.file_name = "b.c"
        m2.lineNumber = 5
        m2.line_number = 5

        # Mock NodeResolver.resolve_function returning 2 matches
        with patch("codedmap.cli._bootstrap.NodeResolver") as MockResolver:
            MockResolver.return_value.resolve_function.return_value = [m1, m2]

            args = argparse.Namespace(
                node_id=None, file=None, line=None, function="main", output="text"
            )

            with self.assertRaises(AmbiguousTargetError) as ctx:
                resolve_target(mock_store, args)

            self.assertEqual(ctx.exception.query, "main")
            self.assertEqual(len(ctx.exception.candidates), 2)

    def test_resolve_target_returns_single_match(self):
        """resolve_target() returns the node when there's exactly one match."""
        mock_store = MagicMock()
        m1 = MagicMock()
        m1.id = 1
        m1.name = "unique_func"

        with patch("codedmap.cli._bootstrap.NodeResolver") as MockResolver:
            MockResolver.return_value.resolve_function.return_value = [m1]

            args = argparse.Namespace(
                node_id=None, file=None, line=None, function="unique_func", output="text"
            )

            result = resolve_target(mock_store, args)
            self.assertIs(result, m1)


# ═══════════════════════════════════════════════════════════════════════════════
# AGT-04: Exit codes and JSON envelope guarantees
# ═══════════════════════════════════════════════════════════════════════════════

class TestExitCodes(unittest.TestCase):
    """AGT-04: Predictable exit codes and JSON envelopes."""

    def test_safe_main_exits_1_on_exception(self):
        """safe_main exits with code 1 (not 0) on uncaught exceptions."""

        @safe_main
        def failing_command(args):
            raise RuntimeError("unexpected error")

        args = argparse.Namespace(output="text")

        with self.assertRaises(SystemExit) as ctx:
            failing_command(args)
        self.assertEqual(ctx.exception.code, 1)

    def test_safe_main_exits_130_on_keyboard_interrupt(self):
        """safe_main exits with code 130 on KeyboardInterrupt."""

        @safe_main
        def interrupted_command(args):
            raise KeyboardInterrupt()

        args = argparse.Namespace(output="text")

        with self.assertRaises(SystemExit) as ctx:
            interrupted_command(args)
        self.assertEqual(ctx.exception.code, 130)

    def test_safe_main_json_envelope_on_error(self):
        """safe_main emits JSON envelope to stdout on error when --output json."""

        @safe_main
        def failing_json_command(args):
            raise RuntimeError("test error")

        args = argparse.Namespace(output="json")

        import io
        captured = io.StringIO()

        with patch("sys.stdout", captured):
            with self.assertRaises(SystemExit) as ctx:
                failing_json_command(args)

        self.assertEqual(ctx.exception.code, 1)
        output = captured.getvalue()
        data = json.loads(output)
        self.assertFalse(data["success"])
        self.assertEqual(data["error"]["code"], "INTERNAL_ERROR")
        self.assertIn("schema_version", data)

    def test_safe_main_catches_ambiguous_target_json(self):
        """safe_main catches AmbiguousTargetError and emits JSON envelope."""

        @safe_main
        def ambiguous_command(args):
            raise AmbiguousTargetError(
                query="main",
                candidates=[
                    {"id": 1, "name": "main", "file": "a.c", "line": 1, "label": "METHOD"},
                    {"id": 2, "name": "main", "file": "b.c", "line": 5, "label": "METHOD"},
                ],
            )

        args = argparse.Namespace(output="json")

        import io
        captured = io.StringIO()

        with patch("sys.stdout", captured):
            with self.assertRaises(SystemExit) as ctx:
                ambiguous_command(args)

        self.assertEqual(ctx.exception.code, 1)
        output = captured.getvalue()
        data = json.loads(output)
        self.assertFalse(data["success"])
        self.assertEqual(data["error"]["code"], "AMBIGUOUS_TARGET")
        self.assertEqual(data["result"]["kind"], "object")
        self.assertEqual(len(data["result"]["content"]["candidates"]), 2)

    def test_safe_main_catches_ambiguous_target_text(self):
        """safe_main catches AmbiguousTargetError and prints to stderr in text mode."""

        @safe_main
        def ambiguous_command(args):
            raise AmbiguousTargetError(
                query="main",
                candidates=[
                    {"id": 1, "name": "main", "file": "a.c", "line": 1, "label": "METHOD"},
                ],
            )

        args = argparse.Namespace(output="text")

        import io
        captured_err = io.StringIO()

        with patch("sys.stderr", captured_err):
            with self.assertRaises(SystemExit) as ctx:
                ambiguous_command(args)

        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("main", captured_err.getvalue())

    def test_extract_namespace_from_args_tuple(self):
        """_extract_namespace correctly extracts Namespace from *args tuple."""
        ns = argparse.Namespace(output="json", db="test.db")
        result = _extract_namespace((ns,))
        self.assertIs(result, ns)

    def test_extract_namespace_returns_none_for_empty(self):
        """_extract_namespace returns None for empty args."""
        self.assertIsNone(_extract_namespace(()))
        self.assertIsNone(_extract_namespace(None))

    def test_output_error_on_crash_json_mode(self):
        """_output_error_on_crash emits JSON when Namespace has output=json."""
        import io
        captured = io.StringIO()
        ns = argparse.Namespace(output="json")

        with patch("sys.stdout", captured):
            _output_error_on_crash("TEST_ERROR", "test message", (ns,))

        data = json.loads(captured.getvalue())
        self.assertEqual(data["error"]["code"], "TEST_ERROR")
        self.assertIn("schema_version", data)


class TestJsonEnvelopeGuarantees(unittest.TestCase):
    """Additional AGT-04 tests for JSON envelope consistency."""

    def test_all_error_codes_are_strings(self):
        """Every ErrorCode enum member is a string value."""
        for code in ErrorCode:
            self.assertIsInstance(code.value, str)

    def test_error_response_includes_error_object(self):
        """Error responses always have a non-None error field."""
        response = CLIResponse.error_response("test", "NODE_NOT_FOUND", "Not found")
        data = json.loads(response.to_json())
        self.assertIn("error", data)
        self.assertIn("code", data["error"])
        self.assertIn("message", data["error"])

    def test_success_response_omits_error(self):
        """Success responses omit the error field (exclude_none)."""
        response = CLIResponse.success_response("test", [])
        data = json.loads(response.to_json())
        self.assertNotIn("error", data)


class TestOutputFormatterText(unittest.TestCase):
    def test_stats_text_renders_dashboard_instead_of_empty_results(self):
        response = CLIResponse(
            command="stats",
            result={
                "kind": "stats",
                "content": {
                    "total_nodes": 7,
                    "total_edges": 11,
                    "files": 2,
                    "methods": 5,
                    "modules": 1,
                    "languages": ["c"],
                    "entry_points": {"total": 0, "top_categories": []},
                    "sources": {"total": 0, "top_categories": []},
                    "sinks": {"total": 0, "top_categories": []},
                    "guards": 0,
                    "sanitizers": 0,
                    "entry_point_audit": {"total": 0, "audited": 0, "percent": 0.0},
                    "source_audit": {"total": 0, "audited": 0, "percent": 0.0},
                    "sink_audit": {"total": 0, "audited": 0, "percent": 0.0},
                    "notes_total": 0,
                    "notes_by_category": {},
                    "repairs_total": 0,
                    "hot_spots": [],
                    "hot_spots_total_methods": 0,
                    "suggested_commands": [],
                },
            },
            metadata=CLIMetadata(total=7),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("nodes:7", out)
        self.assertNotIn("No results found.", out)

    def test_tree_text_renders_skeleton_instead_of_empty_results(self):
        response = CLIResponse(
            command="tree",
            result={"kind": "text", "content": "src/\n└── main.c"},
            metadata=CLIMetadata(total=0),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("src/", out)
        self.assertIn("main.c", out)
        self.assertNotIn("No results found.", out)

    def test_object_tags_render_as_human_list(self):
        response = CLIResponse(
            command="tag",
            result={
                "kind": "object",
                "content": {
                    "tags": [
                        {
                            "tag": "ONTOLOGY:ENTRY_POINT:CLI_COMMAND",
                            "created_by": "auditor@tag:add",
                        },
                        {
                            "tag": "STATE:REVIEWED",
                            "created_by": "reviewer@tag:add",
                        },
                    ],
                    "total": 2,
                },
            },
            metadata=CLIMetadata(total=2),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("Found 2 result(s):", out)
        self.assertIn("1. ONTOLOGY:ENTRY_POINT:CLI_COMMAND [created_by=auditor@tag:add]", out)
        self.assertIn("2. STATE:REVIEWED [created_by=reviewer@tag:add]", out)

    def test_nodes_tag_rows_render_as_human_list(self):
        response = CLIResponse(
            command="tag",
            result={
                "kind": "nodes",
                "content": [
                    {"tag": "ONTOLOGY:ENTRY_POINT:CLI_COMMAND"},
                    {"tag": "STATE:REVIEWED"},
                ],
            },
            metadata=CLIMetadata(total=2),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("Found 2 result(s):", out)
        self.assertIn("1. ONTOLOGY:ENTRY_POINT:CLI_COMMAND", out)
        self.assertIn("2. STATE:REVIEWED", out)

    def test_single_node_tags_render_as_human_list(self):
        response = CLIResponse(
            command="tag",
            result={
                "kind": "nodes",
                "content": [
                    {
                        "node_id": 123,
                        "name": "main",
                        "tags": [
                            {
                                "tag": "ONTOLOGY:ENTRY_POINT:CLI_COMMAND",
                                "created_by": "auditor@tag:add",
                            },
                            {
                                "tag": "STATE:REVIEWED",
                                "created_by": "reviewer@tag:add",
                            },
                        ],
                    }
                ],
            },
            metadata=CLIMetadata(total=2),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("Found 2 result(s):", out)
        self.assertIn("1. ONTOLOGY:ENTRY_POINT:CLI_COMMAND [created_by=auditor@tag:add]", out)
        self.assertIn("2. STATE:REVIEWED [created_by=reviewer@tag:add]", out)

    def test_object_nodes_render_via_nodes_table(self):
        response = CLIResponse(
            command="tag",
            result={
                "kind": "object",
                "content": {
                    "nodes": [
                        {
                            "node_id": 123,
                            "name": "main",
                            "label": "METHOD",
                            "file": "src/main.c",
                            "line": 42,
                        }
                    ],
                    "total": 1,
                },
            },
            metadata=CLIMetadata(total=1, limit=50),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("Found 1 result(s):", out)
        self.assertIn("[METHOD] main (src/main.c:42, id=123)", out)

    def test_object_notes_render_as_human_list(self):
        response = CLIResponse(
            command="note",
            result={
                "kind": "object",
                "content": {
                    "notes": [
                        {
                            "note_id": "77",
                            "title": "taint entrypoint",
                            "category": "COORDINATION",
                            "target_label": "[Target: main]",
                            "source": "auditor@note:add",
                        }
                    ],
                    "total": 1,
                },
            },
            metadata=CLIMetadata(total=1),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("Found 1 result(s):", out)
        self.assertIn("[COORDINATION] taint entrypoint (id=77) [Target: main]", out)

    def test_object_note_detail_renders_with_contexts(self):
        response = CLIResponse(
            command="note",
            result={
                "kind": "object",
                "content": {
                    "note": {
                        "id": 88,
                        "category": "FINDING",
                        "title": "overflow risk",
                        "content": "check size before memcpy",
                    },
                    "node_contexts": [
                        {
                            "id": 123,
                            "label": "METHOD",
                            "name": "main",
                            "file": "src/main.c",
                            "line": 42,
                        }
                    ],
                },
            },
            metadata=CLIMetadata(total=1),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("[FINDING] overflow risk (id=88)", out)
        self.assertIn("check size before memcpy", out)
        self.assertIn("Attached nodes:", out)
        self.assertIn("[METHOD] main (src/main.c:42, id=123)", out)

    def test_object_note_detail_pretty_prints_json_content_with_utf8(self):
        response = CLIResponse(
            command="note",
            result={
                "kind": "object",
                "content": {
                    "note": {
                        "id": 89,
                        "category": "COORDINATION",
                        "title": "Hunter 审计摘要",
                        "content": "{\"status\":\"DONE\",\"message\":\"中文内容\",\"metrics\":{\"count\":1}}",
                    },
                    "node_contexts": [],
                },
            },
            metadata=CLIMetadata(total=1),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn("[COORDINATION] Hunter 审计摘要 (id=89)", out)
        self.assertIn('"message": "中文内容"', out)
        self.assertIn('"status": "DONE"', out)
        self.assertNotIn('\\"status\\"', out)

    def test_object_note_detail_expands_nested_json_string_fields(self):
        response = CLIResponse(
            command="note",
            result={
                "kind": "object",
                "content": {
                    "note": {
                        "id": 90,
                        "category": "COORDINATION",
                        "title": "Nested payload",
                        "content": (
                            "{\"status\":\"DONE\",\"message\":\"{\\\"summary\\\":\\\"Audited\\\","
                            "\\\"target_breakdown\\\":[{\\\"name\\\":\\\"png_read_info\\\","
                            "\\\"verdict\\\":\\\"CLEAN\\\"}]}\",\"metrics\":{\"count\":1}}"
                        ),
                    },
                    "node_contexts": [],
                },
            },
            metadata=CLIMetadata(total=1),
            success=True,
        )
        args = argparse.Namespace(output="text")
        import io
        stream = io.StringIO()
        with patch("sys.stdout", stream):
            OutputFormatter().render(response, args)

        out = stream.getvalue()
        self.assertIn('"summary": "Audited"', out)
        self.assertIn('"name": "png_read_info"', out)
        self.assertNotIn('\\"summary\\"', out)


if __name__ == "__main__":
    unittest.main()
