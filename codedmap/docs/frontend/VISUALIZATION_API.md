# Visualization API

Frontend integration contract for the Phase 08 visualization endpoint.

This document is intended for frontend developers and frontend agents. It is the shortest safe path to integrating with the current graph visualization API without reading backend implementation files first.

## Endpoint

- Method: `POST`
- Path: `/api/v1/graph/visualize`
- Response type: bare `VisualizeResponse`

## Important Exception

This endpoint is an explicit exception to the rest of the API.

Most backend routes return a `CLIResponse`-style envelope. This one does not.

Read the response as:

```json
{
  "nodes": [...],
  "edges": [...]
}
```

Do not expect any of these top-level fields:

- `result`
- `metadata`
- `success`
- `error`
- `command`
- `schema_version`

## Request Contract

### TypeScript shape

```ts
export type GraphLens =
  | "CALL_GRAPH"
  | "DATA_FLOW"
  | "CONTROL_FLOW"
  | "ARCHITECTURE";

export type SemanticSignature = {
  node_label: string;
  name: string;
  file_path: string;
  content_hash?: string | null;
};

export type VisualizeRequest = {
  entry_points: SemanticSignature[];
  depth?: number;
  lens: GraphLens;
};
```

### Field rules

- `entry_points` uses semantic identity, not backend node IDs.
- `depth` defaults to `1` if omitted.
- `depth` must be between `1` and `3`.
- `lens` must be one of the four uppercase enum values above.

### Minimal request example

```json
{
  "entry_points": [
    {
      "node_label": "METHOD",
      "name": "orders.create",
      "file_path": "services/orders.py"
    }
  ],
  "lens": "CALL_GRAPH"
}
```

## Response Contract

### TypeScript shape

```ts
export type VisTag = {
  name: string;
  source: string;
  reason: string;
  severity?: string | null;
};

export type VisNoteSummary = {
  type: string;
  status: string;
  message: string;
};

export type VisNode = {
  id: string;
  label: string;
  node_type: string;
  file_path?: string | null;
  line_start?: number | null;
  line_end?: number | null;
  tags: VisTag[];
  notes_summary: VisNoteSummary[];
  is_federation_gateway: boolean;
};

export type VisEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
};

export type VisualizeResponse = {
  nodes: VisNode[];
  edges: VisEdge[];
};
```

### Field rules

- Response top level is always `nodes` plus `edges`.
- `node_type` is an open string, not a frontend-locked enum.
- `severity` is an open string and may be `null`.
- `status` is an open string and may evolve.
- `file_path`, `line_start`, and `line_end` may be `null`.
- `tags` and `notes_summary` are always arrays.
- `is_federation_gateway` is the correct boolean field.
- There is no `is_boundary` field.

## ID Semantics

Treat all `id`, `source`, and `target` values as opaque visualization IDs.

Do not assume:

- they are numeric database IDs
- they are stable storage primary keys
- they can be decoded into backend identity

They are only safe to use for:

- React keys
- graph node identity in the client
- edge source/target linking inside the returned payload

## Current Mock Behavior

The endpoint is intentionally mock-backed in Phase 08. The route already accepts real request input, but the returned graph content is still fixed contract data.

Current mock semantics intentionally demonstrate:

- a node with non-empty `tags`
- a node with non-empty `notes_summary`
- a node with `is_federation_gateway: true`
- a node with nullable source anchors

Frontend code should rely on the contract shape, not on the exact mock labels or messages.

## Integration Guidance

### Fetch example

```ts
export async function fetchVisualizeGraph(
  baseUrl: string,
  body: VisualizeRequest
): Promise<VisualizeResponse> {
  const response = await fetch(`${baseUrl}/api/v1/graph/visualize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`visualize request failed: ${response.status}`);
  }

  return (await response.json()) as VisualizeResponse;
}
```

### Rendering guidance

- Read data from `response.nodes` and `response.edges` directly.
- Render missing `file_path` / line fields as optional metadata.
- Use `tags` and `notes_summary` as overlay/UI decoration, not as required fields.
- Style `is_federation_gateway` as a distinct visual affordance if needed.

## Frontend Do/Don't

### Do

- Treat the endpoint as contract-first and shape-stable.
- Write tolerant UI for nullable location metadata.
- Accept unknown future `node_type`, `status`, `severity`, and `relation` strings.
- Build the graph view around `nodes` and `edges` only.

### Don't

- Do not read `result.nodes` or `result.edges`.
- Do not assume this route follows the backend's normal envelope convention.
- Do not hardcode exact mock text labels as business logic.
- Do not depend on IDs being database-backed.
- Do not expect traversal depth semantics beyond request validation yet.

## Source of Truth

If this document and code ever diverge, the real contract is defined by:

- [`codedmap/core/schema/visualize.py`](/Users/kibox/ai_workspace/cpg_sdk_simple/codedmap/core/schema/visualize.py)
- [`codedmap/api/routers/visualize.py`](/Users/kibox/ai_workspace/cpg_sdk_simple/codedmap/api/routers/visualize.py)
- [`tests/api/test_visualize_router.py`](/Users/kibox/ai_workspace/cpg_sdk_simple/tests/api/test_visualize_router.py)
- [`tests/core/schema/test_visualize_schema.py`](/Users/kibox/ai_workspace/cpg_sdk_simple/tests/core/schema/test_visualize_schema.py)
