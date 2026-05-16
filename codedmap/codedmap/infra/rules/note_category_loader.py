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
        seen: Dict[str, str] = {}
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
