# AgentTeam Multi-Agent 协作系统工作计划

## TL;DR

> **Quick Summary**: 实现基于 Claude Agent SDK Subagent 模式的多 Agent 协作系统，完全替代现有 Workflow 系统。支持定义不同能力的 Agent、绑定不同模型、手动配置依赖、实时消息流可视化。
> 
> **Deliverables**: 
> - 3 个内置 Agent（安全威胁分析、漏洞挖掘、文档阅读生成）
> - AgentTeam 创建和管理 API
> - AgentTeam 执行引擎（Lead + Subagent 模式）
> - WebSocket 实时监控界面
> - Migration 脚本（Workflow → AgentTeam）
> - TDD 测试覆盖
>
> **Estimated Effort**: XL (Large multi-phase project)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Prisma Models → API Routes → SDK Service → UI Components → WebSocket → Migration

---

## Context

### Original Request
用户希望实现 Claude SDK 的多 Agent 协作能力，定义多个不同能力的 Agent，每个 Agent 绑定不同的大模型，组成 AgentTeam 完成编排任务。在自动评估时，选择编排后还要选择对应的模型。

### Interview Summary
**Key Discussions**:
- AgentTeam 与 Workflow 关系: **完全替代** - 现有 Workflow 系统将被 AgentTeam 取代
- Agent Definition 管理: **内置 + 自定义** - 系统内置 3 个安全相关 Agent，用户可自定义
- 内置 Agent: 安全威胁分析专家、漏洞挖掘专家、文档阅读与生成专家
- 模型选择流程: **分步选择** - 选 AgentTeam → 选 Lead Agent 模型 → Teammate 自动使用绑定模型
- 任务依赖: **手动配置** - 用户手动配置 Agent 间依赖关系
- 消息流可视化: **完整可视化** - 实时显示消息流、任务状态、Token 使用
- 测试策略: **TDD** - 测试驱动开发

**Research Findings**:
- Claude SDK 提供 3 种多 Agent 模式: Subagents (生产就绪), Agent Teams (实验性), Managed Agents API (Beta)
- 建议方案: Subagent 模式 + 程序化编排（生产就绪，可在 Next.js 后端集成）
- 关键限制: Subagent 不能嵌套、必须在 Lead Agent 的 allowedTools 包含 "Agent"
- 现有 Workflow 系统: 20+ 文件、6 个 Prisma 模型、8 个 API 路由、4 个 UI 组件

### Metis Review
**Identified Gaps** (addressed):
- **迁移策略缺失**: 需要数据迁移脚本，EvaluationSession.workflowId 处理方案
- **内置 Agent 定义缺失**: 需要为每个 Agent 定义 description, prompt, tools, model
- **WebSocket 事件类型缺失**: 需要定义 execution_started, agent_invoked, message_delta, execution_completed
- **成本归属方案缺失**: 需要 Lead Agent 和 Teammate 的 Token 统计分离
- **SDK 限制未记录**: Windows prompt 长度限制、Extended thinking + streaming 冲突

---

## Work Objectives

### Core Objective
实现 AgentTeam 多 Agent 协作系统，使用 Claude Agent SDK 的 Subagent 模式，替代现有 Workflow 系统，支持:
1. 定义不同能力的 Agent（内置 3 个 + 用户自定义）
2. 每个 Agent 绑定特定模型配置
3. 手动配置 Agent 间任务依赖
4. Lead Agent 协调 Teammate 执行任务
5. 实时监控消息流和执行状态

### Concrete Deliverables
- `prisma/schema.prisma` - 新增 AgentDefinition, AgentTeam, AgentTeamMember, AgentTeamExecution 等模型
- `src/app/api/agent-definitions/` - Agent 定义管理 API
- `src/app/api/agent-teams/` - AgentTeam 创建、管理、执行 API
- `src/services/agent-team/` - AgentTeam 执行引擎（SDK 集成）
- `src/app/dashboard/agent-teams/` - AgentTeam 可视化界面
- `src/hooks/useAgentTeamWebSocket.ts` - WebSocket 实时监控 Hook
- `scripts/migrate-workflow-to-agent-team.ts` - Migration 脚本
- `data/agents/` - 3 个内置 Agent Markdown 定义
- `__tests__/agent-team/` - TDD 测试文件

### Definition of Done
- [ ] AgentTeam 创建 API 可用: POST /api/agent-teams 返回创建的 Team
- [ ] AgentTeam 执行 API 可用: POST /api/agent-teams/:id/execute 启动执行
- [ ] WebSocket 连接可用: ws://localhost:3000/api/agent-teams/:id/stream
- [ ] 内置 Agent 可选择: 安全威胁分析、漏洞挖掘、文档阅读生成
- [ ] Migration 脚本可用: npm run migrate:workflow-to-agent-team
- [ ] TDD 测试通过: bun test __tests__/agent-team/ → PASS
- [ ] 原有 Workflow 文件已清理: 不存在 workflow 相关路由和组件

### Must Have
- AgentDefinition 数据模型（支持 name, description, prompt, tools, model）
- AgentTeam 数据模型（支持 leadAgentId, members, dependencies）
- AgentTeam 执行引擎（使用 Claude Agent SDK 的 agents 配置）
- WebSocket 实时事件流（5 种事件类型）
- Migration 脚本（Workflow → AgentTeam 数据转换）
- 3 个内置 Agent Markdown 定义文件

### Must NOT Have (Guardrails)
- 嵌套 Subagent 架构（SDK 限制）
- Extended thinking + Streaming 同时启用（SDK 冲突）
- 自动任务依赖检测（用户要求手动配置）
- Agent Marketplace 功能（Phase 2）
- Team Templates 功能（Phase 2）
- Agent Learning/Evolution 功能（Phase 2）
- 保留原有 Workflow 系统（完全替代）
- Agent 定义数量超过 3 个内置（Phase 1 限制）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: TDD
- **Framework**: bun test (需新增配置)
- **If TDD**: 每个 TODO 遵循 RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API Routes**: Use Bash (curl) - Send requests, assert status + response fields
- **SDK Service**: Use Bash (bun/node REPL) - Import, call functions, compare output
- **WebSocket**: Use Bash (wscat/ws-client) - Connect, receive events, validate sequence
- **Migration**: Use Bash - Run script, verify data integrity

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput by grouping independent tasks into parallel waves.
> Each wave completes before the next begins.

```
Wave 0 (Foundation - Sequential):
├── Task 1: Setup bun test framework + vitest config
├── Task 2: Define AgentDefinition Prisma model
├── Task 3: Define AgentTeam + Member Prisma models
└── Task 4: Define AgentTeamExecution Prisma models

Wave 1 (Core Models + Seeds - Parallel after Wave 0):
├── Task 5: Create AgentDefinition seed data (3 built-in agents)
├── Task 6: Create AgentDefinition API routes
├── Task 7: Create AgentTeam API routes (CRUD)
├── Task 8: Create AgentTeam execution API routes
└── Task 9: Write TDD tests for AgentDefinition API

Wave 2 (SDK Integration + Service - Parallel after Wave 1):
├── Task 10: Create AgentTeamExecutionService (SDK wrapper)
├── Task 11: Implement Lead Agent + Subagent orchestration
├── Task 12: Create WebSocket server for real-time events
├── Task 13: Write TDD tests for AgentTeam execution
└── Task 14: Implement cost attribution per Agent

Wave 3 (UI Components - Parallel after Wave 2):
├── Task 15: Create AgentTeamList page
├── Task 16: Create AgentTeamBuilder page (visual editor)
├── Task 17: Create AgentTeamExecutionMonitor component
├── Task 18: Create useAgentTeamWebSocket hook
└── Task 19: Create AgentDefinitionEditor page

Wave 4 (Migration + Cleanup - Parallel after Wave 3):
├── Task 20: Create migration script (Workflow → AgentTeam)
├── Task 21: Update EvaluationSession model (workflowId → agentTeamId)
├── Task 22: Remove Workflow API routes
├── Task 23: Remove Workflow UI components
└── Task 24: Remove Workflow Prisma models

Wave FINAL (Verification - 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2,3,4,9,13 |
| 2 | 1 | 5,6 |
| 3 | 1 | 7,8 |
| 4 | 1 | 10,14 |
| 5 | 2 | - |
| 6 | 2 | 10,11 |
| 7 | 3 | 8 |
| 8 | 3,7 | 10,13 |
| 9 | 1,6 | - |
| 10 | 4,6,8 | 11,12,13,14 |
| 11 | 10 | 13,14 |
| 12 | 10 | 18 |
| 13 | 1,8,10,11 | - |
| 14 | 4,10,11 | - |
| 15 | 7 | 16,17,19 |
| 16 | 7,15 | 17 |
| 17 | 8,12,15,16 | - |
| 18 | 12,15 | 17 |
| 19 | 6,15 | - |
| 20 | 7,8 | 21,22,23,24 |
| 21 | 20 | 22 |
| 22 | 20,21 | - |
| 23 | 20 | - |
| 24 | 20 | - |

### Agent Dispatch Summary

- **Wave 0**: **4** - T1-T4 → quick
- **Wave 1**: **5** - T5 → quick, T6-T8 → unspecified-high, T9 → quick
- **Wave 2**: **5** - T10-T14 → deep
- **Wave 3**: **5** - T15-T19 → visual-engineering
- **Wave 4**: **5** - T20 → deep, T21-T24 → quick
- **FINAL**: **4** - F1 → oracle, F2 → unspecified-high, F3 → unspecified-high, F4 → deep

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

- [x] 1. **Setup bun test framework + vitest config**

  **What to do**:
  - Install vitest as test framework (bun add -d vitest)
  - Create `bunfig.toml` with test configuration
  - Create `__tests__/` directory structure
  - Add test scripts to package.json: `"test": "bun test"`
  - Create sample test file to verify setup: `__tests__/setup.test.ts`

  **Must NOT do**:
  - Do NOT use Jest (use bun test)
  - Do NOT create complex test utilities yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single config file change, straightforward setup
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO - Foundation task
  - **Parallel Group**: Wave 0 (Sequential)
  - **Blocks**: Tasks 2,3,4,9,13
  - **Blocked By**: None (can start immediately)

  **References**:
  - `package.json:19-23` - Existing scripts section
  - Bun docs: `https://bun.sh/docs/test/writing`

  **Acceptance Criteria**:
  - [ ] bunfig.toml created with test config
  - [ ] `bun test` command runs without error
  - [ ] `__tests__/setup.test.ts` passes with 1 test

  **QA Scenarios**:
  ```
  Scenario: Test framework runs successfully
    Tool: Bash
    Steps:
      1. bun test __tests__/setup.test.ts
    Expected Result: Output contains "1 pass", "0 fail"
    Evidence: .sisyphus/evidence/task-01-test-setup.txt
  ```

  **Commit**: YES
  - Message: `feat(test): setup bun test framework`
  - Files: bunfig.toml, package.json, __tests__/setup.test.ts

- [x] 2. **Define AgentDefinition Prisma model**

  **What to do**:
  - Add `AgentDefinition` model to `prisma/schema.prisma`
  - Fields: id, userId, name, displayName, description, category, modelConfigId, model, systemPrompt, allowedTools, skills, mcpServers, isActive, isBuiltin, createdAt, updatedAt
  - Add relation to User and ModelConfig
  - Add indexes on name, category, isActive
  - Run `npx prisma db push` to apply changes
  - Write TDD test: `__tests__/prisma/agent-definition.test.ts`

  **Must NOT do**:
  - Do NOT allow nested subagent configuration (SDK limitation)
  - Do NOT add more than 5 fields beyond specified
  - Do NOT create AgentDefinition records yet (Task 5)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single schema file edit, Prisma is well-understood in project
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO - Depends on Task 1
  - **Parallel Group**: Wave 0 (Sequential)
  - **Blocks**: Tasks 5,6
  - **Blocked By**: Task 1

  **References**:
  - `prisma/schema.prisma:14-42` - User model for relation pattern
  - `prisma/schema.prisma:498-523` - ModelConfig model for model binding pattern
  - `src/lib/prisma.ts:1-13` - Prisma singleton import pattern

  **Acceptance Criteria**:
  - [ ] AgentDefinition model exists in schema.prisma
  - [ ] `npx prisma db push` succeeds
  - [ ] Test passes: `bun test __tests__/prisma/agent-definition.test.ts`

  **QA Scenarios**:
  ```
  Scenario: Prisma model can be queried
    Tool: Bash
    Steps:
      1. npx prisma db push
      2. bun test __tests__/prisma/agent-definition.test.ts
    Expected Result: Test creates and queries AgentDefinition
    Evidence: .sisyphus/evidence/task-02-prisma-model.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentDefinition prisma model`
  - Files: prisma/schema.prisma

- [x] 3. **Define AgentTeam + Member Prisma models**

  **What to do**:
  - Add `AgentTeam` model: id, userId, name, description, leadAgentId, taskStrategy, maxTeammates, status, createdAt, updatedAt
  - Add `AgentTeamMember` model: id, teamId, agentId, role, overrideModel, overrideTools, createdAt
  - Add relations: AgentTeam → User, AgentTeam → AgentDefinition (lead), AgentTeam → AgentTeamMember
  - Add indexes on userId, status, leadAgentId
  - Run `npx prisma db push`
  - Write TDD test: `__tests__/prisma/agent-team.test.ts`

  **Must NOT do**:
  - Do NOT add circular dependency detection fields (handled in code)
  - Do NOT add auto-dependency fields (user requested manual)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Similar to Task 2, schema edit
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO - Depends on Task 1
  - **Parallel Group**: Wave 0 (Sequential)
  - **Blocks**: Tasks 7,8
  - **Blocked By**: Task 1

  **References**:
  - `prisma/schema.prisma:353-384` - Workflow model (pattern to follow for team)
  - `prisma/schema.prisma:386-426` - WorkflowNode/Edge pattern for members

  **Acceptance Criteria**:
  - [ ] AgentTeam and AgentTeamMember models exist
  - [ ] `npx prisma db push` succeeds
  - [ ] Test passes: AgentTeam can be created with members

  **QA Scenarios**:
  ```
  Scenario: AgentTeam with members can be created
    Tool: Bash
    Steps:
      1. npx prisma db push
      2. bun test __tests__/prisma/agent-team.test.ts
    Expected Result: Test creates team with 2 members
    Evidence: .sisyphus/evidence/task-03-agent-team-model.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeam and Member prisma models`
  - Files: prisma/schema.prisma

- [x] 4. **Define AgentTeamExecution Prisma models**

  **What to do**:
  - Add `AgentTeamExecution` model: id, teamId, evaluationId, status, startedAt, completedAt, totalInputTokens, totalOutputTokens, createdAt
  - Add `AgentMemberExecution` model: id, teamExecutionId, memberId, status, startedAt, completedAt, inputTokens, outputTokens, createdAt
  - Add relations to AgentTeam, EvaluationSession
  - Add indexes on teamId, evaluationId, status
  - Run `npx prisma db push`
  - Write TDD test: `__tests__/prisma/agent-team-execution.test.ts`

  **Must NOT do**:
  - Do NOT add message log fields (WebSocket handles streaming)
  - Do NOT add detailed error fields (handled in service)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Schema edit, similar pattern
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO - Depends on Task 1
  - **Parallel Group**: Wave 0 (Sequential)
  - **Blocks**: Tasks 10,14
  - **Blocked By**: Task 1

  **References**:
  - `prisma/schema.prisma:199-251` - EvaluationSession model for execution tracking
  - `prisma/schema.prisma:313-335` - NodeExecution pattern for member execution

  **Acceptance Criteria**:
  - [ ] AgentTeamExecution and AgentMemberExecution models exist
  - [ ] `npx prisma db push` succeeds
  - [ ] Test passes: Execution can track member executions

  **QA Scenarios**:
  ```
  Scenario: Execution tracks member costs
    Tool: Bash
    Steps:
      1. bun test __tests__/prisma/agent-team-execution.test.ts
    Expected Result: Test creates execution with member executions and token counts
    Evidence: .sisyphus/evidence/task-04-execution-model.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeamExecution models`
  - Files: prisma/schema.prisma

- [x] 5. **Create AgentDefinition seed data (3 built-in agents)**

  **What to do**:
  - Create `data/agents/security-threat-analyst.md`:
    - name: 安全威胁分析专家
    - description: Expert security threat analyst for vulnerability identification
    - model: opus (complex analysis)
    - tools: [Read, Glob, Grep, LspDiagnostics]
    - systemPrompt: Security-focused prompt for threat analysis
  - Create `data/agents/vulnerability-miner.md`:
    - name: 漏洞挖掘专家
    - description: Deep vulnerability mining specialist
    - model: sonnet (balanced)
    - tools: [Read, Glob, Grep, Bash]
    - systemPrompt: Vulnerability-focused prompt
  - Create `data/agents/doc-reader-generator.md`:
    - name: 文档阅读与生成专家
    - description: Document reading and generation expert
    - model: haiku (fast)
    - tools: [Read, Glob, Write]
    - systemPrompt: Documentation-focused prompt
  - Create seed script `prisma/seed-agent-definitions.ts`
  - Add `npm run db:seed-agents` to package.json

  **Must NOT do**:
  - Do NOT add more than 3 built-in agents
  - Do NOT include "Agent" tool in any agent's tools (no nested subagents)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Markdown file creation + simple seed script
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 6,7,8,9)
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - `data/skills/*.md` - Markdown format for skill definitions (pattern to follow)
  - `prisma/seed.ts:1-391` - Seed script pattern

  **Acceptance Criteria**:
  - [ ] 3 markdown files exist in data/agents/
  - [ ] Each has name, description, model, tools, systemPrompt
  - [ ] Seed script creates 3 AgentDefinition records

  **QA Scenarios**:
  ```
  Scenario: Seed creates 3 agents
    Tool: Bash
    Steps:
      1. npm run db:seed-agents
      2. curl http://localhost:3000/api/agent-definitions
    Expected Result: Response has 3 agentDefinitions with isBuiltin=true
    Evidence: .sisyphus/evidence/task-05-seed-agents.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add 3 built-in agent definitions`
  - Files: data/agents/*.md, prisma/seed-agent-definitions.ts, package.json

- [x] 6. **Create AgentDefinition API routes**

  **What to do**:
  - Create `src/app/api/agent-definitions/route.ts`:
    - GET: List all agent definitions (public + user's own)
    - POST: Create custom agent definition (requires permission)
  - Create `src/app/api/agent-definitions/[id]/route.ts`:
    - GET: Get single agent definition
    - PATCH: Update agent definition (owner only)
    - DELETE: Delete agent definition (owner only, built-in cannot be deleted)
  - Add permission check: AGENT_DEFINITION_CREATE, AGENT_DEFINITION_READ, etc.
  - Write TDD tests: `__tests__/api/agent-definitions.test.ts`

  **Must NOT do**:
  - Do NOT allow deleting built-in agents (isBuiltin=true)
  - Do NOT allow updating built-in agents

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple API routes with auth/permission logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 5,7,8,9)
  - **Blocks**: Tasks 10,11,19
  - **Blocked By**: Task 2

  **References**:
  - `src/app/api/skills/route.ts` - Skills API pattern (similar structure)
  - `src/lib/auth.ts:109-126` - verifyToken pattern
  - `src/types/permissions.ts:97-101` - SKILL permissions pattern (follow for AGENT_DEFINITION)

  **Acceptance Criteria**:
  - [ ] GET /api/agent-definitions returns list
  - [ ] POST /api/agent-definitions creates definition
  - [ ] Built-in agents cannot be deleted
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: List agent definitions
    Tool: Bash (curl)
    Steps:
      1. curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/agent-definitions
    Expected Result: {"agentDefinitions": [...], "total": >=3}
    Evidence: .sisyphus/evidence/task-06-list-agents.txt

  Scenario: Cannot delete built-in agent
    Tool: Bash (curl)
    Steps:
      1. curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/agent-definitions/$BUILTIN_ID
    Expected Result: {"error": "Cannot delete built-in agent"}
    Evidence: .sisyphus/evidence/task-06-delete-builtin-error.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentDefinition API routes`
  - Files: src/app/api/agent-definitions/route.ts, src/app/api/agent-definitions/[id]/route.ts

- [x] 7. **Create AgentTeam API routes (CRUD)**

  **What to do**:
  - Create `src/app/api/agent-teams/route.ts`:
    - GET: List user's agent teams
    - POST: Create agent team with leadAgentId and members
  - Create `src/app/api/agent-teams/[id]/route.ts`:
    - GET: Get agent team with members and dependencies
    - PATCH: Update team configuration
    - DELETE: Delete team (cascade members)
  - Create `src/app/api/agent-teams/[id]/members/route.ts`:
    - POST: Add member to team
    - DELETE: Remove member from team
  - Add dependency validation (no circular dependencies)
  - Write TDD tests: `__tests__/api/agent-teams.test.ts`

  **Must NOT do**:
  - Do NOT auto-generate dependencies (user must configure)
  - Do NOT allow nested teams (SDK limitation)
  - Do NOT allow more than maxTeammates members

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple API routes with validation logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 5,6,8,9)
  - **Blocks**: Task 8
  - **Blocked By**: Task 3

  **References**:
  - `src/app/api/workflows/route.ts` - Workflow API pattern (to be replaced)
  - `src/lib/validation.ts` - Validation utilities

  **Acceptance Criteria**:
  - [ ] GET /api/agent-teams returns list
  - [ ] POST /api/agent-teams creates team with members
  - [ ] Circular dependency returns 400 error
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Create agent team
    Tool: Bash (curl)
    Steps:
      1. curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"name":"Test","leadAgentId":"..."}' http://localhost:3000/api/agent-teams
    Expected Result: {"id":"...", "name":"Test", "status":"idle"}
    Evidence: .sisyphus/evidence/task-07-create-team.txt

  Scenario: Circular dependency validation
    Tool: Bash (curl)
    Steps:
      1. curl -X POST -d '{"dependencies":[{"from":"A","to":"B"},{"from":"B","to":"A"}]}' http://localhost:3000/api/agent-teams
    Expected Result: {"error":"Circular dependency detected"}
    Evidence: .sisyphus/evidence/task-07-circular-dep-error.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeam CRUD API routes`
  - Files: src/app/api/agent-teams/route.ts, src/app/api/agent-teams/[id]/route.ts

- [x] 8. **Create AgentTeam execution API routes**

  **What to do**:
  - Create `src/app/api/agent-teams/[id]/execute/route.ts`:
    - POST: Start execution (requires projectId, task prompt, modelConfigId)
    - Returns executionId and websocketUrl
  - Create `src/app/api/agent-teams/[id]/executions/route.ts`:
    - GET: List executions for team
  - Create `src/app/api/agent-teams/[id]/executions/[executionId]/route.ts`:
    - GET: Get execution status and results
    - PATCH: Cancel execution (status → cancelled)
  - Write TDD tests: `__tests__/api/agent-teams-execute.test.ts`

  **Must NOT do**:
  - Do NOT execute agents in API route (delegated to service)
  - Do NOT block on execution completion (WebSocket for streaming)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Execution initiation and monitoring routes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 5,6,7,9)
  - **Blocks**: Tasks 10,13
  - **Blocked By**: Task 3, Task 7

  **References**:
  - `src/app/api/evaluations/route.ts` - Evaluation API pattern
  - `src/lib/websocket-server.ts` - WebSocket server setup

  **Acceptance Criteria**:
  - [ ] POST /api/agent-teams/:id/execute starts execution
  - [ ] Response includes executionId and websocketUrl
  - [ ] GET /api/agent-teams/:id/executions lists executions
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Start execution
    Tool: Bash (curl)
    Steps:
      1. curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"projectId":"...","task":"..."}' http://localhost:3000/api/agent-teams/$TEAM_ID/execute
    Expected Result: {"executionId":"...", "websocketUrl":"ws://..."}
    Evidence: .sisyphus/evidence/task-08-execute-start.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeam execution API`
  - Files: src/app/api/agent-teams/[id]/execute/route.ts, src/app/api/agent-teams/[id]/executions/route.ts

- [x] 9. **Write TDD tests for AgentDefinition API**

  **What to do**:
  - Create `__tests__/api/agent-definitions.test.ts`
  - Test cases:
    - List all definitions
    - Create custom definition
    - Update custom definition
    - Cannot delete built-in definition
    - Permission checks
  - Run `bun test __tests__/api/agent-definitions.test.ts`
  - Ensure all tests pass after Task 6 implementation

  **Must NOT do**:
  - Do NOT add integration tests (API only)
  - Do NOT test UI components

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test file creation, straightforward API tests
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 5,6,7,8)
  - **Blocks**: None
  - **Blocked By**: Task 1, Task 6

  **References**:
  - `__tests__/setup.test.ts` - Test structure pattern
  - Bun test docs: `https://bun.sh/docs/test/writing`

  **Acceptance Criteria**:
  - [ ] 5+ test cases exist
  - [ ] All tests pass
  - [ ] Tests cover permission checks

  **QA Scenarios**:
  ```
  Scenario: Tests pass
    Tool: Bash
    Steps:
      1. bun test __tests__/api/agent-definitions.test.ts
    Expected Result: All tests pass, coverage >= 80%
    Evidence: .sisyphus/evidence/task-09-tests-pass.txt
  ```

  **Commit**: YES
  - Message: `test(agent-team): add AgentDefinition API tests`
  - Files: __tests__/api/agent-definitions.test.ts

- [ ] 10. **Create AgentTeamExecutionService (SDK wrapper)**

  **What to do**:
  - Create `src/services/agent-team/execution-service.ts`
  - Implement AgentTeamExecutionService class:
    - `execute(teamId, projectId, task, modelConfigId)` - Start execution
    - `cancel(executionId)` - Cancel execution
    - `getStatus(executionId)` - Get execution status
  - Wrap Claude Agent SDK `query()` function
  - Implement callbacks: onChunk, onToolUse, onToolResult, onUsage
  - Track token usage per agent (cost attribution)
  - Set safety limits: `maxBudgetUsd: 5.00`, `maxTurns: 20`
  - Write TDD tests: `__tests__/services/execution-service.test.ts`

  **Must NOT do**:
  - Do NOT enable extended thinking with streaming (SDK conflict)
  - Do NOT allow unlimited budget (safety)
  - Do NOT block on execution completion (async)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex SDK integration, multi-file service architecture
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 11,12,13,14)
  - **Blocks**: Tasks 11,12,13,14
  - **Blocked By**: Task 4, Task 6, Task 8

  **References**:
  - `src/services/ai/claude-agent.ts` - Existing ClaudeAgentService pattern (follow closely)
  - `@anthropic-ai/claude-agent-sdk` API docs
  - Research note: `.sisyphus/drafts/multi-agent-team-research.md`

  **Acceptance Criteria**:
  - [ ] AgentTeamExecutionService class exists
  - [ ] execute() calls SDK query() with agents config
  - [ ] Token usage tracked per agent
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Execute creates execution record
    Tool: Bash (bun)
    Steps:
      1. Import service in bun REPL
      2. Call execute() with test team
    Expected Result: Execution record created with status "running"
    Evidence: .sisyphus/evidence/task-10-service-execute.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeamExecutionService`
  - Files: src/services/agent-team/execution-service.ts

- [ ] 11. **Implement Lead Agent + Subagent orchestration**

  **What to do**:
  - Implement Lead Agent invocation with `allowedTools: ["Agent", "Read", "Glob", "Grep"]`
  - Configure Subagent definitions in SDK `agents` option:
    ```typescript
    agents: {
      "subagent-name": AgentDefinition({
        description: "When to use this agent",
        prompt: "System prompt",
        tools: ["Read", "Grep"], // NO "Agent" - no nesting
        model: "opus|sonnet|haiku"
      })
    }
    ```
  - Track subagent invocations via tool_use blocks (Agent tool)
  - Implement parent-child session tracking
  - Write TDD tests for orchestration flow

  **Must NOT do**:
  - Do NOT include "Agent" tool in subagent's tools (SDK limitation)
  - Do NOT create nested subagents
  - Do NOT exceed Windows prompt length (8191 chars)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core orchestration logic, SDK patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 10,12,13,14)
  - **Blocks**: Tasks 13,14
  - **Blocked By**: Task 10

  **References**:
  - Claude Agent SDK docs: Subagents section
  - Research note (GitHub examples): Subagent pattern with AgentDefinition
  - Metis analysis: "CRITICAL: Agent tool in allowedTools"

  **Acceptance Criteria**:
  - [ ] Lead Agent has "Agent" in allowedTools
  - [ ] Subagents do NOT have "Agent" in tools
  - [ ] Subagent invocation tracked via tool_use blocks
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Subagent invoked correctly
    Tool: Bash (bun REPL)
    Steps:
      1. Mock SDK query() call
      2. Check tool_use blocks for Agent tool
    Expected Result: Agent tool invocation found with subagent_type
    Evidence: .sisyphus/evidence/task-11-subagent-invocation.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): implement Lead+Subagent orchestration`
  - Files: src/services/agent-team/execution-service.ts

- [ ] 12. **Create WebSocket server for real-time events**

  **What to do**:
  - Extend `src/lib/websocket-server.ts` or create new file
  - Define event types:
    - `execution_started`: {executionId, teamId}
    - `agent_invoked`: {agentId, parentToolUseId} (null for Lead)
    - `message_delta`: {agentId, content}
    - `agent_completed`: {agentId, result}
    - `execution_completed`: {executionId, result}
  - Implement broadcast to connected clients
  - Create WebSocket route: `src/app/api/agent-teams/[id]/stream/route.ts`
  - Write TDD tests

  **Must NOT do**:
  - Do NOT send all SDK events (filter to 5 event types)
  - Do NOT persist message history (streaming only)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: WebSocket server implementation, event design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 10,11,13,14)
  - **Blocks**: Task 18
  - **Blocked By**: Task 10

  **References**:
  - `src/lib/websocket-server.ts` - Existing WebSocket pattern
  - Research note: WebSocket event types from Metis analysis

  **Acceptance Criteria**:
  - [ ] WebSocket route exists
  - [ ] 5 event types defined and emitted
  - [ ] Clients can connect and receive events
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: WebSocket events received
    Tool: Bash (wscat)
    Steps:
      1. wscat -c ws://localhost:3000/api/agent-teams/$TEAM_ID/stream
      2. Trigger execution via curl
    Expected Result: Receive execution_started, agent_invoked events
    Evidence: .sisyphus/evidence/task-12-websocket-events.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add WebSocket real-time events`
  - Files: src/lib/websocket-server.ts, src/app/api/agent-teams/[id]/stream/route.ts

- [ ] 13. **Write TDD tests for AgentTeam execution**

  **What to do**:
  - Create `__tests__/services/agent-team-execution.test.ts`
  - Test cases:
    - Execution starts with correct SDK config
    - Subagent invocation tracked
    - Token usage attributed per agent
    - WebSocket events emitted
    - Budget exhaustion handled
    - Circular dependency rejected
  - Create mock fixtures for SDK responses
  - Run `bun test __tests__/services/agent-team-execution.test.ts`

  **Must NOT do**:
  - Do NOT require real Claude API calls (use mocks)
  - Do NOT test UI components

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex execution flow testing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 10,11,12,14)
  - **Blocks**: None
  - **Blocked By**: Task 1, Task 8, Task 10, Task 11

  **References**:
  - `__tests__/setup.test.ts` - Test pattern
  - Metis analysis: Acceptance criteria examples

  **Acceptance Criteria**:
  - [ ] 6+ test cases exist
  - [ ] All tests pass with mocks
  - [ ] Tests cover budget exhaustion

  **QA Scenarios**:
  ```
  Scenario: Tests pass
    Tool: Bash
    Steps:
      1. bun test __tests__/services/agent-team-execution.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-13-execution-tests-pass.txt
  ```

  **Commit**: YES
  - Message: `test(agent-team): add execution service tests`
  - Files: __tests__/services/agent-team-execution.test.ts

- [ ] 14. **Implement cost attribution per Agent**

  **What to do**:
  - Track inputTokens and outputTokens per AgentMemberExecution
  - Implement `onUsage` callback in AgentTeamExecutionService
  - Aggregate costs: Lead Agent + Sum(Teammate costs)
  - Store in AgentTeamExecution.totalInputTokens, totalOutputTokens
  - Calculate estimated cost using MODEL_PRICING table
  - Write TDD tests

  **Must NOT do**:
  - Do NOT attribute tool costs to agents (attribute to invoking agent)
  - Do NOT create separate billing system

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cost tracking integration across execution flow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 10,11,12,13)
  - **Blocks**: None
  - **Blocked By**: Task 4, Task 10, Task 11

  **References**:
  - `src/services/evaluation/ralph-loop-agent.ts:20-30` - MODEL_PRICING table
  - `src/services/ai/claude-agent.ts` - onUsage callback pattern
  - `prisma/schema.prisma:1600-1606` - TokenUsage model

  **Acceptance Criteria**:
  - [ ] AgentMemberExecution.inputTokens/outputTokens updated
  - [ ] AgentTeamExecution totals aggregated
  - [ ] Cost calculated correctly per model pricing
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Costs attributed correctly
    Tool: Bash (bun REPL)
    Steps:
      1. Execute team with 2 agents
      2. Check AgentMemberExecution records
    Expected Result: Each member has token counts, team has totals
    Evidence: .sisyphus/evidence/task-14-cost-attribution.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): implement cost attribution per agent`
  - Files: src/services/agent-team/execution-service.ts

- [ ] 15. **Create AgentTeamList page**

  **What to do**:
  - Create `src/app/dashboard/agent-teams/page.tsx`
  - Display list of user's AgentTeams with:
    - Team name, description, status
    - Lead Agent name
    - Number of members
    - Last execution status
  - Add "Create New Team" button → navigate to builder
  - Add "Execute" button on each team → start execution
  - Implement pagination and search
  - Add permission check: AGENT_TEAM_READ

  **Must NOT do**:
  - Do NOT include Workflow reference (AgentTeam replaces it)
  - Do NOT add complex filters (Phase 1)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI page with list display, navigation, permissions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 16,17,18,19)
  - **Blocks**: Tasks 16,17,19
  - **Blocked By**: Task 7

  **References**:
  - `src/app/dashboard/workflows/page.tsx` - Workflow list page (to be replaced, but pattern to follow)
  - `src/app/dashboard/skills/page.tsx` - Skills list pattern

  **Acceptance Criteria**:
  - [ ] AgentTeams displayed in table/card format
  - [ ] "Create New Team" button navigates to builder
  - [ ] "Execute" button triggers execution API
  - [ ] Permission check works

  **QA Scenarios**:
  ```
  Scenario: List page displays teams
    Tool: Playwright
    Steps:
      1. Navigate to /dashboard/agent-teams
      2. Check for team cards/table rows
    Expected Result: Teams displayed with name, lead, members count
    Evidence: .sisyphus/evidence/task-15-list-page.png
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeamList page`
  - Files: src/app/dashboard/agent-teams/page.tsx

- [ ] 16. **Create AgentTeamBuilder page (visual editor)**

  **What to do**:
  - Create `src/app/dashboard/agent-teams/[id]/edit/page.tsx` or `/new/page.tsx`
  - Implement visual team builder:
    - Select Lead Agent from dropdown (AgentDefinitions)
    - Add Teammates by clicking "Add Member" → select Agent
    - Configure member overrides (model, tools)
    - Draw dependency connections (manual config)
    - Set team name and description
  - Save team via POST /api/agent-teams
  - Implement dependency validation (circular detection)
  - Add "Execute" button after save

  **Must NOT do**:
  - Do NOT use @xyflow/react for visual edges (simplified connection config)
  - Do NOT auto-connect dependencies (manual)
  - Do NOT allow nested team configuration

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex UI with forms, selections, validation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 15,17,18,19)
  - **Blocks**: Task 17
  - **Blocked By**: Task 7, Task 15

  **References**:
  - `src/app/dashboard/workflows/[id]/page.tsx` - Workflow editor page (pattern)
  - `src/components/workflow/WorkflowEditor.tsx` - Visual editor pattern (to be replaced)

  **Acceptance Criteria**:
  - [ ] Lead Agent selectable from dropdown
  - [ ] Teammates can be added
  - [ ] Dependencies can be configured manually
  - [ ] Circular dependencies rejected
  - [ ] Team saved successfully

  **QA Scenarios**:
  ```
  Scenario: Create team with dependencies
    Tool: Playwright
    Steps:
      1. Navigate to /dashboard/agent-teams/new
      2. Select Lead Agent
      3. Add 2 Teammates
      4. Configure dependency: Lead → Teammate1 → Teammate2
      5. Click Save
    Expected Result: Team created with dependency chain
    Evidence: .sisyphus/evidence/task-16-builder-create.png
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentTeamBuilder page`
  - Files: src/app/dashboard/agent-teams/[id]/edit/page.tsx, src/app/dashboard/agent-teams/new/page.tsx

- [ ] 17. **Create AgentTeamExecutionMonitor component**

  **What to do**:
  - Create `src/components/agent-team/ExecutionMonitor.tsx`
  - Display real-time execution status:
    - Agent cards with status (pending, running, completed)
    - Message flow visualization (messages between agents)
    - Token usage per agent (live update)
    - Progress bar for team execution
  - Connect to WebSocket for real-time updates
  - Implement "Cancel" button → PATCH execution API
  - Show execution results when completed

  **Must NOT do**:
  - Do NOT display all SDK events (filter to relevant)
  - Do NOT persist execution history (current execution only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Real-time monitoring UI, WebSocket integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 15,16,18,19)
  - **Blocks**: None
  - **Blocked By**: Task 8, Task 12, Task 15, Task 16

  **References**:
  - `src/hooks/useWebSocket.ts` - WebSocket hook pattern
  - Research note: WebSocket event types

  **Acceptance Criteria**:
  - [ ] Agent status cards displayed
  - [ ] Token usage live updates
  - [ ] WebSocket connected
  - [ ] Cancel button works

  **QA Scenarios**:
  ```
  Scenario: Monitor displays live execution
    Tool: Playwright
    Steps:
      1. Start execution
      2. Navigate to monitor page
      3. Observe agent status changes
    Expected Result: Agents transition from pending → running → completed
    Evidence: .sisyphus/evidence/task-17-monitor-live.png
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add ExecutionMonitor component`
  - Files: src/components/agent-team/ExecutionMonitor.tsx

- [ ] 18. **Create useAgentTeamWebSocket hook**

  **What to do**:
  - Create `src/hooks/useAgentTeamWebSocket.ts`
  - Implement WebSocket connection:
    - Connect to ws://localhost:3000/api/agent-teams/:id/stream
    - Parse event types: execution_started, agent_invoked, message_delta, execution_completed
    - Provide state: execution, agents, messages
    - Provide methods: connect, disconnect
  - Handle connection errors and reconnection
  - Write tests with mock WebSocket

  **Must NOT do**:
  - Do NOT use polling (WebSocket only)
  - Do NOT persist message history beyond component lifecycle

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React hook with WebSocket integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 15,16,17,19)
  - **Blocks**: Task 17
  - **Blocked By**: Task 12, Task 15

  **References**:
  - `src/hooks/useWebSocket.ts` - Existing WebSocket hook pattern
  - Research note: Event type definitions

  **Acceptance Criteria**:
  - [ ] Hook connects to WebSocket
  - [ ] Events parsed and state updated
  - [ ] Reconnection handled
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Hook receives events
    Tool: Bash (bun)
    Steps:
      1. Import hook in test
      2. Mock WebSocket events
      3. Check state updates
    Expected Result: Hook state reflects events
    Evidence: .sisyphus/evidence/task-18-websocket-hook.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add useAgentTeamWebSocket hook`
  - Files: src/hooks/useAgentTeamWebSocket.ts

- [ ] 19. **Create AgentDefinitionEditor page**

  **What to do**:
  - Create `src/app/dashboard/agent-definitions/[id]/edit/page.tsx` and `/new/page.tsx`
  - Implement form for custom Agent definition:
    - Name, displayName, description inputs
    - Model selection dropdown (opus, sonnet, haiku)
    - Tools multi-select (Read, Glob, Grep, Write, Edit, Bash)
    - System prompt textarea
    - Skills selection (optional)
  - Save via POST/PATCH /api/agent-definitions
  - Add "Clone" feature for built-in agents (create custom copy)

  **Must NOT do**:
  - Do NOT allow editing built-in agents (clone instead)
  - Do NOT add "Agent" tool to custom agents (no nested)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Form-based UI for agent configuration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 15,16,17,18)
  - **Blocks**: None
  - **Blocked By**: Task 6, Task 15

  **References**:
  - `src/app/dashboard/skills/[id]/page.tsx` - Skill editor pattern

  **Acceptance Criteria**:
  - [ ] Form creates custom AgentDefinition
  - [ ] Model and tools selectable
  - [ ] Clone built-in agent works
  - [ ] Built-in agents cannot be edited directly

  **QA Scenarios**:
  ```
  Scenario: Create custom agent
    Tool: Playwright
    Steps:
      1. Navigate to /dashboard/agent-definitions/new
      2. Fill name, select sonnet model
      3. Select tools: Read, Grep
      4. Enter system prompt
      5. Click Save
    Expected Result: Agent created successfully
    Evidence: .sisyphus/evidence/task-19-agent-editor.png
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add AgentDefinitionEditor page`
  - Files: src/app/dashboard/agent-definitions/[id]/edit/page.tsx

- [ ] 20. **Create migration script (Workflow → AgentTeam)**

  **What to do**:
  - Create `scripts/migrate-workflow-to-agent-team.ts`
  - Implement migration logic:
    - For each Workflow: create AgentTeam with leadAgentId = first WorkflowNode
    - For each WorkflowNode: create AgentTeamMember with agentId = placeholder
    - For each WorkflowEdge: create dependency relationship
    - Set EvaluationSession.workflowId → null (preserve column)
  - Create rollback script: `scripts/rollback-agent-team-migration.ts`
  - Add npm scripts: `migrate:workflow-to-agent-team`, `rollback:agent-team`
  - Write tests for migration logic

  **Must NOT do**:
  - Do NOT delete Workflow data during migration (copy first)
  - Do NOT delete Workflow Prisma models yet (Task 24)
  - Do NOT auto-create AgentDefinitions (user must configure)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex data migration logic, rollback safety
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 21,22,23,24)
  - **Blocks**: Tasks 21,22,23,24
  - **Blocked By**: Task 7, Task 8

  **References**:
  - `prisma/schema.prisma:353-426` - Workflow models to migrate
  - `scripts/migrate-mcp.js` - Migration script pattern

  **Acceptance Criteria**:
  - [ ] Migration script runs without error
  - [ ] Workflows migrated to AgentTeams
  - [ ] Rollback script restores original state
  - [ ] Tests pass

  **QA Scenarios**:
  ```
  Scenario: Migration preserves data
    Tool: Bash
    Steps:
      1. npm run migrate:workflow-to-agent-team
      2. Check AgentTeams count matches Workflows count before
    Expected Result: agentTeams.length === workflows.length before migration
    Evidence: .sisyphus/evidence/task-20-migration-preserve.txt

  Scenario: Rollback works
    Tool: Bash
    Steps:
      1. npm run rollback:agent-team-migration
      2. Check original Workflow data exists
    Expected Result: Workflows restored
    Evidence: .sisyphus/evidence/task-20-rollback.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add migration script`
  - Files: scripts/migrate-workflow-to-agent-team.ts, scripts/rollback-agent-team-migration.ts, package.json

- [ ] 21. **Update EvaluationSession model (workflowId → agentTeamId)**

  **What to do**:
  - Add `agentTeamId` field to EvaluationSession model (nullable)
  - Update evaluation creation logic to use agentTeamId
  - Keep workflowId field for backward compatibility (nullable)
  - Run `npx prisma db push`
  - Update evaluation API routes to support both workflowId and agentTeamId
  - Write tests

  **Must NOT do**:
  - Do NOT delete workflowId column immediately (graceful migration)
  - Do NOT break existing evaluations using workflowId

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Schema field addition + API route updates
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 20,22,23,24)
  - **Blocks**: Task 22
  - **Blocked By**: Task 20

  **References**:
  - `prisma/schema.prisma:199-251` - EvaluationSession model
  - `src/app/api/evaluations/route.ts` - Evaluation API

  **Acceptance Criteria**:
  - [ ] agentTeamId field exists in EvaluationSession
  - [ ] workflowId still exists (nullable)
  - [ ] Evaluation API supports both fields

  **QA Scenarios**:
  ```
  Scenario: Create evaluation with agentTeamId
    Tool: Bash (curl)
    Steps:
      1. curl -X POST -d '{"agentTeamId":"...","projectId":"..."}' /api/evaluations
    Expected Result: Evaluation created with agentTeamId
    Evidence: .sisyphus/evidence/task-21-eval-agentteam.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): add agentTeamId to EvaluationSession`
  - Files: prisma/schema.prisma, src/app/api/evaluations/route.ts

- [ ] 22. **Remove Workflow API routes**

  **What to do**:
  - Delete `src/app/api/workflows/` directory and all subdirectories:
    - /api/workflows/route.ts
    - /api/workflows/[id]/route.ts
    - /api/workflows/[id]/data/route.ts
    - /api/workflows/[id]/preview/route.ts
    - /api/workflows/[id]/shares/route.ts
    - /api/workflows/validate/route.ts
    - /api/workflows/config/route.ts
  - Update navigation/sidebar to remove Workflow link
  - Verify no API references remain (use grep)

  **Must NOT do**:
  - Do NOT remove routes before migration verified
  - Do NOT remove Workflow Prisma models yet (Task 24)
  - Do NOT break evaluations using agentTeamId

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion, navigation update
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 20,21,23,24)
  - **Blocks**: None
  - **Blocked By**: Task 20, Task 21

  **References**:
  - `src/app/api/workflows/` - Directory to delete
  - Metis analysis: "20+ files to replace/delete"

  **Acceptance Criteria**:
  - [ ] No workflow API routes exist
  - [ ] No navigation links to workflows
  - [ ] grep shows no references to /api/workflows

  **QA Scenarios**:
  ```
  Scenario: Workflow API removed
    Tool: Bash
    Steps:
      1. curl http://localhost:3000/api/workflows
    Expected Result: 404 Not Found
    Evidence: .sisyphus/evidence/task-22-workflow-api-404.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): remove Workflow API routes`
  - Files: src/app/api/workflows/* (deleted)

- [ ] 23. **Remove Workflow UI components**

  **What to do**:
  - Delete `src/app/dashboard/workflows/` pages:
    - /dashboard/workflows/page.tsx (1047 lines)
    - /dashboard/workflows/[id]/page.tsx (289 lines)
  - Delete `src/components/workflow/` directory:
    - WorkflowEditor.tsx (1341+ lines)
    - WorkflowVisualizer.tsx
    - CustomNodes.tsx
    - NodePalette.tsx
  - Remove @xyflow/react dependency if unused elsewhere
  - Update dashboard layout to remove workflow navigation

  **Must NOT do**:
  - Do NOT remove components that AgentTeam UI uses
  - Do NOT break other features using @xyflow/react

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion, dependency check
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 20,21,22,24)
  - **Blocks**: None
  - **Blocked By**: Task 20

  **References**:
  - `src/app/dashboard/workflows/` - Pages to delete
  - `src/components/workflow/` - Components to delete
  - `package.json:31` - @xyflow/react dependency

  **Acceptance Criteria**:
  - [ ] No workflow pages exist
  - [ ] No workflow components exist
  - [ ] No navigation links to workflows

  **QA Scenarios**:
  ```
  Scenario: Workflow pages removed
    Tool: Bash
    Steps:
      1. ls src/app/dashboard/workflows
    Expected Result: Directory not found
    Evidence: .sisyphus/evidence/task-23-workflow-pages-removed.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): remove Workflow UI components`
  - Files: src/app/dashboard/workflows/* (deleted), src/components/workflow/* (deleted)

- [ ] 24. **Remove Workflow Prisma models**

  **What to do**:
  - Delete Workflow-related Prisma models:
    - Workflow (lines 353-384)
    - WorkflowNode (lines 386-404)
    - WorkflowEdge (lines 406-426)
    - WorkflowExecution (lines 429-452)
    - WorkflowExecutionStep (lines 454-474)
    - WorkflowShare (lines 476-495)
  - Remove Workflow permissions from permissions seed
  - Run `npx prisma db push`
  - Verify no references to Workflow models in code (grep)

  **Must NOT do**:
  - Do NOT delete models before migration verified
  - Do NOT break AgentTeam models
  - Do NOT delete User.project/workflows relations if used

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Schema cleanup, permission update
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 20,21,22,23)
  - **Blocks**: None
  - **Blocked By**: Task 20

  **References**:
  - `prisma/schema.prisma:353-495` - Workflow models to delete
  - `prisma/seed.ts:162-169` - Workflow permissions in DEFAULT_ROLE_PERMISSIONS
  - `src/types/permissions.ts:48-57` - Workflow permissions

  **Acceptance Criteria**:
  - [ ] No Workflow models in schema.prisma
  - [ ] Workflow permissions removed
  - [ ] No code references to Workflow models

  **QA Scenarios**:
  ```
  Scenario: Workflow models removed
    Tool: Bash
    Steps:
      1. grep "model Workflow" prisma/schema.prisma
    Expected Result: No matches
    Evidence: .sisyphus/evidence/task-24-workflow-models-removed.txt
  ```

  **Commit**: YES
  - Message: `feat(agent-team): remove Workflow Prisma models`
  - Files: prisma/schema.prisma, prisma/seed.ts, src/types/permissions.ts

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod. Check AI slop.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases: circular dependency, budget exhaustion, agent timeout. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 0**: `feat(agent-team): add prisma models and test config` - schema.prisma, bunfig.toml
- **Wave 1**: `feat(agent-team): add agent definition and team APIs` - api/agent-definitions/, api/agent-teams/, data/agents/
- **Wave 2**: `feat(agent-team): add SDK execution service and WebSocket` - services/agent-team/, hooks/
- **Wave 3**: `feat(agent-team): add UI components` - app/dashboard/agent-teams/, components/
- **Wave 4**: `feat(agent-team): migrate workflow to agent-team` - scripts/migrate-*, remove workflow files
- **Final**: `chore(agent-team): final verification and cleanup`

---

## Success Criteria

### Verification Commands
```bash
# AgentDefinition API
curl http://localhost:3000/api/agent-definitions -H "Authorization: Bearer $TOKEN"
# Expected: {"agentDefinitions": [...], "total": 3}

# AgentTeam creation
curl -X POST http://localhost:3000/api/agent-teams -d '{"name": "Test Team", "leadAgentId": "..."}'
# Expected: {"id": "...", "status": "created"}

# AgentTeam execution
curl -X POST http://localhost:3000/api/agent-teams/$ID/execute -d '{"projectId": "..."}'
# Expected: {"executionId": "...", "websocketUrl": "ws://..."}

# TDD tests
bun test __tests__/agent-team/
# Expected: All tests PASS

# Migration
npm run migrate:workflow-to-agent-team
# Expected: Migration completed, workflows migrated to agentTeams
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] WebSocket events verified
- [ ] Migration completed
- [ ] Workflow files removed