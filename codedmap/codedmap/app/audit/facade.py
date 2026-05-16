# codedmap/app/audit/facade.py
"""
AuditFacade — Task-oriented audit workflow for agents.

Orchestrates the security audit pipeline: surface → trace → bundle → state writeback.
Composes existing low-level components into a single, agent-friendly API.

Usage:
    from codedmap.app.audit import AuditFacade, AuditConfig

    facade = AuditFacade(store)

    # One-shot full audit
    session = facade.collect_evidence()
    print(session.model_dump_json())

    # Step-by-step
    candidates = facade.scan_surface()
    for c in candidates:
        bundle = facade.trace_candidate(c)
        if bundle.has_controllable:
            print(f"Finding: {c.name} at {c.file}:{c.line}")

    # State writeback
    tagged = facade.apply_state(session, tag="STATE:AUDITED")
"""

import logging
from typing import List, Optional

from codedmap.infra.storage.store import CPGStore
from .models import AuditConfig, AuditSession, Candidate, EvidenceBundle, EvidencePath

logger = logging.getLogger(__name__)


class AuditFacade:
    """Task-oriented audit facade for agent workflows.

    Composes EntryPointDetector, BackwardTracingNavigator, TagEngine,
    and optionally ContextLoader into a unified audit API.

    Args:
        store: CPGStore instance for graph access.
        config: Default AuditConfig. Per-method overrides take precedence.
    """

    def __init__(self, store: CPGStore, config: Optional[AuditConfig] = None):
        self.store = store
        self._default_config = config or AuditConfig()
        self._detector = None
        self._tracer = None
        self._tagger = None
        self._context_loader = None

    # =========================================================================
    # Lazy component accessors
    # =========================================================================

    @property
    def _entry_detector(self):
        if self._detector is None:
            from codedmap.analysis.detection.entrypoint_detector import EntryPointDetector
            self._detector = EntryPointDetector(self.store)
        return self._detector

    @property
    def _tracing_navigator(self):
        if self._tracer is None:
            from codedmap.analysis.traversal.tracing import BackwardTracingNavigator
            self._tracer = BackwardTracingNavigator(self.store)
        return self._tracer

    @property
    def _tag_engine(self):
        if self._tagger is None:
            from codedmap.analysis.tagging.engine import TagEngine
            self._tagger = TagEngine(self.store)
        return self._tagger

    # =========================================================================
    # Public API
    # =========================================================================

    def scan_surface(self, config: Optional[AuditConfig] = None) -> List[Candidate]:
        """Discover attack-surface candidates (entry points).

        Wraps EntryPointDetector.detect_all() and converts results to
        Candidate domain objects.

        Args:
            config: Optional config override. Uses default if not provided.

        Returns:
            List of Candidate objects representing entry points.
        """
        cfg = config or self._default_config
        entry_points = self._entry_detector.detect_all()

        # Filter by category if specified
        if cfg.categories:
            cats_lower = {c.lower() for c in cfg.categories}
            entry_points = [
                ep for ep in entry_points
                if ep.category.value.lower() in cats_lower
            ]

        # Convert EntryPoint -> Candidate
        candidates = []
        for ep in entry_points:
            candidates.append(Candidate(
                node_id=ep.node_id,
                name=ep.name,
                file=ep.file,
                line=ep.line,
                category=ep.category.value,
                level=ep.level.value,
                rule_name=ep.rule_name,
                tags=ep.tags,
            ))

        return candidates

    def trace_candidate(
        self,
        candidate: Candidate,
        config: Optional[AuditConfig] = None,
    ) -> EvidenceBundle:
        """Trace a single candidate backward to find controllable inputs.

        Wraps BackwardTracingNavigator.trace_to_controllable() and converts
        the result into an EvidenceBundle with structured evidence paths.

        Args:
            candidate: The attack-surface candidate to trace.
            config: Optional config override.

        Returns:
            EvidenceBundle with all evidence paths for this candidate.
        """
        cfg = config or self._default_config

        trace_result = self._tracing_navigator.trace_to_controllable(
            start_node=candidate.node_id,
            max_depth=cfg.max_trace_depth,
            max_paths=cfg.max_paths_per_sink,
        )

        # Convert TracePath -> EvidencePath
        evidence_paths = []
        for tp in trace_result.paths:
            # Get sink info from first hop (if available)
            sink_name = ""
            sink_file = ""
            sink_line = 0
            if tp.hops:
                first_hop = tp.hops[0]
                sink_name = first_hop.code
                sink_file = first_hop.file
                sink_line = first_hop.line

            evidence_paths.append(EvidencePath(
                sink_node_id=trace_result.sink_node_id,
                sink_name=sink_name,
                sink_file=sink_file,
                sink_line=sink_line,
                hops=[h.to_dict() for h in tp.hops],
                found_controllable=tp.found_controllable,
                termination_reason=tp.termination_reason,
                depth=tp.depth,
            ))

        has_controllable = any(p.found_controllable for p in evidence_paths)

        bundle = EvidenceBundle(
            candidate=candidate,
            paths=evidence_paths,
            total_paths=len(evidence_paths),
            has_controllable=has_controllable,
        )

        # Optional context enrichment
        if cfg.include_context:
            bundle.context = self._get_context(candidate.node_id)

        return bundle

    def collect_evidence(
        self,
        candidates: Optional[List[Candidate]] = None,
        config: Optional[AuditConfig] = None,
    ) -> AuditSession:
        """Full audit: scan surface + trace all candidates + bundle evidence.

        Note: 'evidence' here means audit proof of vulnerability paths,
        distinct from tag Provenance (which tracks who applied a tag and why).
        See codedmap.core.schema.tags.provenance for tag provenance.

        This is the one-shot facade method. When called without arguments,
        it discovers all attack-surface candidates, traces each one, and
        bundles the evidence into an AuditSession.

        Args:
            candidates: Optional pre-discovered candidates. If None,
                scan_surface() is called first.
            config: Optional config override.

        Returns:
            AuditSession with all evidence bundles and summary statistics.
        """
        cfg = config or self._default_config

        # Step 1: Discover candidates
        if candidates is None:
            candidates = self.scan_surface(cfg)

        # Step 2: Trace each candidate
        bundles = []
        for candidate in candidates:
            try:
                bundle = self.trace_candidate(candidate, cfg)
                bundles.append(bundle)
            except Exception as e:
                logger.warning(
                    "Failed to trace candidate %s (node %d): %s",
                    candidate.name, candidate.node_id, e,
                )
                # Still include the candidate with empty evidence
                bundles.append(EvidenceBundle(
                    candidate=candidate,
                    paths=[],
                    total_paths=0,
                    has_controllable=False,
                ))

        # Step 3: Build session
        total_findings = sum(1 for b in bundles if b.has_controllable)
        session = AuditSession(
            bundles=bundles,
            total_candidates=len(candidates),
            total_findings=total_findings,
            config=cfg,
        )

        # Step 4: Auto-tag findings if configured
        if cfg.auto_tag and total_findings > 0:
            session.tagged_nodes = self.apply_state(session)

        return session

    def apply_state(
        self,
        session: AuditSession,
        tag: str = "STATE:AUDITED",
    ) -> List[int]:
        """Apply state tags to all candidates that have findings.

        Uses TagEngine to add state tags (L3 layer) to nodes where
        controllable input paths were discovered.

        Args:
            session: The audit session containing evidence bundles.
            tag: The state tag to apply (default: STATE:AUDITED).

        Returns:
            List of node IDs that were tagged.
        """
        tagged_ids = []
        for bundle in session.bundles:
            if bundle.has_controllable:
                node_id = bundle.candidate.node_id
                node = self.store.get_node(node_id)
                if node is not None:
                    try:
                        self._tag_engine.add(node, tag, applied_by="audit_facade")
                        tagged_ids.append(node_id)
                    except Exception as e:
                        logger.warning(
                            "Failed to tag node %d: %s", node_id, e,
                        )

        return tagged_ids

    # =========================================================================
    # Internal helpers
    # =========================================================================

    def _get_context(self, node_id: int) -> Optional[dict]:
        """Get enriched source context for a node."""
        try:
            if self._context_loader is None:
                from codedmap.analysis.traversal.context import ContextLoader, ContextStrategy
                self._context_loader = ContextLoader(self.store)
            node = self.store.get_node(node_id)
            if node is None:
                return None
            from codedmap.analysis.traversal.context import ContextStrategy
            return self._context_loader.get_context_data(node, ContextStrategy.SUMMARY)
        except Exception as e:
            logger.warning("Failed to load context for node %d: %s", node_id, e)
            return None
