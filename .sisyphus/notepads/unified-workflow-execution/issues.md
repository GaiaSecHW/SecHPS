# Issues - Unified Workflow Execution

## 2026-04-22: Scope Fidelity Check (Task F4)

### CRITICAL VIOLATION: Database Schema Modified

**Issue**: `prisma/schema.prisma` was modified, changing ModelConfig defaults:
- `maxTokens`: 4096 → 32000
- `temperature`: 0.7 → 0.3

**Plan Requirement**: "不修改数据库 schema" (Must NOT modify database schema)

**Impact**: This violates the explicit guardrail in the plan. These changes affect default model behavior for ALL users, not just the workflow execution feature.

**Recommendation**: Revert schema changes or get explicit approval from orchestrator.

---

### Scope Violation Summary

#### Expected Files (VERIFIED ✓)

| File | Status | Notes |
|------|--------|-------|
| `src/lib/workflow/types.ts` | ✓ Created | Per plan Task 1 |
| `src/lib/workflow/topology-sort.ts` | ✓ Created | Per plan Task 2 |
| `src/lib/workflow/unified-execution-engine.ts` | ✓ Created | Per plan Task 3 |
| `src/lib/vulnerability/parser.ts` | ✓ Created | Per plan Task 7 |
| `src/lib/reports/unified-report-generator.ts` | ✓ Created | Per plan Task 8 |
| `src/app/api/projects/[id]/start/route.ts` | ✓ Modified | Per plan Task 4 |
| `src/lib/fsm/fsm-workflow-execution-service.ts` | ✓ Modified | Per plan Task 5 |
| `src/app/dashboard/sessions/[id]/page.tsx` | ✓ Modified | Per plan Task 6 |

#### Unexpected New Files (NOT IN PLAN)

| Category | Files | Count |
|----------|-------|-------|
| FSM Helpers | `fsm-node-executor.ts`, `fsm-prompt-builder.ts`, `fsm-skill-loader.ts`, `index.ts`, `phase-io.ts`, `schemas/phase-schemas.ts`, `validators/phase-validator.ts` | 7 files |
| Reports | `fsm-report-generator.ts` | 1 file |
| Workspace | `report-scanner.ts` | 1 file |
| MCP Client | `mcp-client.ts` | 1 file |
| FSM Templates API | `route.ts`, `[id]/route.ts`, `[id]/phases/[phase]/route.ts` | 4 files |
| FSM Templates Dashboard | `page.tsx`, `[id]/page.tsx` | 3 files |
| Skills App | `[id]/evolution/page.tsx`, `[id]/versions/page.tsx` | 4 files |

**Total**: 20+ unexpected new files

#### Unexpected Modified Files (NOT IN PLAN)

| File | Changes | Notes |
|------|---------|-------|
| `prisma/schema.prisma` | +2/-2 lines | **CRITICAL** - Schema modified |
| `prisma/seed.ts` | +195 lines | FSM template seeding added |
| `package.json` | +1 dep, +1 script | `yaml` dep (acceptable), `db:seed-fsm` script |
| `src/app/api/agent/execute/route.ts` | +2 lines | Unknown change |
| `src/app/api/models/route.ts` | +8/- lines | Unknown change |
| `src/app/api/token-stats/route.ts` | +6/- lines | Unknown change |
| `src/app/api/evaluations/[id]/report/route.ts` | +1 line | Unknown change |
| `src/app/api/workflows/[id]/roles/route.ts` | +65 lines | Role model mapping endpoint |
| `src/app/dashboard/admin/skills-governance/analysis-review/page.tsx` | +7/- lines | Unknown change |
| `src/app/dashboard/evaluations/[id]/report/page.tsx` | +250 lines | Report page enhancement |
| `src/app/dashboard/layout.tsx` | +6 lines | Layout change |
| `src/app/dashboard/models/page.tsx` | +12/- lines | Models page change |
| `src/app/dashboard/sessions/page.tsx` | +79/- lines | Sessions list change |
| `src/components/workflow/NodePalette.tsx` | +9/- lines | Workflow component change |
| `src/components/workflow/WorkflowEditor.tsx` | +3/- lines | Workflow editor change |
| `src/lib/agent-executor.ts` | +7/- lines | Agent executor change |
| `src/lib/logger.ts` | +2 lines | Logger change |
| `src/lib/model-client.ts` | +18/- lines | Model client change |
| `src/services/ai/claude-agent.ts` | +7 lines | Claude agent change |
| `src/services/evaluation/enhanced-caller.ts` | +2 lines | Enhanced caller change |
| `src/types/workflow.ts` | +318 lines | Workflow types expansion |

**Total**: 21 unexpected modified files

---

### Acceptable Changes

| Change | Reason |
|--------|--------|
| `yaml` dependency in package.json | Plan mentions YAML file handling for state passing |
| Minor type fixes in existing files | Required for TypeScript compilation compatibility |

---

### Recommendations

1. **CRITICAL**: Revert `prisma/schema.prisma` changes or get explicit approval
2. **Review**: Audit all unexpected modified files to determine if they are necessary for the feature
3. **Consider**: FSM template management system (API + Dashboard) appears to be a separate feature that should be tracked separately
4. **Consider**: Skills versioning/evolution pages appear to be a separate feature

---

### Scope Expansion Analysis

The refactoring appears to have expanded beyond the original scope:

1. **FSM Template Management System** - Full CRUD API + Dashboard UI for FSM templates
2. **Skills Versioning/Evolution** - New pages for skill version management
3. **Report Enhancements** - Significant additions to report generation and viewing
4. **Model Configuration Changes** - Default model parameters modified globally

These additions may be valuable but were NOT part of the original plan and should be reviewed by the orchestrator.

---

### Verification Commands Used

```bash
git status --porcelain
git diff --stat [files]
Get-ChildItem -Path [directories]
```