"""Architecture guard: CLI-API parity contract (Phase 07).

Ensures every API router domain has a corresponding CLI domain registration
and catalog entries, with explicit exceptions for CLI-native and API-native
commands. New violations hard-fail CI.

Per D-08: Strict 1:1 CLI-API parity enforced going forward.
Per D-09: Guard test compares catalog entries vs API routers vs CLI domains.
"""

import pathlib
import sys
import os

sys.path.append(os.getcwd())

import pytest

REPO_ROOT = pathlib.Path(".")


class TestCliApiParityPhase07:
    """Architecture guard: every API endpoint domain must have a CLI equivalent."""

    # Explicit exceptions per D-08
    CLI_NATIVE_DOMAINS = {"build", "serve"}  # CLI-only, no API equivalent
    API_NATIVE_DOMAINS = {"tools", "visualize"}  # API-only, no CLI equivalent

    def test_phase11_build_upload_stays_api_native_within_build_domain(self):
        """Phase 11 upload/status must not create new catalog commands."""
        from codedmap.core.schema.catalog import get_command

        assert get_command("build_upload") is None
        assert get_command("build_upload_status") is None

        client_src = (REPO_ROOT / "tools/cdm_client.py").read_text(encoding="utf-8")
        assert "def upload(" in client_src
        assert '"/api/v1/build/upload"' in client_src
        assert "def status(" in client_src
        assert '"/api/v1/build/status"' in client_src

    def test_federation_in_migrated_domains(self):
        """federation must be registered in MIGRATED_DOMAINS."""
        src = (REPO_ROOT / "codedmap/cli/__main__.py").read_text(encoding="utf-8")
        assert '"federation"' in src or "'federation'" in src, (
            "federation missing from MIGRATED_DOMAINS in __main__.py"
        )

    def test_knowledge_in_migrated_domains(self):
        """knowledge must be registered in MIGRATED_DOMAINS."""
        src = (REPO_ROOT / "codedmap/cli/__main__.py").read_text(encoding="utf-8")
        assert '"knowledge"' in src or "'knowledge'" in src, (
            "knowledge missing from MIGRATED_DOMAINS in __main__.py"
        )

    def test_federation_catalog_entries_exist(self):
        """CATALOG must contain federation_register, federation_link, federation_neighbors."""
        from codedmap.core.schema.catalog import get_command
        for name in ["federation_register", "federation_link", "federation_neighbors"]:
            cmd = get_command(name)
            assert cmd is not None, f"{name} missing from CATALOG"
            assert cmd.domain == "federation", f"{name} domain is {cmd.domain}, expected federation"

    def test_knowledge_catalog_entries_exist(self):
        """CATALOG must contain knowledge_dump, knowledge_project."""
        from codedmap.core.schema.catalog import get_command
        for name in ["knowledge_dump", "knowledge_project"]:
            cmd = get_command(name)
            assert cmd is not None, f"{name} missing from CATALOG"
            assert cmd.domain == "knowledge", f"{name} domain is {cmd.domain}, expected knowledge"

    def test_federation_in_catalog_dispatch_register_fn(self):
        """_REGISTER_FN must contain 'federation' key."""
        src = (REPO_ROOT / "codedmap/cli/commands/_catalog_dispatch.py").read_text(encoding="utf-8")
        assert '"federation"' in src or "'federation'" in src, (
            "federation missing from _REGISTER_FN in _catalog_dispatch.py"
        )

    def test_knowledge_in_catalog_dispatch_register_fn(self):
        """_REGISTER_FN must contain 'knowledge' key."""
        src = (REPO_ROOT / "codedmap/cli/commands/_catalog_dispatch.py").read_text(encoding="utf-8")
        assert '"knowledge"' in src or "'knowledge'" in src, (
            "knowledge missing from _REGISTER_FN in _catalog_dispatch.py"
        )

    def test_federation_executor_handlers_registered(self):
        """_bootstrap.py must register executor handlers for all 3 federation commands."""
        src = (REPO_ROOT / "codedmap/cli/_bootstrap.py").read_text(encoding="utf-8")
        for name in ["federation_register", "federation_link", "federation_neighbors"]:
            assert f'"{name}"' in src or f"'{name}'" in src, (
                f"executor.register('{name}', ...) missing from _bootstrap.py"
            )

    def test_knowledge_executor_handlers_registered(self):
        """_bootstrap.py must register executor handlers for all 2 knowledge commands."""
        src = (REPO_ROOT / "codedmap/cli/_bootstrap.py").read_text(encoding="utf-8")
        for name in ["knowledge_dump", "knowledge_project"]:
            assert f'"{name}"' in src or f"'{name}'" in src, (
                f"executor.register('{name}', ...) missing from _bootstrap.py"
            )

    def test_parity_all_api_router_domains_have_cli(self):
        """Every API router domain in app.py must have CLI coverage or be in API_NATIVE_DOMAINS.

        This is the comprehensive parity check per D-09. It inspects app.py
        for include_router() calls, extracts domain names from router module
        imports, and verifies each has a corresponding MIGRATED_DOMAINS entry
        or CLI-native registration.
        """
        app_src = (REPO_ROOT / "codedmap/api/app.py").read_text(encoding="utf-8")
        main_src = (REPO_ROOT / "codedmap/cli/__main__.py").read_text(encoding="utf-8")

        # Extract API router domains from app.py include_router lines
        # Pattern: from codedmap.api.routers import <domain> or <domain>.router
        import re
        api_domains = set()
        for match in re.finditer(r"include_router\(\s*(\w+)\.router", app_src):
            api_domains.add(match.group(1))
        # Also check for import lines like: from codedmap.api.routers import query, tag, ...
        for match in re.finditer(r"from\s+codedmap\.api\.routers\s+import\s+(.+)", app_src):
            for name in match.group(1).split(","):
                name = name.strip().split(" as ")[0].strip()
                if name:
                    api_domains.add(name)

        assert len(api_domains) > 0, "Could not find any API router domains in app.py"

        # Check each API domain has CLI coverage
        uncovered = []
        for domain in api_domains:
            if domain in self.API_NATIVE_DOMAINS:
                continue
            # Check if it's in MIGRATED_DOMAINS or has a CLI-native registration
            if f'"{domain}"' not in main_src and f"'{domain}'" not in main_src:
                if domain not in self.CLI_NATIVE_DOMAINS:
                    uncovered.append(domain)

        assert not uncovered, (
            f"API router domains without CLI coverage (and not in exceptions): {uncovered}. "
            f"Add to MIGRATED_DOMAINS or CLI_NATIVE_DOMAINS/API_NATIVE_DOMAINS."
        )

    def test_parity_all_cli_domains_have_api(self):
        """Every CLI migrated domain should have an API router or be in CLI_NATIVE_DOMAINS.

        Reverse parity check — ensures CLI domains aren't orphaned from the API.
        """
        from codedmap.core.schema.catalog import CATALOG
        app_src = (REPO_ROOT / "codedmap/api/app.py").read_text(encoding="utf-8")
        main_src = (REPO_ROOT / "codedmap/cli/__main__.py").read_text(encoding="utf-8")

        # Extract MIGRATED_DOMAINS list from source
        import re
        match = re.search(r"MIGRATED_DOMAINS\s*=\s*\[([^\]]+)\]", main_src)
        assert match, "Could not find MIGRATED_DOMAINS in __main__.py"
        migrated = [s.strip().strip("'\"") for s in match.group(1).split(",")]

        uncovered = []
        for domain in migrated:
            if domain in self.CLI_NATIVE_DOMAINS:
                continue
            # Check API has a router for this domain
            if domain not in app_src:
                uncovered.append(domain)

        assert not uncovered, (
            f"CLI domains without API router presence: {uncovered}. "
            f"Add API router or move to CLI_NATIVE_DOMAINS."
        )

    def test_federation_description_not_stale(self):
        """DOMAIN_DESCRIPTIONS['federation'] must not contain 'deferred' or '501'."""
        from codedmap.core.schema.catalog import DOMAIN_DESCRIPTIONS
        desc = DOMAIN_DESCRIPTIONS.get("federation", "")
        assert "deferred" not in desc.lower(), (
            f"Federation description is stale: {desc!r}"
        )
        assert "501" not in desc, (
            f"Federation description still references 501: {desc!r}"
        )
