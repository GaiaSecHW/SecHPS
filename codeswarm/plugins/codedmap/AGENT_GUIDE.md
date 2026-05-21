# CodeDMap Agent Guide

> Code Property Graph CLI — Agent Code Audit Reference
>
> Version: v2.2 (Schema `1.0.0`) | Last updated: 2026-03-20

This guide is for **AI Agents** driving code security audits via the CodeDMap CLI. It covers the full command reference, hybrid audit workflow templates, vulnerability discovery methodology, broken call-chain handling, and AI + CPG collaboration best practices.

---

## Table of Contents

0. [Core Concepts: Digital Twin + Code Atlas](#0-core-concepts-digital-twin--code-atlas)
1. [Quick Start](#1-quick-start)
2. [CLI Command Reference](#2-cli-command-reference)
3. [Global Conventions](#3-global-conventions)
4. [Command Details](#4-command-details)
5. [Hybrid Audit Workflow (Three-Phase)](#5-hybrid-audit-workflow-three-phase)
6. [Vulnerability Discovery Methodology](#6-vulnerability-discovery-methodology)
7. [Broken Call-Chain Handling](#7-broken-call-chain-handling)
8. [AI + CPG Hybrid Audit Strategy](#8-ai--cpg-hybrid-audit-strategy)
9. [JSON Output Format](#9-json-output-format)
10. [One-Liners for Common Operations](#10-one-liners-for-common-operations)
11. [Error Handling and Retry Strategy](#11-error-handling-and-retry-strategy)
12. [Tag System Quick Reference](#12-tag-system-quick-reference)

---

## 0. Core Concepts: Digital Twin + Code Atlas

> **One-sentence summary**: The Code Property Graph (CPG) is a **digital twin** of source code — it fuses source text, AST, control flow, data flow, and call relationships into a single **queryable graph database**. You navigate this graph via the CLI to conduct security audits.

### Architecture Overview

```
+------------------------------------------------------------+
|                       Source Code                           |
|  .c / .py / .java / .go / .js / ...                        |
+---------------------------+--------------------------------+
                            |  cdm build / Joern export
                            v
+------------------------------------------------------------+
|                  graph.db (CPG Database)                    |
|                                                             |
|  +---------+  +-----------+  +---------+  +---------+      |
|  |   AST   |  | Call Graph|  |   CFG   |  |   DDG   |      |
|  | Syntax  |  | Calls     |  | Control |  | Data    |      |
|  | Tree    |  | between   |  | Flow    |  | Flow    |      |
|  |         |  | functions |  | Graph   |  | Graph   |      |
|  +---------+  +-----------+  +---------+  +---------+      |
|  +---------+  +-----------+                                 |
|  |  Tags   |  | Insights  |  <- Agent-writable              |
|  | Security|  | Audit     |                                 |
|  | Labels  |  | Notes     |                                 |
|  +---------+  +-----------+                                 |
+---------------------------+--------------------------------+
                            |
                            v
+------------------------------------------------------------+
|             CLI (python -m codedmap.cli)                    |
|                                                             |
|  stats -> tree -> search -> entrypoints -> inspect -> trace |
|                             tag -> note                     |
|                                                             |
|  All commands: --output json --db graph.db                  |
+------------------------------------------------------------+
```

### Core Mental Model

| Concept | CLI | Analogy |
|---------|-----|---------|
| **Node** | Returned `id` in all commands | Code entity: function, call, variable, file |
| **Tag** | `tag add/find/list` | Labels attached to nodes (security properties, audit state) |
| **Note** | `note add/list` | Audit annotations attached to nodes |
| **Entry Point** | `cdm query entrypoints` | Attack surface: where external input enters the program |
| **Taint Path** | `cdm query trace --taint` | Data flow from entry point to dangerous operation |
| **Reachability** | `cdm query trace --reachable` | Whether an execution path exists between two functions |

### Two Audit Approaches

```
+-----------------------------------------------------------------------------+
|                          Audit Methodology Comparison                        |
+-----------------------------------------------------------------------------+
|                                                                              |
|  Approach 1: Dangerous Function Backtracking                                 |
|  --------------------------------------------------------------------------  |
|  Start: memcpy, strcpy, popen, system, sprintf, exec...                     |
|  Direction: Backward trace (from dangerous function to user input)           |
|  Pros: High efficiency, low false positives, native CPG support              |
|  Cons: Only finds "dangerous function" class bugs; misses semantic vulns     |
|                                                                              |
|  Approach 2: Attack Entry Forward Tracing                                    |
|  --------------------------------------------------------------------------  |
|  Start: argv, env, socket, file, HTTP request, user input...                |
|  Direction: Forward trace (from user input to sensitive operation)           |
|  Pros: Comprehensive coverage, finds semantic-level vulnerabilities          |
|  Cons: Lower efficiency, higher false positives; needs "sensitive ops" def   |
|                                                                              |
|  Best Practice: Use both (dangerous-function scan first for speed,          |
|  then entry-point forward trace for depth)                                   |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 1. Quick Start

```bash
# Prerequisite: a built CPG database (graph.db)
export CDM_DB=/path/to/graph.db

# 1. Project overview
cdm query stats --output json

# 2. Project structure
cdm query tree --output json

# 3. Search for dangerous functions
cdm query search "memcpy|strcpy|popen|system" --type call --output json

# 4. Check entry points
cdm query entrypoints --output json

# 5. Taint trace from a sink
cdm query trace -f memcpy --taint --depth 15 --output json
```

**Agents MUST always use `--output json`** to get structured, parseable output.

---

## 2. CLI Command Reference

9 domains, grouped by audit mental model:

### Orientation — Understand the project

| Command | Purpose | Target Required? |
|---------|---------|-----------------|
| `cdm query stats` | Graph statistics: nodes/edges, languages, modules list, tag overview | No |
| `cdm query tree` | Project structure: files/classes/functions hierarchy | No |
| `cdm query search <pattern>` | Find nodes by name pattern | No |
| `cdm query entrypoints` | Attack surface entry points (L1/L2/L3) | No |
| `cdm query sources` | Detected taint sources | No |
| `cdm query sinks` | Detected sinks | No |
| `cdm query guards` | Detected guards | No |
| `cdm query sanitizers` | Detected sanitizers | No |
| `cdm query roles` | Detected roles | No |

### Investigation — Deep dive into specific code

| Command | Purpose | Target Required? |
|---------|---------|-----------------|
| `cdm query inspect` | Node details: source, callers, callees, tags, notes | Yes |
| `cdm query inspect --detail` | Deep slice: DDG data flow in/out, scope chain | Yes |
| `cdm query inspect --hierarchy` | Class inheritance view | Yes |
| `cdm query inspect --module <name>` | Module details + metrics | No (module name) |
| `cdm query trace` | Recursive caller chain (default mode) | Yes |
| `cdm query trace --taint` | Backward taint trace: from sink to controllable input | Yes |
| `cdm query trace --dataflow` | Data flow slice (DDG) | Yes |
| `cdm query trace --reachable` | CFG reachability check (two endpoints) | Dual endpoints |

### Annotation — Record findings

| Command | Purpose | Target Required? |
|---------|---------|-----------------|
| `cdm tag add/remove/list/find/bulk` | Security tag CRUD | Varies by subcommand |
| `cdm note add/list/show/remove` | Audit note CRUD | Varies by subcommand |

### Module Management — Organize code boundaries

| Command | Purpose |
|---------|---------|
| `cdm module create/delete/rename/list/show/assign/remove` | Module CRUD |

### Build and Repair — System-level operations

| Command | Purpose |
|---------|---------|
| `cdm build <project>` | Build CPG database from source code |
| `cdm build enhance` | Run analysis passes on existing database |
| `cdm repair link/suggest/list/undo` | Repair broken call-chain edges |
| `cdm rules list/add-sink/tombstone/...` | Manage detection rules |
| `cdm assets export/import/diff/anchor/merge` | Asset migration |
| `cdm serve --db <path> --port <port>` | Start REST API server |

---

## 3. Global Conventions

### 3.1 Common Parameters

Every command supports these common parameters:

```
Connection:
  --db <path>             Database path (or set $CDM_DB env var)
  --backend <type>        Storage backend: sqlite (default) | neo4j | memory

Target (priority high to low):
  --node-id <N>           Exact node ID (recommended for disambiguation)
  --file <F> --line <L>   File path + line number
  --function <name>  / -f <name>   Find by function name

Output:
  --output json            JSON structured output (required for agents)
  --output text            Human-readable text (default)
  --offset <N>             Pagination offset (default 0)
```

### 3.2 Target Resolution Priority

```
1. --node-id N       -> store.get_node(N)         Most precise
2. --file F --line L -> NodeResolver.resolve_location(F, L)
3. -f name           -> NodeResolver.resolve_function(name)  May be ambiguous
```

> **Important**: When `-f name` matches multiple nodes, the CLI returns `AMBIGUOUS_TARGET` error with a candidate list. The agent should re-invoke with `--node-id`.

### 3.3 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (including business errors in JSON mode) |
| 1 | Uncaught exception |
| 130 | Interrupted (Ctrl+C) |

In `--output json` mode, all business errors (node not found, invalid argument, etc.) are returned via the JSON envelope with exit code 0. Agents should check the `success` field, not the exit code.

---

## 4. Command Details

### 4.1 `cdm query stats` — Project Overview

```bash
cdm query stats --db graph.db --output json
```

Returns total nodes, total edges, language list, tag overview, modules list. This is the agent's first step when approaching a project.

**JSON `result` shape**:
```json
{
  "nodes": [{
    "total_nodes": 12345,
    "total_edges": 45678,
    "files": 120,
    "methods": 890,
    "modules": 15,
    "entry_points": 42,
    "insights": 3,
    "languages": ["c", "cpp"],
    "node_counts": {"METHOD": 890, "CALL": 3200},
    "top_tags": [["ONTOLOGY:ENTRY_POINT:HTTP", 5]],
    "modules_list": [
      {"name": "crypto", "full_name": "subsystem.crypto", "tags": ["HIGH_VALUE_CRYPTO"]}
    ]
  }],
  "total": 1
}
```

### 4.2 `cdm query tree` — Project Structure

```bash
cdm query tree --db graph.db --output json
cdm query tree --depth 3 --style markdown --output json
```

**Parameters**:
- `--depth N`: Max directory depth (default 5)
- `--style ascii|markdown|indent`: Output style (default ascii)

**JSON `result` shape**:
```json
{
  "skeleton": "src/\n  main.c\n    main()\n    process_input()\n  utils.c\n    helper()\n"
}
```

### 4.3 `cdm query search <pattern>` — Pattern Search

```bash
cdm query search "mem.*cpy" --type method --limit 10 --output json
```

**Parameters**:
- `pattern`: Name regex
- `--type method|call|identifier`: Node type (default: method; use `--all` for all types)
- `--limit N`: Max results (default 20)

**JSON `result` shape**:
```json
{
  "nodes": [
    {"id": 1234, "name": "memcpy", "file": "src/utils.c", "line": 42, "label": "METHOD"},
    {"id": 1235, "name": "memmove", "file": "src/utils.c", "line": 78, "label": "METHOD"}
  ],
  "total": 2
}
```

### 4.4 `cdm query entrypoints` — Attack Surface Entry Points

```bash
cdm query entrypoints --output json
cdm query entrypoints --level L1 --category network --output json
cdm query entrypoints --level L2 --output json
cdm query entrypoints --with-context --lines 30 --output json
```

**Parameters**:
- `--level L1|L2|L3`: Filter by tagging level (L1=system-detected, L2=agent-discovered, L3=state)
- `--category <cat>`: Filter by category (network, file, ipc, etc.)
- `--with-context`: Include source code snippet
- `--lines N`: Context lines around entry point (default 10)

**JSON `result` shape**:
```json
{
  "nodes": [
    {
      "id": 42,
      "name": "handle_request",
      "file": "src/server.c",
      "line": 100,
      "label": "METHOD",
      "tags": ["ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"],
      "context": "void handle_request(int fd) {\n    ...\n}"
    }
  ],
  "total": 1
}
```

### 4.5 `cdm query inspect` — Node Details

```bash
# Basic inspection
cdm query inspect -f handle_request --output json

# Full slice (DDG + scope)
cdm query inspect -f handle_request --detail --output json

# Class hierarchy
cdm query inspect -f MyClass --hierarchy --output json

# Module details
cdm query inspect --module crypto --output json
```

**JSON `result` shape (default)**:
```json
{
  "target": {"id": 42, "name": "handle_request", "file": "src/server.c", "line": 100},
  "source": "void handle_request(int fd) { ... }",
  "callers": [{"id": 10, "name": "main", ...}],
  "callees": [{"id": 55, "name": "read", ...}],
  "tags": ["ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"],
  "notes": []
}
```

### 4.6 `cdm query trace` — Call-Chain and Taint Tracing

```bash
# Caller chain (default)
cdm query trace -f memcpy --depth 5 --output json

# Backward taint trace from sink
cdm query trace -f memcpy --taint --depth 15 --output json

# Data flow slice (DDG)
cdm query trace -f process_input --dataflow --output json

# CFG reachability
cdm query trace -f main --reachable --to-function dangerous_func --output json
```

**Parameters**:
- `--depth N`: Maximum traversal depth (default 5)
- `--taint`: Backward taint trace to controllable input
- `--dataflow`: DDG data flow slice
- `--reachable --to-function <name>`: CFG reachability between two functions

**JSON `result` shapes**:

| Mode | Shape |
|------|-------|
| callers (default) | `{"chain": [{node_id, name, file, line, label, depth, edge_type}, ...], "mode": "callers"}` |
| `--dataflow` | `{"entries": [{node_id, file, line, code, is_origin, label}, ...], "mode": "dataflow"}` |
| `--reachable` | `{"reachable": bool, "path": [...], "path_length": N, "mode": "reachable"}` |
| `--taint` | `{"sink_node_id": N, "paths": [...], "found_controllable": bool, "mode": "taint"}` |

### 4.7 `cdm tag` — Security Tags

```bash
# Add a tag
cdm tag add --node-id 42 --tag "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER" --db graph.db

# Remove a tag
cdm tag remove --node-id 42 --tag "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER" --db graph.db

# List tags on a node
cdm tag list -f handle_request --db graph.db --output json

# Find all nodes with a tag
cdm tag find "ONTOLOGY:SINK:MEMORY_WRITE" --db graph.db --output json

# Bulk apply tags from file
cdm tag bulk --file tags.json --db graph.db
```

### 4.8 `cdm note` — Audit Notes

```bash
# Add a global note
cdm note add "CVE candidate: unchecked memcpy in parse_header()" \
  --category VULNERABILITY --title "Heap overflow in parser" --db graph.db

# Add a note attached to a node
cdm note add "handle_request() processes data before authentication" --node-ids 42 --category VULNERABILITY \
  --title "Entry point lacks auth check" \
  --db graph.db

# List all notes
cdm note list --db graph.db --output json

# Show full note content
cdm note show --note-id <id> --db graph.db --output json

# Remove a note
cdm note remove --note-id <id> --db graph.db
```

### 4.9 `cdm module` — Module Management

```bash
# List all modules
cdm module list --db graph.db --output json

# Show module details
cdm module show crypto --db graph.db --output json

# Create a module
cdm module create crypto --description "Cryptographic subsystem" --db graph.db

# Assign files to module
cdm module assign crypto --paths "src/crypto/*.c" --db graph.db
```

### 4.10 `cdm rules` — Rule Management

```bash
# List all active rules
cdm rules list --db graph.db --output json

# Show full merged ruleset
cdm rules show --merged --db graph.db --output json

# Add a sink rule
cdm rules add-sink my_unsafe_copy MEMORY_WRITE --db graph.db

# Suppress a global rule
cdm rules tombstone SINK-001 --reason "Not applicable to this project" --db graph.db
```

### 4.11 `cdm repair` — Call-Chain Repair

```bash
# Find unresolved CALL nodes
cdm repair suggest --db graph.db --output json

# Create a missing edge
cdm repair link --from-node-id 100 --to-function target_func --db graph.db

# List active repairs
cdm repair list --db graph.db --output json

# Undo a repair
cdm repair undo --repair-id R001 --db graph.db
```

---

## 5. Hybrid Audit Workflow (Three-Phase)

### Phase 1: Dangerous Function Scan (Quick Scan)

**Goal**: Quickly find common vulnerability classes, prioritize efficiency.

```
1. Project overview
   - cdm query stats --output json
   - cdm query tree --output json

2. Search for dangerous functions
   - Memory ops: cdm query search "memcpy|strcpy|strcat|sprintf" --type call
   - Command exec: cdm query search "popen|system|exec" --type call
   - Format strings: cdm query search "printf|fprintf" --type call

3. Analyze each dangerous function call
   - cdm query inspect --node-id <id> --output json
   - cdm query trace --node-id <id> --taint --depth 15 --output json

4. Record findings
   - Confirmed vuln -> cdm note add with VULNERABILITY category
   - Suspicious -> cdm tag add with ONTOLOGY:ROLE:REVIEW_TARGET
```

**Vulnerabilities detectable**:
- Buffer overflow (memcpy/strcpy/strcat)
- Command injection (popen/system/exec)
- Format string (printf/sprintf)
- Memory management issues (malloc/free)

### Phase 2: Attack Entry Forward Tracing (Deep Analysis)

**Goal**: Find semantic-level vulnerabilities with comprehensive coverage.

```
1. Identify all attack surfaces
   - cdm query entrypoints --output json
   - cdm query sources --output json

2. Forward-trace data flow from each entry point
   - cdm query trace -f <entrypoint_func> --dataflow --output json

3. Check sensitive operations along the path
   - cdm query sinks --output json
   - cdm query inspect --node-id <sink_id> --output json

4. Analyze security guards
   - cdm query guards --output json
   - cdm query sanitizers --output json
```

**Vulnerabilities detectable**:
- All Phase 1 vulnerabilities
- Path traversal (user input -> open)
- Privilege escalation (user input -> setuid)
- Information leakage (user input -> send/write)
- Business logic vulnerabilities

### Phase 3: Semantic Validation (Confirmation)

**Goal**: Validate exploitability, discover business logic vulnerabilities.

```
1. Deep inspect suspicious nodes
   - cdm query inspect -f <func> --detail --output json

2. Verify reachability
   - cdm query trace -f <entry> --reachable --to-function <sink> --output json

3. Annotate confirmed findings
   - cdm note add "<details>" --node-ids <id> --category VULNERABILITY ...
   - cdm tag add --node-id <id> --tag "ONTOLOGY:SINK:MEMORY_WRITE" ...

4. Mark audited paths
   - cdm tag add --node-id <id> --tag "ONTOLOGY:STATE:AUDITED" ...
```

### Complete Workflow Diagram

```
+-----------------------------------------------------------------------------+
|                         Hybrid Audit Workflow                                |
+-----------------------------------------------------------------------------+
|                                                                              |
|  Phase 1: Dangerous Function Scan                                            |
|  stats + tree -> search dangerous funcs -> taint trace -> record            |
|  Finds: buffer overflow, command injection, format string                    |
|  Speed: High | False positives: Low | False negatives: High (semantic)      |
|                                |                                             |
|                                v                                             |
|  Phase 2: Attack Entry Forward Tracing                                       |
|  entrypoints + sources -> forward trace -> check sinks -> check guards      |
|  Finds: path traversal, privilege escalation, info leak, logic bugs         |
|  Speed: Medium | False positives: Medium | False negatives: Low             |
|                                |                                             |
|                                v                                             |
|  Phase 3: Semantic Validation                                                |
|  deep inspect -> verify reachability -> annotate -> mark audited            |
|  Finds: logic vulns, validates exploitability                                |
|  Speed: Low | Accuracy: High | Value: Validation + supplementation          |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 6. Vulnerability Discovery Methodology

### 6.1 Vulnerability Classes and Detection Methods

| Vulnerability Type | Detection Method | Difficulty |
|-------------------|-----------------|------------|
| **Buffer overflow** | Search memcpy/strcpy + trace parameter source | Low |
| **Command injection** | Search popen/system + analyze command construction | Low |
| **Format string** | Search printf/sprintf + check format string | Low |
| **SQL injection** | Search SQL ops + analyze query construction | Medium |
| **Path traversal** | Entry point tracing + file operation analysis | Medium |
| **Privilege escalation** | Entry point tracing + permission op analysis | High |
| **Information leakage** | Entry point tracing + network op analysis | Medium |
| **Business logic vuln** | Deep semantic analysis | High |
| **Race condition** | Timing analysis | High |

### 6.2 Dangerous Function Quick Reference

```bash
# Memory operations
cdm query search "memcpy|memmove|memset|strcpy|strncpy|strcat|strncat|sprintf|snprintf" --type call

# Command execution
cdm query search "popen|system|execve|execvp|execl" --type call

# File operations
cdm query search "open|fopen|stat|unlink|chmod|chown|rename" --type call

# Network operations
cdm query search "send|recv|connect|accept|socket" --type call

# Privilege operations
cdm query search "setuid|setgid|chroot|chmod|chown" --type call
```

### 6.3 Taint Path Analysis Pattern

```bash
# Step 1: Find dangerous sink
SINK_ID=$(cdm query search "memcpy" --type call --output json | jq '.result.nodes[0].id')

# Step 2: Backward taint trace from sink
cdm query trace --node-id $SINK_ID --taint --depth 20 --output json

# Step 3: Check if controllable input is found
# If found_controllable=true in result, the path is potentially exploitable

# Step 4: Annotate the sink
cdm tag add --node-id $SINK_ID --tag "ONTOLOGY:SINK:MEMORY_WRITE" --db graph.db
cdm note add "Taint trace found path from user input to this memcpy call" --node-ids $SINK_ID --category VULNERABILITY \
  --title "Potentially exploitable memcpy" \
  --db graph.db
```

---

## 7. Broken Call-Chain Handling

CPG databases built from incomplete compilation units, function pointers, or external libraries may have broken call-chain edges. This is normal — use the repair system.

### 7.1 Detect Broken Chains

```bash
# Find unresolved CALL nodes (calls with no CALL edge to a METHOD)
cdm repair suggest --db graph.db --output json
```

**Result shape**:
```json
{
  "nodes": [
    {
      "call_node_id": 500,
      "call_name": "crypto_init",
      "file": "src/main.c",
      "line": 42,
      "candidates": [
        {"id": 600, "name": "crypto_init", "file": "src/crypto/init.c", "line": 10}
      ]
    }
  ]
}
```

### 7.2 Repair a Broken Edge

```bash
# Create a missing CALL edge
cdm repair link --from-node-id 500 --to-function crypto_init --db graph.db

# Or use node ID for precision
cdm repair link --from-node-id 500 --to-node-id 600 --db graph.db
```

### 7.3 Review and Undo Repairs

```bash
# List all active repairs
cdm repair list --db graph.db --output json

# Undo a repair
cdm repair undo --repair-id R001 --db graph.db
```

### 7.4 Strategies for Incomplete Graphs

When taint tracing returns no path despite suspicious code patterns:

1. **Check via `cdm repair suggest`** — are there unresolved CALLs along the expected path?
2. **Repair broken edges** — `cdm repair link` to patch missing CALL edges
3. **Manual trace via inspect** — use `cdm query inspect --detail` to navigate DDG manually
4. **Fallback to source code reading** — for heavily broken graphs, direct file inspection is the fallback

---

## 8. AI + CPG Hybrid Audit Strategy

### When to Use CPG vs. Direct Source Reading

| Task | Use CPG | Use Direct Read |
|------|---------|-----------------|
| Attack surface discovery | `cdm query entrypoints` | When CPG graph is incomplete |
| Dangerous function search | `cdm query search` | Always more efficient via CPG |
| Taint path tracing | `cdm query trace --taint` | When call graph is broken |
| Module boundary analysis | `cdm module show` + `cdm query inspect --module` | Never needed if CPG is built |
| Vulnerability validation | Both | Final confirmation always requires source read |
| Business logic analysis | CPG provides structure | AI semantic understanding required |

### Best Practice: CPG-First, Source-as-Fallback

```
1. Start with cdm query stats + tree — orient yourself
2. Use cdm query entrypoints + sources — map attack surface
3. Use cdm query trace --taint from sinks — find exploitable paths
4. Use cdm query inspect --detail — understand suspicious nodes
5. Read source code directly only when CPG path is inconclusive
6. Annotate all findings with cdm note add + cdm tag add
7. Mark audited nodes with STATE:AUDITED tag to track progress
```

### Agent Annotation Contract

All findings MUST be annotated for traceability:

```bash
# Confirmed vulnerability
cdm note add "<detailed description with attack path>" --node-ids <id> --category VULNERABILITY \
  --title "<vuln type>: <function name>" \
  --confidence 0.9 --db graph.db

# Suspicious (needs more analysis)
cdm tag add --node-id <id> \
  --tag "ONTOLOGY:ROLE:REVIEW_TARGET" \
  --justification "Suspicious pattern: user input flows to dangerous function" \
  --db graph.db

# Audited clean
cdm tag add --node-id <id> \
  --tag "ONTOLOGY:STATE:AUDITED" \
  --justification "Reviewed: input is validated before use" \
  --db graph.db
```

---

## 9. JSON Output Format

### Envelope Schema (v1.0.0)

Every `--output json` response follows this schema:

```json
{
  "schema_version": "1.0.0",
  "command": "trace",
  "target": {
    "id": 123,
    "name": "main",
    "file": "main.c",
    "line": 10,
    "label": "METHOD"
  },
  "result": {"nodes": [...], "total": N},
  "metadata": {"total": N, "has_more": false, "limit": 50},
  "success": true,
  "error": null
}
```

### Error Envelope

```json
{
  "schema_version": "1.0.0",
  "command": "inspect",
  "target": null,
  "result": null,
  "metadata": {},
  "success": false,
  "error": {
    "code": "NODE_NOT_FOUND",
    "message": "No node found matching function name 'unknown_func'"
  }
}
```

### Error Codes

| Code | HTTP Equivalent | Meaning |
|------|----------------|---------|
| `NODE_NOT_FOUND` | 404 | Node not found |
| `MODULE_NOT_FOUND` | 404 | Module not found |
| `AMBIGUOUS_TARGET` | 422 | Multiple nodes match; use --node-id |
| `AMBIGUOUS_MODULE` | 422 | Multiple modules match |
| `INVALID_ARGUMENT` | 400 | Bad parameter |
| `DB_CONNECTION_ERROR` | 503 | Database unavailable |
| `NO_RESULTS` | 200 | Query succeeded but returned nothing |

### Pagination

All list commands support `--offset N` for pagination:

```bash
# Get next page of results
cdm query search "memcpy" --limit 20 --offset 20 --output json
```

The `metadata.has_more` field indicates whether more results are available.

---

## 10. One-Liners for Common Operations

```bash
# Full attack surface overview
cdm query stats --output json && cdm query entrypoints --output json

# Find all memory dangerous functions
cdm query search "memcpy|strcpy|strcat|sprintf|gets" --type call --output json

# Taint trace all dangerous functions (loop)
for func in memcpy strcpy popen system; do
  echo "=== $func ===" && cdm query trace -f "$func" --taint --depth 15 --output json
done

# Find all nodes with VULNERABILITY tags
cdm tag find "ONTOLOGY:VULNERABILITY" --output json

# List all audit notes
cdm note list --output json

# Module-scoped entry point analysis
cdm query entrypoints --module network --output json

# Export all audit assets
cdm assets export --output json
```

---

## 11. Error Handling and Retry Strategy

### Ambiguous Target

```bash
# First attempt: may return AMBIGUOUS_TARGET
cdm query trace -f process --output json

# Error response includes candidates:
# {"error": {"code": "AMBIGUOUS_TARGET"}, "result": {"candidates": [{"id": 1, ...}, {"id": 2, ...}]}}

# Second attempt: use node ID for precision
cdm query trace --node-id 1 --output json
```

### Database Not Found

```bash
# Set CDM_DB environment variable
export CDM_DB=/path/to/graph.db

# Or pass --db explicitly
cdm query stats --db /path/to/graph.db --output json
```

### Empty Results (NO_RESULTS)

`NO_RESULTS` is a success state — the query ran cleanly but found nothing. Do NOT retry. Check:
1. Is the pattern correct? Try a simpler search.
2. Is the database built for the right source directory?
3. Does the function/node exist? Use `cdm query search` first.

### Rate Limiting (Remote Mode)

When using `--remote <url>` against a shared server:
- Respect `Retry-After` headers in 429 responses
- Add `CDM_AGENT_ID` header to identify your agent session

---

## 12. Tag System Quick Reference

CodeDMap uses a colon-separated hierarchical tag format: `PREFIX:CATEGORY:VALUE`

### L1 Tags (System-Detected, Read-Only for Agents)

| Tag Prefix | Category Examples | Meaning |
|-----------|------------------|---------|
| `ONTOLOGY:ENTRY_POINT:` | `NETWORK_LISTENER`, `HTTP`, `RPC`, `WEBSOCKET`, `SYSCALL` | Attack surface entry points |
| `ONTOLOGY:SOURCE:` | `NETWORK_DATA`, `FILE_DATA`, `ENV_DATA`, `IPC_DATA`, `USER_SPACE_DATA` | Taint sources |
| `ONTOLOGY:SINK:` | `MEMORY_WRITE`, `CODE_EVAL`, `FILE_ACCESS`, `NETWORK_SEND`, `MEMORY_FREE` | Dangerous sinks |
| `ONTOLOGY:GUARD:` | `BOUNDS_CHECK`, `NULL_CHECK`, `TYPE_CHECK`, `AUTH_CHECK`, `STATE_CHECK` | Security guards |
| `ONTOLOGY:SANITIZER:` | `ESCAPE`, `ENCODE`, `TYPE_CAST`, `TRUNCATE`, `NORMALIZE` | Sanitizers |
| `ONTOLOGY:ROLE:` | `REVIEW_TARGET`, etc. | Functional roles |

### L2 Tags (Agent-Writable, Requires Justification)

| Tag Prefix | Meaning |
|-----------|---------|
| `SEMANTIC:ENTRY_POINT:` | Agent-discovered entry points |
| `SEMANTIC:SOURCE:` | Agent-discovered taint sources |
| `SEMANTIC:PROTOCOL:` | Protocol-level tagging |

### L3 Tags (State, Agent-Writable)

| Tag | Meaning |
|-----|---------|
| `ONTOLOGY:STATE:AUDITED` | This node has been reviewed |
| `ONTOLOGY:STATE:FALSE_POSITIVE` | Confirmed not vulnerable |
| `ONTOLOGY:DRAFT:*` | Provisional analysis |

### Adding L2/L3 Tags

L2 and L3 tags require a `--justification` argument:

```bash
cdm tag add --node-id 42 \
  --tag "SEMANTIC:ENTRY_POINT:HTTP" \
  --justification "This function handles raw HTTP request data via recv()" \
  --db graph.db
```

### Tag-Based Audit Tracking

```bash
# Mark entry point as reviewed
cdm tag add --node-id 42 --tag "ONTOLOGY:STATE:AUDITED" \
  --justification "Reviewed: proper input validation in place" --db graph.db

# Find unaudited sinks
cdm tag find "ONTOLOGY:SINK:" --output json | \
  jq '[.result.nodes[] | select(.tags | map(test("STATE:AUDITED")) | any | not)]'
```
