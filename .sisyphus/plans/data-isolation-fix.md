# 数据隔离漏洞全面修复计划

## TL;DR

> **Quick Summary**: 全面修复项目中所有 API 路由的数据隔离漏洞，添加 userId 验证和管理员绕过逻辑，确保多用户系统中用户（除管理员外）只能访问自己的资源。
> 
> **Deliverables**:
> - 修复 Projects 模块所有路由 (6 个端点)
> - 修复 Evaluations 模块所有路由 (8 个端点)
> - 修复 Vulnerabilities 模块所有路由 (8 个端点)
> - 修复其他模块路由 (5 个端点)
> - 共 27 个端点通过安全验证
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Task 1 → Tasks 2-6 → Tasks 7-15 → Tasks 16-22 → Final Verification

---

## Context

### Original Request
用户要求分析项目的多租户数据隔离设计，确认各模块是否按"除管理员外，用户只能看到自己的资源或数据，除非是共享的资源"逻辑设计。

### Interview Summary
**Key Discussions**:
- 分析了项目所有 API 路由的数据隔离实现
- 发现多个模块存在严重安全漏洞
- 管理员应该可以查看所有数据
- 用户选择将所有问题合并到一个计划中修复

### 研究发现汇总

**安全漏洞统计**:
- 🔴 高危: 21 个端点
- 🟡 中危: 4 个端点
- 🟢 低危: 2 个端点

**受影响模块**:
| 模块 | 高危 | 中危 | 低危 |
|------|------|------|------|
| Projects | 5 | 0 | 0 |
| Evaluations | 7 | 1 | 0 |
| Vulnerabilities | 7 | 0 | 0 |
| Autonomous-Evolution | 0 | 2 | 0 |
| Agent Executions | 0 | 1 | 0 |
| Messages | 1 | 0 | 0 |
| Sessions | 1 | 0 | 0 |
| Expected Output Templates | 0 | 0 | 1 |

### Metis Review 已整合
- 管理员检测机制：使用 `payload.roles?.includes('admin')`
- 错误响应策略：采用 404（不泄露资源存在性）
- 共享机制：明确排除（超出范围，属于新功能）

---

## Work Objectives

### Core Objective
修复所有 API 路由的数据隔离漏洞，确保：
1. 普通用户只能访问自己的资源
2. 管理员可以访问所有资源
3. 未授权访问返回 404（不泄露资源存在性）
4. 使用统一的数据隔离模式

### Concrete Deliverables
**Wave 1 - Projects 模块** (最高优先级):
- `src/app/api/projects/[id]/route.ts` - GET, PUT, PATCH, DELETE
- `src/app/api/projects/[id]/sessions/route.ts` - GET
- `src/app/api/projects/[id]/files/route.ts` - POST

**Wave 2 - Vulnerabilities 模块** (高危):
- `src/app/api/vulnerabilities/route.ts` - GET, POST
- `src/app/api/vulnerabilities/[id]/route.ts` - GET, PUT, DELETE
- `src/app/api/vulnerabilities/[id]/confirm/route.ts` - POST
- `src/app/api/vulnerabilities/[id]/verify/route.ts` - POST
- `src/app/api/vulnerabilities/[id]/false-positive/route.ts` - POST
- `src/app/api/vulnerabilities/[id]/fix/route.ts` - POST

**Wave 3 - Evaluations 模块** (高危):
- `src/app/api/evaluations/[id]/route.ts` - GET, DELETE (添加管理员绕过)
- `src/app/api/evaluations/[id]/chat/route.ts` - POST
- `src/app/api/evaluations/[id]/messages/route.ts` - GET
- `src/app/api/evaluations/[id]/nodes/route.ts` - GET, POST, PUT
- `src/app/api/evaluations/[id]/todos/route.ts` - GET
- `src/app/api/evaluations/[id]/ask-progress/route.ts` - POST
- `src/app/api/evaluations/[id]/ralph-start/route.ts` - POST

**Wave 4 - 其他模块**:
- `src/app/api/autonomous-evolution/route.ts` - GET
- `src/app/api/autonomous-evolution/[id]/route.ts` - GET, PUT, DELETE
- `src/app/api/agent/executions/[id]/route.ts` - GET
- `src/app/api/messages/[id]/route.ts` - GET
- `src/app/api/sessions/[id]/messages/route.ts` - GET

### Definition of Done
- [ ] 所有 27 个端点通过安全验证测试
- [ ] 管理员绕过逻辑正常工作
- [ ] 普通用户无法访问他人资源
- [ ] 普通用户可以访问自己的资源
- [ ] 不存在的资源返回 404

### Must Have
- userId 验证逻辑（在 Prisma 操作之前）
- 管理员绕过逻辑（`payload.roles?.includes('admin')`）
- 一致的错误响应（404 Not Found）
- 统一的代码模式

### Must NOT Have (Guardrails)
- **不添加** 共享机制（isPublic, Share 表等）- 属于新功能
- **不修改** 错误消息格式
- **不添加** 审计日志或速率限制
- **不允许** API 修改 userId（防止资源接管攻击）

---

## Verification Strategy (MANDATORY)

### QA Policy
Every task MUST include agent-executed QA scenarios using curl commands.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (最高优先级 - Projects 模块):
├── Task 1: Fix projects/[id]/route.ts (GET, PUT, PATCH, DELETE) [quick]
├── Task 2: Fix projects/[id]/sessions/route.ts [quick]
└── Task 3: Fix projects/[id]/files/route.ts [quick]

Wave 2 (高危 - Vulnerabilities 模块):
├── Task 4: Fix vulnerabilities/route.ts (GET, POST) [quick]
├── Task 5: Fix vulnerabilities/[id]/route.ts (GET, PUT, DELETE) [quick]
├── Task 6: Fix vulnerabilities/[id]/confirm/route.ts [quick]
├── Task 7: Fix vulnerabilities/[id]/verify/route.ts [quick]
├── Task 8: Fix vulnerabilities/[id]/false-positive/route.ts [quick]
└── Task 9: Fix vulnerabilities/[id]/fix/route.ts [quick]

Wave 3 (高危 - Evaluations 模块):
├── Task 10: Fix evaluations/[id]/route.ts (添加管理员绕过) [quick]
├── Task 11: Fix evaluations/[id]/chat/route.ts [quick]
├── Task 12: Fix evaluations/[id]/messages/route.ts [quick]
├── Task 13: Fix evaluations/[id]/nodes/route.ts [quick]
├── Task 14: Fix evaluations/[id]/todos/route.ts [quick]
├── Task 15: Fix evaluations/[id]/ask-progress/route.ts [quick]
└── Task 16: Fix evaluations/[id]/ralph-start/route.ts [quick]

Wave 4 (中危 - 其他模块):
├── Task 17: Fix autonomous-evolution/route.ts [quick]
├── Task 18: Fix autonomous-evolution/[id]/route.ts [quick]
├── Task 19: Fix agent/executions/[id]/route.ts [quick]
├── Task 20: Fix messages/[id]/route.ts [quick]
└── Task 21: Fix sessions/[id]/messages/route.ts [quick]

Wave FINAL (验证):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real security QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 4 → Task 10 → Task 17 → F1-F4 → user okay
Parallel Speedup: ~70% faster than sequential
Max Concurrent: 7 (Wave 2 & 3)
```

### 统一修复模式

所有任务遵循相同的代码模式：

```typescript
// 1. 检测管理员
const isAdmin = payload.roles?.includes('admin');

// 2. 获取资源并验证所有权
const resource = await prisma.resource.findFirst({
  where: { 
    id,
    ...(isAdmin ? {} : { userId: payload.userId })  // 管理员不过滤
  },
  include: { ... }
});

// 3. 返回 404（不存在或无权访问）
if (!resource) {
  return NextResponse.json({ error: '资源不存在' }, { status: 404 });
}

// 4. 继续业务逻辑...
```

---

## TODOs

### Wave 1: Projects 模块 (最高优先级)

- [ ] 1. Fix projects/[id]/route.ts - GET, PUT, PATCH, DELETE

  **What to do**:
  - 添加管理员检测：`const isAdmin = payload.roles?.includes('admin');`
  - GET: 使用 `findFirst` 替代 `findUnique`，添加 userId 过滤
  - PUT/PATCH: 验证项目所有权，**排除 userId 字段**（防止项目接管）
  - DELETE: 验证项目所有权
  - 返回 404 而非 403（不泄露项目存在性）

  **Must NOT do**:
  - 添加 isPublic 或共享逻辑
  - 允许修改 userId 字段

  **References**:
  - `src/app/api/workflows/[id]/route.ts:36-54` - 管理员绕过模式
  - `src/app/api/vulnerabilities/stats/route.ts` - 项目所有权过滤示例

  **QA Scenarios**:
  ```
  Scenario: User accesses own project → 200
  Scenario: User accesses other's project → 404
  Scenario: Admin accesses any project → 200
  Scenario: Non-existent project → 404
  Scenario: User tries to change userId → userId unchanged
  ```
  Evidence: task-1-*.txt (5 files)

  **Commit**: NO (group with all tasks)

---

- [ ] 2. Fix projects/[id]/sessions/route.ts - GET

  **What to do**:
  - 添加项目所有权验证（通过 Project.userId）
  - 添加管理员绕过
  - 返回 404 如果项目不存在或无权访问

  **QA Scenarios**:
  ```
  Scenario: User lists own project sessions → 200
  Scenario: User lists other's project sessions → 404
  Scenario: Admin lists any project sessions → 200
  ```
  Evidence: task-2-*.txt (3 files)

  **Commit**: NO

---

- [ ] 3. Fix projects/[id]/files/route.ts - POST

  **What to do**:
  - 添加项目所有权验证
  - 添加管理员绕过
  - 返回 404 如果无权访问

  **QA Scenarios**:
  ```
  Scenario: User uploads to own project → 200
  Scenario: User uploads to other's project → 404
  Scenario: Admin uploads to any project → 200
  ```
  Evidence: task-3-*.txt (3 files)

  **Commit**: NO

---

### Wave 2: Vulnerabilities 模块 (高危)

- [ ] 4. Fix vulnerabilities/route.ts - GET, POST

  **What to do**:
  - GET: 添加 userId 过滤（通过 Vulnerability.Project.userId），管理员看全部
  - POST: 验证 projectId 所属用户，管理员可向任意项目添加

  **References**:
  - `src/app/api/vulnerabilities/stats/route.ts` - 已有正确的过滤实现

  **QA Scenarios**:
  ```
  Scenario: User lists own vulnerabilities → 200 (only own projects)
  Scenario: User creates vulnerability in own project → 201
  Scenario: User creates vulnerability in other's project → 404
  Scenario: Admin lists all vulnerabilities → 200 (all projects)
  Scenario: Admin creates in any project → 201
  ```
  Evidence: task-4-*.txt (5 files)

  **Commit**: NO

---

- [ ] 5. Fix vulnerabilities/[id]/route.ts - GET, PUT, DELETE

  **What to do**:
  - 通过 Vulnerability.Project.userId 验证所有权
  - 添加管理员绕过
  - 返回 404

  **QA Scenarios**:
  ```
  Scenario: User views own vulnerability → 200
  Scenario: User views other's vulnerability → 404
  Scenario: Admin views any vulnerability → 200
  Scenario: User updates own vulnerability → 200
  Scenario: User updates other's vulnerability → 404
  Scenario: User deletes own vulnerability → 200
  Scenario: User deletes other's vulnerability → 404
  ```
  Evidence: task-5-*.txt (7 files)

  **Commit**: NO

---

- [ ] 6. Fix vulnerabilities/[id]/confirm/route.ts - POST

  **What to do**: 添加所有权验证 + 管理员绕过

  **QA Scenarios**:
  ```
  Scenario: User confirms own vulnerability → 200
  Scenario: User confirms other's vulnerability → 404
  Scenario: Admin confirms any vulnerability → 200
  ```
  Evidence: task-6-*.txt (3 files)

  **Commit**: NO

---

- [ ] 7. Fix vulnerabilities/[id]/verify/route.ts - POST

  **What to do**: 同 Task 6

  **QA Scenarios**: Same pattern
  Evidence: task-7-*.txt (3 files)

  **Commit**: NO

---

- [ ] 8. Fix vulnerabilities/[id]/false-positive/route.ts - POST

  **What to do**: 同 Task 6

  **QA Scenarios**: Same pattern
  Evidence: task-8-*.txt (3 files)

  **Commit**: NO

---

- [ ] 9. Fix vulnerabilities/[id]/fix/route.ts - POST

  **What to do**: 同 Task 6

  **QA Scenarios**: Same pattern
  Evidence: task-9-*.txt (3 files)

  **Commit**: NO

---

### Wave 3: Evaluations 模块 (高危)

- [ ] 10. Fix evaluations/[id]/route.ts - 添加管理员绕过

  **What to do**:
  - 现有代码已有 userId 校验（通过 Project.userId）
  - **添加管理员绕过逻辑**
  - DELETE 方法也需要管理员绕过

  **References**:
  - `src/app/api/evaluations/[id]/route.ts:88` - 当前校验位置

  **QA Scenarios**:
  ```
  Scenario: User views own evaluation → 200
  Scenario: User views other's evaluation → 404
  Scenario: Admin views any evaluation → 200 (NEW)
  Scenario: Admin deletes any evaluation → 200 (NEW)
  ```
  Evidence: task-10-*.txt (4 files)

  **Commit**: NO

---

- [ ] 11. Fix evaluations/[id]/chat/route.ts - POST

  **What to do**: 添加所有权验证（通过 EvaluationSession.Project.userId）+ 管理员绕过

  **QA Scenarios**:
  ```
  Scenario: User chats in own evaluation → 200
  Scenario: User chats in other's evaluation → 404
  Scenario: Admin chats in any evaluation → 200
  ```
  Evidence: task-11-*.txt (3 files)

  **Commit**: NO

---

- [ ] 12. Fix evaluations/[id]/messages/route.ts - GET

  **What to do**: 同 Task 11

  **QA Scenarios**: Same pattern
  Evidence: task-12-*.txt (3 files)

  **Commit**: NO

---

- [ ] 13. Fix evaluations/[id]/nodes/route.ts - GET, POST, PUT

  **What to do**: 同 Task 11

  **QA Scenarios**: Same pattern for all methods
  Evidence: task-13-*.txt (3 files)

  **Commit**: NO

---

- [ ] 14. Fix evaluations/[id]/todos/route.ts - GET

  **What to do**: 同 Task 11

  **QA Scenarios**: Same pattern
  Evidence: task-14-*.txt (3 files)

  **Commit**: NO

---

- [ ] 15. Fix evaluations/[id]/ask-progress/route.ts - POST

  **What to do**: 同 Task 11

  **QA Scenarios**: Same pattern
  Evidence: task-15-*.txt (3 files)

  **Commit**: NO

---

- [ ] 16. Fix evaluations/[id]/ralph-start/route.ts - POST

  **What to do**: 同 Task 11

  **QA Scenarios**: Same pattern
  Evidence: task-16-*.txt (3 files)

  **Commit**: NO

---

### Wave 4: 其他模块 (中危)

- [ ] 17. Fix autonomous-evolution/route.ts - GET

  **What to do**:
  - 添加 userId 过滤（AutonomousEvolutionExperience.userId）
  - 添加管理员绕过
  - **注意**: 进化经验可能需要全局共享，需确认业务需求

  **QA Scenarios**:
  ```
  Scenario: User views own experiences → 200
  Scenario: Admin views all experiences → 200
  ```
  Evidence: task-17-*.txt (2 files)

  **Commit**: NO

---

- [ ] 18. Fix autonomous-evolution/[id]/route.ts - GET, PUT, DELETE

  **What to do**: 添加所有权验证 + 管理员绕过

  **QA Scenarios**: Same pattern
  Evidence: task-18-*.txt (3 files)

  **Commit**: NO

---

- [ ] 19. Fix agent/executions/[id]/route.ts - GET

  **What to do**: 通过 SkillExecution.Project.userId 验证所有权 + 管理员绕过

  **QA Scenarios**: Same pattern
  Evidence: task-19-*.txt (3 files)

  **Commit**: NO

---

- [ ] 20. Fix messages/[id]/route.ts - GET

  **What to do**: 通过 SessionMessage.EvaluationSession.Project.userId 验证所有权

  **QA Scenarios**: Same pattern
  Evidence: task-20-*.txt (3 files)

  **Commit**: NO

---

- [ ] 21. Fix sessions/[id]/messages/route.ts - GET

  **What to do**: 通过 EvaluationSession.Project.userId 验证所有权

  **QA Scenarios**: Same pattern
  Evidence: task-21-*.txt (3 files)

  **Commit**: YES (all tasks complete)
  - Message: `fix(api): add data isolation checks across all modules`
  - Pre-commit: `npm run build`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify all 27 endpoints have correct data isolation. Check admin bypass works for all modules.

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter. No `as any`/`@ts-ignore`.

- [ ] F3. **Real Security QA** — `unspecified-high`
  Test cross-module access scenarios. Verify no data leakage.

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify no unauthorized changes were made.

---

## Commit Strategy

- **Single Commit**: All fixes in one commit
- Message: `fix(api): add data isolation checks across all modules`
- Pre-commit: `npm run build` to verify no TypeScript errors

---

## Success Criteria

### 验证命令示例
```bash
# 1. 普通用户无法访问他人资源
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $USER_TOKEN" \
  http://localhost:3000/api/projects/$OTHER_PROJECT_ID
# Expected: 404

# 2. 管理员可以访问所有资源
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/projects/$ANY_PROJECT_ID
# Expected: 200

# 3. 不存在的资源返回 404
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $USER_TOKEN" \
  http://localhost:3000/api/projects/nonexistent
# Expected: 404
```

### Final Checklist
- [ ] All 27 endpoints secured
- [ ] Admin bypass works for all modules
- [ ] No TypeScript errors
- [ ] No lint errors
