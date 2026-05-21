# codedmap/analysis/passes/batch/source_pass.py
"""
SourcePass - Batch pass for taint source detection and tagging.

Runs after CallGraphPass to ensure the call graph and AST edges are
available for _get_parent_method() traversal.

Detects taint source call sites via SourceDetector and tags the enclosing
METHOD nodes using TagEngine (add_system_tag → L1 ONTOLOGY tag).

Output: Tags METHOD nodes with ONTOLOGY:SOURCE:{category} format tags.
"""

import logging
from typing import Optional

from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.runner import BaseRunner
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig

logger = logging.getLogger(__name__)


class SourcePass(BaseBatchPass):
    """
    Batch pass for taint source detection.

    Runs SourceDetector to find all taint source call sites, then tags
    their enclosing METHOD nodes via TagEngine for persistence.

    Dependencies:
    - CallGraphPass: Ensures call graph edges are present; consistent with
      EntryPointPass dependency pattern. AST edges needed for parent METHOD
      resolution are present from the ingestion phase.

    Output:
    - Tags METHOD nodes with ONTOLOGY format: ONTOLOGY:SOURCE:{category}
      e.g., ONTOLOGY:SOURCE:NETWORK_IO, ONTOLOGY:SOURCE:ENV_VAR
    """

    def __init__(
        self,
        store: CPGStore,
        runner: BaseRunner,
        config: Optional[AnalysisConfig] = None,
        storage_config: Optional[StorageConfig] = None,
        **kwargs,
    ):
        """
        Initialize the SourcePass.

        Args:
            store:          CPGStore for graph queries
            runner:         BaseRunner for parallel execution (not used for this pass)
            config:         Optional AnalysisConfig
            storage_config: Optional StorageConfig
        """
        super().__init__(store, runner, config=config, storage_config=storage_config, **kwargs)
        # No edges to prune — this pass only adds tags to METHOD nodes
        self.prune_targets = []

    def run(self) -> None:
        """
        Execute taint source detection and tagging.

        1. Create SourceDetector and detect all taint sources
        2. For each Source, fetch the METHOD node from the store
        3. Tag the METHOD node with source.full_tag via TagEngine
        4. Log summary statistics
        """
        logger.info(f"=== [{self.name}] Starting Source Detection ===")

        # Lazy imports — keeps module-level deps minimal and avoids import cycles
        from codedmap.analysis.detection.source_detector import SourceDetector
        from codedmap.analysis.tagging import TagEngine

        try:
            detector = SourceDetector(self.store, self.config)
            sources = detector.detect_all()

            logger.info(f"[{self.name}] SourcePass: found {len(sources)} source methods")

            if not sources:
                logger.info(f"[{self.name}] No taint sources detected.")
                return

            tagger = TagEngine(self.store)
            tagged_count = 0

            for source in sources:
                node = self.store.get_node(source.node_id)
                if not node:
                    logger.debug(f"Node {source.node_id} not found for tagging")
                    continue

                tagger.add_system_tag(node, source.full_tag)
                # Emit SEMANTIC:ORIGIN tag if rule carries origin metadata
                if source.origin:
                    semantic_tag = f"SEMANTIC:ORIGIN:{source.origin.upper()}"
                    tagger.add(node, semantic_tag, applied_by="system")
                tagged_count += 1

            logger.info(f"[{self.name}] SourcePass: tagged {tagged_count} nodes")

        except Exception as exc:
            logger.error(f"[{self.name}] Failed: {exc}")
            raise
