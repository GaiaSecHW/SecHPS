# Audit Knowledge Layering MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add note-scoped audit knowledge layering for `scope`, `knowledge_class`, and `campaign_id`, plus workflow campaign context injection.

**Architecture:** Extend `InsightNode` and note DTOs with note metadata stored on the note object, thread filtering through repository and domain services, then inject a per-run `campaign_id` into `tools/audit_workflow.py`. Keep the MVP note-first and avoid tag redesign or audit-log work.

**Tech Stack:** Python, Pydantic, FastAPI, argparse catalog CLI, pytest

---

### Task 1: Lock MVP Contract With Failing Tests

**Files:**
- Create: `tests/app/services/test_note_layering.py`
- Modify: `tests/api/test_note_contract.py`
- Modify: `tests/cli/test_note.py`
- Modify: `tests/tools/test_audit_workflow.py`

- [ ] **Step 1: Write failing note-layering service tests**

```python
def test_note_add_returns_metadata_scope_fields(...):
    ...

def test_note_list_filters_by_scope_and_campaign_id(...):
    ...
```

- [ ] **Step 2: Run note-layering tests to verify failure**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py tests/tools/test_audit_workflow.py -q`
Expected: FAIL because note metadata fields and campaign workflow support do not exist yet.

- [ ] **Step 3: Add parser and router contract tests for new fields**

```python
body = NoteAddBody(title="T", content="C", scope="campaign", knowledge_class="assessment", campaign_id="cmp_1")
assert body.scope == "campaign"
```

- [ ] **Step 4: Add workflow test for campaign context injection**

```python
env = mod.build_subprocess_env(agent, target, campaign_id="cmp_1")
assert env["CPG_CAMPAIGN_ID"] == "cmp_1"
```

- [ ] **Step 5: Run tests again and confirm red state is correct**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py tests/tools/test_audit_workflow.py -q`
Expected: FAIL on missing arguments/fields, not on unrelated import errors.

### Task 2: Implement Note Metadata And Filtering

**Files:**
- Modify: `codedmap/core/schema/graph/nodes/extensions.py`
- Modify: `codedmap/app/query/models.py`
- Modify: `codedmap/infra/storage/repository.py`
- Modify: `codedmap/app/services/domain/note.py`
- Modify: `codedmap/app/services/domain_services.py`
- Modify: `codedmap/core/schema/catalog.py`
- Modify: `codedmap/api/routers/note.py`

- [ ] **Step 1: Extend note schema and DTOs with metadata-aware fields**

```python
metadata: Dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2: Thread scope and campaign filters through repository and services**

```python
def find_all_insights(..., scope: Optional[str] = None, campaign_id: Optional[str] = None, knowledge_class: Optional[str] = None)
```

- [ ] **Step 3: Extend note add/list/show contracts**

```python
class NoteAddInput(BaseModel):
    scope: str = "campaign"
    knowledge_class: str = "assessment"
    campaign_id: Optional[str] = None
    metadata: Optional[str] = None
```

- [ ] **Step 4: Preserve metadata in note add/show/list payloads**

```python
note_data["metadata"] = getattr(node, "metadata", {}) or {}
```

- [ ] **Step 5: Run targeted tests and confirm green**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py tests/cli/test_note_contract_parity.py -q`
Expected: PASS

### Task 3: Inject Campaign Context Into Audit Workflow

**Files:**
- Modify: `tools/audit_workflow.py`
- Modify: `tests/tools/test_audit_workflow.py`

- [ ] **Step 1: Add campaign ID generation and propagation helpers**

```python
def generate_campaign_id(now: datetime | None = None) -> str:
    ...
```

- [ ] **Step 2: Include campaign context in subprocess environment and prompt context**

```python
env["CPG_CAMPAIGN_ID"] = campaign_id
```

- [ ] **Step 3: Ensure workflow prompt tells agents to write run-scoped notes into current campaign**

```python
"Default new audit notes to scope=campaign and campaign_id=<current campaign>."
```

- [ ] **Step 4: Run workflow-focused tests**

Run: `pytest tests/tools/test_audit_workflow.py -q`
Expected: PASS

- [ ] **Step 5: Run combined regression slice**

Run: `pytest tests/app/services/test_note_layering.py tests/api/test_note_contract.py tests/cli/test_note.py tests/cli/test_note_contract_parity.py tests/tools/test_audit_workflow.py -q`
Expected: PASS
