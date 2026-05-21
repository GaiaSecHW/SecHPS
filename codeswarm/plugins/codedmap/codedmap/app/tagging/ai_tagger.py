# codedmap/app/tagging/ai_tagger.py
"""
On-demand AI-powered security tagging.

Extracted from SecurityTaggingPass to support per-method AI tagging
instead of batch-only mode. Uses ContextLoader for context assembly
and SecurityTaggingAgent for LLM-based classification.

Outputs L2 SEMANTIC tags (e.g., SEMANTIC:SINK:SQL_INJECTION) with
confidence scores stored in TagProvenance.
"""

import logging
from typing import List, Optional

from codedmap.core.schema.graph.nodes import MethodNode, CPGNode
from codedmap.infra.storage.store import CPGStore
from codedmap.analysis.traversal.context import ContextLoader, ContextStrategy
from codedmap.analysis.tagging.engine import TagEngine
from codedmap.core.schema.tags.matcher import SecurityTagMatcher
from codedmap.core.schema.tags.layer import TagLayer

logger = logging.getLogger(__name__)


class AITagger:
    """
    On-demand AI security tagger.

    Unlike SecurityTaggingPass (batch mode), this class allows tagging
    individual methods or a scoped subset, with optional budget control.

    Outputs L2 SEMANTIC tags with confidence tracking:
        - Tag format: SEMANTIC:{ROLE}:{CATEGORY} (e.g., SEMANTIC:SINK:SQL_INJECTION)
        - Provenance: applied_by="ai", confidence from LLM

    Usage:
        tagger = AITagger(store, tag_engine=tag_engine)
        tagger.tag_method(method_node)
        tagger.tag_methods(method_nodes, budget_limit=100)
    """

    def __init__(
        self,
        store: CPGStore,
        tag_engine: Optional[TagEngine] = None,
        model: str = None,
        api_key: str = None,
        api_base: str = None
    ):
        self.store = store
        self.context_loader = ContextLoader(store)
        self._tag_engine = tag_engine
        self._agent = None
        self._model = model
        self._api_key = api_key
        self._api_base = api_base

    def _ensure_agent(self):
        """Lazily initialize the SecurityTaggingAgent."""
        if self._agent is not None:
            return
        try:
            from codedmap.infra.ai.services.taint_tagger import SecurityTaggingAgent
            self._agent = SecurityTaggingAgent(
                model=self._model or "gpt-4",
                api_key=self._api_key,
                api_base=self._api_base,
            )
        except Exception as e:
            logger.error(f"Failed to initialize SecurityTaggingAgent: {e}")
            raise

    def _ensure_tag_engine(self):
        """Lazily initialize TagEngine if not provided."""
        if self._tag_engine is None:
            self._tag_engine = TagEngine(self.store)

    def tag_method(self, method: MethodNode) -> List[str]:
        """
        Run AI tagging on a single method.

        Outputs L2 SEMANTIC tags with confidence tracking.

        Returns:
            List of tag strings applied (e.g., ["SEMANTIC:SINK:SQL_INJECTION"]).
        """
        self._ensure_agent()
        self._ensure_tag_engine()

        context_data = self.context_loader.get_context_data(method, strategy=ContextStrategy.PRECISE_SLICE)

        code = context_data.get("code", "")
        if not code or len(code.strip()) < 10:
            return []

        try:
            result = self._agent.analyze(**context_data)
        except Exception as e:
            logger.error(f"AI tagging failed for method {getattr(method, 'name', '?')}: {e}")
            return []

        if not result or not result.tags:
            return []

        applied = []
        min_confidence = 0.8
        for tag_decision in result.tags:
            if tag_decision.role == "NONE":
                continue
            if tag_decision.confidence < min_confidence:
                continue
            category_slug = tag_decision.category.upper().replace(" ", "_").replace("-", "_")
            tag_name = f"{TagLayer.SEMANTIC.value}:{tag_decision.role}:{category_slug}"
            try:
                tag_result = self._tag_engine.add(
                    node=method,
                    tag=tag_name,
                    applied_by="ai",
                    confidence=tag_decision.confidence
                )
                if tag_result.action in ("added", "already_exists"):
                    applied.append(tag_name)
            except Exception as e:
                logger.warning(f"Failed to add tag {tag_name}: {e}")

        return applied

    def tag_methods(self, methods: List[MethodNode], budget_limit: Optional[int] = None) -> int:
        """
        Run AI tagging on multiple methods with optional budget control.

        Args:
            methods: List of MethodNode to tag.
            budget_limit: Max number of methods to tag (None = unlimited).

        Returns:
            Number of methods that received at least one tag.
        """
        tagged_count = 0
        for i, method in enumerate(methods):
            if budget_limit is not None and i >= budget_limit:
                logger.info(f"Budget limit reached ({budget_limit}), stopping AI tagging.")
                break

            existing_tags = getattr(method, 'tags', []) or []
            if any(SecurityTagMatcher.is_security_tag(t) for t in existing_tags):
                continue

            if getattr(method, 'is_external', False):
                continue

            tags = self.tag_method(method)
            if tags:
                tagged_count += 1

        return tagged_count
