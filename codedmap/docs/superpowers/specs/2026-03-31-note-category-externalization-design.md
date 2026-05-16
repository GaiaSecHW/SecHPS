# Design: NoteCategory Externalization

> Externalize hardcoded `NoteCategory` Enum to YAML-driven cascading configuration,
> matching the tag system's `.cpg/rules/` override pattern.

---

## Motivation

The `NoteCategory` Enum is hardcoded in Python. Users who receive the SDK cannot
customize note categories without modifying source code. The tag system already
demonstrates a working cascading YAML pattern — note categories should follow suit
for distribution readiness.

## Approach: Independent YAML + Lightweight Loader (Option B)

Note categories are audit-workflow concepts, independent of target language. They
do not need the language dimension that `CascadingRuleLoader` provides. A dedicated
`NoteCategoryLoader` keeps concerns separated while following the same cascade +
tombstone protocol.

---

## 1. Data Model Changes

### Remove `NoteCategory` Enum

Delete `NoteCategory(str, Enum)` from `codedmap/core/schema/graph/nodes/extensions.py`.

### `InsightNode.category` becomes `str`

```python
class InsightNode(CPGNode):
    category: str  # Validated at write-path by registry, not by Pydantic type

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v):
        if isinstance(v, str):
            v = v.strip().upper()
        return v
```

`InsightNode` itself does NOT validate category membership — it accepts any
uppercase string. Validation happens in the service/CLI/API write paths via
`RuleRegistry`.

---

## 2. YAML Definition: `note_categories.yaml`

### SDK Built-in

**File**: `codedmap/rules/common/note_categories.yaml`

```yaml
version: 2

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

### Project Override

**File**: `.cpg/rules/note_categories.yaml` (user's project)

```yaml
version: 2

categories:
  - id: note_cat_performance
    name: PERFORMANCE
    strict: false

tombstone:
  - id: note_cat_control_flow
    reason: "Not used in our audit workflow"
```

### Strict Field Semantics

- `strict: true` is only effective for SDK built-in categories that have a
  registered Pydantic schema in `STRICT_NOTE_SCHEMAS`.
- User-added categories: `strict: true` is ignored (no schema registered),
  degrades to non-strict. This is safe and leaves room for future strict schema
  registration.

---

## 3. Loader: `NoteCategoryLoader`

**File**: `codedmap/infra/rules/note_category_loader.py` (new)

```python
class NoteCategoryLoader:
    """Cascading loader for note categories: SDK -> project overrides."""

    SDK_PACKAGE = "codedmap.rules.common"
    SDK_FILE = "note_categories.yaml"
    PROJECT_FILE = "note_categories.yaml"

    def load(self, project_root: Optional[Path] = None) -> List[Dict]:
        """
        Load order:
          1. SDK built-in (rules/common/note_categories.yaml)
          2. Project overrides (.cpg/rules/note_categories.yaml)
          3. Validate: no duplicate names after merge
          4. Apply tombstones (require reason field)
        Returns: [{id, name, strict}, ...]
        """

    def _load_sdk(self) -> List[Dict]: ...
    def _load_project(self, project_root: Path) -> Tuple[List[Dict], List[Dict]]:
        """Returns (new_categories, tombstones)."""
    def _apply_tombstones(self, categories, tombstones) -> List[Dict]: ...
    def _validate_no_duplicates(self, categories) -> None: ...
```

### Load Protocol

- SDK categories loaded via `importlib.resources` (same as `CascadingRuleLoader`).
- Project categories loaded from `{project_root}/.cpg/rules/note_categories.yaml`.
- Tombstones require `reason` field; missing reason raises `ValueError`.
- Orphan tombstones (no matching id) emit a warning log.
- Duplicate category names after merge raise `ValueError`.

---

## 4. Registry Integration

### `RuleRegistry` Extensions

```python
class RuleRegistry:
    def __init__(self, project_root=None):
        # ... existing ...
        self._note_categories: Dict[str, Dict] = {}  # name -> {id, name, strict}

    def load(self, lang="c", project_rules=None):
        # ... existing loading ...
        self._load_note_categories()
        return self

    def _load_note_categories(self) -> None:
        loader = NoteCategoryLoader()
        cats = loader.load(project_root=self._project_root)
        self._note_categories = {c["name"]: c for c in cats}

    def is_valid_note_category(self, name: str) -> bool:
        return name in self._note_categories

    def get_note_categories(self) -> List[str]:
        return list(self._note_categories.keys())

    def is_strict_note_category(self, name: str) -> bool:
        cat = self._note_categories.get(name)
        return cat is not None and cat.get("strict", False)
```

---

## 5. Consumer Changes

### `note_validation.py`

- `STRICT_NOTE_SCHEMAS` keys: `NoteCategory` Enum -> `str`
  (`"VULNERABILITY"`, `"COORDINATION"`, `"SECURITY_BOUNDARY"`).
- `validate_and_canonicalize_note_content()` signature adds optional
  `valid_categories: Optional[Set[str]]` parameter. Service layer passes
  `set(registry.get_note_categories())` here. When `None`, skips membership
  check (useful for unit tests that don't need a full registry).

### Service Layer (`app/services/domain/note.py`)

- Inject `RuleRegistry` into note service.
- Before creating `InsightNode`, call `registry.is_valid_note_category(category)`.
- Raise structured error if category is invalid, listing available categories.

### CLI (`cli/commands/note.py`)

- `cdm note add --category` uses `registry.get_note_categories()` for help text
  and validation.
- `cdm note list` displays category as-is (string, no Enum coercion).

### API (`api/routers/note.py`)

- Validation delegated to service layer. No Enum in request/response models.

---

## 6. Files Changed

### Modified

| File | Change |
|------|--------|
| `core/schema/graph/nodes/extensions.py` | Delete `NoteCategory` Enum; `category` -> `str` |
| `core/schema/graph/nodes/__init__.py` | Remove `NoteCategory` re-export |
| `app/query/note_validation.py` | String keys for `STRICT_NOTE_SCHEMAS`; optional category set param |
| `app/query/models.py` | Replace Enum refs with `str` |
| `app/query/root.py` | Replace Enum refs with `str` |
| `app/services/domain/note.py` | Inject registry; validate before write |
| `app/services/domain_services.py` | Update if referencing Enum |
| `api/routers/note.py` | Remove Enum dependency |
| `infra/rules/registry.py` | Add note category cache + query methods |
| `infra/storage/repository.py` | Replace Enum refs with `str` |
| `analysis/traversal/context.py` | Replace Enum refs with `str` |
| `analysis/passes/ai/smart_summary.py` | Replace Enum refs with `str` |
| `analysis/passes/ai/smart_macro.py` | Replace Enum refs with `str` |
| `cli/commands/note.py` | Use registry for category list |
| `tests/core/test_note_category.py` | Rewrite for loader + registry |
| `docs/NOTE_SYSTEM.md` | Update documentation |

### New

| File | Content |
|------|---------|
| `rules/common/note_categories.yaml` | SDK built-in category definitions |
| `infra/rules/note_category_loader.py` | `NoteCategoryLoader` class |

---

## 7. Migration Principles

- **No backward compatibility shims.** Delete the Enum, update all import sites
  in the same commit. Per CLAUDE.md: "Remove old interfaces immediately."
- **No language dimension.** Note categories are audit-workflow concepts,
  not language-specific.
- **Strict schema registration stays code-side.** `STRICT_NOTE_SCHEMAS` remains
  a Python dict mapping `str -> Type[BaseModel]`. Moving schema registration to
  YAML is out of scope (future work).

---

## 8. Future Extensions (Out of Scope)

- User-registered strict schemas (custom Pydantic models for their categories).
- Category grouping / hierarchy.
- Per-category permissions (who can create notes of type X).
