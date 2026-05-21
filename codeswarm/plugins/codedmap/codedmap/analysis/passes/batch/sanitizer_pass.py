# codedmap/analysis/passes/batch/sanitizer_pass.py
"""
SanitizerPass - Batch pass for sanitizer detection and tagging.

Runs after CallGraphPass to ensure the call graph and AST edges are
available for enclosing METHOD resolution.

Detects sanitizer (data transformation) call sites via SanitizerDetector
and tags the enclosing METHOD nodes using TagEngine (add_system_tag -> L1 ONTOLOGY tag).

Output: Tags METHOD nodes with ONTOLOGY:SANITIZER:{category} format tags.
"""

import logging
from typing import Optional

from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.runner import BaseRunner
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig

logger = logging.getLogger(__name__)


class SanitizerPass(BaseBatchPass):
    """
    Batch pass for sanitizer detection and tagging.

    Runs SanitizerDetector to find all sanitizer call sites, then tags
    their enclosing METHOD nodes via TagEngine for persistence.

    Dependencies:
    - CallGraphPass: Ensures call graph edges are present; consistent with
      SourcePass/SinkPass dependency pattern.

    Output:
    - Tags METHOD nodes with ONTOLOGY format: ONTOLOGY:SANITIZER:{category}
      e.g., ONTOLOGY:SANITIZER:ESCAPE, ONTOLOGY:SANITIZER:ENCODE
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
        Execute sanitizer detection and tagging.

        1. Create SanitizerDetector and detect all sanitizers
        2. For each Sanitizer, fetch the METHOD node from the store
        3. Tag the METHOD node with sanitizer.full_tag via TagEngine
        4. Log summary statistics
        """
        logger.info(f"=== [{self.name}] Starting Sanitizer Detection ===")

        from codedmap.analysis.detection.sanitizer_detector import SanitizerDetector
        from codedmap.analysis.tagging import TagEngine

        try:
            detector = SanitizerDetector(self.store, self.config)
            sanitizers = detector.detect_all()

            logger.info(f"[{self.name}] SanitizerPass: found {len(sanitizers)} sanitizer methods")

            if not sanitizers:
                logger.info(f"[{self.name}] No sanitizers detected.")
                return

            tagger = TagEngine(self.store)
            tagged_count = 0

            for sanitizer in sanitizers:
                node = self.store.get_node(sanitizer.node_id)
                if not node:
                    logger.debug(f"Node {sanitizer.node_id} not found for tagging")
                    continue

                tagger.add_system_tag(node, sanitizer.full_tag)
                tagged_count += 1

            logger.info(f"[{self.name}] SanitizerPass: tagged {tagged_count} nodes")

        except Exception as exc:
            logger.error(f"[{self.name}] Failed: {exc}")
            raise
