# codedmap/analysis/passes/batch/entry_point_pass.py
"""
EntryPointPass - Batch pass for entry point detection and tagging.

Runs after CallGraphPass to ensure call graph is available for L2 tracing.
Detects entry points using EntryPointDetector and tags them via TagEngine.
"""

import logging
from typing import List, Optional, Any

from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.core.schema.graph.enums import EdgeType
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.runner import BaseRunner
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig

from codedmap.core.schema.security import EntryPoint, EntryPointLevel
from codedmap.analysis.detection.entrypoint_detector import EntryPointDetector
from codedmap.analysis.tagging import TagEngine
from codedmap.core.schema.tags.matcher import SecurityTagMatcher

logger = logging.getLogger(__name__)


class EntryPointPass(BaseBatchPass):
    """
    Batch pass for entry point detection.

    Runs EntryPointDetector to find L1 and L2 entry points, then tags
    them using TagEngine for persistence.

    Dependencies:
    - CallGraphPass: Required for L2 wrapper tracing via call graph

    Output:
    - Tags nodes with ONTOLOGY format: ONTOLOGY:ENTRY_POINT:{ontology_name}
    """

    def __init__(
        self,
        store: CPGStore,
        runner: BaseRunner,
        config: Optional[AnalysisConfig] = None,
        storage_config: Optional[StorageConfig] = None,
        **kwargs
    ):
        """
        Initialize the EntryPointPass.

        Args:
            store: CPGStore for graph queries
            runner: BaseRunner for parallel execution (not used for this pass)
            config: Optional AnalysisConfig
            storage_config: Optional StorageConfig
        """
        super().__init__(store, runner, config=config, storage_config=storage_config, **kwargs)
        # No edges to prune - we only add tags
        self.prune_targets = []

    def run(self):
        """
        Execute entry point detection and tagging.

        1. Create EntryPointDetector and detect all entry points
        2. Use TagEngine to tag detected nodes
        3. Log summary statistics
        """
        logger.info(f"=== [{self.name}] Starting Entry Point Detection ===")

        try:
            # Create detector with config for trace depth
            detector = EntryPointDetector(self.store, self.config)
            entry_points = detector.detect_all()

            if not entry_points:
                logger.info(f"[{self.name}] No entry points detected.")
                return

            # Batch tag via TagEngine
            tagger = TagEngine(self.store)
            tagged_count = 0
            skipped_count = 0

            for ep in entry_points:
                node = self.store.get_node(ep.node_id)
                if not node:
                    logger.debug(f"Node {ep.node_id} not found for tagging")
                    continue

                # Check for existing higher-level tags
                existing_tags = tagger.list_tags(node)
                if self._has_higher_level(existing_tags, ep.level):
                    skipped_count += 1
                    continue

                # Add the entry point tag
                tag = ep.full_tag
                result = tagger.add_system_tag(node, tag)

                if result.action == "added":
                    tagged_count += 1
                    # Emit SEMANTIC:PROTOCOL tag if rule carries protocol metadata
                    if ep.protocol:
                        semantic_tag = f"SEMANTIC:PROTOCOL:{ep.protocol.upper()}"
                        tagger.add(node, semantic_tag, applied_by="system")
                elif result.action == "already_exists":
                    skipped_count += 1

            # Log summary
            l1_count = sum(1 for ep in entry_points if ep.level == EntryPointLevel.L1)
            l2_count = sum(1 for ep in entry_points if ep.level == EntryPointLevel.L2)
            l3_count = sum(1 for ep in entry_points if ep.level == EntryPointLevel.L3)

            logger.info(
                f"[{self.name}] Detection complete: "
                f"{len(entry_points)} found (L1={l1_count}, L2={l2_count}, L3={l3_count}), "
                f"{tagged_count} tagged, {skipped_count} skipped"
            )

        except Exception as e:
            logger.error(f"[{self.name}] Failed: {e}")
            raise

    def _has_higher_level(
        self,
        existing_tags: List[str],
        level: EntryPointLevel
    ) -> bool:
        """
        Check if existing tags include an entry point tag already.

        With the ONTOLOGY format, level is no longer encoded in the tag string.
        If any ONTOLOGY:ENTRY_POINT:* tag already exists, the node is already
        tagged and we skip re-tagging.

        Args:
            existing_tags: List of existing tag strings
            level: Current entry point level to compare (unused in ONTOLOGY format)

        Returns:
            True if an ONTOLOGY entry point tag already exists.
        """
        for tag in existing_tags:
            if SecurityTagMatcher.is_entry_point(tag):
                return True
        return False
