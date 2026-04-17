# Skill Loading Reliability - MCP Tool Migration

## TL;DR

> **Quick Summary**: 将 Claude SDK 的 skill 加载机制从 prompt-based 转换为 MCP tools + `allowed_tools` 白名单，消除随机性，实现 100% 确定性调用
> 
> **Deliverables**:
> - MCP skill server 实现（替代 `.claude/skills/` 目录）
> - Skill → MCP tool 自动转换器
> - Hook-based 动态 skill 选择机制
> - TDD 测试套件验证确定性
> 
> **Estimated Effort**: Large (涉及核心架构改造)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Skill audit → MCP converter → Integration → Migration validation

---

## Context

### Original Request
项目使用 Claude SDK 通过 `.claude/skills/` 目录 + 提示词自动触发加载 skill（用于安全漏洞扫描）。当前机制存在随机性——有时 skill 被调用有时被忽略。需要实现精准、稳定的批量 skill 加载。

### Interview Summary
**Key Discussions**:
- **问题根源**: Prompt-based loading 本质不可靠——LLM 有自主选择权
- **当前机制**: `copySkillsToProject()` → `.claude/skills/` → `settingSources: ['project']` 自动发现
- **调用规模**: 单次扫描 20+ skill，无明显失败规律
- **策略选择**: 动态选择（根据技术栈），时间不敏感
- **兼容性决策**: 完全替换现有机制

**Research Findings**:
- **Librarian**: `allowed_tools` 是确定性方案首选，MCP server 可注册自定义 tools，hooks 可动态控制
- **Explore**: 项目已有完整 skill 系统（119 个定义），通过 `skill-files.ts` 复制到项目目录

### Metis Review
**Identified Gaps** (addressed):
- 基线指标缺失 → 将建立失败率测量作为 Wave 1 任务
- 性能预算未确认 → 设定为 < 20% 性能波动（时间不敏感用户可接受）
- Skill schema 兼容性 → Wave 1 包含 150+ skill audit 任务
- 回滚策略 → 保留旧代码路径作为 fallback，通过配置开关切换

**Guardrails Applied**:
- MUST preserve all 119 existing skills functionality
- MUST achieve 100% deterministic skill loading
- MUST NOT refactor adjacent code beyond skill loading paths
- MUST NOT change skill definition format unless conversion requires
- MUST NOT add new features (versioning, marketplace, etc.)

---

## Work Objectives

### Core Objective
消除 skill 加载随机性，实现 100% 确定性的批量 skill 调用机制

### Concrete Deliverables
- `src/services/mcp/skill-server.ts` - MCP skill server 实现
- `src/services/skill-mcp-converter.ts` - Skill → MCP tool 转换器
- `src/lib/skill-selector-hook.ts` - Hook-based 动态选择
- `src/__tests__/skill-loading.test.ts` - TDD 确定性测试套件
- 移除 `copySkillsToProject()` 相关代码路径

### Definition of Done
- [ ] 10 次相同输入执行 → 相同 skills 加载（100% 确定性）
- [ ] 所有 119 个 skills 可通过 MCP 调用
- [ ] 动态选择测试通过（技术栈匹配正确）
- [ ] vitest 覆盖率 >= 80%（新代码）
- [ ] 性能波动 < 20%（vs baseline）

### Must Have
- MCP server 注册所有 skills 为 tools
- `allowed_tools` 白名单机制
- Hook-based 动态 skill 选择（根据技术栈）
- 自动化 skill → MCP schema 转换
- TDD 测试验证确定性

### Must NOT Have (Guardrails from Metis)
- 不改变 skill markdown 定义格式（除非转换必需）
- 不重构 adjacent 代码（agent-executor, scan-executor 超出 skill loading 的部分）
- 不添加新功能（versioning, marketplace, analytics）
- 不手动修改 150+ skill 文件

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: TDD
- **Framework**: vitest
- **Each task follows**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend/API**: Bash (curl) - Send requests, assert status + response fields
- **Library/Module**: Bash (node REPL / vitest) - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - validation + scaffolding):
├── Task 1: Baseline metrics measurement [quick]
├── Task 2: 150+ skill schema audit [deep]
├── Task 3: MCP skill server scaffolding [quick]
├── Task 4: Skill selector hook scaffolding [quick]
└── Task 5: Test scaffolding - determinism tests [quick]

Wave 2 (After Wave 1 - core implementation):
├── Task 6: Skill → MCP tool converter [deep]
├── Task 7: MCP skill server implementation [deep]
├── Task 8: Hook-based dynamic selection [deep]
├── Task 9: Integration with claude-agent.ts [unspecified-high]
└── Task 10: Integration with scan-executor.ts [unspecified-high]

Wave 3 (After Wave 2 - migration + cleanup):
├── Task 11: Bulk skill conversion (150+ skills) [unspecified-high]
├── Task 12: Remove old copySkillsToProject path [quick]
├── Task 13: Update API routes [quick]
├── Task 14: Documentation update [writing]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Determinism QA validation (unspecified-high)
├── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

- **1-5**: No dependencies (Wave 1 parallel)
- **6**: Depends on 2 (schema audit results)
- **7**: Depends on 3, 6 (scaffolding + converter)
- **8**: Depends on 4, 6 (scaffolding + converter)
- **9**: Depends on 7, 8 (server + hook)
- **10**: Depends on 9 (integration complete)
- **11**: Depends on 6 (converter ready)
- **12**: Depends on 10, 11 (all integrations + skills converted)
- **13**: Depends on 10 (integration complete)
- **14**: Depends on 10, 11 (all features ready)
- **F1-F4**: Depends on ALL implementation tasks

---

## TODOs

- [ ] 1. **Baseline Metrics Measurement**

  **What to do**:
  - 测量当前 skill 加载失败率（作为改进基线）
  - 测量当前 skill 加载时间（性能基线）
  - 创建 metrics 记录文件 `.sisyphus/evidence/baseline-metrics.json`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的测量和数据收集任务
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: None (pure measurement)
  - **Blocked By**: None

  **References**:
  - `src/lib/scan-executor.ts:executeScan()` - 扫描入口，测量点
  - `src/services/skills.ts:loadActiveSkills()` - skill 加载入口

  **QA Scenarios**:
  ```
  Scenario: Baseline metrics recorded
    Tool: Bash
    Steps:
      1. Run 10 test scans with identical inputs
      2. Count successful skill invocations vs total expected
      3. Record average load time per scan
      4. Write metrics to .sisyphus/evidence/baseline-metrics.json
    Expected Result: JSON file with {failure_rate: X%, avg_load_time: Ys}
    Evidence: .sisyphus/evidence/task-1-baseline-metrics.json
  ```

  **Commit**: NO ( Wave 1 grouped commit)

- [ ] 2. **119 Skills Schema Audit**

  **What to do**:
  - 遍历 `data/skills/` 所有 skill 定义文件（119 个）
  - 分析每个 skill 的结构：是否有复杂嵌套、动态参数、依赖关系
  - 标记无法直接转换为 MCP schema 的 skill（需要特殊处理）
  - 输出 audit 报告

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要深入分析 150+ 文件，识别转换风险
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-5)
  - **Blocks**: Task 6 (converter depends on audit results)
  - **Blocked By**: None

  **References**:
  - `data/skills/*/SKILL.md` - 所有 skill 定义文件
  - `src/services/skill-files.ts:getSkillMetadata()` - skill 元数据解析

  **QA Scenarios**:
  ```
  Scenario: Audit report generated
    Tool: Bash
    Steps:
      1. List all skill files in data/skills/
      2. Parse frontmatter and content structure
      3. Identify skills with complex structures
      4. Generate audit report JSON
    Expected Result: Report with {total: N, simple: N, complex: N, incompatible: [names]}
    Evidence: .sisyphus/evidence/task-2-skill-audit.json
  ```

  **Commit**: NO (Wave 1 grouped commit)

- [ ] 3. **MCP Skill Server Scaffolding**

  **What to do**:
  - 创建 `src/services/mcp/skill-server.ts` 文件骨架
  - 定义 MCP server 接口结构（name, version, tools placeholder）
  - 添加类型定义

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的文件和类型创建
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-5)
  - **Blocks**: Task 7 (implementation depends on scaffolding)
  - **Blocked By**: None

  **References**:
  - `src/services/mcp/` - MCP 服务目录结构参考
  - Claude Agent SDK MCP patterns (from librarian research)

  **QA Scenarios**:
  ```
  Scenario: Scaffolding file exists
    Tool: Bash
    Steps:
      1. Test-Path src/services/mcp/skill-server.ts
      2. Verify file contains McpServerConfig interface
    Expected Result: File exists with valid TypeScript structure
    Evidence: .sisyphus/evidence/task-3-scaffolding.txt
  ```

  **Commit**: NO (Wave 1 grouped commit)

- [ ] 4. **Skill Selector Hook Scaffolding**

  **What to do**:
  - 创建 `src/lib/skill-selector-hook.ts` 文件骨架
  - 定义 hook 接口：PreToolUse hook 签名
  - 定义 skill 选择逻辑占位符（技术栈匹配）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的文件和接口创建
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5)
  - **Blocks**: Task 8 (implementation depends on scaffolding)
  - **Blocked By**: None

  **References**:
  - Claude Agent SDK hooks documentation (from librarian)
  - `src/lib/agent-executor.ts` - hook 可能的集成点

  **QA Scenarios**:
  ```
  Scenario: Hook scaffolding file exists
    Tool: Bash
    Steps:
      1. Test-Path src/lib/skill-selector-hook.ts
      2. Verify file contains SkillSelectorHook interface
    Expected Result: File exists with valid TypeScript structure
    Evidence: .sisyphus/evidence/task-4-hook-scaffolding.txt
  ```

  **Commit**: NO (Wave 1 grouped commit)

- [ ] 5. **Test Scaffolding - Determinism Tests**

  **What to do**:
  - 创建 `src/__tests__/skill-loading.test.ts`
  - 编写 TDD RED tests：
    - 测试 10 次相同输入应返回相同 skill 列表
    - 测试动态选择（技术栈匹配）
    - 测试 MCP tool 可用性
  - 确保所有测试初始状态为 FAIL

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 测试文件创建，遵循 TDD 模式
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4)
  - **Blocks**: Wave 2 tasks (tests must be written first for TDD)
  - **Blocked By**: None

  **References**:
  - `vitest.config.ts` - vitest 配置
  - `src/__tests__/` - 测试目录结构参考

  **QA Scenarios**:
  ```
  Scenario: TDD tests exist and fail (RED phase)
    Tool: Bash
    Steps:
      1. Test-Path src/__tests__/skill-loading.test.ts
      2. npm run test -- src/__tests__/skill-loading.test.ts
      3. Verify output contains "FAIL" for all tests
    Expected Result: Test file exists, all tests FAIL (as expected for TDD RED)
    Evidence: .sisyphus/evidence/task-5-tests-red.txt
  ```

  **Commit**: YES (Wave 1)
  - Message: `test(skill-loading): add determinism baseline tests (RED)`
  - Files: `src/__tests__/skill-loading.test.ts`

---

- [ ] 6. **Skill → MCP Tool Converter**

  **What to do**:
  - 实现 `src/services/skill-mcp-converter.ts`
  - 将 skill markdown 定义转换为 MCP tool schema:
    - frontmatter → tool name, description
    - skill content → tool instructions (input_schema)
  - 处理复杂 skill 结构（从 audit 结果）
  - 单元测试验证转换正确性

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心转换逻辑，需要深入理解 skill 和 MCP schema 格式
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-8)
  - **Parallel Group**: Wave 2 (with Tasks 7-10)
  - **Blocks**: Task 11 (bulk conversion depends on converter)
  - **Blocked By**: Task 2 (audit results needed)

  **References**:
  - `data/skills/*/SKILL.md` - skill 定义格式示例
  - MCP tool schema format (from librarian research)
  - `src/services/skills.ts:parseSkillMarkdown()` - 可复用的解析逻辑

  **QA Scenarios**:
  ```
  Scenario: Converter produces valid MCP schema
    Tool: Bash (vitest)
    Steps:
      1. npm run test -- skill-mcp-converter.test.ts
      2. Verify test passes with valid MCP schema output
    Expected Result: Test PASS, schema matches MCP specification
    Evidence: .sisyphus/evidence/task-6-converter.txt

  Scenario: Complex skill handled correctly
    Tool: Bash (vitest)
    Steps:
      1. Feed complex skill markdown to converter
      2. Verify output has appropriate input_schema structure
    Expected Result: No conversion errors, valid schema
    Evidence: .sisyphus/evidence/task-6-complex-skill.txt
  ```

  **Commit**: NO (Wave 2 grouped commit)

- [ ] 7. **MCP Skill Server Implementation**

  **What to do**:
  - 实现 `src/services/mcp/skill-server.ts`:
    - 注册所有 skills 为 MCP tools
    - 实现 tool execution handlers
    - 配置 `allowed_tools` 白名单
  - 测试 server 可以被 Claude Agent SDK 加载

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心 MCP server 实现，需要理解 Claude Agent SDK 集成
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 8)
  - **Parallel Group**: Wave 2 (with Tasks 6, 8-10)
  - **Blocks**: Task 9 (integration depends on server)
  - **Blocked By**: Task 3 (scaffolding), Task 6 (converter)

  **References**:
  - `src/services/ai/claude-agent.ts` - Claude Agent SDK 集成模式
  - Claude Agent SDK MCP patterns (from librarian)
  - `src/services/mcp/` - MCP 服务目录结构参考

  **QA Scenarios**:
  ```
  Scenario: MCP server registers skills as tools
    Tool: Bash (vitest)
    Steps:
      1. npm run test -- skill-server.test.ts
      2. Verify getToolList() returns all skill-based tools
    Expected Result: Tool count >= 119
    Evidence: .sisyphus/evidence/task-7-server.txt

  Scenario: Tool execution returns skill content
    Tool: Bash (vitest)
    Steps:
      1. Call skill tool via mock handler
      2. Verify response contains skill instructions
    Expected Result: Tool execution succeeds with skill content
    Evidence: .sisyphus/evidence/task-7-tool-exec.txt
  ```

  **Commit**: NO (Wave 2 grouped commit)

- [ ] 8. **Hook-Based Dynamic Selection**

  **What to do**:
  - 实现 `src/lib/skill-selector-hook.ts`:
    - PreToolUse hook 逻辑
    - 根据技术栈动态调整 `allowed_tools`
    - 技术栈检测：分析项目文件 (package.json, tsconfig.json 等)
  - 测试 hook 正确过滤 skills

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 动态选择逻辑，需要理解 hooks 和技术栈检测
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7)
  - **Parallel Group**: Wave 2 (with Tasks 6-7, 9-10)
  - **Blocks**: Task 9 (integration depends on hook)
  - **Blocked By**: Task 4 (scaffolding), Task 6 (converter)

  **References**:
  - `src/lib/scan-executor.ts` - 技术栈检测参考
  - Claude Agent SDK hooks documentation (from librarian)
  - `prisma/schema.prisma:Skill.techStack` - 技术栈字段定义

  **QA Scenarios**:
  ```
  Scenario: Hook selects skills matching tech stack
    Tool: Bash (vitest)
    Steps:
      1. Mock project with techStack: ["typescript", "react"]
      2. Run skill selector hook
      3. Verify returned skills match tech stack
    Expected Result: Only skills with matching techStack returned
    Evidence: .sisyphus/evidence/task-8-selection.txt

  Scenario: Hook filters out non-matching skills
    Tool: Bash (vitest)
    Steps:
      1. Mock project with techStack: ["python"]
      2. Run skill selector hook
      3. Verify frontend skills are excluded
    Expected Result: Frontend-related skills NOT in result
    Evidence: .sisyphus/evidence/task-8-filter.txt
  ```

  **Commit**: NO (Wave 2 grouped commit)

- [ ] 9. **Integration with claude-agent.ts**

  **What to do**:
  - 修改 `src/services/ai/claude-agent.ts`:
    - 配置 MCP skill server
    - 配置 skill selector hook
    - 移除 `settingSources: ['project']` 依赖
  - 确保新机制生效

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 关键集成修改，需要仔细处理 SDK 配置
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 10)
  - **Parallel Group**: Wave 2 (with Tasks 6-8, 10)
  - **Blocks**: Tasks 11-14 (all depend on integration)
  - **Blocked By**: Tasks 7, 8 (server + hook ready)

  **References**:
  - `src/services/ai/claude-agent.ts:createClaudeAgentService()` - 配置入口
  - Claude Agent SDK ClaudeAgentOptions interface (from librarian)
  - `src/services/skills.ts` - 当前 skill 加载逻辑（要替换的部分）

  **QA Scenarios**:
  ```
  Scenario: Claude agent loads MCP skill server
    Tool: Bash (vitest)
    Steps:
      1. Create Claude agent service instance
      2. Verify mcp_servers config includes skill server
      3. Verify hooks config includes skill selector
    Expected Result: MCP server and hooks properly configured
    Evidence: .sisyphus/evidence/task-9-integration.txt

  Scenario: settingSources no longer needed
    Tool: Bash
    Steps:
      1. Read claude-agent.ts
      2. Verify settingSources does NOT include 'project'
    Expected Result: No settingSources=['project'] dependency
    Evidence: .sisyphus/evidence/task-9-no-settingsources.txt
  ```

  **Commit**: NO (Wave 2 grouped commit)

- [ ] 10. **Integration with scan-executor.ts**

  **What to do**:
  - 修改 `src/lib/scan-executor.ts`:
    - 移除 `copySkillsToProject()` 调用
    - 改用 MCP skill server 获取 skills
    - 验证扫描流程仍正常工作

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 扫描执行核心修改，需要确保功能不退化
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9)
  - **Parallel Group**: Wave 2 (with Tasks 6-9)
  - **Blocks**: Tasks 11-14 (all depend on integration)
  - **Blocked By**: Task 9 (claude-agent integration first)

  **References**:
  - `src/lib/scan-executor.ts:executeScan()` - 扫描入口
  - `src/services/skill-files.ts:copySkillsToProject()` - 要移除的函数

  **QA Scenarios**:
  ```
  Scenario: Scan no longer uses copySkillsToProject
    Tool: Bash
    Steps:
      1. Read scan-executor.ts
      2. Verify copySkillsToProject is NOT called
    Expected Result: Function call removed
    Evidence: .sisyphus/evidence/task-10-no-copy.txt

  Scenario: Scan execution still works
    Tool: Bash (vitest)
    Steps:
      1. npm run test -- scan-executor.test.ts
      2. Verify scan completes with MCP skills
    Expected Result: Test PASS, skills loaded via MCP
    Evidence: .sisyphus/evidence/task-10-scan.txt
  ```

  **Commit**: YES (Wave 2)
  - Message: `feat(skill-loading): implement MCP skill server + converter`
  - Files: `src/services/skill-mcp-converter.ts`, `src/services/mcp/skill-server.ts`, `src/lib/skill-selector-hook.ts`, `src/services/ai/claude-agent.ts`, `src/lib/scan-executor.ts`
  - Pre-commit: `npm run test`

---

- [ ] 11. **Bulk Skill Conversion (119 Skills)**

  **What to do**:
  - 运行 converter 批量转换所有 `data/skills/` skills（119 个）
  - 验证转换结果完整性
  - 处理转换失败的 skill（根据 audit 报告的特殊处理）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 大批量操作，需要确保无遗漏
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12-14)
  - **Parallel Group**: Wave 3 (with Tasks 12-14)
  - **Blocks**: Final Verification
  - **Blocked By**: Task 6 (converter ready)

  **References**:
  - `data/skills/` - 所有 skill 定义
  - `src/services/skill-mcp-converter.ts:convertAllSkills()` - 批量转换函数
  - `.sisyphus/evidence/task-2-skill-audit.json` - audit 报告（指导特殊处理）

  **QA Scenarios**:
  ```
  Scenario: All skills converted successfully
    Tool: Bash
    Steps:
      1. Run converter script
      2. Count converted MCP tools
      3. Compare against original skill count
    Expected Result: Converted count >= 150
    Evidence: .sisyphus/evidence/task-11-bulk-convert.json

  Scenario: Failed conversions handled
    Tool: Bash
    Steps:
      1. Check conversion log for failures
      2. Verify fallback handling for complex skills
    Expected Result: Zero unhandled failures OR documented exceptions
    Evidence: .sisyphus/evidence/task-11-failures.txt
  ```

  **Commit**: NO (Wave 3 grouped commit)

- [ ] 12. **Remove Old copySkillsToProject Path**

  **What to do**:
  - 删除 `src/services/skill-files.ts` 中不再使用的函数
  - 删除 `.claude/skills/` 目录依赖
  - 清理相关导入和调用点

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的代码清理
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11, 13-14)
  - **Parallel Group**: Wave 3 (with Tasks 11, 13-14)
  - **Blocks**: Final Verification
  - **Blocked By**: Tasks 10, 11 (integration + conversion complete)

  **References**:
  - `src/services/skill-files.ts:copySkillsToProject()` - 要删除的函数
  - `src/app/api/projects/[id]/start/route.ts` - 调用点清理

  **QA Scenarios**:
  ```
  Scenario: Old function removed
    Tool: Bash
    Steps:
      1. Read skill-files.ts
      2. Verify copySkillsToProject NOT present
    Expected Result: Function deleted
    Evidence: .sisyphus/evidence/task-12-remove.txt

  Scenario: No orphaned imports
    Tool: Bash (tsc)
    Steps:
      1. npm run build
      2. Verify no TypeScript errors
    Expected Result: Build PASS, no undefined references
    Evidence: .sisyphus/evidence/task-12-build.txt
  ```

  **Commit**: NO (Wave 3 grouped commit)

- [ ] 13. **Update API Routes**

  **What to do**:
  - 修改 `/api/skills/*` 路由，返回 MCP tools 列表
  - 修改 `/api/projects/[id]/start` 路由，移除 skill 复制步骤
  - 确保 API 响应格式兼容现有前端

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: API 路由简单修改
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11-12, 14)
  - **Parallel Group**: Wave 3 (with Tasks 11-12, 14)
  - **Blocks**: Final Verification
  - **Blocked By**: Task 10 (integration complete)

  **References**:
  - `src/app/api/skills/route.ts` - skills API
  - `src/app/api/projects/[id]/start/route.ts` - project start API

  **QA Scenarios**:
  ```
  Scenario: Skills API returns MCP tools
    Tool: Bash (curl)
    Steps:
      1. curl http://localhost:3000/api/skills/mcp/list
      2. Verify response contains MCP tool format
    Expected Result: JSON array with tool definitions
    Evidence: .sisyphus/evidence/task-13-api-skills.json

  Scenario: Project start no longer copies skills
    Tool: Bash
    Steps:
      1. Read projects/[id]/start/route.ts
      2. Verify copySkillsToProject NOT called
    Expected Result: Function call removed
    Evidence: .sisyphus/evidence/task-13-api-start.txt
  ```

  **Commit**: NO (Wave 3 grouped commit)

- [ ] 14. **Documentation Update**

  **What to do**:
  - 更新 `AGENTS.md` 中 skill 加载相关说明
  - 添加 MCP skill server 使用说明
  - 更新 API 文档

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 文档撰写任务
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11-13)
  - **Parallel Group**: Wave 3 (with Tasks 11-13)
  - **Blocks**: Final Verification
  - **Blocked By**: Tasks 10, 11 (all features ready)

  **References**:
  - `AGENTS.md` - 项目文档
  - `README.md` - API 说明部分

  **QA Scenarios**:
  ```
  Scenario: Documentation reflects new mechanism
    Tool: Bash
    Steps:
      1. Read AGENTS.md
      2. Verify MCP skill server mentioned
      3. Verify .claude/skills/ NOT mentioned as primary method
    Expected Result: Documentation describes MCP approach
    Evidence: .sisyphus/evidence/task-14-docs.txt
  ```

  **Commit**: YES (Wave 3)
  - Message: `docs(skill-loading): document MCP skill server migration`
  - Files: `AGENTS.md`, `README.md`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify all Must Have items implemented, all Must NOT Have absent.
  Check evidence files in `.sisyphus/evidence/`.

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + vitest + lint. Check for AI slop patterns.

- [ ] F3. **Determinism QA Validation** — `unspecified-high`
  Execute 10 identical agent calls, verify same skills loaded each time.
  Test dynamic selection (tech stack matching).

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify no scope creep (no versioning, no marketplace, no format changes).

---

## Commit Strategy

- **Wave 1**: `test(skill-loading): add determinism baseline tests`
- **Wave 2**: `feat(skill-loading): implement MCP skill server + converter`
- **Wave 3**: `refactor(skill-loading): remove old copySkillsToProject path`
- **Final**: `feat(skill-loading): complete MCP migration with 100% determinism`

---

## Success Criteria

### Verification Commands
```bash
# Determinism test (10 runs, same result)
for i in {1..10}; do npm run test:skill-loading; done | grep "PASS" | wc -l
# Expected: 10

# Skill availability
curl -s http://localhost:3000/api/skills/mcp/list | jq 'length'
# Expected: >= 119

# Coverage check
npm run test:coverage | grep "All files"
# Expected: >= 80%
```

### Final Checklist
- [ ] All 119 skills accessible via MCP
- [ ] 100% determinism verified (10 runs identical)
- [ ] Dynamic selection working (tech stack matching)
- [ ] All tests pass
- [ ] No regressions in existing agent execution