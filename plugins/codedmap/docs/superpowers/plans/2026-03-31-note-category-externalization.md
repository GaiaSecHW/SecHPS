# NoteCategory Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `NoteCategory` Enum with YAML-driven cascading configuration so users can customize note categories via `.cpg/rules/note_categories.yaml`.

**Architecture:** New `NoteCategoryLoader` reads SDK built-in categories from `codedmap/rules/common/note_categories.yaml`, merges project-level overrides from `.cpg/rules/note_categories.yaml` (with tombstone support), and exposes results through `RuleRegistry` query methods. `InsightNode.category` becomes a plain `str` validated at the service layer, not the model layer.

**Tech Stack:** Python 3.12+, Pydantic V2, PyYAML, importlib.resources

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `codedmap/rules/common/note_categories.yaml` | SDK built-in note category definitions (6 categories) |
| `codedmap/infra/rules/note_category_loader.py` | Cascading YAML loader: SDK → project overrides → tombstones |
| `tests/infra/rules/test_note_category_loader.py` | Unit tests for loader + registry integration |

### Modified Files

| File | Change |
|------|--------|
| `codedmap/core/schema/graph/nodes/extensions.py` | Delete `NoteCategory` Enum; `InsightNode.category` → `str` |
| `codedmap/core/schema/graph/nodes/__init__.py` | Remove `NoteCategory` from re-exports |
| `codedmap/app/query/note_validation.py` | String keys for `STRICT_NOTE_SCHEMAS`; add `valid_categories` param |
| `codedmap/app/query/models.py` | `InsightSummary.category` → `str`; remove `NoteCategory` import |
| `codedmap/app/query/root.py` | Remove `NoteCategory` comment reference |
| `codedmap/app/services/domain/note.py` | Replace Enum validation with string validation |
| `codedmap/app/services/domain_services.py` | Same as above (duplicate function) |
| `codedmap/api/routers/note.py` | `NoteAddBody.category` → `str`; remove Enum import |
| `codedmap/infra/rules/registry.py` | Add `_note_categories` dict + 3 query methods |
| `codedmap/infra/storage/repository.py` | Replace all `isinstance(x, NoteCategory)` checks with plain string handling |
| `codedmap/analysis/traversal/context.py` | Replace `NoteCategory.VULNERABILITY.value` with `"VULNERABILITY"` |
| `codedmap/analysis/passes/ai/smart_summary.py` | Replace `NoteCategory.VULNERABILITY.value` with `"VULNERABILITY"` |
| `codedmap/analysis/passes/ai/smart_macro.py` | Replace `NoteCategory.CONTROL_FLOW.value` with `"CONTROL_FLOW"` |
| `tests/core/test_note_category.py` | Rewrite for loader + registry testing |

---

### Task 1: Create SDK built-in `note_categories.yaml`

**Files:**
- Create: `codedmap/rules/common/note_categories.yaml`

- [ ] **Step 1: Create the YAML file**

```yaml
version: 2

# SDK built-in note categories.
# Project-level overrides: .cpg/rules/note_categories.yaml

categories:
  - id: note_cat_architecture
    name: ARCHITECTURE
    strict: false

  - id: note_cat_data_flow
    name: DATA_FLOW
    strict: false

  - id: note_cat_control_flow
    name: CONTROL_FLOW
    strict: false

  - id: note_cat_vulnerability
    name: VULNERABILITY
    strict: true

  - id: note_cat_coordination
    name: COORDINATION
    strict: true

  - id: note_cat_security_boundary
    name: SECURITY_BOUNDARY
    strict: true
```

- [ ] **Step 2: Verify the YAML loads correctly**

Run: `python3 -c "import yaml; print(yaml.safe_load(open('codedmap/rules/common/note_categories.yaml')))" `
Expected: Dict with `version: 2` and `categories` list of 6 dicts.

- [ ] **Step 3: Commit**

```bash
git add codedmap/rules/common/note_categories.yaml
git commit -m "feat: add SDK built-in note_categories.yaml"
```

---

### Task 2: Write failing tests for `NoteCategoryLoader`

**Files:**
- Create: `tests/infra/rules/test_note_category_loader.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for NoteCategoryLoader — cascading YAML loader for note categories."""
import sys, os
sys.path.append(os.getcwd())

import pytest
from pathlib import Path
from unittest.mock import patch


def test_load_sdk_categories_returns_6_builtins():
    """SDK YAML has exactly 6 built-in categories."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    assert len(cats) == 6
    names = {c["name"] for c in cats}
    assert names == {
        "ARCHITECTURE", "DATA_FLOW", "CONTROL_FLOW",
        "VULNERABILITY", "COORDINATION", "SECURITY_BOUNDARY",
    }


def test_each_category_has_required_fields():
    """Each category dict has id, name, strict fields."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    for cat in cats:
        assert "id" in cat, f"Missing 'id' in {cat}"
        assert "name" in cat, f"Missing 'name' in {cat}"
        assert "strict" in cat, f"Missing 'strict' in {cat}"


def test_strict_flags_correct():
    """VULNERABILITY, COORDINATION, SECURITY_BOUNDARY are strict; others are not."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load()
    by_name = {c["name"]: c for c in cats}
    assert by_name["VULNERABILITY"]["strict"] is True
    assert by_name["COORDINATION"]["strict"] is True
    assert by_name["SECURITY_BOUNDARY"]["strict"] is True
    assert by_name["ARCHITECTURE"]["strict"] is False
    assert by_name["DATA_FLOW"]["strict"] is False
    assert by_name["CONTROL_FLOW"]["strict"] is False


def test_project_override_adds_category(tmp_path):
    """Project-level YAML adds new categories to SDK builtins."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_perf\n    name: PERFORMANCE\n    strict: false\n"
    )
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    names = {c["name"] for c in cats}
    assert "PERFORMANCE" in names
    assert len(cats) == 7  # 6 SDK + 1 project


def test_project_tombstone_removes_category(tmp_path):
    """Project tombstone removes an SDK built-in category."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        'version: 2\ntombstone:\n  - id: note_cat_control_flow\n    reason: "Not used"\n'
    )
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    names = {c["name"] for c in cats}
    assert "CONTROL_FLOW" not in names
    assert len(cats) == 5


def test_tombstone_without_reason_raises(tmp_path):
    """Tombstone entry missing 'reason' field raises ValueError."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ntombstone:\n  - id: note_cat_control_flow\n"
    )
    loader = NoteCategoryLoader()
    with pytest.raises(ValueError, match="reason"):
        loader.load(project_root=tmp_path)


def test_orphan_tombstone_warns(tmp_path, caplog):
    """Tombstone for non-existent ID logs a warning."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    import logging
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        'version: 2\ntombstone:\n  - id: nonexistent_id\n    reason: "gone"\n'
    )
    loader = NoteCategoryLoader()
    with caplog.at_level(logging.WARNING):
        cats = loader.load(project_root=tmp_path)
    assert len(cats) == 6  # unchanged
    assert "nonexistent_id" in caplog.text


def test_duplicate_category_name_raises(tmp_path):
    """Adding a category with a name that already exists raises ValueError."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_dup\n    name: ARCHITECTURE\n    strict: false\n"
    )
    loader = NoteCategoryLoader()
    with pytest.raises(ValueError, match="[Dd]uplicate"):
        loader.load(project_root=tmp_path)


def test_no_project_dir_returns_sdk_only(tmp_path):
    """When .cpg/rules/ doesn't exist, returns SDK categories only."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=tmp_path)
    assert len(cats) == 6


def test_load_with_none_project_root():
    """load(project_root=None) returns SDK categories only."""
    from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
    loader = NoteCategoryLoader()
    cats = loader.load(project_root=None)
    assert len(cats) == 6
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/infra/rules/test_note_category_loader.py -v`
Expected: All tests FAIL with `ModuleNotFoundError: No module named 'codedmap.infra.rules.note_category_loader'`

- [ ] **Step 3: Commit**

```bash
git add tests/infra/rules/test_note_category_loader.py
git commit -m "test: add failing tests for NoteCategoryLoader"
```

---

### Task 3: Implement `NoteCategoryLoader`

**Files:**
- Create: `codedmap/infra/rules/note_category_loader.py`

- [ ] **Step 1: Write the loader implementation**

```python
"""NoteCategoryLoader: cascading YAML loader for note categories.

Load order:
  1. SDK built-in (codedmap/rules/common/note_categories.yaml)
  2. Project overrides (.cpg/rules/note_categories.yaml)
  3. Validate: no duplicate names after merge
  4. Apply tombstones (require reason field)

Independent of CascadingRuleLoader — note categories have no language dimension.
"""
from __future__ import annotations

import importlib.resources as resources
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

logger = logging.getLogger(__name__)


class NoteCategoryLoader:
    """Cascading loader for note categories: SDK -> project overrides."""

    SDK_PACKAGE = "codedmap.rules.common"
    SDK_FILE = "note_categories.yaml"
    PROJECT_FILE = "note_categories.yaml"

    def load(self, project_root: Optional[Path] = None) -> List[Dict]:
        """Load SDK + project note categories with tombstone resolution.

        Returns list of category dicts: [{id, name, strict}, ...]
        """
        categories = self._load_sdk()
        tombstones: List[Dict] = []

        if project_root is not None:
            proj_cats, proj_tombstones = self._load_project(project_root)
            categories.extend(proj_cats)
            tombstones.extend(proj_tombstones)

        self._validate_no_duplicates(categories)
        categories = self._apply_tombstones(categories, tombstones)
        return categories

    def _load_sdk(self) -> List[Dict]:
        """Load built-in categories from SDK package."""
        pkg = resources.files(self.SDK_PACKAGE)
        text = (pkg / self.SDK_FILE).read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        return list(data.get("categories", []))

    def _load_project(self, project_root: Path) -> Tuple[List[Dict], List[Dict]]:
        """Load project overrides. Returns (new_categories, tombstones)."""
        rules_path = project_root / ".cpg" / "rules" / self.PROJECT_FILE
        if not rules_path.is_file():
            return [], []

        text = rules_path.read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        if not data:
            return [], []

        categories = list(data.get("categories", []))
        tombstones = list(data.get("tombstone", []))
        return categories, tombstones

    def _validate_no_duplicates(self, categories: List[Dict]) -> None:
        """Raise ValueError if any two categories share the same name."""
        seen: Dict[str, str] = {}  # name -> id
        for cat in categories:
            name = cat["name"]
            if name in seen:
                raise ValueError(
                    f"Duplicate note category name '{name}': "
                    f"defined by '{seen[name]}' and '{cat['id']}'"
                )
            seen[name] = cat["id"]

    def _apply_tombstones(
        self, categories: List[Dict], tombstones: List[Dict]
    ) -> List[Dict]:
        """Remove tombstoned categories. Validates reason field."""
        for ts in tombstones:
            if not ts.get("reason"):
                raise ValueError(
                    f"Tombstone for '{ts.get('id')}' is missing required 'reason' field"
                )

        tombstone_ids = {ts["id"] for ts in tombstones}
        result = []
        matched_ids = set()
        for cat in categories:
            if cat["id"] in tombstone_ids:
                matched_ids.add(cat["id"])
            else:
                result.append(cat)

        orphans = tombstone_ids - matched_ids
        for orphan_id in orphans:
            logger.warning("Orphan tombstone: no note category with id %r found", orphan_id)

        return result
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `python3 -m pytest tests/infra/rules/test_note_category_loader.py -v`
Expected: All 10 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add codedmap/infra/rules/note_category_loader.py
git commit -m "feat: implement NoteCategoryLoader with cascading YAML support"
```

---

### Task 4: Integrate `NoteCategoryLoader` into `RuleRegistry`

**Files:**
- Modify: `codedmap/infra/rules/registry.py`
- Create: `tests/infra/rules/test_registry_note_categories.py`

- [ ] **Step 1: Write failing tests for registry integration**

Create `tests/infra/rules/test_registry_note_categories.py`:

```python
"""Tests for RuleRegistry note category integration."""
import sys, os
sys.path.append(os.getcwd())

import pytest


def test_registry_loads_note_categories():
    """RuleRegistry.get_note_categories() returns 6 SDK categories after load()."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    cats = reg.get_note_categories()
    assert len(cats) == 6
    assert "VULNERABILITY" in cats
    assert "ARCHITECTURE" in cats


def test_registry_is_valid_note_category():
    """is_valid_note_category returns True for SDK categories, False for unknown."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    assert reg.is_valid_note_category("VULNERABILITY") is True
    assert reg.is_valid_note_category("NONEXISTENT") is False


def test_registry_is_strict_note_category():
    """is_strict_note_category returns True for VULNERABILITY, False for ARCHITECTURE."""
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry()
    reg.load()
    assert reg.is_strict_note_category("VULNERABILITY") is True
    assert reg.is_strict_note_category("ARCHITECTURE") is False
    assert reg.is_strict_note_category("NONEXISTENT") is False


def test_registry_note_categories_with_project_root(tmp_path):
    """RuleRegistry with project_root loads project overrides."""
    rules_dir = tmp_path / ".cpg" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "note_categories.yaml").write_text(
        "version: 2\ncategories:\n  - id: note_cat_perf\n    name: PERFORMANCE\n    strict: false\n"
    )
    from codedmap.infra.rules.registry import RuleRegistry
    reg = RuleRegistry(project_root=tmp_path)
    reg.load()
    assert reg.is_valid_note_category("PERFORMANCE") is True
    assert len(reg.get_note_categories()) == 7
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/infra/rules/test_registry_note_categories.py -v`
Expected: FAIL — `RuleRegistry` has no `get_note_categories` method yet.

- [ ] **Step 3: Add note category support to `RuleRegistry`**

In `codedmap/infra/rules/registry.py`, add import at the top:

```python
from codedmap.infra.rules.note_category_loader import NoteCategoryLoader
```

In `__init__`, add:

```python
self._note_categories: Dict[str, Dict] = {}  # name -> {id, name, strict}
```

In `load()`, add `self._load_note_categories()` after `self._loaded = True` is set (but before the return). Actually, add it right before `self._loaded = True`:

```python
    def load(self, lang: str = "c", project_rules: Optional[List[Dict]] = None) -> "RuleRegistry":
        """Load SDK rules via CascadingRuleLoader and merge project rules. Idempotent."""
        if self._loaded:
            return self
        loader = CascadingRuleLoader()
        raw = loader.load_all(lang=lang, project_rules=project_rules or [])
        self._populate_from_raw(raw)
        if self._project_root is not None:
            self._load_project_filesystem()
        self._load_note_categories()
        self._loaded = True
        return self
```

Add the new methods at the end of the class (before `_check_version`):

```python
    def _load_note_categories(self) -> None:
        """Load note categories via NoteCategoryLoader."""
        loader = NoteCategoryLoader()
        cats = loader.load(project_root=self._project_root)
        self._note_categories = {c["name"]: c for c in cats}

    def is_valid_note_category(self, name: str) -> bool:
        """Check if a category name is in the loaded note categories."""
        self._ensure_loaded()
        return name in self._note_categories

    def get_note_categories(self) -> List[str]:
        """Return all valid note category names."""
        self._ensure_loaded()
        return list(self._note_categories.keys())

    def is_strict_note_category(self, name: str) -> bool:
        """Check if a category requires JSON schema validation."""
        self._ensure_loaded()
        cat = self._note_categories.get(name)
        return cat is not None and cat.get("strict", False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/infra/rules/test_registry_note_categories.py tests/infra/rules/test_note_category_loader.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/infra/rules/test_registry_note_categories.py codedmap/infra/rules/registry.py
git commit -m "feat: integrate NoteCategoryLoader into RuleRegistry"
```

---

### Task 5: Remove `NoteCategory` Enum and update data model

**Files:**
- Modify: `codedmap/core/schema/graph/nodes/extensions.py`
- Modify: `codedmap/core/schema/graph/nodes/__init__.py`

- [ ] **Step 1: Remove `NoteCategory` Enum from `extensions.py`**

In `codedmap/core/schema/graph/nodes/extensions.py`:

Remove the `NoteCategory` class entirely (lines 12-29) and remove `from enum import Enum` from imports.

Change `InsightNode.category` from `NoteCategory` to `str`:

```python
# codedmap/core/schema/graph/nodes/extensions.py
# AI/vector extensions

from typing import Optional, List
from pydantic import Field, field_validator

from ..base import CPGNode
from ..enums import NodeLabel


class InsightNode(CPGNode):
    """AI insight / audit note node."""
    label: NodeLabel = NodeLabel.INSIGHT
    category: str = Field(..., description="The domain/aspect of this insight")
    title: str = Field(..., max_length=120, description="Short human-readable title (max 120 chars)")
    content: str = Field(..., description="Detailed analysis content (Markdown)")
    source: str = Field(default="unknown", description="Origin of this insight (pass name, agent, user)")
    confidence: Optional[float] = Field(default=None, ge=0, le=1.0, description="Confidence score 0-1")
    status: str = Field(default="active", description="Lifecycle status (active, archived, superseded)")
    created_at: Optional[str] = Field(default=None, description="ISO-8601 creation timestamp")
    updated_at: Optional[str] = Field(default=None, description="ISO-8601 last update timestamp")

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v):
        if isinstance(v, str):
            v = v.strip().upper()
        return v


class EmbeddingChunkNode(CPGNode):
    """语义向量分块节点。"""
    label: NodeLabel = NodeLabel.EMBEDDING_CHUNK
    content: str = Field(..., description="The source_code content of this chunk")
    chunk_index: int = Field(default=0)
    source: str = Field(default="unknown", description="Origin source name")


class VectorNode(CPGNode):
    """专门存储向量的节点，用于冷热分离。"""
    embedding: List[float] = Field(..., description="The vector payload")
    model_version: str = Field(default="v1", description="Model used")
    label: NodeLabel = NodeLabel.VECTOR
```

- [ ] **Step 2: Remove `NoteCategory` from `__init__.py` re-exports**

In `codedmap/core/schema/graph/nodes/__init__.py`:

Change the extensions import line from:
```python
from .extensions import VectorNode, EmbeddingChunkNode, InsightNode, NoteCategory
```
to:
```python
from .extensions import VectorNode, EmbeddingChunkNode, InsightNode
```

Remove `"NoteCategory"` from the `__all__` list (line 48).

- [ ] **Step 3: Run a quick smoke test**

Run: `python3 -c "from codedmap.core.schema.graph.nodes.extensions import InsightNode; n = InsightNode(category='vulnerability', title='t', content='c'); print(n.category)"`
Expected: `VULNERABILITY`

- [ ] **Step 4: Commit**

```bash
git add codedmap/core/schema/graph/nodes/extensions.py codedmap/core/schema/graph/nodes/__init__.py
git commit -m "refactor: remove NoteCategory Enum, InsightNode.category is now str"
```

---

### Task 6: Update `note_validation.py` — string keys and `valid_categories` param

**Files:**
- Modify: `codedmap/app/query/note_validation.py`

- [ ] **Step 1: Update the module**

Replace the import and `STRICT_NOTE_SCHEMAS` dict, and update `validate_and_canonicalize_note_content`:

Remove the import line:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Change `STRICT_NOTE_SCHEMAS` from:
```python
STRICT_NOTE_SCHEMAS: Dict[NoteCategory, Type[BaseModel]] = {
    NoteCategory.VULNERABILITY: VulnerabilityNoteContent,
    NoteCategory.COORDINATION: CoordinationNoteContent,
    NoteCategory.SECURITY_BOUNDARY: SecurityBoundaryNoteContent,
}
```
to:
```python
STRICT_NOTE_SCHEMAS: Dict[str, Type[BaseModel]] = {
    "VULNERABILITY": VulnerabilityNoteContent,
    "COORDINATION": CoordinationNoteContent,
    "SECURITY_BOUNDARY": SecurityBoundaryNoteContent,
}
"""Registry mapping strict category name strings to their Pydantic validation models."""
```

Change the `validate_and_canonicalize_note_content` function signature from:
```python
def validate_and_canonicalize_note_content(
    category: Union[str, NoteCategory],
    content: str,
) -> str:
```
to:
```python
def validate_and_canonicalize_note_content(
    category: str,
    content: str,
    valid_categories: Optional[Set[str]] = None,
) -> str:
```

Add `Set` to the typing imports:
```python
from typing import Any, Dict, List, Literal, Optional, Set, Type, Union
```

Replace the entire body of `validate_and_canonicalize_note_content` with:

```python
    """Validate and canonicalize note content based on category.

    For strict categories (VULNERABILITY, COORDINATION, SECURITY_BOUNDARY):
        - Parses JSON and validates against the registered Pydantic schema.
        - Returns canonical compact JSON via model_dump_json().
        - Raises NoteSchemaValidationError on validation failure or JSON parse error.

    For non-strict categories:
        - Returns content unchanged.

    Args:
        category: Note category string (case-insensitive).
        content: Raw note content string.
        valid_categories: If provided, validates category is in this set.
            Service layer passes set(registry.get_note_categories()) here.
            When None, skips membership check (useful for unit tests).

    Returns:
        Canonical JSON string for strict categories; original content for non-strict.

    Raises:
        NoteSchemaValidationError: If category is strict and content fails schema validation.
        ValueError: If category is not in valid_categories (when provided).
    """
    norm_category = category.strip().upper()

    if valid_categories is not None and norm_category not in valid_categories:
        raise ValueError(
            f"Invalid note category: {category!r}. "
            f"Valid values: {sorted(valid_categories)}"
        )

    # Check if category requires strict validation
    schema_cls = STRICT_NOTE_SCHEMAS.get(norm_category)
    if schema_cls is None:
        # Non-strict: pass through unchanged
        return content

    # Strict validation
    try:
        model = schema_cls.model_validate_json(content, strict=True)
        return model.model_dump_json()
    except ValidationError as exc:
        raw_excerpt = content[:200]
        validation_errors = [
            {
                "loc": list(err["loc"]),
                "msg": err["msg"],
                "type": err["type"],
            }
            for err in exc.errors()
        ]
        raise NoteSchemaValidationError(
            message=(
                f"Content for category {norm_category!r} failed schema validation: "
                f"{len(validation_errors)} error(s)"
            ),
            details={
                "category": norm_category,
                "expected_schema": schema_cls.model_json_schema(),
                "validation_errors": validation_errors,
                "raw_content_excerpt": raw_excerpt,
            },
        ) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raw_excerpt = content[:200]
        raise NoteSchemaValidationError(
            message=(
                f"Content for category {norm_category!r} is not valid JSON: {exc}"
            ),
            details={
                "category": norm_category,
                "expected_schema": schema_cls.model_json_schema(),
                "validation_errors": [
                    {"loc": [], "msg": str(exc), "type": "json_invalid"}
                ],
                "raw_content_excerpt": raw_excerpt,
            },
        ) from exc
```

- [ ] **Step 2: Run existing validation tests**

Run: `python3 -m pytest tests/ -k "note_validation" -v`
Expected: PASS (or some tests may need adaptation — fix inline).

- [ ] **Step 3: Commit**

```bash
git add codedmap/app/query/note_validation.py
git commit -m "refactor: note_validation uses string keys and optional valid_categories param"
```

---

### Task 7: Update `InsightSummary` DTO in `models.py`

**Files:**
- Modify: `codedmap/app/query/models.py`

- [ ] **Step 1: Replace NoteCategory with str**

Remove the import:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Change `InsightSummary.category` from:
```python
    category: NoteCategory
```
to:
```python
    category: str
```

- [ ] **Step 2: Run smoke test**

Run: `python3 -c "from codedmap.app.query.models import InsightSummary; s = InsightSummary(category='DATA_FLOW', title='t', content='c'); print(s.category)"`
Expected: `DATA_FLOW`

- [ ] **Step 3: Commit**

```bash
git add codedmap/app/query/models.py
git commit -m "refactor: InsightSummary.category is now str"
```

---

### Task 8: Update `repository.py` — remove all NoteCategory isinstance checks

**Files:**
- Modify: `codedmap/infra/storage/repository.py`

- [ ] **Step 1: Remove the NoteCategory import**

Remove this line (line 10):
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

- [ ] **Step 2: Replace all `isinstance(x, NoteCategory)` patterns**

There are 7 locations in the `InsightRepository` class where `isinstance(category, NoteCategory)` is used to extract `.value`. Since `category` is now always a `str`, replace each pattern.

In `find_by_category` (around line 323-326), change from:
```python
    def find_by_category(self, category: Union[str, NoteCategory], limit: int = 100) -> List[InsightNode]:
        """按类别查找 (e.g., 'VULNERABILITY', NoteCategory.VULNERABILITY)"""
        if isinstance(category, NoteCategory):
            category = category.value
```
to:
```python
    def find_by_category(self, category: str, limit: int = 100) -> List[InsightNode]:
        """按类别查找 (e.g., 'VULNERABILITY')"""
```

In `find_all_insights` (around line 332-337), change from:
```python
    def find_all_insights(self, category: Optional[Union[str, NoteCategory]] = None, limit: int = 500) -> List[InsightNode]:
        """List all insights across the graph, optionally filtered by category."""
        query = self.source.all_nodes(self.label)
        if category:
            if isinstance(category, NoteCategory):
                category = category.value
            query = query.filter(category=category)
```
to:
```python
    def find_all_insights(self, category: Optional[str] = None, limit: int = 500) -> List[InsightNode]:
        """List all insights across the graph, optionally filtered by category."""
        query = self.source.all_nodes(self.label)
        if category:
            query = query.filter(category=category)
```

In `get_attached_insights` (around line 341-351), change from:
```python
    def get_attached_insights(self, node_id: int, category: Optional[Union[str, NoteCategory]] = None) -> List[InsightNode]:
```
and remove the isinstance check inside. To:
```python
    def get_attached_insights(self, node_id: int, category: Optional[str] = None) -> List[InsightNode]:
```
And remove the 2-line isinstance block inside it.

In `create_and_attach` (around line 358-403), change the signature:
```python
    def create_and_attach(self,
                          host_nodes: Optional[Union[int, List[int]]] = None,
                          category: Union[str, NoteCategory] = None,
```
to:
```python
    def create_and_attach(self,
                          host_nodes: Optional[Union[int, List[int]]] = None,
                          category: str = None,
```

And replace the normalization block (lines 400-403):
```python
        if isinstance(category, NoteCategory):
            category_lower = category.value.lower()
        else:
            category_lower = str(category).lower()
```
with:
```python
        category_lower = str(category).lower()
```

In `upsert` (around line 540-583), change the signature:
```python
    def upsert(
        self,
        host_ids: Optional[Union[int, List[int]]] = None,
        category: Union[str, NoteCategory] = None,
```
to:
```python
    def upsert(
        self,
        host_ids: Optional[Union[int, List[int]]] = None,
        category: str = None,
```

And replace the normalization block (lines 566-569):
```python
        if isinstance(category, NoteCategory):
            category_str = category.value
        else:
            category_str = str(category).strip().upper()
```
with:
```python
        category_str = str(category).strip().upper()
```

And replace the comparison block (lines 581-582):
```python
            if isinstance(insight_cat, NoteCategory):
                insight_cat = insight_cat.value
```
with nothing (just remove these 2 lines). The `str(insight_cat).upper()` comparison on line 583 still works.

- [ ] **Step 3: Run tests**

Run: `python3 -m pytest tests/ -k "insight or note" -v --tb=short`
Expected: Tests pass (some may need updating in later tasks).

- [ ] **Step 4: Commit**

```bash
git add codedmap/infra/storage/repository.py
git commit -m "refactor: remove NoteCategory isinstance checks from InsightRepository"
```

---

### Task 9: Update service layer — `domain/note.py` and `domain_services.py`

**Files:**
- Modify: `codedmap/app/services/domain/note.py`
- Modify: `codedmap/app/services/domain_services.py`

- [ ] **Step 1: Update `domain/note.py`**

In `codedmap/app/services/domain/note.py`, in the `note_add` function, replace the NoteCategory validation block (lines 37-47):

```python
    from codedmap.app.query.root import CPG
    from codedmap.core.schema.graph.nodes.extensions import NoteCategory

    cat_value = category.upper() if isinstance(category, str) else category
    try:
        cat_enum = NoteCategory(cat_value)
    except ValueError:
        valid = [c.value for c in NoteCategory]
        raise ValueError(
            f"Invalid note category '{category}'. Valid: {valid}"
        )
```

with:

```python
    from codedmap.app.query.root import CPG

    cat_value = category.upper() if isinstance(category, str) else str(category).upper()
```

And change the `cpg.set_summary` call to pass `cat_value` instead of `cat_enum`:
```python
    cpg = CPG(store)
    summary = cpg.set_summary(
        node_ids=node_ids,
        title=title,
        content=content,
        category=cat_value,
        source=source,
        confidence=confidence,
        created_by=created_by,
    )
```

- [ ] **Step 2: Update `domain_services.py`**

In `codedmap/app/services/domain_services.py`, find the `note_add` function (around line 1590) and apply the exact same change as Step 1. Replace the Enum validation block (lines 1610-1619):

```python
    from codedmap.core.schema.graph.nodes.extensions import NoteCategory

    cat_value = category.upper() if isinstance(category, str) else category
    try:
        cat_enum = NoteCategory(cat_value)
    except ValueError:
        valid = [c.value for c in NoteCategory]
        raise ValueError(
            f"Invalid note category '{category}'. Valid: {valid}"
        )
```

with:

```python
    cat_value = category.upper() if isinstance(category, str) else str(category).upper()
```

And change the `cpg.set_summary` call to pass `cat_value` instead of `cat_enum`.

- [ ] **Step 3: Run tests**

Run: `python3 -m pytest tests/ -k "note" -v --tb=short`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add codedmap/app/services/domain/note.py codedmap/app/services/domain_services.py
git commit -m "refactor: replace NoteCategory Enum validation with plain string in service layer"
```

---

### Task 10: Update API router — `api/routers/note.py`

**Files:**
- Modify: `codedmap/api/routers/note.py`

- [ ] **Step 1: Remove Enum import and update request body**

Remove the import:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Change `NoteAddBody.category` from:
```python
    category: NoteCategory = NoteCategory.COORDINATION
```
to:
```python
    category: str = "COORDINATION"
```

In the `note_add` endpoint, simplify the category passing (line 65). Change:
```python
                category=body.category.value if hasattr(body.category, "value") else body.category,
```
to:
```python
                category=body.category,
```

- [ ] **Step 2: Run server smoke test**

Run: `python3 -c "from codedmap.api.routers.note import NoteAddBody; b = NoteAddBody(title='t', content='c'); print(b.category)"`
Expected: `COORDINATION`

- [ ] **Step 3: Commit**

```bash
git add codedmap/api/routers/note.py
git commit -m "refactor: API NoteAddBody.category is now str, remove NoteCategory import"
```

---

### Task 11: Update analysis modules — replace `NoteCategory.X.value` with string literals

**Files:**
- Modify: `codedmap/analysis/traversal/context.py`
- Modify: `codedmap/analysis/passes/ai/smart_summary.py`
- Modify: `codedmap/analysis/passes/ai/smart_macro.py`

- [ ] **Step 1: Update `context.py`**

Remove the import:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Replace all `NoteCategory.VULNERABILITY.value` with `"VULNERABILITY"`. There are 3 occurrences:

Line 97: `category=NoteCategory.VULNERABILITY.value` → `category="VULNERABILITY"`
Line 208: `category: str = NoteCategory.VULNERABILITY.value` → `category: str = "VULNERABILITY"`
Line 254: `.filter(category=NoteCategory.VULNERABILITY.value)` → `.filter(category="VULNERABILITY")`

- [ ] **Step 2: Update `smart_summary.py`**

Remove the import:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Replace both occurrences:

Line 199: `category=NoteCategory.VULNERABILITY.value` → `category="VULNERABILITY"`
Line 220: `category=NoteCategory.VULNERABILITY.value` → `category="VULNERABILITY"`

- [ ] **Step 3: Update `smart_macro.py`**

Remove the import:
```python
from codedmap.core.schema.graph.nodes.extensions import NoteCategory
```

Replace:

Line 167: `category=NoteCategory.CONTROL_FLOW.value` → `category="CONTROL_FLOW"`

- [ ] **Step 4: Update `root.py` comment**

In `codedmap/app/query/root.py`, line 522 has a comment `# 6. Notes — global insight count + NoteCategory breakdown`. Change it to `# 6. Notes — global insight count + category breakdown`.

Also check line 533 for `.value` usage: `cat.value if hasattr(cat, "value") else str(cat)`. Change to just `str(cat)`:
```python
                    cat_str = str(cat)
```

- [ ] **Step 5: Run full test suite**

Run: `python3 -m pytest tests/ --tb=short -q`
Expected: All tests pass (except `tests/core/test_note_category.py` which we rewrite next).

- [ ] **Step 6: Commit**

```bash
git add codedmap/analysis/traversal/context.py codedmap/analysis/passes/ai/smart_summary.py codedmap/analysis/passes/ai/smart_macro.py codedmap/app/query/root.py
git commit -m "refactor: replace NoteCategory.X.value with string literals across analysis modules"
```

---

### Task 12: Rewrite `test_note_category.py` for new architecture

**Files:**
- Modify: `tests/core/test_note_category.py`

- [ ] **Step 1: Rewrite the test file**

```python
"""Tests for note category externalization.

Validates:
- InsightNode accepts any uppercase string as category
- InsightNode normalizes lowercase/whitespace
- InsightSummary.category is str
- NoteCategoryLoader returns correct SDK categories
- RuleRegistry note category query methods
"""
import sys, os
sys.path.append(os.getcwd())

import pytest


def test_insight_node_accepts_string_category():
    """InsightNode(category='VULNERABILITY') stores as uppercase str."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="VULNERABILITY", title="t", content="c", source="s")
    assert node.category == "VULNERABILITY"
    assert isinstance(node.category, str)


def test_insight_node_normalizes_lowercase_category():
    """InsightNode(category='vulnerability') normalizes to 'VULNERABILITY'."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="vulnerability", title="t", content="c", source="s")
    assert node.category == "VULNERABILITY"


def test_insight_node_normalizes_whitespace_category():
    """InsightNode(category='  ARCHITECTURE  ') strips whitespace."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="  ARCHITECTURE  ", title="t", content="c", source="s")
    assert node.category == "ARCHITECTURE"


def test_insight_node_accepts_custom_category():
    """InsightNode accepts any string — validation happens at service layer."""
    from codedmap.core.schema.graph.nodes.extensions import InsightNode
    node = InsightNode(category="PERFORMANCE", title="t", content="c", source="s")
    assert node.category == "PERFORMANCE"


def test_insight_summary_category_is_str():
    """InsightSummary(category='data_flow') normalizes to 'DATA_FLOW' as str."""
    from codedmap.app.query.models import InsightSummary
    s = InsightSummary(category="data_flow", title="t", content="c")
    assert s.category == "DATA_FLOW"
    assert isinstance(s.category, str)


def test_note_category_enum_no_longer_exists():
    """NoteCategory Enum has been removed from extensions module."""
    import codedmap.core.schema.graph.nodes.extensions as ext
    assert not hasattr(ext, "NoteCategory")


def test_note_category_not_in_nodes_init():
    """NoteCategory is not re-exported from nodes/__init__.py."""
    from codedmap.core.schema.graph import nodes
    assert "NoteCategory" not in dir(nodes)
```

- [ ] **Step 2: Run tests**

Run: `python3 -m pytest tests/core/test_note_category.py -v`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/core/test_note_category.py
git commit -m "test: rewrite test_note_category for externalized str-based categories"
```

---

### Task 13: Update `docs/NOTE_SYSTEM.md`

**Files:**
- Modify: `docs/NOTE_SYSTEM.md`

- [ ] **Step 1: Update the documentation**

In `docs/NOTE_SYSTEM.md`, replace the `NoteCategory` Enum code block (lines 53-60):

```python
class NoteCategory(str, Enum):
    ARCHITECTURE = "ARCHITECTURE"
    DATA_FLOW = "DATA_FLOW"
    CONTROL_FLOW = "CONTROL_FLOW"
    VULNERABILITY = "VULNERABILITY"
    COORDINATION = "COORDINATION"
    SECURITY_BOUNDARY = "SECURITY_BOUNDARY"
```

with:

```
Note categories are defined in YAML and loaded via `NoteCategoryLoader`:
- SDK built-in: `codedmap/rules/common/note_categories.yaml`
- Project overrides: `.cpg/rules/note_categories.yaml`

SDK built-in categories: ARCHITECTURE, DATA_FLOW, CONTROL_FLOW,
VULNERABILITY, COORDINATION, SECURITY_BOUNDARY.

Users can add custom categories (non-strict) or tombstone built-in ones
via their project's `.cpg/rules/note_categories.yaml`.
```

Update the `InsightNode` code block to show `category: str` instead of `category: NoteCategory`.

- [ ] **Step 2: Commit**

```bash
git add docs/NOTE_SYSTEM.md
git commit -m "docs: update NOTE_SYSTEM.md for externalized note categories"
```

---

### Task 14: Run full test suite and verify

- [ ] **Step 1: Run full test suite**

Run: `python3 -m pytest tests/ -v --tb=short 2>&1 | tail -30`
Expected: All tests pass. No `NoteCategory` import errors.

- [ ] **Step 2: Grep for stale NoteCategory references**

Run: `grep -rn "NoteCategory" codedmap/ tests/ --include="*.py" | grep -v "__pycache__"`
Expected: No results (all references removed).

- [ ] **Step 3: Verify YAML loads in isolation**

Run: `python3 -c "from codedmap.infra.rules.note_category_loader import NoteCategoryLoader; cats = NoteCategoryLoader().load(); print(f'{len(cats)} categories: {[c[\"name\"] for c in cats]}')" `
Expected: `6 categories: ['ARCHITECTURE', 'DATA_FLOW', 'CONTROL_FLOW', 'VULNERABILITY', 'COORDINATION', 'SECURITY_BOUNDARY']`

- [ ] **Step 4: Verify registry integration**

Run: `python3 -c "from codedmap.infra.rules.registry import RuleRegistry; r = RuleRegistry(); r.load(); print(r.get_note_categories()); print('strict VULN:', r.is_strict_note_category('VULNERABILITY')); print('strict ARCH:', r.is_strict_note_category('ARCHITECTURE'))"`
Expected:
```
['ARCHITECTURE', 'DATA_FLOW', 'CONTROL_FLOW', 'VULNERABILITY', 'COORDINATION', 'SECURITY_BOUNDARY']
strict VULN: True
strict ARCH: False
```
