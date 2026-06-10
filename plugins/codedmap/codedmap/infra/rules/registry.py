"""
Layered rule registry: thin wrapper/cache over CascadingRuleLoader.

Infra layer (Layer 1): delegates all YAML I/O to CascadingRuleLoader.
Project-level overrides (.cpg/rules/) are loaded via _load_project_filesystem().

Merge semantics:
- SDK rules loaded via CascadingRuleLoader (common → lang → extensions).
- Project rules ADD new entries or TOMBSTONE SDK entries by rule ID + reason.
- Project rules CANNOT modify an SDK rule's properties.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml

from codedmap.core.schema.security.entrypoint_catalog import EntryPointCatalog
from codedmap.core.schema.security.entrypoint_models import EntryPointCategory
from codedmap.core.schema.security.entrypoint_rules import EntryPointRule, RulePattern
from codedmap.core.schema.security.sink_catalog import SinkCatalog
from codedmap.core.schema.security.sink_models import SinkCategory, SinkDefinition
from codedmap.core.schema.tags.definition import TagDefinition
from codedmap.core.schema.tags.layer import TagLayer
from codedmap.infra.rules.loader import CascadingRuleLoader
from codedmap.infra.rules.models import MergedRule, RuleSet, Tombstone
from codedmap.infra.rules.note_category_loader import NoteCategoryLoader

logger = logging.getLogger(__name__)

CURRENT_VERSION = 1
SUPPORTED_VERSIONS = {1, 2}


class RuleRegistry:
    """
    Unified registry that delegates rule loading to CascadingRuleLoader
    and merges project-level rules from .cpg/rules/.

    Merge semantics:
    - Project rules ADD new entries.
    - Project rules TOMBSTONE SDK entries by rule ID + reason.
    - Project rules CANNOT modify an SDK rule's properties.

    Merge order: SDK (via CascadingRuleLoader) → Project filesystem (alphabetical).
    """

    def __init__(self, project_root: Optional[Path] = None) -> None:
        self._project_root = project_root
        self._ontology: RuleSet = RuleSet()
        self._sinks: RuleSet = RuleSet()
        self._sources: RuleSet = RuleSet()
        self._safe_functions: RuleSet = RuleSet()
        self._sink_catalog: RuleSet = RuleSet()
        self._entrypoints: RuleSet = RuleSet()
        self._guards: RuleSet = RuleSet()
        self._sanitizers: RuleSet = RuleSet()
        self._note_categories: Dict[str, Dict] = {}
        self._loaded = False

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

    @property
    def ontology(self) -> RuleSet:
        self._ensure_loaded()
        return self._ontology

    @property
    def sinks(self) -> RuleSet:
        self._ensure_loaded()
        return self._sinks

    @property
    def sources(self) -> RuleSet:
        self._ensure_loaded()
        return self._sources

    @property
    def safe_functions(self) -> RuleSet:
        self._ensure_loaded()
        return self._safe_functions

    @property
    def sink_catalog(self) -> RuleSet:
        self._ensure_loaded()
        return self._sink_catalog

    @property
    def entrypoints(self) -> RuleSet:
        self._ensure_loaded()
        return self._entrypoints

    @property
    def guards(self) -> RuleSet:
        self._ensure_loaded()
        return self._guards

    @property
    def sanitizers(self) -> RuleSet:
        self._ensure_loaded()
        return self._sanitizers

    @property
    def ontology_categories(self) -> Dict[str, List[str]]:
        """ONTOLOGY_CATEGORIES equivalent from merged ontology rules."""
        return self.get_ontology_categories()

    @property
    def sink_db(self) -> Dict[str, str]:
        """_SINK_DB equivalent: {name: category}."""
        return self.get_sink_db()

    @property
    def source_db(self) -> Dict[str, str]:
        """_SOURCE_DB equivalent: {name: category}."""
        return self.get_source_db()

    @property
    def safe_set(self) -> Set[str]:
        """_SAFE_SET equivalent."""
        return self.get_safe_set()

    @property
    def materialized_sink_catalog(self) -> SinkCatalog:
        """SinkCatalog built from merged sink_catalog rules."""
        return self.build_sink_catalog()

    @property
    def entrypoint_catalog(self) -> EntryPointCatalog:
        """EntryPointCatalog built from merged entrypoint rules."""
        catalog = EntryPointCatalog()
        catalog.add_rules(self.build_entrypoint_rules())
        return catalog

    def get_tombstones(self) -> List[Dict[str, Any]]:
        """Return all tombstoned rules across all rule types."""
        result: List[Dict[str, Any]] = []
        rule_types = {
            "ontology": self._ontology,
            "sinks": self._sinks,
            "sources": self._sources,
            "safe_functions": self._safe_functions,
            "sink_catalog": self._sink_catalog,
            "entrypoints": self._entrypoints,
            "guards": self._guards,
            "sanitizers": self._sanitizers,
        }
        self._ensure_loaded()
        for rule_type, ruleset in rule_types.items():
            for mr in ruleset.tombstoned_rules():
                result.append({
                    "id": mr.id,
                    "rule_type": rule_type,
                    "reason": mr.tombstone_reason,
                    "data": mr.data,
                })
        return result

    def get_active_rules(self, rule_type: str) -> List[Dict[str, Any]]:
        """Return active rules for a given rule type.

        Args:
            rule_type: One of 'ontology', 'sinks', 'sources',
                       'safe_functions', 'sink_catalog', 'entrypoints',
                       'guards', 'sanitizers'
        """
        self._ensure_loaded()
        rule_types = {
            "ontology": self._ontology,
            "sinks": self._sinks,
            "sources": self._sources,
            "safe_functions": self._safe_functions,
            "sink_catalog": self._sink_catalog,
            "entrypoints": self._entrypoints,
            "guards": self._guards,
            "sanitizers": self._sanitizers,
        }
        ruleset = rule_types.get(rule_type)
        if ruleset is None:
            raise ValueError(f"Unknown rule type: {rule_type}")
        return [
            {"id": mr.id, "origin": mr.origin, **mr.data}
            for mr in ruleset.active_rules()
        ]

    def get_ontology_categories(self) -> Dict[str, List[str]]:
        """Return ONTOLOGY_CATEGORIES equivalent from merged ontology rules."""
        self._ensure_loaded()
        result: Dict[str, List[str]] = {}
        for mr in self._ontology.active_rules():
            ns = mr.data.get("namespace", "")
            name = mr.data.get("name", "")
            if ns not in result:
                result[ns] = []
            result[ns].append(name)
        return result

    def build_l1_ontology(self) -> Dict[str, TagDefinition]:
        """Build materialized L1 ontology catalog from merged rules."""
        self._ensure_loaded()
        descriptions = {
            "SOURCE": "Data source: {}",
            "SINK": "Security-sensitive sink: {}",
            "SANITIZER": "Input sanitizer: {}",
            "GUARD": "Guard condition: {}",
            "ENTRY_POINT": "Program entry point: {}",
            "ROLE": "Architectural role: {}",
        }
        catalog: Dict[str, TagDefinition] = {}
        for mr in self._ontology.active_rules():
            ns = mr.data.get("namespace", "")
            name = mr.data.get("name", "")
            desc_template = descriptions.get(ns, "{}")
            td = TagDefinition(
                layer=TagLayer.ONTOLOGY,
                namespace=ns,
                name=name,
                description=desc_template.format(name.lower().replace("_", " ")),
            )
            catalog[td.full_tag] = td
        return catalog

    def get_sink_db(self) -> Dict[str, str]:
        """Return _SINK_DB equivalent: {name: category}."""
        self._ensure_loaded()
        return {
            mr.data["name"]: mr.data["category"]
            for mr in self._sinks.active_rules()
        }

    def get_source_db(self) -> Dict[str, str]:
        """Return _SOURCE_DB equivalent: {name: category, pattern_func: category}."""
        self._ensure_loaded()
        db: Dict[str, str] = {}
        for mr in self._sources.active_rules():
            cat = mr.data["category"]
            db[mr.data["name"]] = cat
            for pat in mr.data.get("patterns", []):
                fn = pat.get("function", "")
                if fn and fn not in db:
                    db[fn] = cat
        return db

    def get_safe_set(self) -> Set[str]:
        """Return _SAFE_SET equivalent."""
        self._ensure_loaded()
        return {mr.data["name"] for mr in self._safe_functions.active_rules()}

    def build_sink_catalog(self) -> SinkCatalog:
        """Build SinkCatalog from merged sink_catalog rules."""
        self._ensure_loaded()
        catalog = SinkCatalog()
        for mr in self._sink_catalog.active_rules():
            d = mr.data
            cat = SinkCategory(d["category"])
            languages = d.get("languages", ["c", "cpp", "python"])
            catalog.add_sink(SinkDefinition(
                name=d["name"],
                category=cat,
                languages=languages,
            ))
        return catalog

    def build_entrypoint_rules(self) -> List[EntryPointRule]:
        """Build list of EntryPointRule from merged entrypoint rules."""
        self._ensure_loaded()
        rules: List[EntryPointRule] = []
        for mr in self._entrypoints.active_rules():
            d = mr.data
            cat = EntryPointCategory(d["category"].upper())
            patterns = [
                RulePattern(
                    type=p["type"],
                    function=p.get("function"),
                    name=p.get("name"),
                    is_entry=p.get("is_entry", False),
                    code_pattern=p.get("code_pattern"),
                )
                for p in d.get("patterns", [])
            ]
            rules.append(EntryPointRule(
                name=d["name"],
                category=cat,
                patterns=patterns,
                languages=d.get("languages", ["c", "cpp", "python"]),
                description=d.get("description"),
                protocol=d.get("protocol"),
            ))
        return rules

    def build_source_rules(self) -> list:
        """Build list of SourceRule from merged source rules (sources.yaml).

        Returns:
            List[SourceRule] — one per active source rule.
        """
        from codedmap.core.schema.security.source_rules import SourceRule
        self._ensure_loaded()
        rules = []
        for mr in self._sources.active_rules():
            d = {**mr.data, "origin": mr.origin}
            try:
                rule = SourceRule.from_dict(d)
                rules.append(rule)
            except (ValueError, KeyError) as e:
                logger.warning(f"Skipping invalid source rule {d.get('id', '?')}: {e}")
        return rules

    def build_guard_rules(self) -> list:
        """Build list of GuardRule from merged guard rules.

        NOTE: Functional testing deferred to Plan 05 integration tests.
        Lazy import prevents import-time failure when guard_models not yet available.

        Returns:
            List[GuardRule] — one per active guard rule.
        """
        self._ensure_loaded()
        try:
            from codedmap.core.schema.security.guard_models import GuardRule  # type: ignore
        except ImportError:
            logger.warning("guard_models not available; returning empty guard rules list")
            return []
        rules = []
        for mr in self._guards.active_rules():
            try:
                rules.append(GuardRule.from_dict({**mr.data, "id": mr.id}))
            except (ValueError, KeyError) as e:
                logger.warning(f"Skipping invalid guard rule {mr.id!r}: {e}")
        return rules

    def build_sanitizer_rules(self) -> list:
        """Build list of SanitizerRule from merged sanitizer rules.

        NOTE: Functional testing deferred to Plan 05 integration tests.
        Lazy import prevents import-time failure when sanitizer_models not yet available.

        Returns:
            List[SanitizerRule] — one per active sanitizer rule.
        """
        self._ensure_loaded()
        try:
            from codedmap.core.schema.security.sanitizer_models import SanitizerRule  # type: ignore
        except ImportError:
            logger.warning("sanitizer_models not available; returning empty sanitizer rules list")
            return []
        rules = []
        for mr in self._sanitizers.active_rules():
            try:
                rules.append(SanitizerRule.from_dict({**mr.data, "id": mr.id}))
            except (ValueError, KeyError) as e:
                logger.warning(f"Skipping invalid sanitizer rule {mr.id!r}: {e}")
        return rules

    @property
    def source_catalog(self):
        """SourceCatalog built from merged source rules."""
        from codedmap.core.schema.security.source_catalog import SourceCatalog
        return SourceCatalog(rules=self.build_source_rules())

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def _populate_from_raw(self, raw: Dict[str, List[Dict]]) -> None:
        """Populate all RuleSets from CascadingRuleLoader.load_all() output."""
        for entry in raw.get("entry_points", []):
            rule_id = entry.get("id", "")
            self._entrypoints.rules.append(MergedRule(
                id=rule_id,
                data={k: v for k, v in entry.items() if k != "id"},
                origin="SDK_CORE",
            ))

        for entry in raw.get("sources", []):
            rule_id = entry.get("id", "")
            self._sources.rules.append(MergedRule(
                id=rule_id,
                data={k: v for k, v in entry.items() if k != "id"},
                origin="SDK_CORE",
            ))

        for entry in raw.get("sinks", []):
            rule_id = entry.get("id", "")
            entry_data = {k: v for k, v in entry.items() if k != "id"}
            self._sinks.rules.append(MergedRule(
                id=rule_id,
                data=entry_data,
                origin="SDK_CORE",
            ))
            self._sink_catalog.rules.append(MergedRule(
                id=rule_id,
                data=entry_data,
                origin="SDK_CORE",
            ))

        for entry in raw.get("safe_functions", []):
            rule_id = entry.get("id", "")
            self._safe_functions.rules.append(MergedRule(
                id=rule_id,
                data={k: v for k, v in entry.items() if k != "id"},
                origin="SDK_CORE",
            ))

        for entry in raw.get("guards", []):
            rule_id = entry.get("id", "")
            self._guards.rules.append(MergedRule(
                id=rule_id,
                data={k: v for k, v in entry.items() if k != "id"},
                origin="SDK_CORE",
            ))

        for entry in raw.get("sanitizers", []):
            rule_id = entry.get("id", "")
            self._sanitizers.rules.append(MergedRule(
                id=rule_id,
                data={k: v for k, v in entry.items() if k != "id"},
                origin="SDK_CORE",
            ))

        loader = CascadingRuleLoader()
        ontology = loader._load_ontology()
        for ns, names in ontology.items():
            for name in names:
                rule_id = f"ont_{ns.lower()}_{name.lower()}"
                self._ontology.rules.append(MergedRule(
                    id=rule_id,
                    data={"namespace": ns, "name": name},
                    origin="SDK_CORE",
                ))

    def _load_project_filesystem(self) -> None:
        """Load project-level rules from .cpg/rules/ directory."""
        if self._project_root is None:
            return
        rules_dir = self._project_root / ".cpg" / "rules"
        if not rules_dir.is_dir():
            return

        type_map = {
            "ontology": ("categories", self._ontology),
            "sinks": ("sinks", self._sinks),
            "sources": ("rules", self._sources),
            "safe_functions": ("safe_functions", self._safe_functions),
            "sink_catalog": ("sinks", self._sink_catalog),
            "entrypoints": ("rules", self._entrypoints),
            "guards": ("guards", self._guards),
            "sanitizers": ("sanitizers", self._sanitizers),
        }

        for yaml_path in sorted(rules_dir.glob("*.yaml")):
            try:
                data = yaml.safe_load(yaml_path.read_text())
            except yaml.YAMLError as e:
                raise ValueError(f"Invalid YAML in {yaml_path}: {e}")

            if not data:
                continue

            self._check_version(data, str(yaml_path))

            stem = yaml_path.stem
            if stem not in type_map:
                logger.warning(f"Unknown project rule file: {yaml_path.name}")
                continue

            list_key, ruleset = type_map[stem]

            tombstones = data.get("tombstone", [])
            for ts in tombstones:
                ts_id = ts["id"]
                reason = ts.get("reason")
                if not reason:
                    raise ValueError(
                        f"Tombstone for '{ts_id}' in {yaml_path} missing required 'reason'"
                    )
                existing = ruleset.by_id(ts_id)
                if existing is not None:
                    existing.active = False
                    existing.tombstone_reason = reason
                    logger.info(f"Tombstoned rule '{ts_id}': {reason}")
                else:
                    logger.warning(f"Tombstone references unknown rule '{ts_id}' in {yaml_path}")

            if stem == "ontology":
                for ns, entries in data.get("categories", {}).items():
                    for entry in entries:
                        rule_id = entry["id"]
                        ruleset.rules.append(MergedRule(
                            id=rule_id,
                            data={"namespace": ns, "name": entry["name"]},
                            origin="LOCAL_OVERRIDE",
                        ))
            else:
                for entry in data.get(list_key, []):
                    rule_id = entry["id"]
                    entry_data = {k: v for k, v in entry.items() if k != "id"}
                    ruleset.rules.append(MergedRule(
                        id=rule_id,
                        data=entry_data,
                        origin="LOCAL_OVERRIDE",
                    ))

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

    @staticmethod
    def _check_version(data: Dict[str, Any], source: str) -> None:
        version = data.get("version", CURRENT_VERSION)
        if version not in SUPPORTED_VERSIONS:
            logger.warning(
                f"Rule file {source} has version {version} "
                f"(supported: {sorted(SUPPORTED_VERSIONS)})"
            )
