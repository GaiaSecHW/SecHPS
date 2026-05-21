# Audit Knowledge Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit note promotion and confirmation flows so run-scoped notes can move from `campaign` to `stable_candidate` and then to `stable_confirmed`.

**Architecture:** Keep the feature note-first and current-state oriented. Add two explicit note operations, `promote` and `confirm`, as domain-service transitions that update the existing note in place. Expose them through catalog-driven CLI and thin API routes, and preserve lineage via `promoted_from` while clearing `campaign_id` when a note becomes stable.

**Tech Stack:** Python, Pydantic, FastAPI, argparse catalog CLI, pytest

---

### Task 1: Lock Promotion Flow With Failing Tests

**Files:**
- Modify: `tests/app/services/test_note_layering.py`
- Modify: `tests/api/test_note_contract.py`
- Modify: `tests/cli/test_note.py`

- [ ] **Step 1: Add failing service tests for promote/confirm**

```python
def test_note_promote_transitions_campaign_to_stable_candidate(...):
    ...

def test_note_confirm_transitions_candidate_to_confirmed(...):
    ...
```

- [ ] **Step 2: Add parser and request-body tests**

```python
ns = parser.parse_args(["note", "promote", "123"])
assert ns.note_action == "promote"
```

- [ ] **Step 3: Run targeted tests to confirm red**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py -q`
Expected: FAIL because note promote/confirm contracts do not exist yet.

### Task 2: Implement Service And Storage Transitions

**Files:**
- Modify: `codedmap/app/services/domain/note.py`
- Modify: `codedmap/app/services/domain_services.py`
- Modify: `codedmap/infra/storage/repository.py`

- [ ] **Step 1: Add helper to update note layering state**

```python
def note_promote(store, note_id: int, created_by: str = ...):
    ...
```

- [ ] **Step 2: Promote campaign notes to stable candidates**

```python
scope="stable_candidate"
review_state="ai_supported"
campaign_id=None
promoted_from=<old campaign id>
```

- [ ] **Step 3: Confirm candidate notes to stable confirmed**

```python
scope="stable_confirmed"
review_state="human_confirmed"
campaign_id=None
```

- [ ] **Step 4: Enforce basic state-machine validation**

```python
campaign -> stable_candidate -> stable_confirmed
```

- [ ] **Step 5: Run targeted service tests**

Run: `pytest tests/app/services/test_note_layering.py -q`
Expected: PASS

### Task 3: Expose Promote/Confirm Through Catalog CLI And API

**Files:**
- Modify: `codedmap/core/schema/catalog.py`
- Modify: `codedmap/cli/commands/_catalog_dispatch.py`
- Modify: `codedmap/cli/_bootstrap.py`
- Modify: `codedmap/api/routers/note.py`
- Modify: `tools/cdm_client.py`

- [ ] **Step 1: Add note catalog input models and command definitions**

```python
class NotePromoteInput(BaseModel):
    note_id: str
```

- [ ] **Step 2: Register CLI note promote/confirm subcommands**

```python
_register_command_action(sub, "note", "promote")
_register_command_action(sub, "note", "confirm")
```

- [ ] **Step 3: Wire local executor and API routes**

```python
executor.register("note_promote", ...)
@router.post("/promote")
```

- [ ] **Step 4: Sync standalone client helper methods**

```python
def promote(self, **params): ...
def confirm(self, **params): ...
```

- [ ] **Step 5: Run combined regression slice**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py tests/cli/test_note_contract_parity.py tests/integration/test_cli_api_parity_phase3.py -q`
Expected: PASS
