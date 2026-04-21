# Learnings - Unified Workflow Execution

## 2026-04-22: Type Definitions Created

### Pattern: Type Definition Structure
- Created `src/lib/workflow/types.ts` with unified execution engine types
- Followed existing FSM type patterns from `src/lib/fsm/fsm-workflow-execution-service.ts`
- Referenced WorkflowNode model from Prisma schema for field alignment

### Key Types Created:
1. **UnifiedNodeDefinition** - Unified node definition combining FSM and custom workflow fields
2. **ModelConfigForExecution** - Model configuration for execution (id, name, providerType, apiKey, apiBaseUrl, models)
3. **UnifiedExecutionConfig** - Execution configuration with retry settings (maxRetries: 15, retryDelayMs: 60000)
4. **UnifiedExecutionCallbacks** - Execution callbacks for real-time status updates
5. **NodeExecutionResult** - Node execution result with error stack tracking
6. **WorkflowExecutionResult** - Workflow execution result with full error details
7. **UnifiedYamlOutput** - YAML output format (no vulnerability info, includes error stack)

### Design Decisions:
- YAML output does NOT include vulnerability information (per inherited wisdom)
- Error tracking includes full stack trace for debugging
- Retry mechanism: 15 retries, 1 minute interval (per inherited wisdom)
- Added auxiliary types: RoleModelMapping, ExecutionContext, RetryConfig

### File Location:
- `src/lib/workflow/types.ts` - 322 lines, comprehensive type definitions

---

## 2026-04-22: Topology Sort Utilities Created

### Pattern: Kahn's Algorithm for DAG Topological Sort
- Created `src/lib/workflow/topology-sort.ts` with topological sorting utilities
- Implemented Kahn's algorithm for DAG workflow sorting
- FSM nodes sorted by fsmOrder (primary) → fsmPhase (secondary) → createdAt (fallback)

### Functions Implemented:
1. **topologicalSortDAG(workflowId)** - Kahn's algorithm, returns UnifiedNodeDefinition[]
2. **sortFSMNodes(fsmTemplateId)** - Sort by fsmOrder/fsmPhase, returns UnifiedNodeDefinition[]
3. **getAllWorkflowNodes(workflowId)** - Helper for unsorted node retrieval
4. **isValidDAG(workflowId)** - Cycle detection check

### Key Implementation Details:
- Node data field is JSON string, must parse to extract `label` (phaseName source)
- Fallback label extraction: `data.label` → `data.name` → `node.id`
- Cycle detection: throw Error if not all nodes processed
- JSON array parsing for `vulnerabilityCategories` and `skills` fields

### Database Fields Used:
- WorkflowNode: id, workflowId, roleId, type, positionX, positionY, data, vulnerabilityCategories, skills, fsmPhase, fsmFixed, fsmOrder, skillPath
- WorkflowEdge: sourceId, targetId (for graph building)

### TypeScript Compilation:
- No errors after implementation
- Only deprecation warning for baseUrl in tsconfig.json (not related)

### File Location:
- `src/lib/workflow/topology-sort.ts` - 266 lines

---

## 2026-04-22: Unified Execution Engine Created

### Pattern: Class-based Execution Engine
- Created `src/lib/workflow/unified-execution-engine.ts` with `UnifiedWorkflowExecutionEngine` class
- Followed FSM execution service patterns from `src/lib/fsm/fsm-workflow-execution-service.ts`
- Used RalphLoopAgent for node execution (not SDK sub-agent pattern)

### Core Properties:
1. **config: UnifiedExecutionConfig** - Execution configuration
2. **callbacks: UnifiedExecutionCallbacks** - Execution callbacks
3. **nodes: UnifiedNodeDefinition[]** - Node list (set externally)
4. **aborted: boolean** - Abort flag
5. **currentAgent: RalphLoopAgent | null** - Current agent for abort
6. **modelConfigCache: Map<string, ModelConfigForExecution>** - Model config cache
7. **cumulativeTokens: { input, output }** - Cumulative token usage

### Core Methods Implemented:
1. **setNodes(nodes)** - Set node list (external call)
2. **abort()** - Abort execution
3. **execute()** - Main execution flow
   - Update DB status to 'running'
   - Serial execute all nodes
   - Stop on node failure
   - Generate final result
   - Update DB status
4. **executeNode(nodeIndex, node)** - Single node execution
   - Get model config for role
   - Create RalphLoopAgent
   - Retry mechanism (15 times, 1 min interval)
   - Record full error stack
   - Return NodeExecutionResult
5. **getModelConfigForRole(roleId)** - Get model config by roleId
   - Lookup roleModels mapping
   - Load ModelConfig from DB
   - Use cache to avoid duplicate queries
6. **updateSessionStatus(status, reason, result?)** - Update DB status
7. **determineStatus()** - Determine final status
8. **determineEndReason(status)** - Determine end reason
9. **generateEndMessage(status, nodeResults)** - Generate end message
10. **sleep(ms)** - Sleep utility

### Retry Mechanism:
- Max retries: 15 (from config.maxRetries)
- Retry interval: 60000ms (from config.retryDelayMs)
- Each retry calls `onNodeRetry` callback
- After max retries, mark as failed

### Error Handling:
- Record full error stack (error.stack)
- Error stored in NodeExecutionResult.error and errorStack
- Failed node stops workflow (no skip)

### Database Updates:
- EvaluationSession: status, endReason, endMessage, completedAt, totalInputTokens, totalOutputTokens, totalTokens, errorMessage
- NodeExecution: workflowNodeId, nodeLabel, nodeType, status, modelConfigId, modelName, roleId

### Key Design Decisions:
- Serial execution only (no parallel)
- Node input: no fixed input, Agent Skill decides autonomously
- YAML output path: `.claude/phases/{index}-{label}/output.yaml`
- phaseName source: `node.label` (from data.label)
- Permission mode: bypassPermissions for autonomous execution

### TypeScript Compilation:
- No errors after implementation
- Only deprecation warning for baseUrl in tsconfig.json (not related)

### File Location:
- `src/lib/workflow/unified-execution-engine.ts` - 803 lines

---

## 2026-04-22: DAG Route Refactored to Use Unified Engine

### Pattern: SSE Stream with Background Execution
- Refactored `src/app/api/projects/[id]/start/route.ts` to use `UnifiedWorkflowExecutionEngine`
- Replaced manual topological sort with `topologicalSortDAG()` from Wave 1
- Removed old RalphLoopAgent single-agent execution pattern
- Implemented SSE callbacks for real-time status updates

### Key Changes:
1. **Import additions**:
   - `UnifiedWorkflowExecutionEngine`, `createUnifiedExecutionEngine` from `@/lib/workflow/unified-execution-engine`
   - `topologicalSortDAG` from `@/lib/workflow/topology-sort`
   - Types: `UnifiedExecutionCallbacks`, `NodeExecutionResult`, `WorkflowExecutionResult`, `ModelConfigForExecution`, `UnifiedNodeDefinition`

2. **WorkflowNode query updated**:
   - Added `roleId` field to both queries (Skills loading and execution)
   - Added `fsmPhase`, `fsmOrder`, `skillPath` fields for unified engine compatibility

3. **Topological sort replaced**:
   - Old: Manual BFS-based topological sort (lines 1026-1051)
   - New: `topologicalSortDAG(workflowId)` - returns `UnifiedNodeDefinition[]`

4. **User prompt generation removed**:
   - Old: Generated merged user prompt from all nodes
   - New: Unified engine handles prompt generation per node

5. **Unified engine setup**:
   - Created `engineConfig` with evaluationSessionId, projectId, workflowId, roleModels, etc.
   - Created `engine` instance with placeholder callbacks
   - Set nodes via `engine.setNodes(sortedNodes)`
   - Updated callbacks in SSE stream start function

6. **SSE callbacks implemented**:
   - `onNodeStart`: Push `phase_start` event with nodeIndex, nodeName, modelName
   - `onNodeChunk`: Push `message` event with text content
   - `onNodeToolCall`: Push `tool_call` event, handle TodoWrite specially
   - `onTokenUsage`: Push `phase_token_usage` event with cumulative tokens
   - `onNodeRetry`: Push `node_retry` event with retry count
   - `onNodeComplete`: Push `phase_complete` event, update DB node status
   - `onNodeError`: Push `node_error` event
   - `onWorkflowComplete`: Push `workflow_complete` and `done` events, cleanup
   - `onWorkflowError`: Push `error` event, cleanup

7. **Helper function added**:
   - `getModelConfigForRole(roleId, roleModels, defaultModelConfig)` - for SSE callbacks

### SSE Event Format (preserved for frontend compatibility):
```typescript
// phase_start
{ type: 'phase_start', nodeIndex: 1, totalNodes: 4, nodeName: '威胁建模', modelName: 'claude-sonnet-4' }

// phase_token_usage
{ type: 'phase_token_usage', nodeIndex: 1, modelName: 'claude-sonnet-4', inputTokens: 100, outputTokens: 50, cumulativeInputTokens: 100, cumulativeOutputTokens: 50 }

// phase_complete
{ type: 'phase_complete', nodeIndex: 1, nodeName: '威胁建模', status: 'completed', outputYamlPath: '/workspace/phase_威胁建模_output.yaml' }

// workflow_complete
{ type: 'workflow_complete', status: 'completed', totalDuration: 930000, totalInputTokens: 1234, totalOutputTokens: 567, endReason: '全部完成' }
```

### Type Fixes Required:
1. **UnifiedNodeDefinition** - Added `type`, `workflowId`, `positionX`, `positionY`, `data`, `skills` fields
2. **roleId null handling** - Use `roleId ?? undefined` for Prisma/TypeScript compatibility
3. **updatedAt field** - Added to NodeExecution create for Prisma schema requirement

### Pre-existing Issues Fixed:
1. `src/app/api/workflows/[id]/roles/route.ts` - Type assertion for nodes array
2. `src/lib/mcp-client.ts` - LogContext type fix for logger.debug calls

### Build Verification:
- TypeScript compilation passed
- Next.js build successful
- Only deprecation warning for baseUrl (not related)

### File Location:
- `src/app/api/projects/[id]/start/route.ts` - ~2000 lines (reduced from ~2600)