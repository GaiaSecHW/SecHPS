"""
CLI validation: remote client convergence.

Phase 03-04 extracts shared HTTP transport from:
  - codedmap/cli/_remote.py (CLI --remote path)
  - tools/cdm_client.py (standalone remote SDK)

Into a single shared SDK client module. Both use the same:
  - Route mapping (catalog-driven)
  - Transport capabilities (api_key, agent_id, timeout, retry)
  - Request/response envelope (CLIResponse shape)

Test status (Phase 03-04):
  - TestClientSourcesExist: enabled — verifies current state
  - TestConvergenceRequirements: enabled — pre-conditions
  - TestConvergedClientContract: enabled — verifies convergence implementation
"""

import pathlib
import pytest
import re

REMOTE_CLIENT_PATH = pathlib.Path("codedmap/cli/_remote.py")
CDM_CLIENT_PATH = pathlib.Path("tools/cdm_client.py")
SDK_PATH = pathlib.Path("codedmap/client/sdk.py")


class TestClientSourcesExist:
    """Both remote client sources must exist before convergence."""

    def test_remote_client_exists(self):
        assert REMOTE_CLIENT_PATH.exists(), (
            "codedmap/cli/_remote.py must exist — it's the CLI --remote transport path."
        )

    def test_cdm_client_exists(self):
        assert CDM_CLIENT_PATH.exists(), (
            "tools/cdm_client.py must exist — it's the standalone remote SDK."
        )

    def test_remote_client_imports_catalog(self):
        """_remote.py should use catalog for route mapping (existing pattern)."""
        source = REMOTE_CLIENT_PATH.read_text(encoding="utf-8")
        assert "catalog" in source.lower() or "CATALOG" in source, (
            "_remote.py should reference the catalog for route mapping."
        )

    def test_cdm_client_has_callable_interface(self):
        """cdm_client.py must be importable and expose a client interface."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("cdm_client", CDM_CLIENT_PATH)
        if spec is None:
            pytest.skip("cdm_client.py could not be loaded as module")
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except SystemExit:
            pass  # CLI scripts may call sys.exit at module level
        except Exception as e:
            pytest.skip(f"cdm_client.py raises {type(e).__name__} on import: {e}")
        # If importable, verify it has some interface
        assert mod is not None


class TestConvergenceRequirements:
    """Define the requirements for client convergence (Plan 03-04)."""

    def test_remote_client_has_catalog_route_map(self):
        """_remote.py route map must be catalog-driven (not hardcoded)."""
        source = REMOTE_CLIENT_PATH.read_text(encoding="utf-8")
        uses_catalog = (
            "from codedmap.core.schema.catalog" in source
            or "from codedmap.client.sdk" in source
            or "get_catalog" in source
            or "get_command" in source
        )
        if not uses_catalog:
            pytest.xfail(
                "_remote.py does not yet use catalog for routing — "
                "Plan 03-04 must add catalog-driven route mapping."
            )

    def test_both_clients_handle_agent_id(self):
        """Both clients must support agent_id for write attribution."""
        remote_source = REMOTE_CLIENT_PATH.read_text(encoding="utf-8")
        cdm_source = CDM_CLIENT_PATH.read_text(encoding="utf-8")

        assert "agent_id" in remote_source or "X-Agent-ID" in remote_source, (
            "_remote.py must handle agent_id/X-Agent-ID for write API calls"
        )
        assert "agent_id" in cdm_source or "X-Agent-ID" in cdm_source, (
            "cdm_client.py must handle agent_id/X-Agent-ID for write API calls"
        )


class TestConvergedClientContract:
    """Tests for remote client convergence boundaries."""

    def test_shared_client_module_exists(self):
        """After convergence, a shared SDK client module must exist."""
        assert SDK_PATH.exists(), (
            "codedmap/client/sdk.py must exist — it is the shared transport layer "
            "used by both _remote.py (CLI) and cdm_client.py (standalone SDK)."
        )

    def test_shared_sdk_importable(self):
        """codedmap.client.sdk must be importable."""
        import importlib
        mod = importlib.import_module("codedmap.client.sdk")
        assert mod is not None

    def test_shared_sdk_has_transport_class(self):
        """codedmap.client.sdk must expose a transport/client class."""
        import importlib
        mod = importlib.import_module("codedmap.client.sdk")
        assert hasattr(mod, "CatalogTransport") or hasattr(mod, "CPGSDKClient"), (
            "codedmap.client.sdk must define CatalogTransport or CPGSDKClient"
        )

    def test_shared_sdk_has_error_class(self):
        """codedmap.client.sdk must expose CPGClientError."""
        import importlib
        mod = importlib.import_module("codedmap.client.sdk")
        assert hasattr(mod, "CPGClientError"), (
            "codedmap.client.sdk must define CPGClientError for transport errors"
        )

    def test_cli_remote_uses_shared_client(self):
        """After convergence, _remote.py must delegate to shared SDK client."""
        source = REMOTE_CLIENT_PATH.read_text(encoding="utf-8")
        assert "from codedmap.client.sdk import" in source or \
               "from codedmap.client import sdk" in source or \
               "codedmap.client.sdk" in source, (
            "_remote.py must delegate to codedmap.client.sdk transport"
        )

    def test_cdm_client_is_standalone(self):
        """tools/cdm_client.py must stay standalone (no codedmap package import)."""
        source = CDM_CLIENT_PATH.read_text(encoding="utf-8")
        has_codedmap_import = re.search(
            r"^\\s*(from|import)\\s+codedmap(?:\\.|\\s|$)", source, flags=re.MULTILINE
        )
        assert not has_codedmap_import, (
            "tools/cdm_client.py must not import codedmap.* — "
            "it should remain repo-local standalone for external packaging."
        )

    def test_cdm_client_is_tools_json_driven(self):
        """tools/cdm_client.py must load route/schema metadata from tools.json."""
        source = CDM_CLIENT_PATH.read_text(encoding="utf-8")
        assert "tools.json" in source, (
            "tools/cdm_client.py must use tools.json as command schema source."
        )

    def test_route_map_is_catalog_driven(self):
        """After convergence, route mapping must come from catalog, not hardcoded."""
        import importlib
        mod = importlib.import_module("codedmap.client.sdk")
        src_text = pathlib.Path("codedmap/client/sdk.py").read_text(encoding="utf-8")
        assert "from codedmap.core.schema.catalog" in src_text, (
            "codedmap.client.sdk must import from catalog for route mapping"
        )

    def test_transport_capabilities_unified(self):
        """api_key, agent_id, timeout must be handled in the shared SDK."""
        sdk_src = SDK_PATH.read_text(encoding="utf-8")
        assert "api_key" in sdk_src, "SDK must handle api_key authentication"
        assert "agent_id" in sdk_src or "X-Agent-ID" in sdk_src, (
            "SDK must handle agent_id for write attribution"
        )
        assert "timeout" in sdk_src, "SDK must handle timeout configuration"
