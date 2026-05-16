"""Base class for stream passes that run in-memory during parsing."""

import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from codedmap.core.schema.graph import CPGGraph
from codedmap.core.schema.graph.enums import ParseStrategy

logger = logging.getLogger(__name__)


class StreamPass(ABC):
    """
    Stream pass base class for in-memory analysis during parsing.

    Unlike BatchPass (which queries the database), StreamPass:
    1. Runs in worker process memory
    2. Input/output are CPGGraph objects (in-memory)
    3. Handles CFG, Local DDG, Local Ref etc. that don't need global info

    Runtime: Worker process memory.
    Responsibility: Enhance single-file in-memory graph (CFG, DDG, LocalRef).
    Constraint: Must NOT access database or perform cross-file queries.
    """

    def __init__(self, workspace: Optional[Path] = None):
        self.workspace = workspace or Path("./workspace")
        self.work_dir = self.workspace / "analysis"
        self._visited = set()

    @property
    def name(self) -> str:
        return self.__class__.__name__

    @property
    def skip_on_skeleton(self) -> bool:
        """
        Whether to skip this pass when parsing strategy is SKELETON.

        Default: True.
        Reason: SKELETON mode typically only parses interfaces without function bodies,
                so running CFG/DDG analysis is meaningless and wasteful.
        """
        return True

    def run_on_graph(self, graph: CPGGraph, strategy: ParseStrategy) -> CPGGraph:
        """
        Template method for the main analysis entry point.
        Handles strategy checking, error catching and flow control.

        Args:
            graph: Current file's in-memory graph (containing AST)
            strategy: Parse strategy for this file (FULL / SKELETON)

        Returns:
            Processed CPGGraph (usually the same graph modified in-place)
        """
        if not graph or not graph.nodes:
            return graph

        if strategy == ParseStrategy.SKELETON and self.skip_on_skeleton:
            return graph

        try:
            self.analyze(graph)
        except Exception as e:
            logger.error(f"[{self.name}] Failed to analyze graph: {e}", exc_info=True)

        return graph

    @abstractmethod
    def analyze(self, graph: CPGGraph):
        """
        Core logic implementation.
        Subclasses should modify graph structure via graph.add_edge / graph.add_node.

        Args:
            graph: In-memory graph object (Mutable)
        """
        pass
