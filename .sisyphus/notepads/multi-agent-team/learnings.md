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
## Task 18: useAgentTeamWebSocket Hook

### Implementation Patterns

1. **SSE Connection with EventSource**:
   - EventSource doesn't support custom headers (no Authorization header)
   - Pass token as query param: url?token=encodeURIComponent(token)
   - Server route must accept token from both header and query param

2. **Ref-based Callback Pattern (Avoid Circular Dependencies)**:
   - Use useRef for internal callbacks to avoid circular dependency issues
   - handleMessageRef, handleErrorRef, connectInternalRef, disconnectRef
   - Update refs in useEffect when dependencies change
   - This pattern avoids \"Cannot access X before initialization\" errors

3. **Retry Logic with Refs**:
   - Use etryCountRef for internal retry tracking (avoids stale closure)
   - Sync to state with setRetryCount(retryCountRef.current) for UI display
   - Reset ref in: disconnect(), connect(), onopen, handleMessage

4. **State Management**:
   - execution: ExecutionStatus (execution_started, execution_completed)
   - gents: AgentStatus[] (agent_invoked, agent_completed)
   - messages: MessageDelta[] (message_delta - accumulates)
   - isConnected, isConnecting, error, etryCount

5. **Auto-disconnect on Completion**:
   - Call disconnectRef.current() in execution_completed handler
   - Mark all agents as completed/failed based on execution status
   - Use ref to avoid circular dependency with disconnect function

6. **Event Parsing**:
   - Validate required fields: 	ype, executionId, 	eamId
   - Parse timestamp: 
ew Date(event.timestamp) if string
   - Use type guards from @/types/agent-team-events

7. **URL Building**:
   - Base: /api/agent-teams//stream
   - With executionId: ${baseUrl}?executionId=
   - With token: ${url}&token=

### Testing Patterns

1. **Mock EventSource Class**:
   `	ypescript
   class MockEventSource {
     url: string;
     onopen: ((this: EventSource, ev: Event) => any) | null = null;
     onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null;
     onerror: ((this: EventSource, ev: Event) => any) | null = null;
     static instances: MockEventSource[] = [];
     
     simulateOpen() { this.readyState = 1; this.onopen?.(new Event('open')); }
     simulateMessage(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
     simulateError() { this.onerror?.(new Event('error')); }
   }
   vi.stubGlobal('EventSource', MockEventSource);
   `

2. **JSDOM Environment for React Hooks**:
   - Add /** @vitest-environment jsdom */ at top of test file
   - Install @testing-library/react and jsdom

3. **Testing Retry Logic**:
   - Use i.useFakeTimers() for setTimeout-based retry
   - i.advanceTimersByTime(retryDelay) to trigger retry
   - Check MockEventSource.instances.length for new connections

4. **Testing Event Parsing**:
   - simulateMessage(JSON.stringify({ type, executionId, teamId, timestamp, data }))
   - Check state updates: esult.current.execution, esult.current.agents, esult.current.messages

5. **Testing Callbacks**:
   - Pass mock functions: onExecutionStarted: vi.fn()
   - Verify called with correct data: expect(onExecutionStarted).toHaveBeenCalledWith(expect.objectContaining({ ... }))

### Gotchas

1. **EventSource No Custom Headers**: Must pass token in URL query param
2. **Circular Dependencies**: Use refs for callbacks that reference each other
3. **Stale Closure in Retry**: Use ref for retry count, not state
4. **Auto-connect in useEffect**: Hook connects on mount if enabled=true
5. **Cleanup on Unmount**: useEffect return calls disconnect()

### Files Created

- src/hooks/useAgentTeamWebSocket.ts - SSE hook (380+ lines)
- __tests__/hooks/useAgentTeamWebSocket.test.ts - Hook tests (27 tests, all passing)

### Files Modified

- src/app/api/agent-teams/[id]/stream/route.ts - Accept token in query param
## Task 16: AgentTeamBuilder Page (Visual Editor)

### Implementation Patterns

1. **Page Structure**:
   - 'use client' directive for client-side rendering
   - Suspense wrapper with LoadingSpinner fallback
   - Separate content component from Suspense wrapper
   - Form sections: Basic Info, Lead Agent, Teammates, Dependencies

2. **Permission Check Pattern**:
   - Import hasPermission from @/lib/permissions (client-safe)
   - Import PERMISSIONS from @/types/permissions
   - Parse token payload with tob(token.split('.')[1]) for permissions
   - Check AGENT_TEAM_CREATE, AGENT_TEAM_UPDATE, AGENT_TEAM_EXECUTE permissions

3. **Form State Management**:
   - Use useState for form data with typed interfaces
   - TeamFormData: name, description, leadAgentId, taskStrategy, maxTeammates, members
   - TeamMember: id (temp or real), agentId, agent, role, overrideModel, overrideTools, dependsOn
   - Generate temp IDs for new members: 	emp--

4. **Circular Dependency Detection**:
   - DFS-based algorithm with recursion stack
   - Build graph from member IDs and their dependsOn arrays
   - Check on every member change via useEffect
   - Show warning UI when circular dependency detected

5. **API Integration**:
   - GET /api/agent-definitions - Fetch available agents
   - POST /api/agent-teams - Create new team
   - PATCH /api/agent-teams/[id] - Update team
   - GET /api/agent-teams/[id] - Fetch team for edit
   - POST /api/agent-teams/[id]/members - Add member
   - DELETE /api/agent-teams/[id]/members?memberId=xxx - Remove member
   - POST /api/agent-teams/[id]/execute - Execute team

6. **Edit Page Pattern**:
   - Fetch existing team data on mount
   - Initialize form from team data
   - Handle both existing members (real IDs) and new members (temp IDs)
   - Delete existing members via API, remove new members from local state
   - Add new members via API after team update

7. **Validation Pattern**:
   - Inline validation before API call
   - Check: name required/length, leadAgentId required, maxTeammates range
   - Check: duplicate agents in members, empty agent selections
   - Check: circular dependency
   - Show errors inline with red border and error message

8. **UI Components**:
   - Lead Agent dropdown with agent details display
   - Teammate cards with agent selection, model override, dependency buttons
   - Dependency buttons: toggle to add/remove dependency
   - Circular dependency warning: red alert box with AlertTriangle icon
   - Execute button: only show when status === 'idle' and has permission

9. **Ownership Check**:
   - Admin can edit any team
   - Regular users can only edit their own teams (team.userId === userId)
   - Show permission denied UI if not owner/admin

### Gotchas

1. **Edit Page URL**: Use searchParams for teamId, not dynamic route segment (Next.js App Router pattern)
2. **Temp ID Pattern**: Use 	emp- prefix to distinguish new vs existing members
3. **Dependency Not Stored**: Current schema doesn't store dependencies, initialize as empty array
4. **Member Removal**: Delete via API for existing members, just remove from state for new members
5. **Execute Button**: Only show after save (for new) or when status === 'idle' (for edit)

### Files Created

- src/app/dashboard/agent-teams/new/page.tsx - New team builder page (775 lines)
- src/app/dashboard/agent-teams/[id]/edit/page.tsx - Edit team page (969 lines)

## Task 17: AgentTeamExecutionMonitor Component

### Implementation Patterns

1. **Component Structure**:
   - 'use client' directive for client-side rendering
   - Main component with sub-components: AgentCard, MessageFlowItem, ResultsPanel
   - Props: teamId, executionId, token, onCompleted, onCancelled

2. **WebSocket Integration**:
   - Import useAgentTeamWebSocket hook from '@/hooks/useAgentTeamWebSocket'
   - Import types: AgentStatus, ExecutionStatus, MessageDelta
   - Hook provides: execution, agents, messages, isConnected, isConnecting, error, retryCount, disconnect
   - Use onExecutionCompleted callback to notify parent when execution finishes

3. **Status Config Pattern**:
   - Separate config objects for agent status and execution status
   - Each config: icon, text, color, bgColor, borderColor, badgeColor
   - Agent status: pending (gray), running (green), completed (blue), failed (red)
   - Execution status: pending, running, completed, failed, cancelled

4. **Progress Calculation**:
   - totalAgents = execution?.memberCount || agents.length || 1
   - completedAgents = agents.filter(a => a.status === 'completed' || a.status === 'failed').length
   - progress = Math.round((completedAgents / totalAgents) * 100)

5. **Agent Card Design**:
   - Status icon with animation (animate-spin for running)
   - Role badge: Lead Agent (purple) or Teammate (gray)
   - Token usage display with Zap icon
   - Latest message preview (truncated to 100 chars)
   - Timestamps: startedAt, completedAt

6. **Message Flow Panel**:
   - Scrollable container with max-height: 400px
   - Auto-scroll to bottom with messagesEndRef
   - Each message: agent avatar, agent name, timestamp, content (truncated to 200 chars)
   - Show message count in header

7. **Cancel Button Implementation**:
   - PATCH to /api/agent-teams/[teamId]/executions/[executionId]
   - Body: { status: 'cancelled' }
   - Confirmation dialog before cancel
   - Call disconnect() after successful cancel
   - Show loading state during cancel request

8. **Results Panel**:
   - Show when execution status is completed/failed/cancelled
   - Summary stats grid: total input tokens, output tokens, estimated cost, status
   - Result content in scrollable pre block with max-height: 400px

9. **Connection Status Indicator**:
   - Wifi icon (green) for connected, WifiOff (red) for disconnected
   - Loader2 (yellow, spinning) for connecting
   - Show retry count when reconnecting

10. **Helper Functions**:
    - formatTokens: Format input/output tokens with locale string
    - formatCost: Format USD cost with 4 decimal places
    - formatTimestamp: Format Date to locale time string
    - truncateContent: Truncate string with ellipsis

### UI Components Used

- lucide-react: Activity, AlertCircle, CheckCircle, Clock, Loader2, MessageSquare, PauseCircle, RefreshCw, Wifi, WifiOff, XCircle, Zap, TrendingUp
- Tailwind CSS: Status colors (gray/green/blue/red/yellow), progress bar, grid layouts

### Gotchas

1. **Import Types from Hook**: Import AgentStatus, ExecutionStatus, MessageDelta from the hook file, not from event types
2. **onCompleted Callback**: Pass execution object, not the data from event
3. **Auto-scroll**: Use useRef with scrollIntoView for message auto-scroll
4. **Cancel API**: Use PATCH method with status: 'cancelled' in body
5. **Progress Color**: Use different colors based on execution status (red for failed, green for completed, blue for running)

### Files Created

- src/components/agent-team/ExecutionMonitor.tsx - Execution monitor component (573 lines)

## Task 19: AgentDefinitionEditor Page

### Implementation Patterns

1. **Page Structure**:
   - 'use client' directive for client-side rendering
   - Suspense wrapper with LoadingSpinner fallback
   - Separate content component from Suspense wrapper
   - Form sections: Basic Info, Model Configuration, Tools, Skills, System Prompt

2. **Permission Check Pattern**:
   - Import hasPermission from '@/lib/permissions' (client-safe)
   - Import PERMISSIONS from '@/types/permissions'
   - Parse token payload with atob(token.split('.')[1]) for permissions
   - Check AGENT_DEFINITION_CREATE, AGENT_DEFINITION_UPDATE, AGENT_DEFINITION_DELETE permissions

3. **Form State Management**:
   - Use useState for form data with typed interfaces
   - FormData: name, displayName, description, category, model, systemPrompt, allowedTools, skills, isActive
   - Toggle functions for multi-select: toggleTool(), toggleSkill()

4. **Built-in Agent Handling**:
   - Check agent.isBuiltin to determine edit vs clone behavior
   - Built-in agents: Show read-only view with Clone button
   - Custom agents: Show editable form with Save/Delete buttons
   - Lock icon and yellow warning box for built-in agents

5. **Clone Feature**:
   - POST to /api/agent-definitions with copy-of-{name} as name
   - Copy all fields from original agent
   - Set isBuiltin=false, userId=current user
   - Redirect to edit page for cloned agent

6. **API Integration**:
   - GET /api/agent-definitions/[id] - Fetch agent for edit/view
   - POST /api/agent-definitions - Create new agent or clone
   - PATCH /api/agent-definitions/[id] - Update existing agent
   - DELETE /api/agent-definitions/[id] - Delete agent

7. **Validation Pattern**:
   - Inline validation before API call
   - Check: name required/length/format (lowercase, alphanumeric, hyphens)
   - Check: displayName required/length
   - Check: description required/length
   - Check: model required
   - Check: at least one tool selected
   - Show errors inline with red border and error message

8. **Tools Configuration**:
   - AVAILABLE_TOOLS constant: Read, Glob, Grep, Write, Edit, Bash, LspDiagnostics, LS
   - NO "Agent" tool (SDK limitation - prevents nested subagents)
   - Multi-select with toggle buttons (blue when selected)

9. **Skills Configuration**:
   - Fetch from /api/skills?scope=all&limit=100
   - Multi-select with toggle buttons (green when selected)
   - Optional field - can be empty

10. **Model Selection**:
    - AVAILABLE_MODELS constant: claude-opus-4-20250514, claude-sonnet-4-20250514, claude-3-5-haiku-20241022
    - Dropdown with model name and description

11. **Ownership Check**:
    - Admin can edit/delete any agent
    - Regular users can only edit/delete their own agents (agent.userId === userId)
    - Show permission denied UI if not owner/admin

12. **View Page Pattern**:
    - Dynamic route: [id]/page.tsx with params Promise
    - Resolve params with useEffect: params.then(p => setAgentId(p.id))
    - Show agent details in read-only format
    - Action buttons based on permissions and ownership

### UI Components Used

- lucide-react: Bot, ArrowLeft, Save, Settings, Wrench, FileText, AlertTriangle, Loader2, Copy, Lock, Edit2, Trash2, Calendar, User, Activity
- react-hot-toast: toast.success(), toast.error()
- next/navigation: useRouter, useSearchParams
- next/link: Link component for navigation

### Gotchas

1. **Name Format**: Agent name must be lowercase alphanumeric with hyphens only
2. **Name Immutable**: Name cannot be changed after creation (read-only in edit form)
3. **No Agent Tool**: Custom agents cannot have "Agent" tool (SDK limitation)
4. **Built-in Check**: Always check isBuiltin before allowing edit/delete
5. **Clone Name**: Use copy-of-{originalName} pattern for cloned agents
6. **Params Promise**: Next.js 16 params are Promise, must resolve with useEffect
7. **Delete Confirmation**: Use confirm() dialog before delete

### Files Created

- src/app/dashboard/agent-definitions/new/page.tsx - New agent form (540 lines)
- src/app/dashboard/agent-definitions/[id]/edit/page.tsx - Edit agent form (857 lines)
- src/app/dashboard/agent-definitions/[id]/page.tsx - View agent details (577 lines)

## Task 26: AgentTeam Ralph Loop Integration

### Implementation Patterns

1. **executeWithRalphLoop() Method Structure**:
   - Parse ralphConfig from team.ralphConfig using parseRalphConfig()
   - If not enabled, fall back to regular execute() method
   - Create execution record before starting iteration loop
   - Track: iteration, totalCostUsd, completionReason, lastFeedback, currentTask
   - Return: { executionId, iterations, completionReason, totalCostUsd }

2. **Iteration Loop Logic**:
   ```typescript
   while (iteration < ralphConfig.maxIterations && totalCostUsd < ralphConfig.maxCostUsd) {
     // 1. Check abort signal
     // 2. Broadcast iteration_started event
     // 3. Execute single iteration (runSingleIteration)
     // 4. Build VerificationContext
     // 5. Run verification (runVerification)
     // 6. Record iteration
     // 7. Broadcast iteration_completed event
     // 8. If verification fails and experienceTrigger='on_failure', query experiences
     // 9. Check cost limit
   }
   ```

3. **runSingleIteration() Helper Method**:
   - Similar to runExecution() but returns iteration result instead of void
   - Returns: { text, inputTokens, outputTokens, costUsd, subagentCalls }
   - Tracks subagent calls via Agent tool_use/tool_result messages
   - Uses calculateCost() for cost attribution

4. **runVerification() Helper Method**:
   - Keyword-based verification (completion/failure keywords)
   - Returns: { verified, feedback, stopReason, suggestedAction }
   - Completion keywords: '任务完成', 'completed', 'done', etc.
   - Failure keywords: '任务失败', 'failed', 'error', etc.

5. **Experience Query Integration**:
   - Only query when experienceTrigger === 'on_failure' AND verification fails
   - Use buildDynamicExperiencePrompt() from experience-query-service
   - Inject guidance into next iteration's task: `${task}\n\n[经验指导]\n${guidanceData.prompt}`
   - Broadcast experience_queried event with found experiences

6. **Event Broadcasting**:
   - emitIterationStarted(executionId, teamId, { iteration, maxIterations, previousFeedback, totalCostUsdSoFar })
   - emitIterationCompleted(executionId, teamId, { iteration, result, verified, feedback, tokensUsed, costUsd, totalCostUsdSoFar })
   - emitExperienceQueried(executionId, teamId, { iteration, experiencesFound, experienceTitles, guidanceInjected })

7. **Completion Reasons**:
   - 'verified': Verification passed
   - 'max_iterations': Reached maxIterations limit
   - 'max_cost': Reached maxCostUsd limit
   - 'aborted': AbortController.signal.aborted

8. **Iteration Record Tracking**:
   - IterationRecord: { iteration, startedAt, completedAt, result, verification, tokensUsed, costUsd, experienceQueried, experiencesFound }
   - Store in iterationRecords array for potential future use

### Imports Required

```typescript
import { parseRalphConfig } from '@/types/ralph-loop-config';
import type {
  AgentTeamVerificationContext,
  AgentTeamVerificationResult,
  SubagentCallRecord,
  IterationRecord,
} from '@/types/ralph-loop-config';
import { emitIterationStarted, emitIterationCompleted, emitExperienceQueried } from '@/lib/agent-team-events';
import { buildDynamicExperiencePrompt } from '@/services/autonomous-evolution/experience-query-service';
```

### Gotchas

1. **Unused Imports**: Remove RalphLoopConfig, RalphLoopExecutionResult, queryRelevantExperiences (not directly used)
2. **Experience Query Only on Failure**: Don't query experiences on every iteration, only when verification fails
3. **Task Injection**: Inject experience guidance into currentTask for next iteration, not original task
4. **Cost Check**: Check cost limit AFTER adding iteration cost, not before
5. **Abort Check**: Check abort signal at start of each iteration AND after iteration completes
6. **Fallback to execute()**: If ralphConfig.enabled=false, call regular execute() and return with iterations=1

### Files Modified

- src/services/agent-team/execution-service.ts - Added executeWithRalphLoop(), runSingleIteration(), runVerification() (1385+ lines)

## Task 28: Ralph Loop Tests and Documentation

### Test Coverage (34 Tests)

1. **Iteration Termination Tests** (4 tests):
   - stops when maxIterations reached
   - stops when maxCostUsd reached
   - stops when verified=true
   - falls back to regular execute when Ralph Loop disabled

2. **Experience Learning Trigger Tests** (4 tests):
   - queries experiences on verification failure (experienceTrigger=on_failure)
   - does not query experiences on verification success
   - injects guidance into next iteration task
   - experienceTrigger=disabled does not query experiences

3. **WebSocket Event Tests** (3 tests):
   - broadcasts iteration_started event
   - broadcasts iteration_completed event
   - broadcasts experience_queried event when experiences found

4. **parseRalphConfig Tests** (6 tests):
   - returns default config for null input
   - returns default config for undefined input
   - returns default config for empty string
   - parses valid JSON config
   - merges with defaults for partial config
   - returns default config for invalid JSON

5. **Abort Handling Tests** (1 test):
   - returns aborted completion reason when abort signal triggered

6. **Cost Calculation Tests** (1 test):
   - totalCostUsd accumulates across iterations

7. **WebSocket Hook Tests** (14 tests):
   - iteration_started event updates iteration state
   - iteration_completed event updates iteration state with verification
   - iteration_completed event with verified=false updates status to failed
   - iteration history accumulates across multiple iterations
   - experience_queried event updates experience state
   - experience_queried event updates iteration history
   - multiple experience_queried events for different iterations
   - all Ralph Loop callbacks are invoked correctly
   - callbacks are not invoked when hook is disabled
   - disconnect clears iteration and experience state
   - reconnect resets iteration state
   - handles malformed iteration event gracefully
   - handles iteration event with missing fields
   - handles rapid iteration events

### Testing Patterns

1. **Mock Ralph Loop Config**:
   ```typescript
   const createMockTeamWithRalphConfig = (ralphConfig: object) => ({
     ...mockTeam,
     ralphConfig: JSON.stringify(ralphConfig),
   });
   ```

2. **Mock Query for Multiple Iterations**:
   ```typescript
   let queryCallCount = 0;
   (query as any).mockImplementation(() => {
     queryCallCount++;
     const mockIterator = {
       async *[Symbol.asyncIterator]() {
         if (queryCallCount === 1) {
           // First iteration - not verified
           yield { type: 'assistant', content: [{ type: 'text', text: 'Working...' }], message: { usage: { input_tokens: 100, output_tokens: 50 } } };
           yield { type: 'result', subtype: 'success', result: 'Still working' };
         } else {
           // Second iteration - verified
           yield { type: 'assistant', content: [{ type: 'text', text: 'Task completed' }], message: { usage: { input_tokens: 100, output_tokens: 50 } } };
           yield { type: 'result', subtype: 'success', result: '任务完成' };
         }
       },
     };
     return mockIterator;
   });
   ```

3. **Mock Experience Query Service**:
   ```typescript
   (buildDynamicExperiencePrompt as any).mockResolvedValue({
     prompt: '## Experience Guidance\nTry checking file permissions first.',
     matches: [{ experience: { title: 'Permission fix' }, relevanceScore: 10, matchedPatterns: ['permission'] }],
   });
   ```

4. **JSDOM Environment for React Hook Tests**:
   ```typescript
   /**
    * @vitest-environment jsdom
    */
   ```
   - Required for @testing-library/react renderHook
   - Add at top of test file before imports

5. **Mock EventSource for SSE Tests**:
   ```typescript
   class MockEventSource {
     url: string;
     onopen: ((event: Event) => void) | null = null;
     onmessage: ((event: MessageEvent) => void) | null = null;
     simulateMessage(data: string) {
       if (!this.closed && this.onmessage) {
         this.onmessage(new MessageEvent('message', { data }));
       }
     }
   }
   vi.stubGlobal('EventSource', MockEventSource);
   ```

6. **Test Event Broadcasting**:
   ```typescript
   expect(emitIterationStarted).toHaveBeenCalled();
   const callArgs = (emitIterationStarted as any).mock.calls[0];
   expect(callArgs[0]).toBe('exec-ralph-1');
   expect(callArgs[1]).toBe('team-ralph-1');
   expect(callArgs[2].iteration).toBe(1);
   expect(callArgs[2].maxIterations).toBe(3);
   ```

### Gotchas

1. **Completion Keywords in Mock Results**: Mock result text must NOT contain completion keywords ('任务完成', 'completed', 'done') when testing max_iterations or max_cost termination
2. **JSDOM Environment**: React hook tests require jsdom environment - add `@vitest-environment jsdom` comment at top
3. **EventSource Mock**: Capture EventSource instances in array for testing: `MockEventSource.instances.push(this)`
4. **Cost Calculation**: Use `toBeCloseTo(value, 2)` for cost assertions due to floating point precision
5. **Experience Query Only on Failure**: buildDynamicExperiencePrompt is only called when verification fails AND experienceTrigger='on_failure'

### Files Created

- __tests__/services/agent-team-ralph-loop.test.ts - Ralph Loop integration tests (20 tests)
- __tests__/hooks/useAgentTeamWebSocket-ralph.test.ts - WebSocket hook iteration tests (14 tests)
