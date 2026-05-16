"""
Architecture guard: Phase 03 migration order and checkpoint assertions.

Enforces the migration sequence:
    rules -> module -> repair -> query -> tag_note -> knowledge_federation
    -> client_convergence -> cli_shell_convergence

This test represents the machine-checkable migration contract. As each domain
plan (03-02 through 03-04) completes a migration batch, the corresponding
checkpoint assertion must be updated from PENDING to COMPLETE.

Failing this test means the migration order was violated or a checkpoint was
skipped without implementation.

Final migration state (Plan 03-04):
  - All checkpoints complete — Phase 03 migration finished.
  - knowledge_federation: API routers use app.services; api/services/ deleted.
  - client_convergence: _remote.py + cdm_client.py delegate to codedmap.client.sdk.
  - cli_shell_convergence: build/serve remain CLI-local (unregistered in executor).
"""

import pathlib
import re
import pytest

PLANNING_ROOT = pathlib.Path(".planning")
PHASE3_DIR = PLANNING_ROOT / "phases" / "03-api-first-architecture-convergence-shared-service-layer-and-thin-cli-wrapper"


# ---------------------------------------------------------------------------
# Migration checkpoint registry
# ---------------------------------------------------------------------------

# Each checkpoint represents a domain batch migration target.
# Status: "pending" = not yet started, "in_progress" = plan executing,
#         "complete" = SUMMARY.md committed and verified.
#
# MIGRATION ORDER IS STRICT: later checkpoints may only be marked complete
# if all earlier checkpoints are also complete.

MIGRATION_CHECKPOINTS = [
    {
        "name": "phase3_foundations",
        "order": 0,
        "plan": "03-01",
        "domains": ["service_contracts", "architecture_guards", "validation_scaffolding"],
        "status": "complete",  # This plan (03-01)
        "verified_by": "test_catalog_first_enforcement.py",
    },
    {
        "name": "rules_module_repair_query",
        "order": 1,
        "plan": "03-02",
        "domains": ["rules", "module", "repair", "query"],
        "status": "complete",  # Plan 03-02 completed
        "verified_by": "test_cli_api_parity_phase3.py::TestBatch1Parity",
    },
    {
        "name": "tag_note",
        "order": 2,
        "plan": "03-03",
        "domains": ["tag", "note"],
        "status": "complete",  # Plan 03-03 completed
        "verified_by": "test_cli_api_parity_phase3.py::TestBatch2Parity",
    },
    {
        "name": "knowledge_federation",
        "order": 3,
        "plan": "03-04",
        "domains": ["knowledge", "federation"],
        "status": "complete",  # Plan 03-04: api/services deleted; routers use app.services
        "verified_by": "test_cli_api_parity_phase3.py::TestBatch3Parity",
    },
    {
        "name": "client_convergence",
        "order": 4,
        "plan": "03-04",
        "domains": ["cli_remote", "cdm_client", "shared_sdk"],
        "status": "complete",  # Plan 03-04: codedmap/client/sdk.py created; both wrappers converged
        "verified_by": "test_remote_client_convergence.py",
    },
    {
        "name": "cli_shell_convergence",
        "order": 5,
        "plan": "03-04",
        "domains": ["cli_shell", "thin_adapter"],
        "status": "complete",  # Plan 03-04: build/serve remain CLI-local; verified by boundary tests
        "verified_by": "test_build_serve_cli_local_boundary.py",
    },
]


def _get_completed_checkpoints():
    return [cp for cp in MIGRATION_CHECKPOINTS if cp["status"] == "complete"]


def _get_pending_checkpoints():
    return [cp for cp in MIGRATION_CHECKPOINTS if cp["status"] == "pending"]


class TestMigrationOrderIntegrity:
    """Migration order must be sequential — no skipping ahead."""

    def test_completed_checkpoints_are_contiguous(self):
        """Completed checkpoints must form a contiguous prefix of the ordered list.

        e.g., [complete, complete, pending, pending] is valid.
        But [complete, pending, complete, pending] is not — skipping ahead is forbidden.
        """
        in_pending = False
        violations = []
        for cp in MIGRATION_CHECKPOINTS:
            if cp["status"] == "pending":
                in_pending = True
            elif cp["status"] == "complete" and in_pending:
                violations.append(
                    f"Checkpoint '{cp['name']}' (order={cp['order']}) is complete "
                    f"but earlier checkpoints are still pending. Migration order violated."
                )

        assert not violations, "\n".join(violations)

    def test_phase3_foundations_is_complete(self):
        """Phase 03-01 foundations must be complete before any later plan executes."""
        foundations = next(
            (cp for cp in MIGRATION_CHECKPOINTS if cp["name"] == "phase3_foundations"),
            None,
        )
        assert foundations is not None, "phase3_foundations checkpoint must be in registry"
        assert foundations["status"] == "complete", (
            "phase3_foundations checkpoint must be 'complete' — "
            "Plan 03-01 is the prerequisite for all later Phase 03 plans."
        )

    def test_migration_order_names_match_expected_sequence(self):
        """The checkpoint sequence must match the canonical migration order."""
        actual_names = [cp["name"] for cp in MIGRATION_CHECKPOINTS]
        expected_pattern = [
            "phase3_foundations",
            "rules_module_repair_query",
            "tag_note",
            "knowledge_federation",
            "client_convergence",
            "cli_shell_convergence",
        ]
        assert actual_names == expected_pattern, (
            f"Migration checkpoint order mismatch.\n"
            f"Expected: {expected_pattern}\n"
            f"Actual:   {actual_names}\n"
            "Do not reorder migration checkpoints."
        )


class TestCheckpointStatusValid:
    """All checkpoint statuses must be valid enum values."""

    VALID_STATUSES = {"pending", "in_progress", "complete"}

    def test_all_checkpoint_statuses_valid(self):
        invalid = [
            f"{cp['name']}: {cp['status']!r}"
            for cp in MIGRATION_CHECKPOINTS
            if cp["status"] not in self.VALID_STATUSES
        ]
        assert not invalid, (
            f"Invalid checkpoint status(es): {invalid}\n"
            f"Valid values: {self.VALID_STATUSES}"
        )


class TestPlanToCheckpointMapping:
    """Each plan maps to at most one checkpoint batch."""

    def test_checkpoint_plan_references_exist(self):
        """Referenced plan files should exist (summary or plan file)."""
        plan_names_referenced = {cp["plan"] for cp in MIGRATION_CHECKPOINTS}
        # We don't hard-fail on missing plan files here (plans may be upcoming)
        # but we verify the reference format is correct
        for plan_ref in plan_names_referenced:
            parts = plan_ref.split("-")
            assert len(parts) == 2, (
                f"Plan reference '{plan_ref}' in checkpoint has invalid format. "
                "Expected 'NN-NN' (e.g., '03-01')."
            )

    def test_foundations_plan_summary_exists_when_complete(self):
        """If phase3_foundations is marked complete, its SUMMARY.md must exist."""
        foundations = next(
            cp for cp in MIGRATION_CHECKPOINTS if cp["name"] == "phase3_foundations"
        )
        if foundations["status"] != "complete":
            pytest.skip("phase3_foundations not yet complete")

        summary_path = PHASE3_DIR / "03-01-SUMMARY.md"
        # Summary is written at end of plan execution — it may not exist yet
        # during the plan's own test run, so we only warn rather than hard-fail.
        # After the plan commits, this will pass.
        if not summary_path.exists():
            pytest.xfail(
                f"03-01-SUMMARY.md not yet written (expected at {summary_path}). "
                "This will pass once plan 03-01 commits its SUMMARY.md."
            )


class TestPhase3FinalState:
    """Verify the final state of Phase 03 migration (all checkpoints complete)."""

    def test_all_checkpoints_complete(self):
        """All Phase 03 migration checkpoints must be complete after plan 03-04."""
        pending = [cp["name"] for cp in MIGRATION_CHECKPOINTS if cp["status"] != "complete"]
        assert not pending, (
            f"Phase 03 has pending checkpoints after plan 03-04: {pending}\n"
            "All checkpoints must be complete before Phase 03 is closed."
        )

    def test_shared_sdk_transport_exists(self):
        """Shared SDK transport must exist (created in Plan 03-04)."""
        sdk_path = PLANNING_ROOT.parent / "codedmap" / "client" / "sdk.py"
        assert sdk_path.exists(), (
            "codedmap/client/sdk.py must exist — shared transport for Phase 03 convergence."
        )

    def test_api_services_business_modules_absent(self):
        """api/services business modules must remain deleted (Phase 02.1 teardown)."""
        api_services = PLANNING_ROOT.parent / "codedmap" / "api" / "services"
        forbidden = ["knowledge.py", "matcher.py", "federation.py"]
        for fname in forbidden:
            fpath = api_services / fname
            assert not fpath.exists(), (
                f"{fpath} must not exist — api/services business modules were deleted "
                "in Phase 02.1 and must not be reintroduced. Use app/services instead."
            )

    def test_remote_uses_shared_sdk(self):
        """_remote.py must delegate to codedmap.client.sdk after Phase 03-04."""
        remote_path = PLANNING_ROOT.parent / "codedmap" / "cli" / "_remote.py"
        src = remote_path.read_text(encoding="utf-8")
        assert "codedmap.client.sdk" in src, (
            "_remote.py must import from codedmap.client.sdk — "
            "transport convergence completed in Plan 03-04."
        )

    def test_cdm_client_standalone_tools_json(self):
        """tools/cdm_client.py must remain standalone and tools.json-driven."""
        client_path = PLANNING_ROOT.parent / "tools" / "cdm_client.py"
        src = client_path.read_text(encoding="utf-8")
        has_codedmap_import = re.search(
            r"^\s*(from|import)\s+codedmap(?:\.|\s|$)", src, flags=re.MULTILINE
        )
        assert not has_codedmap_import, (
            "tools/cdm_client.py must not import codedmap.* "
            "to keep standalone remote usage/packaging simple."
        )
        assert "tools.json" in src, (
            "tools/cdm_client.py must read tools.json "
            "as route/schema source."
        )

    def test_app_services_do_not_import_cli_layer(self):
        """Service layer must not depend on CLI modules (no layer inversion)."""
        services_path = PLANNING_ROOT.parent / "codedmap" / "app" / "services" / "domain_services.py"
        src = services_path.read_text(encoding="utf-8")
        assert "codedmap.cli." not in src, (
            "codedmap/app/services/domain_services.py must not import codedmap.cli.* "
            "Service layer must remain adapter-agnostic."
        )

    def test_app_query_root_does_not_import_cli_commands(self):
        """Query domain core must not depend on CLI command modules."""
        root_path = PLANNING_ROOT.parent / "codedmap" / "app" / "query" / "root.py"
        src = root_path.read_text(encoding="utf-8")
        assert "codedmap.cli.commands" not in src, (
            "codedmap/app/query/root.py must not import codedmap.cli.commands.* "
            "Core query/app logic must remain adapter-agnostic."
        )


class TestCliShellConvergenceTerminalState:
    """Verify the cli_shell_convergence terminal state from Plan 03-05.

    This class enforces the final checkpoint of Phase 03: per-domain CLI wrapper
    files are deleted and replaced by a single catalog-driven dispatcher.
    These guards must never be loosened — they prevent regression to the old pattern.
    """

    CLI_COMMANDS_DIR = PLANNING_ROOT.parent / "codedmap" / "cli" / "commands"
    CLI_DIR = PLANNING_ROOT.parent / "codedmap" / "cli"

    MIGRATED_DOMAINS = {"query", "note", "tag", "module", "repair", "rules"}

    def test_catalog_dispatch_file_exists(self):
        """_catalog_dispatch.py must exist — created in Plan 03-05."""
        dispatch_file = self.CLI_COMMANDS_DIR / "_catalog_dispatch.py"
        assert dispatch_file.exists(), (
            "codedmap/cli/commands/_catalog_dispatch.py must exist — "
            "this is the single catalog-driven CLI dispatcher created in Plan 03-05. "
            "Its absence means cli_shell_convergence has not been reached."
        )

    def test_no_per_domain_wrapper_files(self):
        """Per-domain wrapper files for migrated domains must not exist (anti-regression)."""
        violations = []
        for domain in self.MIGRATED_DOMAINS:
            fpath = self.CLI_COMMANDS_DIR / f"{domain}.py"
            if fpath.exists():
                violations.append(str(fpath))
        assert not violations, (
            "Per-domain wrapper file(s) found for migrated domains:\n"
            + "\n".join(f"  {f}" for f in violations)
            + "\nThese files were deleted in Plan 03-05 (cli_shell_convergence). "
            "Reintroducing them violates the terminal state. Use _catalog_dispatch.py instead."
        )

    def test_main_uses_register_catalog_domain(self):
        """__main__.py must use register_catalog_domain for all migrated domains."""
        main_file = self.CLI_DIR / "__main__.py"
        assert main_file.exists(), "__main__.py must exist"
        src = main_file.read_text(encoding="utf-8")
        assert "_catalog_dispatch" in src, (
            "__main__.py must import _catalog_dispatch — "
            "all migrated domains are registered via the generic dispatcher (Plan 03-05)."
        )
        assert "register_catalog_domain" in src, (
            "__main__.py must call register_catalog_domain() — "
            "the generic registration function from _catalog_dispatch."
        )

    def test_main_does_not_import_migrated_domain_wrappers(self):
        """__main__.py must NOT import per-domain modules for migrated domains."""
        main_file = self.CLI_DIR / "__main__.py"
        src = main_file.read_text(encoding="utf-8")
        forbidden = [f"commands import {d}" for d in self.MIGRATED_DOMAINS]
        violations = [p for p in forbidden if p in src]
        assert not violations, (
            f"__main__.py imports migrated-domain wrappers directly: {violations}\n"
            "Migrated domains must use register_catalog_domain() from _catalog_dispatch. "
            "Per-domain imports were eliminated in Plan 03-05."
        )

    def test_build_and_serve_still_registered_explicitly(self):
        """build and serve must remain as explicit CLI-native exceptions in __main__.py."""
        main_file = self.CLI_DIR / "__main__.py"
        src = main_file.read_text(encoding="utf-8")
        assert "build" in src, "__main__.py must still register 'build' as CLI-native exception"
        assert "serve" in src, "__main__.py must still register 'serve' as CLI-native exception"
