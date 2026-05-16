# codedmap/analysis/passes/batch/guard_pass.py
"""
GuardPass - Batch pass for guard detection and tagging.

Runs after CallGraphPass to ensure the call graph and AST edges are
available for enclosing METHOD resolution.

Detects guard (defensive check) call sites via GuardDetector and tags
the enclosing METHOD nodes using TagEngine (add_system_tag -> L1 ONTOLOGY tag).

Output: Tags METHOD nodes with ONTOLOGY:GUARD:{category} format tags.
"""

import logging
from typing import Optional

from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.runner import BaseRunner
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig

logger = logging.getLogger(__name__)


class GuardPass(BaseBatchPass):
    """
    Batch pass for guard detection and tagging.

    Runs GuardDetector to find all guard call sites, then tags
    their enclosing METHOD nodes via TagEngine for persistence.

    Dependencies:
    - CallGraphPass: Ensures call graph edges are present; consistent with
      SourcePass/SinkPass dependency pattern.

    Output:
    - Tags METHOD nodes with ONTOLOGY format: ONTOLOGY:GUARD:{category}
      e.g., ONTOLOGY:GUARD:NULL_CHECK, ONTOLOGY:GUARD:BOUNDS_CHECK
    """

    def __init__(
        self,
        store: CPGStore,
        runner: BaseRunner,
        config: Optional[AnalysisConfig] = None,
        storage_config: Optional[StorageConfig] = None,
        **kwargs,
    ):
        super().__init__(store, runner, config=config, storage_config=storage_config, **kwargs)
        self.prune_targets = []

    def run(self) -> None:
        """
        Execute guard detection and tagging.

        1. Create GuardDetector and detect all guards
        2. For each Guard, fetch the METHOD node from the store
        3. Tag the METHOD node with guard.full_tag via TagEngine
        4. Log summary statistics
        """
        logger.info(f"=== [{self.name}] Starting Guard Detection ===")

        from codedmap.analysis.detection.guard_detector import GuardDetector
        from codedmap.analysis.tagging import TagEngine

        try:
            detector = GuardDetector(self.store, self.config)
            guards = detector.detect_all()

            logger.info(f"[{self.name}] GuardPass: found {len(guards)} guard methods")

            if not guards:
                logger.info(f"[{self.name}] No guards detected.")
                return

            tagger = TagEngine(self.store)
            tagged_count = 0

            for guard in guards:
                node = self.store.get_node(guard.node_id)
                if not node:
                    logger.debug(f"Node {guard.node_id} not found for tagging")
                    continue

                tagger.add_system_tag(node, guard.full_tag)
                tagged_count += 1

            logger.info(f"[{self.name}] GuardPass: tagged {tagged_count} nodes")

        except Exception as exc:
            logger.error(f"[{self.name}] Failed: {exc}")
            raise
