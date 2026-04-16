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