# Skill Evolution Learnings

## 2026-04-21: improvement-generator.ts

### LLM Calling Pattern
- Use routeRequestWithDefaultModel for all LLM calls
- Temperature 0.3 for stability (same as balance-analyzer)
- max_tokens 4096 for content generation (more than analysis which uses 2048)
- Always provide context with userId, scene, and description

### JSON Parsing
- Reuse cleanJsonString and parseJsonFromContent from balance-analyzer.ts
- Handle multiple response formats: Claude, OpenAI, direct text
- Always handle parsing failures gracefully with default values

### SkillImprovement Model
- Fields: id, skillId, taskId, falsePositiveCases (JSON), confirmedCases (JSON), analysis (JSON), suggestions (JSON), improvedContent, status
- Status values: pending, applied, rejected
- Always save with status=pending for human approval workflow

### Skill Content Format
- Markdown format with sections: description, detection rules, examples, pitfalls, CWE numbers
- Key sections to modify: 常见误报排除 (common false positive exclusions), 陷阱与边缘情况 (pitfalls)
- Preserve original format and structure when improving

### Error Handling
- Create improvement record even on LLM failure (with original content)
- Log all errors with context for debugging
- Return meaningful warnings to caller

### Helper Functions Added
- getPendingImprovements: List all pending improvements for approval workflow
- getImprovementDetail: Get full details of a specific improvement record

## 2026-04-21: version-creator.ts

### Version Creation Pattern (from route.ts)
1. Mark current Skill version as isLatest=false
2. Create new Skill with version+1, parentId=current.id
3. Record to SkillEvolution table with changeType=evolution
4. Save to disk using saveSkillToDisk from skill-files.ts

### Key Imports
- @/lib/prisma - prisma client
- @/lib/id-generator - generateId function (prefixes: skill, evol)
- @/services/skill-files - saveSkillToDisk function
- ./improvement-generator - getImprovementDetail function

### SkillEvolution Model Fields
- id, skillId, fromVersion, toVersion, changeType, changeDesc, beforeData, afterData, reason, beforeRate, afterRate, createdAt
- beforeData/afterData: JSON string with displayName, description, content

### SkillImprovement Status Values
- pending -> applied (after applyImprovement)
- pending -> rejected (after rejectImprovement)

### SkillEvolutionTask Updates
- On apply: newVersionId, status=completed, completedAt
- On reject: status=rejected, completedAt

### Functions Implemented
- applyImprovement: Apply single improvement, create new version
- rejectImprovement: Reject single improvement with reason
- applyImprovementsBatch: Batch apply with error handling
- rejectImprovementsBatch: Batch reject with error handling

### Error Handling
- Disk save failure does NOT throw error (logged only)
- Status validation: only pending improvements can be applied/rejected
- Skill validation: must be latest version to create new version
## 2026-04-21: effect-comparator.ts

### Recall Calculation
- Recall = confirmedCount / totalFindings (confirmation rate)
- This represents how many reported findings were confirmed as real vulnerabilities
- Different from precision which is confirmed / (confirmed + falsePositive)

### Success Criteria
- isSuccess = precisionChange > 0 AND recallChange >= -0.05
- Precision must improve while recall cannot drop more than 5%

### SkillEvolutionTask Updates
- On success: status=completed, precisionAfter, recallAfter, completedAt
- On failure: status=rejected, same fields updated
- analysisResult stores JSON with change details and successReason

### Helper Functions
- calculateRecall: Internal function to compute recall from SkillMetrics
- batchCompareEvolutionEffect: Batch comparison with auto-update
- getEvolutionEffectSummary: Statistics for completed evolution tasks

### Error Handling
- Skill not found throws Error with descriptive message
- Batch processing continues on individual failures (logged only)
## 2026-04-21: evolution-scheduler.ts

### Scheduler Pattern
- scanAndCreateEvolutionTasks: Main function for scheduled scanning
- shouldTriggerEvolution: Check if a Skill needs evolution
- manualTriggerEvolution: Manual trigger for specific Skill

### Trigger Logic
- shouldTrigger = true if:
  1. precision < PRECISION_THRESHOLD (0.7)
  2. falsePositiveCount >= MIN_FALSE_POSITIVES (5)
  3. confirmedCount >= MIN_CONFIRMED (3)
- triggerReason values: 'low_precision' | 'high_false_positive' | 'manual'

### Daily Task Limit
- getTodayTaskCount: Count tasks created today
- MAX_DAILY_TASKS: 10 (default)
- Stops creating tasks when limit reached

### Pending Task Check
- hasPendingTask: Check if Skill already has pending task
- Skips Skills with existing pending tasks

### SkillEvolutionTask Creation
- Uses generateId('evotask') for task ID
- Fields: skillId, triggerReason, falsePositiveCount, confirmedCount, precisionBefore, status='pending'

### Configuration
- getEvolutionConfig: Fetch from SkillEvolutionConfig table or use defaults
- DEFAULT_EVOLUTION_CONFIG constants for fallback values

### Additional Functions
- getEvolutionTaskStats: Statistics for all evolution tasks
- manualTriggerEvolution: Manual trigger with validation

## 2026-04-21: task-manager.ts

### Task Status Transitions
- pending → analyzing → completed (success)
- pending → analyzing → rejected (failure)
- pending → rejected (manual rejection)
- Only pending tasks can start processing
- Only pending/analyzing tasks can be cancelled

### Main Functions Implemented
- getNextPendingTask: Get oldest pending task (FIFO)
- getPendingTasks: Get all pending tasks with limit
- getTasksByStatus: Filter by status
- getAllTasks: Paginated with filters
- startTaskProcessing: Update status to analyzing
- completeTask: Update status to completed with improvementId
- rejectTask: Update status to rejected with reason
- processEvolutionTask: Full processing flow
- processPendingTasks: Batch processing
- getTaskDetail: Get task with Skill and Improvement
- getTaskAnalysisResult: Parse analysisResult JSON
- cancelTask: Manual rejection
- getTaskStats: Statistics by status
- getSkillTaskHistory: Get tasks for a Skill

### Process Flow for processEvolutionTask
1. Get task and Skill (with content)
2. Start processing (status → analyzing)
3. Get evolution config
4. Get compact cases (falsePositives + confirmedCases)
5. Validate: must have at least 1 false positive and 1 confirmed case
6. Run analyzeBalance (LLM analysis)
7. Run generateImprovement (LLM content generation)
8. Complete task with improvementId

### Key Imports
- getEvolutionConfig from evolution-scheduler
- analyzeBalance from balance-analyzer
- generateImprovement from improvement-generator
- getCompactCases from case-extractor
- prisma from @/lib/prisma

### Error Handling
- Reject task on: Skill not found, content empty, no cases
- Catch all errors and reject task with error message
- Return TaskProcessResult with success/error

### SkillEvolutionTask Model Fields
- id, skillId, triggerReason, falsePositiveCount, confirmedCount, precisionBefore
- status (pending/analyzing/completed/rejected)
- analysisResult (JSON), improvementId, newVersionId, precisionAfter, recallAfter
- createdAt, completedAt

### SkillImprovement Relation
- One-to-one via taskId (unique)
- Task includes SkillImprovement in getTaskDetail
## 2026-04-21: config-manager.ts

### Config Management Pattern
- getConfig: Fetch from database, create default if not exists
- updateConfig: Validate first, filter allowed fields, then update
- resetToDefaults: Update all fields to DEFAULT_EVOLUTION_CONFIG values
- validateThresholds: Pure function for validation (no DB access)

### Validation Rules
- precisionThreshold: 0-1 (percentage as decimal)
- minFalsePositives: >= 0
- minConfirmed: >= 0
- maxDailyTasks: >= 1
- falsePositiveLimit: >= 1
- confirmedLimit: >= 1
- maxDescriptionLength: >= 50 (reasonable minimum)
- codeSnippetLines: >= 1
- scheduleCron: non-empty string

### Allowed Update Fields
- Only specific fields can be updated (id, updatedAt excluded)
- Field whitelist prevents accidental modification of protected fields

### Key Imports
- prisma from '@/lib/prisma'
- DEFAULT_EVOLUTION_CONFIG from evolution-scheduler
- SkillEvolutionConfig type from '@prisma/client'

### Helper Functions Added
- getConfigInfo: Returns config with lastUpdated timestamp
- isConfigActive: Quick check for active status
- setConfigActive: Toggle activation status

### Error Handling
- updateConfig throws Error on validation failure
- getConfig creates default config if missing (no error)
- resetToDefaults handles missing config gracefully
## 2026-04-21: Evolution Dashboard Page

### Files Created
- src/app/api/skills/evolution/config/route.ts - GET/PUT/POST for evolution config
- src/app/api/skills/evolution/tasks/route.ts - GET for evolution tasks with pagination
- src/app/api/skills/evolution/metrics/route.ts - GET for global evolution metrics
- src/app/dashboard/admin/skills-evolution/page.tsx - Full evolution dashboard page

### API Endpoints
- GET /api/skills/evolution/config - Fetch current evolution config
- PUT /api/skills/evolution/config - Update evolution config (with validation)
- POST /api/skills/evolution/config - Reset to defaults (action=reset)
- GET /api/skills/evolution/tasks - List evolution tasks with pagination and stats
- GET /api/skills/evolution/metrics - Global overview metrics

### Dashboard Features
1. Global Overview Cards:
   - Total Skills count (with skillsWithData)
   - Average Precision (with threshold comparison)
   - Evolution Tasks (pending/analyzing counts)
   - Evolution History (completed/rejected counts)

2. Findings Summary:
   - Correct findings (confirmed)
   - False positives
   - Total findings

3. Evolution Config Section:
   - Editable thresholds (precisionThreshold, minFalsePositives, minConfirmed, maxDailyTasks)
   - Enable/disable toggle
   - Save/Reset/Cancel buttons
   - Validation before save

4. Skills Needing Evolution List:
   - Skills below precision threshold
   - Expandable details with metrics
   - Click handlers: navigate to vulnerabilities (filtered), skill details

5. Evolution Task History:
   - Paginated task list
   - Status badges (pending/analyzing/completed/rejected)
   - Trigger reason labels
   - Expandable details
   - Click handlers: skill details, analysis review

### Navigation Routes
- /dashboard/admin/vulnerabilities?skillId={id}&status=false_positive - View false positives
- /dashboard/admin/vulnerabilities?skillId={id}&status=confirmed - View confirmed findings
- /dashboard/skills/{id} - Skill details page
- /dashboard/admin/skills-governance/analysis-review/{taskId} - Analysis review page

### UI Patterns Used
- Card components for overview sections
- Expandable list items (ChevronDown/ChevronUp)
- Status badges with color coding
- Form inputs for config editing
- Pagination controls
- LoadingSpinner for loading states
- Alert for error display
- AdminGuard for permission check

### TypeScript Fix
- Use optional chaining with proper null checks: 	tasks?.pagination?.totalPages && tasks.pagination.totalPages > 1
- Avoid direct property access on possibly undefined objects
## 2026-04-21: Version Comparison Page

### Files Created
- src/app/api/skills/evolution/tasks/[taskId]/route.ts - GET for single task detail with comparison
- src/app/dashboard/admin/skills-evolution/compare/[taskId]/page.tsx - Version comparison page

### API Endpoint
- GET /api/skills/evolution/tasks/{taskId} - Fetch single task detail
  - Returns: task, skill, improvement, comparison (EvolutionComparisonResult)
  - Uses getTaskDetail from task-manager.ts
  - Uses compareEvolutionEffect from effect-comparator.ts for completed tasks

### Page Features
1. Header Section:
   - Back navigation to evolution list
   - Status badge (pending/analyzing/completed/rejected)
   - Success/Failure indicator for completed tasks
   - Rollback button (for completed tasks with newVersionId)
   - Skill detail link

2. Task Info Section:
   - Trigger reason, creation time, completion time, improvement ID

3. Metrics Comparison Table:
   - Precision: old vs new with change indicator (↑/↓ arrows)
   - Recall: old vs new with change indicator
   - False Positive Rate: old vs new with change indicator
   - Counts: falsePositiveCount, confirmedCount, totalFindings

4. Trend Visualization (CSS/Tailwind bars):
   - Precision trend bar (before → after)
   - Recall trend bar (before → after)
   - False positive rate trend bar (before → after)
   - Color coding: green for improvement, red/yellow for decline

5. Success/Failure Analysis:
   - Success criteria display (precisionChange > 0, recallChange >= -0.05)
   - Success reason from comparison result
   - Error message if failed

6. Content Comparison:
   - Collapsible old version content
   - Collapsible new version content (from improvement)

7. Rollback Modal:
   - Uses SkillRollbackModal component
   - Calls /api/skills/{skillId}/rollback with targetVersionId

### UI Patterns Used
- AdminGuard wrapper for permission check
- LoadingSpinner for loading states
- Alert for error display
- SkillRollbackModal for rollback confirmation
- TrendBar component for simple CSS visualization
- ChangeIndicator component for ↑/↓ arrows with color

### TypeScript Considerations
- Escape JSX special characters: {'>'} and {'>='} in text
- Use null fallback for optional props: comparison?.precisionChange ?? 0
- Handle undefined vs null: after={comparison?.falsePositiveRateAfter ?? null}

### Success Criteria Display
- isSuccess = precisionChange > 0 AND recallChange >= -0.05
- Visual indicators: CheckCircle for pass, XCircle for fail
- Color coding: green for success, red for failure
