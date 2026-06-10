# codedmap/client/__init__.py
"""
Shared client transport package for CodeDMap REST API.

Provides catalog-driven routing and unified HTTP transport for both:
  - codedmap/cli/_remote.py (CLI --remote path)
  - tools/cdm_client.py (standalone remote SDK)

Public API:
    CatalogTransport   -- catalog-driven HTTP client
    CPGClientError     -- transport-level error
"""

from codedmap.client.sdk import CatalogTransport, CPGClientError, CPGSDKClient

__all__ = ["CatalogTransport", "CPGClientError", "CPGSDKClient"]
