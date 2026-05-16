import os
import sys

import pytest
from pydantic import ValidationError

sys.path.append(os.getcwd())

from codedmap.core.schema.common import SemanticSignature
from codedmap.core.schema.visualize import (
    GraphLens,
    VisNode,
    VisNoteSummary,
    VisTag,
    VisualizeRequest,
    VisualizeResponse,
)


class TestVisualizeSchema:
    def test_graph_lens_values_are_locked(self):
        assert [lens.value for lens in GraphLens] == [
            "CALL_GRAPH",
            "DATA_FLOW",
            "CONTROL_FLOW",
            "ARCHITECTURE",
        ]

    def test_visualize_request_accepts_semantic_signatures(self):
        request = VisualizeRequest(
            entry_points=[
                SemanticSignature(
                    node_label="METHOD",
                    name="orders.create",
                    file_path="src/orders.py",
                )
            ],
            lens=GraphLens.CALL_GRAPH,
        )

        assert len(request.entry_points) == 1
        assert isinstance(request.entry_points[0], SemanticSignature)
        assert request.entry_node_ids is None

    def test_visualize_request_accepts_physical_entry_node_ids(self):
        request = VisualizeRequest(
            entry_node_ids=["101", "102"],
            lens=GraphLens.CALL_GRAPH,
        )

        assert request.entry_node_ids == ["101", "102"]
        assert request.entry_points is None

    def test_visualize_request_depth_defaults_to_one(self):
        request = VisualizeRequest(
            entry_points=[
                SemanticSignature(
                    node_label="METHOD",
                    name="orders.create",
                    file_path="src/orders.py",
                )
            ],
            lens=GraphLens.DATA_FLOW,
        )

        assert request.depth == 1

    def test_visualize_request_rejects_depth_above_three(self):
        with pytest.raises(ValidationError):
            VisualizeRequest(
                entry_points=[
                    SemanticSignature(
                        node_label="METHOD",
                        name="orders.create",
                        file_path="src/orders.py",
                    )
                ],
                depth=4,
                lens=GraphLens.CONTROL_FLOW,
            )

    def test_vis_node_allows_missing_source_anchors(self):
        node = VisNode(
            id="viz:gateway:1",
            label="Architecture Gateway",
            node_type="FEDERATION_GATEWAY",
        )

        assert node.file_path is None
        assert node.line_start is None
        assert node.line_end is None

    def test_vis_tag_severity_is_optional(self):
        tag = VisTag(
            name="ONTOLOGY:ROLE:BOUNDARY",
            source="phase-08-test",
            reason="Boundary metadata is available for overlay rendering.",
        )

        assert tag.severity is None

    def test_vis_note_summary_exposes_exact_fields(self):
        VisNoteSummary(type="SECURITY_BOUNDARY", status="OPEN", message="Ingress path.")

        assert set(VisNoteSummary.model_fields.keys()) == {"type", "status", "message"}

    def test_visualize_response_dumps_nodes_and_edges_at_top_level(self):
        response = VisualizeResponse(
            nodes=[
                VisNode(
                    id="viz:entry:1",
                    label="orders.create",
                    node_type="ENTRY_POINT",
                )
            ],
            edges=[],
        )

        dumped = response.model_dump(mode="json")

        assert set(dumped.keys()) == {"nodes", "edges"}
