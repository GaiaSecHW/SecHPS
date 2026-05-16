# Audit Knowledge Visibility Handoff

**Date:** 2026-04-08
**Status:** Completed

## Current State

Completed:

- note-layering MVP is implemented
- note metadata supports `scope`, `knowledge_class`, and `campaign_id`
- audit workflow injects per-run `campaign_id`
- note promotion flow is implemented:
  - `campaign -> stable_candidate`
  - `stable_candidate -> stable_confirmed`
- unified default note-read policy is implemented:
  - default visible notes = `stable_confirmed + current_campaign`
  - explicit `scope`, `campaign_id`, and `knowledge_class` filters still take precedence
- current campaign resolution is runtime-backed:
  - `CPG_CAMPAIGN_ID` for API/remote flows
  - `CDM_CAMPAIGN_ID` accepted for local CLI compatibility
- CLI local note execution now forwards layering fields to the service layer:
  - `scope`
  - `knowledge_class`
  - `campaign_id`

Relevant files:

- `codedmap/app/services/domain/note.py`
- `codedmap/app/services/domain/note_visibility.py`
- `codedmap/app/services/domain_services.py`
- `codedmap/app/query/root.py`
- `codedmap/infra/storage/repository.py`
- `codedmap/api/routers/note.py`
- `codedmap/cli/_bootstrap.py`
- `tools/audit_workflow.py`

## Implemented Behavior

When callers do not provide explicit layer filters, note reads now apply a shared visibility policy:

- include `stable_confirmed`
- include `campaign` notes only when `campaign_id == current_campaign_id`
- exclude historical campaign notes by default
- exclude `stable_candidate` by default

When callers do provide any of the following, explicit filtering wins:

- `scope`
- `campaign_id`
- `knowledge_class`

## Verification

Targeted coverage now exists at three levels:

- service-layer tests for default visibility and explicit-filter precedence
- CLI local execution tests proving layering fields are forwarded into the service layer
- API router tests proving `/api/v1/note/list` uses the default visibility policy and preserves explicit filters

Key tests:

- `tests/app/services/test_note_layering.py`
- `tests/cli/test_note.py`
- `tests/api/test_note_router_visibility.py`
