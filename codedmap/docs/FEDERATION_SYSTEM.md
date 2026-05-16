# Federation System Architecture

> Canonical references: `codedmap/app/services/domain/federation.py` (domain engine), `codedmap/core/schema/federation.py` (DTOs), `codedmap/core/schema/common.py` (GlobalNodeRef), `codedmap/infra/federation/adapters/sqlite_registry.py` (registry storage), `codedmap/cli/_bootstrap.py` (CLI execution), `codedmap/api/routers/federation.py` (REST API)

---

## Overview

The federation system is a cross-graph routing layer. It registers graphs and
stores explicit boundary edges between nodes in different graphs so downstream
tools can traverse across graph boundaries.

Federation data is stored in a standalone registry (`federation.db`) and does
not live inside any single CPG graph.

---

## Architecture Overview

| Property | Value |
|----------|-------|
| Domain module | `codedmap/app/services/domain/federation.py` |
| Addressing | `GlobalNodeRef` (graph_uri + node_id) |
| Registry | `SqliteFederationAdapter` (federation.db) |
| CLI | `cdm federation {register,link,neighbors}` |
| API | `POST /federation/register`, `POST /federation/link`, `POST /federation/neighbors` |
| Edge types | `IPC`, `SYSCALL`, `RPC`, `SHARED_DATA` |

---

## Core Concepts

### Graph URI

Graph URIs must match `scheme://path` where scheme is alphanumeric. Examples:

- `sqlite://graph.db`
- `neo4j://prod-cluster/main`
- `memory://test`

Invalid examples:

- `sqlite://` (empty path)
- `my-scheme://graph` (hyphen in scheme)

### GlobalNodeRef

Cross-graph node address:

- `graph_uri`: the graph identifier
- `node_id`: local node id inside that graph

### BoundaryEdgeType

Allowed cross-boundary relations:

- `IPC`
- `SYSCALL`
- `RPC`
- `SHARED_DATA`

These are shared with the CPG edge schema for interoperability.

---

## Registry Storage

The federation registry is a standalone SQLite file `federation.db` with:

- `graph_manifests` (registered graphs)
- `virtual_edges` (cross-graph edges)

Each `VirtualNeighbor` returned by the registry includes:

- Target node ref (graph_uri + node_id)
- Relation type
- Edge attributes (arbitrary JSON)
- Target graph manifest (routing envelope)

The registry is independent of CPG storage, allowing cross-backend routing.

---

## CLI Contract

### Register a graph

```bash
cdm federation register sqlite:///path/to/graph.db --db /path/to/graph.db \
  --metadata '{"project":"myapp","language":"python"}'
```

### Link two graphs

```bash
cdm federation link \
  sqlite:///path/to/graph_a.db \
  sqlite:///path/to/graph_b.db \
  RPC 101 42 \
  --db /path/to/graph_a.db \
  --properties '{"protocol":"grpc","method":"GetUser"}'
```

### Query cross-graph neighbors

```bash
cdm federation neighbors sqlite:///path/to/graph_a.db 101 \
  --db /path/to/graph_a.db --edge-types RPC
```

---

## REST API Contract

Endpoints:

- `POST /federation/register` -> GraphManifest (201)
- `POST /federation/link` -> LinkBoundaryResponse (200)
- `POST /federation/neighbors` -> NeighborsResponse (200)

Write endpoints (`register`, `link`) require `X-Agent-ID` header and hold the
store write lock. `neighbors` is read-only.

---

## Local Registry Location

Local CLI uses a registry file next to the provided `--db` path:

- If `--db /path/to/graph.db`, registry is `/path/to/federation.db`
- If no `--db` is provided, registry defaults to `./federation.db`

All federated graphs intended to link to each other should share the same
registry file.

---

## Neighbors Semantics

`neighbors` returns **single-hop** virtual neighbors. The `depth` parameter is
exposed by the catalog but is not currently used by the engine or adapter.

---

## When To Use

Use `federation` when you want to:

- Register multiple graphs into a shared routing registry
- Express explicit cross-graph relationships (RPC, IPC, SYSCALL, SHARED_DATA)
- Traverse or query across graph boundaries

Do NOT use `federation` for knowledge migration or projection. Use `knowledge`
for NOTE/TAG projection across graph rebuilds.

