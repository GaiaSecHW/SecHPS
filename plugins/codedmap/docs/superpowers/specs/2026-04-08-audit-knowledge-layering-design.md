# Audit Knowledge Layering Design

**Date:** 2026-04-08

## Goal

Introduce a minimal knowledge-layering model for audit artifacts so the system can:

- evaluate new workflows on a clean per-run audit layer without rebuilding the underlying code graph
- preserve stable project knowledge across audit rounds
- prevent previous campaign notes and audit state from leaking into new discovery runs by default

This design focuses on current-state knowledge semantics. It does not replace the unified audit log; it defines what knowledge exists now, which layer it belongs to, and what the workflow should read by default.

## Problem

The current system mixes two different kinds of information in the same graph-backed knowledge layer:

- stable project knowledge that should persist across runs
- per-run audit products that should be isolated

In practice, this causes contamination between audit rounds. A newly executed workflow can inherit:

- previous Hunter or Surveyor summaries
- previous suspicious or reviewed status
- previous target selection outputs
- previous tentative conclusions

This makes it difficult to answer whether a new workflow truly improved discovery, because it may simply be benefiting from prior run artifacts.

At the same time, fully clearing all knowledge between runs is also undesirable because some knowledge should persist:

- call graph repair
- module boundaries
- stable semantic tags such as assets, trust boundaries, or entrypoints
- reusable rules and rule sources

The system needs an explicit distinction between reusable knowledge and run-scoped audit products.

## Scope

This phase introduces an MVP for audit knowledge layering.

Included:

- a layering model for audit knowledge
- a per-run `campaign_id`
- note-level metadata for `scope`, `knowledge_class`, and `campaign_id`
- workflow read defaults that isolate historical campaign output
- a boundary between knowledge-layer state and the future unified audit log

Not included:

- a full promotion workflow UI
- tag storage redesign
- historical migration of old notes
- new graph/workspace physical isolation
- complete audit log implementation
- broad cross-campaign search and analytics

## Design Principles

### 1. Keep Code Graph and Knowledge Layer Separate

The underlying CPG, repair data, module definitions, and rules can remain reusable. The contamination problem is primarily in the audit knowledge layer, not the graph build itself.

### 2. Prefer One Model With Two Modes Over Two Separate Systems

The system should support both:

- clean workflow regression evaluation
- long-lived project memory

These should be two operating modes on the same knowledge model, not two unrelated mechanisms.

### 3. Current State and Event History Are Different Concerns

The knowledge layer determines:

- what a note means now
- which layer it belongs to
- whether a workflow should read it now

The unified audit log determines:

- who changed it
- when it changed
- how it moved through its lifecycle

The two designs are complementary and should not be collapsed into one mechanism.

## Knowledge Model

### Semantic Types

All audit artifacts should be classified as one of:

- `fact`: a relatively stable, reusable, and reviewable statement about the codebase
- `assessment`: a run-specific risk or importance judgment
- `workflow_state`: process state for the current audit round

### Storage Layers

Knowledge is assigned to one of:

- `stable_confirmed`
- `stable_candidate`
- `campaign`

Layer meanings:

- `stable_confirmed`: durable, workflow-visible knowledge that has been confirmed by a human or by a sufficiently high-confidence confirmation path
- `stable_candidate`: durable-looking but not yet fully confirmed knowledge; usually AI-supported, evidence-backed facts
- `campaign`: run-scoped knowledge and process output isolated by `campaign_id`

### Mapping Rules

- `fact` -> `stable_candidate` or `stable_confirmed`
- `assessment` -> `campaign`
- `workflow_state` -> `campaign`

This mapping is normative for the workflow. If an artifact is primarily a run judgment or process state, it must not become durable project knowledge by default.

## Artifact Classification

### Stable Confirmed

These should usually live in `stable_confirmed`:

- validated call graph repair
- stable module definitions
- reusable rules and rule provenance
- confirmed public API or entrypoint tags
- confirmed `ASSET:*` tags
- confirmed `TRUST_BOUNDARY:*` tags
- stable architecture and structural notes

### Stable Candidate

These may live in `stable_candidate` if evidence is strong:

- AI-generated but reviewable asset, trust-boundary, or entrypoint facts
- stable boundary definitions extracted from evidence
- stable data-flow or control-flow facts with clear traceability
- vulnerability evidence facts such as source, sink, path, missing validation, and trigger preconditions

### Campaign

These must remain run-scoped:

- Hunter, Surveyor, or Analyst summaries
- STRIDE matrices
- suspicious, reviewed, duplicate, or false-positive state
- target selection outputs
- candidate queues
- open questions
- triage conclusions
- exploitability, severity, and run-specific confidence judgments
- current-owner, workflow status, and other process markers

## Mixed Artifact Splitting

Some note categories mix stable facts with run-specific judgments. These must be split by content, not treated as single-layer objects.

### SECURITY_BOUNDARY

Stable fact examples:

- boundary type
- trust transition
- stable entry nodes
- long-lived required guards

Campaign examples:

- observed guards in this run
- linked sinks under current investigation
- exploit hypotheses
- current status or owner

### VULNERABILITY

Stable candidate fact examples:

- source node
- sink node
- supporting path
- missing guard or validation condition
- reproducible trigger preconditions

Campaign examples:

- severity
- exploitability judgment
- false-positive or duplicate status
- remediation priority
- triage owner or workflow state

## Stable-Layer Admission Rules

An artifact may enter `stable_candidate` only if all of the following hold:

- it is a `fact`
- it points to a concrete object such as nodes, paths, rules, files, or modules
- it includes a reviewable evidence chain
- it can be rechecked by a human or agent
- it is likely to remain valid in a fresh campaign
- its mistaken retention would not heavily pollute future discovery

An artifact may enter `stable_confirmed` if it satisfies the candidate criteria and one of the following is true:

- it was explicitly human-confirmed
- it was independently reproduced across runs
- it is supported by multiple strong evidence sources
- it is close to a mechanical structural fact

Run-scoped artifacts must never be promoted solely because they are useful. Usefulness is not the same as stability.

## Current-State Metadata

The MVP stores knowledge-layer semantics on the note itself rather than in a separate table.

Each note should carry metadata with at least:

- `scope`
- `knowledge_class`
- `campaign_id`

Recommended additional metadata for forward compatibility:

- `review_state`
- `visibility`
- `evidence_bundle`
- `promoted_from`

Recommended metadata example:

```json
{
  "scope": "campaign",
  "knowledge_class": "assessment",
  "campaign_id": "cmp_20260408_example",
  "review_state": "unreviewed",
  "visibility": "default",
  "evidence_bundle": {}
}
```

## Workflow Defaults

The audit workflow should default to reading:

- `stable_confirmed`
- current `campaign_id`

The workflow should not read:

- historical `campaign` artifacts by default
- `stable_candidate` by default unless explicitly enabled

This read policy is the core behavior change that prevents prior Hunter or STRIDE output from leaking into new audit rounds.

## MVP Scope

The MVP intentionally limits implementation to notes.

Included in MVP:

- add note metadata support for `scope`, `knowledge_class`, and `campaign_id`
- add note query filters for `scope`, `campaign_id`, and `knowledge_class`
- generate and inject `campaign_id` in `tools/audit_workflow.py`
- change workflow defaults to consume `stable_confirmed + current_campaign`

Deferred:

- tag metadata redesign
- note promotion commands
- tag promotion commands
- full candidate-confirmed review workflow
- historical backfill
- workspace or graph physical isolation

## Interface Direction

### Note Writes

`note add` should accept optional:

- `scope`
- `knowledge_class`
- `campaign_id`
- `metadata`

Default behavior for workflow-generated audit notes:

- `scope=campaign`
- `knowledge_class=assessment`
- `campaign_id=<current campaign>`

### Note Reads

`note list` should support filtering by:

- `scope`
- `campaign_id`
- `knowledge_class`

`note show` should return note metadata in full.

## Relationship To Unified Audit Log

This design does not replace the unified audit log described in
`docs/superpowers/specs/2026-04-08-unified-audit-log-design.md`.

The responsibility split is:

- note or tag state answers: what this artifact is now
- audit log answers: how this artifact got here

Therefore:

- current layer membership belongs on the note or tag object
- lifecycle events belong in the audit log

Future audit-log operations should include not only `note_add` and `tag_add`, but also:

- `knowledge_promote`
- `knowledge_confirm`
- `knowledge_reject`
- `knowledge_expire`

However, the workflow must not depend on the audit log to determine current layer visibility.

## Implementation Order

Recommended order:

1. implement note metadata for layering
2. implement note read filters
3. inject `campaign_id` into `audit_workflow.py`
4. update workflow prompts and defaults
5. implement promotion mechanics
6. implement unified audit log

This order solves behavioral correctness first and observability second.

## Decision

Adopt a note-first audit knowledge layering MVP based on:

- `scope`
- `knowledge_class`
- `campaign_id`

Use this to isolate per-run audit products while preserving stable reusable knowledge. Keep current-state knowledge semantics on the domain object, and use the future unified audit log only for mutation history and lifecycle traceability.
