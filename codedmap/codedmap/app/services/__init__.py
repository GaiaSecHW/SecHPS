"""
codedmap.app.services — Service layer (business logic SSOT).

This package is the only place where command business logic lives.
Both the API transport layer (FastAPI routers) and the CLI adapter
must delegate to this layer rather than implementing logic directly.

Public surface:
- contracts.py     — typed, transport-agnostic request/response models
- command_executor.py — catalog-driven dispatch boundary
"""
