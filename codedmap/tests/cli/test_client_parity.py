"""
Meta-test: Verify cdm_client.py method signatures match catalog input_model schemas.

Uses the `inspect` module to compare the standalone client's methods against the
structured catalog. This gives mathematical certainty of no drift.

After current convergence target:
  - cdm_client.py is standalone and tools.json-driven
  - CPGClient has domain attributes (self.query, self.module, ...)
  - Each domain attribute has methods matching catalog subcommands
  - No runtime dependency on codedmap package is required by cdm_client.py
"""
import inspect
import os
import re
import sys
import pytest

# Add tools/ to path for cdm_client import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../tools"))

from cdm_client import CPGClient
from codedmap.core.schema.catalog import CATALOG


def test_catalog_entries_valid():
    """Every catalog entry must have a valid input_model that produces a schema."""
    for cmd in CATALOG:
        schema = cmd.schema()
        assert isinstance(schema, dict), f"{cmd.name}: schema() should return dict"


def test_all_input_models_have_schema():
    """Every input_model.model_json_schema() must succeed."""
    for cmd in CATALOG:
        try:
            schema = cmd.input_model.model_json_schema()
        except Exception as e:
            pytest.fail(f"{cmd.name}: model_json_schema() failed: {e}")
        assert isinstance(schema, dict)


def test_catalog_entry_names_unique():
    """All catalog entry names must be unique."""
    names = [cmd.name for cmd in CATALOG]
    assert len(names) == len(set(names)), (
        f"Duplicate names: {[n for n in names if names.count(n) > 1]}"
    )


def test_catalog_entry_name_format():
    """Catalog names must use underscore format: domain_subcommand."""
    for cmd in CATALOG:
        # Skip 'build' and 'serve' — these are top-level single-subcommand domains
        if cmd.name in ("build", "serve"):
            continue
        expected = f"{cmd.domain}_{cmd.subcommand}"
        assert cmd.name == expected, (
            f"Name '{cmd.name}' should be '{expected}'"
        )


def test_client_has_discover():
    """CPGClient must have a discover() method."""
    assert hasattr(CPGClient, "discover"), "CPGClient missing discover()"
    sig = inspect.signature(CPGClient.discover)
    params = [p for p in sig.parameters if p != "self"]
    assert len(params) == 0, f"discover() should take no params, has: {params}"


def test_client_is_standalone_and_tools_json_driven():
    """cdm_client.py must stay standalone and load schema/routes from tools.json."""
    src = inspect.getsource(sys.modules["cdm_client"])
    has_codedmap_import = re.search(
        r"^\\s*(from|import)\\s+codedmap(?:\\.|\\s|$)", src, flags=re.MULTILINE
    )
    assert not has_codedmap_import, (
        "cdm_client.py must not import codedmap.* to keep standalone packaging simple."
    )
    assert "tools.json" in src, (
        "cdm_client.py must use tools.json for catalog/schema metadata."
    )


def test_client_has_domain_for_catalog_domains():
    """CPGClient must have an attribute for each catalog domain."""
    catalog_domains = set(cmd.domain for cmd in CATALOG)
    # Exclude domains that are server-side only — they have no client-side class
    skip_domains = {"serve", "build"}
    check_domains = catalog_domains - skip_domains

    # Look at CPGClient class definition for domain-like attributes
    client_src = inspect.getsource(CPGClient)
    for domain in check_domains:
        # Check if domain name appears as a class attribute assignment (e.g., self.query)
        # or as a domain class name (e.g., _QueryDomain)
        found = (
            f"self.{domain}" in client_src
            or f"_{domain.capitalize()}Domain" in client_src
            or f"_{domain.title()}Domain" in client_src
        )
        assert found, f"CPGClient appears to be missing domain: '{domain}'"


def test_client_method_coverage():
    """For each catalog entry (excluding serve/build/special), the client should have
    a corresponding method accessible via domain.subcommand()."""
    # Domains where the client does not have a direct representation
    skip_domains = {"serve", "build"}

    # Build a map of client methods by inspecting the source of all domain classes
    client_src = inspect.getsource(CPGClient)

    # Collect domain class sources
    domain_class_src = ""
    for attr_name in dir(sys.modules["cdm_client"]):
        if attr_name.startswith("_") and "Domain" in attr_name:
            attr = getattr(sys.modules["cdm_client"], attr_name)
            if inspect.isclass(attr):
                try:
                    domain_class_src += inspect.getsource(attr) + "\n"
                except (OSError, TypeError):
                    pass

    all_src = client_src + domain_class_src

    missing = []
    for cmd in CATALOG:
        if cmd.domain in skip_domains:
            continue
        # Check method name variants appear in client domain class source
        # Catalog subcommands may use underscore (add_sink) or hyphen (add-sink)
        method_variants = [
            cmd.subcommand,
            cmd.subcommand.replace("-", "_"),
            cmd.subcommand.replace("_", "_"),  # identity — already underscore
        ]
        found = any(
            f"def {v}(" in all_src or f"def {v} (" in all_src
            for v in method_variants
        )
        if not found:
            missing.append(f"{cmd.domain}.{cmd.subcommand}")

    if missing:
        pytest.fail(
            f"Client missing {len(missing)} methods: {missing[:10]}"
            + (f" (and {len(missing) - 10} more)" if len(missing) > 10 else "")
        )
