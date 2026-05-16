# codedmap/analysis/passes/batch/sink_pass.py
"""
SinkPass - Batch pass for sink detection and tagging.

Runs after CallGraphPass to ensure the call graph and AST edges are
available for enclosing METHOD resolution.

Detects dangerous sink call sites via SinkDetector and tags the enclosing
METHOD nodes using TagEngine (add_system_tag -> L1 ONTOLOGY tag).

Output: Tags METHOD nodes with ONTOLOGY:SINK:{category} format tags.
"""

import logging
from typing import Optional

from codedmap.analysis.passes.base_batch import BaseBatchPass
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.executor.runner import BaseRunner
from codedmap.core.configs.analysis import AnalysisConfig
from codedmap.core.configs.storage import StorageConfig

logger = logging.getLogger(__name__)


class SinkPass(BaseBatchPass):
    """
    Batch pass for sink detection and tagging.

    Runs SinkDetector to find all dangerous sink call sites, then tags
    their enclosing METHOD nodes via TagEngine for persistence.

    Dependencies:
    - CallGraphPass: Ensures call graph edges are present; consistent with
      SourcePass dependency pattern. AST edges needed for parent METHOD
      resolution are present from the ingestion phase.

    Output:
    - Tags METHOD nodes with ONTOLOGY format: ONTOLOGY:SINK:{category}
      e.g., ONTOLOGY:SINK:MEMORY_WRITE, ONTOLOGY:SINK:OS_COMMAND
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
        # No edges to prune — this pass only adds tags to METHOD nodes
        self.prune_targets = []

    def run(self) -> None:
        """
        Execute sink detection and tagging.

        1. Create SinkDetector and detect all dangerous sinks
        2. For each Sink, fetch the METHOD node from the store
        3. Tag the METHOD node with sink.full_tag via TagEngine
        4. Log summary statistics
        """
        logger.info(f"=== [{self.name}] Starting Sink Detection ===")

        # Lazy imports — keeps module-level deps minimal and avoids import cycles
        from codedmap.analysis.detection.sink_detector import SinkDetector
        from codedmap.analysis.tagging import TagEngine

        try:
            detector = SinkDetector(self.store, self.config)
            sinks = detector.detect_all()

            logger.info(f"[{self.name}] SinkPass: found {len(sinks)} sink methods")

            if not sinks:
                logger.info(f"[{self.name}] No sinks detected.")
                return

            tagger = TagEngine(self.store)
            tagged_count = 0

            for sink in sinks:
                node = self.store.get_node(sink.node_id)
                if not node:
                    logger.debug(f"Node {sink.node_id} not found for tagging")
                    continue

                tagger.add_system_tag(node, sink.full_tag)
                tagged_count += 1

            logger.info(f"[{self.name}] SinkPass: tagged {tagged_count} nodes")

        except Exception as exc:
            logger.error(f"[{self.name}] Failed: {exc}")
            raise
