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