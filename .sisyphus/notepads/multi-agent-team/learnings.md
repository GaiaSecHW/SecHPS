# Multi-Agent Team Learnings

## Task 10: AgentTeamExecutionService (SDK Wrapper)

### Implementation Patterns

1. **SDK Integration Pattern** (from `src/services/ai/claude-agent.ts`):
   - Import `query, Options, SDKMessage, SDKResultSuccess, SDKResultError, McpServerConfig` from `@anthropic-ai/claude-agent-sdk`
   - Use `AbortController` for cancellation support
   - Iterate over async generator from `query()` for streaming messages
   - Type guards for message types: `isResultSuccess`, `isResultError`, `isToolUseMessage`, `isToolResultMessage`, `isAssistantMessage`

2. **Safety Limits Configuration**:
   - `maxBudgetUsd: 5.00` - Maximum budget per execution
   - `maxTurns: 20` - Maximum turns per execution
   - Pass as Options to SDK: `options.maxBudgetUsd`, `options.maxTurns`

3. **Token Usage Tracking**:
   - Extract from `message.message.usage` or `message.usage`
   - Fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
   - Use Prisma increment: `{ increment: value }` for atomic updates
   - Final cost from `total_cost_usd` in result message

4. **Database Execution Tracking**:
   - Create `AgentTeamExecution` record before starting SDK query
   - Create `AgentMemberExecution` records for each team member
   - Update status: pending → running → completed/failed/cancelled
   - Track `startedAt`, `completedAt`, `totalInputTokens`, `totalOutputTokens`

5. **Async Execution Pattern**:
   - `execute()` returns immediately with executionId (non-blocking)
   - Actual SDK query runs in background via `runExecution()`
   - Track active executions in `Map<string, ActiveExecution>`
   - Clean up tracking after completion/error

6. **Callback Interface**:
   - `onChunk(text, memberId?)` - Streaming text chunks
   - `onToolUse(name, input, memberId?)` - Tool invocation
   - `onToolResult(name, result, memberId?)` - Tool result
   - `onUsage(usage)` - Token usage updates
   - `onComplete(result, executionId)` - Execution completed
   - `onError(error, executionId)` - Execution failed
   - `onStatusChange(status, executionId)` - Status transitions

### Testing Patterns

1. **Mock SDK**:
   ```typescript
   vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
     query: vi.fn(),
   }));
   ```

2. **Mock Async Iterator**:
   ```typescript
   const mockIterator = {
     async *[Symbol.asyncIterator]() {
       yield { type: 'result', subtype: 'success', result: 'Done' };
     },
   };
   (query as any).mockReturnValue(mockIterator);
   ```

3. **Wait for Async Execution**:
   ```typescript
   await new Promise(resolve => setTimeout(resolve, 100));
   ```

4. **Mock Prisma Increment**:
   ```typescript
   (prisma.agentTeamExecution.update as any).mockResolvedValue({
     totalInputTokens: { increment: 200 },
   });
   ```

### Gotchas

1. **Extended Thinking Conflict**: Do NOT enable extended thinking with streaming (SDK conflict)
2. **Permission Mode**: Use `permissionMode: 'auto'` with `allowDangerouslySkipPermissions: true` for autonomous execution
3. **MCP Timeout**: Set `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '600000'` (10 minutes) in env
4. **Member Executions**: Always include `memberExecutions: []` in mock execution objects for `getStatus()` calls

### Files Created

- `src/services/agent-team/execution-service.ts` - Main service (400+ lines)
- `__tests__/services/execution-service.test.ts` - TDD tests (14 tests, all passing)

## Task 11: Lead Agent + Subagent Orchestration

### Implementation Patterns

1. **SDK AgentDefinition Type**:
   - Import as `SdkAgentDefinition` to avoid conflict with Prisma's `AgentDefinition` model
   - Fields: `description`, `prompt`, `tools`, `model`, `disallowedTools`, `mcpServers`, `skills`, `maxTurns`
   - Use `tools` array to restrict subagent capabilities

2. **Lead Agent Configuration**:
   - MUST include "Agent" in `allowedTools` for subagent invocation
   - Auto-add "Agent" if not present: `if (!leadAgentTools.includes('Agent')) { leadAgentTools.push('Agent'); }`
   - Build `agents` config from `AgentTeamMember` data

3. **Subagent Definition Pattern**:
   ```typescript
   agents: {
     'coder-agent': {
       description: 'Writes code implementations',
       prompt: 'You are a coder agent.',
       tools: ['Read', 'Write', 'Edit'], // NO "Agent" - no nesting
       model: 'claude-sonnet-4-20250514'
     }
   }
   ```

4. **SDK Limitation - No Nested Subagents**:
   - Subagent tools MUST NOT include "Agent" (SDK limitation)
   - Filter out "Agent" from subagent tools: `const filteredTools = memberTools.filter(t => t !== 'Agent');`
   - This prevents infinite nesting of subagents

5. **Subagent Invocation Tracking**:
   - Track via `tool_use` messages with `tool_name === 'Agent'`
   - Extract `agent_name` from `tool_input.agent_name` or `tool_input.agent_type`
   - Build member lookup map: `memberByAgentName.set(member.agent.name, member)`
   - Track active subagents: `activeSubagents: Map<string, string>` (agent_name -> member_execution_id)

6. **Member Execution Status Updates**:
   - When Agent tool used: Update member execution to `running` with `startedAt`
   - When Agent tool result: Update member execution to `completed` with `completedAt`
   - On execution error: Mark all active subagents as `failed`

7. **New Callbacks for Subagent Tracking**:
   - `onSubagentStart(agentName, memberExecutionId)` - Called when Agent tool invoked
   - `onSubagentComplete(agentName, memberExecutionId, result)` - Called when subagent finishes

8. **Override Tools Pattern**:
   - Use `member.overrideTools` if defined, else use `member.agent.allowedTools`
   - Parse JSON or comma-separated string
   - Default tools for subagents: `['Read', 'Grep', 'Glob', 'LS']` (no Agent)

### Testing Patterns

1. **Test Lead Agent has Agent tool**:
   ```typescript
   const callArgs = (query as any).mock.calls[0][0];
   expect(callArgs.options.allowedTools).toContain('Agent');
   ```

2. **Test Subagent definitions built**:
   ```typescript
   expect(callArgs.options.agents).toBeDefined();
   expect(callArgs.options.agents['coder-agent']).toBeDefined();
   ```

3. **Test Subagent tools don't include Agent**:
   ```typescript
   const coderAgentTools = callArgs.options.agents['coder-agent'].tools;
   expect(coderAgentTools).not.toContain('Agent');
   ```

4. **Test Subagent invocation tracking**:
   - Mock `tool_use` with `tool_name: 'Agent'`
   - Mock `agentMemberExecution.findFirst` and `update`
   - Verify `onSubagentStart` callback called

### Gotchas

1. **Naming Conflict**: `AgentDefinition` exists in both SDK and Prisma - rename SDK import
2. **Agent Tool Input**: Can be `agent_name` or `agent_type` - check both
3. **Member Execution Lookup**: Use `findFirst` with `teamExecutionId` and `memberId`
4. **Token Attribution**: Track tokens per member when in subagent context

### Files Modified

- `src/services/agent-team/execution-service.ts` - Extended with orchestration (725+ lines)
- `__tests__/services/execution-service.test.ts` - Added 7 new tests (21 total, all passing)

## Task 12: WebSocket/SSE Server for Real-time Events

### Implementation Patterns

1. **SSE vs WebSocket Choice**:
   - Next.js App Router doesn't support WebSocket upgrade directly
   - SSE (Server-Sent Events) is simpler for one-way streaming (server → client)
   - SSE uses standard HTTP, works with Next.js route handlers
   - SSE format: `data: <json>\n\n`

2. **Event Types (5 Core Events)**:
   - `execution_started`: { executionId, teamId, teamName, leadAgentId, leadAgentName, memberCount }
   - `agent_invoked`: { agentId, agentName, agentRole, parentToolUseId, memberId }
   - `message_delta`: { agentId, content, memberId }
   - `agent_completed`: { agentId, agentName, result, tokens }
   - `execution_completed`: { executionId, result, totalTokens, totalCostUsd, status }

3. **Event Broadcaster Pattern (Pub/Sub)**:
   - Singleton `AgentTeamEventBroadcaster` class
   - Client registration with teamId and optional executionId filter
   - Maps: `clients`, `teamClients`, `executionClients`
   - Broadcast to all team clients, filter by executionId if specified
   - Auto-cleanup on `execution_completed` event

4. **SSE Stream Creation**:
   ```typescript
   return new ReadableStream<Uint8Array>({
     start(controller) {
       clientId = broadcaster.registerClient(controller, { teamId, executionId });
     },
     cancel() {
       broadcaster.unregisterClient(clientId);
     },
   });
   ```

5. **SSE Response Headers**:
   ```typescript
   headers: {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
     'X-Accel-Buffering': 'no', // Disable nginx buffering
   }
   ```

6. **Integration with ExecutionService**:
   - Pass callbacks to `execute()` that emit events
   - `onChunk` → `emitMessageDelta`
   - `onToolUse` (Agent tool) → `emitAgentInvoked`
   - `onToolResult` (Agent tool) → `emitAgentCompleted`
   - `onComplete` → `emitExecutionCompleted`
   - `onError` → `emitExecutionCompleted` with status='failed'

7. **Event Factory Functions**:
   - `createExecutionStartedEvent(executionId, teamId, data)`
   - `createAgentInvokedEvent(executionId, teamId, data)`
   - `createMessageDeltaEvent(executionId, teamId, data)`
   - `createAgentCompletedEvent(executionId, teamId, data)`
   - `createExecutionCompletedEvent(executionId, teamId, data)`
   - All include `timestamp: new Date()`

8. **Type Guards for Event Types**:
   - `isExecutionStartedEvent(event)`
   - `isAgentInvokedEvent(event)`
   - `isMessageDeltaEvent(event)`
   - `isAgentCompletedEvent(event)`
   - `isExecutionCompletedEvent(event)`

### Testing Patterns

1. **Mock ReadableStream Controller**:
   ```typescript
   const chunks: Uint8Array[] = [];
   const controller = {
     enqueue: (chunk: Uint8Array) => chunks.push(chunk),
     close: vi.fn(),
   } as any;
   ```

2. **Decode SSE Messages**:
   ```typescript
   const message = new TextDecoder().decode(chunks[0]);
   expect(message).toContain('connected');
   ```

3. **Test Event Broadcasting**:
   - Register multiple clients for same team
   - Broadcast event
   - Verify all clients receive event

4. **Test ExecutionId Filtering**:
   - Register client with executionId filter
   - Broadcast event for different executionId
   - Verify client does NOT receive event

5. **Test Cleanup on Completion**:
   - Register client with executionId
   - Broadcast `execution_completed` event
   - Verify client is closed and removed

6. **Suppress Console in Tests**:
   ```typescript
   vi.spyOn(console, 'log').mockImplementation(() => {});
   vi.spyOn(console, 'error').mockImplementation(() => {});
   ```

### Gotchas

1. **Stream Starts Immediately**: ReadableStream `start()` runs synchronously, client registered before test can check count
2. **Cleanup Timing**: Use `setTimeout(resolve, 50)` after `reader.cancel()` for cleanup
3. **SSE Format**: Must end with `\n\n` (two newlines)
4. **JSON in SSE**: Use `JSON.stringify()` for data field
5. **No WebSocket in App Router**: Use SSE instead, WebSocket requires custom server

### Files Created

- `src/types/agent-team-events.ts` - Event type definitions (150+ lines)
- `src/lib/agent-team-events.ts` - SSE broadcaster service (250+ lines)
- `src/app/api/agent-teams/[id]/stream/route.ts` - SSE stream route (80+ lines)
- `__tests__/types/agent-team-events.test.ts` - Event type tests (18 tests)
- `__tests__/lib/agent-team-events.test.ts` - Broadcaster tests (23 tests)

### Files Modified

- `src/app/api/agent-teams/[id]/execute/route.ts` - Integrated event callbacks, returns streamUrl

## Task 14: Cost Attribution per Agent

### Implementation Patterns

1. **MODEL_PRICING Constant**:
   - USD per million tokens for each model
   - Anthropic: Opus ($15/$75), Sonnet ($3/$15), Haiku ($0.8/$4)
   - OpenAI: GPT-4o ($2.5/$10), GPT-4o-mini ($0.15/$0.6)
   - GLM: ($0.86/$3.14) - converted from RMB at ~7:1 ratio
   - Default fallback: Sonnet-like pricing ($3/$15)

2. **Cost Calculation Formula**:
   ```typescript
   cost = (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
   ```

3. **Model Tracking per Agent**:
   - Build `modelByMemberId` map during execution setup
   - `member.overrideModel || member.agent.model || leadAgent.model`
   - Track `currentModel` variable during execution
   - Switch to subagent model when Agent tool invoked
   - Switch back to lead agent model when subagent completes

4. **Cost in onUsage Callback**:
   - Added `model` field to usage callback
   - Added `totalCostUsd` calculated from tokens and model
   - Calculate cost immediately when tokens are tracked

5. **ExecutionStatus with Cost**:
   - Added `estimatedCostUsd` to ExecutionStatus interface
   - Added `estimatedCostUsd` to each member execution
   - `getStatus()` accepts optional `model` parameter for cost calculation
   - Default model for cost calculation: 'claude-sonnet-4-20250514'

6. **Cost Aggregation**:
   - Total cost = Lead Agent cost + Sum(Member costs)
   - Each agent's cost calculated with its own model pricing
   - Tokens tracked per member execution in database

### Testing Patterns

1. **Test MODEL_PRICING Constants**:
   ```typescript
   expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
   expect(sonnetPricing.output).toBeGreaterThan(sonnetPricing.input);
   ```

2. **Test calculateCost Function**:
   ```typescript
   const cost = calculateCost(1000, 500, 'claude-sonnet-4-20250514');
   expect(cost).toBeCloseTo(0.0105, 6);
   ```

3. **Test Cost in onUsage Callback**:
   - Mock assistant message with usage data
   - Verify onUsage called with `model` and `totalCostUsd`
   - Check cost matches expected calculation

4. **Test Subagent Cost Attribution**:
   - Mock subagent invocation with override model
   - Verify usage callback has correct model for subagent
   - Verify cost calculated with subagent's model pricing

5. **Test Cost in ExecutionStatus**:
   - Mock execution with token counts
   - Verify `estimatedCostUsd` in status response
   - Verify member execution costs calculated

6. **Test Cost Aggregation**:
   - Track all usage calls during execution
   - Calculate expected total = lead + sum(members)
   - Verify models match for each agent

### Gotchas

1. **Model Not Stored in Database**: Model info only available during execution, not persisted
2. **Default Model for getStatus**: Uses sonnet pricing if model not specified
3. **Override Model Priority**: `member.overrideModel` takes precedence over `member.agent.model`
4. **Console Warning for Unknown Models**: `getModelPricing()` logs warning for unknown models

### Files Modified

- `src/services/agent-team/execution-service.ts` - Added MODEL_PRICING, calculateCost, cost tracking (870+ lines)
- `__tests__/services/execution-service.test.ts` - Added 19 cost attribution tests (40 total, all passing)## Task 13: TDD Tests for AgentTeam Execution

### Test Coverage (33 Tests)

1. **Test Case 1: Execution starts with correct SDK config** (5 tests):
   - SDK query called with correct maxBudgetUsd (5.00)
   - SDK query called with correct maxTurns (20)
   - SDK query called with agents config from team members
   - Lead Agent allowedTools includes Agent tool
   - Subagent tools do NOT include Agent (SDK limitation)

2. **Test Case 2: Subagent invocation tracked** (4 tests):
   - Agent tool_use triggers subagent tracking
   - Member execution status updates to running on Agent tool_use
   - Member execution status updates to completed on Agent tool_result
   - onSubagentComplete callback called with result

3. **Test Case 3: Token usage attributed per agent** (3 tests):
   - Token usage tracked for Lead Agent
   - Token usage attributed to member when in subagent context
   - Total execution tokens aggregate Lead + Member tokens

4. **Test Case 4: SSE events emitted correctly** (5 tests):
   - emitExecutionStarted called when execution starts
   - emitMessageDelta called for streaming text
   - emitExecutionCompleted called when execution finishes
   - emitExecutionCompleted called with failed status on error
   - agentTeamEventBroadcaster.broadcast called for events

5. **Test Case 5: Budget exhaustion handling** (4 tests):
   - SDK returns error_max_budget when budget exceeded
   - Execution status updated to failed on budget exhaustion
   - Team status updated to idle on budget exhaustion
   - Safety limits enforced at SDK level

6. **Test Case 6: Circular dependency rejection** (8 tests):
   - hasCircularDependency detects simple cycle A -> B -> A
   - hasCircularDependency detects longer cycle A -> B -> C -> A
   - hasCircularDependency returns false for valid chain A -> B -> C
   - hasCircularDependency returns false for empty dependencies
   - hasCircularDependency returns false for single dependency
   - hasCircularDependency handles self-loop A -> A
   - hasCircularDependency handles disconnected graphs
   - API route accepts valid dependencies on team creation

7. **Additional comprehensive tests** (4 tests):
   - Multiple subagent invocations tracked correctly
   - Execution cancellation aborts SDK query
   - Error in SDK query handled gracefully

### Testing Patterns

1. **Avoid Auth Import in Tests**:
   - Copy circular dependency function directly to test file
   - Avoid importing route handlers that require JWT_SECRET
   - Use i.mock('@/lib/auth') if auth is needed

2. **Mock memberExecutions for getStatus**:
   `	ypescript
   (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
     ...mockExecution,
     memberExecutions: [], // REQUIRED for getStatus()
   });
   `

3. **Use expect.objectContaining for Callbacks**:
   `	ypescript
   expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
     inputTokens: 500,
     outputTokens: 200,
     memberId: undefined,
   }));
   `

4. **Test Budget Exhaustion Error Handling**:
   - Mock SDK to return error_max_budget subtype
   - Verify onError callback called
   - Verify execution status updated to 'failed'
   - Verify team status updated to 'idle'

5. **Test Circular Dependency Detection**:
   - Use DFS-based algorithm
   - Test simple cycles, longer cycles, self-loops
   - Test valid chains (no cycles)
   - Test disconnected graphs with cycles

### Gotchas

1. **JWT_SECRET Required**: Auth module calls process.exit(1) if JWT_SECRET not set
2. **memberExecutions Required**: getStatus() fails if memberExecutions undefined
3. **onUsage Extra Fields**: Callback includes model and totalCostUsd (use objectContaining)
4. **Console Suppression**: Use vi.spyOn(console, 'log/error').mockImplementation(() => {})

### Files Created

- __tests__/services/agent-team-execution.test.ts - Comprehensive execution tests (33 tests, all passing)

## Task 15: AgentTeamList Page

### Implementation Patterns

1. **Page Structure**:
   - 'use client' directive for client-side rendering
   - Suspense wrapper for async components with LoadingSpinner fallback
   - Main content component separated from Suspense wrapper

2. **Permission Check Pattern**:
   - Import `hasPermission` from `@/lib/permissions` (client-safe)
   - Import `PERMISSIONS` from `@/types/permissions`
   - Parse token payload with `atob(token.split('.')[1])` for permissions
   - Check `AGENT_TEAM_CREATE` and `AGENT_TEAM_EXECUTE` permissions

3. **API Response Format** (from `/api/agent-teams`):
   ```typescript
   {
     data: [
       {
         id: string;
         userId: string;
         userName: string | null;
         name: string;
         description: string | null;
         leadAgentId: string;
         leadAgentName: string | null;
         taskStrategy: string;
         maxTeammates: number;
         status: 'idle' | 'running';
         members: AgentTeamMember[];
         _count: { members: number; teamExecutions: number };
       }
     ],
     pagination: { total: number; totalPages: number; page: number; limit: number }
   }
   ```

4. **URL State Management**:
   - Use `useSearchParams` and `usePathname` for URL params
   - `updateUrlParams()` helper to sync state with URL
   - Search debounce (300ms) before triggering API call
   - Reset to page 1 when filters change

5. **Card Layout Pattern**:
   - Expandable cards with `expandedTeam` state
   - Click to expand/collapse details
   - ChevronUp/ChevronDown icons for visual feedback
   - Details section shows: description, strategy, members, timestamps

6. **Status Display**:
   - Status badge with color: idle (gray), running (green)
   - Status icon: Clock for idle, Activity (animated) for running
   - Status text: '空闲', '运行中'

7. **Action Buttons**:
   - "Create New Team" → Link to `/dashboard/agent-teams/new`
   - "Execute" → POST to `/api/agent-teams/[id]/execute`
   - "Edit/View" → Link to `/dashboard/agent-teams/[id]`
   - "Delete" → DELETE to `/api/agent-teams/[id]`
   - "View Execution" → Link to `/dashboard/agent-teams/[id]/execution` (when running)

8. **Stats Cards**:
   - Total teams, idle count, running count, total executions
   - Grid layout: 1/2/4 columns responsive
   - Icon + value pattern with colored background

9. **Pagination Pattern**:
   - URL params: `page`, `limit`
   - Page size selector: 10/20/50/100
   - First/Previous/Next/Last navigation
   - ChevronLeft/ChevronRight icons

### UI Components Used

- `lucide-react`: Users, Plus, Search, Filter, Play, Edit2, Trash2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Activity, Clock, User, Loader2, Zap
- `react-hot-toast`: toast.success(), toast.error()
- `next/navigation`: useRouter, useSearchParams, usePathname
- `next/link`: Link component for navigation

### Gotchas

1. **Permission Import**: Use `@/lib/permissions` for client components (not `@/lib/auth`)
2. **Token Parsing**: Use `atob()` for client-side token decode (no signature verification)
3. **Execute Button**: Only show when `status === 'idle'` and user has `AGENT_TEAM_EXECUTE` permission
4. **Delete Button**: Only show for admin or team owner (`team.userId === user?.id`)
5. **Search Debounce**: 300ms delay to avoid excessive API calls

### Files Created

- `src/app/dashboard/agent-teams/page.tsx` - AgentTeam list page (450+ lines)
