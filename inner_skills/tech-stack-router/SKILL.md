---
name: tech-stack-router
description: "Lean tech-stack router for security audits. Use this skill whenever you need to identify architecture signals, choose the smallest correct set of references, or decide which specialist dimensions should activate."
---

# Tech Stack Router Skill

Use this skill to decide which references and specialists should activate.

## Use when

- identifying languages, frameworks, deployment shape, and key boundaries
- deciding which references, checklists, or specialists should load
- reducing reference loading to the minimum useful set

## Required reads

1. Read `references/reference_registry.yaml`
2. Query `references/reference_index.json` through `.opencode/scripts/query-reference-index.mjs` only when the registry is not enough
3. Then read only the primary and supplemental references that the registry or query results point to

## Semantic reference index

`references/reference_index.json` is a generated cache, not a required read.
Do not open it in full. Use:

```bash
node .opencode/scripts/query-reference-index.mjs --agent audit-spec-injection --signals java,spring,sql --limit 20
node .opencode/scripts/query-reference-index.mjs --summary
```

Prefer these fields from query results:

- `signals`
- `related_agents`
- `related_skills`
- `must_load_when`
- `phase`
- `tags`

## Routing rules

- The registry is the routing authority.
- The semantic reference index is the discovery and filtering layer.
- The runtime specialist defaults and baseline patterns come from `.opencode/scripts/audit-config.cjs`.
- Do not treat leaf markdown files as routing authority by themselves.

## Expected outputs

- tech-stack signals
- references to load, split into primary vs supplemental
- recommended specialists or audit dimensions
