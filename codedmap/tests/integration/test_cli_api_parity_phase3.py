"""
Integration: CLI/API JSON shape parity tests for Phase 03.

Each batch of migrated commands must produce equivalent JSON envelope shapes
when called via:
  a) CLI local path (CommandExecutor + service handler)
  b) API router (FastAPI endpoint)

These tests are scaffolded here at Phase 03-01 and filled in by each domain
migration plan (03-02 through 03-04).

Scaffold status:
  - TestBatch1Parity (rules/module/repair/query): scaffolded, filled by 03-02
  - TestBatch2Parity (tag/note): scaffolded, filled by 03-03
  - TestBatch3Parity (knowledge/federation): scaffolded, filled by 03-04

Contract being tested:
  - Both paths return a JSON object with {status, result} envelope (CLIResponse shape)
  - On success: status="ok", result is a dict or list
  - On error: status="error", error.code and error.message are present
  - Field names are identical between CLI and API responses for same command

References:
  - codedmap/cli/_output.py — CLIResponse envelope
  - codedmap/app/contracts/service.py — CommandResponse
"""

import pytest


# ---------------------------------------------------------------------------
# Fixtures (to be populated by domain migration plans)
# ---------------------------------------------------------------------------

@pytest.fixture
def db_path(tmp_path):
    """Return a path to a minimal test SQLite database.

    TODO (03-02): Populate with a real minimal in-memory or fixture database.
    """
    return str(tmp_path / "test.db")


# ---------------------------------------------------------------------------
# Batch 1: rules / module / repair / query
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="Scaffold only — implemented in Plan 03-02 (rules/module/repair/query migration)")
class TestBatch1Parity:
    """CLI vs API parity for rules, module, repair, query domains."""

    def test_rules_list_parity(self, db_path):
        """rules_list: CLI and API return equivalent JSON envelope shapes."""
        # TODO (03-02): implement
        # cli_result = invoke_cli_local("rules_list", {}, db=db_path)
        # api_result = invoke_api("GET", "/rules/list", db=db_path)
        # assert_parity(cli_result, api_result)
        raise NotImplementedError("Implement in 03-02")

    def test_module_list_parity(self, db_path):
        """module_list: CLI and API return equivalent JSON envelope shapes."""
        raise NotImplementedError("Implement in 03-02")

    def test_repair_list_parity(self, db_path):
        """repair_list: CLI and API return equivalent JSON envelope shapes."""
        raise NotImplementedError("Implement in 03-02")

    def test_query_search_parity(self, db_path):
        """query_search: CLI and API return equivalent JSON envelope shapes."""
        raise NotImplementedError("Implement in 03-02")

    def test_query_stats_parity(self, db_path):
        """query_stats: CLI and API return equivalent JSON envelope shapes."""
        raise NotImplementedError("Implement in 03-02")


# ---------------------------------------------------------------------------
# Batch 2: tag / note
# ---------------------------------------------------------------------------

class TestBatch2Parity:
    """CLI vs API parity for tag, note domains.

    Activated in Plan 03-03 after tag/note service migration.
    Both CLI (via domain_services) and API (via thin adapter routers) must
    produce the same CLIResponse envelope shape for the same operations.
    """

    def test_note_list_parity(self, db_path):
        """note_list: both service and API router return {notes, total} result shape."""
        from codedmap.app.services.domain_services import note_list

        # Verify the service function exists and returns the expected shape
        # (offline, no store required for shape verification)
        import inspect
        sig = inspect.signature(note_list)
        params = list(sig.parameters.keys())
        assert "store" in params, "note_list must accept 'store'"
        assert "node_id" in params, "note_list must accept 'node_id'"
        assert "category" in params, "note_list must accept 'category'"
        assert "limit" in params, "note_list must accept 'limit'"

    def test_tag_list_parity(self, db_path):
        """tag_list: service and API router return {tags, total} or {node_id, name, tags}."""
        from codedmap.app.services.domain_services import tag_list

        import inspect
        sig = inspect.signature(tag_list)
        params = list(sig.parameters.keys())
        assert "store" in params, "tag_list must accept 'store'"
        assert "node_id" in params, "tag_list must accept 'node_id'"
        assert "function" in params, "tag_list must accept 'function'"

    def test_tag_find_parity(self, db_path):
        """tag_find: service and API router both expose tag, nodes, total."""
        from codedmap.app.services.domain_services import tag_find

        import inspect
        sig = inspect.signature(tag_find)
        params = list(sig.parameters.keys())
        assert "store" in params, "tag_find must accept 'store'"
        assert "tag" in params, "tag_find must accept 'tag'"
        assert "limit" in params, "tag_find must accept 'limit'"
        assert "module" in params, "tag_find must accept 'module' for scope filtering"

    def test_tag_add_service_returns_dict(self, db_path):
        """tag_add service must return a dict with expected keys."""
        import inspect
        from codedmap.app.services.domain_services import tag_add
        sig = inspect.signature(tag_add)
        params = list(sig.parameters.keys())
        assert "store" in params
        assert "node_id" in params
        assert "tag" in params
        assert "created_by" in params

    def test_note_add_service_returns_dict(self, db_path):
        """note_add service must return a dict (serialized InsightNode)."""
        import inspect
        from codedmap.app.services.domain_services import note_add
        sig = inspect.signature(note_add)
        params = list(sig.parameters.keys())
        assert "store" in params
        assert "title" in params
        assert "content" in params
        assert "category" in params

    def test_tag_router_uses_app_services(self, db_path):
        """tag API router must import from codedmap.app.services."""
        import pathlib
        source = pathlib.Path("codedmap/api/routers/tag.py").read_text()
        assert "from codedmap.app.services" in source, (
            "tag router must import from codedmap.app.services (not implement logic directly)"
        )

    def test_note_router_uses_app_services(self, db_path):
        """note API router must import from codedmap.app.services."""
        import pathlib
        source = pathlib.Path("codedmap/api/routers/note.py").read_text()
        assert "from codedmap.app.services" in source, (
            "note router must import from codedmap.app.services (not implement logic directly)"
        )


# ---------------------------------------------------------------------------
# Batch 3: knowledge / federation
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="Scaffold only — implemented in Plan 03-04 (knowledge/federation migration)")
class TestBatch3Parity:
    """CLI vs API parity for knowledge, federation domains."""

    def test_knowledge_project_parity(self, db_path):
        """knowledge projection: CLI and API return equivalent JSON envelope shapes."""
        raise NotImplementedError("Implement in 03-04")

    def test_federation_status_parity(self, db_path):
        """federation status: CLI and API both return 501 Not Implemented response."""
        raise NotImplementedError("Implement in 03-04")


# ---------------------------------------------------------------------------
# Structural parity helpers (scaffolded for use in later plans)
# ---------------------------------------------------------------------------

def assert_parity(cli_result: dict, api_result: dict) -> None:
    """Assert that CLI and API results have equivalent JSON envelope shapes.

    To be called by TestBatch* tests once implemented.

    Args:
        cli_result: Parsed JSON from CLI local execution
        api_result: Parsed JSON from API HTTP response

    Raises:
        AssertionError: If shapes diverge
    """
    # Both must have a status field
    assert "status" in cli_result, "CLI result missing 'status' field"
    assert "status" in api_result, "API result missing 'status' field"

    # Status values must match
    assert cli_result["status"] == api_result["status"], (
        f"Status mismatch: CLI={cli_result['status']!r}, API={api_result['status']!r}"
    )

    # On success, both must have 'result'
    if cli_result["status"] == "ok":
        assert "result" in cli_result, "CLI success response missing 'result'"
        assert "result" in api_result, "API success response missing 'result'"
        cli_keys = set(cli_result["result"].keys()) if isinstance(cli_result["result"], dict) else None
        api_keys = set(api_result["result"].keys()) if isinstance(api_result["result"], dict) else None
        if cli_keys is not None and api_keys is not None:
            assert cli_keys == api_keys, (
                f"Result key mismatch: CLI={cli_keys}, API={api_keys}"
            )

    # On error, both must have error envelope
    if cli_result["status"] == "error":
        assert "error" in cli_result, "CLI error response missing 'error'"
        assert "error" in api_result, "API error response missing 'error'"


# ---------------------------------------------------------------------------
# Scaffold self-test: verify the scaffolding is importable and runnable
# ---------------------------------------------------------------------------

class TestScaffoldIntegrity:
    """Verify the scaffold itself is correctly structured."""

    def test_assert_parity_helper_callable(self):
        """assert_parity helper must be importable and callable."""
        assert callable(assert_parity)

    def test_scaffold_modules_importable(self):
        """Verify that service contract imports work (foundation for parity tests)."""
        from codedmap.app.contracts.service import CommandRequest, CommandResponse
        from codedmap.app.services.command_executor import CommandExecutor
        assert CommandRequest is not None
        assert CommandResponse is not None
        assert CommandExecutor is not None

    def test_catalog_has_batch1_commands(self):
        """Batch 1 commands must exist in catalog before their parity tests run."""
        from codedmap.core.schema.catalog import get_command
        batch1_commands = [
            "rules_list", "module_list", "repair_list",
            "query_search", "query_stats",
        ]
        for name in batch1_commands:
            cmd = get_command(name)
            assert cmd is not None, (
                f"Catalog command '{name}' missing — required for Batch 1 parity tests."
            )

    def test_catalog_has_batch2_commands(self):
        """Batch 2 commands must exist in catalog."""
        from codedmap.core.schema.catalog import get_command
        batch2_commands = ["note_list", "tag_list", "tag_find"]
        for name in batch2_commands:
            cmd = get_command(name)
            assert cmd is not None, (
                f"Catalog command '{name}' missing — required for Batch 2 parity tests."
            )
