"""CascadingRuleLoader: loads V2 ontology + per-language rules from YAML packages."""
from __future__ import annotations

import importlib.resources as resources
import logging
from typing import Dict, List, Optional, Set

import yaml

logger = logging.getLogger(__name__)

_KEY_TO_NAMESPACE = {
    "entry_points": "ENTRY_POINT",
    "sources": "SOURCE",
    "sinks": "SINK",
    "guards": "GUARD",
    "sanitizers": "SANITIZER",
}


class OntologyError(ValueError):
    """Raised when a rule's category is not in the V2 ontology."""


class CascadingRuleLoader:
    COMMON_PACKAGE = "codedmap.rules.common"
    LANG_PACKAGE_MAP = {
        "c": "codedmap.rules.c",
        "cpp": "codedmap.rules.c",
        "python": "codedmap.rules.python",
    }
    RULE_KEYS = ("entry_points", "sources", "sinks", "guards", "sanitizers")

    def load_all(
        self,
        lang: str = "c",
        project_rules: Optional[List[Dict]] = None,
    ) -> Dict[str, List[Dict]]:
        """
        Load all rules for the given language.

        Load order:
          1. common/ontology.yaml  (category whitelist)
          2. {lang}/core.yaml      (aggregated SDK rules)
          3. {lang}/extensions/*.yaml (future; empty dir OK)
          4. project_rules         (injected; no SDK file I/O)
          5. common/safe_functions.yaml
        Validation: AFTER all rules merged, BEFORE tombstone resolution.
        Tombstone resolution: AFTER validation.
        """
        ontology = self._load_ontology()

        raw: Dict[str, List[Dict]] = {k: [] for k in self.RULE_KEYS}

        self._load_lang_core(lang, raw)
        self._merge_lang_extensions(lang, raw)

        if project_rules:
            self._merge_project_rules(project_rules, raw)

        raw["safe_functions"] = self._load_safe_functions()

        self._validate_categories(raw, ontology)

        self._apply_tombstones(raw)

        return raw

    def _load_ontology(self) -> Dict[str, Set[str]]:
        """Returns {namespace: set_of_valid_category_names}."""
        pkg = resources.files(self.COMMON_PACKAGE)
        text = (pkg / "ontology.yaml").read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        result: Dict[str, Set[str]] = {}
        for namespace, entries in data.get("categories", {}).items():
            result[namespace] = {e["name"] for e in entries}
        return result

    def _load_lang_core(self, lang: str, raw: Dict[str, List[Dict]]) -> None:
        """Read {lang}/core.yaml and populate raw with rule lists."""
        pkg_name = self.LANG_PACKAGE_MAP.get(lang)
        if not pkg_name:
            raise ValueError(f"Unsupported language: {lang!r}")
        pkg = resources.files(pkg_name)
        text = (pkg / "core.yaml").read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        for key in self.RULE_KEYS:
            raw[key].extend(data.get(key) or [])

    def _merge_lang_extensions(self, lang: str, raw: Dict[str, List[Dict]]) -> None:
        """Traverse {lang}/extensions/*.yaml and merge additional rules. Empty dir is fine."""
        pkg_name = self.LANG_PACKAGE_MAP.get(lang)
        if not pkg_name:
            return
        try:
            ext_pkg = resources.files(pkg_name) / "extensions"
            for item in ext_pkg.iterdir():
                name = item.name if hasattr(item, "name") else str(item)
                if not name.endswith(".yaml"):
                    continue
                text = item.read_text(encoding="utf-8")
                data = yaml.safe_load(text) or {}
                for key in self.RULE_KEYS:
                    raw[key].extend(data.get(key) or [])
        except (FileNotFoundError, NotADirectoryError, TypeError):
            pass

    def _merge_project_rules(self, project_rules: List[Dict], raw: Dict[str, List[Dict]]) -> None:
        """
        Merge injected project rules into raw.
        Each dict must have a 'rule_type' key indicating which list it belongs to.
        Tombstone entries (tombstone: true) are kept in the list for later resolution.
        """
        for rule in project_rules:
            rule_type = rule.get("rule_type")
            if rule_type not in self.RULE_KEYS:
                logger.warning("project_rules entry missing valid rule_type, skipping: %r", rule)
                continue
            raw[rule_type].append(rule)

    def _load_safe_functions(self) -> List[Dict]:
        """Read common/safe_functions.yaml, return list of raw dicts."""
        pkg = resources.files(self.COMMON_PACKAGE)
        text = (pkg / "safe_functions.yaml").read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        return data.get("safe_functions") or []

    def _validate_categories(
        self, raw: Dict[str, List[Dict]], ontology: Dict[str, Set[str]]
    ) -> None:
        """
        Validate every rule's category against the ontology whitelist.
        Tombstone entries without a category are skipped.
        Raises OntologyError on first violation.
        """
        for key, namespace in _KEY_TO_NAMESPACE.items():
            valid = ontology.get(namespace, set())
            for rule in raw.get(key, []):
                category = rule.get("category")
                if category is None:
                    continue
                if category not in valid:
                    raise OntologyError(
                        f"Rule {rule.get('id')!r}: category {category!r} not in {namespace} ontology"
                    )

    def _apply_tombstones(self, raw: Dict[str, List[Dict]]) -> None:
        """
        Collect tombstone entries, validate they have a reason, then remove
        both the tombstone entry and any rule with a matching id.
        Logs a warning for orphan tombstones (no matching id found).
        """
        for key in self.RULE_KEYS:
            rules = raw.get(key, [])
            tombstones = [r for r in rules if r.get("tombstone")]
            live_rules = [r for r in rules if not r.get("tombstone")]

            for ts in tombstones:
                if not ts.get("reason"):
                    raise ValueError(
                        f"Tombstone for {ts.get('id')!r} is missing required 'reason' field"
                    )
                ts_id = ts.get("id")
                before = len(live_rules)
                live_rules = [r for r in live_rules if r.get("id") != ts_id]
                if len(live_rules) == before:
                    logger.warning(
                        "Orphan tombstone: no rule with id %r found in %r", ts_id, key
                    )

            raw[key] = live_rules
